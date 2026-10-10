// Pausing an upload in the desktop app: Pause Upload stops it part-way, the
// status line shows until when the server keeps it, as a local time, and
// Resume Upload carries it on to a link that downloads byte for byte. Nothing
// resumes by itself: a notification comes 5 minutes before the server's
// deadline (or at once, when the pause is shorter), naming no file, and still
// paused at the deadline, the upload ends. A file edited while its upload is
// paused can't be read on, so it's never sent part old, part new. Pause isn't
// there on a server with pausing turned off.
//
// Each file is opened with the app, as "Open with" does, so main hands the
// page its handle, and the upload reads it through the file service, as it
// does every file on disk. The upload runs in the app's transfer window, so
// that's where its chunks are held, and its clock moved.
import fs from 'node:fs';
import { madeUpFile, summary } from '../helpers/files.mjs';
import { expect, securityWarning, test, uploadButton, uploadStatus } from '../helpers/desktop.mjs';
import { download } from '../helpers/webui.mjs';

// Three 5 MiB chunks.
const SIZE = 12_000_000;
const MINUTE = 60_000;

/** The server's requests as `METHOD /path`, with their headers. */
const requests = (server) => server.requests().map((r) => ({ ...r, route: `${r.method} ${new URL(r.url, server.baseUrl).pathname}` }));

/**
 * Lets the upload's first chunk through, and holds every one after it until
 * `release()`, or, after `holdFrom(index)`, only those from that index on;
 * each chunk the app sends is noted with its Content-Digest.
 */
async function holdChunks(window) {
    const sent = [];
    let holding = true;
    let from = 1;
    await window.route('**/api/v4/upload/chunks/*', (route) => {
        const index = Number(new URL(route.request().url()).pathname.split('/').pop());
        sent.push({ index, digest: route.request().headers()['content-digest'] });
        if (holding && index >= from) return undefined;
        return route.continue();
    });
    return { sent, release: () => { holding = false; }, holdFrom: (index) => { from = index; } };
}

/**
 * Launch the app with a made-up file, as "Open with" does, point it at the
 * server, and start uploading the file, without waiting for the end. Returns
 * the app, its window, the transfer window the upload runs in, the file and
 * its path on disk.
 */
async function startUpload(desktop, name, seed, { encrypted, clock = false }) {
    const file = madeUpFile(name, SIZE, seed);
    desktop.secrets.addFiles([file], { storedByServer: !encrypted });
    const filePath = desktop.addFile(file);
    const app = await desktop.launch(filePath);
    const window = await app.window();
    await desktop.setUp(window);
    // The upload's clock, where core and the paused upload's notification run, is moved forward rather than waited on.
    const uploader = await app.transferWindow();
    if (clock) await uploader.clock.install();
    await expect(window.locator('#file-list .file-row-name')).toHaveText([name]);
    await expect(window.locator('#security-text')).toHaveText(encrypted ? /will be end-to-end encrypted/i : /will not be encrypted/i);
    const chunks = await holdChunks(uploader);
    await uploadButton(window).click();
    if (!encrypted) await securityWarning(window).getByRole('button', { name: 'Upload Anyway' }).click();
    await expect.poll(() => chunks.sent.length, { message: 'the second chunk should be on its way' }).toBe(2);
    return { app, window, uploader, file, filePath, chunks };
}

const pauseButton = (window) => window.locator('#action-bar').getByRole('button', { name: 'Pause Upload', exact: true });
const resumeButton = (window) => window.locator('#action-bar').getByRole('button', { name: 'Resume Upload', exact: true });
const cancelButton = (window) => window.locator('#action-bar').getByRole('button', { name: 'Cancel', exact: true });

/** The local time a deadline `minutes` from now is, and a minute after it, as the window writes it. */
const shownTimes = (window, minutes) => window.evaluate(({ ms, minute }) => [ms, ms + minute].map((after) => new Date(Date.now() + after)
    .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })), { ms: minutes * MINUTE, minute: MINUTE });

/** The app's notifications that a paused upload's server will drop it. */
const pauseNotifications = (app) => app.eventsOf('notification').filter(({ title }) => title === 'Upload Still Paused');

