// The main window closed while transfers go on: it hides, and Dropgate's tray
// icon shows (Open Dropgate Client, how many are going, Quit), with a
// notification the first time, naming no file. The transfers carry on, and
// once nothing is left the app quits, as it would have when the window
// closed. With nothing going, closing quits at once. Quit from the tray
// cancels every transfer, each server told: the server holds none of it after,
// and nothing of any of them is in the profile (13.10's whole-profile scan).
//
// And the notifications when transfers end: only while the window isn't in
// front of the person, several ending together in one ("3 Uploads Finished"),
// a failure counted, Title Case titles, never a name.
//
// Whether the window counts as focused is set by the test (the test preload's
// __dropgateFocused): on a test machine, which window has the focus isn't the
// test's to set. The tray's menu is clicked from main, as the test preload
// keeps it (__dropgateTray).
import fs from 'node:fs';
import path from 'node:path';
import { madeUpFile } from '../helpers/files.mjs';
import { expect, goingIn, holdChunks, shareWhileOpen, test, transfersIn, uploadButton, uploadCard } from '../helpers/desktop.mjs';
import { heldIn } from '../helpers/profile.mjs';

// Three 5 MiB chunks: the first goes through, the rest are held.
const SIZE = 12_000_000;

test.use({ tlsProxy: true, serverEnv: { UPLOAD_MAX_PAUSE_MINUTES: '30' } });

/** The main window, as main sees it. */
const mainWindowFacts = (app) => app.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/index.html'));
    return win ? { visible: win.isVisible(), destroyed: win.isDestroyed() } : null;
});

/** Close the main window, as its close button does. */
const closeWindow = (app, window) => app.app.browserWindow(window).then((win) => win.evaluate((w) => w.close()));

/** Click an item of the tray icon's menu, by its label. */
const clickTray = (app, label) => app.app.evaluate((_electron, wanted) => {
    const item = globalThis.__dropgateTray?.__menu?.items.find((i) => i.label === wanted);
    if (!item) throw new Error(`The tray has no "${wanted}".`);
    item.click();
}, label);

/** Say whether the main window counts as focused. */
const focus = (app, focused) => app.app.evaluate((_electron, value) => { globalThis.__dropgateFocused = value; }, focused);

/** The notifications that said something ended (not a share's progress, nor the tray's). */
const endings = (app) => app.eventsOf('notification').filter(({ title }) => /Successful|Failed|Finished/.test(title));

/** Launch the app with a file, as "Open with" does, point it at the server, and start uploading it, its chunks held. */
async function startUpload(desktop, file) {
    desktop.secrets.addFiles([file]);
    const filePath = desktop.addFile(file);
    const app = await desktop.launch(filePath);
    const window = await app.window();
    await desktop.setUp(window);
    await expect(uploadCard(window).locator('.kit-card-name')).toHaveText([file.name]);
    const chunks = await holdChunks(await app.transferWindow());
    await uploadButton(window).click();
    await expect.poll(() => chunks.sent.length, { message: 'the second chunk should be on its way' }).toBe(2);
    return { app, window, chunks, filePath };
}

