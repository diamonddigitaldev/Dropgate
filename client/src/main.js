const { app, BrowserWindow, dialog, clipboard, ClipboardItem, Notification, webContents } = require('electron');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const { countOf } = require('@diamonddigitaldev/electron-kit/format');

const { APP_NAME, IPC, SETTINGS_DEFAULTS, SETTINGS_SCHEMA_VERSION, V3_STORE_KEYS, WINDOW, BATCH_DEBOUNCE_MS } = require('./constants');
const { menuItems } = require('./menu');
const { Handles } = require('./core/handles');
const { createTransferHost } = require('./transfer-host');

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
//   carries a file's bytes.
// Share with Dropgate (Windows' context menu) launches the app with a file's
// path and --upload: it uploads the file from a hidden window, without opening
// the main one, and quits once it's done. Windows starts one launch per file
// selected, so the files of every launch reaching the app within 500 ms of the
// last are uploaded together, as one bundle; one launch can carry several.
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

let uploadQueue = [];
let isUploading = false;
let activeUploadNotification = null;

// Electron 43+ opens file dialogs in Downloads unless told otherwise. Remember the
// last folder for this session only, so it's never written to disk.
let lastOpenDialogDir;

// The files handed to each window, from Open File, a drop, a pick, or Share
// with Dropgate: the window gets a handle, and main keeps the path (core/handles.js).
const handles = new Handles();

// The uploads, by the ID main made: waiting to start, or running in the
// transfer window. Each keeps the window that made it, and its files' paths,
// names and sizes; the transfer window gets a read grant for each file, never
// its path.
const uploads = new Map();

// The transfer window and the file service (transfer-host.js), once the app is ready.
let host = null;

// The app's own windows: the main one, and Share with Dropgate's hidden ones.
const appWindows = new Set();

/** An upload's statuses while it's still going. */
const GOING = ['initializing', 'uploading', 'paused', 'completing'];

/** A file lifetime's units: the page's choices, which core takes. */
const LIFETIME_UNITS = ['minutes', 'hours', 'days', 'unlimited'];

// Batch collection for multi-file context menu selections.
// Windows launches one process per selected file; we debounce them into a single bundle.
let batchFiles = [];
let batchTimer = null;
// The batch is gathered from once the app is ready, with its own launch's files
// in it: the other launches can arrive while it's still starting.
let readyForShares = false;

// Background uploads waiting for their window's page to be ready, by window id.
const pendingBackgroundUploads = new Map();

const mainWindow = () => kit.windows.main();
const ICON = path.join(__dirname, 'img', 'dropgate');

function createWindow() {
    return watchWindow(kit.windows.createMain({
        page: path.join(__dirname, 'index.html'),
        size: { width: WINDOW.WIDTH, height: WINDOW.HEIGHT },
        min: { width: WINDOW.MIN_WIDTH, height: WINDOW.MIN_HEIGHT },
        title: APP_NAME,
        icon: ICON,
        webPreferences: { preload: path.join(__dirname, 'preload.js') },
    }));
}

/**
 * One of the app's windows. The files handed to it, and an upload it made but
 * never started, go with it. When the last one closes, the transfer host
 * closes too: its window is hidden, and would keep the app running with
 * nothing open, so the app quits with its windows, as it always has. (Share
 * with Dropgate makes its next window as the last one closes, so this waits a
 * turn.)
 */
