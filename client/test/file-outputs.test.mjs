// The file service's writes, on real files: a download writes only into the
// output main granted it, by the output's ID, never by a path. It's written in
// the partial folder under a random name that holds nothing of its own, then
// moved into its folder under its name made safe (core's filenames.sanitize())
// and unique there ("report (1).pdf"), replacing nothing, following no link
// planted in the folder. Aborted, or unfinished, nothing of it is left.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

const require = createRequire(import.meta.url);
const { FileService } = require('../src/core/file-service.js');
const { filenames } = require('../src/dropgate-core.js');

let root;
let folder;
let partials;
let saved;
let service;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dropgate-file-outputs-'));
    folder = path.join(root, 'Saved Here');
    partials = path.join(root, 'Partial Downloads');
    fs.mkdirSync(folder);
    saved = [];
    service = new FileService({ partials, onSaved: (where) => saved.push(where) });
});
afterEach(() => {
    service.revokeAll();
    fs.rmSync(root, { recursive: true, force: true });
});

let nextId = 0;
const ask = (request) => service.answer({ id: nextId++, ...request });
const refused = (answer) => typeof answer.error === 'string' && answer.error.startsWith('Refused');
const bytesOf = (size, seed = 1) => Buffer.from(Array.from({ length: size }, (_, i) => (i * seed) % 256));

/** Grant an output as main does, into `into`, and return its ID. */
function grantOutput(into = folder) {
    const output = randomUUID();
    service.grantOutput({ output, folder: into, shape: 'file' });
    return output;
}

/** Save one file through an output, as a download does: open, write in pieces, close. Returns the answers. */
async function saveFile(name, bytes, into = folder) {
    const output = grantOutput(into);
    const opened = ask({ op: 'open', output, name, size: bytes.length, index: 0 });
    assert.ok(opened.sink, `opened ${JSON.stringify(name)}: ${JSON.stringify(opened)}`);
    for (let at = 0; at < bytes.length; at += 1000) {
        assert.deepEqual(ask({ op: 'write', sink: opened.sink, bytes: new Uint8Array(bytes.subarray(at, at + 1000)) }), { id: nextId - 1, ok: true });
    }
    const closed = await ask({ op: 'close', sink: opened.sink });
    return { output, opened, closed };
}

const listing = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);