test('closing the window with an upload running hides it to the tray, saying so the first time, and the upload finishes; then the app quits', async ({ desktop }) => {
    const file = madeUpFile('Tray minutes é.bin', SIZE, 70);
    const { app, window, chunks, filePath } = await startUpload(desktop, file);

    await closeWindow(app, window);
    expect(await mainWindowFacts(app), 'the main window, closed with an upload running').toEqual({ visible: false, destroyed: false });
    await expect.poll(() => app.eventsOf('tray').at(-1)?.labels, { message: "the tray icon's menu" })
        .toEqual(['Open Dropgate Client', '1 Uploading', '', 'Quit']);
    expect(app.eventsOf('tray').at(-1).tooltip).toBe('Dropgate Client: 1 Uploading');
    const told = app.eventsOf('notification').filter(({ title }) => title === 'Still Running in the Tray');
    expect(told.map(({ body }) => body), 'the notification that it went to the tray').toEqual(['1 upload goes on in the background. Open or quit Dropgate Client from its tray icon.']);

    // Opened from the tray, the window shows and the icon goes; closed again, it's the tray once more, untold.
    await clickTray(app, 'Open Dropgate Client');
    await expect.poll(() => mainWindowFacts(app)).toEqual({ visible: true, destroyed: false });
    expect(app.eventsOf('tray-gone').length, 'the tray icon, taken away').toBeGreaterThanOrEqual(1);
    await closeWindow(app, window);
    await expect.poll(() => mainWindowFacts(app)).toEqual({ visible: false, destroyed: false });
    expect(app.eventsOf('notification').filter(({ title }) => title === 'Still Running in the Tray'), 'told once').toHaveLength(1);

    // The upload finishes in the tray, its link copied and told of; then nothing's left, and the app quits.
    chunks.release();
    expect(await app.exited(), "the app's exit code").toBe(0);
    expect(app.eventsOf('upload-finished').map(({ status }) => status)).toEqual(['success']);
    const [{ text: link }] = app.eventsOf('clipboard');
    desktop.secrets.addLink(link);
    expect(endings(app).map(({ title, body }) => ({ title, body })), 'told of as it finished').toEqual([{ title: 'Upload Successful', body: 'Link copied to clipboard.' }]);
    for (const { title, body } of app.eventsOf('notification')) {
        for (const what of [file.name, filePath, desktop.folder]) expect(`${title}\n${body}`, 'a notification').not.toContain(what);
    }
});

test('closing the window with nothing going quits, with no tray icon', async ({ desktop }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await desktop.setUp(window);
    await closeWindow(app, window);
    expect(await app.exited(), "the app's exit code").toBe(0);
    expect(app.eventsOf('tray'), 'the tray icon').toEqual([]);
});

test('Quit from the tray cancels every transfer, running, paused and queued: the server holds none of them, and nothing of them is in the profile', async ({ desktop, server }) => {
    const own = madeUpFile('Quit from tray, own é.bin', SIZE, 71);
    const shared = Array.from({ length: 4 }, (_, i) => madeUpFile(`Quit from tray, shared ${i + 1} é.bin`, SIZE, 72 + i));
    const { app, window, chunks, filePath } = await startUpload(desktop, own);
    desktop.secrets.addFiles(shared);
    const sharedPaths = [];
    for (const file of shared) {
        const sharedPath = desktop.addFile(file);
        sharedPaths.push(sharedPath);
        await shareWhileOpen(desktop, window, sharedPath);
    }
    // The window's own paused, three shares running, one queued.
    const [ownId] = (await transfersIn(window)).map((card) => card.id);
    await expect.poll(async () => (await transfersIn(window)).filter((card) => card.state === 'running').length).toBe(3);
    await expect.poll(() => chunks.uploads().length, { message: 'the uploads sending', timeout: 15_000 }).toBe(3);
    await window.evaluate((id) => window.electronAPI.pauseTransfer(id), ownId);
    await expect.poll(async () => (await transfersIn(window)).map((card) => card.state), { message: 'what is going' })
        .toEqual(['paused', 'running', 'running', 'running', 'queued']);
    await expect.poll(() => chunks.uploads().length, { message: 'the uploads sending', timeout: 15_000 }).toBe(4);

    await closeWindow(app, window);
    await expect.poll(() => app.eventsOf('tray').at(-1)?.labels).toEqual(['Open Dropgate Client', '3 Uploading • 1 Paused • 1 Queued', '', 'Quit']);
    await clickTray(app, 'Quit');
    expect(await app.exited(), "the app's exit code").toBe(0);

    // Every upload the server began is gone from it, and it holds no file.
    const uploadIds = chunks.uploads();
    expect(uploadIds).toHaveLength(4);
    for (const uploadId of uploadIds) {
        const status = await fetch(new URL('/api/v4/upload', server.baseUrl), { headers: { 'Dropgate-Upload': uploadId } });
        expect(status.status, `upload ${uploadId}, asked for on the server`).toBe(404);
    }
    expect(server.storedFiles(), 'files the server holds').toEqual([]);
    expect(app.eventsOf('upload-finished').map(({ status }) => status), 'how they ended').toEqual(['cancelled', 'cancelled', 'cancelled', 'cancelled']);
    expect(app.eventsOf('clipboard'), 'links copied').toEqual([]);

    // Nothing of any of them in the profile, and no partial download folder holding anything.
    const texts = [own.name, filePath, ...shared.map((f) => f.name), ...sharedPaths, desktop.folder, path.basename(desktop.folder), ...uploadIds];
    expect(heldIn(desktop.profile, { texts, bytes: [own.buffer, ...shared.map((f) => f.buffer)] }), 'what the profile holds of them').toEqual([]);
    const partial = path.join(desktop.profile, 'Partial Downloads');
    expect(fs.existsSync(partial) ? fs.readdirSync(partial) : [], 'the partial download folder').toEqual([]);
});

