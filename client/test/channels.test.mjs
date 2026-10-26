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
const { ServerChecks, Servers } = require('../src/core/servers.js');
const { Transfers, view } = require('../src/core/transfers.js');

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dropgate-channels-'));
after(() => fs.rmSync(folder, { recursive: true, force: true }));
const FILE = path.join(folder, 'Secret plans é.bin');
fs.writeFileSync(FILE, Buffer.alloc(1000, 1));

const WINDOW_CHANNELS = Object.values(IPC).filter((channel) => !PUSHES.includes(channel));
const ENGINE_CHANNELS = Object.values(ENGINE).filter((channel) => !ENGINE_PUSHES.includes(channel));
const OPTIONS = { lifetime: { value: 24, unit: 'hours' }, maxDownloads: 1, encrypt: true };
const SERVER = { url: 'https://dropgate.test', allowInsecure: false };
/** A saved server, as core/servers.js keeps it, and the settings with it saved as the default. */
const saved = (change = {}) => ({ id: randomUUID(), url: 'https://dropgate.test', name: 'dropgate.test', lifetime: { value: 24, unit: 'hours' }, maxDownloads: 1, allowFallback: false, ...change });
const savedAsDefault = (server) => ({ servers: [server], defaultServer: server.id });
const SETTINGS = savedAsDefault(saved());
/** A server check that found a Dropgate server. */
const FOUND = {
    ok: true, baseUrl: 'https://dropgate.test', serverVersion: '4.0.0',
    serverInfo: { name: 'Example Drop', version: '4.0.0', capabilities: { upload: { enabled: true, e2ee: true, maxLifetimeHours: 6, maxFileDownloads: 5 } } },
    dgup: { compatible: true, message: 'Compatible.' },
};
/** A folder the window chose with the system's picker, by the ID main made for it. */
const CHOSEN = randomUUID();
const SNAPSHOT = {
    status: 'uploading', phase: 'chunk', text: 'Uploading chunk 1 of 3...', percent: 33.3,
    processedBytes: 5_242_880, totalBytes: 12_000_000, fileIndex: 0, totalFiles: 1, canPause: true, deadline: null,
};

/**
 * Both sets of channels, answered as main answers them, with everything they
 * act on recording what it's asked to do in `work`.
 */
function setUp({ settings = SETTINGS, check = { ok: true } } = {}) {
    const main = fakeMain({ settings });
    const work = [];
    // The kit's settings, as main's server list reads and writes them.
    let current = structuredClone(settings);
    const servers = new Servers({ get: () => current, set: (changes) => { current = { ...current, ...changes }; return current; } });
    const checks = new ServerChecks();
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
        check: record('host.check', Promise.resolve(check)),
    };

    const { answerWindowChannels } = main.load('../src/window-channels.js');
    answerWindowChannels({
        kit: main.kit,
        handles,
        transfers,
        servers,
        checks,
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
        addDownload: record('addDownload', { id: randomUUID() }),
        saveTo: record('saveTo'),
        show: record('show'),
        chooseFolder: record('chooseFolder', Promise.resolve(null)),
        chose: (_owner, chosen) => chosen === CHOSEN,
        defaultFolder: record('defaultFolder', { path: folder, label: 'Downloads', chosen: false }),
        setDefaultFolder: record('setDefaultFolder', { path: folder, label: 'Downloads', chosen: false }),
    });

    const { createTransferHost } = main.load('../src/transfer-host.js');
    const host = createTransferHost({
        kit: main.kit,
        appInfo: { name: 'Dropgate Client', version: '4.0.0' },
        onUpdate: record('onUpdate'),
        onPauseEnding: record('onPauseEnding'),
        onFinished: record('onFinished'),
    });
    return { main, work, handles, transfers, host, servers, checks, stored: () => current };
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

test('transfer:add-upload takes handles this window holds, and nothing else: its options are the default server\'s settings for new uploads', async () => {
    const setup = setUp({ settings: savedAsDefault(saved({ lifetime: { value: 0.5, unit: 'hours' }, maxDownloads: 3 })) });
    const page = setup.main.windowPage();
    const { files: [mine] } = await setup.main.invoke(IPC.FILES_ADD, page, [FILE]);
    const { files: [theirs] } = await setup.main.invoke(IPC.FILES_ADD, setup.main.windowPage(), [FILE]);
    const upload = (change) => ({ files: [mine.handle], ...change });

    await refusesAll(setup, IPC.TRANSFER_ADD_UPLOAD, page, [
        [], [[mine.handle]], [upload({ files: [] })], [upload({ files: mine.handle })], [upload({ files: [FILE] })],
        [upload({ files: ['not a handle'] })], [upload({ files: [42] })], [upload({ files: [mine.handle, mine.handle] })],
        [upload({ options: OPTIONS })],
    ], /Expected files to upload\./);
    // Its server, if given, is a saved one, by its ID: never an address.
    await refusesAll(setup, IPC.TRANSFER_ADD_UPLOAD, page, [
        [upload({ server: 'https://elsewhere.test' })], [upload({ server: randomUUID() })], [upload({ server: FILE })], [upload({ server: null })],
    ], /Expected a saved server\./);
    await refusesAll(setup, IPC.TRANSFER_ADD_UPLOAD, page, [[upload({ files: [randomUUID()] })], [upload({ files: [mine.handle, theirs.handle] })]],
        /Expected files handed to this window\./);

    const { id } = await setup.main.invoke(IPC.TRANSFER_ADD_UPLOAD, page, upload());
    const [server] = setup.stored().servers;
    assert.deepEqual(setup.transfers.get(id), {
        id,
        kind: 'upload',
        owner: page.sender.id,
        files: [{ path: FILE, name: 'Secret plans é.bin', size: 1000, mtimeMs: fs.statSync(FILE).mtimeMs }],
        savedServer: { id: server.id, name: 'dropgate.test', host: 'dropgate.test' },
        options: { lifetime: { value: 0.5, unit: 'hours' }, maxDownloads: 3, allowFallback: false },
        state: 'waiting',
        started: false,
        snapshot: null,
        resumeWhenFree: false,
        resuming: false,
        link: null,
        message: null,
        deletable: false,
    });

    // Unlimited is a lifetime of 0, whatever value was kept beside it.
    const unlimited = setUp({ settings: savedAsDefault(saved({ lifetime: { value: 24, unit: 'unlimited' } })) });
    const unlimitedPage = unlimited.main.windowPage();
    const { files: [file] } = await unlimited.main.invoke(IPC.FILES_ADD, unlimitedPage, [FILE]);
    const made = await unlimited.main.invoke(IPC.TRANSFER_ADD_UPLOAD, unlimitedPage, { files: [file.handle] });
    assert.deepEqual(unlimited.transfers.get(made.id).options.lifetime, { value: 0, unit: 'unlimited' });

    // With no server saved, a new server's: 24 hours, 1 download.
    const none = setUp({ settings: { servers: [], defaultServer: null } });
    const nonePage = none.main.windowPage();
    const { files: [alone] } = await none.main.invoke(IPC.FILES_ADD, nonePage, [FILE]);
    const waiting = await none.main.invoke(IPC.TRANSFER_ADD_UPLOAD, nonePage, { files: [alone.handle] });
    assert.deepEqual(none.transfers.get(waiting.id).options, { lifetime: { value: 24, unit: 'hours' }, maxDownloads: 1, allowFallback: false });
    assert.equal(none.transfers.get(waiting.id).savedServer, null);
});

