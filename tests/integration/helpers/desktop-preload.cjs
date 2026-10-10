// Test-only preload for the desktop app. The desktop fixtures load it with -r,
// before the app's own main script, so it's in place before the app does anything.
//
// It writes down what the app does that a person would notice outside its
// windows: notifications, the clipboard, windows being shown, uploads finishing,
// and the app quitting. Everything goes to the file named in DROPGATE_TEST_EVENTS,
// one JSON object per line, the moment it happens:
//   { at, pid, event: 'notification', title, body }
//   { at, pid, event: 'clipboard', text, types }      the app copied text, with these formats
//   { at, pid, event: 'clipboard-written' }           the copy finished (or error)
//   { at, pid, event: 'clipboard-read-back', text }   what the clipboard held after
//                                                      (or error, if it couldn't be read)
//   { at, pid, event: 'window', id, session }          a window was created, in the app's UI session
//                                                      ('ui') or one of its isolated ones ('isolated')
//   { at, pid, event: 'window-shown', id }             it was shown
//   { at, pid, event: 'window-ready', id }             it finished setting itself up
//   { at, pid, event: 'upload-finished', status, error }
//   { at, pid, event: 'request', url, session, persistent, page }
//                                                      a request to a server, as its session sent it: from
//                                                      which session, and which page (null: main's own)
//   { at, pid, event: 'ipc-large', channel, bytes }    a message to or from main bigger than IPC_LARGE
//   { at, pid, event: 'ipc-sizes', sizes }             as it quits: the biggest message main sent or got
//                                                      on each channel, in bytes, and how many
//   { at, pid, event: 'exit', code }
//
// Unless DROPGATE_TEST_REAL_CLIPBOARD is 1, the clipboard and notifications are
// only written down: nothing is copied and nothing is shown, so running the tests
// leaves your clipboard alone. With it (as in CI), the app's own calls go through,
// and the clipboard is read back once each copy has finished, if the app is still
// running by then. (Holding the app open until then made it hang in CI on Linux:
// after a copy made just before the app quit, the read-back never finished.)
//
// On Linux, Electron's spell checker downloads its dictionaries from Google's
// servers as the app starts, unless the app turns it off, as the kit does. So
// every session the app creates is pointed at DROPGATE_TEST_DICTIONARY_URL
// instead, an address on this machine: if the app ever asks again, it asks
// there (desktop/dictionaries.spec.mjs).
//
// Every request to a server is written down with the session that sent it,
// from that session's own request hooks (webRequest): Chromium's net log
// names no session. And every message main sends or gets, over IPC or to and
// from its utility processes, is measured (v8's serialisation, as structured
// clone copies it), so a test can tell main never carries a file's bytes.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const v8 = require('node:v8');
const { app, BrowserWindow, clipboard, ipcMain, Notification, session, utilityProcess } = require('electron');

// Take this preload's own "-r <path>" back out of the command line, so the app
// sees only the arguments it would be given when launched normally.
const at = process.argv.findIndex((arg) => path.resolve(arg) === __filename);
if (at > 0 && ['-r', '--require'].includes(process.argv[at - 1])) process.argv.splice(at - 1, 2);

const EVENTS = process.env.DROPGATE_TEST_EVENTS;
if (!EVENTS) throw new Error('DROPGATE_TEST_EVENTS must name the file to write events to.');
const real = process.env.DROPGATE_TEST_REAL_CLIPBOARD === '1';

const record = (event) => fs.appendFileSync(EVENTS, `${JSON.stringify({ at: Date.now(), pid: process.pid, ...event })}\n`);

const DICTIONARIES = process.env.DROPGATE_TEST_DICTIONARY_URL;
if (!DICTIONARIES?.startsWith('http://127.0.0.1:')) {
    throw new Error('DROPGATE_TEST_DICTIONARY_URL must be an address on 127.0.0.1, for the spell checker\'s dictionaries.');
}
app.on('session-created', (created) => created.setSpellCheckerDictionaryDownloadURL(DICTIONARIES));
app.whenReady().then(() => session.defaultSession.setSpellCheckerDictionaryDownloadURL(DICTIONARIES));

