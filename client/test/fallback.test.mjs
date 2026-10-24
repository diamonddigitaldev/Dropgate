// The fallback (phase 14): an upload that allows it (its Allow Fallback, from
// its server's), and that its server can't take before any byte is sent,
// moves to the next saved server below it, never to a less private one (plain
// HTTP after HTTPS, not encrypted where it would have been, smaller limits)
// without the window asking; one too small for it can't take it. Main decides
// each move from its own checks (core/servers.js), keeps the upload's place
// while it does (core/transfers.js), and takes Allow Fallback from the page
// only as an option of an upload of its own (window-channels.js). The
// transfer window tells main core's code and whether the server had taken the
// upload's start (core/payloads.js' outcomeOf()).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fakeMain } from './helpers/main-process.mjs';

const require = createRequire(import.meta.url);
const { IPC, TRANSFERS } = require('../src/constants.js');
const { outcomeOf } = require('../src/core/payloads.js');
const {
    FALLBACK_CODES, ServerChecks, Servers, anyStepDown, canTake, heldTo, movesOn, serversBelow, stepDowns,
} = require('../src/core/servers.js');
const { Transfers, view } = require('../src/core/transfers.js');

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dropgate-fallback-'));
after(() => fs.rmSync(folder, { recursive: true, force: true }));
const FILE = path.join(folder, 'Plans.bin');
fs.writeFileSync(FILE, Buffer.alloc(1000, 1));

/** A server check that found a Dropgate server, at this address, with these upload capabilities. */
const found = (baseUrl, upload = {}) => ({
    ok: true, baseUrl, serverVersion: '4.0.0',
    serverInfo: { name: 'Drop', version: '4.0.0', capabilities: { upload: { enabled: true, e2ee: true, maxSizeMB: 100, maxLifetimeHours: 24, maxFileDownloads: 5, ...upload } } },
    dgup: { compatible: true, message: 'Compatible.' },
});

/** An upload, as main's registry keeps it, of `size` bytes. */
const upload = ({ size = 1000, options = {} } = {}) => ({
    files: [{ name: 'Plans.bin', size }],
    options: { lifetime: { value: 24, unit: 'hours' }, maxDownloads: 1, allowFallback: true, ...options },
});

const HTTPS = { url: 'https://one.test' };
const HTTP = { url: 'http://two.test' };

test('an upload moves on only with Allow Fallback, refused before its server took its start, for a reason a server can\'t take it', () => {
    const failed = (change) => ({ status: 'error', message: 'No.', code: 'SERVER_FULL', begun: false, ...change });
    assert.equal(movesOn(upload(), failed()), true);
    for (const code of FALLBACK_CODES) assert.equal(movesOn(upload(), failed({ code })), true, code);
    assert.deepEqual([...FALLBACK_CODES].sort(), [
        'AUTH_REQUIRED', 'CAPABILITY_UNSUPPORTED', 'FILE_TOO_LARGE', 'LIFETIME_NOT_ALLOWED', 'SERVER_FULL', 'SERVER_UNREACHABLE', 'TIMED_OUT', 'VERSION_UNSUPPORTED',
    ], "06's list: unreachable, uploads off, too big, full, a lifetime not allowed, an update needed, a sign-in");

    assert.equal(movesOn(upload({ options: { allowFallback: false } }), failed()), false, 'Allow Fallback off: it stops');
    assert.equal(movesOn(upload(), failed({ begun: true })), false, 'once bytes were sent: it fails, with Retry');
    assert.equal(movesOn(upload(), failed({ begun: undefined })), false, 'not known to be before: the transfer window stopped');
    for (const code of ['REQUEST_REJECTED', 'SOURCE_UNAVAILABLE', 'CONNECTION_LOST', 'SERVER_ERROR', undefined]) {
        assert.equal(movesOn(upload(), failed({ code })), false, String(code));
    }
    assert.equal(movesOn(upload(), { status: 'cancelled' }), false);
});

