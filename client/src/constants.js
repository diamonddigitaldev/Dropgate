'use strict';

// The contract between the client's processes: its IPC channels (the window's,
// the transfer window's and the file service's), its settings and their
// defaults, and the main window's size. main.js, the file service and the
// tests require it; the sandboxed preloads can't, so they inline the channel
// names, and test/preload.test.mjs and test/transfer-preload.test.mjs hold
// them to these maps.

/** The app's name, as the kit shows it (Credits, the log's banner). package.json's name is the npm-style one, which names the userData folder. */
const APP_NAME = 'Dropgate Client';

/**
 * The client's own IPC channels between its window and main, "domain:action".
 * The page asks with invoke(), and main answers through kit.ipc.handle(), for
 * the app's own page in the UI session only. The pushes, main to page, are
 * marked. The kit's own channels (settings, links, the updater, the theme)
 * are window.kitAPI's. The window holds no path and runs no core: a file is a
 * handle main made, and every request to a server is the transfer window's
 * (ENGINE, below).
 */
const IPC = Object.freeze({
    // Page to main.
    WINDOW_READY: 'window:ready',               // () the page has set itself up; main sends a background upload its files then
    WINDOW_SHOW: 'window:show',                 // () show the asking window, hidden for a background upload, to ask the person something
    FILES_ADD: 'files:add',                     // (paths) dropped, picked or opened files' paths -> { files: [{ handle, name, size }], folders }
    FILE_REVOKE: 'file:revoke',                 // (handle) the page is done with it
    SERVER_CHECK: 'server:check',               // (url) -> { ok: true, baseUrl, serverVersion, serverInfo, dgup } | { ok: false, code, message }, asked of the server by the transfer window
    TRANSFER_ADD_UPLOAD: 'transfer:add-upload', // ({ files: [handle], options: { lifetime: { value, unit }, maxDownloads, encrypt } }) -> { id }, an upload waiting to start
    TRANSFER_START: 'transfer:start',           // ({ ids }) start them, in the transfer window
    TRANSFER_PAUSE: 'transfer:pause',           // ({ id }) -> { message? }, core's reason when it couldn't
    TRANSFER_RESUME: 'transfer:resume',         // ({ id }) -> { message? }
    TRANSFER_CANCEL: 'transfer:cancel',         // ({ id })
    UPLOAD_FINISHED: 'upload:finished',         // ({ status: 'error', error }) an upload the page stopped before it started (no server, the warning declined)
    UPLOAD_BUSY: 'upload:busy',                 // () -> whether an upload is running anywhere, for Restart Now
    LINK_COPY: 'link:copy',                     // (link) copy it, kept out of the clipboard's history and sync
    // Main to page.
    FILE_OPENED: 'file:opened',                 // push: { handle, name, size }, a file picked with Open File
    FILE_OPEN_ERROR: 'file:open-error',         // push: the message, when the file picked can't be read
    UPLOAD_BACKGROUND_START: 'upload:background-start', // push: { files: [{ handle, name, size }] }, Share with Dropgate
    UPLOAD_STATUS: 'upload:status',             // push: { type: 'progress' | 'success' | 'cancelled' | 'error', data }, any upload, to the main window
});

/** The pushes, which main sends and the page only listens for. */
const PUSHES = Object.freeze([IPC.FILE_OPENED, IPC.FILE_OPEN_ERROR, IPC.UPLOAD_BACKGROUND_START, IPC.UPLOAD_STATUS]);

/**
 * The channels between main and the transfer window: a hidden, sandboxed
 * window in its own in-memory session (kit.sessions.isolated()), which runs
 * core and makes every request Dropgate makes. Main sends it work with
 * webContents.send() (its preload's window.engine hears it), and it answers
 * with invoke() on channels main answers for that session only
 * (kit.ipc.handle(…, { session })). Its preload is sandboxed, so it inlines
 * these, and test/transfer-preload.test.mjs holds them to this map. A file's
 * bytes never come this way: the transfer window reads them from the file
 * service over the MessagePort main hands it (engine:port).
 */