test('a download is written in the partial folder under a random name, then moved into its folder under its own, byte for byte', async () => {
    const bytes = bytesOf(5000, 7);
    const output = grantOutput();
    const { sink, name } = ask({ op: 'open', output, name: 'Quarterly accounts é.pdf', size: bytes.length, index: 0 });
    assert.equal(name, 'Quarterly accounts é.pdf');
    ask({ op: 'write', sink, bytes: new Uint8Array(bytes.subarray(0, 2000)) });

    // While it runs: in the partial folder alone, under a name that's a random UUID, holding nothing of its own.
    const [partial] = listing(partials);
    assert.match(partial, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.deepEqual(listing(folder), []);
    assert.equal(fs.statSync(path.join(partials, partial)).size, 2000);

    ask({ op: 'write', sink, bytes: new Uint8Array(bytes.subarray(2000)) });
    assert.deepEqual(await ask({ op: 'close', sink }), { id: nextId - 1, ok: true, name: 'Quarterly accounts é.pdf' });
    assert.deepEqual(listing(folder), ['Quarterly accounts é.pdf']);
    assert.deepEqual(fs.readFileSync(path.join(folder, 'Quarterly accounts é.pdf')), bytes);
    assert.deepEqual(listing(partials), [], 'nothing left in the partial folder');
    assert.deepEqual(saved, [{ output, path: path.join(fs.realpathSync(folder), 'Quarterly accounts é.pdf') }]);
});

test('every awkward name lands directly in the folder, under the name core makes safe, and nothing else is made', async () => {
    const names = ['ünïcode.txt', '日本語のファイル.txt', 'emoji 😀.txt', 'photo‮gnp.exe', 'family‍.txt', 'CON.txt', 'a.', 'a:b', '..\\..\\x', '../../y', 'report.pdf. '];
    for (const name of names) {
        const { closed } = await saveFile(name, bytesOf(10));
        assert.equal(closed.name, filenames.sanitize(name), name);
    }
    const expected = names.map((name) => filenames.sanitize(name)).sort();
    assert.deepEqual(listing(folder), expected);
    // Nothing escaped the folder, and no stream was made from a name (a:b is a_b, a file of its own).
    assert.deepEqual(listing(root).sort(), ['Partial Downloads', 'Saved Here']);
    assert.ok(expected.every((name) => !/[\\/:]/.test(name)));
    assert.ok(!expected.includes('CON.txt') && expected.includes('_CON.txt'));
});

test('a name taken gets "name (1).ext", without regard to case, and nothing is ever replaced', async () => {
    fs.writeFileSync(path.join(folder, 'Report.PDF'), 'mine');
    const first = await saveFile('report.pdf', bytesOf(10, 3));
    const second = await saveFile('report.pdf', bytesOf(10, 5));
    assert.equal(first.closed.name, 'report (1).pdf');
    assert.equal(second.closed.name, 'report (2).pdf');
    assert.equal(fs.readFileSync(path.join(folder, 'Report.PDF'), 'utf8'), 'mine', 'the file there is untouched');

    // Two downloads writing the same name at once get a name each.
    const [a, b] = [grantOutput(), grantOutput()];
    const openA = ask({ op: 'open', output: a, name: 'notes.txt', size: 1, index: 0 });
    const openB = ask({ op: 'open', output: b, name: 'NOTES.txt', size: 1, index: 0 });
    assert.notEqual(openA.name.toLowerCase(), openB.name.toLowerCase());

    // One that appears under the name while it's written: the next name, at the move.
    const c = grantOutput();
    const openC = ask({ op: 'open', output: c, name: 'late.txt', size: 1, index: 0 });
    fs.writeFileSync(path.join(folder, 'late.txt'), 'there first');
    ask({ op: 'write', sink: openC.sink, bytes: new Uint8Array([1]) });
    assert.equal((await ask({ op: 'close', sink: openC.sink })).name, 'late (1).txt');
    assert.equal(fs.readFileSync(path.join(folder, 'late.txt'), 'utf8'), 'there first');
});

test('a link planted in the folder under the name isn\'t followed', async (t) => {
    const outside = path.join(root, 'outside.txt');
    fs.writeFileSync(outside, 'outside');
    try {
        fs.symlinkSync(outside, path.join(folder, 'planted.txt'), 'file');
    } catch (error) {
        // Windows makes symbolic links only with Developer Mode or as an administrator.
        t.skip(`can't make a symbolic link here (${error.code})`);
        return;
    }
    const { closed } = await saveFile('planted.txt', bytesOf(10));
    assert.equal(closed.name, 'planted (1).txt');
    assert.equal(fs.readFileSync(outside, 'utf8'), 'outside', 'what the link points to is untouched');
    assert.ok(fs.lstatSync(path.join(folder, 'planted.txt')).isSymbolicLink());
});

test('onto another drive, or one without hard links, it\'s copied, never over a file there, and the partial goes', async (t) => {
    const link = fs.linkSync;
    t.after(() => {
        fs.linkSync = link;
    });
    fs.linkSync = () => {
        throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
    };
    fs.writeFileSync(path.join(folder, 'copied.bin'), 'mine');
    const bytes = bytesOf(3000, 11);
    const { closed } = await saveFile('copied.bin', bytes);
    assert.equal(closed.name, 'copied (1).bin');
    assert.deepEqual(fs.readFileSync(path.join(folder, 'copied (1).bin')), bytes);
    assert.equal(fs.readFileSync(path.join(folder, 'copied.bin'), 'utf8'), 'mine');
    assert.deepEqual(listing(partials), []);
});

test('aborted, or closed before it\'s whole, nothing of it is left; a write past its size is refused', async () => {
    const output = grantOutput();
    const opened = ask({ op: 'open', output, name: 'cancelled.bin', size: 100, index: 0 });
    ask({ op: 'write', sink: opened.sink, bytes: new Uint8Array(50) });
    assert.deepEqual(ask({ op: 'abort', sink: opened.sink }), { id: nextId - 1, ok: true });
    assert.deepEqual([listing(partials), listing(folder)], [[], []]);
    assert.ok(refused(ask({ op: 'write', sink: opened.sink, bytes: new Uint8Array(1) })), 'its sink is gone');

    const short = grantOutput();
    const half = ask({ op: 'open', output: short, name: 'short.bin', size: 100, index: 0 });
    assert.ok(refused(ask({ op: 'write', sink: half.sink, bytes: new Uint8Array(101) })), 'more than its size');
    ask({ op: 'write', sink: half.sink, bytes: new Uint8Array(40) });
    const closed = await ask({ op: 'close', sink: half.sink });
    assert.equal(closed.failed, 'The download ended before the whole file came.');
    assert.deepEqual([listing(partials), listing(folder)], [[], []]);
    assert.deepEqual(saved, []);
});

test('an output revoked, or the service stopping, deletes the file still being written', () => {
    const output = grantOutput();
    ask({ op: 'open', output, name: 'paused.bin', size: 100, index: 0 });
    assert.equal(listing(partials).length, 1, 'held open while paused, in the partial folder');
    service.revokeOutput(output);
    assert.deepEqual(listing(partials), []);
    const again = grantOutput();
    ask({ op: 'open', output: again, name: 'quitting.bin', size: 100, index: 0 });
    service.revokeAll();
    assert.deepEqual(listing(partials), []);
});

test('only an output main granted is written, by its ID: never a path, and one file per output', () => {
    assert.ok(refused(ask({ op: 'open', output: randomUUID(), name: 'x.bin', size: 1, index: 0 })), 'an output never granted');
    assert.ok(refused(ask({ op: 'open', output: folder, name: 'x.bin', size: 1, index: 0 })), 'a folder\'s path, in place of an output');
    const output = grantOutput();
    assert.ok(refused(ask({ op: 'open', output, name: 'x.bin', size: 1, index: 0, folder })), 'a request carrying a folder');
    for (const [name, size] of [['', 1], ['x'.repeat(256), 1], [42, 1], ['x.bin', -1], ['x.bin', 1.5], ['x.bin', '1']]) {
        assert.ok(refused(ask({ op: 'open', output, name, size, index: 0 })), `${String(name).slice(0, 20)} of ${size}`);
    }
    ask({ op: 'open', output, name: 'one.bin', size: 1, index: 0 });
    assert.ok(refused(ask({ op: 'open', output, name: 'two.bin', size: 1, index: 1 })), 'a second file on a one-file output');
    assert.ok(refused(ask({ op: 'write', sink: randomUUID(), bytes: new Uint8Array(1) })));
    assert.ok(refused(ask({ op: 'write', sink: 'not-a-sink', bytes: 'text' })));
    assert.throws(() => service.grantOutput({ output: 'not-a-uuid', folder, shape: 'file' }), /output/);
    assert.throws(() => service.grantOutput({ output: randomUUID(), folder: 'relative', shape: 'file' }), /folder/);
    assert.throws(() => service.grantOutput({ output: randomUUID(), folder, shape: 'zip' }), /how the download is saved/);
    assert.throws(() => new FileService().grantOutput({ output: randomUUID(), folder, shape: 'file' }), /partial folder/);
});

test('a folder gone fails with the reason, naming no folder, and leaves nothing', async () => {
    const gone = path.join(root, 'Gone');
    fs.mkdirSync(gone);
    const output = grantOutput(gone);
    fs.rmSync(gone, { recursive: true });
    const answer = ask({ op: 'open', output, name: 'x.bin', size: 1, index: 0 });
    assert.equal(answer.failed, "The folder to save to isn't there any more.");

    // Gone while it's written: the move fails, and nothing is left of it.
    const later = path.join(root, 'Later');
    fs.mkdirSync(later);
    const out = grantOutput(later);
    const opened = ask({ op: 'open', output: out, name: 'x.bin', size: 1, index: 0 });
    ask({ op: 'write', sink: opened.sink, bytes: new Uint8Array([1]) });
    fs.rmSync(later, { recursive: true });
    const closed = await ask({ op: 'close', sink: opened.sink });
    assert.equal(typeof closed.failed, 'string');
    assert.ok(!closed.failed.includes(root), 'no path in the reason');
    assert.deepEqual(listing(partials), []);
});

test('a deep folder and a long name: saved, long-path aware, with nothing left in the partial folder', async () => {
    // Past Windows' old 260-character limit, and a name of 200 characters.
    let deep = folder;
    while (deep.length < 400) deep = path.join(deep, 'a folder with a long name for the test');
    fs.mkdirSync(deep, { recursive: true });
    const name = `${'n'.repeat(196)}.bin`;
    const bytes = bytesOf(2000, 13);
    const { closed } = await saveFile(name, bytes, deep);
    assert.equal(closed.name, name);
    assert.ok(path.join(deep, name).length > 600);
    assert.deepEqual(fs.readFileSync(path.join(deep, name)), bytes);
    assert.deepEqual(listing(partials), []);
});
