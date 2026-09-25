// The preload contract: what the sandboxed preload may load, and the IPC
// channels main.js and the preload have to agree on.
//
// When this breaks, the app just goes quiet. A preload that requires the wrong
// module leaves window.electronAPI undefined, and a channel name that's wrong
// on one side drops its messages. Neither logs an error in the main process.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { channelsCalled, countCalls, readSource } from './helpers/source.mjs';

const preload = readSource('preload.js');
const main = readSource('main.js');
const pages = ['renderer.js', 'index.html', 'credits.html'].map((name) => ({ name, code: readSource(name) }));

// The only modules a sandboxed preload can load.
const SANDBOX_SAFE_MODULES = new Set(['electron', 'events', 'timers', 'url', 'node:events', 'node:timers', 'node:url']);

// Each IPC call and the call on the other side that has to use the same channel.
const PRELOAD_INVOKES = String.raw`ipcRenderer\.invoke`;
const PRELOAD_SENDS = String.raw`ipcRenderer\.(?:send|sendSync)`;
const PRELOAD_LISTENS = String.raw`ipcRenderer\.(?:on|once)`;
const MAIN_HANDLES = String.raw`ipcMain\.(?:handle|handleOnce)`;
const MAIN_LISTENS = String.raw`ipcMain\.(?:on|once)`;
const MAIN_SENDS = String.raw`(?:webContents|sender)\.send`;

const unique = (list) => [...new Set(list)];
const missingFrom = (list, known) => unique(list).filter((channel) => !new Set(known).has(channel));

test('the preload only loads modules a sandboxed preload can load', () => {
    const required = [...preload.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]);
    assert.ok(required.length > 0, 'expected the preload to require electron');

    const unsafe = required.filter((name) => !SANDBOX_SAFE_MODULES.has(name));
    assert.deepEqual(unsafe, [], `a sandboxed preload can't load: ${unsafe.join(', ')}`);
});

test('every IPC call names its channel as a string, so these checks can see it', () => {
    for (const [code, file, callees] of [
        [preload, 'preload.js', [PRELOAD_INVOKES, PRELOAD_SENDS, PRELOAD_LISTENS]],
        [main, 'main.js', [MAIN_HANDLES, MAIN_LISTENS, MAIN_SENDS]],
    ]) {
        for (const callee of callees) {
            assert.equal(channelsCalled(code, callee).length, countCalls(code, callee),
                `${file} has a ${callee.replace(/\\/g, '')} call without a literal channel name`);
        }
    }
});

test('every request from the preload has a handler in main.js', () => {
    const invokes = channelsCalled(preload, PRELOAD_INVOKES);
    const sends = channelsCalled(preload, PRELOAD_SENDS);
    assert.ok(invokes.length > 0 && sends.length > 0, 'expected the preload to invoke and send');

    const unhandled = [
        ...missingFrom(invokes, channelsCalled(main, MAIN_HANDLES)),
        ...missingFrom(sends, channelsCalled(main, MAIN_LISTENS)),
    ];
    assert.deepEqual(unhandled, [], `main.js has no handler for: ${unhandled.join(', ')}`);
});

test('every handler in main.js can be reached from the preload', () => {
    const unreachable = [
        ...missingFrom(channelsCalled(main, MAIN_HANDLES), channelsCalled(preload, PRELOAD_INVOKES)),
        ...missingFrom(channelsCalled(main, MAIN_LISTENS), channelsCalled(preload, PRELOAD_SENDS)),
    ];
    assert.deepEqual(unreachable, [], `nothing in the preload reaches: ${unreachable.join(', ')}`);
});

test('every message main.js sends reaches the page', {
    expectFailure: {
        label: 'known issue until the v4 desktop client: main.js sends file-open-error, and the preload never passes it on',
        match: /never reach the page: file-open-error$/m,
    },
}, () => {
    const sent = channelsCalled(main, MAIN_SENDS);
    assert.ok(sent.length > 0, 'expected main.js to send messages to the page');

    const unheard = missingFrom(sent, channelsCalled(preload, PRELOAD_LISTENS));
    assert.deepEqual(unheard, [], `these messages never reach the page: ${unheard.join(', ')}`);
});

test('every message the preload listens for is sent by main.js', () => {
    const listens = channelsCalled(preload, PRELOAD_LISTENS);
    assert.ok(listens.length > 0, 'expected the preload to listen for messages');

    const neverSent = missingFrom(listens, channelsCalled(main, MAIN_SENDS));
    assert.deepEqual(neverSent, [], `main.js never sends: ${neverSent.join(', ')}`);
});

test('the preload exposes one bridge, and the pages only call what it has', () => {
    const bridges = [...preload.matchAll(/exposeInMainWorld\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
    assert.deepEqual(bridges, ['electronAPI']);

    const exposed = new Set([...preload.matchAll(/^\s*(\w+):\s*\(/gm)].map((match) => match[1]));
    assert.ok(exposed.size > 0, 'expected the bridge to expose methods');

    const called = pages.flatMap(({ code }) => [...code.matchAll(/electronAPI\.(\w+)/g)].map((match) => match[1]));
    assert.ok(called.length > 0, 'expected the pages to use the bridge');
    const missing = unique(called).filter((name) => !exposed.has(name));
    assert.deepEqual(missing, [], `the pages call bridge methods the preload doesn't expose: ${missing.join(', ')}`);
});

test('the pages reach Node only through the bridge', () => {
    for (const { name, code } of pages) {
        assert.ok(!/\brequire\s*\(/.test(code), `${name} must not call require()`);
        assert.ok(!/\bprocess\.(?:env|versions|platform)\b/.test(code), `${name} must not reach for process`);
    }
});
