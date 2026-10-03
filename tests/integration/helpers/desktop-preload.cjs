// Test-only preload for the desktop app. The desktop fixtures load it with -r,
// before the app's own main script, so it's in place before the app does anything.
//
// It writes down what the app does that a person would notice outside its
// windows: notifications, the clipboard, windows being shown, uploads finishing,
// and the app quitting. Everything goes to the file named in DROPGATE_TEST_EVENTS,
// one JSON object per line, the moment it happens:
//   { at, pid, event: 'notification', title, body }
//   { at, pid, event: 'clipboard', text }             the app copied text
//   { at, pid, event: 'clipboard-written' }           the copy finished (or error)
//   { at, pid, event: 'clipboard-read-back', text }   what the clipboard held after
//                                                      (or error, if it couldn't be read)
//   { at, pid, event: 'window', id }                   a window was created
//   { at, pid, event: 'window-shown', id }             it was shown
//   { at, pid, event: 'window-ready', id }             it finished setting itself up
//   { at, pid, event: 'upload-finished', status, error }
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
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, clipboard, ipcMain, Notification, session } = require('electron');

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

const writeText = clipboard.writeText;
clipboard.writeText = function (text, ...rest) {
    record({ event: 'clipboard', text });
    if (!real) return Promise.resolve();
    const written = Promise.resolve(writeText.call(this, text, ...rest));
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
    record({ event: 'window', id });
    win.on('show', () => record({ event: 'window-shown', id }));
});

// The app answers its own channels with ipcMain.handle(), through the kit
// (kit.ipc.handle()). Wrapping it here, before the app starts, writes each one
// down before the app acts on it. A window says it's ready once it has loaded
// its settings and set up its buttons.
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, (event, ...args) => {
    if (channel === 'window:ready') record({ event: 'window-ready', id: BrowserWindow.fromWebContents(event.sender)?.id });
    if (channel === 'upload:finished') record({ event: 'upload-finished', status: args[0]?.status, error: args[0]?.error });
    return listener(event, ...args);
});

process.on('exit', (code) => record({ event: 'exit', code }));
