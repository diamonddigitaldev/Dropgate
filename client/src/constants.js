'use strict';

// The contract between the client's processes: its IPC channels, its settings
// and their defaults, and the main window's size. main.js and the tests
// require it; the sandboxed preload can't, so it inlines the channel names,
// and test/preload.test.mjs holds them to this map.

/** The app's name, as the kit shows it (Credits, the log's banner). package.json's name is the npm-style one, which names the userData folder. */
const APP_NAME = 'Dropgate Client';

/**
 * The client's own IPC channels, "domain:action". The page asks with invoke(),
 * and main answers through kit.ipc.handle(), for the app's own page only. The
 * pushes, main to page, are marked. The kit's own channels (settings, links,
 * the updater, the theme) are window.kitAPI's.
 */
const IPC = Object.freeze({
    // Page to main.
    WINDOW_READY: 'window:ready',               // () the page has set itself up; main sends a background upload its files then
    WINDOW_SHOW: 'window:show',                 // () show the asking window, hidden for a background upload, to ask the person something
    FILES_ADD: 'files:add',                     // (paths) dropped files' paths -> { files: [{ name, size, filePath }], folders }
    FILE_READ_RANGE: 'file:read-range',         // (filePath, start, end) -> the bytes, for a file main has handed the page
    FILE_REVOKE: 'file:revoke',                 // (filePath) the page is done with it
    UPLOAD_PROGRESS: 'upload:progress',         // ({ text?, percent? }) an upload's progress, from whichever window runs it
    UPLOAD_FINISHED: 'upload:finished',         // ({ status: 'success', link } | { status: 'error', error })
    UPLOAD_CANCEL: 'upload:cancel',             // () cancel the upload running, in whichever window runs it
    UPLOAD_BUSY: 'upload:busy',                 // () -> whether an upload is running anywhere, for Restart Now
    LINK_COPY: 'link:copy',                     // (link) copy it, kept out of the clipboard's history and sync
    // Main to page.
    FILE_OPENED: 'file:opened',                 // push: { name, size, filePath }, a file picked with Open File
    FILE_OPEN_ERROR: 'file:open-error',         // push: the message, when the file picked can't be read
    UPLOAD_BACKGROUND_START: 'upload:background-start', // push: { files: [{ name, size, filePath }] }, Share with Dropgate
    UPLOAD_STATUS: 'upload:status',             // push: { type: 'progress' | 'success' | 'error', data }, any window's upload, to the main window
    UPLOAD_CANCEL_REQUESTED: 'upload:cancel-requested', // push: () cancel the upload this window runs
});

/** The pushes, which main sends and the page only listens for. */
const PUSHES = Object.freeze([IPC.FILE_OPENED, IPC.FILE_OPEN_ERROR, IPC.UPLOAD_BACKGROUND_START, IPC.UPLOAD_STATUS, IPC.UPLOAD_CANCEL_REQUESTED]);

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

module.exports = { APP_NAME, IPC, PUSHES, SETTINGS_DEFAULTS, SETTINGS_SCHEMA_VERSION, V3_STORE_KEYS, WINDOW, BATCH_DEBOUNCE_MS };
