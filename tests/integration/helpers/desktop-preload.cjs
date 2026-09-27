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
//   { at, pid, event: 'upload-finished', status, error }
//   { at, pid, event: 'exit', code }
//
// Unless DROPGATE_TEST_REAL_CLIPBOARD is 1, the clipboard and notifications are
// only written down: nothing is copied and nothing is shown, so running the tests
// leaves your clipboard alone. With it (as in CI), the app's own calls go through,
// and the clipboard is read back once each copy has finished, if the app is still
// running by then. (Holding the app open until then made it hang in CI on Linux:
// after a copy made just before the app quit, the read-back never finished.)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { app, clipboard, ipcMain, Notification } = require('electron');

// Take this preload's own "-r <path>" back out of the command line, so the app
// sees only the arguments it would be given when launched normally.
const at = process.argv.findIndex((arg) => path.resolve(arg) === __filename);
if (at > 0 && ['-r', '--require'].includes(process.argv[at - 1])) process.argv.splice(at - 1, 2);

const EVENTS = process.env.DROPGATE_TEST_EVENTS;
if (!EVENTS) throw new Error('DROPGATE_TEST_EVENTS must name the file to write events to.');
const real = process.env.DROPGATE_TEST_REAL_CLIPBOARD === '1';

const record = (event) => fs.appendFileSync(EVENTS, `${JSON.stringify({ at: Date.now(), pid: process.pid, ...event })}\n`);

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

// Registered before the app's own handler, so it's written down before the app acts on it.
ipcMain.on('upload-finished', (_event, result) => {
    record({ event: 'upload-finished', status: result?.status, error: result?.error });
});

process.on('exit', (code) => record({ event: 'exit', code }));
