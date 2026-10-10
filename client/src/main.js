const { app, BrowserWindow, dialog, clipboard, ClipboardItem, Notification } = require('electron');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const { countOf } = require('@diamonddigitaldev/electron-kit/format');

const { APP_NAME, IPC, SETTINGS_DEFAULTS, SETTINGS_SCHEMA_VERSION, V3_STORE_KEYS, WINDOW, BATCH_DEBOUNCE_MS } = require('./constants');
const { menuItems } = require('./menu');
const { Handles, describeFile } = require('./core/handles');
const { shareUpload } = require('./core/share');
const { createTransferHost } = require('./transfer-host');
const { answerWindowChannels, serverOf } = require('./window-channels');

// The house frame (electron-kit): one instance, the shared preload
// (window.kitAPI) on the app's session, the settings, the log, the menu, the
// theme push, the main window with its bounds kept, and the updater behind
// Settings > Update.
//
// - The settings are the kit's, under one "settings" key in config.json.
//   v3's were top-level keys, which v4 doesn't carry over (Will, 2026-10-03):
//   version 1 deletes them, once. windowBounds is the kit's key too.
// - The log is kept in memory, redacted, and on disk only while the person
//   keeps it there (keepLogOnDisk, off): v3 wrote debug.log at every launch,
//   with every argv's paths in it.
// - The updater checks GitHub 5 seconds after a packaged launch and when
//   asked, never sends an ID of the install, makes none, and deletes the one
//   v3's updater kept. As in v3, a launch for Share with Dropgate
//   doesn't check.
// - Windows' app ID is build.appId, the one the installer's Start menu
//   shortcut carries, so Share with Dropgate's notifications show.
// - Links open in the browser only on Dropgate's own pages, beside the ones
//   the kit shows (Credits, its donate link, the repository).
// - The files the app is opened with ("Open with", files dropped on its icon,
//   a second launch) reach Upload as the kit's files:opened (#93), every one
//   of them, bar a Share with Dropgate launch's, which are main's own.
// - A link is copied to the clipboard marked to stay out of Windows'
//   clipboard history and cloud clipboard, and out of KDE's: it holds the key.
//   Notifications say how many files, never which.
// - The window holds no path and runs no core. A file dropped, picked or
//   opened becomes a handle main made (core/handles.js); an upload is started
//   here and runs in the transfer window, which makes every request to a
//   server and reads its files from the file service, which main grants each
//   one (transfer-host.js). Main relays how it goes to the window, and never
//   carries a file's bytes. The window's channels are window-channels.js'.
// Share with Dropgate (Windows' context menu) launches the app with a file's
// path and --upload. Main makes the upload itself, with no window: the server
// in Settings, checked by the transfer window, with Settings' lifetime and
// download limit, started at once in the transfer window. A server with no
// end-to-end encryption opens the main window to ask first (the Upload
// Security Warning), and the share waits for the answer. A launch made only
// for the share quits once it's done. Windows starts one launch per file
// selected, so the files of every launch reaching the app within 500 ms of
// the last are uploaded together, as one bundle; one launch can carry several.
const wasLaunchedForBackgroundTask = process.argv.includes('--upload');

const kit = require('@diamonddigitaldev/electron-kit/main').start({
    appId: 'com.diamonddigitaldev.dropgateclient',
    // package.json's name, dropgate-client, names the userData folder, so it stays.
    name: APP_NAME,
    settings: {
        defaults: SETTINGS_DEFAULTS,
        version: SETTINGS_SCHEMA_VERSION,
        obsoleteKeys: V3_STORE_KEYS,
    },
    log: 'memory',
    // A Share with Dropgate launch's files are main's to upload (handleArgs()), not Upload's to add.
    files: { except: ['--upload'] },
    credits: {
        lines: [
            ['Created and maintained by ', { text: 'Diamond Digital Development', href: 'https://diamonddigital.dev' }, '.'],
            ['Logo designed by ', { text: 'TheFuturisticIdiot', href: 'https://github.com/TheFuturisticIdiot' }, '.'],
            'This software is licensed under the GNU General Public License v3.0.',
            'Dropgate Server is licensed under the GNU Affero General Public License v3.0.',
            '@dropgate/core is licensed under the Apache License v2.0.',
            'Privacy and anonymity is a human right. Nobody should have to give anything for their right to data freedom.',
        ],
        donate: 'https://buymeacoff.ee/willtda',
    },
    menu: { items: menuItems({ openFile: handleOpenDialog }) },
    updates: wasLaunchedForBackgroundTask ? { checkOnLaunch: false } : {},
    openExternal: { allow: ['https://github.com/diamonddigitaldev/Dropgate/'] },
});

