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
//   reaches the transfer host, the handles, the registry of transfers, the
//   clipboard or main's callbacks.
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
const { Transfers } = require('../src/core/transfers.js');

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dropgate-channels-'));
after(() => fs.rmSync(folder, { recursive: true, force: true }));
const FILE = path.join(folder, 'Secret plans é.bin');
fs.writeFileSync(FILE, Buffer.alloc(1000, 1));

const WINDOW_CHANNELS = Object.values(IPC).filter((channel) => !PUSHES.includes(channel));
const ENGINE_CHANNELS = Object.values(ENGINE).filter((channel) => !ENGINE_PUSHES.includes(channel));
const OPTIONS = { lifetime: { value: 24, unit: 'hours' }, maxDownloads: 1, encrypt: true };
const SERVER = { url: 'https://dropgate.test', allowInsecure: false };
const SETTINGS = { serverURL: 'https://dropgate.test', lifetimeValue: 24, lifetimeUnit: 'hours', maxDownloads: 1 };
const SNAPSHOT = {
    status: 'uploading', phase: 'chunk', text: 'Uploading chunk 1 of 3...', percent: 33.3,
    processedBytes: 5_242_880, totalBytes: 12_000_000, fileIndex: 0, totalFiles: 1, canPause: true, deadline: null,
};

/**
 * Both sets of channels, answered as main answers them, with everything they
 * act on recording what it's asked to do in `work`.
 */
