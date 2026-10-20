// Main's registry of transfers (src/core/transfers.js): up to 3 run at once,
// the rest queued in the order added, a paused one taking no place; Restart
// Now's busy; quitting starting nothing more; what the window is sent of each;
// and the pacing that keeps each to 4 updates a second.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { Pacer, Transfers, view } = require('../src/core/transfers.js');
const { TRANSFERS } = require('../src/constants.js');

const SERVER = { url: 'https://dropgate.test', allowInsecure: false };
const OPTIONS = { lifetime: { value: 24, unit: 'hours' }, maxDownloads: 1, encrypt: true };
const RUNNING = { status: 'uploading', text: 'Uploading chunk 1 of 3...', percent: 10, canPause: true };
const PAUSED = { status: 'paused', text: 'Paused.', percent: 10, canPause: true, deadline: 1_800_000_000_000 };
const DONE = { status: 'success', link: 'https://dropgate.test/0b7e3c51-9d2a-4f6e-8a1c-000000000001#key' };

/** A registry of 3 at once, recording what it starts and resumes in the transfer window. */
function registry() {
    const started = [];
    const resumed = [];
    const transfers = new Transfers({
        atOnce: TRANSFERS.AT_ONCE,
        start: (card) => started.push(card.id),
        resume: (card) => resumed.push(card.id),
    });
    /** n transfers added and started, in order. */
    const startMany = (n) => Array.from({ length: n }, () => {
        const { id } = transfers.add({ owner: null, files: [{ path: '/secret/plans.bin', name: 'plans.bin', size: 1 }], options: OPTIONS });
        transfers.start(id, SERVER);
        return id;
    });
    const states = (ids) => ids.map((id) => transfers.get(id)?.state ?? 'gone');
    return { transfers, started, resumed, startMany, states };
}

test('three run at once; the rest wait as queued, and start in the order added as places free', () => {
    assert.equal(TRANSFERS.AT_ONCE, 3);
    const { transfers, started, startMany, states } = registry();
    const ids = startMany(5);
    assert.deepEqual(states(ids), ['running', 'running', 'running', 'queued', 'queued']);
    assert.deepEqual(started, ids.slice(0, 3));
    assert.deepEqual(transfers.counts(), { running: 3, paused: 0, queued: 2, downloading: 0 });

    transfers.ended(ids[1], DONE);
    assert.deepEqual(states(ids), ['running', 'done', 'running', 'running', 'queued']);
    assert.deepEqual(started, [...ids.slice(0, 3), ids[3]], 'the fourth, first in line, took the place');
    transfers.ended(ids[0], DONE);
    assert.deepEqual(started, [...ids.slice(0, 3), ids[3], ids[4]]);
});

test('a paused one takes no place: the next queued starts, and resumed with every place taken, it waits as queued until one frees', () => {
    const { transfers, started, resumed, startMany, states } = registry();
    const ids = startMany(5);
    for (const id of ids.slice(0, 3)) transfers.updated(id, RUNNING);

    assert.equal(transfers.pause(ids[0]), true, 'a running one is paused in the transfer window');
    transfers.updated(ids[0], PAUSED);
    assert.deepEqual(states(ids), ['paused', 'running', 'running', 'running', 'queued']);
    assert.deepEqual(started.at(-1), ids[3]);

    assert.equal(transfers.resume(ids[0]), false, 'no place: not resumed yet');
    assert.deepEqual(states(ids), ['queued', 'running', 'running', 'running', 'queued']);
    // Its snapshot still says paused; it stays queued.
    transfers.updated(ids[0], PAUSED);
    assert.equal(transfers.get(ids[0]).state, 'queued');

    // A place frees: it was queued first, so it's resumed before the fifth starts.
    transfers.ended(ids[1], DONE);
    assert.deepEqual(resumed, [ids[0]]);
    assert.deepEqual(states(ids), ['running', 'done', 'running', 'running', 'queued']);
    transfers.ended(ids[2], DONE);
    assert.deepEqual(started.at(-1), ids[4]);
});