let activeUploadNotification = null;

// Electron 43+ opens file dialogs in Downloads unless told otherwise. Remember the
// last folder for this session only, so it's never written to disk.
let lastOpenDialogDir;

// The files handed to each window, from Open File, a drop or a pick: the
// window gets a handle, and main keeps the path (core/handles.js).
const handles = new Handles();

// The uploads, by the ID main made: waiting to start, or running in the
// transfer window. A window's own keeps that window (owner); a share's has
// none, and keeps the window asked about it, while it waits for the answer
// (ask), and its server. Each keeps its files' paths, names and sizes; the
// transfer window gets a read grant for each file, never its path.
const uploads = new Map();

// The transfer window and the file service (transfer-host.js), once the app is ready.
let host = null;

// The app's own windows: the main one (the kit's). Share with Dropgate makes none.
const appWindows = new Set();

// The windows whose page has set itself up, by webContents id: a share's question goes to one only once it has.
const readyWindows = new Set();

/** An upload's statuses while it's still going. */
const GOING = ['initializing', 'uploading', 'paused', 'completing'];

// Share with Dropgate: the files of the launches arriving now, gathered for
// 500 ms (Windows launches one process per selected file, and they're
// uploaded as one bundle); the batches waiting their turn; and the one being
// shared: checked, asked about, or uploading.
let batchFiles = [];
let batchTimer = null;
const shareQueue = [];
/** @type {{ openedWindow: BrowserWindow | null } | null} */
let share = null;
// The batch is gathered from once the app is ready, with its own launch's files
// in it: the other launches can arrive while it's still starting.
let readyForShares = false;

const mainWindow = () => kit.windows.main();
const ICON = path.join(__dirname, 'img', 'dropgate');

function createWindow({ show } = {}) {
    return watchWindow(kit.windows.createMain({
        page: path.join(__dirname, 'index.html'),
        size: { width: WINDOW.WIDTH, height: WINDOW.HEIGHT },
        min: { width: WINDOW.MIN_WIDTH, height: WINDOW.MIN_HEIGHT },
        title: APP_NAME,
        icon: ICON,
        webPreferences: { preload: path.join(__dirname, 'preload.js') },
        ...(show === undefined ? {} : { show }),
    }));
}

/** Whether Share with Dropgate has anything under way: files gathering, batches waiting, or one being shared. */
const sharing = () => share !== null || shareQueue.length > 0 || batchFiles.length > 0 || batchTimer !== null;

/**
 * One of the app's windows. The files handed to it, an upload it made but
 * never started, and a share's question it was asked and never answered (the
 * share is declined), go with it. When the last one closes, the transfer host
 * closes too (its window is hidden, and would keep the app running with
 * nothing open), so the app quits with its windows, as it always has: unless a
 * share is under way, which runs with no window, and quits the app once it's
 * done (endShare()).
 */
function watchWindow(win) {
    if (appWindows.has(win)) return win;
    appWindows.add(win);
    const owner = win.webContents.id;
    win.webContents.once('destroyed', () => {
        readyWindows.delete(owner);
        handles.dropOwner(owner);
        for (const [id, upload] of uploads) {
            if (upload.owner === owner && !upload.started) uploads.delete(id);
            if (upload.ask?.owner === owner && !upload.started) declineShare(id);
        }
    });
    win.on('closed', () => {
        appWindows.delete(win);
        setImmediate(() => {
            if (appWindows.size === 0 && !sharing()) host?.close();
        });
    });
    return win;
}

function showNotification(title, body) {
    const notification = new Notification({ title, body });
    notification.on('click', () => {
        const win = mainWindow() ?? createWindow();
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
    });
    notification.show();
    return notification;
}

/** A file on disk, handed to a window as a handle: it may upload it from now on, as it is now. */
const handOver = (win, filePath) => handles.add(win.webContents.id, filePath);

