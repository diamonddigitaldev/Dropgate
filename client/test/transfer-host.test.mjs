// When the transfer host's two processes run (src/transfer-host.js), loaded
// in plain Node with a stand-in for Electron (helpers/main-process.mjs) and
// its clock mocked:
// - the transfer window starts with the first check or upload, and closes 30
//   seconds after the last of its work ends, unless more comes first;
// - the file service starts and stops with the transfer window, holding a
//   grant only while its upload runs or is paused, and the transfer window
//   gets its port once its page is ready;
// - quitting asks the transfer window to cancel everything, and waits at most
//   5 seconds for its answer;
// - a finished upload's manage token stays in the transfer window (main knows
//   only which uploads have one) until its card goes, it's deleted, or the app
//   quits, and the transfer window stays while it holds one.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mock, test } from 'node:test';
import { fakeMain } from './helpers/main-process.mjs';

const require = createRequire(import.meta.url);
const { ENGINE, TRANSFERS } = require('../src/constants.js');

const SERVER = { url: 'https://dropgate.test', allowInsecure: false };
const OPTIONS = { lifetime: { value: 24, unit: 'hours' }, maxDownloads: 1, encrypt: true };
const FILES = [{ path: '/secret/plans.bin', name: 'plans.bin', size: 1, mtimeMs: 1 }];

function setUp() {
    const main = fakeMain();
    const finished = [];
    const { createTransferHost } = main.load('../src/transfer-host.js');
    const host = createTransferHost({
        kit: main.kit,
        appInfo: { name: 'Dropgate Client', version: '4.0.0' },
        onUpdate: () => {},
        onPauseEnding: () => {},
        onFinished: (id, outcome) => finished.push([id, outcome]),
    });
    /** The transfer window's page, ready: main hands it the port and its work. */
    const ready = async (win) => main.invoke(ENGINE.READY, main.transferPage(win.webContents));
    const answer = (win, channel, value = {}) => {
        const [, { call }] = win.webContents.sent.findLast(([sent]) => sent === channel);
        return main.invoke(ENGINE.ANSWER, main.transferPage(win.webContents), call, value);
    };
    const finish = (win, id) => main.invoke(ENGINE.FINISHED, main.transferPage(win.webContents), id, { status: 'cancelled' });
    return { main, host, finished, ready, answer, finish };
}

test('the transfer window closes 30 seconds after the last of its work ends, and more work before then keeps it', async (t) => {
    t.after(() => mock.timers.reset());
    mock.timers.enable({ apis: ['setTimeout'] });
    assert.equal(TRANSFERS.WINDOW_IDLE_MS, 30_000);
    const { main, host, ready, answer, finish } = setUp();

    // A check starts it, and the file service with it.
    const checking = host.check(SERVER);
    const [win] = main.windows;
    await ready(win);
    assert.equal(main.processes.length, 1);
    await answer(win, ENGINE.CHECK, { ok: true });
    await checking;
    mock.timers.tick(29_000);
    assert.equal(win.destroyed, false);

    // An upload just in time keeps it.
    const id = randomUUID();
    host.upload(id, SERVER, OPTIONS, FILES);
    mock.timers.tick(5_000);
    assert.equal(win.destroyed, false);

    // Running, even for long, it stays.
    mock.timers.tick(10 * 60_000);
    assert.equal(win.destroyed, false);

    // It ends: 30 seconds later the window closes, and the file service with it.
    await finish(win, id);
    mock.timers.tick(29_999);
    assert.deepEqual([win.destroyed, main.processes[0].killed], [false, false]);
    mock.timers.tick(1);
    assert.deepEqual([win.destroyed, main.processes[0].killed], [true, true]);
});

test('the file service lives with the transfer window, holding a grant only while its upload runs, and the window gets its port once ready', async (t) => {
    t.after(() => mock.timers.reset());
    mock.timers.enable({ apis: ['setTimeout'] });
    const { main, host, ready, finish } = setUp();
    const first = randomUUID();
    host.upload(first, SERVER, OPTIONS, FILES);
    const [win] = main.windows;
    const [service] = main.processes;
    assert.equal(win.webContents.sent.filter(([channel]) => channel === ENGINE.PORT).length, 0, 'no port before its page is ready');
    await ready(win);
    const sent = win.webContents.sent.map(([channel]) => channel);
    assert.ok(sent.indexOf(ENGINE.PORT) >= 0 && sent.indexOf(ENGINE.PORT) < sent.indexOf(ENGINE.UPLOAD), 'the port, then the upload that reads through it');

    const second = randomUUID();
    host.upload(second, SERVER, OPTIONS, FILES);
    assert.equal(main.processes.length, 1, 'one file service for both');
    await finish(win, first);
    await finish(win, second);
    assert.deepEqual(service.messages.map((m) => m.type), ['port', 'grant-read', 'grant-read', 'revoke', 'revoke'], 'each grant revoked as its upload ends');
    assert.equal(service.killed, false, 'it stays while the transfer window does');
    host.close();
    assert.equal(service.killed, true);
});