test('resumed with a place free, it keeps that place at once; paused again while queued to resume, it just stays paused', () => {
    const { transfers, startMany, states } = registry();
    const ids = startMany(4);
    transfers.updated(ids[0], PAUSED);
    assert.deepEqual(states(ids), ['paused', 'running', 'running', 'running']);
    assert.equal(transfers.resume(ids[0]), false);
    assert.equal(transfers.pause(ids[0]), false, 'nothing to ask the transfer window: it never resumed');
    assert.deepEqual(states(ids), ['paused', 'running', 'running', 'running']);

    transfers.ended(ids[3], DONE);
    assert.equal(transfers.resume(ids[0]), true, 'a place is free: resumed now');
    assert.equal(transfers.get(ids[0]).state, 'running');
    // While the server is asked, core still says paused ("Resuming..."): the place is kept.
    transfers.updated(ids[0], { ...PAUSED, text: 'Resuming...' });
    assert.equal(transfers.get(ids[0]).state, 'running');
    assert.equal(transfers.counts().running, 3);
    // The transfer window couldn't: once it has answered, its snapshot says paused, and the place goes.
    transfers.updated(ids[0], PAUSED);
    transfers.resumed(ids[0]);
    assert.equal(transfers.get(ids[0]).state, 'paused');
    // Asked again, it could: it runs on.
    assert.equal(transfers.resume(ids[0]), true);
    transfers.updated(ids[0], RUNNING);
    transfers.resumed(ids[0]);
    assert.equal(transfers.get(ids[0]).state, 'running');
});

test('busy (Restart Now asks) while any runs, is paused or is queued; a waiting one isn\'t', () => {
    const { transfers, startMany } = registry();
    const waiting = transfers.add({ owner: 1, files: [], options: OPTIONS });
    assert.equal(transfers.busy(), false);
    const [id] = startMany(1);
    assert.equal(transfers.busy(), true);
    transfers.updated(id, PAUSED);
    assert.equal(transfers.busy(), true, 'paused');
    transfers.ended(id, DONE);
    assert.equal(transfers.busy(), false);
    assert.equal(transfers.get(waiting.id).state, 'waiting');
});

test('one the transfer window never had can be taken back; one it has can\'t', () => {
    const { transfers, started, startMany } = registry();
    const ids = startMany(4);
    assert.equal(transfers.withdraw(ids[0]), null, 'running: cancelled in the transfer window instead');
    assert.equal(transfers.withdraw(ids[3]).id, ids[3]);
    assert.equal(transfers.has(ids[3]), false);
    assert.deepEqual(started, ids.slice(0, 3), 'withdrawn, it never started');
});

test('quitting starts nothing more, and takes back every transfer the transfer window never had', () => {
    const { transfers, started, startMany } = registry();
    const ids = startMany(5);
    const waiting = transfers.add({ owner: 1, files: [], options: OPTIONS });
    const dropped = transfers.close();
    assert.deepEqual(dropped.map((card) => card.id).sort(), [ids[3], ids[4], waiting.id].sort());
    transfers.ended(ids[0], DONE);
    assert.deepEqual(started, ids.slice(0, 3), 'no place given to anything after quitting');
    assert.deepEqual(transfers.list().map((card) => [card.id, card.state]), [[ids[0], 'done'], [ids[1], 'running'], [ids[2], 'running']]);
});

test('an ended one stays, with its link or its reason, until it\'s removed; a failed or cancelled one can wait again', () => {
    const { transfers, startMany, states } = registry();
    const ids = startMany(4);
    transfers.ended(ids[0], DONE);
    transfers.ended(ids[1], { status: 'error', error: 'The server closed the connection.' });
    // Cancelled while queued: it never started, and stays as cancelled.
    transfers.ended(ids[3], { status: 'cancelled' });
    assert.deepEqual(states(ids), ['done', 'failed', 'running', 'cancelled']);
    assert.equal(transfers.get(ids[0]).link, DONE.link);
    assert.equal(transfers.get(ids[1]).message, 'The server closed the connection.');
    assert.equal(transfers.ended(ids[0], { status: 'cancelled' }), null, 'it ends once');
    assert.equal(transfers.busy(), true, 'one still runs');
    assert.deepEqual(transfers.counts(), { running: 1, paused: 0, queued: 0, downloading: 0 }, 'ended ones are counted nowhere');
    assert.equal(transfers.withdraw(ids[3]), null, 'an ended one isn\'t taken back, it\'s removed');

    // Remove takes waiting and ended ones; one going stays.
    const removed = [];
    transfers.removed = (card) => removed.push(card.id);
    assert.deepEqual(transfers.remove([ids[0], ids[2]]).map((card) => card.id), [ids[0]]);
    assert.deepEqual(removed, [ids[0]]);
    assert.deepEqual(states(ids), ['gone', 'failed', 'running', 'cancelled']);

    // Tried again, it waits for the window that asked, as it was, with no link or reason left.
    assert.equal(transfers.retry(ids[2], 7), null, 'one running isn\'t tried again');
    const again = transfers.retry(ids[1], 7);
    assert.equal(again.state, 'waiting');
    assert.equal(again.owner, 7);
    assert.equal(again.started, false);
    assert.equal(again.message, null);
    assert.deepEqual(again.files.map((file) => file.name), ['plans.bin']);
    transfers.start(ids[1], SERVER);
    assert.equal(transfers.get(ids[1]).state, 'running', 'started again, it takes a place');
});