test('a server can take an upload when it\'s reached, a Dropgate server this version works with, taking uploads, and big enough; its limits count only where asked', () => {
    assert.deepEqual(canTake(null, upload()), { ok: true }, 'not checked: the server says');
    assert.deepEqual(canTake(found('https://one.test'), upload()), { ok: true });
    assert.deepEqual(canTake({ ok: false, message: "The server couldn't be reached." }, upload()), { ok: false, reason: "The server couldn't be reached." });
    assert.equal(canTake({ ok: true, baseUrl: 'https://one.test', serverInfo: {} }, upload()).ok, false, 'not a Dropgate server');
    assert.deepEqual(canTake({ ...found('https://one.test'), dgup: { compatible: false, message: 'Update Dropgate Client.' } }, upload()),
        { ok: false, reason: 'Update Dropgate Client.' });
    assert.deepEqual(canTake(found('https://one.test', { enabled: false }), upload()), { ok: false, reason: 'File uploads are disabled on this server.' });
    // Too small: 1 MB, for an upload of 1 MiB and a byte.
    assert.deepEqual(canTake(found('https://one.test', { maxSizeMB: 1 }), upload({ size: 1024 * 1024 + 1 })),
        { ok: false, reason: "This upload is over the server's limit of 1 MB." });
    assert.deepEqual(canTake(found('https://one.test', { maxSizeMB: 0 }), upload({ size: 2 ** 40 })), { ok: true }, '0 is no size limit');

    // Outside its limits: a server below can still take it (that's a step down, asked); the one it was going to can't.
    const long = upload({ options: { lifetime: { value: 3, unit: 'days' }, maxDownloads: 10 } });
    assert.deepEqual(canTake(found('https://one.test'), long), { ok: true });
    assert.deepEqual(canTake(found('https://one.test'), long, { limits: true }), { ok: false, reason: 'The server keeps files up to 24 hours.' });
    assert.deepEqual(canTake(found('https://one.test', { maxLifetimeHours: 0 }), long, { limits: true }), { ok: false, reason: 'The server allows up to 5 downloads.' });
    assert.deepEqual(canTake(found('https://one.test', { maxLifetimeHours: 0, maxFileDownloads: 0 }), long, { limits: true }), { ok: true });
});

test('a step down is plain HTTP after HTTPS, not encrypted where it would have been, or limits less than the upload asks for; anything else moves without asking', () => {
    const none = { plain: false, unencrypted: false, lifetime: null, downloads: null };
    assert.deepEqual(stepDowns(HTTPS, { url: 'https://three.test' }, found('https://three.test'), upload()), none);
    assert.equal(anyStepDown(none), false);

    // Plain HTTP after HTTPS: also not encrypted. An address with no scheme is HTTPS.
    assert.deepEqual(stepDowns(HTTPS, HTTP, found('http://two.test'), upload()), { ...none, plain: true, unencrypted: true });
    assert.equal(stepDowns({ url: 'one.test' }, HTTP, found('http://two.test'), upload()).plain, true);
    // HTTPS with no end-to-end encryption.
    assert.deepEqual(stepDowns(HTTPS, { url: 'https://three.test' }, found('https://three.test', { e2ee: false }), upload()), { ...none, unencrypted: true });
    // Plain after plain, the person having said Upload Anyway (encrypt false): no step down.
    assert.deepEqual(stepDowns(HTTP, { url: 'http://four.test' }, found('http://four.test'), upload({ options: { encrypt: false } })), none);
    // Plain going to HTTPS: better, never asked.
    assert.deepEqual(stepDowns(HTTP, HTTPS, found('https://one.test'), upload({ options: { encrypt: false } })), none);
    // Plain, the upload having never been asked (no word: it'd have been encrypted where it could): asked.
    assert.equal(stepDowns(HTTP, { url: 'http://four.test' }, found('http://four.test'), upload()).unencrypted, true);

    // Limits: the server's, where the upload asks for more.
    const long = upload({ options: { lifetime: { value: 0, unit: 'unlimited' }, maxDownloads: 0 } });
    assert.deepEqual(stepDowns(HTTPS, { url: 'https://three.test' }, found('https://three.test', { maxLifetimeHours: 6, maxFileDownloads: 2 }), long),
        { ...none, lifetime: 6, downloads: 2 });
    assert.equal(anyStepDown({ ...none, downloads: 2 }), true);
    // Held to them, once it goes there.
    assert.deepEqual(heldTo(long.options, found('https://three.test', { maxLifetimeHours: 6, maxFileDownloads: 2 })),
        { lifetime: { value: 6, unit: 'hours' }, maxDownloads: 2 });
    assert.deepEqual(heldTo({ lifetime: { value: 30, unit: 'minutes' }, maxDownloads: 1 }, found('https://three.test')),
        { lifetime: { value: 30, unit: 'minutes' }, maxDownloads: 1 }, 'within them, as it was');
});

