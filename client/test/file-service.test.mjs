// The file service's reads, on real files: the transfer window reads only the
// files main granted for its upload, by grant, never by path, and, like a
// browser's File and core's sources.fileHandle(), none that has changed since
// it was handed over, by its size or its modification time. So a file edited
// while its upload runs, or while it's paused, is never sent part old, part
// new.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { readSource } from './helpers/source.mjs';

const require = createRequire(import.meta.url);
const { FileService } = require('../src/core/file-service.js');
const { READ_PIECE_BYTES } = require('../src/constants.js');

let folder;
let service;
beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dropgate-file-service-'));
    service = new FileService();
});
afterEach(() => {
    service.revokeAll();
    fs.rmSync(folder, { recursive: true, force: true });
});

/** A file of `size` bytes counting up from 0, with a modification time a minute ago. */
function fileOf(name, size) {
    const file = path.join(folder, name);
    fs.writeFileSync(file, Buffer.from(Array.from({ length: size }, (_, i) => i % 256)));
    const then = new Date(Date.now() - 60_000);
    fs.utimesSync(file, then, then);
    return file;
}

/** Grant a file as main does, with its size and modification time now, and return the grant. */
function grant(file) {
    const handle = randomUUID();
    const { size, mtimeMs } = fs.statSync(file);
    service.grantRead({ handle, path: file, size, mtimeMs });
    return handle;
}

let nextId = 0;
const read = (handle, start, end) => service.answer({ id: nextId++, op: 'read', handle, start, end });
const refused = (answer) => typeof answer.error === 'string' && answer.error.startsWith('Refused') && !answer.bytes;

test('a granted file reads by range, as it was handed over, each answer naming its request', () => {
    const handle = grant(fileOf('Chosen é.bin', 1000));
    const answer = service.answer({ id: 7, op: 'read', handle, start: 10, end: 14 });
    assert.equal(answer.id, 7);
    assert.deepEqual([...answer.bytes], [10, 11, 12, 13]);
    assert.equal(read(handle, 0, 1000).bytes.length, 1000);
    assert.equal(read(handle, 990, 1000).bytes.length, 10);
    assert.equal(read(handle, 500, 500).bytes.length, 0);
});

test('a read is refused for an unknown handle, any path, and a grant revoked', () => {
    const file = fileOf('Never granted.bin', 100);
    assert.ok(refused(read(randomUUID(), 0, 10)), 'a handle never granted');
    assert.ok(refused(read(file, 0, 10)), 'the file\'s path, in place of a handle');
    assert.ok(refused(service.answer({ id: 1, op: 'read', handle: grant(file), path: file, start: 0, end: 10 })), 'a request carrying a path');
    assert.ok(refused(read({ path: file }, 0, 10)), 'a path in an object');
    const handle = grant(file);
    service.revoke(handle);
    assert.ok(refused(read(handle, 0, 10)), 'a grant revoked');
    assert.throws(() => service.grantRead({ handle: 'not-a-uuid', path: file, size: 100, mtimeMs: 0 }), /grant/);
    assert.throws(() => service.grantRead({ handle: randomUUID(), path: 'relative.bin', size: 100, mtimeMs: 0 }), /file/);
});

test('a read is refused for a range outside the file, not whole numbers, or bigger than a piece', () => {
    const handle = grant(fileOf('Ranges.bin', 100));
    for (const [start, end] of [[10, 5], [-1, 5], [0, 101], [99, 120], [0.5, 10], [0, 10.5], ['0', 10], [0, Number.MAX_SAFE_INTEGER + 1], [0, Infinity], [NaN, 10]]) {
        assert.ok(refused(read(handle, start, end)), `${start} to ${end}`);
    }
    const big = grant(fileOf('Big.bin', READ_PIECE_BYTES + 10));
    assert.ok(refused(read(big, 0, READ_PIECE_BYTES + 1)), 'more than a piece at once');
    assert.equal(read(big, 0, READ_PIECE_BYTES).bytes.length, READ_PIECE_BYTES);
    // Not a read at all: refused, and answered under its own ID when it has one.
    assert.ok(refused(service.answer({ id: 3, op: 'write', handle, start: 0, end: 1 })));
    assert.equal(service.answer({ id: 3, op: 'write', handle, start: 0, end: 1 }).id, 3);
    assert.ok(refused(service.answer(null)));
    assert.ok(refused(service.answer({ op: 'read', handle, start: 0, end: 1 })), 'a read with no ID');
});

test('a file edited since it was handed over answers { changed: true }: the same size with a new modification time, or a new size', () => {
    const sameSize = fileOf('Edited in place.bin', 100);
    const handle = grant(sameSize);
    assert.equal(read(handle, 0, 50).bytes.length, 50);
    // The same number of bytes, other ones: only the modification time says so.
    fs.writeFileSync(sameSize, Buffer.alloc(100, 7));
    assert.deepEqual(read(handle, 50, 100), { id: nextId - 1, changed: true });
    assert.equal(read(handle, 0, 50).changed, true, 'the part already read, again');

    const grown = fileOf('Grown.bin', 100);
    const { mtime } = fs.statSync(grown);
    const grownHandle = grant(grown);
    fs.appendFileSync(grown, Buffer.alloc(10));
    // Even with its modification time put back.
    fs.utimesSync(grown, mtime, mtime);
    assert.equal(read(grownHandle, 0, 10).changed, true);

    const shrunk = fileOf('Shrunk.bin', 100);
    const shrunkHandle = grant(shrunk);
    fs.truncateSync(shrunk, 40);
    assert.equal(read(shrunkHandle, 0, 10).changed, true);
});

test('a file gone before its first read answers { gone: true }, and one granted again after an edit reads as it is now', () => {
    const gone = fileOf('Deleted.bin', 100);
    const goneHandle = grant(gone);
    fs.rmSync(gone);
    assert.equal(read(goneHandle, 0, 10).gone, true);

    const file = fileOf('Chosen twice.bin', 100);
    const first = grant(file);
    fs.writeFileSync(file, Buffer.alloc(120, 9));
    assert.equal(read(first, 0, 10).changed, true);
    const second = grant(file);
    assert.deepEqual([...read(second, 0, 3).bytes], [9, 9, 9]);
    assert.equal(read(second, 100, 120).bytes.length, 20);
});

test('the file service answers the transfer window\'s port, makes no request, and the transfer window turns a refusal into core\'s SOURCE_UNAVAILABLE', () => {
    const entry = readSource('file-service.js');
    assert.match(entry, /port\.on\('message', \(\{ data \}\) => port\.postMessage\(service\.answer\(data\)\)\);/);
    assert.match(entry, /case FILE_SERVICE\.GRANT_READ:/);
    assert.match(entry, /case FILE_SERVICE\.REVOKE:/);
    for (const code of [entry, readSource('core/file-service.js')]) {
        assert.doesNotMatch(code, /require\('(?:node:)?(?:https?|http2|net|tls|dgram|dns|child_process|electron)'\)/, 'no network, no Electron');
    }
    const page = readSource('transfer.js');
    assert.match(page, /if \(answer\.changed\) throw unavailable\(/);
    assert.match(page, /if \(answer\.gone\) throw unavailable\(/);
    assert.match(page, /new DropgateError\(\{ code: 'SOURCE_UNAVAILABLE', message \}\)/);
    assert.match(page, new RegExp(`const READ_PIECE_BYTES = 1024 \\* 1024;`));
    assert.equal(READ_PIECE_BYTES, 1024 * 1024, 'the transfer window reads in pieces of the size the file service allows');
});
