// Every channel main answers, as the handlers are registered in the app: the
// window's (window-channels.js) and the transfer window's (transfer-host.js),
// loaded in plain Node with a stand-in for Electron and the kit's own
// kit.ipc.handle() (helpers/main-process.mjs).
//
// - Each is answered in one session only: the window's page is refused every
//   engine channel, and the transfer window's page every window channel.
// - A payload of the wrong kind, an unsafe number, a path where a handle or an
//   ID goes, or a handle or an upload main never made (or made for another
//   window, or that has ended) is refused before anything is done: nothing
//   reaches the transfer host, the handles, the uploads, the clipboard or
//   main's callbacks.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fakeMain } from './helpers/main-process.mjs';

const require = createRequire(import.meta.url);
const { ENGINE, ENGINE_PUSHES, IPC, PUSHES } = require('../src/constants.js');
const { Handles } = require('../src/core/handles.js');

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dropgate-channels-'));
after(() => fs.rmSync(folder, { recursive: true, force: true }));
const FILE = path.join(folder, 'Secret plans é.bin');
fs.writeFileSync(FILE, Buffer.alloc(1000, 1));

const WINDOW_CHANNELS = Object.values(IPC).filter((channel) => !PUSHES.includes(channel));
const ENGINE_CHANNELS = Object.values(ENGINE).filter((channel) => !ENGINE_PUSHES.includes(channel));
const OPTIONS = { lifetime: { value: 24, unit: 'hours' }, maxDownloads: 1, encrypt: true };
const SERVER = { url: 'https://dropgate.test', allowInsecure: false };
const SNAPSHOT = {
    status: 'uploading', phase: 'chunk', text: 'Uploading chunk 1 of 3...', percent: 33.3,
    processedBytes: 5_242_880, totalBytes: 12_000_000, fileIndex: 0, totalFiles: 1, canPause: true, deadline: null,
};

/**
 * Both sets of channels, answered as main answers them, with everything they
 * act on recording what it's asked to do in `work`.
 */
function setUp({ settings = { serverURL: 'https://dropgate.test' } } = {}) {
    const main = fakeMain({ settings });
    const work = [];
    const record = (name, answer) => (...args) => {
        work.push([name, ...args]);
        return answer;
    };
    const handles = new Handles();
    for (const method of ['add', 'revoke', 'dropOwner']) {
        const real = handles[method].bind(handles);
        handles[method] = (...args) => {
            work.push([`handles.${method}`, ...args]);
            return real(...args);
        };
    }
    const uploads = new Map();
    const transferHost = {
        check: record('host.check', Promise.resolve({ ok: true })),
        pause: record('host.pause', Promise.resolve({})),
        resume: record('host.resume', Promise.resolve({})),
    };

    const { answerWindowChannels } = main.load('../src/window-channels.js');
    answerWindowChannels({
        kit: main.kit,
        handles,
        uploads,
        host: () => transferHost,
        windowReady: record('windowReady'),
        start: record('start'),
        cancel: record('cancel'),
        busy: record('busy', false),
        failed: record('failed'),
        copyLink: record('copyLink', Promise.resolve()),
    });

    const { createTransferHost } = main.load('../src/transfer-host.js');
    const host = createTransferHost({
        kit: main.kit,
        appInfo: { name: 'Dropgate Client', version: '4.0.0' },
        onUpdate: record('onUpdate'),
        onPauseEnding: record('onPauseEnding'),
        onFinished: record('onFinished'),
    });
    return { main, work, handles, uploads, host };
}

/** Each payload, invoked on a channel from a page, is refused with this message, and nothing is done. */
async function refusesAll({ main, work, uploads }, channel, page, payloads, message) {
    for (const args of payloads) {
        const before = { work: work.length, uploads: uploads.size };
        await assert.rejects(main.invoke(channel, page, ...args), message, `${channel} with ${describe(args)}`);
        assert.deepEqual(work.slice(before.work), [], `what was done for ${channel} with ${describe(args)}`);
        assert.equal(uploads.size, before.uploads, `main's uploads after ${channel} with ${describe(args)}`);
    }
}

const describe = (args) => {
    try {
        return JSON.stringify(args, (_key, value) => (typeof value === 'number' && !Number.isFinite(value) ? String(value) : value)).slice(0, 120);
    } catch {
        return String(args);
    }
};