test('files dropped onto a waiting one join it, each once; one that has started takes none', () => {
    const { transfers } = registry();
    const changed = [];
    transfers.changed = (card) => changed.push(card.id);
    const waiting = transfers.add({ owner: 1, files: [{ path: '/secret/a.bin', name: 'a.bin', size: 1 }], options: OPTIONS });
    assert.deepEqual(changed, [waiting.id], 'the window hears of a new one');
    const more = [{ path: '/secret/a.bin', name: 'a.bin', size: 1 }, { path: '/secret/b.bin', name: 'b.bin', size: 2 }, { path: '/secret/b.bin', name: 'b.bin', size: 2 }];
    assert.deepEqual(transfers.addFiles(waiting.id, more), { added: 1, skipped: 2 });
    assert.deepEqual(transfers.get(waiting.id).files.map((file) => file.name), ['a.bin', 'b.bin']);
    assert.equal(changed.length, 2);
    assert.deepEqual(transfers.addFiles(waiting.id, more.slice(0, 1)), { added: 0, skipped: 1 });
    assert.equal(changed.length, 2, 'nothing changed: nothing to send');

    transfers.start(waiting.id, SERVER);
    assert.equal(transfers.addFiles(waiting.id, more), null, 'started: its files are sealed');
    assert.equal(transfers.get(waiting.id).files.length, 2);
});

test('the window is sent a transfer\'s names and sizes and how it\'s going, never a path', () => {
    const { transfers, startMany } = registry();
    const [id] = startMany(1);
    transfers.updated(id, { ...RUNNING, phase: 'chunk', fileIndex: 0, processedBytes: 1 });
    const drawn = view(transfers.get(id));
    assert.deepEqual(drawn, {
        id, kind: 'upload', state: 'running', files: [{ name: 'plans.bin', size: 1 }], status: 'uploading',
        step: RUNNING.text, phase: 'chunk', percent: 10, fileIndex: 0, canPause: true, deadline: null,
        options: { lifetime: { value: 24, unit: 'hours' }, maxDownloads: 1, encrypt: true }, link: null, message: null, canDelete: false, server: null,
    });
    assert.doesNotMatch(JSON.stringify(drawn), /secret/);
});

test('each transfer reaches the window at most 4 times a second, its latest state last, and never after it\'s dropped', () => {
    assert.equal(TRANSFERS.UPDATES_PER_SECOND, 4);
    let now = 0;
    const timers = [];
    const sent = [];
    const pacer = new Pacer(TRANSFERS.UPDATES_PER_SECOND, (key, value) => sent.push([now, key, value]), {
        now: () => now,
        setTimeout: (fn, ms) => {
            const timer = { at: now + ms, fn };
            timers.push(timer);
            return timer;
        },
        clearTimeout: (timer) => {
            if (timer) timer.fn = null;
        },
    });
    const advance = (ms) => {
        const until = now + ms;
        for (;;) {
            const due = timers.filter((t) => t.fn && t.at <= until).sort((a, b) => a.at - b.at)[0];
            if (!due) break;
            now = due.at;
            const { fn } = due;
            due.fn = null;
            fn();
        }
        now = until;
    };

    // Forty updates in one second, to each of two transfers.
    for (let i = 0; i < 40; i++) {
        pacer.push('a', i);
        pacer.push('b', i);
        advance(25);
    }
    advance(1000);
    for (const key of ['a', 'b']) {
        const times = sent.filter(([, k]) => k === key).map(([at]) => at);
        for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 250, `${key}: ${times[i - 1]} then ${times[i]}`);
        assert.ok(times.length <= 6, `${key}: ${times.length} in about 1.25 s`);
        assert.equal(sent.filter(([, k]) => k === key).at(-1)[2], 39, 'the latest is sent last');
    }
    assert.deepEqual(sent.slice(0, 2).map(([at, key, value]) => [at, key, value]), [[0, 'a', 0], [0, 'b', 0]], 'the first goes at once');

    pacer.push('a', 'x');
    pacer.push('a', 'y');
    pacer.drop('a');
    advance(1000);
    assert.notEqual(sent.at(-1)[2], 'y', 'nothing of a dropped transfer is sent');
});

