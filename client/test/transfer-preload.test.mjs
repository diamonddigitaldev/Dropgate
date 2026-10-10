// The transfer window's contract: its sandboxed preload, its page, its CSP,
// the channels main and it agree on, and how main makes it and the file
// service. The transfer window runs core and makes every request Dropgate
// makes; the file service reads the files; main stays out of the byte path.
//
// When this breaks, uploads just go quiet: a preload that requires the wrong
// module leaves window.engine undefined, and a channel name that's wrong on
// one side drops its messages, with no error in main.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { balancedBlock, constructorOptions, readSource } from './helpers/source.mjs';

const require = createRequire(import.meta.url);
const { loadPreload } = require('@diamonddigitaldev/electron-kit/testing');
const { ENGINE, ENGINE_PUSHES, FILE_SERVICE, IPC } = require('../src/constants.js');

const PRELOAD = fileURLToPath(new URL('../src/transfer-preload.js', import.meta.url));
const preload = readSource('transfer-preload.js');
const host = readSource('transfer-host.js');
const page = readSource('transfer.js');
const html = readSource('transfer.html');
const main = readSource('main.js');

const unique = (list) => [...new Set(list)];

/** The preload as it loads, then each bridge method called once, and the IPC call it made. */
function bridgeCalls() {
    const { required, exposed, calls } = loadPreload(PRELOAD);
    const atLoad = [...calls];
    const made = {};
    for (const [name, fn] of Object.entries(exposed.engine)) {
        const before = calls.length;
        fn(() => {});
        made[name] = calls.slice(before);
    }
    return { required, exposed, atLoad, made };
}

/** Each kit.ipc.handle() call in a source, as its channel's constant and the text from it to the next one. */
function handled(code, map) {
    return code.split('kit.ipc.handle(').slice(1).map((call) => {
        const [, name] = call.match(new RegExp(`^${map}\\.([A-Z_]+),`)) ?? [];
        return { name, call };
    });
}

test('the transfer preload runs sandboxed, requiring electron only, and gives its page window.engine alone', () => {
    const { required, exposed } = bridgeCalls();
    assert.deepEqual(unique(required), ['electron']);
    assert.deepEqual(Object.keys(exposed), ['engine'], 'no kitAPI and no electronAPI in the transfer window');
});