// The app copies with clipboard.write([ClipboardItem]), the link and the
// formats that keep it out of the clipboard's history in one item. Its text is
// read back from the item (its own, never the OS clipboard's), which is
// asynchronous, so the app's quit waits until each copy is written down.
let reading = 0;
app.on('will-quit', (event) => {
    if (reading === 0) return;
    event.preventDefault();
    const wait = setInterval(() => {
        if (reading > 0) return;
        clearInterval(wait);
        app.quit();
    }, 10);
});
const write = clipboard.write;
clipboard.write = function (items, ...rest) {
    reading++;
    const item = items?.[0];
    const types = [...(item?.types ?? [])];
    const recorded = Promise.resolve(types.includes('text/plain') ? item.getType('text/plain').then((blob) => blob.text()) : null)
        .then((text) => record({ event: 'clipboard', text, types }), (err) => record({ event: 'clipboard', error: String(err), types }))
        .finally(() => reading--);
    if (!real) return recorded;
    const written = recorded.then(() => write.call(this, items, ...rest));
    written
        .then(
            () => record({ event: 'clipboard-written' }),
            (err) => { record({ event: 'clipboard-written', error: String(err) }); throw err; },
        )
        .then(() => clipboard.readText())
        .then(
            (held) => record({ event: 'clipboard-read-back', text: held }),
            (err) => record({ event: 'clipboard-read-back', error: String(err) }),
        );
    return written;
};

const show = Notification.prototype.show;
Notification.prototype.show = function (...args) {
    record({ event: 'notification', title: this.title, body: this.body });
    if (real) return show.apply(this, args);
};

app.on('browser-window-created', (_event, win) => {
    const { id } = win;
    record({ event: 'window', id, session: win.webContents.session === session.defaultSession ? 'ui' : 'isolated' });
    win.on('show', () => record({ event: 'window-shown', id }));
});

// Each request to a server, as the session that sends it sees it. The app
// hooks no request itself, so these listeners are the sessions' only ones.
const watchRequests = (ses) => ses.webRequest.onSendHeaders(({ url, webContents }) => {
    if (!/^(https?|wss?):/.test(url)) return;
    const page = webContents && !webContents.isDestroyed() ? path.basename(new URL(webContents.getURL()).pathname) || null : null;
    record({ event: 'request', url, session: ses === session.defaultSession ? 'ui' : 'isolated', persistent: ses.isPersistent(), page });
});
app.on('session-created', watchRequests);
app.whenReady().then(() => watchRequests(session.defaultSession));

// The size of every message main sends or gets: over IPC (both ways), to its
// pages, and to and from its utility processes. The biggest on each channel
// is written down as the app quits, and any over IPC_LARGE at once.
const IPC_LARGE = 64 * 1024;
const sizes = {};
function measure(channel, value) {
    let bytes;
    try {
        bytes = v8.serialize(value).length;
    } catch {
        // Something structured clone can't copy (a port, a function) carries no file.
        bytes = 0;
    }
    const seen = sizes[channel] ?? { max: 0, count: 0 };
    sizes[channel] = { max: Math.max(seen.max, bytes), count: seen.count + 1 };
    if (bytes > IPC_LARGE) record({ event: 'ipc-large', channel, bytes });
}
app.on('web-contents-created', (_event, contents) => {
    const send = contents.send;
    contents.send = function (channel, ...args) {
        measure(`main → page ${channel}`, args);
        return send.call(this, channel, ...args);
    };
    const postMessage = contents.postMessage;
    contents.postMessage = function (channel, message, transfer) {
        measure(`main → page ${channel}`, message);
        return postMessage.call(this, channel, message, transfer);
    };
});
const fork = utilityProcess.fork;
utilityProcess.fork = function (...args) {
    const child = fork.apply(this, args);
    const postMessage = child.postMessage;
    child.postMessage = function (message, transfer) {
        measure(`main → utility ${message?.type}`, message);
        return postMessage.call(this, message, transfer);
    };
    child.on('message', (message) => measure('utility → main', message));
    return child;
};

// The app answers its own channels with ipcMain.handle(), through the kit
// (kit.ipc.handle()). Wrapping it here, before the app starts, writes each one
// down before the app acts on it, and measures what it's sent and answers. A
// window says it's ready once it has loaded its settings and set up its
// buttons. An upload ends in the transfer window (engine:finished), or, one a
// window stopped before it started, in that window (upload:finished).
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, async (event, ...args) => {
    measure(`page → main ${channel}`, args);
    if (channel === 'window:ready') record({ event: 'window-ready', id: BrowserWindow.fromWebContents(event.sender)?.id });
    if (channel === 'upload:finished') record({ event: 'upload-finished', status: args[0]?.status, error: args[0]?.error });
    if (channel === 'engine:finished') record({ event: 'upload-finished', status: args[1]?.status, error: args[1]?.message });
    const answer = await listener(event, ...args);
    measure(`main → page ${channel} (its answer)`, answer);
    return answer;
});

process.on('exit', (code) => {
    record({ event: 'ipc-sizes', sizes });
    record({ event: 'exit', code });
});