test('a waiting one takes new options and keeps the files chosen, in order; one that has started takes none', () => {
    const { transfers } = registry();
    const changed = [];
    transfers.changed = (card) => changed.push(card.id);
    const files = ['a.bin', 'b.bin', 'c.bin'].map((name, i) => ({ path: `/secret/${name}`, name, size: i + 1 }));
    const card = transfers.add({ owner: 1, files, options: { lifetime: { value: 24, unit: 'hours' }, maxDownloads: 1 } });
    changed.length = 0;

    assert.equal(transfers.setOptions(card.id, { lifetime: { value: 3, unit: 'days' }, maxDownloads: 10 }), card);
    assert.deepEqual(card.options, { lifetime: { value: 3, unit: 'days' }, maxDownloads: 10 });
    assert.equal(transfers.setOptions(card.id, { files: [0, 2] }), card);
    assert.deepEqual(card.files.map((file) => file.path), ['/secret/a.bin', '/secret/c.bin'], 'the files kept, with their paths');
    assert.deepEqual(card.options, { lifetime: { value: 3, unit: 'days' }, maxDownloads: 10 }, 'what it wasn\'t given stays');
    assert.equal(transfers.setOptions(card.id, { files: [2] }), null, 'no file it hasn\'t got');
    assert.equal(changed.length, 2, 'the window hears of each change');

    transfers.start(card.id, SERVER);
    assert.equal(transfers.setOptions(card.id, { maxDownloads: 5 }), null, 'started: its options are sealed');
    assert.equal(card.options.maxDownloads, 10);
});

test('a done upload can be deleted while the transfer window holds its token: then it says so, its link forgotten, and it can be removed', () => {
    const { transfers, startMany } = registry();
    const [done, other, failed] = startMany(3);
    transfers.ended(done, DONE);
    transfers.ended(other, DONE);
    transfers.ended(failed, { status: 'error', error: 'The server closed the connection.' });
    assert.deepEqual([done, other, failed].map((id) => view(transfers.get(id)).canDelete), [true, true, false]);

    assert.equal(transfers.deleted(failed), null, 'only a done one is deleted');
    assert.equal(transfers.deleted(done).state, 'deleted');
    assert.deepEqual([view(transfers.get(done)).link, view(transfers.get(done)).canDelete], [null, false]);
    assert.equal(transfers.deleted(done), null, 'once');
    assert.equal(transfers.retry(done, 1), null, 'nothing to try again');
    assert.equal(transfers.busy(), false, 'a deleted one is ended');

    // The transfer window stopped: the other can't be deleted from here any more.
    const changed = [];
    transfers.changed = (card) => changed.push(card.id);
    transfers.tokensLost([other, failed]);
    assert.deepEqual([view(transfers.get(other)).canDelete, changed], [false, [other]]);
    assert.equal(view(transfers.get(other)).link, DONE.link, 'its link still works');

    assert.deepEqual(transfers.remove([done, other]).map((card) => card.id), [done, other]);
});

/** A download as main makes one from a link: no files until its list is read, saved to the default folder. */
const addDownload = (transfers) => transfers.add({
    kind: 'download', owner: 1, server: SERVER, host: 'dropgate.test', files: [], options: null, saveTo: { folder: 'default', label: 'Downloads' },
});