test('the transfer preload\'s inlined channel table is constants.js\' ENGINE', () => {
    const table = Object.fromEntries([...preload.matchAll(/^\s*([A-Z_]+):\s*'([^']+)',/gm)].map((m) => [m[1], m[2]]));
    assert.deepEqual(table, { ...ENGINE });
});

test('every call of window.engine makes one IPC call on an engine channel: invoke() to tell main, on() for its work', () => {
    const { atLoad, made } = bridgeCalls();
    const known = new Set(Object.values(ENGINE));
    for (const [name, calls] of Object.entries(made)) {
        assert.equal(calls.length, 1, `engine.${name}() makes one IPC call`);
        const [{ channel, method }] = calls;
        assert.ok(known.has(channel), `engine.${name}() uses "${channel}", which isn't in ENGINE`);
        assert.equal(method, ENGINE_PUSHES.includes(channel) ? 'on' : 'invoke', `engine.${name}() on "${channel}"`);
    }
    // The file service's port reaches the page as a window message, taken from the preload's own listener.
    assert.deepEqual(atLoad.map(({ method, channel }) => `${method} ${channel}`), [`on ${ENGINE.PORT}`]);
    const used = new Set([...atLoad, ...Object.values(made).flat()].map((c) => c.channel));
    assert.deepEqual(Object.values(ENGINE).filter((channel) => !used.has(channel)), [], 'every engine channel is one the preload uses');
});

test('engine channels are "domain:action" under engine:, none the window\'s or the kit\'s', () => {
    const values = Object.values(ENGINE);
    assert.equal(new Set(values).size, values.length);
    for (const channel of values) assert.match(channel, /^engine:[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
    for (const channel of Object.values(IPC)) assert.ok(!values.includes(channel), `${channel} is the window's`);
    const { CHANNELS } = require('@diamonddigitaldev/electron-kit/main');
    for (const channel of Object.values(CHANNELS)) assert.ok(!values.includes(channel), `${channel} is the kit's`);
});

test('main answers every engine channel through kit.ipc.handle() for the transfer session only, and sends it only its pushes', () => {
    assert.ok(!/\bipcMain\b/.test(host), 'transfer-host.js must not register a handler straight on ipcMain: it would answer any page');
    const calls = handled(host, 'ENGINE');
    assert.ok(calls.every(({ name }) => name), 'every handler in transfer-host.js is an engine channel');
    assert.deepEqual(calls.map(({ name }) => ENGINE[name]).sort(), Object.values(ENGINE).filter((c) => !ENGINE_PUSHES.includes(c)).sort());
    for (const { name, call } of calls) assert.match(call, /\n {4}\}, \{ session \}\);\n/, `ENGINE.${name} is answered for the transfer session only`);
    assert.match(host, /const session = kit\.sessions\.isolated\('transfer'\);/, 'its own isolated session, in memory');
    // What main sends it: its work, by send() and call(), and the port, by postMessage().
    const sent = unique([...host.matchAll(/(?:send|call|postMessage)\(ENGINE\.([A-Z_]+)/g)].map((m) => ENGINE[m[1]]));
    assert.deepEqual(sent.sort(), [...ENGINE_PUSHES].sort());
    // main.js answers only the window's own channels, never an engine one.
    assert.doesNotMatch(main, /\bENGINE\b/);
});

test('the transfer window is hidden, sandboxed, isolated and without Node, in its own session with its own preload, and can\'t navigate or open a window', () => {
    const windows = constructorOptions(host, 'BrowserWindow');
    assert.equal(windows.length, 1);
    const [options] = windows;
    assert.match(options, /show: false/);
    const prefs = balancedBlock(options, options.indexOf('{', options.search(/webPreferences:\s*\{/)));
    assert.match(prefs, /preload: path\.join\(__dirname, 'transfer-preload\.js'\)/);
    assert.match(prefs, /session,/);
    assert.match(prefs, /sandbox: true/);
    assert.match(prefs, /contextIsolation: true/);
    assert.match(prefs, /nodeIntegration: false/);
    assert.match(prefs, /backgroundThrottling: false/, 'core\'s timeouts and a pause\'s deadline run on its timers');
    for (const setting of [/contextIsolation:\s*false/, /nodeIntegration:\s*true/, /sandbox:\s*false/, /webSecurity:\s*false/, /partition:/]) {
        assert.doesNotMatch(host, setting);
    }
    assert.match(host, /contents\.on\('will-navigate', \(event\) => event\.preventDefault\(\)\);/);
    assert.match(host, /contents\.on\('will-redirect', \(event\) => event\.preventDefault\(\)\);/);
    assert.match(host, /contents\.setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\);/);
    assert.match(host, /win\.loadFile\(path\.join\(__dirname, 'transfer\.html'\)\);/);
});

test('the transfer page allows nothing but its own scripts and requests to servers, and has no Node and no bridge but window.engine', () => {
    const [, csp] = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/) ?? [];
    assert.equal(csp, "default-src 'none'; script-src 'self'; connect-src http: https:");
    assert.deepEqual([...html.matchAll(/<script[^>]*>/g)].map((m) => m[0]), ['<script type="module" src="transfer.js">']);
    assert.match(page, /^import \{ DropgateClient, DropgateError, lifetime \} from '\.\/dropgate-core\.js';/);
    assert.match(page, /const engine = window\.engine;/);
    assert.doesNotMatch(page, /\bkitAPI\b|\belectronAPI\b|\brequire\s*\(|\bprocess\.|innerHTML|\beval\(/);
    // The port is taken only from this window's own preload.
    assert.match(page, /if \(event\.source !== window \|\| event\.data !== 'engine:port' \|\| !event\.ports\?\.\[0\]\) return;/);
    // It calls only what window.engine has.
    const exposed = new Set(Object.keys(bridgeCalls().exposed.engine));
    const called = unique([...page.matchAll(/\bengine\.(\w+)/g)].map((m) => m[1]));
    assert.deepEqual(called.filter((name) => !exposed.has(name)), []);
});

test('the window runs no core and makes no request: core, and every server check, are the transfer window\'s', () => {
    const renderer = readSource('renderer.js');
    const index = readSource('index.html');
    assert.doesNotMatch(renderer, /^\s*import\b/m, 'renderer.js imports nothing');
    assert.doesNotMatch(renderer + index, /dropgate-core|\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/);
    assert.doesNotMatch(main, /\bnet\.(?:request|fetch)\(|require\('(?:node:)?https?'\)/, 'main asks no server anything (the kit\'s updater is the kit\'s)');
});

test('the file service is a utility process with no session, given one end of the transfer window\'s channel, and every file only as a grant', () => {
    assert.match(host, /utilityProcess\.fork\(path\.join\(__dirname, 'file-service\.js'\), \[\], \{/);
    const fork = balancedBlock(host, host.indexOf('{', host.indexOf('utilityProcess.fork(')));
    assert.doesNotMatch(fork, /session|partition|execArgv|env/, 'nothing but its name and quiet stdio');
    assert.match(host, /const \{ port1, port2 \} = new MessageChannelMain\(\);/);
    assert.match(host, /fileService\.postMessage\(\{ type: FILE_SERVICE\.PORT \}, \[port2\]\);/);
    assert.match(host, /event\.sender\.postMessage\(ENGINE\.PORT, null, \[windowPort\]\);/);
    // The transfer window gets each file's grant, name and size, never its path.
    assert.match(host, /send\(ENGINE\.UPLOAD, \{ id, server, options, files: granted\.map\(\(\{ handle, name, size \}\) => \(\{ handle, name, size \}\)\) \}\);/);
    assert.match(host, /fileService\.postMessage\(\{ type: FILE_SERVICE\.GRANT_READ, handle, path: filePath, size, mtimeMs \}\);/);
    assert.match(host, /fileService\?\.postMessage\(\{ type: FILE_SERVICE\.REVOKE, handle \}\);/);
    assert.deepEqual(Object.values(FILE_SERVICE).sort(), ['grant-read', 'port', 'revoke']);
});