function setUp({ settings = SETTINGS } = {}) {
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
    const transfers = new Transfers({ atOnce: 3, start: record('run'), resume: record('resumeQueued') });
    const transferHost = {
        check: record('host.check', Promise.resolve({ ok: true })),
    };

    const { answerWindowChannels } = main.load('../src/window-channels.js');
    answerWindowChannels({
        kit: main.kit,
        handles,
        transfers,
        host: () => transferHost,
        windowReady: record('windowReady'),
        start: record('start'),
        pause: record('pause', Promise.resolve({})),
        resume: record('resume', Promise.resolve({})),
        cancel: record('cancel'),
        delete: record('delete', Promise.resolve({})),
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
    return { main, work, handles, transfers, host };
}

/** Each payload, invoked on a channel from a page, is refused with this message, and nothing is done. */
async function refusesAll({ main, work, transfers }, channel, page, payloads, message) {
    for (const args of payloads) {
        const before = { work: work.length, transfers: transfers.list().length };
        await assert.rejects(main.invoke(channel, page, ...args), message, `${channel} with ${describe(args)}`);
        assert.deepEqual(work.slice(before.work), [], `what was done for ${channel} with ${describe(args)}`);
        assert.equal(transfers.list().length, before.transfers, `main's transfers after ${channel} with ${describe(args)}`);
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

test('transfer:add-upload takes handles this window holds, and nothing else: its options are the server\'s settings for new uploads', async () => {
    const setup = setUp({ settings: { ...SETTINGS, lifetimeValue: 0.5, lifetimeUnit: 'hours', maxDownloads: 3 } });
    const page = setup.main.windowPage();
    const { files: [mine] } = await setup.main.invoke(IPC.FILES_ADD, page, [FILE]);
    const { files: [theirs] } = await setup.main.invoke(IPC.FILES_ADD, setup.main.windowPage(), [FILE]);
    const upload = (change) => ({ files: [mine.handle], ...change });

    await refusesAll(setup, IPC.TRANSFER_ADD_UPLOAD, page, [
        [], [[mine.handle]], [upload({ files: [] })], [upload({ files: mine.handle })], [upload({ files: [FILE] })],
        [upload({ files: ['not a handle'] })], [upload({ files: [42] })], [upload({ files: [mine.handle, mine.handle] })],
        [upload({ server: 'https://elsewhere.test' })], [upload({ options: OPTIONS })],
    ], /Expected files to upload\./);
    await refusesAll(setup, IPC.TRANSFER_ADD_UPLOAD, page, [[upload({ files: [randomUUID()] })], [upload({ files: [mine.handle, theirs.handle] })]],
        /Expected files handed to this window\./);

    const { id } = await setup.main.invoke(IPC.TRANSFER_ADD_UPLOAD, page, upload());
    assert.deepEqual(setup.transfers.get(id), {
        id,
        kind: 'upload',
        owner: page.sender.id,
        files: [{ path: FILE, name: 'Secret plans é.bin', size: 1000, mtimeMs: fs.statSync(FILE).mtimeMs }],
        options: { lifetime: { value: 0.5, unit: 'hours' }, maxDownloads: 3 },
        state: 'waiting',
        started: false,
        snapshot: null,
        resumeWhenFree: false,
        resuming: false,
        link: null,
        message: null,
        deletable: false,
    });

    // Unlimited is a lifetime of 0, whatever value Settings kept beside it.
    const unlimited = setUp({ settings: { ...SETTINGS, lifetimeValue: 24, lifetimeUnit: 'unlimited' } });
    const unlimitedPage = unlimited.main.windowPage();
    const { files: [file] } = await unlimited.main.invoke(IPC.FILES_ADD, unlimitedPage, [FILE]);
    const made = await unlimited.main.invoke(IPC.TRANSFER_ADD_UPLOAD, unlimitedPage, { files: [file.handle] });
    assert.deepEqual(unlimited.transfers.get(made.id).options.lifetime, { value: 0, unit: 'unlimited' });
});

test('transfer:add-files adds files this window holds to its own upload waiting, each once; one started takes none', async () => {
    const setup = setUp();
    const page = setup.main.windowPage();
    const other = setup.main.windowPage();
    const SECOND = path.join(folder, 'Second.bin');
    fs.writeFileSync(SECOND, Buffer.alloc(10, 2));
    const { files: [first, second] } = await setup.main.invoke(IPC.FILES_ADD, page, [FILE, SECOND]);
    const { files: [theirs] } = await setup.main.invoke(IPC.FILES_ADD, other, [SECOND]);
    const { id } = await setup.main.invoke(IPC.TRANSFER_ADD_UPLOAD, page, { files: [first.handle] });
    const { id: theirUpload } = await setup.main.invoke(IPC.TRANSFER_ADD_UPLOAD, other, { files: [theirs.handle] });

    await refusesAll(setup, IPC.TRANSFER_ADD_FILES, page, [
        [], [{ id }], [{ id, files: [] }], [{ id, files: [FILE] }], [{ id, files: [second.handle, second.handle] }], [{ id: FILE, files: [second.handle] }],
        [{ id: randomUUID(), files: [second.handle] }], [{ id: theirUpload, files: [second.handle] }], [{ id, files: [second.handle], extra: 1 }],
    ], /Expected files to add to an upload of this window's\./);
    await refusesAll(setup, IPC.TRANSFER_ADD_FILES, page, [[{ id, files: [theirs.handle] }]], /Expected files handed to this window\./);

    assert.deepEqual(await setup.main.invoke(IPC.TRANSFER_ADD_FILES, page, { id, files: [first.handle, second.handle] }), { added: 1, skipped: 1 });
    assert.deepEqual(setup.transfers.get(id).files.map((file) => file.name), ['Secret plans é.bin', 'Second.bin']);
    setup.transfers.start(id, SERVER);
    assert.deepEqual(await setup.main.invoke(IPC.TRANSFER_ADD_FILES, page, { id, files: [second.handle] }), { started: true });
    assert.equal(setup.transfers.get(id).files.length, 2);
});

test('transfer:remove takes uploads main made, removing those waiting or ended; transfer:retry one failed or cancelled', async () => {
    const setup = setUp();
    const page = setup.main.windowPage();
    const { files: [file] } = await setup.main.invoke(IPC.FILES_ADD, page, [FILE]);
    const add = async () => (await setup.main.invoke(IPC.TRANSFER_ADD_UPLOAD, page, { files: [file.handle] })).id;
    const [waiting, running, failed] = [await add(), await add(), await add()];
    setup.transfers.start(running, SERVER);
    setup.transfers.start(failed, SERVER);
    setup.transfers.ended(failed, { status: 'error', error: 'The server closed the connection.' });

    await refusesAll(setup, IPC.TRANSFER_REMOVE, page, [
        [], [waiting], [{ ids: waiting }], [{ ids: [] }], [{ ids: [waiting, waiting] }], [{ ids: [FILE] }], [{ ids: [randomUUID()] }], [{ ids: [waiting], extra: 1 }],
    ], /Expected uploads\./);
    await refusesAll(setup, IPC.TRANSFER_RETRY, page, [[], [{ id: randomUUID() }], [{ id: FILE }]], /Expected an upload\./);
    await refusesAll(setup, IPC.TRANSFER_RETRY, page, [[{ id: waiting }], [{ id: running }]], /Expected an upload that failed or was cancelled\./);

    await setup.main.invoke(IPC.TRANSFER_RETRY, page, { id: failed });
    assert.equal(setup.transfers.get(failed).state, 'waiting');
    setup.transfers.ended(running, { status: 'cancelled' });
    // One that isn't waiting or ended stays; here, all three can go.
    await setup.main.invoke(IPC.TRANSFER_REMOVE, page, { ids: [waiting, running, failed] });
    assert.deepEqual(setup.transfers.list(), []);
});

test('transfer:set-options takes a lifetime, a download limit and the files kept, for an upload of this window\'s waiting, and nothing else', async () => {
    const setup = setUp();
    const page = setup.main.windowPage();
    const other = setup.main.windowPage();
    const SECOND = path.join(folder, 'Second.bin');
    fs.writeFileSync(SECOND, Buffer.alloc(10, 2));
    const { files: [first, second] } = await setup.main.invoke(IPC.FILES_ADD, page, [FILE, SECOND]);
    const { id } = await setup.main.invoke(IPC.TRANSFER_ADD_UPLOAD, page, { files: [first.handle, second.handle] });
    const { files: [theirs] } = await setup.main.invoke(IPC.FILES_ADD, other, [FILE]);
    const { id: theirUpload } = await setup.main.invoke(IPC.TRANSFER_ADD_UPLOAD, other, { files: [theirs.handle] });
    const started = (await setup.main.invoke(IPC.TRANSFER_ADD_UPLOAD, page, { files: [first.handle] })).id;
    setup.transfers.start(started, SERVER);
    const share = setup.transfers.add({ owner: null, share: {}, server: SERVER, files: [], options: OPTIONS });
    share.ask = { owner: page.sender.id };
    const before = structuredClone(setup.transfers.get(id).options);

    await refusesAll(setup, IPC.TRANSFER_SET_OPTIONS, page, [
        [], [{ id }], [{ options: { maxDownloads: 2 } }], [{ id: FILE, options: { maxDownloads: 2 } }], [{ id: randomUUID(), options: { maxDownloads: 2 } }],
        [{ id: theirUpload, options: { maxDownloads: 2 } }], [{ id: started, options: { maxDownloads: 2 } }], [{ id: share.id, options: { maxDownloads: 2 } }],
        [{ id, options: { maxDownloads: 2 }, extra: 1 }],
    ], /Expected an upload of this window's waiting to start\./);
    await refusesAll(setup, IPC.TRANSFER_SET_OPTIONS, page, [
        [{ id, options: {} }], [{ id, options: null }], [{ id, options: 'all' }], [{ id, options: { encrypt: false } }], [{ id, options: { server: 'https://elsewhere.test' } }],
    ], /Expected an upload's options\./);
    await refusesAll(setup, IPC.TRANSFER_SET_OPTIONS, page, [
        [{ id, options: { lifetime: 24 } }], [{ id, options: { lifetime: { value: 24 } } }], [{ id, options: { lifetime: { value: 24, unit: 'weeks' } } }],
        [{ id, options: { lifetime: { value: 0, unit: 'hours' } } }], [{ id, options: { lifetime: { value: -1, unit: 'hours' } } }],
        [{ id, options: { lifetime: { value: Infinity, unit: 'days' } } }], [{ id, options: { lifetime: { value: 2 ** 53, unit: 'days' } } }],
        [{ id, options: { lifetime: { value: 7, unit: 'unlimited' } } }], [{ id, options: { lifetime: { value: '24', unit: 'hours' } } }],
    ], /Expected a file lifetime\./);
    await refusesAll(setup, IPC.TRANSFER_SET_OPTIONS, page, [
        [{ id, options: { maxDownloads: -1 } }], [{ id, options: { maxDownloads: 1.5 } }], [{ id, options: { maxDownloads: 2 ** 53 } }], [{ id, options: { maxDownloads: '5' } }],
    ], /Expected a download limit\./);
    await refusesAll(setup, IPC.TRANSFER_SET_OPTIONS, page, [
        [{ id, options: { files: [] } }], [{ id, options: { files: [2] } }], [{ id, options: { files: [1, 0] } }], [{ id, options: { files: [0, 0] } }],
        [{ id, options: { files: [-1] } }], [{ id, options: { files: [0.5] } }], [{ id, options: { files: [first.handle] } }], [{ id, options: { files: [FILE] } }],
        [{ id, options: { files: 0 } }],
    ], /Expected the files it keeps\./);
    assert.deepEqual(setup.transfers.get(id).options, before, 'nothing refused changed it');

    await setup.main.invoke(IPC.TRANSFER_SET_OPTIONS, page, { id, options: { lifetime: { value: 3, unit: 'days' }, maxDownloads: 10, files: [1] } });
    assert.deepEqual(setup.transfers.get(id).options, { lifetime: { value: 3, unit: 'days' }, maxDownloads: 10 });
    assert.deepEqual(setup.transfers.get(id).files.map((file) => file.name), ['Second.bin']);
    await setup.main.invoke(IPC.TRANSFER_SET_OPTIONS, page, { id, options: { lifetime: { value: 0, unit: 'unlimited' } } });
    assert.deepEqual(setup.transfers.get(id).options, { lifetime: { value: 0, unit: 'unlimited' }, maxDownloads: 10 });
});

test('transfer:delete takes one upload main made, by its ID', async () => {
    const setup = setUp();
    const page = setup.main.windowPage();
    const { id } = setup.transfers.add({ owner: null, files: [], options: OPTIONS });
    await refusesAll(setup, IPC.TRANSFER_DELETE, page, [
        [], [id], [{ id: 42 }], [{ id: FILE }], [{ id: randomUUID() }], [{ id, manageToken: 'x'.repeat(43) }], [{ ids: [id] }],
    ], /Expected an upload\./);
    assert.deepEqual(await setup.main.invoke(IPC.TRANSFER_DELETE, page, { id }), {});
    assert.deepEqual(setup.work.at(-1), ['delete', id]);
});

test('transfer:start takes uploads waiting that this window made, or a share it was asked about, and checks them all first', async () => {
    const setup = setUp();
    const page = setup.main.windowPage();
    const other = setup.main.windowPage();
    const add = async (from) => {
        const { files: [file] } = await setup.main.invoke(IPC.FILES_ADD, from, [FILE]);
        return (await setup.main.invoke(IPC.TRANSFER_ADD_UPLOAD, from, { files: [file.handle] })).id;
    };
    const mine = await add(page);
    const theirs = await add(other);
    const started = await add(page);
    setup.transfers.start(started, SERVER);
    const share = (owner) => {
        const card = setup.transfers.add({ owner: null, share: {}, server: SERVER, files: [], options: OPTIONS });
        card.ask = { owner };
        return card.id;
    };
    const asked = share(page.sender.id);
    const askedOfOther = share(other.sender.id);
    setup.work.length = 0;

    await refusesAll(setup, IPC.TRANSFER_START, page, [
        [], [[mine]], [{ ids: mine }], [{ ids: [] }], [{ ids: [mine, mine] }], [{ ids: [FILE] }], [{ ids: [randomUUID()] }],
        [{ ids: [mine, theirs] }], [{ ids: [started] }], [{ ids: [askedOfOther] }], [{ ids: [mine], server: 'https://elsewhere.test' }],
        [{ ids: [mine], encrypt: 'yes' }], [{ ids: [mine], encrypt: null }],
    ], /Expected uploads waiting to start\./);
    // The window's own: it says whether they're end-to-end encrypted, as it found the server.
    await refusesAll(setup, IPC.TRANSFER_START, page, [[{ ids: [mine] }], [{ ids: [mine, asked] }]], /Expected whether to encrypt\./);

    await setup.main.invoke(IPC.TRANSFER_START, page, { ids: [mine, asked], encrypt: true });
    assert.deepEqual(setup.work.slice(-2), [['start', mine, SERVER], ['start', asked, SERVER]]);
    assert.equal(setup.transfers.get(mine).options.encrypt, true);
    assert.equal(setup.transfers.get(asked).options.encrypt, OPTIONS.encrypt, "a share's is the share's");

    // A share asked about alone needs no word on encryption: it decided its own.
    const alone = share(page.sender.id);
    setup.transfers.get(alone).options = { ...OPTIONS, encrypt: false };
    await setup.main.invoke(IPC.TRANSFER_START, page, { ids: [alone] });
    assert.equal(setup.transfers.get(alone).options.encrypt, false);

    // With no server in Settings, a window's own upload has nowhere to go: refused before any starts.
    const unset = setUp({ settings: { ...SETTINGS, serverURL: '' } });
    const unsetPage = unset.main.windowPage();
    const { files: [file] } = await unset.main.invoke(IPC.FILES_ADD, unsetPage, [FILE]);
    const { id } = await unset.main.invoke(IPC.TRANSFER_ADD_UPLOAD, unsetPage, { files: [file.handle] });
    await refusesAll(unset, IPC.TRANSFER_START, unsetPage, [[{ ids: [id], encrypt: false }]], /Server URL is not configured\./);
});

test('transfer:pause, transfer:resume and transfer:cancel take one upload main made, by its ID', async () => {
    const setup = setUp();
    const page = setup.main.windowPage();
    const { id } = setup.transfers.add({ owner: null, files: [], options: OPTIONS });
    for (const channel of [IPC.TRANSFER_PAUSE, IPC.TRANSFER_RESUME, IPC.TRANSFER_CANCEL]) {
        await refusesAll(setup, channel, page, [
            [], [id], [{ id: 42 }], [{ id: FILE }], [{ id: randomUUID() }], [{ id: id.toUpperCase() }], [{ id, extra: true }], [{ ids: [id] }],
        ], /Expected an upload\./);
    }
    await setup.main.invoke(IPC.TRANSFER_PAUSE, page, { id });
    await setup.main.invoke(IPC.TRANSFER_RESUME, page, { id });
    await setup.main.invoke(IPC.TRANSFER_CANCEL, page, { id });
    assert.deepEqual(setup.work.slice(-3), [['pause', id], ['resume', id], ['cancel', id]]);
});

test('transfers:list gives every transfer as the window draws it: names and sizes, never a path', async () => {
    const setup = setUp();
    const page = setup.main.windowPage();
    const { files: [file] } = await setup.main.invoke(IPC.FILES_ADD, page, [FILE]);
    const { id } = await setup.main.invoke(IPC.TRANSFER_ADD_UPLOAD, page, { files: [file.handle] });
    await setup.main.invoke(IPC.TRANSFER_START, page, { ids: [id], encrypt: true });
    setup.transfers.start(id, SERVER);
    setup.transfers.updated(id, SNAPSHOT);
    const list = await setup.main.invoke(IPC.TRANSFERS_LIST, page);
    assert.deepEqual(list, [{
        id, kind: 'upload', state: 'running', files: [{ name: 'Secret plans é.bin', size: 1000 }], status: 'uploading',
        step: SNAPSHOT.text, phase: 'chunk', percent: 33.3, fileIndex: 0, canPause: true, deadline: null,
        options: { lifetime: { value: 24, unit: 'hours' }, maxDownloads: 1, encrypt: true }, link: null, message: null, canDelete: false,
    }]);
    assert.doesNotMatch(JSON.stringify(list), new RegExp(path.basename(folder)), 'no folder in what the window gets');
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
    // Its idle timer would hold the test open.
    host.close();
});
