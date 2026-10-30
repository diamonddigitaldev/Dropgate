// Pausing a download in the desktop app: Pause closes its request and holds
// its file open in the file service, in the partial folder in the app's
// profile under a random name (never its own, and nothing in its folder yet);
// the status line shows until when the server keeps it; nothing resumes by
// itself; a notification comes 5 minutes before the deadline (or at once,
// when the pause is shorter), naming no file; still paused at the deadline,
// the download ends, saying the server dropped it. Resumed, it carries on to
// its folder byte for byte, counted once. Quitting with one paused leaves
// nothing: the partial folder is empty, and nothing in the profile holds the
// link, its key, the file's name or its folder.
//
// The download runs in the app's transfer window, so that's where its
// request is held (until it's paused) and its clock moved.
import fs from 'node:fs';
import path from 'node:path';
import { deadlineTimes, installClock } from '../helpers/clock.mjs';
import { madeUpFile, summary } from '../helpers/files.mjs';
import { addLink, cardButton, downloadCard, downloadStatus, expect, pickFolder, test } from '../helpers/desktop.mjs';
import { uploadWithCore } from '../helpers/hosted.mjs';
import { heldIn } from '../helpers/profile.mjs';

const MINUTE = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const routes = (server) => server.requests().map((r) => `${r.method} ${new URL(r.url, server.baseUrl).pathname}`);
const partialsOf = (desktop) => path.join(desktop.profile, 'Partial Downloads');
const listing = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
const pauseNotifications = (app) => app.eventsOf('notification').filter(({ title }) => title === 'Download Still Paused');

/**
 * Upload a made-up file with core, launch the app, paste its link and start
 * downloading it, with its content held in the transfer window, so it's
 * running with its lease and its file open, and can be paused.
 */
async function startDownload(desktop, server, name, seed, { clock = false, folder = null } = {}) {
    const file = madeUpFile(name, 200_000, seed);
    desktop.secrets.addFiles([file]);
    const { link, id } = await uploadWithCore(server, [file]);
    desktop.secrets.addLink(link);
    const app = await desktop.launch();
    const window = await app.window();
    await addLink(window, link);
    await expect(downloadStatus(window)).toHaveText('Ready');
    // Started for reading its list of files.
    const downloader = await app.transferWindow();
    await installClock(downloader, { moved: clock });
    const held = [];
    await downloader.route('**/api/v4/objects/*/content', (route) => {
        held.push(route);
    });
    if (folder) {
        await pickFolder(app, folder);
        await downloadCard(window).getByRole('combobox', { name: 'Save to' }).selectOption({ label: 'Choose Folder…' });
    }
    await cardButton(downloadCard(window), 'Download').click();
    await expect.poll(() => held.length, { message: 'its content should be on its way' }).toBe(1);
    return { app, window, downloader, file, link, id, held };
}

const pauseButton = (window) => cardButton(downloadCard(window), 'Pause');
const resumeButton = (window) => cardButton(downloadCard(window), 'Resume');
const cancelButton = (window) => cardButton(downloadCard(window), 'Cancel');

test.describe('on a server keeping a paused download 30 minutes', () => {
    test.use({ serverEnv: { UPLOAD_MAX_PAUSE_MINUTES: '30' } });

    test('paused, its file is held open in the partial folder under a random name; it waits, resumes, and lands byte for byte, counted once', async ({ desktop, server }) => {
        const { app, window, downloader, file, id } = await startDownload(desktop, server, 'Paused download é.bin', 91);
        const [shortly, aMinuteLater] = await deadlineTimes(window, 30);
        await expect(pauseButton(window)).toBeEnabled();
        await pauseButton(window).click();
        await expect(downloadStatus(window)).toHaveText(/^Paused\. Kept until .+\.$/);
        const line = await downloadStatus(window).innerText();
        expect([shortly, aMinuteLater].some((time) => line.endsWith(`until ${time}.`)), `"${line}" gives the server's 30 minutes as a local time`).toBe(true);
        await expect(resumeButton(window)).toBeEnabled();
        await expect(cancelButton(window)).toBeVisible();
        expect(await (await app.app.browserWindow(window)).evaluate((win) => win.getTitle()), 'the window title').toBe('Dropgate Client — Paused');

        // Held open while paused: in the partial folder, under a random name, and nothing in its folder yet.
        const partials = listing(partialsOf(desktop));
        expect(partials, 'the partial folder').toHaveLength(1);
        expect(partials[0]).toMatch(UUID);
        expect(listing(desktop.downloads), 'the Downloads folder, while it runs').toEqual([]);

        // Nothing resumes by itself, and no notification: the deadline is half an hour off.
        await window.waitForTimeout(1_500);
        await expect(resumeButton(window)).toBeVisible();
        expect(routes(server).filter((r) => r === 'POST /api/v4/lease/renew'), 'renewals while paused').toEqual([]);
        expect(pauseNotifications(app)).toEqual([]);

        await downloader.unrouteAll({ behavior: 'ignoreErrors' });
        await resumeButton(window).click();
        await expect(downloadStatus(window)).toHaveText('Saved to Downloads', { timeout: 30_000 });
        expect(summary(fs.readFileSync(path.join(desktop.downloads, file.name)))).toEqual(summary(file.buffer));
        expect(listing(partialsOf(desktop)), 'the partial folder, once it\'s saved').toEqual([]);
        const all = routes(server);
        expect(all.filter((r) => r === `POST /api/v4/objects/${id}/leases`), 'one lease: one download').toHaveLength(1);
        expect(all.filter((r) => r === 'POST /api/v4/lease/pause'), 'pauses').toHaveLength(1);
        expect(all.filter((r) => r === 'POST /api/v4/lease/renew'), 'resumes').toHaveLength(1);
    });

    test('quit with a download paused, the partial folder is empty, and nothing in the profile holds the link, its key, the file\'s name or its folder', async ({ desktop, server }) => {
        const folder = path.join(desktop.root, 'Private Papers Folder');
        fs.mkdirSync(folder);
        const { app, window, file, link, id } = await startDownload(desktop, server, 'Board minutes, unsigned.bin', 92, { folder });
        await pauseButton(window).click();
        await expect(downloadStatus(window)).toHaveText(/^Paused\. Kept until /);
        expect(listing(partialsOf(desktop))).toHaveLength(1);
        await app.quit();

        expect(listing(partialsOf(desktop)), 'the partial folder, after quitting').toEqual([]);
        expect(listing(folder), 'the folder it was to be saved in').toEqual([]);
        const { hash } = new URL(link);
        const texts = [file.name, link, id, hash.slice(1), folder, path.basename(folder)];
        expect(heldIn(desktop.profile, { texts, bytes: [file.buffer] }), 'what the profile holds of the paused download').toEqual([]);
        // The server was told: its lease is gone, so the upload can be downloaded again at once.
        expect(routes(server).filter((r) => r === 'DELETE /api/v4/lease'), 'its lease, released').toHaveLength(1);
    });
});