test('transfer:add-upload on a saved server given, by its ID, takes that server\'s settings for new uploads', async () => {
    const [first, second] = [saved({ url: 'https://one.test', name: 'One' }), saved({ url: 'http://two.test:8080', name: 'Two', lifetime: { value: 3, unit: 'days' }, maxDownloads: 0 })];
    const setup = setUp({ settings: { servers: [first, second], defaultServer: first.id } });
    const page = setup.main.windowPage();
    const { files: [file] } = await setup.main.invoke(IPC.FILES_ADD, page, [FILE]);
    const { id } = await setup.main.invoke(IPC.TRANSFER_ADD_UPLOAD, page, { files: [file.handle], server: second.id });
    const card = setup.transfers.get(id);
    assert.deepEqual([card.savedServer, card.options], [{ id: second.id, name: 'Two', host: 'two.test:8080' }, { lifetime: { value: 3, unit: 'days' }, maxDownloads: 0, allowFallback: false }]);
    assert.equal(card.server, undefined, 'where it goes is read from its saved server as it starts');
    assert.deepEqual(setup.work.filter(([name]) => name === 'host.check'), [], 'nothing asked of any server');
});

test('server:add takes a server\'s address, checks it in the transfer window, and saves it once it answers as a Dropgate server, under the address it was found at', async () => {
    const setup = setUp({ settings: { servers: [], defaultServer: null }, check: FOUND });
    const page = setup.main.windowPage();
    await refusesAll(setup, IPC.SERVER_ADD, page, [
        [], ['https://dropgate.test'], [{ url: FILE }], [{ url: 'file:///etc/passwd' }], [{ url: 'https://dropgate.test', name: 'Mine' }], [{ url: '' }],
    ], /Expected a server address./);
    assert.deepEqual(setup.stored().servers, [], 'nothing refused was saved');

    const added = await setup.main.invoke(IPC.SERVER_ADD, page, { url: 'dropgate.test' });
    assert.deepEqual(setup.work.at(-1), ['host.check', { url: 'dropgate.test', allowInsecure: false }]);
    assert.deepEqual(added.check, FOUND, 'the page is told what the check found');
    // Its name, its address as found, and a new server's settings within its limits (6 hours here): nothing else the check found.
    assert.deepEqual(added.server, { id: added.server.id, url: 'https://dropgate.test', name: 'Example Drop', lifetime: { value: 6, unit: 'hours' }, maxDownloads: 1, allowFallback: false });
    assert.deepEqual(setup.stored(), { servers: [added.server], defaultServer: added.server.id }, 'the first saved is the default');
    assert.deepEqual({ servers: added.servers, defaultServer: added.defaultServer }, setup.stored());
    assert.deepEqual(added.checks, { [added.server.id]: FOUND }, 'what its check found, in memory');

    // Saved already, by its address: given back as it is, never twice.
    const again = await setup.main.invoke(IPC.SERVER_ADD, page, { url: 'https://dropgate.test' });
    assert.equal(again.server.id, added.server.id);
    assert.equal(setup.stored().servers.length, 1);

    // A server that couldn't be reached, or isn't a Dropgate server, isn't saved: the page is told why.
    // Nor one the transfer window says was found at an address that isn't one.
    for (const check of [{ ok: false, code: 'NETWORK', message: 'fetch failed' }, { ...FOUND, serverInfo: null }, { ok: true }, { ...FOUND, baseUrl: FILE }, { ...FOUND, baseUrl: 'file:///etc' }, { ...FOUND, baseUrl: 42 }]) {
        const elsewhere = setUp({ settings: { servers: [], defaultServer: null }, check });
        const answer = await elsewhere.main.invoke(IPC.SERVER_ADD, elsewhere.main.windowPage(), { url: 'https://elsewhere.test' });
        assert.deepEqual([answer.check, answer.server, answer.servers], [check, undefined, []], JSON.stringify(check));
    }
});