test('every channel is answered through the kit: the window\'s in the UI session, and the transfer window\'s in its own session only', async () => {
    const { main } = setUp();
    assert.deepEqual([...main.handlers.keys()].sort(), [...WINDOW_CHANNELS, ...ENGINE_CHANNELS].sort());

    const window = main.windowPage();
    const transfer = main.transferPage();
    for (const channel of ENGINE_CHANNELS) {
        await assert.rejects(main.invoke(channel, window), /is answered for the app's own page only/, `${channel} from the window's page`);
    }
    for (const channel of WINDOW_CHANNELS) {
        await assert.rejects(main.invoke(channel, transfer), /is answered for the app's own page only/, `${channel} from the transfer page`);
        // Nor a page that isn't the app's own, in the UI session.
        await assert.rejects(main.invoke(channel, { sender: window.sender, senderFrame: { url: 'https://dropgate.test/' } }), /is answered for the app's own page only/);
    }
    // Each page is answered on its own.
    assert.equal(await main.invoke(IPC.TRANSFER_BUSY, window), false);
});

test('the window\'s page is refused every engine channel, and the transfer page every window channel, before anything is done', async () => {
    const setup = setUp();
    const { main, work, host } = setup;
    host.upload(randomUUID(), SERVER, OPTIONS, [{ path: FILE, name: 'Secret plans é.bin', size: 1000, mtimeMs: 1 }]);
    const start = work.length;
    for (const channel of ENGINE_CHANNELS) {
        await assert.rejects(main.invoke(channel, main.windowPage(), randomUUID(), SNAPSHOT));
    }
    for (const channel of WINDOW_CHANNELS) {
        await assert.rejects(main.invoke(channel, main.transferPage(main.windows[0].webContents), [FILE]));
    }
    assert.deepEqual(work.slice(start), []);
});

test('files:add takes absolute paths only, the whole list or nothing', async () => {
    const setup = setUp();
    const page = setup.main.windowPage();
    await refusesAll(setup, IPC.FILES_ADD, page, [
        [], [FILE], [null], [{ 0: FILE }], [[FILE, 'notes.txt']], [[FILE, 42]], [[FILE, `${FILE}\0.txt`]],
        [[FILE, 'x'.repeat(40_000)]], [Array(10_001).fill(FILE)],
    ], /Expected a list of paths\./);

    const { files, folders } = await setup.main.invoke(IPC.FILES_ADD, page, [FILE, folder]);
    assert.deepEqual([files.map((f) => Object.keys(f).sort()), folders], [[['handle', 'name', 'size']], 1]);
});

test('file:revoke takes a handle this window holds', async () => {
    const setup = setUp();
    const page = setup.main.windowPage();
    const other = setup.main.windowPage();
    const { files: [mine] } = await setup.main.invoke(IPC.FILES_ADD, page, [FILE]);
    const { files: [theirs] } = await setup.main.invoke(IPC.FILES_ADD, other, [FILE]);
    await refusesAll(setup, IPC.FILE_REVOKE, page, [[], [42], ['not a handle'], [FILE], [{ handle: mine.handle }]], /Expected a file\./);
    await refusesAll(setup, IPC.FILE_REVOKE, page, [[randomUUID()], [theirs.handle]], /Expected a file handed to this window\./);
    await setup.main.invoke(IPC.FILE_REVOKE, page, mine.handle);
    assert.deepEqual(setup.work.at(-1), ['handles.revoke', page.sender.id, mine.handle]);
});

test('server:check takes a server\'s address, never a path or another scheme', async () => {
    const setup = setUp();
    const page = setup.main.windowPage();
    await refusesAll(setup, IPC.SERVER_CHECK, page, [
        [], [42], [''], ['   '], [['https://dropgate.test']], [`https://${'x'.repeat(2_050)}`], [FILE], ['/etc/passwd'],
        ['C:\\Users\\will\\file.bin'], ['C:/Users/will/file.bin'], ['\\\\server\\share\\file.bin'], ['file:///etc/passwd'],
        ['javascript:alert(1)'], ['ftp://dropgate.test'], ['http:/dropgate.test'], ['dropgate.test/a b'],
    ], /Expected a server address\./);

    for (const [typed, server] of [
        ['https://dropgate.test', { url: 'https://dropgate.test', allowInsecure: false }],
        ['  dropgate.test  ', { url: 'dropgate.test', allowInsecure: false }],
        ['localhost:3000', { url: 'localhost:3000', allowInsecure: false }],
        ['http://192.168.1.2:52443', { url: 'http://192.168.1.2:52443', allowInsecure: true }],
    ]) {
        await setup.main.invoke(IPC.SERVER_CHECK, page, typed);
        assert.deepEqual(setup.work.at(-1), ['host.check', server], typed);
    }
});