test('quitting asks the transfer window to cancel everything there, and waits for its answer, or 5 seconds at most', async (t) => {
    t.after(() => mock.timers.reset());
    mock.timers.enable({ apis: ['setTimeout'] });
    assert.equal(TRANSFERS.QUIT_WAIT_MS, 5_000);
    const { main, host, ready, answer } = setUp();

    // Nothing there: nothing to ask.
    await host.quit();
    assert.deepEqual(main.windows, []);

    host.upload(randomUUID(), SERVER, OPTIONS, FILES);
    const [win] = main.windows;
    await ready(win);
    let done = false;
    const quitting = host.quit().then(() => {
        done = true;
    });
    await new Promise(setImmediate);
    assert.ok(win.webContents.sent.some(([channel]) => channel === ENGINE.QUIT));
    await answer(win, ENGINE.QUIT);
    await quitting;
    assert.equal(done, true);

    // A transfer window that never answers is waited on 5 seconds, no more.
    let gaveUp = false;
    const waiting = host.quit().then(() => {
        gaveUp = true;
    });
    await Promise.resolve();
    mock.timers.tick(4_999);
    await Promise.resolve();
    assert.equal(gaveUp, false);
    mock.timers.tick(1);
    await waiting;
    assert.equal(gaveUp, true);
    host.close();
});

/** A host whose uploads end as the test says, with the finished uploads whose tokens were lost noted. */
function hostKeeping() {
    const main = fakeMain();
    const lost = [];
    const { createTransferHost } = main.load('../src/transfer-host.js');
    const host = createTransferHost({
        kit: main.kit,
        appInfo: { name: 'Dropgate Client', version: '4.0.0' },
        onUpdate: () => {},
        onPauseEnding: () => {},
        onFinished: () => {},
        onTokensLost: (ids) => lost.push(...ids),
    });
    /** Uploads started, and the transfer window's page ready. */
    const started = async (ids) => {
        for (const id of ids) host.upload(id, SERVER, OPTIONS, FILES);
        const win = main.windows.at(-1);
        const page = main.transferPage(win.webContents);
        await main.invoke(ENGINE.READY, page);
        return { win, page };
    };
    return { main, host, lost, started };
}

const LINK = 'https://dropgate.test/0b7e3c51-9d2a-4f6e-8a1c-000000000001#key';

test('a finished upload\'s manage token keeps the transfer window until its card goes or it\'s deleted; main knows only which are held', async (t) => {
    t.after(() => mock.timers.reset());
    mock.timers.enable({ apis: ['setTimeout'] });
    const { main, host, lost, started } = hostKeeping();
    const [first, second, third] = [randomUUID(), randomUUID(), randomUUID()];
    const { win, page } = await started([first, second, third]);
    for (const id of [first, second]) await main.invoke(ENGINE.FINISHED, page, id, { status: 'success', link: LINK });
    await main.invoke(ENGINE.FINISHED, page, third, { status: 'cancelled' });
    assert.equal(host.keeping, true);

    // Held, the transfer window stays, however long.
    mock.timers.tick(10 * 60_000);
    assert.equal(win.destroyed, false);

    // A delete is asked of the transfer window: refused, the token stays; done, it's gone.
    const answer = async (value) => {
        await new Promise(setImmediate);
        const [, { call }] = win.webContents.sent.findLast(([channel]) => channel === ENGINE.DELETE);
        await main.invoke(ENGINE.ANSWER, page, call, value);
    };
    let deleting = host.delete(first);
    await answer({ message: 'The server closed the connection.' });
    assert.deepEqual(await deleting, { message: 'The server closed the connection.' });
    deleting = host.delete(first);
    await answer({});
    assert.deepEqual(await deleting, {});
    const none = { message: "This upload can't be deleted from here any more." };
    assert.deepEqual(await host.delete(first), none, 'once deleted, nothing to ask');
    assert.deepEqual(await host.delete(third), none, 'a cancelled one has none');
    assert.deepEqual(win.webContents.sent.filter(([channel]) => channel === ENGINE.DELETE).map(([, { id }]) => id), [first, first]);

    // The other's card is removed: forgotten there, and the window closes 30 seconds on.
    host.forget(second);
    assert.deepEqual(win.webContents.sent.at(-1), [ENGINE.FORGET, { id: second }]);
    assert.equal(host.keeping, false);
    mock.timers.tick(29_999);
    assert.equal(win.destroyed, false);
    mock.timers.tick(1);
    assert.equal(win.destroyed, true);
    host.forget(second);
    assert.equal(main.windows.length, 1, 'forgetting starts nothing');
    assert.deepEqual(lost, [], 'closed by main, nothing was lost');
});

test('quitting with a finished upload\'s token held asks the transfer window to forget it; a transfer window that stops loses it, and main is told', async (t) => {
    t.after(() => mock.timers.reset());
    mock.timers.enable({ apis: ['setTimeout'] });
    const { main, host, lost, started } = hostKeeping();
    const kept = randomUUID();
    const { win, page } = await started([kept]);
    await main.invoke(ENGINE.FINISHED, page, kept, { status: 'success', link: LINK });

    const quitting = host.quit();
    await new Promise(setImmediate);
    const [, { call }] = win.webContents.sent.findLast(([channel]) => channel === ENGINE.QUIT);
    assert.equal(host.keeping, false, 'quitting forgets them');
    await main.invoke(ENGINE.ANSWER, page, call, {});
    await quitting;
    host.close();
    assert.deepEqual(lost, []);

    // One that stops by itself (its renderer gone) loses what it held.
    const again = randomUUID();
    const next = await started([again]);
    await main.invoke(ENGINE.FINISHED, next.page, again, { status: 'success', link: LINK });
    next.win.destroy();
    assert.deepEqual(lost, [again]);
    assert.equal(host.keeping, false);
});