if (kit.primary) {
    // A second launch: the kit restores and focuses the main window, if there is
    // one. A share is uploaded in the background; anything else opens the main
    // window if it isn't open.
    app.on('second-instance', (_event, commandLine) => {
        if (commandLine.includes('--upload')) {
            handleArgs(commandLine);
        } else if (!mainWindow()) {
            createWindow();
        }
    });

    kit.ready.then(() => {
        host = createTransferHost({
            kit,
            appInfo: { name: APP_NAME, version: app.getVersion() },
            onUpdate: uploadUpdated,
            onPauseEnding: pauseEnding,
            onFinished: (id, { status, link, message }) => {
                const upload = uploads.get(id);
                uploads.delete(id);
                finishUpload(status === 'error' ? { status, error: message } : { status, ...(link ? { link } : {}) }, upload);
            },
        });
        // What runs in the transfer window ends as the app quits: nothing of it is kept.
        app.on('before-quit', () => host.close());
        if (!wasLaunchedForBackgroundTask) createWindow();
        readyForShares = true;
        handleArgs(process.argv);
        // A share that reached the app while it started, from another launch.
        scheduleBatch();
    });
}

answerWindowChannels({
    kit,
    handles,
    uploads,
    host: () => host,
    windowReady,
    start: startUpload,
    cancel: cancelUpload,
    busy: () => sharing() || [...uploads.values()].some((upload) => upload.started),
    failed: (result) => finishUpload(result),
    copyLink: copyPrivately,
});

/** Every file in a launch's argv: past the executable, not a switch, and a file. */
function filesInArgs(argv) {
    const executablePath = process.execPath.toLowerCase();
    return [...new Set(argv.filter((arg, index) => {
        if (index === 0 || arg.toLowerCase() === executablePath || arg.startsWith('-')) return false;
        try {
            return fs.lstatSync(arg).isFile();
        } catch {
            return false;
        }
    }))];
}

function handleArgs(argv) {
    if (!argv.includes('--upload')) return;

    // Every file in it, bar one already pending or queued, so none is uploaded twice.
    const filePaths = filesInArgs(argv).filter((filePath) =>
        !batchFiles.includes(filePath) && !shareQueue.some((item) => item.filePaths.includes(filePath)));
    if (filePaths.length === 0 && batchFiles.length === 0) {
        kit.log.info('Share with Dropgate: no file to upload in the arguments.');
        return;
    }

    // Collect files and debounce — Windows launches one process per selected
    // file, so multi-select arrivals are spaced milliseconds apart.
    batchFiles.push(...filePaths);
    scheduleBatch();
}

/** Upload what's gathered 500 ms after the last arrival, once the app is ready. */
function scheduleBatch() {
    if (!readyForShares || batchFiles.length === 0) return;
    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = setTimeout(() => {
        const filePaths = [...batchFiles];
        batchFiles = [];
        batchTimer = null;
        if (filePaths.length > 0) {
            shareQueue.push({ filePaths });
            nextShare();
        }
    }, BATCH_DEBOUNCE_MS);
}

/** Share the next batch waiting, one at a time. */
function nextShare() {
    if (share || shareQueue.length === 0) return;
    const { filePaths } = shareQueue.shift();
    share = { openedWindow: null };
    startShare(filePaths).catch((error) => {
        kit.log.error(`Share with Dropgate couldn't start (${error?.code ?? error?.name ?? 'error'}).`);
        finishUpload({ status: 'error', error: 'The upload couldn\'t start.' }, { share: true });
    });
}

/**
 * Share a batch: its files read as they are now, the server in Settings
 * checked by the transfer window, and an upload made with Settings' lifetime
 * and download limit, held to the server's (core/share.js). It starts at
 * once, or, on a server with no end-to-end encryption, once the person says
 * so in the main window.
 * @param {string[]} filePaths
 */
async function startShare(filePaths) {
    // Filter out any files that no longer exist
    const validPaths = filePaths.filter((filePath) => fs.existsSync(filePath));
    if (validPaths.length === 0) {
        showNotification('Upload Failed', 'File(s) not found.');
        endShare();
        return;
    }
    activeUploadNotification = showNotification('Initialising Upload', `Preparing ${countOf(validPaths.length, 'file')}…`);

    let files;
    try {
        files = validPaths.map(describeFile);
    } catch (error) {
        kit.log.error(`Couldn't read a file to share (${error?.code ?? 'error'}).`);
        finishUpload({ status: 'error', error: 'Could not read the selected file.' }, { share: true });
        return;
    }

    const settings = kit.settings.get();
    if (!settings.serverURL) {
        finishUpload({ status: 'error', error: 'Server URL is not configured.' }, { share: true });
        return;
    }
    const server = serverOf(settings.serverURL);
    const check = await host.check(server).catch(() => ({ ok: false }));
    const decided = shareUpload(settings, check);
    if (!decided.ok) {
        finishUpload({ status: 'error', error: decided.message }, { share: true });
        return;
    }

    const id = randomUUID();
    uploads.set(id, { owner: null, share: true, server, files, options: decided.options, started: false });
    if (decided.options.encrypt) startUpload(id, server);
    else askInsecure(id);
}