test('server:test checks a saved server, by its ID, at its saved address; main keeps what it found in memory only, and every list answer says it until the server goes', async () => {
    const [first, second] = [saved({ url: 'https://one.test' }), saved({ url: 'http://two.test' })];
    const setup = setUp({ settings: { servers: [first, second], defaultServer: first.id }, check: FOUND });
    const page = setup.main.windowPage();
    await refusesAll(setup, IPC.SERVER_TEST, page, [
        [], [first.id], [{ id: FILE }], [{ id: randomUUID() }], [{ id: 'not an ID' }], [{ id: first.id, url: 'https://elsewhere.test' }], [{ url: 'https://one.test' }],
    ], /Expected a saved server./);

    const tested = await setup.main.invoke(IPC.SERVER_TEST, page, { id: second.id });
    assert.deepEqual(setup.work.at(-1), ['host.check', { url: 'http://two.test', allowInsecure: true }], 'its saved address, never one from the page');
    assert.deepEqual(tested, { check: FOUND, servers: [first, second], defaultServer: first.id, checks: { [second.id]: FOUND } });
    assert.deepEqual(setup.stored(), { servers: [first, second], defaultServer: first.id }, 'nothing a check found is written');
    for (const [channel, request] of [[IPC.SERVER_MOVE, { id: second.id, by: -1 }], [IPC.SERVER_SET_DEFAULT, { id: second.id }], [IPC.SERVER_SET_OPTIONS, { id: first.id, options: { maxDownloads: 2 } }]]) {
        assert.deepEqual((await setup.main.invoke(channel, page, request)).checks, { [second.id]: FOUND }, channel);
    }
    // A removed server's check goes with it.
    assert.deepEqual((await setup.main.invoke(IPC.SERVER_REMOVE, page, { id: second.id })).checks, {});
    assert.equal(setup.checks.get(second.id), null);

    // Nor is one kept for a server removed while it was checked.
    let answer;
    const slow = setUp({ settings: { servers: [first], defaultServer: first.id }, check: new Promise((resolve) => { answer = resolve; }) });
    const slowPage = slow.main.windowPage();
    const testing = slow.main.invoke(IPC.SERVER_TEST, slowPage, { id: first.id });
    await slow.main.invoke(IPC.SERVER_REMOVE, slowPage, { id: first.id });
    answer(FOUND);
    assert.deepEqual(await testing, { check: FOUND, servers: [], defaultServer: null, checks: {} });
    assert.equal(slow.checks.get(first.id), null);
});

test('server:remove, server:move, server:set-default and server:set-options take a saved server, by its ID, and main changes the list', async () => {
    const [first, second, third] = [saved({ url: 'https://one.test' }), saved({ url: 'https://two.test' }), saved({ url: 'http://three.test' })];
    const setup = setUp({ settings: { servers: [first, second, third], defaultServer: first.id } });
    const page = setup.main.windowPage();
    const ids = (list) => list.servers.map((server) => server.id);
    const known = [[], [first.id], [{ id: FILE }], [{ id: randomUUID() }], [{ id: 'not an ID' }], [{ id: first.id, url: 'https://one.test' }]];
    await refusesAll(setup, IPC.SERVER_REMOVE, page, known, /Expected a saved server./);
    await refusesAll(setup, IPC.SERVER_SET_DEFAULT, page, known, /Expected a saved server./);
    await refusesAll(setup, IPC.SERVER_MOVE, page, [
        [{ id: first.id }], [{ id: first.id, by: 2 }], [{ id: first.id, by: 0 }], [{ id: first.id, by: '1' }], [{ id: randomUUID(), by: 1 }], [{ id: first.id, by: 1, to: 2 }],
    ], /Expected a saved server, and which way it moves./);
    await refusesAll(setup, IPC.SERVER_SET_OPTIONS, page, [[{ id: first.id }], [{ id: randomUUID(), options: { maxDownloads: 2 } }]], /Expected a saved server./);
    await refusesAll(setup, IPC.SERVER_SET_OPTIONS, page, [
        [{ id: first.id, options: {} }], [{ id: first.id, options: { url: 'https://elsewhere.test' } }], [{ id: first.id, options: { name: 'Mine' } }],
    ], /Expected a server's settings for new uploads./);
    await refusesAll(setup, IPC.SERVER_SET_OPTIONS, page, [
        [{ id: first.id, options: { lifetime: { value: -1, unit: 'hours' } } }], [{ id: first.id, options: { lifetime: { value: 1, unit: 'weeks' } } }],
    ], /Expected a file lifetime./);
    await refusesAll(setup, IPC.SERVER_SET_OPTIONS, page, [[{ id: first.id, options: { maxDownloads: 1.5 } }], [{ id: first.id, options: { maxDownloads: -1 } }]],
        /Expected a download limit./);
    await refusesAll(setup, IPC.SERVER_SET_OPTIONS, page, [[{ id: first.id, options: { allowFallback: 'yes' } }]], /Expected whether to allow fallback./);
    assert.deepEqual(setup.stored(), { servers: [first, second, third], defaultServer: first.id }, 'nothing refused was saved');

    assert.deepEqual(ids(await setup.main.invoke(IPC.SERVER_MOVE, page, { id: first.id, by: -1 })), [first.id, second.id, third.id], "the first can't go up");
    assert.deepEqual(ids(await setup.main.invoke(IPC.SERVER_MOVE, page, { id: first.id, by: 1 })), [second.id, first.id, third.id]);
    assert.deepEqual(ids(await setup.main.invoke(IPC.SERVER_MOVE, page, { id: third.id, by: 1 })), [second.id, first.id, third.id], "the last can't go down");
    assert.equal((await setup.main.invoke(IPC.SERVER_SET_DEFAULT, page, { id: third.id })).defaultServer, third.id);
    const changed = await setup.main.invoke(IPC.SERVER_SET_OPTIONS, page, { id: second.id, options: { lifetime: { value: 3, unit: 'days' }, maxDownloads: 0, allowFallback: true } });
    assert.deepEqual(changed.servers[0], { ...second, lifetime: { value: 3, unit: 'days' }, maxDownloads: 0, allowFallback: true });
    // The default removed: its place goes to the first left.
    const left = await setup.main.invoke(IPC.SERVER_REMOVE, page, { id: third.id });
    assert.deepEqual([ids(left), left.defaultServer], [[second.id, first.id], second.id]);
    assert.deepEqual(setup.stored(), { servers: left.servers, defaultServer: left.defaultServer });
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
    await refusesAll(setup, IPC.TRANSFER_RETRY, page, [[{ id: waiting }], [{ id: running }]], /Expected an upload or a download that failed or was cancelled\./);

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
        [{ id, options: {} }], [{ id, options: null }], [{ id, options: 'all' }], [{ id, options: { encrypt: false } }],
        [{ id, options: { server: SETTINGS.defaultServer, maxDownloads: 2 } }],
    ], /Expected an upload's options\./);
    await refusesAll(setup, IPC.TRANSFER_SET_OPTIONS, page, [
        [{ id, options: { server: 'https://elsewhere.test' } }], [{ id, options: { server: randomUUID() } }], [{ id, options: { server: FILE } }],
    ], /Expected a saved server\./);
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
    assert.deepEqual(setup.transfers.get(id).options, { lifetime: { value: 3, unit: 'days' }, maxDownloads: 10, allowFallback: false });
    assert.deepEqual(setup.transfers.get(id).files.map((file) => file.name), ['Second.bin']);
    await setup.main.invoke(IPC.TRANSFER_SET_OPTIONS, page, { id, options: { lifetime: { value: 0, unit: 'unlimited' } } });
    assert.deepEqual(setup.transfers.get(id).options, { lifetime: { value: 0, unit: 'unlimited' }, maxDownloads: 10, allowFallback: false });
});