test('the servers an upload may fall back to are those below its own, in the saved order; none below the last, or once its own was removed', () => {
    const list = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
    assert.deepEqual(serversBelow(list, 'b').map(({ id }) => id), ['c', 'd']);
    assert.deepEqual(serversBelow(list, 'd'), []);
    assert.deepEqual(serversBelow(list, 'gone'), []);
    assert.deepEqual(serversBelow(list, undefined), []);
});

/** A registry of 3 at once, recording what it starts in the transfer window. */
function registry() {
    const started = [];
    const transfers = new Transfers({ atOnce: TRANSFERS.AT_ONCE, start: (card) => started.push(card.id), resume: () => {} });
    const add = () => transfers.add({
        owner: 1, files: [{ path: FILE, name: 'Plans.bin', size: 1000 }], savedServer: { id: 'a', name: 'One', host: 'one.test' },
        options: { lifetime: { value: 24, unit: 'hours' }, maxDownloads: 1, allowFallback: true },
    }).id;
    return { transfers, started, add };
}

const TO_TWO = {
    savedServer: { id: 'b', name: 'Two', host: 'two.test' }, server: { url: 'https://two.test', allowInsecure: false },
    options: { lifetime: { value: 6, unit: 'hours' }, maxDownloads: 1, encrypt: true }, from: { id: 'a', name: 'One', host: 'one.test' },
};

test('falling back, an upload keeps its place while the next server is checked, and goes on there at once, saying where it moved from', () => {
    const { transfers, started, add } = registry();
    const ids = [add(), add(), add(), add()];
    for (const id of ids) transfers.start(id, { url: 'https://one.test', allowInsecure: false });
    assert.deepEqual(ids.map((id) => transfers.get(id).state), ['running', 'running', 'running', 'queued']);

    // Its server refused it: while the next is checked, it says so, and keeps its place.
    const [first] = ids;
    assert.ok(transfers.trying(first, 'Trying Two…'));
    assert.deepEqual([transfers.get(first).state, view(transfers.get(first)).step, view(transfers.get(first)).canPause], ['running', 'Trying Two…', false]);
    assert.equal(transfers.get(ids[3]).state, 'queued', 'no place freed');

    // It goes on there at once, in its place, with what main gave it there.
    assert.ok(transfers.moveTo(first, TO_TWO));
    assert.deepEqual(started, [...ids.slice(0, 3), first]);
    const drawn = view(transfers.get(first));
    assert.deepEqual([drawn.state, drawn.server, drawn.movedFrom, drawn.options.lifetime, drawn.options.allowFallback],
        ['running', TO_TWO.savedServer, TO_TWO.from, { value: 6, unit: 'hours' }, true]);
    assert.deepEqual(transfers.get(first).server, TO_TWO.server);
    // Moving again keeps the server it was going to first.
    transfers.moveTo(first, { ...TO_TWO, savedServer: { id: 'c', name: 'Three', host: 'three.test' }, from: TO_TWO.savedServer });
    assert.deepEqual(view(transfers.get(first)).movedFrom, TO_TWO.from);

    // One that isn't running (cancelled meanwhile) isn't moved.
    transfers.ended(ids[1], { status: 'cancelled' });
    assert.equal(transfers.trying(ids[1], 'Trying Two…'), null);
    assert.equal(transfers.moveTo(ids[1], TO_TWO), null);
});

test('falling back to a step down, an upload gives up its place and waits on that server for the window\'s answer; tried again, nothing of the fallback carries over', () => {
    const { transfers, started, add } = registry();
    const ids = [add(), add(), add(), add()];
    for (const id of ids) transfers.start(id, { url: 'https://one.test', allowInsecure: false });
    const [first] = ids;
    const before = { ...transfers.get(first).options };

    const held = transfers.hold(first, { ...TO_TWO, ask: { owner: 1, sent: false, fallback: { reason: 'Full.' } } });
    assert.equal(held.state, 'waiting');
    assert.equal(transfers.get(ids[3]).state, 'running', 'its place goes to the next queued');
    assert.deepEqual(started, ids);
    const drawn = view(held);
    assert.deepEqual([drawn.asking, drawn.server, drawn.movedFrom], [true, TO_TWO.savedServer, TO_TWO.from]);
    assert.deepEqual(held.ask.restore.options, before, 'what it goes back to, if the answer is no');
    assert.equal(held.started, false);

    // Answered yes, it starts as any waiting upload does, there.
    delete held.ask;
    transfers.start(first);
    assert.deepEqual(transfers.get(first).server, TO_TWO.server);

    // Failed later and tried again: it waits on that server, and says nothing of the move.
    transfers.ended(first, { status: 'error', error: 'The connection was lost.' });
    Object.assign(transfers.get(first), { fellFrom: { reason: 'Full.' }, fallFrom: 'Full.' });
    transfers.retry(first, 1);
    const again = transfers.get(first);
    assert.deepEqual([again.state, view(again).movedFrom, view(again).server, again.fellFrom, again.fallFrom], ['waiting', null, TO_TWO.savedServer, undefined, undefined]);
});