test.describe('on a server with HTTPS, keeping a paused upload 30 minutes', () => {
    test.use({ tlsProxy: true, serverEnv: { UPLOAD_MAX_PAUSE_MINUTES: '30' } });

    test('a paused upload shows until when the server keeps it, waits, resumes, and its link downloads byte for byte', async ({ desktop, server, page }) => {
        const { app, window, uploader, file, chunks } = await startUpload(desktop, 'Paused sealed é.bin', 41, { encrypted: true });

        await expect(pauseButton(window)).toBeEnabled();
        await expect(resumeButton(window)).toBeHidden();
        const [shortly, aMinuteLater] = await shownTimes(window, 30);
        await pauseButton(window).click();

        await expect(uploadStatus(window)).toHaveText(/^Paused\. Kept until .+\.$/);
        const line = await uploadStatus(window).innerText();
        expect([shortly, aMinuteLater].some((time) => line.endsWith(`until ${time}.`)), `"${line}" gives the server's 30 minutes as a local time`).toBe(true);
        await expect(resumeButton(window)).toBeEnabled();
        await expect(pauseButton(window)).toBeHidden();
        await expect(cancelButton(window)).toBeVisible();
        expect(await (await app.app.browserWindow(window)).evaluate((win) => win.getTitle()), 'the window title').toBe('Dropgate Client — Paused');

        // Nothing resumes by itself, and no notification yet: the deadline is half an hour off.
        await window.waitForTimeout(1_500);
        await expect(resumeButton(window)).toBeVisible();
        expect(chunks.sent, 'chunks sent while paused').toHaveLength(2);
        expect(requests(server).filter((r) => r.route === 'POST /api/v4/upload/resume'), 'resume requests').toEqual([]);
        expect(pauseNotifications(app), 'notifications').toEqual([]);

        chunks.release();
        await resumeButton(window).click();
        await expect(uploadStatus(window)).toHaveText(/upload successful/i, { timeout: 30_000 });
        await expect(resumeButton(window)).toBeHidden();
        await expect(pauseButton(window)).toBeHidden();
        const link = await window.locator('#download-link').inputValue();
        desktop.secrets.addLink(link);

        // One pause and one resume; the stopped chunk went again exactly as it was sealed, and each chunk reached the server once.
        const all = requests(server);
        expect(all.filter((r) => r.route === 'POST /api/v4/upload/pause')).toHaveLength(1);
        expect(all.filter((r) => r.route === 'POST /api/v4/upload/resume')).toHaveLength(1);
        expect(chunks.sent.map(({ index }) => index), 'chunks the app sent').toEqual([0, 1, 1, 2]);
        expect(chunks.sent[2].digest, 'the stopped chunk, sent again').toBe(chunks.sent[1].digest);
        expect(all.filter((r) => r.route.startsWith('PUT /api/v4/upload/chunks/')).map((r) => r.route.split('/').pop()), 'chunks the server got')
            .toEqual(['0', '1', '2']);

        await uploader.unrouteAll({ behavior: 'ignoreErrors' });
        await page.goto(desktop.receivingUrl(link));
        await expect(page.locator('#file-name')).toHaveText(file.name);
        const got = await download(page, page.locator('#download-button'));
        await expect(page.locator('#status-title')).toHaveText(/download complete/i);
        expect(summary(got.bytes)).toEqual(summary(file.buffer));
    });
});

