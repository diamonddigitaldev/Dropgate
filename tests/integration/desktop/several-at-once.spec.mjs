// Several transfers at once, in main's registry: up to three run at once, the
// rest wait as queued and start in the order added as places free, and a
// paused one takes no place. Restart Now asks while any runs, is paused or is
// queued. While anything runs the system isn't let suspend the app, and the
// transfer window's timers are never slowed. Each transfer reaches the window
// at most 4 times a second.
//
// Proved with Share with Dropgate on five files, one after another, while the
// app is open: each share is a transfer of its own. Their chunks are held in
// the transfer window, where uploads run, so they stay running until let go.
import { madeUpFile } from '../helpers/files.mjs';
import { expect, holdChunks, shareWhileOpen, test, transfersIn, uploadsStarted } from '../helpers/desktop.mjs';

// Two chunks each: the first goes through, the second is held.
const SIZE = 6_000_000;

test.use({ tlsProxy: true, serverEnv: { UPLOAD_MAX_PAUSE_MINUTES: '30' } });

/** The power-save blocker's starts and stops, as the app made them. */
const powerSaves = (app) => app.eventsOf('power-save').map(({ action, type }) => (action === 'start' ? `start ${type}` : 'stop'));

test('five shares at once: three run and two wait as queued, starting in order as places free; a paused one takes no place; Restart Now asks throughout; the power-save blocker is on only while one runs', async ({ desktop, server }) => {
    const files = Array.from({ length: 5 }, (_, i) => madeUpFile(`Share ${i + 1} é.bin`, SIZE, 60 + i));
    desktop.secrets.addFiles(files);
    const app = await desktop.launch();
    const window = await app.window();
    await desktop.setUp(window);
    const chunks = await holdChunks(await app.transferWindow());
    const isBusy = () => window.evaluate(() => window.electronAPI.isBusy());
    const states = async (ids) => {
        const listed = new Map((await transfersIn(window)).map((card) => [card.id, card.state]));
        return ids.map((id) => listed.get(id) ?? 'gone');
    };

    expect(await isBusy(), 'Restart Now asks, before anything').toBe(false);
    expect(powerSaves(app), 'the power-save blocker, before anything runs').toEqual([]);

    const ids = [];
    for (const file of files) ids.push(await shareWhileOpen(desktop, window, desktop.addFile(file)));
    await expect.poll(() => states(ids), { message: 'three run, two wait' }).toEqual(['running', 'running', 'running', 'queued', 'queued']);
    // Each running one has sent its first chunk, and its second is held.
    await expect.poll(() => chunks.sent.length, { message: 'the running ones\' chunks', timeout: 15_000 }).toBe(6);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(uploadsStarted(server), 'the uploads the server was asked to start').toHaveLength(3);
    expect(await states(ids), 'still three running, two queued').toEqual(['running', 'running', 'running', 'queued', 'queued']);
    expect(await isBusy(), 'Restart Now asks, with three running and two queued').toBe(true);
    expect(powerSaves(app), 'the power-save blocker, while they run').toEqual(['start prevent-app-suspension']);
    expect(await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().endsWith('/transfer.html')).webContents.getBackgroundThrottling()),
    "the transfer window's background throttling").toBe(false);

    // Paused, the first takes no place: the fourth, first in line, starts; the fifth waits on.
    expect(await window.evaluate((id) => window.electronAPI.pauseTransfer(id), ids[0]), 'what pausing answered').toEqual({});
    await expect.poll(() => states(ids), { message: 'the first paused, the fourth started' }).toEqual(['paused', 'running', 'running', 'running', 'queued']);
    await expect.poll(() => uploadsStarted(server).length, { message: 'the uploads the server was asked to start' }).toBe(4);

    // Cancelled, the second's place goes to the fifth.
    await window.evaluate((id) => window.electronAPI.cancelTransfer(id), ids[1]);
    await expect.poll(() => states(ids), { message: 'the second cancelled, the fifth started' }).toEqual(['paused', 'cancelled', 'running', 'running', 'running']);
    await expect.poll(() => uploadsStarted(server).length).toBe(5);

    // Resumed with every place taken, the first waits as queued; paused again, it's paused.
    expect(await window.evaluate((id) => window.electronAPI.resumeTransfer(id), ids[0])).toEqual({});
    await expect.poll(() => states(ids)).toEqual(['queued', 'cancelled', 'running', 'running', 'running']);
    expect(await isBusy(), 'Restart Now asks, with one queued').toBe(true);
    await window.evaluate((id) => window.electronAPI.pauseTransfer(id), ids[0]);
    await expect.poll(() => states(ids)).toEqual(['paused', 'cancelled', 'running', 'running', 'running']);

    // Let go, the three running finish; only the paused one is left, and nothing runs.
    chunks.release();
    await expect.poll(() => states(ids), { message: 'the three running, finished', timeout: 30_000 }).toEqual(['paused', 'cancelled', 'done', 'done', 'done']);
    expect(await isBusy(), 'Restart Now asks, with one paused').toBe(true);
    await expect.poll(() => powerSaves(app), { message: 'the power-save blocker, with nothing running' })
        .toEqual(['start prevent-app-suspension', 'stop']);

    // Resumed, it has a place, runs and finishes.
    await window.evaluate((id) => window.electronAPI.resumeTransfer(id), ids[0]);
    await expect.poll(() => states(ids), { message: 'the first, resumed and finished', timeout: 30_000 }).toEqual(['done', 'cancelled', 'done', 'done', 'done']);
    expect(await isBusy(), 'Restart Now asks, with nothing left').toBe(false);
    await expect.poll(() => powerSaves(app)).toEqual(['start prevent-app-suspension', 'stop', 'start prevent-app-suspension', 'stop']);

    // Four links, one copied as each finished; the cancelled one, none.
    const outcomes = app.eventsOf('upload-finished').map(({ status }) => status).sort();
    expect(outcomes, 'how they finished').toEqual(['cancelled', 'success', 'success', 'success', 'success']);
    const links = app.eventsOf('clipboard').map((e) => e.text);
    expect(links, 'the links copied').toHaveLength(4);
    for (const link of links) desktop.secrets.addLink(link);
    expect(server.storedFiles(), 'files the server holds').toHaveLength(4);

    // Each transfer reached the window at most 4 times a second.
    const sends = Map.groupBy(app.eventsOf('transfer-changed'), (e) => e.id);
    expect([...sends.keys()].sort(), 'the transfers the window was sent').toEqual([...ids].sort());
    for (const [id, sent] of sends) {
        for (let i = 1; i < sent.length; i++) {
            expect(sent[i].at - sent[i - 1].at, `the time between two of ${id}'s`).toBeGreaterThanOrEqual(245);
        }
    }
});