/** The window's channels, as main answers them, over the saved servers given, with each one's check. */
function channels({ servers: list, checks: found = {} }) {
    const main = fakeMain();
    let current = { servers: list, defaultServer: list[0].id };
    const servers = new Servers({ get: () => current, set: (changes) => { current = { ...current, ...changes }; return current; } });
    const checks = new ServerChecks();
    for (const [id, check] of Object.entries(found)) checks.set(id, check);
    const started = [];
    const transfers = new Transfers({ atOnce: 3, start: () => {}, resume: () => {} });
    const none = () => {};
    const { answerWindowChannels } = main.load('../src/window-channels.js');
    const { Handles } = require('../src/core/handles.js');
    answerWindowChannels({
        kit: main.kit, handles: new Handles(), transfers, servers, checks, host: () => ({ check: async () => ({ ok: false }) }),
        windowReady: none, start: (id, server) => started.push([id, server]), pause: none, resume: none, cancel: none, delete: none, busy: () => false, failed: none,
        copyLink: none, addDownload: none, saveTo: none, show: none, chooseFolder: none, chose: () => false, defaultFolder: none, setDefaultFolder: none,
    });
    const page = main.windowPage();
    const addUpload = async (request = {}) => {
        const { files: [file] } = await main.invoke(IPC.FILES_ADD, page, [FILE]);
        return (await main.invoke(IPC.TRANSFER_ADD_UPLOAD, page, { files: [file.handle], ...request })).id;
    };
    return { main, page, transfers, started, addUpload, stored: () => current };
}

const saved = (change) => ({ id: randomUUID(), url: 'https://one.test', name: 'One', lifetime: { value: 24, unit: 'hours' }, maxDownloads: 1, allowFallback: false, ...change });

