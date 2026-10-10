// The preload contract: what the sandboxed preload may load, and the IPC
// channels main.js, the preload and src/constants.js have to agree on.
//
// When this breaks, the app just goes quiet. A preload that requires the wrong
// module leaves window.electronAPI undefined, and a channel name that's wrong
// on one side drops its messages. Neither logs an error in the main process.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readSource } from './helpers/source.mjs';

const require = createRequire(import.meta.url);
const { loadPreload } = require('@diamonddigitaldev/electron-kit/testing');
const { IPC, PUSHES } = require('../src/constants.js');

const PRELOAD = fileURLToPath(new URL('../src/preload.js', import.meta.url));
const preload = readSource('preload.js');
const main = readSource('main.js');
const channels = readSource('window-channels.js');
const renderer = readSource('renderer.js');
const html = readSource('index.html');

const unique = (list) => [...new Set(list)];

/** Each bridge method, called once, and the IPC call it made. */
function bridgeCalls() {
    const { required, exposed, calls } = loadPreload(PRELOAD);
    const made = {};
    for (const [name, fn] of Object.entries(exposed.electronAPI)) {
        const before = calls.length;
        fn(() => {});
        made[name] = calls.slice(before);
    }
    return { required, exposed, made };
}

test('the preload runs sandboxed, requiring electron only', () => {
    const { required, exposed } = bridgeCalls();
    assert.deepEqual(unique(required), ['electron']);
    assert.deepEqual(Object.keys(exposed), ['electronAPI'], 'one bridge, window.electronAPI; the kit\'s is window.kitAPI');
});

test('every call of the bridge makes one IPC call, on a channel in constants.js', () => {
    const known = new Set(Object.values(IPC));
    for (const [name, calls] of Object.entries(bridgeCalls().made)) {
        assert.equal(calls.length, 1, `electronAPI.${name}() makes one IPC call`);
        assert.ok(known.has(calls[0].channel), `electronAPI.${name}() uses "${calls[0].channel}", which isn't in constants.js`);
    }
});

test('the page asks main with invoke(), and only listens for pushes', () => {
    for (const [name, [call]] of Object.entries(bridgeCalls().made)) {
        const push = PUSHES.includes(call.channel);
        assert.equal(call.method, push ? 'on' : 'invoke', `electronAPI.${name}() on "${call.channel}"`);
    }
});

test('every channel in constants.js is one the bridge uses', () => {
    const used = new Set(Object.values(bridgeCalls().made).flat().map((c) => c.channel));
    const unused = Object.values(IPC).filter((channel) => !used.has(channel));
    assert.deepEqual(unused, [], `nothing in the preload uses: ${unused.join(', ')}`);
});

test('the preload\'s inlined channel table is constants.js\' map', () => {
    const table = Object.fromEntries([...preload.matchAll(/^\s*([A-Z_]+):\s*'([^']+)',/gm)].map((m) => [m[1], m[2]]));
    assert.deepEqual(table, { ...IPC });
});

test('every request from the page is answered in window-channels.js, through kit.ipc.handle(), which answers the app\'s own page in the UI session only', () => {
    for (const [name, code] of [['main.js', main], ['window-channels.js', channels]]) {
        assert.ok(!/\bipcMain\b/.test(code), `${name} must not register a handler straight on ipcMain: it would answer any page`);
    }
    assert.doesNotMatch(main, /kit\.ipc\.handle\(/, 'main.js answers the window through window-channels.js');
    assert.match(main, /^answerWindowChannels\(\{$/m);
    assert.doesNotMatch(channels, /\bsession\b/, 'the window\'s channels are the UI session\'s: none is answered in another');
    const handled = [...channels.matchAll(/kit\.ipc\.handle\(IPC\.([A-Z_]+)/g)].map((m) => IPC[m[1]]);
    assert.equal(handled.length, unique(handled).length, 'each channel is handled once');
    assert.deepEqual(handled.sort(), Object.values(IPC).filter((c) => !PUSHES.includes(c)).sort());
});

test('every message main.js sends reaches the page, and the page hears nothing main.js never sends', () => {
    // v3 sent file-open-error, which its preload never passed on, so an Open File that failed said nothing.
    const sent = unique([...main.matchAll(/\.send\(IPC\.([A-Z_]+)/g)].map((m) => IPC[m[1]]));
    assert.deepEqual(sent.sort(), [...PUSHES].sort());
});

test('channel names are "domain:action", unique, and none is one of the kit\'s', () => {
    const values = Object.values(IPC);
    assert.equal(new Set(values).size, values.length, 'a channel name is used twice');
    for (const [name, channel] of Object.entries(IPC)) {
        assert.match(channel, /^[a-z][a-z0-9]*(-[a-z0-9]+)*:[a-z][a-z0-9]*(-[a-z0-9]+)*$/, `${name} ("${channel}")`);
    }
    const { CHANNELS } = require('@diamonddigitaldev/electron-kit/main');
    for (const channel of Object.values(CHANNELS)) assert.ok(!values.includes(channel), `${channel} is the kit's`);
});

test('the window\'s bridge takes a path on one channel only, files:add: a file is a handle from then on', () => {
    const params = Object.fromEntries([...preload.matchAll(/^\s{4}(\w+): \(([^)]*)\) =>/gm)].map((m) => [m[1], m[2]]));
    assert.deepEqual(Object.keys(params).sort(), Object.keys(bridgeCalls().exposed.electronAPI).sort(), 'every bridge method\'s parameters are read');
    assert.deepEqual(Object.entries(params).filter(([, p]) => /path/i.test(p)).map(([name]) => name), ['addFiles']);
    assert.equal(bridgeCalls().made.addFiles[0].channel, IPC.FILES_ADD);
    assert.deepEqual(Object.values(IPC).filter((channel) => /path/i.test(channel)), [], 'no channel is named for a path');
});

test('the page only calls what the bridges have', () => {
    const exposed = new Set(Object.keys(bridgeCalls().exposed.electronAPI));
    const called = unique([...renderer.matchAll(/\bapi\.(\w+)/g)].map((m) => m[1]));
    assert.ok(called.length > 0, 'expected the page to use its bridge');
    const missing = called.filter((name) => !exposed.has(name));
    assert.deepEqual(missing, [], `the page calls bridge methods the preload doesn't expose: ${missing.join(', ')}`);
    assert.match(renderer, /const api = window\.electronAPI;/);
    assert.match(renderer, /const kitApi = window\.kitAPI;/);
});

test('the page reaches Node only through the bridges', () => {
    for (const [name, code] of [['renderer.js', renderer], ['index.html', html]]) {
        assert.ok(!/\brequire\s*\(/.test(code), `${name} must not call require()`);
        assert.ok(!/\bprocess\.(?:env|versions|platform)\b/.test(code), `${name} must not reach for process`);
    }
});
