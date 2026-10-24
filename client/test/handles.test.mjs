// Main's handles: a window holds a file it was handed as an opaque handle,
// with its name and size, never its path, and a handle works only for the
// window it was handed to.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

const require = createRequire(import.meta.url);
const { Handles } = require('../src/core/handles.js');

let folder;
beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dropgate-handles-'));
});
afterEach(() => fs.rmSync(folder, { recursive: true, force: true }));

function fileOf(name, size) {
    const file = path.join(folder, name);
    fs.writeFileSync(file, Buffer.alloc(size, 1));
    return file;
}

test('a window gets a handle, the name and the size, and never the path; main keeps the path, the size and the modification time', () => {
    const handles = new Handles();
    const file = fileOf('Secret plans é.bin', 123);
    const given = handles.add(1, file);
    assert.deepEqual(Object.keys(given).sort(), ['handle', 'name', 'size']);
    assert.match(given.handle, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(given.name, 'Secret plans é.bin');
    assert.equal(given.size, 123);
    assert.ok(!JSON.stringify(given).includes(folder), 'what the window gets holds no folder');
    const held = handles.get(1, given.handle);
    assert.equal(held.path, file);
    assert.equal(held.mtimeMs, fs.statSync(file).mtimeMs);
});

test('a handle works only for its window, and a path is never a handle', () => {
    const handles = new Handles();
    const file = fileOf('Mine.bin', 10);
    const { handle } = handles.add(1, file);
    assert.equal(handles.get(2, handle), null, 'another window');
    assert.equal(handles.get(1, file), null, 'the path');
    assert.equal(handles.get(1, { handle }), null);
    handles.revoke(2, handle);
    assert.ok(handles.get(1, handle), 'another window can\'t revoke it');
});

test('a file handed to the same window again keeps its handle, taken as it is now; revoked, or with its window gone, it\'s forgotten', () => {
    const handles = new Handles();
    const file = fileOf('Again.bin', 10);
    const first = handles.add(1, file);
    fs.writeFileSync(file, Buffer.alloc(20, 2));
    const again = handles.add(1, file);
    assert.equal(again.handle, first.handle);
    assert.equal(again.size, 20);
    assert.equal(handles.get(1, first.handle).size, 20);
    assert.notEqual(handles.add(2, file).handle, first.handle, 'another window gets its own');

    handles.revoke(1, first.handle);
    assert.equal(handles.get(1, first.handle), null);
    const other = handles.add(3, file);
    handles.dropOwner(3);
    assert.equal(handles.get(3, other.handle), null);
    assert.throws(() => handles.add(1, path.join(folder, 'Missing.bin')), /ENOENT/);
});