const ENGINE = Object.freeze({
    // Main to the transfer window.
    PORT: 'engine:port',                        // the file service's MessagePort, once its page is ready
    UPLOAD: 'engine:upload',                    // { id, server: { url, allowInsecure }, options, files: [{ handle, name, size }] }; handle is a read grant
    PAUSE: 'engine:pause',                      // { id, call }, answered with engine:answer
    RESUME: 'engine:resume',                    // { id, call }, answered with engine:answer
    CANCEL: 'engine:cancel',                    // { id }
    CHECK: 'engine:check',                      // { call, server: { url, allowInsecure } }, answered with engine:answer
    // The transfer window to main.
    READY: 'engine:ready',                      // () its page has set itself up: main hands it the port, then its work
    UPDATE: 'engine:update',                    // (id, snapshot) core's snapshot, which names no file and holds no key
    PAUSE_ENDING: 'engine:pause-ending',        // (id, deadline) a paused upload's server drops it at this time (ms since 1970): notify
    FINISHED: 'engine:finished',                // (id, { status: 'success', link } | { status: 'cancelled' } | { status: 'error', message })
    ANSWER: 'engine:answer',                    // (call, value) the answer to a check, a pause or a resume
});

/** What main sends the transfer window, which its page only listens for. */
const ENGINE_PUSHES = Object.freeze([ENGINE.PORT, ENGINE.UPLOAD, ENGINE.PAUSE, ENGINE.RESUME, ENGINE.CANCEL, ENGINE.CHECK]);

/**
 * The messages between main and the file service (a utilityProcess, over
 * process.parentPort). The service opens a file only for a read grant main
 * made, with the size and modification time the file had when it was handed
 * over, and makes no network request.
 */
const FILE_SERVICE = Object.freeze({
    GRANT_READ: 'grant-read',                   // { handle, path, size, mtimeMs }: at an upload's start, for each of its files
    REVOKE: 'revoke',                           // { handle }: its upload has ended
    PORT: 'port',                               // the transfer window's MessagePort, with postMessage(…, [port])
});

/**
 * How the transfer window reads a file from the file service, over their
 * MessagePort: a read in pieces this big at most, assembled to core's range.
 */
const READ_PIECE_BYTES = 1024 * 1024;

/**
 * The client's own settings and their defaults, beside the kit's own. The
 * kit keeps them under one "settings" key in config.json, and refuses a
 * change of kind, so the numbers stay numbers (v3 kept them as text).
 */
const SETTINGS_DEFAULTS = Object.freeze({
    // The server uploads go to; empty until the person gives one.
    serverURL: '',
    // An upload's lifetime and download limit, as last set on Upload: what
    // Share with Dropgate uses too.
    lifetimeValue: 24,
    lifetimeUnit: 'hours',
    maxDownloads: 1,
});

/**
 * The settings' version. 1: v4's first, under the kit's "settings" key. v3
 * kept its settings as top-level keys of config.json, which v4 doesn't carry
 * over (Will, 2026-10-03): the person enters their server once more.
 */
const SETTINGS_SCHEMA_VERSION = 1;

/** v3's top-level keys in config.json, deleted once by the kit's migration. windowBounds is the kit's key too, so it carries over. */
const V3_STORE_KEYS = Object.freeze(['serverURL', 'lifetimeValue', 'lifetimeUnit', 'maxDownloads']);

/** The main window: its size the first time, and the least it can be made. v3's was 600 by 900; the nav rail takes room beside it. */
const WINDOW = Object.freeze({ WIDTH: 900, HEIGHT: 900, MIN_WIDTH: 720, MIN_HEIGHT: 700 });

/** How long Share with Dropgate gathers files before it uploads them as one: Windows starts one process per file selected. */
const BATCH_DEBOUNCE_MS = 500;

module.exports = { APP_NAME, IPC, PUSHES, ENGINE, ENGINE_PUSHES, FILE_SERVICE, READ_PIECE_BYTES, SETTINGS_DEFAULTS, SETTINGS_SCHEMA_VERSION, V3_STORE_KEYS, WINDOW, BATCH_DEBOUNCE_MS };