test('an upload\'s "To" is a saved server, by its ID: it takes that server\'s settings, starts there, and main holds the page\'s word on encryption to each server\'s last check', async () => {
    const one = saved({ url: 'https://one.test', name: 'One' });
    const two = saved({ url: 'http://two.test', name: 'Two', lifetime: { value: 30, unit: 'minutes' }, maxDownloads: 4 });
    const setup = setUp({ settings: { servers: [one, two], defaultServer: one.id } });
    const page = setup.main.windowPage();
    const { files: [file] } = await setup.main.invoke(IPC.FILES_ADD, page, [FILE]);
    const add = async () => (await setup.main.invoke(IPC.TRANSFER_ADD_UPLOAD, page, { files: [file.handle] })).id;
    const [first, second] = [await add(), await add()];
    await setup.main.invoke(IPC.TRANSFER_SET_OPTIONS, page, { id: first, options: { maxDownloads: 5 } });

    // Picked: it takes that server's settings for new uploads, whatever it had.
    await setup.main.invoke(IPC.TRANSFER_SET_OPTIONS, page, { id: first, options: { server: two.id } });
    assert.deepEqual([setup.transfers.get(first).savedServer, setup.transfers.get(first).options],
        [{ id: two.id, name: 'Two', host: 'two.test' }, { lifetime: { value: 30, unit: 'minutes' }, maxDownloads: 4, allowFallback: false }]);
    assert.deepEqual(view(setup.transfers.get(first)).server, { id: two.id, name: 'Two', host: 'two.test' });
    assert.deepEqual(setup.work.filter(([name]) => name === 'host.check'), [], 'picking it asks no server anything: the page asks for its check');

    // Each starts on its own server, read from the saved list.
    await setup.main.invoke(IPC.TRANSFER_START, page, { ids: [first], encrypt: false });
    await setup.main.invoke(IPC.TRANSFER_START, page, { ids: [second], encrypt: true });
    assert.deepEqual(setup.work.filter(([name]) => name === 'start'), [
        ['start', first, { url: 'http://two.test', allowInsecure: true }],
        ['start', second, { url: 'https://one.test', allowInsecure: false }],
    ]);
    // Started, its server is sealed.
    setup.transfers.start(first, setup.transfers.get(first).server);
    await refusesAll(setup, IPC.TRANSFER_SET_OPTIONS, page, [[{ id: first, options: { server: one.id } }]], /Expected an upload of this window's waiting to start\./);

    // With a check of its server in main's memory, the page's word on encryption must agree with it.
    const plain = await add();
    const secure = await add();
    await setup.main.invoke(IPC.TRANSFER_SET_OPTIONS, page, { id: plain, options: { server: two.id } });
    setup.checks.set(one.id, FOUND);
    setup.checks.set(two.id, { ...FOUND, baseUrl: 'http://two.test' });
    await refusesAll(setup, IPC.TRANSFER_START, page, [[{ ids: [secure], encrypt: false }]], /One was checked again since: Try again\./);
    await refusesAll(setup, IPC.TRANSFER_START, page, [[{ ids: [plain], encrypt: true }], [{ ids: [plain, secure], encrypt: true }]], /Two was checked again since: Try again\./);
    assert.equal(setup.transfers.get(secure).state, 'waiting');
    await setup.main.invoke(IPC.TRANSFER_START, page, { ids: [secure], encrypt: true });
    assert.equal(setup.transfers.get(secure).options.encrypt, true);
});

test('a removed server\'s uploads waiting go to the default, with its settings; so do those made with none saved once one is, and one tried again whose server went', async () => {
    const one = saved({ url: 'https://one.test', name: 'One' });
    const two = saved({ url: 'https://two.test', name: 'Two', maxDownloads: 4 });
    const setup = setUp({ settings: { servers: [one, two], defaultServer: one.id }, check: FOUND });
    const page = setup.main.windowPage();
    const { files: [file] } = await setup.main.invoke(IPC.FILES_ADD, page, [FILE]);
    const add = async (server) => (await setup.main.invoke(IPC.TRANSFER_ADD_UPLOAD, page, { files: [file.handle], server })).id;
    const [waiting, running, failed] = [await add(two.id), await add(two.id), await add(two.id)];
    setup.transfers.start(running, SERVER);
    setup.transfers.start(failed, SERVER);
    setup.transfers.ended(failed, { status: 'error', error: 'The server closed the connection.' });

    await setup.main.invoke(IPC.SERVER_REMOVE, page, { id: two.id });
    assert.deepEqual([setup.transfers.get(waiting).savedServer.id, setup.transfers.get(waiting).options.maxDownloads], [one.id, 1], 'waiting: on the default now');
    assert.equal(setup.transfers.get(running).savedServer.id, two.id, 'under way: it carries on');
    await setup.main.invoke(IPC.TRANSFER_RETRY, page, { id: failed });
    assert.equal(setup.transfers.get(failed).savedServer.id, one.id, 'tried again: on the default');

    const none = setUp({ settings: { servers: [], defaultServer: null }, check: FOUND });
    const nonePage = none.main.windowPage();
    const { files: [alone] } = await none.main.invoke(IPC.FILES_ADD, nonePage, [FILE]);
    const { id } = await none.main.invoke(IPC.TRANSFER_ADD_UPLOAD, nonePage, { files: [alone.handle] });
    const { server } = await none.main.invoke(IPC.SERVER_ADD, nonePage, { url: 'https://dropgate.test' });
    assert.deepEqual(none.transfers.get(id).savedServer, { id: server.id, name: 'Example Drop', host: 'dropgate.test' });
    assert.deepEqual(none.transfers.get(id).options, { lifetime: { value: 6, unit: 'hours' }, maxDownloads: 1, allowFallback: false }, 'the new server\'s settings, within its limits');
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

    // With no server saved, a window's own upload has nowhere to go: refused before any starts.
    const unset = setUp({ settings: { servers: [], defaultServer: null } });
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
        options: { lifetime: { value: 24, unit: 'hours' }, maxDownloads: 1, encrypt: true, allowFallback: false }, link: null, message: null, canDelete: false,
        server: { id: SETTINGS.defaultServer, name: 'dropgate.test', host: 'dropgate.test' }, movedFrom: null, asking: false,
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

const UPLOAD_ID = 'f5aa7a2f-ce3a-4deb-b92f-2da74b6b9bae';
const SECRET = 'CPuytR72dDo2WhXGdB6x6aXlPcJu7Ec0tYvcUn5GL0k';

test('transfer:add-download takes a link to an upload, as Dropgate makes it, and main is told only where it points beside the link to pass on', async () => {
    const setup = setUp();
    const page = setup.main.windowPage();
    const link = `https://dropgate.test/${UPLOAD_ID}#${SECRET}`;
    await refusesAll(setup, IPC.TRANSFER_ADD_DOWNLOAD, page, [
        [], [link], [{ link: 42 }], [{ link, files: [0] }], [{ link: FILE }], [{ link: 'C:\\Users\\will\\file.bin' }], [{ link: `file:///${UPLOAD_ID}` }],
        [{ link: `ftp://dropgate.test/${UPLOAD_ID}` }], [{ link: 'javascript:alert(1)' }], [{ link: 'https://dropgate.test/' }],
        [{ link: 'https://dropgate.test/not-an-upload' }], [{ link: `https://dropgate.test/${UPLOAD_ID}/content` }], [{ link: `https://dropgate.test/b/${UPLOAD_ID}` }],
        [{ link: `https://dropgate.test/p2p#${SECRET}` }], [{ link: `https://dropgate.test/${UPLOAD_ID}?x=1#${SECRET}` }],
        [{ link: `https://user:pass@dropgate.test/${UPLOAD_ID}` }], [{ link: `https://dropgate.test/${UPLOAD_ID}#${SECRET.slice(1)}` }],
        [{ link: `https://dropgate.test/${UPLOAD_ID}#${SECRET}=` }], [{ link: `https://dropgate.test/${UPLOAD_ID}#${'x'.repeat(9_000)}` }],
        [{ link: `https://dropgate.test/${UPLOAD_ID} #${SECRET}` }],
    ], /Expected a link to an upload\./);

    await setup.main.invoke(IPC.TRANSFER_ADD_DOWNLOAD, page, { link });
    await setup.main.invoke(IPC.TRANSFER_ADD_DOWNLOAD, page, { link: `http://192.168.1.2:52443/${UPLOAD_ID.toUpperCase()}` });
    assert.deepEqual(setup.work.slice(-2), [
        ['addDownload', page.sender.id, { link, server: { url: 'https://dropgate.test', allowInsecure: false }, host: 'dropgate.test' }],
        ['addDownload', page.sender.id, { link: `http://192.168.1.2:52443/${UPLOAD_ID.toUpperCase()}`, server: { url: 'http://192.168.1.2:52443', allowInsecure: true }, host: '192.168.1.2:52443' }],
    ]);
});

/** A download of this window's, its list read, waiting. */
function waitingDownload(setup, owner, files = [{ name: 'Secret plans é.bin', size: 1000 }]) {
    const card = setup.transfers.add({ kind: 'download', owner, server: SERVER, host: 'dropgate.test', files: [], options: null, saveTo: { folder: 'default', label: 'Downloads' } });
    setup.transfers.read(card.id, { files, encrypted: true });
    return card.id;
}

test('transfer:save-to takes downloads of this window\'s not started, and the default folder or one this window chose, never a path', async () => {
    const setup = setUp();
    const page = setup.main.windowPage();
    const other = setup.main.windowPage();
    const mine = waitingDownload(setup, page.sender.id);
    const theirs = waitingDownload(setup, other.sender.id);
    const started = waitingDownload(setup, page.sender.id);
    setup.transfers.start(started, SERVER);
    const upload = setup.transfers.add({ owner: page.sender.id, files: [], options: OPTIONS }).id;
    setup.work.length = 0;

    await refusesAll(setup, IPC.TRANSFER_SAVE_TO, page, [
        [], [{ ids: [mine] }], [{ folder: 'default' }], [{ ids: mine, folder: 'default' }], [{ ids: [], folder: 'default' }], [{ ids: [mine, mine], folder: 'default' }],
        [{ ids: [theirs], folder: 'default' }], [{ ids: [started], folder: 'default' }], [{ ids: [upload], folder: 'default' }], [{ ids: [randomUUID()], folder: 'default' }],
        [{ ids: [mine], folder: 'default', path: folder }],
    ], /Expected downloads of this window's waiting to start\./);
    await refusesAll(setup, IPC.TRANSFER_SAVE_TO, page, [
        [{ ids: [mine], folder }], [{ ids: [mine], folder: FILE }], [{ ids: [mine], folder: randomUUID() }], [{ ids: [mine], folder: null }], [{ ids: [mine], folder: 42 }],
    ], /Expected a folder this window chose\./);

    await setup.main.invoke(IPC.TRANSFER_SAVE_TO, page, { ids: [mine], folder: CHOSEN });
    await setup.main.invoke(IPC.TRANSFER_SAVE_TO, page, { ids: [mine], folder: 'default' });
    assert.deepEqual(setup.work, [['saveTo', [mine], CHOSEN, page.sender.id], ['saveTo', [mine], 'default', page.sender.id]]);
});

test('transfer:show takes a finished download that was saved; folder:set-default a folder this window chose, or null; folder:choose and folder:default nothing', async () => {
    const setup = setUp();
    const page = setup.main.windowPage();
    const id = waitingDownload(setup, page.sender.id);
    await refusesAll(setup, IPC.TRANSFER_SHOW, page, [[], [id], [{ id: FILE }], [{ id: randomUUID() }], [{ id, path: FILE }]], /Expected an upload\./);
    await refusesAll(setup, IPC.TRANSFER_SHOW, page, [[{ id }]], /Expected a finished download\./);
    setup.transfers.start(id, SERVER);
    setup.transfers.saved(id, path.join(folder, 'Secret plans é.bin'));
    setup.transfers.ended(id, { status: 'success' });
    setup.work.length = 0;
    await setup.main.invoke(IPC.TRANSFER_SHOW, page, { id });
    assert.deepEqual(setup.work, [['show', id]]);

    await refusesAll(setup, IPC.FOLDER_SET_DEFAULT, page, [
        [], [CHOSEN], [{ folder }], [{ folder: FILE }], [{ folder: randomUUID() }], [{ folder: 'default' }], [{}], [{ folder: CHOSEN, path: folder }],
    ], /Expected a folder this window chose\./);
    assert.deepEqual(await setup.main.invoke(IPC.FOLDER_SET_DEFAULT, page, { folder: CHOSEN }), { path: folder, label: 'Downloads', chosen: false });
    await setup.main.invoke(IPC.FOLDER_SET_DEFAULT, page, { folder: null });
    assert.deepEqual(setup.work.slice(-2), [['setDefaultFolder', page.sender.id, CHOSEN], ['setDefaultFolder', page.sender.id, null]]);

    assert.equal(await setup.main.invoke(IPC.FOLDER_CHOOSE, page), null);
    assert.deepEqual(setup.work.at(-1), ['chooseFolder', page.sender]);
    await setup.main.invoke(IPC.FOLDER_DEFAULT, page);
    assert.deepEqual(setup.work.at(-1), ['defaultFolder']);
});

test('transfer:start takes downloads with no word on encryption, a link to several files among them', async () => {
    const setup = setUp();
    const page = setup.main.windowPage();
    const one = waitingDownload(setup, page.sender.id);
    const several = waitingDownload(setup, page.sender.id, [{ name: 'a.bin', size: 1 }, { name: 'b.bin', size: 2 }]);
    setup.work.length = 0;
    await setup.main.invoke(IPC.TRANSFER_START, page, { ids: [one, several] });
    assert.deepEqual(setup.work, [['start', one, SERVER], ['start', several, SERVER]]);
});

test('transfer:set-options on a download takes the files it saves, in order, and whether as one ZIP: this window\'s, waiting, and nothing else', async () => {
    const setup = setUp();
    const page = setup.main.windowPage();
    const other = setup.main.windowPage();
    const files = [{ name: 'a.bin', size: 1 }, { name: 'b.bin', size: 2 }, { name: 'c.bin', size: 3 }];
    const mine = waitingDownload(setup, page.sender.id, files);
    const theirs = waitingDownload(setup, other.sender.id, files);
    const started = waitingDownload(setup, page.sender.id, files);
    setup.transfers.start(started, SERVER);
    await refusesAll(setup, IPC.TRANSFER_SET_OPTIONS, page, [
        [{ id: theirs, options: { asZip: true } }], [{ id: started, options: { asZip: true } }], [{ id: mine }], [{ id: mine, options: {} }],
        [{ id: mine, options: { asZip: 'yes' } }], [{ id: mine, options: { files: [] } }], [{ id: mine, options: { files: [2, 0] } }],
        [{ id: mine, options: { files: [0, 0] } }], [{ id: mine, options: { files: [3] } }], [{ id: mine, options: { files: [0.5] } }],
        [{ id: mine, options: { files: [0], folder: FILE } }], [{ id: mine, options: { maxDownloads: 3 } }], [{ id: mine, options: { asZip: true }, path: FILE }],
    ], /Expected (a download|the files it saves|whether it's saved as one ZIP)/);
    await setup.main.invoke(IPC.TRANSFER_SET_OPTIONS, page, { id: mine, options: { files: [0, 2], asZip: true } });
    assert.deepEqual(view(setup.transfers.get(mine)).chosen, [0, 2]);
    assert.equal(view(setup.transfers.get(mine)).asZip, true);
    assert.equal(view(setup.transfers.get(mine)).inFolder, false);
    // All of them again is no choice at all; as files, a bundle is saved in a folder of its own.
    await setup.main.invoke(IPC.TRANSFER_SET_OPTIONS, page, { id: mine, options: { files: [0, 1, 2], asZip: false } });
    assert.equal(view(setup.transfers.get(mine)).chosen, null);
    assert.equal(view(setup.transfers.get(mine)).inFolder, true);
    // One file of several, as files: saved on its own, in no folder of its own.
    await setup.main.invoke(IPC.TRANSFER_SET_OPTIONS, page, { id: mine, options: { files: [1] } });
    assert.equal(view(setup.transfers.get(mine)).inFolder, false);
    assert.deepEqual(view(setup.transfers.get(started)).chosen, null, 'one started keeps its choice');
});

test('the transfer window answers a metadata read with a list of files or why not, and finishes a download with no link', async () => {
    const setup = setUp();
    const { main, work, host } = setup;
    const id = randomUUID();
    const reading = host.metadata(id, `https://dropgate.test/${UPLOAD_ID}#${SECRET}`);
    const [win] = main.windows;
    const page = main.transferPage(win.webContents);
    // Not sent until its page is ready; then the link goes, with the call.
    assert.equal(win.webContents.sent.find(([channel]) => channel === ENGINE.METADATA), undefined);
    await main.invoke(ENGINE.READY, page);
    const [, { call, link }] = win.webContents.sent.find(([channel]) => channel === ENGINE.METADATA);
    assert.equal(link, `https://dropgate.test/${UPLOAD_ID}#${SECRET}`);

    const file = { name: 'Secret plans é.bin', size: 1000 };
    await refusesAll(setup, ENGINE.ANSWER, page, [
        [call, {}], [call, { files: [], encrypted: true }], [call, { files: [file] }], [call, { files: [file], encrypted: 'yes' }],
        [call, { files: [{ name: '', size: 1 }], encrypted: true }], [call, { files: [{ name: 'x'.repeat(256), size: 1 }], encrypted: true }],
        [call, { files: [{ name: 'a', size: -1 }], encrypted: true }], [call, { files: [{ name: 'a', size: 1, path: FILE }], encrypted: true }],
        [call, { files: [file], encrypted: true, link: 'https://dropgate.test/' }], [call, { message: 42 }],
    ], /Expected the answer to a call\./);
    await main.invoke(ENGINE.ANSWER, page, call, { files: [file], encrypted: true });
    assert.deepEqual(await reading, { files: [file], encrypted: true });
    assert.equal(host.holds(id), true, 'the transfer window holds its link');

    // Its download: the folder to the file service as an output, the output alone to the transfer window.
    host.download(id, folder);
    const grant = main.processes[0].messages.find((m) => m.type === 'grant-output');
    assert.deepEqual(Object.keys(grant).sort(), ['folder', 'output', 'shape', 'type']);
    assert.equal(grant.folder, folder);
    const [, download] = win.webContents.sent.find(([channel]) => channel === ENGINE.DOWNLOAD);
    assert.deepEqual(download, { id, output: grant.output, asZip: false });
    await refusesAll(setup, ENGINE.FINISHED, page, [[id, { status: 'success', link: `https://dropgate.test/${UPLOAD_ID}` }]], /Expected how an upload running finished\./);
    await main.invoke(ENGINE.FINISHED, page, id, { status: 'success' });
    assert.deepEqual(work.at(-1), ['onFinished', id, { status: 'success' }]);
    assert.deepEqual(main.processes[0].messages.at(-1), { type: 'revoke', output: grant.output });

    // A link that couldn't be read is kept by no one.
    const unread = randomUUID();
    const failing = host.metadata(unread, `https://dropgate.test/${UPLOAD_ID}`);
    const [, second] = win.webContents.sent.filter(([channel]) => channel === ENGINE.METADATA).at(-1);
    await main.invoke(ENGINE.ANSWER, page, second.call, { message: 'The upload wasn\'t found. It may have expired.' });
    assert.deepEqual(await failing, { message: 'The upload wasn\'t found. It may have expired.' });
    assert.equal(host.holds(unread), false);
    host.forget(id);
    host.close();
});

test('a bundle\'s download: its files chosen go to the transfer window by index, and its folder to the file service as files (how many) or one ZIP', async () => {
    const setup = setUp();
    const { main, host } = setup;
    const [asFiles, asZip, oneOfThem] = [randomUUID(), randomUUID(), randomUUID()];
    const reads = [asFiles, asZip, oneOfThem].map((id) => host.metadata(id, `https://dropgate.test/${UPLOAD_ID}#${SECRET}`));
    const [win] = main.windows;
    const page = main.transferPage(win.webContents);
    await main.invoke(ENGINE.READY, page);
    const files = [{ name: 'a.bin', size: 1 }, { name: 'b.bin', size: 2 }, { name: 'c.bin', size: 3 }];
    for (const [, { call }] of win.webContents.sent.filter(([channel]) => channel === ENGINE.METADATA)) await main.invoke(ENGINE.ANSWER, page, call, { files, encrypted: true });
    await Promise.all(reads);

    host.download(asFiles, folder, { files: null, asZip: false }, 3);
    host.download(asZip, folder, { files: [0, 2], asZip: true }, 3);
    host.download(oneOfThem, folder, { files: [1], asZip: false }, 3);
    const grants = main.processes[0].messages.filter((m) => m.type === 'grant-output');
    const sent = win.webContents.sent.filter(([channel]) => channel === ENGINE.DOWNLOAD).map(([, download]) => download);
    assert.deepEqual(grants.map(({ shape, count }) => ({ shape, count })), [{ shape: 'files', count: 3 }, { shape: 'zip', count: undefined }, { shape: 'file', count: undefined }]);
    assert.deepEqual(grants[1].count === undefined && Object.keys(grants[1]).sort(), ['folder', 'output', 'shape', 'type'], 'a ZIP has no count');
    assert.deepEqual(sent, [
        { id: asFiles, output: grants[0].output, asZip: false },
        { id: asZip, output: grants[1].output, files: [0, 2], asZip: true },
        { id: oneOfThem, output: grants[2].output, files: [1], asZip: false },
    ]);
    for (const id of [asFiles, asZip, oneOfThem]) await main.invoke(ENGINE.FINISHED, page, id, { status: 'cancelled' });
    host.close();
});

test('where a download landed is taken from the file service for an output main granted, as an absolute path', () => {
    const { savedOf } = require('../src/core/payloads.js');
    const output = randomUUID();
    const granted = (o) => o === output;
    const where = path.join(folder, 'Secret plans é.bin');
    for (const message of [null, { type: 'saved', output }, { type: 'saved', output: randomUUID(), path: where }, { type: 'saved', output, path: 'relative.bin' },
        { type: 'saved', output, path: `${where}\0` }, { type: 'saved', output, path: where, name: 'Secret plans é.bin' }, { type: 'grant-output', output, path: where }]) {
        assert.throws(() => savedOf(message, granted), /Expected where a download was saved\./, JSON.stringify(message));
    }
    assert.deepEqual(savedOf({ type: 'saved', output, path: where }, granted), { output, path: where });
});

test('the page\'s settings changes go through the kit: never the saved servers or the downloads folder, transfers at once from 1 to 6, and main hears each', () => {
    const { MAIN_ONLY_SETTINGS, SETTINGS_CHECKS, SETTINGS_DEFAULTS } = require('../src/constants.js');
    // main.js gives the kit both, and hears each change; the kit's own store, run with them here, does the refusing.
    const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    assert.match(source, /mainOnly: \[\.\.\.MAIN_ONLY_SETTINGS\],\s+checks: SETTINGS_CHECKS,/);
    assert.match(source, /kit\.settings\.onChange\(\(changes\) => \{\s+if \(Object\.hasOwn\(changes, 'transfersAtOnce'\)\) transfers\.setAtOnce\(atOnceSetting\(\)\);/);
    const kitStore = require(path.join(path.dirname(require.resolve('@diamonddigitaldev/electron-kit/package.json')), 'main', 'store.js'));
    const file = new Map();
    const settings = kitStore.createSettings({
        defaults: SETTINGS_DEFAULTS, mainOnly: [...MAIN_ONLY_SETTINGS], checks: SETTINGS_CHECKS,
        open: () => ({ get: (key) => structuredClone(file.get(key)), set: (key, value) => file.set(key, structuredClone(value)), delete: (key) => file.delete(key) }),
    });
    const stored = () => structuredClone(file.get(kitStore.STORE_KEY));
    for (const [bad, message] of [
        [{ downloadFolder: folder }, /"downloadFolder" can't be changed from the page\./], [{ downloadFolder: null }, /"downloadFolder" can't be changed from the page\./],
        [{ servers: [] }, /"servers" can't be changed from the page\./], [{ defaultServer: randomUUID() }, /"defaultServer" can't be changed from the page\./],
        [{ navCollapsed: true, downloadFolder: folder }, /"downloadFolder" can't be changed from the page\./],
        [{ transfersAtOnce: 0 }, /"transfersAtOnce" doesn't take that value\./], [{ transfersAtOnce: 7 }, /"transfersAtOnce" doesn't take that value\./],
        [{ transfersAtOnce: 2.5 }, /"transfersAtOnce" doesn't take that value\./], [{ transfersAtOnce: '3' }, /"transfersAtOnce" takes a number\./],
        [null, /an object of settings/], [[], /an object of settings/],
    ]) {
        assert.throws(() => settings.set(bad, { from: 'page' }), message, JSON.stringify(bad));
    }
    assert.equal(stored(), undefined, 'nothing refused was stored');
    assert.equal(settings.set({ transfersAtOnce: 5, navCollapsed: true }, { from: 'page' }).transfersAtOnce, 5);
    // Main changes its own; the range holds for main too.
    assert.equal(settings.set({ downloadFolder: folder }).downloadFolder, folder);
    assert.throws(() => settings.set({ transfersAtOnce: 9 }), /doesn't take that value/);
    assert.deepEqual([stored().transfersAtOnce, stored().navCollapsed, stored().downloadFolder], [5, true, folder]);
    for (const n of [1, 6]) assert.equal(SETTINGS_CHECKS.transfersAtOnce(n), true);
});