test('a new upload takes its server\'s Allow Fallback, its "To" the new server\'s, and Advanced Options sets its own; the page may set nothing else of the fallback', async () => {
    const [one, two] = [saved({ allowFallback: true }), saved({ url: 'https://two.test', name: 'Two' })];
    const { main, page, transfers, addUpload, stored } = channels({ servers: [one, two] });
    const id = await addUpload();
    assert.equal(transfers.get(id).options.allowFallback, true, "the default's");
    assert.equal(transfers.get(await addUpload({ server: two.id })).options.allowFallback, false, 'the one given');

    await main.invoke(IPC.TRANSFER_SET_OPTIONS, page, { id, options: { server: two.id } });
    assert.equal(transfers.get(id).options.allowFallback, false, 'moved, it takes the new server\'s');
    await main.invoke(IPC.TRANSFER_SET_OPTIONS, page, { id, options: { allowFallback: true } });
    assert.equal(transfers.get(id).options.allowFallback, true, 'its own, from Advanced Options');
    await main.invoke(IPC.TRANSFER_SET_OPTIONS, page, { id, options: { lifetime: { value: 2, unit: 'hours' }, maxDownloads: 1, allowFallback: false } });
    assert.deepEqual(transfers.get(id).options, { lifetime: { value: 2, unit: 'hours' }, maxDownloads: 1, allowFallback: false });

    for (const allowFallback of ['yes', 1, null]) {
        await assert.rejects(main.invoke(IPC.TRANSFER_SET_OPTIONS, page, { id, options: { allowFallback } }), /Expected whether to allow fallback\./);
    }
    for (const options of [{ movedFrom: { id: one.id } }, { fallFrom: 'Full.' }, { encrypt: false, allowFallback: true }]) {
        await assert.rejects(main.invoke(IPC.TRANSFER_SET_OPTIONS, page, { id, options }), /Expected an upload's options\./);
    }
    assert.equal(transfers.get(id).options.allowFallback, false, 'nothing refused changed it');
    // A server's own, saved through server:set-options: new uploads to it take it from then on; those made keep theirs.
    const made = await addUpload({ server: two.id });
    await main.invoke(IPC.SERVER_SET_OPTIONS, page, { id: two.id, options: { allowFallback: true } });
    assert.equal(stored().servers.find((server) => server.id === two.id).allowFallback, true);
    assert.equal(transfers.get(await addUpload({ server: two.id })).options.allowFallback, true);
    assert.equal(transfers.get(made).options.allowFallback, false);
    await assert.rejects(main.invoke(IPC.SERVER_SET_OPTIONS, page, { id: two.id, options: { allowFallback: 'on' } }), /Expected whether to allow fallback\./);
});

test('Upload, on a server main\'s last check says can\'t take it: one that allows fallback moves on as it gets its place, with no word on encryption; one that doesn\'t starts there as asked', async () => {
    const [one, two] = [saved({ url: 'http://one.test' }), saved({ url: 'https://two.test', name: 'Two' })];
    const setup = channels({ servers: [one, two], checks: { [one.id]: { ok: false, code: 'SERVER_UNREACHABLE', message: "The server couldn't be reached." } } });
    const { main, page, transfers, started } = setup;
    const falls = await setup.addUpload();
    const stays = await setup.addUpload();
    await main.invoke(IPC.TRANSFER_SET_OPTIONS, page, { id: falls, options: { allowFallback: true } });

    // The page's word is what main holds that server to (not encrypted, by a check that didn't reach it).
    await main.invoke(IPC.TRANSFER_START, page, { ids: [falls, stays], encrypt: false });
    assert.deepEqual(started.map(([id]) => id), [falls, stays]);
    assert.equal(transfers.get(falls).fallFrom, "The server couldn't be reached.");
    assert.equal(Object.hasOwn(transfers.get(falls).options, 'encrypt'), false, 'no word: it goes encrypted where it can, or the window is asked');
    assert.deepEqual([transfers.get(stays).fallFrom, transfers.get(stays).options.encrypt], [undefined, false]);
    assert.deepEqual(transfers.get(falls).server, { url: 'http://one.test', allowInsecure: true }, 'where it was going: its saved server\'s address, never the page\'s');
});

test('Upload, on a server whose limits an upload is outside: one that allows fallback moves on; within them, it starts there', async () => {
    const one = saved({ lifetime: { value: 3, unit: 'days' } });
    const setup = channels({ servers: [one, saved({ url: 'https://two.test' })], checks: { [one.id]: found('https://one.test') } });
    const { main, page, transfers } = setup;
    const [outside, within] = [await setup.addUpload(), await setup.addUpload()];
    await main.invoke(IPC.TRANSFER_SET_OPTIONS, page, { id: outside, options: { allowFallback: true } });
    await main.invoke(IPC.TRANSFER_SET_OPTIONS, page, { id: within, options: { lifetime: { value: 1, unit: 'days' }, allowFallback: true } });
    await main.invoke(IPC.TRANSFER_START, page, { ids: [outside, within], encrypt: true });
    assert.equal(transfers.get(outside).fallFrom, 'The server keeps files up to 24 hours.');
    assert.deepEqual([transfers.get(within).fallFrom, transfers.get(within).options.encrypt], [undefined, true]);

    // The page's word still has to be main's: never a plain upload to a server that encrypts.
    const third = await setup.addUpload();
    await main.invoke(IPC.TRANSFER_SET_OPTIONS, page, { id: third, options: { allowFallback: true } });
    await assert.rejects(main.invoke(IPC.TRANSFER_START, page, { ids: [third], encrypt: false }), /One was checked again since: Try again\./);
});

test('the transfer window tells main core\'s code and whether the server had taken the upload\'s start, and nothing else', () => {
    assert.deepEqual(outcomeOf({ status: 'error', message: 'Full.', code: 'SERVER_FULL', begun: false }), { status: 'error', message: 'Full.', code: 'SERVER_FULL', begun: false });
    assert.deepEqual(outcomeOf({ status: 'error', message: 'Lost.', begun: true }), { status: 'error', message: 'Lost.', begun: true });
    assert.deepEqual(outcomeOf({ status: 'error', message: 'Stopped.' }), { status: 'error', message: 'Stopped.' });
    for (const result of [
        { status: 'error', message: 'x', code: 'server_full' }, { status: 'error', message: 'x', code: 42 }, { status: 'error', message: 'x', code: `A${'B'.repeat(64)}` },
        { status: 'error', message: 'x', begun: 'no' }, { status: 'error', message: 'x', begun: false, server: 'https://elsewhere.test' },
        { status: 'cancelled', begun: false }, { status: 'success', link: 'https://one.test/x', code: 'SERVER_FULL' },
    ]) {
        assert.throws(() => outcomeOf(result), /Expected how an upload running finished\./, JSON.stringify(result));
    }
});
