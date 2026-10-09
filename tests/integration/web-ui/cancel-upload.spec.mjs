// Cancelling an upload from the home page: the upload's outcome is
// "cancelled", so the page says so and starts again, instead of reporting a
// failure, and the server is told to discard what it has.
import { madeUpFile } from '../helpers/files.mjs';
import { secretsOf } from '../helpers/privacy.mjs';
import { expect, test } from '../helpers/test.mjs';

// Three 5 MiB chunks.
const SIZE = 12_000_000;

test('cancelling an upload part-way says it was cancelled, goes back to the start, and the server keeps none of it', async ({ page, server }) => {
    const file = madeUpFile('Cancelled part-way é.bin', SIZE, 11);
    secretsOf(page).addFiles([file], { storedByServer: false });

    // The first chunk goes through; the second waits until the page gives up on it.
    let chunks = 0;
    await page.route('**/api/v4/upload/chunks/*', (route) => {
        chunks += 1;
        if (chunks === 1) return route.continue();
        return undefined;
    });

    await page.goto('/');
    await expect(page.locator('#securityText')).toHaveText(/will be end-to-end encrypted/i);
    await page.locator('#fileInput').setInputFiles([file]);
    await page.locator('#startBtn').click();

    await expect(page.locator('#cancelStandardUpload')).toBeVisible();
    await expect.poll(() => chunks, { message: 'the second chunk should be on its way' }).toBe(2);
    await page.locator('#cancelStandardUpload').click();

    await expect(page.locator('#toast-host')).toContainText(/upload cancelled/i);
    await expect(page.locator('#startBtn'), 'back at the start').toBeVisible();
    await expect(page.locator('#cancelStandardUpload')).toBeHidden();
    await expect(page.getByText(/upload failed/i)).toHaveCount(0);

    // The page told the server, which keeps nothing of the upload.
    await expect.poll(() => server.requests().filter((r) => r.method === 'DELETE' && new URL(r.url, server.baseUrl).pathname === '/api/v4/upload').length)
        .toBe(1);
    expect(server.storedFiles(), 'files the server holds').toEqual([]);
    expect(chunks, 'no chunk after the cancel').toBe(2);

    await page.unrouteAll({ behavior: 'ignoreErrors' });
});
