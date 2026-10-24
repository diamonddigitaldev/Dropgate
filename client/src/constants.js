'use strict';

const { serversFrom } = require('./core/servers');

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
    WINDOW_READY: 'window:ready',               // () the page has set itself up; main sends it a question waiting for it then (transfer:ask-insecure)
    FILES_ADD: 'files:add',                     // (paths) dropped, picked or opened files' paths -> { files: [{ handle, name, size }], folders }
    FILE_REVOKE: 'file:revoke',                 // (handle) the page is done with it
    SERVER_CHECK: 'server:check',               // (url) -> { ok: true, baseUrl, serverVersion, serverInfo, dgup } | { ok: false, code, message }, an address not saved (Add Server's Check), asked of the server by the transfer window; kept nowhere
    // The saved servers: each answers the list as it is now, { servers, defaultServer, checks }, checks being what each one's
    // last check this run found, by its ID (main's memory only).
    SERVER_ADD: 'server:add',                   // ({ url }) -> { check, server?, ...list }: the server checked (by the transfer window), and saved once it answers as a Dropgate server (one saved already is given back)
    SERVER_TEST: 'server:test',                 // ({ id }) -> { check, ...list }: a saved server checked again (Test, the default as the window opens, and before an upload)
    SERVER_REMOVE: 'server:remove',             // ({ id }) -> list: a saved server forgotten, with its settings and its check
    SERVER_MOVE: 'server:move',                 // ({ id, by }) -> list: Move Up (-1) or Move Down (1) in the order
    SERVER_SET_DEFAULT: 'server:set-default',   // ({ id }) -> list: new uploads and Share with Dropgate start on it
    SERVER_SET_OPTIONS: 'server:set-options',   // ({ id, options }) -> list: its settings for new uploads, { lifetime?, maxDownloads?, allowFallback? }
    TRANSFER_ADD_UPLOAD: 'transfer:add-upload', // ({ files: [handle] }) -> { id }, an upload waiting to start, with the server's settings for new uploads
    TRANSFER_ADD_FILES: 'transfer:add-files',   // ({ id, files: [handle] }) -> { added, skipped } onto the page's own upload waiting, or { started: true } once it has started
    TRANSFER_START: 'transfer:start',           // ({ ids, encrypt? }) start them, in the transfer window: the page's own uploads (encrypt, as it found the server) and downloads, or a share's it was asked about (Upload Anyway)
    TRANSFER_REMOVE: 'transfer:remove',         // ({ ids }) remove uploads waiting or ended: Remove, Clear Finished
    TRANSFER_RETRY: 'transfer:retry',           // ({ id }) a failed or cancelled upload waits for the page's Upload once more
    TRANSFER_SET_OPTIONS: 'transfer:set-options', // ({ id, options }) Advanced Options on the page's own transfer waiting: an upload's { lifetime?, maxDownloads?, allowFallback?, files? } (the indexes it keeps) or { server } (a saved server's ID), a download's { files?, asZip? } (the indexes it saves, and whether as one ZIP)
    TRANSFER_DELETE: 'transfer:delete',         // ({ id }) -> { message? }, a finished upload deleted from its server, with the manage token the transfer window holds
    TRANSFER_ADD_DOWNLOAD: 'transfer:add-download', // ({ link }) -> { id }, a download that reads the link's list of files (no lease, nothing counted), then waits; main passes the link on and keeps none of it
    TRANSFER_SAVE_TO: 'transfer:save-to',       // ({ ids, folder }) where downloads waiting are saved: 'default' (Settings > Transfers') or a folder from folder:choose
    TRANSFER_SHOW: 'transfer:show',             // ({ id }) Show in Folder: the folder a finished download was saved in, with it selected; Open Folder: a bundle's own folder; nothing received is ever opened
    FOLDER_CHOOSE: 'folder:choose',             // () -> { folder, label } | null, the system's folder picker: an opaque ID for this run, and the folder's own name
    FOLDER_DEFAULT: 'folder:default',           // () -> { path, label, chosen }, where new downloads are saved (Settings > Transfers): the system's Downloads unless one was chosen
    FOLDER_SET_DEFAULT: 'folder:set-default',   // ({ folder }) Settings > Transfers' Browse (a folder from folder:choose) or Reset (null: the system's) -> folder:default's answer
    TRANSFER_PAUSE: 'transfer:pause',           // ({ id }) -> { message? }, core's reason when it couldn't
    TRANSFER_RESUME: 'transfer:resume',         // ({ id }) -> { message? }
    TRANSFER_CANCEL: 'transfer:cancel',         // ({ id }) a running upload, or one waiting: a share's question declined
    TRANSFER_BUSY: 'transfer:busy',             // () -> whether any transfer runs, is paused or is queued (or a share is under way), for Restart Now
    TRANSFERS_LIST: 'transfers:list',           // () -> every transfer in main's registry, as transfer:changed draws it, as the page sets itself up
    UPLOAD_FINISHED: 'upload:finished',         // ({ status: 'error', error }) an upload the page stopped before it started (no server, the warning declined)
    LINK_COPY: 'link:copy',                     // (link) copy it, kept out of the clipboard's history and sync
    // Main to page.
    FILE_OPENED: 'file:opened',                 // push: { handle, name, size }, a file picked with Open File
    FILE_OPEN_ERROR: 'file:open-error',         // push: the message, when the file picked can't be read
    TRANSFER_ASK_INSECURE: 'transfer:ask-insecure', // push: { id }, a share to a server with no end-to-end encryption: the Upload Security Warning, answered with transfer:start or transfer:cancel
    TRANSFER_ASK_FALLBACK: 'transfer:ask-fallback', // push: { id, from, to, reason, encrypt, plain, unencrypted, lifetime, downloads, asked }, an upload falling back to a server that would be a step down: answered with transfer:start (encrypt, as given) or transfer:cancel (it stops)
    TRANSFER_CHANGED: 'transfer:changed',       // push: a transfer as it is now, for drawing (core/transfers.js' view()), at most TRANSFERS.UPDATES_PER_SECOND times a second each
    TRANSFER_REMOVED: 'transfer:removed',       // push: [id], transfers gone from main's registry
    UPLOAD_STATUS: 'upload:status',             // push: { type: 'success' | 'cancelled' | 'error', data: { id?, link? | error? } }, an upload's outcome, to the main window
    SERVERS_CHANGED: 'servers:changed',         // push: the saved servers' list answer ({ servers, defaultServer, checks }), when main checked one itself (a fallback trying it)
});

