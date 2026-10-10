// When the transfer host's two processes run (src/transfer-host.js), loaded
// in plain Node with a stand-in for Electron (helpers/main-process.mjs) and
// its clock mocked:
// - the transfer window starts with the first check or upload, and closes 30
//   seconds after the last of its work ends, unless more comes first;
// - the file service starts with the first upload, and stops as the last
//   upload there ends (a paused one keeps it), each start handing the
//   transfer window a new port;
// - quitting asks the transfer window to cancel everything, and waits at most
//   5 seconds for its answer.
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

    // A check starts it, with no file service: nothing reads.
    const checking = host.check(SERVER);
    const [win] = main.windows;
    await ready(win);
    assert.deepEqual(main.processes, [], 'no file service for a check');
    await answer(win, ENGINE.CHECK, { ok: true });
    await checking;
    mock.timers.tick(29_000);
    assert.equal(win.destroyed, false);

    // An upload just in time keeps it, and starts the file service.
    const id = randomUUID();
    host.upload(id, SERVER, OPTIONS, FILES);
    mock.timers.tick(5_000);
    assert.equal(win.destroyed, false);
    assert.equal(main.processes.length, 1);

    // Running, even for long, it stays.
    mock.timers.tick(10 * 60_000);
    assert.equal(win.destroyed, false);

    // It ends: the file service stops at once, the window 30 seconds later.
    await finish(win, id);
    assert.equal(main.processes[0].killed, true);
    mock.timers.tick(29_999);
    assert.equal(win.destroyed, false);
    mock.timers.tick(1);
    assert.equal(win.destroyed, true);
});

test('the file service runs only while an upload there reads or is paused, and each start hands the transfer window a new port', async (t) => {
    t.after(() => mock.timers.reset());
    mock.timers.enable({ apis: ['setTimeout'] });
    const { main, host, ready, finish } = setUp();
    const first = randomUUID();
    const second = randomUUID();
    host.upload(first, SERVER, OPTIONS, FILES);
    const [win] = main.windows;
    await ready(win);
    main.processes[0].spawn();
    host.upload(second, SERVER, OPTIONS, FILES);
    assert.equal(main.processes.length, 1, 'one file service for both');
    await finish(win, first);
    assert.equal(main.processes[0].killed, false, 'the second still reads');
    await finish(win, second);
    assert.equal(main.processes[0].killed, true);

    // A new upload: a new file service, and, once it has spawned, a new port to it, then the upload's work.
    const third = randomUUID();
    const before = win.webContents.sent.length;
    host.upload(third, SERVER, OPTIONS, FILES);
    assert.equal(main.processes.length, 2);
    host.cancel(third);
    assert.deepEqual(win.webContents.sent.slice(before), [], 'nothing until the file service has spawned');
    main.processes[1].spawn();
    assert.deepEqual(win.webContents.sent.slice(before).map(([channel]) => channel), [ENGINE.PORT, ENGINE.UPLOAD, ENGINE.CANCEL],
        'the port, then the upload that reads through it, then what came for it meanwhile');
    host.close();
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
    main.processes[0].spawn();
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