test.describe('on a server keeping a paused download 6 minutes', () => {
    test.use({ serverEnv: { UPLOAD_MAX_PAUSE_MINUTES: '6' } });

    test('a notification comes 5 minutes before the deadline, naming no file, and the download stays paused', async ({ desktop, server }) => {
        const { app, window, downloader, held } = await startDownload(desktop, server, 'Warned about é.bin', 93, { clock: true });
        const [deadline] = await deadlineTimes(window, 6, { timeOnly: true });
        await pauseButton(window).click();
        await expect(downloadStatus(window)).toHaveText(/^Paused\. Kept until .+\.$/);

        await downloader.clock.fastForward(MINUTE - 5_000);
        await window.waitForTimeout(500);
        expect(pauseNotifications(app), 'notifications before the 5 minutes').toEqual([]);
        await downloader.clock.fastForward(10_000);
        await expect.poll(() => pauseNotifications(app).length, { message: 'the notification, 5 minutes before' }).toBe(1);
        const [{ body }] = pauseNotifications(app);
        expect(body).toMatch(/^The server drops it at .+ unless it's resumed\.$/);
        expect(body).toContain(deadline);
        expect(body, 'the notification names no file').not.toMatch(/Warned about|\.bin/);

        await expect(resumeButton(window), 'still paused: nothing resumed it').toBeEnabled();
        expect(held, 'requests for its content').toHaveLength(1);
        await cancelButton(window).click();
        await expect(downloadStatus(window)).toHaveText('Cancelled');
        expect(listing(partialsOf(desktop)), 'the partial folder, once it\'s cancelled').toEqual([]);
        expect(listing(desktop.downloads)).toEqual([]);
        await downloader.unrouteAll({ behavior: 'ignoreErrors' });
    });
});

test.describe('on a server keeping a paused download 1 minute', () => {
    test.use({ serverEnv: { UPLOAD_MAX_PAUSE_MINUTES: '1' }, serverClock: true });

    test('the notification comes as it pauses, and at the deadline the download ends, saying the server dropped it', async ({ desktop, server }) => {
        const { app, window, downloader } = await startDownload(desktop, server, 'Paused too long é.bin', 94, { clock: true });
        await pauseButton(window).click();
        await expect(downloadStatus(window)).toHaveText(/^Paused\. Kept until .+\.$/);
        await expect.poll(() => pauseNotifications(app).length, { message: 'the notification, as it pauses' }).toBe(1);

        await downloader.clock.fastForward(MINUTE + 5_000);
        await server.advanceClock(MINUTE + 5_000);
        await expect(downloadStatus(window)).toHaveText('Failed: The server dropped this paused download.');
        await expect(downloadCard(window).locator('.kit-card-actions').getByRole('button', { name: /pause|resume|cancel/i })).toHaveCount(0);
        await expect(cardButton(downloadCard(window), 'Retry')).toBeVisible();
        await expect.poll(() => app.eventsOf('download-finished').map(({ status, error }) => ({ status, error })))
            .toEqual([{ status: 'error', error: 'The server dropped this paused download.' }]);
        expect(listing(partialsOf(desktop)), 'the partial folder').toEqual([]);
        expect(listing(desktop.downloads)).toEqual([]);
        await downloader.unrouteAll({ behavior: 'ignoreErrors' });
    });
});