/**
 * The kit's own channel for the page's settings changes, which main answers
 * itself, with the kit's sender check, so the page can't change the settings
 * only main changes (MAIN_ONLY_SETTINGS).
 * kit-gap: https://github.com/diamonddigitaldev/electron-kit/issues/66
 */
const KIT_SETTINGS_SET = 'settings:set';

/** The pushes, which main sends and the page only listens for. */
const PUSHES = Object.freeze([
    IPC.FILE_OPENED, IPC.FILE_OPEN_ERROR, IPC.TRANSFER_ASK_INSECURE, IPC.TRANSFER_ASK_FALLBACK, IPC.TRANSFER_CHANGED, IPC.TRANSFER_REMOVED, IPC.UPLOAD_STATUS, IPC.SERVERS_CHANGED,
]);

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
    METADATA: 'engine:metadata',                // { id, call, link } read a link's list of files, with no lease, and keep its secret for its download; answered with engine:answer ({ files, encrypted } | { message })
    DOWNLOAD: 'engine:download',                // { id, output, files?, asZip } download it (all its files, or those named, by index) into the output main granted the file service
    PAUSE: 'engine:pause',                      // { id, call }, answered with engine:answer
    RESUME: 'engine:resume',                    // { id, call }, answered with engine:answer
    CANCEL: 'engine:cancel',                    // { id }
    CHECK: 'engine:check',                      // { call, server: { url, allowInsecure } }, answered with engine:answer
    DELETE: 'engine:delete',                    // { id, call } delete a finished upload with its manage token, answered with engine:answer ({ message? })
    FORGET: 'engine:forget',                    // { id } its card is gone: a finished upload's manage token, or a download's link, goes too
    QUIT: 'engine:quit',                        // { call } the app is quitting: cancel everything (its servers told), forget every manage token and link, then answer with engine:answer
    // The transfer window to main.
    READY: 'engine:ready',                      // () its page has set itself up: main hands it the port, then its work
    UPDATE: 'engine:update',                    // (id, snapshot) core's snapshot, which names no file and holds no key
    PAUSE_ENDING: 'engine:pause-ending',        // (id, deadline) a paused upload's or download's server drops it at this time (ms since 1970): notify
    FINISHED: 'engine:finished',                // (id, { status: 'success', link? } | { status: 'cancelled' } | { status: 'error', message }): a completed upload's link, a download's nothing
    ANSWER: 'engine:answer',                    // (call, value) the answer to a check, a metadata read, a pause, a resume, a delete or a quit
});

