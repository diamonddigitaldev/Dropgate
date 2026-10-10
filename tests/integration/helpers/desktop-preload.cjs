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
//   { at, pid, event: 'upload-finished', status, error }  an upload's outcome (see below)
//   { at, pid, event: 'request', url, session, persistent, page }
//                                                      a request to a server, as its session sent it: from
//                                                      which session, and which page (null: main's own)
//   { at, pid, event: 'ipc-large', channel, bytes }    a message to or from main bigger than IPC_LARGE
//   { at, pid, event: 'ipc-sizes', sizes }             as it quits: the biggest message main sent or got
//                                                      on each channel, in bytes, and how many
//   { at, pid, event: 'transfer-changed', id, state }  main sent the window a transfer (transfer:changed):
//                                                      its ID and state only
//   { at, pid, event: 'tray', tooltip, labels }        the tray icon shows, or its menu changed
//   { at, pid, event: 'tray-gone' }                    the tray icon was taken away
//   { at, pid, event: 'power-save', action, type, id } the power-save blocker started or stopped
//   { at, pid, event: 'csp', message }                 a page's console said its Content Security Policy refused something
//   { at, pid, event: 'exit', code }
//
// The tray icon is kept in globalThis.__dropgateTray, with its menu, so a test
// can click its items from main (app.evaluate()). And a test can say whether
// the app's main window counts as focused, with globalThis.__dropgateFocused
// (true or false; unset, it's the window's own): which window has the focus
// on a test machine isn't the test's to set.
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
const { app, BrowserWindow, clipboard, ipcMain, Notification, powerSaveBlocker, session, Tray, utilityProcess } = require('electron');

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

// Whether a window of the app's own (the UI session's) is focused, as the test says, when it says.
const isFocused = BrowserWindow.prototype.isFocused;
BrowserWindow.prototype.isFocused = function (...args) {
    const said = globalThis.__dropgateFocused;
    if (typeof said === 'boolean' && !this.isDestroyed() && this.webContents.session === session.defaultSession) return said;
    return isFocused.apply(this, args);
};

// The tray icon: its tooltip and menu as they change, and when it goes.
const setToolTip = Tray.prototype.setToolTip;
Tray.prototype.setToolTip = function (tooltip, ...rest) {
    this.__tooltip = tooltip;
    return setToolTip.call(this, tooltip, ...rest);
};
const setContextMenu = Tray.prototype.setContextMenu;
Tray.prototype.setContextMenu = function (menu, ...rest) {
    globalThis.__dropgateTray = this;
    this.__menu = menu;
    record({ event: 'tray', tooltip: this.__tooltip ?? null, labels: menu?.items.map((item) => item.label) ?? [] });
    return setContextMenu.call(this, menu, ...rest);
};
const destroyTray = Tray.prototype.destroy;
Tray.prototype.destroy = function (...args) {
    if (globalThis.__dropgateTray === this) globalThis.__dropgateTray = null;
    record({ event: 'tray-gone' });
    return destroyTray.apply(this, args);
};

// The power-save blocker, as the app starts and stops it.
const startBlocker = powerSaveBlocker.start.bind(powerSaveBlocker);
const stopBlocker = powerSaveBlocker.stop.bind(powerSaveBlocker);
powerSaveBlocker.start = (type) => {
    const id = startBlocker(type);
    record({ event: 'power-save', action: 'start', type, id });
    return id;
};
powerSaveBlocker.stop = (id) => {
    record({ event: 'power-save', action: 'stop', id });
    return stopBlocker(id);
};

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
// An upload's outcome a page told main of (engine:finished, upload:finished)
// is written down as main hears it. One main came to itself (Share with
// Dropgate stopped before it started: no server, the server's check, the
// warning declined) is written down as main tells the main window of it
// (upload:status), when it has one. While a page's report is being handled,
// main's own push of it isn't written down again.
let reportedByPage = false;
const OUTCOMES = ['success', 'cancelled', 'error'];
app.on('web-contents-created', (_event, contents) => {
    const send = contents.send;
    contents.send = function (channel, ...args) {
        measure(`main → page ${channel}`, args);
        const [push] = args;
        if (channel === 'upload:status' && OUTCOMES.includes(push?.type) && !reportedByPage) {
            record({ event: 'upload-finished', status: push.type, error: push.data?.error });
        }
        if (channel === 'transfer:changed') record({ event: 'transfer-changed', id: push?.id, state: push?.state });
        return send.call(this, channel, ...args);
    };
    // What a page's CSP refused, as Chromium tells its console. (Electron 44 gives the details on the event.)
    contents.on('console-message', (details, ...legacy) => {
        const message = typeof details?.message === 'string' ? details.message : String(legacy[1] ?? '');
        if (/Content Security Policy/i.test(message)) record({ event: 'csp', page: path.basename(new URL(contents.getURL() || 'about:blank').pathname), message });
    });
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
// window stopped before it started, in that window (upload:finished), or in
// main itself (above).
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, async (event, ...args) => {
    measure(`page → main ${channel}`, args);
    if (channel === 'window:ready') record({ event: 'window-ready', id: BrowserWindow.fromWebContents(event.sender)?.id });
    if (channel === 'upload:finished') record({ event: 'upload-finished', status: args[0]?.status, error: args[0]?.error });
    if (channel === 'engine:finished') record({ event: 'upload-finished', status: args[1]?.status, error: args[1]?.message });
    const reporting = channel === 'upload:finished' || channel === 'engine:finished';
    // The handler tells the main window as it runs, before its first await.
    if (reporting) reportedByPage = true;
    let pending;
    try {
        pending = listener(event, ...args);
    } finally {
        if (reporting) reportedByPage = false;
    }
    const answer = await pending;
    measure(`main → page ${channel} (its answer)`, answer);
    return answer;
});

process.on('exit', (code) => {
    record({ event: 'ipc-sizes', sizes });
    record({ event: 'exit', code });
});