test.describe('on a server keeping a paused upload 6 minutes', () => {
    test.use({ serverEnv: { UPLOAD_MAX_PAUSE_MINUTES: '6' } });

    test('a notification comes 5 minutes before the deadline, naming no file, and the upload stays paused', async ({ desktop, server }) => {
        const { app, window, uploader, chunks } = await startUpload(desktop, 'Warned about é.bin', 42, { encrypted: false, clock: true });
        const [deadline] = await shownTimes(window, 6);
        await pauseButton(window).click();
        await expect(uploadStatus(window)).toHaveText(/^Paused\. Kept until .+\.$/);

        await uploader.clock.fastForward(MINUTE - 5_000);
        await window.waitForTimeout(500);
        expect(pauseNotifications(app), 'notifications before the 5 minutes').toEqual([]);

        await uploader.clock.fastForward(10_000);
        await expect.poll(() => pauseNotifications(app).length, { message: 'the notification, 5 minutes before' }).toBe(1);
        const [{ body }] = pauseNotifications(app);
        expect(body).toMatch(/^The server drops it at .+ unless it's resumed\.$/);
        expect(body, 'the notification gives the deadline').toContain(deadline);
        expect(body, 'the notification names no file').not.toMatch(/Warned about|\.bin/);

        // Still paused: nothing resumed it.
        await expect(resumeButton(window)).toBeEnabled();
        expect(chunks.sent, 'chunks sent while paused').toHaveLength(2);
        expect(requests(server).filter((r) => r.route === 'POST /api/v4/upload/resume'), 'resume requests').toEqual([]);

        await cancelButton(window).click();
        await expect(uploadStatus(window)).toHaveText(/upload cancelled/i);
        expect(pauseNotifications(app), 'notifications, in the end').toHaveLength(1);
        await uploader.unrouteAll({ behavior: 'ignoreErrors' });
    });

    test('resumed before then, no notification comes', async ({ desktop }) => {
        const { app, window, uploader, chunks } = await startUpload(desktop, 'Resumed in time é.bin', 46, { encrypted: false, clock: true });
        await pauseButton(window).click();
        await expect(resumeButton(window)).toBeEnabled();
        // Half a minute paused, while no request is on its way to time out.
        await uploader.clock.fastForward(30_000);

        // The stopped chunk goes through, and the one after it is held, so the upload runs on.
        chunks.holdFrom(2);
        await resumeButton(window).click();
        await expect.poll(() => chunks.sent.map(({ index }) => index), { message: 'the chunk after the stopped one should be on its way' })
            .toEqual([0, 1, 1, 2]);
        await expect(pauseButton(window)).toBeVisible();

        // Past when the notification would have come had it stayed paused, but before the held chunk could time out.
        await uploader.clock.fastForward(35_000);
        await window.waitForTimeout(500);
        expect(pauseNotifications(app), 'notifications after resuming').toEqual([]);

        await cancelButton(window).click();
        await expect(uploadStatus(window)).toHaveText(/upload cancelled/i);
        await uploader.unrouteAll({ behavior: 'ignoreErrors' });
    });
});

test.describe('on a server keeping a paused upload 1 minute', () => {
    test.use({ serverEnv: { UPLOAD_MAX_PAUSE_MINUTES: '1' }, serverClock: true });

    test('the notification comes as it pauses, and at the deadline the upload ends, saying the server dropped it', async ({ desktop, server }) => {
        const { app, window, uploader, chunks } = await startUpload(desktop, 'Paused too long é.bin', 43, { encrypted: false, clock: true });
        await pauseButton(window).click();
        await expect(uploadStatus(window)).toHaveText(/^Paused\. Kept until .+\.$/);
        // Less than 5 minutes is left, so it says so at once.
        await expect.poll(() => pauseNotifications(app).length, { message: 'the notification, as it pauses' }).toBe(1);

        await uploader.clock.fastForward(MINUTE + 5_000);
        await server.advanceClock(MINUTE + 5_000);
        await expect(uploadStatus(window)).toHaveText('Upload failed: The server dropped this paused upload.');
        await expect(window.locator('#action-bar').getByRole('button', { name: /pause|resume|cancel/i })).toHaveCount(0);
        await expect(uploadButton(window), 'ready to upload again').toBeVisible();
        await expect.poll(() => app.eventsOf('upload-finished').map(({ status, error }) => ({ status, error })), { message: 'how the upload finished' })
            .toEqual([{ status: 'error', error: 'The server dropped this paused upload.' }]);
        expect(chunks.sent, 'chunks sent after the pause').toHaveLength(2);
        expect(requests(server).filter((r) => r.route === 'POST /api/v4/upload/resume'), 'resume requests').toEqual([]);
        expect(pauseNotifications(app), 'notifications that it was still paused').toHaveLength(1);

        // The server no longer has it either.
        const uploadId = requests(server).find((r) => r.route.startsWith('PUT /api/v4/upload/chunks/')).headers['dropgate-upload'];
        const status = await fetch(new URL('/api/v4/upload', server.baseUrl), { headers: { 'Dropgate-Upload': uploadId } });
        expect(status.status, 'the upload, asked for on the server').toBe(404);
        await uploader.unrouteAll({ behavior: 'ignoreErrors' });
    });
});

test.describe('on a server keeping a paused upload 30 minutes', () => {
    test.use({ serverEnv: { UPLOAD_MAX_PAUSE_MINUTES: '30' } });

    test("a file edited while its upload is paused can't be read on, and none of the edit is sent", async ({ desktop, server }) => {
        const { app, window, uploader, file, filePath, chunks } = await startUpload(desktop, 'Edited while paused é.bin', 44, { encrypted: false });
        await pauseButton(window).click();
        await expect(resumeButton(window)).toBeEnabled();

        // The same number of bytes, other ones: only its modification time says it changed.
        fs.writeFileSync(filePath, Buffer.alloc(file.buffer.length, 0x5a));
        chunks.release();
        await resumeButton(window).click();

        const message = "A file changed after the upload started, so the rest of it can't be read as it was.";
        await expect(uploadStatus(window)).toHaveText(`Upload failed: ${message}`);
        await expect.poll(() => app.eventsOf('upload-finished').map(({ status, error }) => ({ status, error })), { message: 'how the upload finished' })
            .toEqual([{ status: 'error', error: message }]);
        // The stopped chunk went again as it was read before the edit; the chunk after it was never read, so never sent.
        expect(chunks.sent.map(({ index }) => index), 'chunks the app sent').toEqual([0, 1, 1]);
        const got = requests(server).filter((r) => r.route.startsWith('PUT /api/v4/upload/chunks/'));
        expect(got.every((r) => !r.body.includes(Buffer.alloc(64, 0x5a))), 'no chunk holds the edit').toBe(true);
        await uploader.unrouteAll({ behavior: 'ignoreErrors' });
    });
});

test.describe('with pausing turned off on the server', () => {
    test.use({ serverEnv: { UPLOAD_MAX_PAUSE_MINUTES: '0' } });

    test('an upload has no Pause', async ({ desktop, server }) => {
        const { window, uploader } = await startUpload(desktop, 'Not paused é.bin', 45, { encrypted: false });
        await expect(cancelButton(window)).toBeVisible();
        await expect(window.locator('#action-bar').getByRole('button', { name: /pause|resume/i })).toHaveCount(0);

        await cancelButton(window).click();
        await expect(uploadStatus(window)).toHaveText(/upload cancelled/i);
        expect(requests(server).filter((r) => r.route.startsWith('POST /api/v4/upload/pause'))).toEqual([]);
        await uploader.unrouteAll({ behavior: 'ignoreErrors' });
    });
});