/** What main sends the transfer window, which its page only listens for. */
const ENGINE_PUSHES = Object.freeze([ENGINE.PORT, ENGINE.UPLOAD, ENGINE.METADATA, ENGINE.DOWNLOAD, ENGINE.PAUSE, ENGINE.RESUME, ENGINE.CANCEL, ENGINE.CHECK, ENGINE.DELETE, ENGINE.FORGET, ENGINE.QUIT]);

/**
 * The messages between main and the file service (a utilityProcess, over
 * process.parentPort). The service opens a file only for a read grant main
 * made, with the size and modification time the file had when it was handed
 * over, and writes one only for an output main granted, into the folder main
 * gave it. It makes no network request. Main starts it with the partial
 * folder (PARTIAL_FOLDER) as its one argument.
 */
const FILE_SERVICE = Object.freeze({
    GRANT_READ: 'grant-read',                   // { handle, path, size, mtimeMs }: at an upload's start, for each of its files
    GRANT_OUTPUT: 'grant-output',               // { output, folder, shape: 'file' | 'files' | 'zip', count? }: at a download's start, the folder it's saved in, and how: one file, a bundle's files (count of them) into a folder of their own, or one ZIP
    REVOKE: 'revoke',                           // { handle } | { output }: its transfer has ended (an output's file still being written is deleted)
    PORT: 'port',                               // the transfer window's MessagePort, with postMessage(…, [port])
    SAVED: 'saved',                             // the file service to main: { output, path }, where a download landed (a bundle's: its own folder), for Show in Folder or Open Folder
});

/**
 * Where a download is written while it runs: a folder in the app's profile
 * (userData), each file under a random name holding nothing of its own, moved
 * into place once it's whole. Main empties it at every start and at quit.
 */
const PARTIAL_FOLDER = 'Partial Downloads';

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
    // The saved servers (core/servers.js), in order: each one's ID, address,
    // name and settings for new uploads (file lifetime, max downloads, Allow
    // Fallback); and the default's ID, which new uploads and Share with
    // Dropgate start on (null with none saved). Main alone changes them
    // (MAIN_ONLY_SETTINGS): the page asks it to (server:add and the rest).
    servers: [],
    defaultServer: null,
    // Settings > Transfers: the folder downloads are saved in, null for the
    // system's Downloads folder, chosen with the system's folder picker in
    // main (the page can't set it: MAIN_ONLY_SETTINGS); and how many
    // transfers run at once, uploads and downloads together.
    downloadFolder: null,
    transfersAtOnce: 3,
});

/** The settings only main changes: the page may read them, and is refused a change to one. */
const MAIN_ONLY_SETTINGS = Object.freeze(['servers', 'defaultServer', 'downloadFolder']);

