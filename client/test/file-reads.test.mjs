// Main's file:read-range, on real files: the page reads only the files main
// handed it, and, like a browser's File and core's sources.fileHandle(), none
// that has changed since, by its size or its modification time. So a file
// edited while its upload runs, or while it's paused, is never sent part old,
// part new.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { readSource } from './helpers/source.mjs';

const require = createRequire(import.meta.url);
const { FileReads } = require('../src/core/file-reads.js');

let folder;
beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dropgate-file-reads-'));
});
afterEach(() => fs.rmSync(folder, { recursive: true, force: true }));

/** A file of `size` bytes counting up from 0, with a modification time a minute ago. */
function fileOf(name, size) {
    const file = path.join(folder, name);
    fs.writeFileSync(file, Buffer.from(Array.from({ length: size }, (_, i) => i % 256)));
    const then = new Date(Date.now() - 60_000);
    fs.utimesSync(file, then, then);
    return file;
}

test('a file handed over reads by range, as it was chosen', () => {
    const reads = new FileReads();
    const file = fileOf('Chosen é.bin', 1000);
    assert.deepEqual(reads.handOver(file), { name: 'Chosen é.bin', size: 1000, filePath: file });
    assert.deepEqual([...reads.read(file, 10, 14)], [10, 11, 12, 13]);
    assert.equal(reads.read(file, 0, 1000).length, 1000);
    // Past the end, it gives what there is (core refuses a short read itself).
    assert.equal(reads.read(file, 990, 1010).length, 10);
});

test('a file not handed over, or given back, is never read', () => {
    const reads = new FileReads();
    const file = fileOf('Never chosen.bin', 100);
    assert.throws(() => reads.read(file, 0, 10), /not authorized/);
    reads.handOver(file);
    reads.revoke(file);
    assert.throws(() => reads.read(file, 0, 10), /not authorized/);
    reads.handOver(file);
    assert.throws(() => reads.read(file, 10, 5), /range/);
    assert.throws(() => reads.read(file, -1, 5), /range/);
});

test('a file edited since it was chosen is refused: the same size with a new modification time, or a new size', () => {
    const reads = new FileReads();
    const sameSize = fileOf('Edited in place.bin', 100);
    reads.handOver(sameSize);
    assert.equal(reads.read(sameSize, 0, 50).length, 50);
    // The same number of bytes, other ones: only the modification time says so.
    fs.writeFileSync(sameSize, Buffer.alloc(100, 7));
    assert.deepEqual(reads.read(sameSize, 50, 100), { changed: true });
    assert.deepEqual(reads.read(sameSize, 0, 50), { changed: true }, 'the part already read, again');

    const grown = fileOf('Grown.bin', 100);
    const { mtime } = fs.statSync(grown);
    reads.handOver(grown);
    fs.appendFileSync(grown, Buffer.alloc(10));
    // Even with its modification time put back.
    fs.utimesSync(grown, mtime, mtime);
    assert.deepEqual(reads.read(grown, 0, 10), { changed: true });

    const shrunk = fileOf('Shrunk.bin', 100);
    reads.handOver(shrunk);
    fs.truncateSync(shrunk, 40);
    assert.deepEqual(reads.read(shrunk, 0, 10), { changed: true });
});

test('a file chosen again after an edit reads as it is now', () => {
    const reads = new FileReads();
    const file = fileOf('Chosen twice.bin', 100);
    reads.handOver(file);
    fs.writeFileSync(file, Buffer.alloc(120, 9));
    assert.deepEqual(reads.read(file, 0, 10), { changed: true });
    assert.equal(reads.handOver(file).size, 120);
    assert.deepEqual([...reads.read(file, 0, 3)], [9, 9, 9]);
});

test('main reads every range through this check, and the page turns a refusal into core\'s SOURCE_UNAVAILABLE', () => {
    const main = readSource('main.js');
    const renderer = readSource('renderer.js');
    assert.match(main, /kit\.ipc\.handle\(IPC\.FILE_READ_RANGE, \(_event, filePath, start, end\) => fileReads\.read\(filePath, start, end\)\)/);
    assert.match(main, /const handOver = \(filePath\) => fileReads\.handOver\(filePath\);/);
    assert.doesNotMatch(main, /readSync|openSync|authorizedFilePaths/, 'main reads files only through FileReads');
    assert.match(renderer, /if \(bytes\?\.changed\) \{\s*throw new DropgateError\(\{\s*code: 'SOURCE_UNAVAILABLE',/);
});