test('a download reads its list of files, then waits; Save to changes until it starts; it runs with uploads, counted apart; done, it can be shown', () => {
    const { transfers, started, startMany } = registry();
    const card = addDownload(transfers);
    assert.equal(card.state, 'reading');
    assert.equal(transfers.read(card.id, { files: [{ name: 'Secret plans é.bin', size: 1000 }], encrypted: true }), card);
    assert.equal(transfers.read(card.id, { files: [], encrypted: false }), null, 'read once');
    assert.equal(card.state, 'waiting');
    // Not an upload's: no files dropped on, no upload options.
    assert.equal(transfers.addFiles(card.id, [{ path: '/secret/more.bin' }]), null);
    assert.equal(transfers.setOptions(card.id, { maxDownloads: 5 }), null);

    transfers.saveTo([card.id], { folder: 'a-folder-id', label: 'Projects' });
    assert.deepEqual(view(card).saveTo, { folder: 'a-folder-id', label: 'Projects' });

    // Two uploads run; the download takes the third place, and counts as one downloading.
    startMany(2);
    transfers.start(card.id, SERVER);
    assert.deepEqual(transfers.counts(), { running: 3, paused: 0, queued: 0, downloading: 1 });
    assert.equal(started.at(-1), card.id);
    transfers.saveTo([card.id], { folder: 'default', label: 'Downloads' });
    assert.deepEqual(view(card).saveTo, { folder: 'a-folder-id', label: 'Projects' }, 'started: its folder stays');

    transfers.saved(card.id, '/home/will/Projects/Secret plans é.bin');
    transfers.ended(card.id, { status: 'success' });
    const shown = view(card);
    assert.deepEqual([shown.kind, shown.state, shown.host, shown.encrypted, shown.canShow, shown.canDelete, shown.link], ['download', 'done', 'dropgate.test', true, true, false, null]);
    assert.doesNotMatch(JSON.stringify(shown), /home|will\//, 'never where it was saved');
    assert.deepEqual(transfers.remove([card.id]).map(({ id }) => id), [card.id]);
});

test('a bundle\'s download chooses its files and whether as one ZIP while it waits; saved as files it\'s in a folder of its own; a retry keeps the choice', () => {
    const { transfers } = registry();
    const card = addDownload(transfers);
    assert.equal(transfers.choose(card.id, { asZip: true }), null, 'nothing to choose while its list is read');
    transfers.read(card.id, { files: [{ name: 'a.bin', size: 1 }, { name: 'b.bin', size: 2 }, { name: 'c.bin', size: 3 }], encrypted: true });
    assert.deepEqual([view(card).chosen, view(card).asZip, view(card).inFolder], [null, false, true], 'all of them, as files, in a folder of their own');
    assert.equal(transfers.choose(card.id, { files: [0, 3] }), null, 'a file it hasn\'t');
    transfers.choose(card.id, { files: [0, 2], asZip: true });
    assert.deepEqual([view(card).chosen, view(card).asZip, view(card).inFolder], [[0, 2], true, false]);
    transfers.choose(card.id, { asZip: false });
    assert.deepEqual([view(card).chosen, view(card).inFolder], [[0, 2], true], 'the files stay as chosen');
    transfers.choose(card.id, { files: [1] });
    assert.equal(view(card).inFolder, false, 'one file: saved on its own');

    transfers.start(card.id, SERVER);
    assert.equal(transfers.choose(card.id, { files: [0, 1, 2] }), null, 'started: its choice is sealed');
    transfers.ended(card.id, { status: 'error', error: 'The server dropped this download.' });
    transfers.retry(card.id, card.owner);
    assert.deepEqual([card.state, view(card).chosen], ['waiting', [1]], 'tried again, as it was chosen');
    // All of them chosen is no choice.
    transfers.choose(card.id, { files: [0, 1, 2] });
    assert.equal(view(card).chosen, null);
});

test('a download whose list couldn\'t be read fails, with no Retry; one that failed with its list read can wait again; at once follows Settings', () => {
    const { transfers, started } = registry();
    const unread = addDownload(transfers);
    transfers.ended(unread.id, { status: 'error', error: 'The upload wasn\'t found. It may have expired.' });
    assert.equal(unread.state, 'failed');
    assert.equal(transfers.retry(unread.id, 1), null, 'nothing to download again');

    const read = addDownload(transfers);
    transfers.read(read.id, { files: [{ name: 'a.bin', size: 1 }], encrypted: false });
    transfers.start(read.id, SERVER);
    transfers.ended(read.id, { status: 'error', error: 'The connection was lost.' });
    assert.equal(transfers.retry(read.id, 1)?.state, 'waiting');

    // One at once: a second waits, and runs as soon as more are allowed.
    transfers.setAtOnce(1);
    const [first, second] = [addDownload(transfers), addDownload(transfers)];
    for (const { id } of [first, second]) {
        transfers.read(id, { files: [{ name: 'b.bin', size: 1 }], encrypted: false });
        transfers.start(id, SERVER);
    }
    assert.deepEqual([first.state, second.state], ['running', 'queued']);
    transfers.setAtOnce(2);
    assert.deepEqual([second.state, started.at(-1)], ['running', second.id]);
    // Removed while it reads: it goes, and nothing of it is left.
    const reading = addDownload(transfers);
    assert.deepEqual(transfers.remove([reading.id]).map(({ id }) => id), [reading.id]);
});