/**
 * A share to a server with no end-to-end encryption: the main window asks
 * the Upload Security Warning, opened for it if it isn't open (and closed
 * again as the share ends, as it would never have been opened otherwise).
 * The page answers with transfer:start (Upload Anyway) or transfer:cancel.
 */
function askInsecure(id) {
    let win = mainWindow();
    if (!win) {
        // Shown once, here: the window opens for the question.
        win = createWindow({ show: false });
        share.openedWindow = win;
    } else if (win.isMinimized()) {
        win.restore();
    }
    win.show();
    win.focus();
    uploads.get(id).ask = { owner: win.webContents.id, sent: false };
    if (readyWindows.has(win.webContents.id)) sendQuestion(id);
}

/** Send a share's question to the window asked, once. */
function sendQuestion(id) {
    const upload = uploads.get(id);
    const contents = mainWindow()?.webContents;
    if (!upload?.ask || upload.ask.sent || contents?.id !== upload.ask.owner) return;
    upload.ask.sent = true;
    contents.send(IPC.TRANSFER_ASK_INSECURE, { id });
}

/** A window's page has set itself up: a question waiting for it is sent now. */
function windowReady(contents) {
    readyWindows.add(contents.id);
    for (const [id, upload] of uploads) {
        if (upload.ask?.owner === contents.id) sendQuestion(id);
    }
}

/** Start an upload waiting, in the transfer window: a window's own, or a share. */
function startUpload(id, server) {
    const upload = uploads.get(id);
    upload.started = true;
    delete upload.ask;
    if (upload.share) activeUploadNotification = showNotification('Upload Started', `Uploading ${countOf(upload.files.length, 'file')}…`);
    host.upload(id, server, upload.options, upload.files);
}

/** A share's question declined, or its window gone before it was answered. */
function declineShare(id) {
    uploads.delete(id);
    finishUpload({ status: 'error', error: 'Upload cancelled by user (insecure connection).' }, { share: true });
}

// Cancel, from any window: a running upload, or a share's question declined.
function cancelUpload(id) {
    const main = mainWindow();
    if (main) {
        main.setTitle(APP_NAME);
        main.setProgressBar(-1);
    }

    // Close the active upload notification
    if (activeUploadNotification) {
        activeUploadNotification.close();
        activeUploadNotification = null;
    }

    const upload = uploads.get(id);
    if (upload.started) host.cancel(id);
    else if (upload.share) declineShare(id);
    else uploads.delete(id);
}

/**
 * Copy a link, marked so the clipboard's history and sync leave it out: it
 * holds the key. Windows' clipboard history and cloud clipboard, and the apps
 * that watch the clipboard, skip what carries these formats (Microsoft's
 * "Cloud Clipboard and Clipboard History Formats"); KDE's Klipper skips what
 * carries its password manager hint. It's all written at once.
 * @param {string} link
 */
function copyPrivately(link) {
    const raw = (format) => `electron application/osclipboard;format="${format}"`;
    const item = { 'text/plain': link };
    if (process.platform === 'win32') {
        const no = new Blob([new Uint8Array(4)]); // a DWORD of 0
        item[raw('CanIncludeInClipboardHistory')] = no;
        item[raw('CanUploadToCloudClipboard')] = no;
        item[raw('ExcludeClipboardContentFromMonitorProcessing')] = new Blob([new Uint8Array(1)]);
    } else if (process.platform === 'linux') {
        item[raw('x-kde-passwordManagerHint')] = new Blob(['secret']);
    }
    return clipboard.write([new ClipboardItem(item)]);
}

/**
 * An upload's snapshot, from the transfer window, to the main window: its
 * status line and buttons, and the window's title and taskbar. Core's
 * snapshots never name a file, so the name of the one an upload of several is
 * on is main's own.
 */