test('transfer:add-upload takes handles this window holds and options in range, and nothing else', async () => {
    const setup = setUp();
    const page = setup.main.windowPage();
    const { files: [mine] } = await setup.main.invoke(IPC.FILES_ADD, page, [FILE]);
    const { files: [theirs] } = await setup.main.invoke(IPC.FILES_ADD, setup.main.windowPage(), [FILE]);
    const upload = (change) => ({ files: [mine.handle], options: OPTIONS, ...change });
    const options = (change) => upload({ options: { ...OPTIONS, ...change } });
    const lifetime = (value, unit) => options({ lifetime: { value, unit } });

    await refusesAll(setup, IPC.TRANSFER_ADD_UPLOAD, page, [
        [], [[mine.handle]], [upload({ files: [] })], [upload({ files: mine.handle })], [upload({ files: [FILE] })],
        [upload({ files: ['not a handle'] })], [upload({ files: [42] })], [upload({ server: 'https://elsewhere.test' })],
    ], /Expected files to upload\./);
    await refusesAll(setup, IPC.TRANSFER_ADD_UPLOAD, page, [[upload({ files: [randomUUID()] })], [upload({ files: [mine.handle, theirs.handle] })]],
        /Expected files handed to this window\./);
    await refusesAll(setup, IPC.TRANSFER_ADD_UPLOAD, page, [
        [{ files: [mine.handle] }], [upload({ options: null })], [options({ path: FILE })],
    ], /Expected an upload's options\./);
    await refusesAll(setup, IPC.TRANSFER_ADD_UPLOAD, page, [
        [lifetime(24, 'weeks')], [lifetime(-1, 'hours')], [lifetime(NaN, 'hours')], [lifetime(Infinity, 'hours')], [lifetime('24', 'hours')],
        [lifetime(1e300, 'days')], [lifetime(5, 'unlimited')], [options({ lifetime: { value: 24 } })], [options({ lifetime: { value: 24, unit: 'hours', ms: 1 } })],
    ], /Expected a file lifetime\./);
    await refusesAll(setup, IPC.TRANSFER_ADD_UPLOAD, page, [
        [options({ maxDownloads: 1.5 })], [options({ maxDownloads: -1 })], [options({ maxDownloads: 2 ** 53 })], [options({ maxDownloads: '1' })],
    ], /Expected a download limit\./);
    await refusesAll(setup, IPC.TRANSFER_ADD_UPLOAD, page, [[options({ encrypt: 'yes' })], [options({ encrypt: undefined })]],
        /Expected whether to encrypt\./);

    const { id } = await setup.main.invoke(IPC.TRANSFER_ADD_UPLOAD, page, lifetime(0.5, 'hours'));
    assert.deepEqual(setup.uploads.get(id), {
        owner: page.sender.id,
        files: [{ path: FILE, name: 'Secret plans é.bin', size: 1000, mtimeMs: fs.statSync(FILE).mtimeMs }],
        options: { ...OPTIONS, lifetime: { value: 0.5, unit: 'hours' } },
        started: false,
    });
});

test('transfer:start takes uploads waiting that this window made, or a share it was asked about, and checks them all first', async () => {
    const setup = setUp();
    const page = setup.main.windowPage();
    const other = setup.main.windowPage();
    const add = async (from) => {
        const { files: [file] } = await setup.main.invoke(IPC.FILES_ADD, from, [FILE]);
        return (await setup.main.invoke(IPC.TRANSFER_ADD_UPLOAD, from, { files: [file.handle], options: OPTIONS })).id;
    };
    const mine = await add(page);
    const theirs = await add(other);
    const started = await add(page);
    setup.uploads.get(started).started = true;
    const asked = randomUUID();
    setup.uploads.set(asked, { owner: null, share: true, server: SERVER, files: [], options: OPTIONS, started: false, ask: { owner: page.sender.id } });
    const askedOfOther = randomUUID();
    setup.uploads.set(askedOfOther, { owner: null, share: true, server: SERVER, files: [], options: OPTIONS, started: false, ask: { owner: other.sender.id } });

    await refusesAll(setup, IPC.TRANSFER_START, page, [
        [], [[mine]], [{ ids: mine }], [{ ids: [] }], [{ ids: [mine, mine] }], [{ ids: [FILE] }], [{ ids: [randomUUID()] }],
        [{ ids: [mine, theirs] }], [{ ids: [started] }], [{ ids: [askedOfOther] }], [{ ids: [mine], server: 'https://elsewhere.test' }],
    ], /Expected uploads waiting to start\./);

    await setup.main.invoke(IPC.TRANSFER_START, page, { ids: [mine, asked] });
    assert.deepEqual(setup.work.slice(-2), [['start', mine, SERVER], ['start', asked, SERVER]]);

    // With no server in Settings, a window's own upload has nowhere to go: refused before any starts.
    const unset = setUp({ settings: { serverURL: '' } });
    const unsetPage = unset.main.windowPage();
    const { files: [file] } = await unset.main.invoke(IPC.FILES_ADD, unsetPage, [FILE]);
    const { id } = await unset.main.invoke(IPC.TRANSFER_ADD_UPLOAD, unsetPage, { files: [file.handle], options: OPTIONS });
    await refusesAll(unset, IPC.TRANSFER_START, unsetPage, [[{ ids: [id] }]], /Server URL is not configured\./);
});

test('transfer:pause, transfer:resume and transfer:cancel take one upload main made, by its ID', async () => {
    const setup = setUp();
    const page = setup.main.windowPage();
    const id = randomUUID();
    setup.uploads.set(id, { owner: null, files: [], options: OPTIONS, started: true });
    for (const channel of [IPC.TRANSFER_PAUSE, IPC.TRANSFER_RESUME, IPC.TRANSFER_CANCEL]) {
        await refusesAll(setup, channel, page, [
            [], [id], [{ id: 42 }], [{ id: FILE }], [{ id: randomUUID() }], [{ id: id.toUpperCase() }], [{ id, extra: true }], [{ ids: [id] }],
        ], /Expected an upload\./);
    }
    await setup.main.invoke(IPC.TRANSFER_PAUSE, page, { id });
    await setup.main.invoke(IPC.TRANSFER_RESUME, page, { id });
    await setup.main.invoke(IPC.TRANSFER_CANCEL, page, { id });
    assert.deepEqual(setup.work.slice(-3), [['host.pause', id], ['host.resume', id], ['cancel', id]]);
});

test('link:copy takes a link to the web, and upload:finished why an upload never started', async () => {
    const setup = setUp();
    const page = setup.main.windowPage();
    await refusesAll(setup, IPC.LINK_COPY, page, [
        [], [42], [FILE], ['file:///etc/passwd'], ['javascript:alert(1)'], ['https://dropgate.test/a b'], [`https://dropgate.test/${'x'.repeat(9_000)}`],
        [{ link: 'https://dropgate.test/abc' }],
    ], /Expected a link\./);
    await refusesAll(setup, IPC.UPLOAD_FINISHED, page, [
        [], ['No files selected.'], [{ status: 'success', link: 'https://dropgate.test/abc' }], [{ status: 'error' }],
        [{ status: 'error', error: 42 }], [{ status: 'error', error: 'x'.repeat(1_001) }], [{ status: 'error', error: 'No files selected.', path: FILE }],
    ], /Expected why the upload never started\./);

    await setup.main.invoke(IPC.LINK_COPY, page, 'https://dropgate.test/abc#key');
    await setup.main.invoke(IPC.UPLOAD_FINISHED, page, { status: 'error', error: 'No files selected.' });
    assert.deepEqual(setup.work.slice(-2), [['copyLink', 'https://dropgate.test/abc#key'], ['failed', { status: 'error', error: 'No files selected.' }]]);
});

test('the transfer window\'s channels take its own page only, an upload running there, and core\'s shapes, with safe numbers', async () => {
    const setup = setUp();
    const { main, work, host } = setup;
    const id = randomUUID();
    host.upload(id, SERVER, OPTIONS, [{ path: FILE, name: 'Secret plans é.bin', size: 1000, mtimeMs: 1 }]);
    const [win] = main.windows;
    const page = main.transferPage(win.webContents);

    // Another page in the transfer session isn't the transfer window.
    for (const channel of ENGINE_CHANNELS) {
        await refusesAll(setup, channel, main.transferPage(), [[id, SNAPSHOT]], /Not the transfer window\./);
    }
    assert.deepEqual(await main.invoke(ENGINE.READY, page), { appInfo: { name: 'Dropgate Client', version: '4.0.0' } });

    const snapshot = (change) => ({ ...SNAPSHOT, ...change });
    await refusesAll(setup, ENGINE.UPDATE, page, [[randomUUID(), SNAPSHOT], [FILE, SNAPSHOT], [42, SNAPSHOT]],
        /Expected a snapshot of an upload running\./);
    await refusesAll(setup, ENGINE.UPDATE, page, [
        [id], [id, null], [id, 'uploading'], [id, snapshot({ status: 'done' })], [id, snapshot({ processedBytes: 2 ** 53 })],
        [id, snapshot({ totalBytes: -1 })], [id, snapshot({ fileIndex: 0.5 })], [id, snapshot({ percent: 101 })], [id, snapshot({ percent: NaN })],
        [id, snapshot({ deadline: 1.5 })], [id, snapshot({ text: 42 })], [id, snapshot({ text: 'x'.repeat(1_001) })],
        [id, snapshot({ canPause: 'yes' })], [id, snapshot({ fileName: 'Secret plans é.bin' })], [id, snapshot({ path: FILE })],
    ], /Expected a snapshot of an upload running\./);

    await refusesAll(setup, ENGINE.PAUSE_ENDING, page, [[randomUUID(), Date.now()]], /Expected a deadline of an upload running\./);
    await refusesAll(setup, ENGINE.PAUSE_ENDING, page, [
        [id], [id, NaN], [id, 1.5], [id, 2 ** 60], [id, -1], [id, 0], [id, String(Date.now())],
    ], /Expected a deadline of an upload running\./);

    await refusesAll(setup, ENGINE.FINISHED, page, [[randomUUID(), { status: 'cancelled' }]], /Expected how an upload running finished\./);
    await refusesAll(setup, ENGINE.FINISHED, page, [
        [id], [id, { status: 'success' }], [id, { status: 'success', link: 'file:///etc/passwd' }], [id, { status: 'success', link: 42 }],
        [id, { status: 'error' }], [id, { status: 'error', message: 42 }], [id, { status: 'completed' }],
        [id, { status: 'cancelled', link: 'https://dropgate.test/abc' }], [id, { status: 'error', message: 'x', path: FILE }],
    ], /Expected how an upload running finished\./);

    const checking = host.check(SERVER);
    const [, { call }] = win.webContents.sent.find(([channel]) => channel === ENGINE.CHECK);
    await refusesAll(setup, ENGINE.ANSWER, page, [[randomUUID(), { ok: true }], ['call', { ok: true }], [FILE, { ok: true }]],
        /Expected the answer to a call\./);
    await refusesAll(setup, ENGINE.ANSWER, page, [[call], [call, 'ok'], [call, { ok: 'yes' }], [call, { ok: true, path: FILE }]],
        /Expected the answer to a call\./);

    // Nothing above reached main's callbacks, or revoked the upload's read grant.
    assert.deepEqual(work, []);
    assert.deepEqual(main.processes[0].messages.map((m) => m.type), ['port', 'grant-read']);

    // And each, well formed, goes through.
    await main.invoke(ENGINE.ANSWER, page, call, { ok: false, code: null, message: 'Unreachable.' });
    assert.deepEqual(await checking, { ok: false, code: null, message: 'Unreachable.' });
    await main.invoke(ENGINE.UPDATE, page, id, SNAPSHOT);
    await main.invoke(ENGINE.PAUSE_ENDING, page, id, 1_800_000_000_000);
    await main.invoke(ENGINE.FINISHED, page, id, { status: 'cancelled' });
    assert.deepEqual(work, [['onUpdate', id, SNAPSHOT], ['onPauseEnding', id, 1_800_000_000_000], ['onFinished', id, { status: 'cancelled' }]]);
    assert.deepEqual(main.processes[0].messages.at(-1).type, 'revoke');

    // An upload that has ended is unknown from then on.
    await refusesAll(setup, ENGINE.UPDATE, page, [[id, SNAPSHOT]], /Expected a snapshot of an upload running\./);
    await refusesAll(setup, ENGINE.FINISHED, page, [[id, { status: 'cancelled' }]], /Expected how an upload running finished\./);
});