test('transfers ending while the window is out of sight are told of in one notification, a failure counted; with the window in front, none', async ({ desktop }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await desktop.setUp(window);
    const transfer = await app.transferWindow();
    await focus(app, false);
    const share = async (name, seed) => {
        const file = madeUpFile(name, SIZE, seed);
        desktop.secrets.addFiles([file]);
        const filePath = desktop.addFile(file);
        await shareWhileOpen(desktop, window, filePath);
        return { file, filePath };
    };

    // Three ending together: one notification.
    let chunks = await holdChunks(transfer);
    const first = [await share('Grouped one é.bin', 80), await share('Grouped two é.bin', 81), await share('Grouped three é.bin', 82)];
    await expect.poll(() => chunks.sent.length, { message: 'each one\'s second chunk, held', timeout: 15_000 }).toBe(6);
    chunks.release();
    await expect.poll(async () => (await goingIn(window)).length, { message: 'the three, finished', timeout: 30_000 }).toBe(0);
    await expect.poll(() => endings(app).map(({ title, body }) => ({ title, body })), { message: 'what was told of their ending' })
        .toEqual([{ title: '3 Uploads Finished', body: 'The latest link is copied to the clipboard.' }]);
    await transfer.unrouteAll({ behavior: 'ignoreErrors' });
    for (const { text } of app.eventsOf('clipboard')) desktop.secrets.addLink(text);

    // Three more, one failing: its file changes while its chunk is held, so the rest can't be read.
    chunks = await holdChunks(transfer);
    const second = [await share('Counted one é.bin', 83), await share('Counted two é.bin', 84), await share('Counted three é.bin', 85)];
    await expect.poll(() => chunks.sent.length, { message: 'each one\'s second chunk, held', timeout: 15_000 }).toBe(6);
    fs.writeFileSync(second[1].filePath, Buffer.alloc(SIZE, 0x5a));
    chunks.release();
    await expect.poll(async () => (await goingIn(window)).length, { message: 'the three, ended', timeout: 30_000 }).toBe(0);
    await expect.poll(() => endings(app).slice(1).map(({ title, body }) => ({ title, body })), { message: 'what was told of their ending' })
        .toEqual([{ title: '3 Uploads Finished', body: '2 succeeded, 1 failed. The latest link is copied to the clipboard.' }]);
    await transfer.unrouteAll({ behavior: 'ignoreErrors' });
    for (const { text } of app.eventsOf('clipboard')) desktop.secrets.addLink(text);

    // With the window in front, nothing is told: the window shows it.
    await focus(app, true);
    const before = app.eventsOf('notification').length;
    const last = await share('Watched é.bin', 86);
    await expect.poll(async () => (await goingIn(window)).length, { message: 'the share, finished', timeout: 30_000 }).toBe(0);
    await expect.poll(() => app.eventsOf('upload-finished').length).toBe(7);
    await window.waitForTimeout(500);
    expect(app.eventsOf('notification').slice(before), 'notifications with the window in front').toEqual([]);
    for (const { text } of app.eventsOf('clipboard')) desktop.secrets.addLink(text);

    // Every title Title Case, and no notification names a file or a folder.
    for (const { title, body } of app.eventsOf('notification')) {
        expect(title.split(' ').every((word) => /^[A-Z0-9]/.test(word)), `"${title}" is Title Case`).toBe(true);
        for (const { file, filePath } of [...first, ...second, last]) {
            for (const what of [file.name, filePath, desktop.folder]) expect(`${title}\n${body}`, 'a notification').not.toContain(what);
        }
    }
});