/** Transfers at once, as Settings > Transfers' stepped slider offers it. */
const AT_ONCE_RANGE = Object.freeze({ MIN: 1, MAX: 6 });

/**
 * The settings' version. 1: v4's first, under the kit's "settings" key. v3
 * kept its settings as top-level keys of config.json, which v4 doesn't carry
 * over (Will, 2026-10-03): the person enters their server once more. 2: the
 * downloads folder and transfers at once. 3: the saved servers, in place of
 * the one server and its settings for new uploads (migrateSettings()).
 */
const SETTINGS_SCHEMA_VERSION = 3;

/**
 * Bring stored settings up to SETTINGS_SCHEMA_VERSION, once: the kit calls it
 * as its store opens, with the version they were written at. Version 1's
 * gain version 2's at their defaults (the system's Downloads folder, 3 at
 * once); version 1's and 2's one server, with its settings for new uploads,
 * becomes the first saved server, and the default (none, if none was given).
 * Nothing older was ever under the kit's key (v3's, version 0, are deleted by
 * V3_STORE_KEYS), so nothing of it is kept.
 * @param {object} settings
 * @param {number} from
 */
function migrateSettings(settings, from) {
    if (from < 1) return {};
    const { serverURL, lifetimeValue, lifetimeUnit, maxDownloads, ...rest } = settings;
    const two = from < 2 ? { downloadFolder: null, transfersAtOnce: 3 } : {};
    return { ...rest, ...two, ...serversFrom({ serverURL, lifetimeValue, lifetimeUnit, maxDownloads }) };
}

/** v3's top-level keys in config.json, deleted once by the kit's migration. windowBounds is the kit's key too, so it carries over. */
const V3_STORE_KEYS = Object.freeze(['serverURL', 'lifetimeValue', 'lifetimeUnit', 'maxDownloads']);

/** The main window: its size the first time, and the least it can be made. v3's was 600 by 900; the nav rail takes room beside it. */
const WINDOW = Object.freeze({ WIDTH: 900, HEIGHT: 900, MIN_WIDTH: 720, MIN_HEIGHT: 700 });

/** How long Share with Dropgate gathers files before it uploads them as one: Windows starts one process per file selected. */
const BATCH_DEBOUNCE_MS = 500;

/**
 * How main's registry runs transfers, and how it tells of them (17 §4, §5):
 * - up to TRANSFERS_AT_ONCE run at once, uploads and downloads together; the
 *   rest wait as queued, in the order added, and a paused one takes no place
 *   (AT_ONCE until the settings are read: Settings > Transfers' transfersAtOnce);
 * - each transfer reaches the window at most TRANSFER_UPDATES_PER_SECOND times
 *   a second (transfer:changed);
 * - transfers ending within NOTICE_GROUP_MS of the first are told of in one
 *   notification;
 * - the transfer window closes TRANSFER_WINDOW_IDLE_MS after the last of its
 *   work ends;
 * - quitting waits up to QUIT_WAIT_MS for the transfer window to cancel
 *   everything on its servers.
 */
const TRANSFERS = Object.freeze({
    AT_ONCE: 3,
    UPDATES_PER_SECOND: 4,
    NOTICE_GROUP_MS: 5_000,
    WINDOW_IDLE_MS: 30_000,
    QUIT_WAIT_MS: 5_000,
});

module.exports = {
    APP_NAME, IPC, PUSHES, KIT_SETTINGS_SET, ENGINE, ENGINE_PUSHES, FILE_SERVICE, PARTIAL_FOLDER, READ_PIECE_BYTES,
    SETTINGS_DEFAULTS, MAIN_ONLY_SETTINGS, AT_ONCE_RANGE, SETTINGS_SCHEMA_VERSION, migrateSettings, V3_STORE_KEYS, WINDOW, BATCH_DEBOUNCE_MS, TRANSFERS,
};