function watchWindow(win) {
    if (appWindows.has(win)) return win;
    appWindows.add(win);
    const owner = win.webContents.id;
    win.webContents.once('destroyed', () => {
        handles.dropOwner(owner);
        for (const [id, upload] of uploads) {
            if (upload.owner === owner && !upload.started) uploads.delete(id);
        }
    });
    win.on('closed', () => {
        appWindows.delete(win);
        setImmediate(() => {
            if (appWindows.size === 0) host?.close();
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

/** The server an upload or a check goes to: plain HTTP only for an address typed with http://. */
const serverOf = (url) => ({ url, allowInsecure: /^http:\/\//i.test(url) });

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
                finishUpload(status === 'error' ? { status, error: message } : { status, ...(link ? { link } : {}) }, upload?.owner);
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

// Manage the background upload queue
function processUploadQueue() {
    if (isUploading || uploadQueue.length === 0) return;
    isUploading = true;
    const { filePaths } = uploadQueue.shift();
    triggerBackgroundUpload(filePaths);
}

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
        !batchFiles.includes(filePath) && !uploadQueue.some((item) => item.filePaths.includes(filePath)));
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
            uploadQueue.push({ filePaths });
            processUploadQueue();
        }
    }, BATCH_DEBOUNCE_MS);
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
 * An upload's one outcome, from the transfer window, or the reason a window
 * stopped it before it started: the link copied, the main window told, and
 * Share with Dropgate's hidden window closed.
 * @param {{ status: 'success', link: string } | { status: 'cancelled' } | { status: 'error', error: string }} result
 * @param {number | undefined} owner - The webContents id of the window that made it.
 */
function finishUpload(result, owner) {
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

    const contents = owner === undefined ? null : webContents.fromId(owner);
    const uploaderWindow = contents ? BrowserWindow.fromWebContents(contents) : null;
    const isFocused = main?.isFocused() ?? false;

    if (result.status === 'success') {
        copyPrivately(result.link).catch((err) => kit.log.warn(`Couldn't copy the link to the clipboard (${err?.name ?? 'error'}).`));
        if (main) main.webContents.send(IPC.UPLOAD_STATUS, { type: 'success', data: result });
        // Show notification if main window doesn't exist or isn't focused
        if (!main || !isFocused) showNotification('Upload Successful', 'Link copied to clipboard.');
    } else if (result.status === 'cancelled') {
        // Whoever cancelled it knows; nothing to notify.
        if (main) main.webContents.send(IPC.UPLOAD_STATUS, { type: 'cancelled', data: {} });
    } else {
        if (main) main.webContents.send(IPC.UPLOAD_STATUS, { type: 'error', data: result });
        if (!main || !isFocused) showNotification('Upload Failed', result.error || 'An unknown error occurred.');
    }

    // Only destroy background windows, not the main window
    if (uploaderWindow && uploaderWindow !== main) uploaderWindow.destroy();

    isUploading = false;

    // If there are more items, process them.
    if (uploadQueue.length > 0) {
        processUploadQueue();
    } else if (wasLaunchedForBackgroundTask && !mainWindow()) {
        kit.log.info('Background task complete, quitting app');
        app.quit();
    }
}

// A window stopped an upload before it started: no server, or the security warning declined.
kit.ipc.handle(IPC.UPLOAD_FINISHED, (event, result) => {
    if (result?.status !== 'error' || typeof result.error !== 'string') throw new Error('Expected why the upload never started.');
    finishUpload({ status: 'error', error: result.error }, event.sender.id);
});

/** The upload a request names, by the ID main made. */
function uploadOf(request) {
    const id = request?.id;
    if (typeof id !== 'string' || !uploads.has(id)) throw new Error('Expected an upload.');
    return id;
}

// Cancel, from any window: the upload may be running for a hidden window
// (Share with Dropgate) while the person clicks Cancel in the main one.
kit.ipc.handle(IPC.TRANSFER_CANCEL, (_event, request) => {
    const id = uploadOf(request);
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

    if (uploads.get(id).started) host.cancel(id);
    else uploads.delete(id);
});

// Pause Upload and Resume Upload, from any window. The answer is core's reason
// when it couldn't, which the window shows.
kit.ipc.handle(IPC.TRANSFER_PAUSE, (_event, request) => host.pause(uploadOf(request)));
kit.ipc.handle(IPC.TRANSFER_RESUME, (_event, request) => host.resume(uploadOf(request)));

/**
 * A paused upload's server drops it at its deadline, and nothing resumes it by
 * itself, so the transfer window says so 5 minutes before (or as it pauses,
 * when the pause is shorter). The notification gives the time, never a file.
 */
function pauseEnding(_id, deadline) {
    const time = new Date(deadline).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    showNotification('Upload Still Paused', `The server drops it at ${time} unless it's resumed.`);
}

// The page's Copy button: the same copy as an upload's.
kit.ipc.handle(IPC.LINK_COPY, (_event, link) => {
    if (typeof link !== 'string' || !/^https?:\/\//.test(link)) throw new Error('Expected a link.');
    return copyPrivately(link);
});

// Restart Now asks first while an upload runs for any window, paused or not.
kit.ipc.handle(IPC.UPLOAD_BUSY, () => [...uploads.values()].some((upload) => upload.started));

// Files dropped on Upload, picked with its file input, or opened with the app:
// the page has their paths from the kit (kitAPI.getPathForFile, from the File
// the person dropped or picked), and gets a handle for each. This is the one
// channel that takes a path. Folders aren't uploaded, and are counted so the
// page can say so.
kit.ipc.handle(IPC.FILES_ADD, (event, paths) => {
    if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string' && path.isAbsolute(p))) {
        throw new Error('Expected a list of paths.');
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    const files = [];
    let folders = 0;
    for (const filePath of paths) {
        try {
            if (fs.statSync(filePath).isDirectory()) folders++;
            else files.push(handOver(win, filePath));
        } catch {
            // Gone since it was dropped: nothing to add.
        }
    }
    return { files, folders };
});

// The window is done with a file: removed from its list, or uploaded.
kit.ipc.handle(IPC.FILE_REVOKE, (event, handle) => {
    handles.revoke(event.sender.id, handle);
});

// Test, and the check before an upload: asked of the server by the transfer window.
kit.ipc.handle(IPC.SERVER_CHECK, (_event, url) => {
    if (typeof url !== 'string' || url.trim() === '' || url.length > 2048) throw new Error('Expected a server address.');
    return host.check(serverOf(url.trim()));
});

/** An upload's options, as the page sets them: checked, and copied. */
function uploadOptions(options) {
    const { lifetime, maxDownloads, encrypt } = options ?? {};
    if (!LIFETIME_UNITS.includes(lifetime?.unit) || typeof lifetime.value !== 'number' || !Number.isFinite(lifetime.value) || lifetime.value < 0) {
        throw new Error('Expected a file lifetime.');
    }
    if (!Number.isSafeInteger(maxDownloads) || maxDownloads < 0) throw new Error('Expected a download limit.');
    if (typeof encrypt !== 'boolean') throw new Error('Expected whether to encrypt.');
    return { lifetime: { value: lifetime.value, unit: lifetime.unit }, maxDownloads, encrypt };
}

// An upload of files handed to this window, waiting to start.
kit.ipc.handle(IPC.TRANSFER_ADD_UPLOAD, (event, request) => {
    const { files, options } = request ?? {};
    if (!Array.isArray(files) || files.length === 0) throw new Error('Expected files to upload.');
    const held = files.map((handle) => handles.get(event.sender.id, handle));
    if (held.some((file) => !file)) throw new Error('Expected files handed to this window.');
    const id = randomUUID();
    uploads.set(id, {
        owner: event.sender.id,
        files: held.map(({ path: filePath, name, size, mtimeMs }) => ({ path: filePath, name, size, mtimeMs })),
        options: uploadOptions(options),
        started: false,
    });
    return { id };
});

// Start uploads this window made, in the transfer window, to the server in Settings.
kit.ipc.handle(IPC.TRANSFER_START, (event, request) => {
    const ids = request?.ids;
    const waiting = (id) => uploads.get(id)?.owner === event.sender.id && !uploads.get(id).started;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every(waiting)) throw new Error('Expected uploads waiting to start.');
    const { serverURL } = kit.settings.get();
    if (!serverURL) throw new Error('Server URL is not configured.');
    for (const id of ids) {
        const upload = uploads.get(id);
        upload.started = true;
        host.upload(id, serverOf(serverURL), upload.options, upload.files);
    }
});

kit.ipc.handle(IPC.WINDOW_SHOW, (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow && !senderWindow.isDestroyed()) {
        senderWindow.show();
        senderWindow.focus();
    }
});

// A window's page has set itself up. A hidden one made for Share with
// Dropgate is sent its files now.
kit.ipc.handle(IPC.WINDOW_READY, (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow || !pendingBackgroundUploads.has(senderWindow.id)) return;

    const windowId = senderWindow.id;
    const { filePaths } = pendingBackgroundUploads.get(windowId);
    pendingBackgroundUploads.delete(windowId);
    try {
        const files = filePaths.map((filePath) => handOver(senderWindow, filePath));
        activeUploadNotification = showNotification('Upload Started', `Uploading ${countOf(files.length, 'file')}…`);
        senderWindow.webContents.send(IPC.UPLOAD_BACKGROUND_START, { files });
    } catch (error) {
        kit.log.error(`Couldn't read a file to share (${error?.code ?? 'error'}).`);
        showNotification('Upload Failed', 'Could not read the selected file.');
        if (!senderWindow.isDestroyed()) senderWindow.destroy();
        isUploading = false;
        processUploadQueue();
    }
});

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

// BACKGROUND UPLOAD: a hidden window, in the app's session, starts the upload
// with the page's own code, and it runs in the transfer window as any other.
// It has no menu of its own: the house menu is the main window's.
function triggerBackgroundUpload(filePaths) {
    // Filter out any files that no longer exist
    const validPaths = filePaths.filter(fp => fs.existsSync(fp));

    if (validPaths.length === 0) {
        showNotification('Upload Failed', 'File(s) not found.');
        isUploading = false;
        processUploadQueue();
        return;
    }

    const backgroundWindow = new BrowserWindow({
        show: false,
        width: WINDOW.WIDTH,
        height: WINDOW.HEIGHT,
        minWidth: WINDOW.MIN_WIDTH,
        minHeight: WINDOW.MIN_HEIGHT,
        title: APP_NAME,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            spellcheck: false,
        },
        icon: `${ICON}${process.platform === 'win32' ? '.ico' : '.png'}`,
    });
    backgroundWindow.removeMenu();
    watchWindow(backgroundWindow);

    const windowId = backgroundWindow.id;

    // Store the pending upload BEFORE loading the file
    pendingBackgroundUploads.set(windowId, { filePaths: validPaths });

    // Clean up if window is closed before upload starts
    backgroundWindow.on('closed', () => {
        if (pendingBackgroundUploads.has(windowId)) {
            pendingBackgroundUploads.delete(windowId);
            isUploading = false;
            processUploadQueue();
        }
    });

    activeUploadNotification = showNotification('Initialising Upload', `Preparing ${countOf(validPaths.length, 'file')}…`);

    backgroundWindow.loadFile(path.join(__dirname, 'index.html'));
}