function uploadUpdated(id, snapshot) {
    const upload = uploads.get(id);
    const { status, phase, fileIndex } = snapshot;
    if (!upload || !GOING.includes(status)) return;
    const progressData = {
        id,
        status,
        // The step alone, with no file name, for the window's title.
        step: snapshot.text,
        fileName: upload.files.length > 1 && phase === 'chunk' ? upload.files[fileIndex]?.name ?? null : null,
        percent: snapshot.percent,
        paused: status === 'paused',
        canPause: snapshot.canPause === true,
        deadline: snapshot.deadline ?? null,
    };
    const main = mainWindow();
    // Send to main window if it exists
    if (main) {
        main.webContents.send(IPC.UPLOAD_STATUS, { type: 'progress', data: progressData });

        // Update window title and taskbar progress. The taskbar and window
        // switchers show the title, so it gives the step, never a file name.
        if (progressData.paused) {
            main.setTitle(`${APP_NAME} — Paused`);
            main.setProgressBar((progressData.percent ?? 0) / 100, { mode: 'paused' });
        } else if (typeof progressData.percent === 'number') {
            main.setTitle(`${APP_NAME} — Uploading ${progressData.percent.toFixed(0)}%`);
            main.setProgressBar(progressData.percent / 100);
        } else if (progressData.step) {
            main.setTitle(`${APP_NAME} — ${progressData.step}`);
        }
    }
}

/**
 * An upload's one outcome, from the transfer window, or the reason it never
 * started (a window stopped it, or a share couldn't go): the link copied, the
 * main window told, and a notification unless the person is looking at it. A
 * share's ends the share.
 * @param {{ status: 'success', link: string } | { status: 'cancelled' } | { status: 'error', error: string }} result
 * @param {{ share?: boolean }} [upload] - The upload it was, if main made one.
 */
function finishUpload(result, upload) {
    kit.log.info(`Upload finished: ${result.status}`);
    const main = mainWindow();

    // Reset window title and taskbar progress
    if (main) {
        main.setTitle(APP_NAME);
        if (result.status === 'cancelled') {
            main.setProgressBar(-1);
        } else {
            main.setProgressBar(result.status === 'success' ? 1 : 0,
                { mode: result.status === 'success' ? 'none' : 'error' });
            setTimeout(() => {
                if (mainWindow()) mainWindow().setProgressBar(-1);
            }, 3000);
        }
    }

    // Close the active upload notification
    if (activeUploadNotification) {
        activeUploadNotification.close();
        activeUploadNotification = null;
    }

    // A window opened only for a share's question closes as the share ends, so
    // the share is told of as one with no window open.
    const ofShare = upload?.share === true;
    const watching = Boolean(main) && !(ofShare && main === share?.openedWindow) && main.isFocused();

    if (result.status === 'success') {
        copyPrivately(result.link).catch((err) => kit.log.warn(`Couldn't copy the link to the clipboard (${err?.name ?? 'error'}).`));
        if (main) main.webContents.send(IPC.UPLOAD_STATUS, { type: 'success', data: result });
        if (!watching) showNotification('Upload Successful', 'Link copied to clipboard.');
    } else if (result.status === 'cancelled') {
        // Whoever cancelled it knows; nothing to notify.
        if (main) main.webContents.send(IPC.UPLOAD_STATUS, { type: 'cancelled', data: {} });
    } else {
        if (main) main.webContents.send(IPC.UPLOAD_STATUS, { type: 'error', data: result });
        if (!watching) showNotification('Upload Failed', result.error || 'An unknown error occurred.');
    }

    if (ofShare) endShare();
}

/**
 * A share has ended: the window opened for its question closes, the next
 * batch is shared, and once nothing is left, with no window open, the
 * transfer host closes and the app quits, as a launch made only for the
 * share always has.
 */
function endShare() {
    const opened = share?.openedWindow;
    share = null;
    if (opened && !opened.isDestroyed()) opened.close();
    if (shareQueue.length > 0) {
        nextShare();
    } else if (appWindows.size === 0 && !sharing()) {
        kit.log.info('Background task complete, quitting app');
        host?.close();
        app.quit();
    }
}

/**
 * A paused upload's server drops it at its deadline, and nothing resumes it by
 * itself, so the transfer window says so 5 minutes before (or as it pauses,
 * when the pause is shorter). The notification gives the time, never a file.
 */
function pauseEnding(_id, deadline) {
    const time = new Date(deadline).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    showNotification('Upload Still Paused', `The server drops it at ${time} unless it's resumed.`);
}

async function handleOpenDialog() {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow();
    if (!win) return;

    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        title: 'Select a file',
        buttonLabel: 'Select',
        defaultPath: lastOpenDialogDir
    });

    if (canceled || filePaths.length === 0) {
        return;
    }

    const filePath = filePaths[0];
    lastOpenDialogDir = path.dirname(filePath);
    try {
        win.webContents.send(IPC.FILE_OPENED, handOver(win, filePath));
    } catch (error) {
        kit.log.warn(`Couldn't read the file picked with Open File (${error?.code ?? 'error'}).`);
        win.webContents.send(IPC.FILE_OPEN_ERROR, `Could not read ${path.basename(filePath)}.`);
    }
}
