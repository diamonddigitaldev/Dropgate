// Cancelling an upload in the desktop app. The upload's outcome is
// "cancelled", so the app says so, not that it failed (v3 said "Upload failed:
// Upload cancelled.", with a failure notification), and the server is told to
// discard what it has.
import { madeUpFile } from '../helpers/files.mjs';
import { expect, securityWarning, test, uploadButton, uploadStatus } from '../helpers/desktop.mjs';

// Three 5 MiB chunks.
const SIZE = 12_000_000;

test('cancelling an upload says it was cancelled, not that it failed, and the server keeps none of it', async ({ desktop, server }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await desktop.setUp(window);

    const file = madeUpFile('Cancelled from the app é.bin', SIZE, 21);
    // The test's server is plain HTTP, so the app asks first, and the server would store the name.
    desktop.secrets.addFiles([file], { storedByServer: true });

    // The first chunk goes through; the second waits until the app gives up on it.
    let chunks = 0;
    await window.route('**/upload/chunk', (route) => {
        chunks += 1;
        if (chunks === 1) return route.continue();
        return undefined;
    });

    await window.locator('#file-input').setInputFiles([file]);
    await uploadButton(window).click();
    await securityWarning(window).getByRole('button', { name: 'Upload Anyway' }).click();
    await expect.poll(() => chunks, { message: 'the second chunk should be on its way' }).toBe(2);
    await window.locator('#action-bar').getByRole('button', { name: 'Cancel', exact: true }).click();

    await expect(uploadStatus(window)).toHaveText(/upload cancelled/i);
    await expect(uploadButton(window), 'ready to upload again').toBeVisible();
    await expect(window.getByText(/upload failed/i)).toHaveCount(0);
    await expect.poll(() => app.eventsOf('upload-finished').map(({ status, error }) => ({ status, error })),
        { message: 'how the upload finished' }).toEqual([{ status: 'cancelled', error: undefined }]);
    expect(app.eventsOf('notification'), 'notifications').toEqual([]);

    await expect.poll(() => server.requests().filter((r) => r.method === 'POST' && r.url === '/upload/cancel').length)
        .toBe(1);
    expect(server.storedFiles(), 'files the server holds').toEqual([]);
    expect(chunks, 'no chunk after the cancel').toBe(2);

    await window.unrouteAll({ behavior: 'ignoreErrors' });
});
