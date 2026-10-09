const { app, BrowserWindow, dialog, clipboard, ClipboardItem, Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const { countOf } = require('@diamonddigitaldev/electron-kit/format');

const { APP_NAME, IPC, SETTINGS_DEFAULTS, SETTINGS_SCHEMA_VERSION, V3_STORE_KEYS, WINDOW, BATCH_DEBOUNCE_MS } = require('./constants');
const { menuItems } = require('./menu');
const { FileReads } = require('./core/file-reads');

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
//   with every argv's paths in it (PB-D1).
// - The updater checks GitHub 5 seconds after a packaged launch and when
//   asked, never sends an ID of the install, makes none, and deletes the one
//   v3's updater kept (PB-D4). As in v3, a launch for Share with Dropgate
//   doesn't check.
// - Windows' app ID is build.appId, the one the installer's Start menu
//   shortcut carries, so Share with Dropgate's notifications show.
// - Links open in the browser only on Dropgate's own pages, beside the ones
//   the kit shows (Credits, its donate link, the repository).
// - The files the app is opened with ("Open with", files dropped on its icon,
//   a second launch) reach Upload as the kit's files:opened (#93), every one
//   of them, bar a Share with Dropgate launch's, which are main's own.
// - A link is copied to the clipboard marked to stay out of Windows'
//   clipboard history and cloud clipboard, and out of KDE's: it holds the key
//   (PB-D5). Notifications say how many files, never which (PB-D6).
// Share with Dropgate (Windows' context menu) launches the app with a file's
// path and --upload: it uploads the file in a hidden window, without opening
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

// The windows running an upload, by webContents id, so Restart Now can ask first.
const uploadingIn = new Set();

// Electron 43+ opens file dialogs in Downloads unless told otherwise. Remember the
// last folder for this session only, so it's never written to disk.
let lastOpenDialogDir;

// The files the page may read ranges of: those main handed it, from Open File,
// a drop, or Share with Dropgate. One changed since can't be read (core/file-reads.js).
const fileReads = new FileReads();

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
    return kit.windows.createMain({
        page: path.join(__dirname, 'index.html'),
        size: { width: WINDOW.WIDTH, height: WINDOW.HEIGHT },
        min: { width: WINDOW.MIN_WIDTH, height: WINDOW.MIN_HEIGHT },
        title: APP_NAME,
        icon: ICON,
        webPreferences: { preload: path.join(__dirname, 'preload.js') },
    });
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

/** A file on disk, handed to the page: it may read it from now on, as it is now. */
const handOver = (filePath) => fileReads.handOver(filePath);

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

kit.ipc.handle(IPC.UPLOAD_PROGRESS, (event, progressData) => {
    uploadingIn.add(event.sender.id);
    const main = mainWindow();
    // Send to main window if it exists
    if (main) {
        main.webContents.send(IPC.UPLOAD_STATUS, { type: 'progress', data: progressData });

        // Update window title and taskbar progress. The taskbar and window
        // switchers show the title, so it gives the step, never a file name.
        if (progressData.paused) {
            main.setTitle(`${APP_NAME} — Paused`);
            main.setProgressBar((progressData.percent ?? 0) / 100, { mode: 'paused' });
        } else if (progressData.percent !== undefined) {
            main.setTitle(`${APP_NAME} — Uploading ${progressData.percent.toFixed(0)}%`);
            main.setProgressBar(progressData.percent / 100);
        } else if (progressData.step) {
            main.setTitle(`${APP_NAME} — ${progressData.step}`);
        }
    }
});

kit.ipc.handle(IPC.UPLOAD_FINISHED, (event, result) => {
    uploadingIn.delete(event.sender.id);
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

    const uploaderWindow = BrowserWindow.fromWebContents(event.sender);
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
});

kit.ipc.handle(IPC.UPLOAD_CANCEL, () => {
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

    // Broadcast cancellation to all windows — the upload may be running in a
    // background window while the user clicks cancel in the main window.
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IPC.UPLOAD_CANCEL_REQUESTED);
    }
});

// The page's Copy button: the same copy as an upload's.
kit.ipc.handle(IPC.LINK_COPY, (_event, link) => {
    if (typeof link !== 'string' || !/^https?:\/\//.test(link)) throw new Error('Expected a link.');
    return copyPrivately(link);
});

// Restart Now asks first while any window, the main one or a hidden one, uploads.
kit.ipc.handle(IPC.UPLOAD_BUSY, () => uploadingIn.size > 0);

// Lazy file reading: the page asks for one range of bytes at a time, never a
// whole file. A file changed since it was handed over answers { changed: true }.
kit.ipc.handle(IPC.FILE_READ_RANGE, (_event, filePath, start, end) => fileReads.read(filePath, start, end));

kit.ipc.handle(IPC.FILE_REVOKE, (_event, filePath) => {
    fileReads.revoke(filePath);
});

// Pause Upload and Resume Upload, from any window: passed on to whichever window runs the upload, as Cancel is.
kit.ipc.handle(IPC.UPLOAD_PAUSE, (_event, paused) => {
    if (typeof paused !== 'boolean') throw new Error('Expected whether to pause.');
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IPC.UPLOAD_PAUSE_REQUESTED, paused);
    }
});

// A paused upload's server drops it at its deadline, and nothing resumes it by
// itself, so the window running it says so 5 minutes before (or as it pauses,
// when the pause is shorter). The notification gives the time, never a file.
kit.ipc.handle(IPC.UPLOAD_PAUSE_ENDING, (_event, deadline) => {
    if (!Number.isFinite(deadline)) throw new Error('Expected a deadline.');
    const time = new Date(deadline).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    showNotification('Upload Still Paused', `The server drops it at ${time} unless it's resumed.`);
});

// Files dropped on Upload: the kit's drop zone hands the page their paths
// (kitAPI.getPathForFile, from the File the person dropped). Folders aren't
// uploaded, and are counted so the page can say so.
kit.ipc.handle(IPC.FILES_ADD, (_event, paths) => {
    if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string' && path.isAbsolute(p))) {
        throw new Error('Expected a list of paths.');
    }
    const files = [];
    let folders = 0;
    for (const filePath of paths) {
        try {
            if (fs.statSync(filePath).isDirectory()) folders++;
            else files.push(handOver(filePath));
        } catch {
            // Gone since it was dropped: nothing to add.
        }
    }
    return { files, folders };
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
        const files = filePaths.map(handOver);
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
        win.webContents.send(IPC.FILE_OPENED, handOver(filePath));
    } catch (error) {
        kit.log.warn(`Couldn't read the file picked with Open File (${error?.code ?? 'error'}).`);
        win.webContents.send(IPC.FILE_OPEN_ERROR, `Could not read ${path.basename(filePath)}.`);
    }
}

// BACKGROUND UPLOAD: a hidden window, in the app's session, runs the upload
// with the page's own code. It has no menu of its own: the house menu is the
// main window's.
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

    const windowId = backgroundWindow.id;
    const contentsId = backgroundWindow.webContents.id;

    // Store the pending upload BEFORE loading the file
    pendingBackgroundUploads.set(windowId, { filePaths: validPaths });

    // Clean up if window is closed before upload starts
    backgroundWindow.on('closed', () => {
        uploadingIn.delete(contentsId);
        if (pendingBackgroundUploads.has(windowId)) {
            pendingBackgroundUploads.delete(windowId);
            isUploading = false;
            processUploadQueue();
        }
    });

    activeUploadNotification = showNotification('Initialising Upload', `Preparing ${countOf(validPaths.length, 'file')}…`);

    backgroundWindow.loadFile(path.join(__dirname, 'index.html'));
}
