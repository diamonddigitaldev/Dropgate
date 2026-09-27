// Parity: "Share with Dropgate". Windows' context menu launches the desktop app
// with a file's path and --upload. The app uploads the file with the saved
// settings, copies the link to the clipboard and says so in a notification,
// without opening its main window, then quits. If the app is already open, the
// new launch hands the file to it instead.
import fs from 'node:fs';
import path from 'node:path';
import { holdsPlaintext, madeUpFile, summary } from '../helpers/files.mjs';
import { expect, test, uploadsStarted } from '../helpers/desktop.mjs';
import { download } from '../helpers/webui.mjs';

// Big enough for two 5 MiB chunks.
const SIZE = 6_000_000;
const THIRTY_MINUTES = 30 * 60 * 1000;

/** Set the app up as a person would first: the test's server and a file lifetime of 30 minutes. */
async function setUpAndQuit(desktop) {
    const app = await desktop.launch();
    await desktop.setUp(await app.window(), { lifetime: { value: 30, unit: 'minutes' } });
    await app.quit();
}

/**
 * What a run of the app copied and showed while sharing a file, checked the
 * same way whichever way it was shared, and the link it copied.
 * @param {import('../helpers/desktop.mjs').DesktopApp} app
 * @param {string} file - The shared file's full path.
 */
function expectLinkCopied(app, file) {
    const copied = app.eventsOf('clipboard');
    expect(copied.map((e) => e.text), 'what the app copied to the clipboard').toHaveLength(1);
    const [{ text: link, at }] = copied;

    // The link is copied only once the upload has succeeded.
    const finished = app.eventsOf('upload-finished');
    expect(finished.map(({ status, error }) => ({ status, error })), 'how the upload finished').toEqual([{ status: 'success' }]);
    expect(at, 'when the link was copied, next to when the upload finished').toBeGreaterThanOrEqual(finished[0].at);

    // Notifications may name the file, but never where it is.
    const notifications = app.eventsOf('notification');
    for (const { title, body } of notifications) {
        for (const where of [file, path.dirname(file)]) {
            expect(`${title}\n${body}`, 'a notification').not.toContain(where);
        }
    }
    return { link, notifications };
}

/** Open a link as someone receiving it would, and download the one file it gives. */
async function receive(page, desktop, link, file, { encrypted }) {
    await page.goto(desktop.receivingUrl(link));
    await expect(page.locator('#file-name')).toHaveText(file.name);
    await expect(page.locator('#file-encryption')).toHaveText(encrypted ? /end-to-end encrypted/i : /^none$/i);
    const got = await download(page, page.locator('#download-button'));
    await expect(page.locator('#status-title')).toHaveText(/download complete/i);
    expect(got.name).toBe(file.name);
    expect(summary(got.bytes)).toEqual(summary(file.buffer));
}

test.describe('on a server with HTTPS', () => {
    test.use({ tlsProxy: true });

    test('Share with Dropgate uploads a file end-to-end encrypted without opening a window, copies its link, says so, and quits', async ({ desktop, server, secrets, page }) => {
        const file = madeUpFile('ünïcode report.bin', SIZE, 21);
        secrets.addFiles([file]);
        await setUpAndQuit(desktop);

        const shared = desktop.addFile(file);
        const app = await desktop.share(shared);
        expect(await app.exited(), "the app's exit code").toBe(0);

        const { link, notifications } = expectLinkCopied(app, shared);
        expect(link, 'the link').toMatch(new RegExp(`^${desktop.serverUrl}/[^/#?]+#.+`));
        secrets.addLink(link);
        expect(notifications.at(-1), 'the last notification').toMatchObject({ title: expect.stringMatching(/success/i), body: expect.stringMatching(/copied/i) });
        expect(app.eventsOf('window'), 'windows the app opened').toHaveLength(1);
        expect(app.eventsOf('window-shown'), 'windows shown').toEqual([]);

        expect(uploadsStarted(server).map(({ isEncrypted, lifetime }) => ({ isEncrypted, lifetime })),
            'the upload the server was asked to start').toEqual([{ isEncrypted: true, lifetime: THIRTY_MINUTES }]);
        const stored = server.storedFiles();
        expect(stored, 'files the server holds').toHaveLength(1);
        const onDisk = fs.readFileSync(path.join(server.uploadsDir, stored[0]));
        expect(holdsPlaintext(onDisk, file.buffer), 'the stored file holds plaintext').toBe(false);
        expect(onDisk.includes(Buffer.from(file.name)), 'the stored file holds the file name').toBe(false);

        await receive(page, desktop, link, file, { encrypted: true });
    });

    test('Share with Dropgate while the app is open hands the file to the open app, which uploads it and shows its link', async ({ desktop, server, secrets, page }) => {
        const file = madeUpFile('Minutes of the meeting.bin', SIZE, 22);
        secrets.addFiles([file]);
        const app = await desktop.launch();
        const window = await app.window();
        await desktop.setUp(window, { lifetime: { value: 30, unit: 'minutes' } });

        const shared = desktop.addFile(file);
        expect(await desktop.launchAgain(shared, '--upload'), "the second launch's exit code").toBe(0);

        await expect(window.locator('#upload-status')).toHaveText(/upload successful/i, { timeout: 30_000 });
        const { link } = expectLinkCopied(app, shared);
        await expect(window.locator('#download-link'), 'the link the open app shows').toHaveValue(link);
        if (desktop.real) {
            // In CI the clipboard is real, and read back once the copy has finished, which can be just
            // after the window says it's done. It's checked here, where the app stays open: an app that
            // quits straight after copying can quit before the read-back finishes.
            await expect.poll(() => app.eventsOf('clipboard-read-back').map((e) => e.text ?? e.error),
                { message: 'what the clipboard held afterwards' }).toEqual([link]);
        }
        secrets.addLink(link);
        expect(app.running, 'whether the app is still open').toBe(true);
        expect(uploadsStarted(server).map(({ isEncrypted, lifetime }) => ({ isEncrypted, lifetime })),
            'the upload the server was asked to start').toEqual([{ isEncrypted: true, lifetime: THIRTY_MINUTES }]);

        await receive(page, desktop, link, file, { encrypted: true });
    });
});

test.describe('on a server without HTTPS', () => {
    test('Share with Dropgate warns that the upload will not be encrypted, then uploads the file once told to, copies its link, and quits', async ({ desktop, server, secrets, page }) => {
        const file = madeUpFile('Holiday plans é.bin', SIZE, 23);
        secrets.addFiles([file], { storedByServer: true });
        await setUpAndQuit(desktop);

        const shared = desktop.addFile(file);
        const app = await desktop.share(shared);
        const window = await app.window();
        await expect(window.locator('#insecure-upload-modal')).toBeVisible();
        await expect.poll(() => app.eventsOf('window-shown').length, { message: 'windows shown for the warning' }).toBe(1);
        await window.locator('#confirm-insecure-upload').click();
        expect(await app.exited(), "the app's exit code").toBe(0);

        const { link, notifications } = expectLinkCopied(app, shared);
        expect(link, 'the link').toMatch(new RegExp(`^${desktop.serverUrl}/[^/#?]+$`));
        expect(notifications.at(-1), 'the last notification').toMatchObject({ title: expect.stringMatching(/success/i), body: expect.stringMatching(/copied/i) });
        expect(uploadsStarted(server).map(({ isEncrypted, lifetime }) => ({ isEncrypted, lifetime })),
            'the upload the server was asked to start').toEqual([{ isEncrypted: false, lifetime: THIRTY_MINUTES }]);

        await receive(page, desktop, link, file, { encrypted: false });
    });
});
