const { app, BrowserWindow, dialog, clipboard, ClipboardItem, Notification, powerSaveBlocker, shell } = require('electron');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const { countOf } = require('@diamonddigitaldev/electron-kit/format');

const {
    APP_NAME, AT_ONCE_RANGE, IPC, PARTIAL_FOLDER, SETTINGS_DEFAULTS, SETTINGS_SCHEMA_VERSION, V3_STORE_KEYS, WINDOW, BATCH_DEBOUNCE_MS, TRANSFERS, migrateSettings,
} = require('./constants');
const { menuItems } = require('./menu');
const { Handles, describeFile } = require('./core/handles');
const { endNotice, countsLine } = require('./core/notices');
const { shareUpload } = require('./core/share');
const { GOING, Pacer, Transfers, inFolder, view } = require('./core/transfers');
const { createTransferHost } = require('./transfer-host');
const { createTray } = require('./tray');
const { guardSettings } = require('./settings-guard');
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
// - Main's registry of transfers (core/transfers.js) holds every upload, the
//   window's and Share with Dropgate's alike: up to TRANSFERS.AT_ONCE run at
//   once, the rest queued in the order added, and a paused one takes no place.
//   Each reaches the window at most TRANSFERS.UPDATES_PER_SECOND times a
//   second. Nothing in it survives quitting.
// - Closing the main window while a transfer runs, is paused or is queued
//   hides it, and Dropgate's tray icon shows (tray.js); a notification says so
//   the first time. Once nothing is left, the app quits, as it would have when
//   the window closed. With nothing going, closing the window quits.
// - Quitting (the tray's Quit, the menu's Exit, the OS) cancels every transfer
//   in the transfer window, each server told, before the app goes.
// - A finished upload can be deleted from its server (its Delete) while its
//   card is there: the transfer window does it with the upload's manage
//   token, which it keeps from the upload's end until the card is removed or
//   the app quits. Main knows only whether it can: the token never leaves the
//   transfer window.
// - While anything runs, the system isn't let suspend the app
//   ('prevent-app-suspension'); the transfer window's timers are never slowed.
// - Notifications about transfers ending come only while the main window
//   isn't in front of the person (not focused, or in the tray): those ending
//   together are told of in one (core/notices.js).
// - A download starts from a link pasted into Download: main checks its shape
//   and hands it to the transfer window, which reads its list of files with
//   no lease (the server counts nothing) and keeps the link for the download;
//   main keeps only the server's address and host, and never stores or logs
//   the link. Downloads run in the registry with uploads. Each is saved in its
//   Save to folder (Settings > Transfers' downloads folder, the system's
//   Downloads unless one was chosen, or one chosen with the system's picker
//   for it, which the window knows by an ID and a name): the file service
//   writes it in the partial folder in the profile under a random name, and
//   moves it into place under a name made safe and unique there, replacing
//   nothing, with Windows' Mark of the Web. A bundle's (all its files, or
//   those chosen) is saved as files in a new folder of its own there, or as
//   one ZIP. Main empties the partial folder at every start and at quit, and
//   shows a saved file in its folder when asked (Show in Folder), or opens a
//   bundle's own folder (Open Folder), never opening anything received.
// - The page changes its settings through main (settings-guard.js), which
//   refuses the downloads folder from it, and tells the registry when
//   transfers at once changes.
// Share with Dropgate (Windows' context menu) launches the app with a file's
// path and --upload. Main makes the upload itself, with no window: the server
// in Settings, checked by the transfer window, with Settings' lifetime and
// download limit, queued in the registry like any other. A server with no
// end-to-end encryption opens the main window to ask first (the Upload
// Security Warning), and the share waits for the answer. A launch made only
// for sharing quits once every share has ended. Windows starts one launch per
// file selected, so the files of every launch reaching the app within 500 ms
// of the last are uploaded together, as one bundle; one launch can carry
// several. Shares gathered apart run side by side.
const wasLaunchedForBackgroundTask = process.argv.includes('--upload');

const kit = require('@diamonddigitaldev/electron-kit/main').start({
    appId: 'com.diamonddigitaldev.dropgateclient',
    // package.json's name, dropgate-client, names the userData folder, so it stays.
    name: APP_NAME,
    settings: {
        defaults: SETTINGS_DEFAULTS,
        version: SETTINGS_SCHEMA_VERSION,
        migrate: migrateSettings,
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

/** Transfers at once, as Settings > Transfers has it, held to its range. */
function atOnceSetting() {
    const n = kit.settings.get().transfersAtOnce;
    return Number.isSafeInteger(n) ? Math.min(AT_ONCE_RANGE.MAX, Math.max(AT_ONCE_RANGE.MIN, n)) : TRANSFERS.AT_ONCE;
}

// The page's settings changes come through main: never the downloads folder,
// and transfers at once reaches the registry as it changes.
guardSettings({
    kit,
    onChange: (changes) => {
        if (Object.hasOwn(changes, 'transfersAtOnce')) transfers.setAtOnce(atOnceSetting());
    },
});

// Where downloads are written until they're whole: emptied at every start and at quit.
const partials = path.join(app.getPath('userData'), PARTIAL_FOLDER);

/** Empty the partial folder: nothing of a download that didn't finish (a crash's, too) is kept. */
function emptyPartials() {
    try {
        fs.rmSync(partials, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
        kit.log.warn(`Couldn't empty the partial downloads folder (${error?.code ?? 'error'}).`);
    }
}

// The folders each window chose with the system's picker (Save to, Settings >
// Transfers), by an ID made here: the window knows a folder by it and its name
// only. In memory only, for this run.
const chosenFolders = new Map();

// Electron 43+ opens file dialogs in Downloads unless told otherwise. Remember the
// last folder for this session only, so it's never written to disk.
let lastOpenDialogDir;

// The files handed to each window, from Open File, a drop or a pick: the
// window gets a handle, and main keeps the path (core/handles.js).
const handles = new Handles();

// The transfer window and the file service (transfer-host.js), once the app is ready.
let host = null;

// The registry of transfers: a window's own keep that window (owner); a
// share's has none, keeps the window asked about it while it waits for the
// answer (ask), and its server. Each keeps its files' paths, names and sizes;
// the transfer window gets a read grant for each file, never its path.
const transfers = new Transfers({
    atOnce: atOnceSetting(),
    start: runTransfer,
    resume: resumeQueued,
    changed: transferChanged,
    removed: (card) => {
        pacer.drop(card.id);
        // A finished upload's manage token goes with its card.
        host?.forget(card.id);
        mainWindow()?.webContents.send(IPC.TRANSFER_REMOVED, [card.id]);
        followGoing();
    },
});

/** The transfers going: running, paused or queued. Waiting and ended ones aren't. */
const goingTransfers = () => transfers.list().filter((card) => GOING.includes(card.state));

// Each transfer as the window draws it, at most TRANSFERS.UPDATES_PER_SECOND times a second.
const pacer = new Pacer(TRANSFERS.UPDATES_PER_SECOND, (_id, card) => mainWindow()?.webContents.send(IPC.TRANSFER_CHANGED, card));

// The app's own windows: the main one (the kit's). Share with Dropgate makes none.
const appWindows = new Set();

// The windows whose page has set itself up, by webContents id: a share's question goes to one only once it has.
const readyWindows = new Set();

// Share with Dropgate: the files of the launches arriving now, gathered for
// 500 ms (Windows launches one process per selected file, and they're
// uploaded as one bundle), and the shares under way: being checked, asked
// about, queued or uploading. Each is { notice }, its progress notification.
let batchFiles = [];
let batchTimer = null;
const shares = new Set();
// The main window, when it was opened only to ask a share's question: it closes once no share is left.
let askWindow = null;
// The batch is gathered from once the app is ready, with its own launch's files
// in it: the other launches can arrive while it's still starting.
let readyForShares = false;

// The tray icon, while the main window is closed with transfers going, and whether its notification has been shown this run.
const tray = createTray({ icon: path.join(__dirname, 'img', 'dropgate'), open: openFromTray, quit: () => app.quit() });
let toldOfTray = false;

// Quitting: from before-quit on, nothing starts and the window no longer hides
// to the tray; once the transfer window has cancelled everything, it quits.
let quitting = false;
let readyToQuit = false;

// The power-save blocker's ID while anything runs.
let powerBlocker = null;

// Transfers that ended while nobody was looking, to tell of in one notification.
let ends = [];
let endsTimer = null;

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

/** Whether Share with Dropgate has anything under way: files gathering, or shares being checked, asked about, queued or uploading. */
const sharing = () => shares.size > 0 || batchFiles.length > 0 || batchTimer !== null;

/** Whether anything keeps the app going with no window: a transfer running, paused or queued, or a share under way. */
const going = () => transfers.busy() || sharing();

/** Whether the person is looking at the main window: it's shown and in front. */
const watched = (win = mainWindow()) => Boolean(win) && win.isVisible() && win.isFocused();

/**
 * One of the app's windows. The files handed to it, an upload it made but
 * never started, and a share's question it was asked and never answered (the
 * share is declined), go with it. Closed while anything is going, it hides
 * instead, and the tray icon shows. When the last one closes, the transfer
 * host closes too (its window is hidden, and would keep the app running with
 * nothing open), so the app quits with its windows, as it always has: unless
 * a share is under way, which runs with no window, and quits the app once
 * it's done (settle()).
 */
function watchWindow(win) {
    if (appWindows.has(win)) return win;
    appWindows.add(win);
    const owner = win.webContents.id;
    win.on('close', (event) => {
        if (quitting) return;
        // Closing already: declining its questions mustn't close it again.
        if (askWindow === win) askWindow = null;
        declineQuestionsOf(owner);
        if (!going()) return;
        event.preventDefault();
        win.hide();
        tray.show(transfers.counts());
        if (!toldOfTray) {
            toldOfTray = true;
            // A share still being checked is going too, though it isn't a transfer yet.
            const count = Math.max(1, goingTransfers().length);
            const noun = goingTransfers().every((card) => card.kind === 'upload') ? 'upload' : goingTransfers().every((card) => card.kind === 'download') ? 'download' : 'transfer';
            showNotification('Still Running in the Tray', `${countOf(count, noun)} ${count === 1 ? 'goes' : 'go'} on in the background. Open or quit ${APP_NAME} from its tray icon.`);
        }
    });
    win.on('show', () => tray.hide());
    win.webContents.once('destroyed', () => {
        readyWindows.delete(owner);
        handles.dropOwner(owner);
        declineQuestionsOf(owner);
        for (const card of transfers.list()) {
            if (card.owner === owner && ['reading', 'waiting'].includes(card.state)) transfers.withdraw(card.id);
        }
        for (const [folder, chosen] of chosenFolders) if (chosen.owner === owner) chosenFolders.delete(folder);
    });
    win.on('closed', () => {
        appWindows.delete(win);
        if (askWindow === win) askWindow = null;
        setImmediate(() => {
            if (appWindows.size === 0 && !going()) host?.close();
        });
    });
    return win;
}

/** A window closing: every share's question it was asked and never answered is declined. */
function declineQuestionsOf(owner) {
    for (const card of transfers.list()) {
        if (card.ask?.owner === owner && card.state === 'waiting') declineShare(card.id);
    }
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

/** The tray's Open Dropgate Client: the main window, shown again (and the icon goes). */
function openFromTray() {
    const win = mainWindow() ?? createWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
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
        // Anything a run before left part-written (a crash's) goes before anything runs.
        emptyPartials();
        host = createTransferHost({
            kit,
            appInfo: { name: APP_NAME, version: app.getVersion() },
            onUpdate: (id, snapshot) => transfers.updated(id, snapshot),
            onPauseEnding: pauseEnding,
            onTokensLost: tokensLost,
            onSaved: (id, filePath) => transfers.saved(id, filePath),
            partials,
            onFinished: (id, { status, link, message }) => {
                const result = status === 'error' ? { status, error: message } : { status, ...(link ? { link } : {}) };
                const card = transfers.ended(id, result);
                if (card?.kind === 'download') finishDownload(result, card);
                else finishUpload(result, card);
            },
        });
        app.on('before-quit', beforeQuit);
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
    transfers,
    host: () => host,
    windowReady,
    start: startUpload,
    pause: (id) => (transfers.pause(id) ? host.pause(id) : Promise.resolve({})),
    resume: (id) => (transfers.resume(id) ? host.resume(id).finally(() => transfers.resumed(id)) : Promise.resolve({})),
    cancel: cancelUpload,
    delete: deleteUpload,
    busy: going,
    failed: (result) => finishUpload(result),
    copyLink: copyPrivately,
    addDownload,
    saveTo: (ids, folder, owner) => transfers.saveTo(ids, saveToOf(folder, owner)),
    show: showSaved,
    chooseFolder,
    chose: (owner, folder) => chosenFolders.get(folder)?.owner === owner,
    defaultFolder,
    setDefaultFolder,
});

/**
 * Show in Folder: the folder a finished download was saved in, with its file
 * (or ZIP) selected. Open Folder, for a bundle saved as files: its own folder,
 * opened, once it's checked to be a folder still (never a file, or a link to
 * one: nothing received is ever opened).
 * @param {string} id
 */
function showSaved(id) {
    const card = transfers.get(id);
    if (!inFolder(card)) {
        shell.showItemInFolder(card.saved);
        return;
    }
    let folder = false;
    try {
        folder = fs.lstatSync(card.saved).isDirectory();
    } catch {
        // Moved or deleted since.
    }
    if (!folder) throw new Error("The download's folder isn't there any more.");
    shell.openPath(card.saved);
}

/** A folder's name for the window: its own, or a drive's root as it's written. */
const labelOf = (folder) => path.basename(folder) || folder;

/** Where new downloads are saved: Settings > Transfers' folder, or the system's Downloads. */
function defaultFolder() {
    const { downloadFolder } = kit.settings.get();
    const folder = typeof downloadFolder === 'string' && path.isAbsolute(downloadFolder) ? downloadFolder : app.getPath('downloads');
    return { path: folder, label: labelOf(folder), chosen: folder === downloadFolder };
}

/** A download's Save to, as the window knows it: the default, or a folder it chose, by ID, with its name. */
function saveToOf(folder, owner) {
    if (folder === 'default') return { folder, label: defaultFolder().label };
    const chosen = chosenFolders.get(folder);
    if (chosen?.owner !== owner) throw new Error('Expected a folder this window chose.');
    return { folder, label: chosen.label };
}

/**
 * The system's folder picker, over the window that asked: the folder it
 * picks gets an ID for that window, for this run, and the window is told the
 * ID and the folder's own name, never its path.
 * @param {Electron.WebContents} sender
 */
async function chooseFolder(sender) {
    const win = BrowserWindow.fromWebContents(sender) ?? mainWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Choose a Folder',
        buttonLabel: 'Choose',
        defaultPath: defaultFolder().path,
    });
    if (canceled || filePaths.length === 0) return null;
    const folder = randomUUID();
    chosenFolders.set(folder, { owner: sender.id, path: filePaths[0], label: labelOf(filePaths[0]) });
    return { folder, label: labelOf(filePaths[0]) };
}

/**
 * Settings > Transfers' Browse (a folder the window chose) or Reset (null:
 * the system's Downloads): saved, and every download still waiting on the
 * default shows its new name.
 */
function setDefaultFolder(owner, folder) {
    kit.settings.set({ downloadFolder: folder === null ? null : chosenFolders.get(folder).path });
    const waiting = transfers.list().filter((card) => card.kind === 'download' && card.saveTo?.folder === 'default').map((card) => card.id);
    transfers.saveTo(waiting, saveToOf('default', owner));
    return defaultFolder();
}

/**
 * A link pasted into Download, its shape checked: a download that reads its
 * list of files in the transfer window (with no lease: nothing is counted),
 * then waits for Download, saved to the default folder unless it's changed.
 * The link goes to the transfer window, and main keeps none of it: only the
 * server's address and host, for the card.
 * @param {number} owner
 * @param {{ link: string, server: { url: string, allowInsecure: boolean }, host: string }} download
 */
function addDownload(owner, { link, server, host: linkHost }) {
    const card = transfers.add({ kind: 'download', owner, server, host: linkHost, files: [], options: null, saveTo: saveToOf('default', owner) });
    const { id } = card;
    host.metadata(id, link).then((answer) => {
        if (answer.message) transfers.ended(id, { status: 'error', error: answer.message });
        else transfers.read(id, answer);
    }, () => transfers.ended(id, { status: 'error', error: "The link's list of files couldn't be read." }));
    return { id };
}

/**
 * The transfer window stopped by itself: the finished uploads' manage tokens
 * went with it, and so did the links of downloads that hadn't started, which
 * can't be downloaded from here any more.
 */
function tokensLost(ids) {
    transfers.tokensLost(ids);
    for (const id of ids) {
        const card = transfers.get(id);
        if (card?.kind === 'download' && ['reading', 'waiting'].includes(card.state)) {
            transfers.ended(id, { status: 'error', error: 'The link to this download is no longer held: Paste it again.' });
        }
    }
}

/**
 * The app is quitting, by any way: the tray's Quit, the menu's Exit, the
 * window closing with nothing going, the OS. Nothing new starts; anything
 * the transfer window never had is dropped; the transfer window cancels what
 * runs there, each server told, and then the app quits, with nothing of any
 * transfer kept. Whatever ended unseen is told of first.
 */
function beforeQuit(event) {
    quitting = true;
    tray.hide();
    flushEnds();
    if (readyToQuit) return;
    transfers.close();
    // Running transfers are cancelled there, finished uploads' manage tokens
    // and downloads' links forgotten; then, once the file service has exited
    // (holding no partial file open), the partial folder is emptied.
    if (host?.busy || host?.keeping) {
        event.preventDefault();
        host.quit().finally(async () => {
            readyToQuit = true;
            await host.close();
            emptyPartials();
            app.quit();
        });
    } else {
        readyToQuit = true;
        host?.close();
        emptyPartials();
    }
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

    // Every file in it, bar one already gathering, so none is uploaded twice at once.
    const filePaths = filesInArgs(argv).filter((filePath) => !batchFiles.includes(filePath));
    if (filePaths.length === 0 && batchFiles.length === 0) {
        kit.log.info('Share with Dropgate: No file to upload in the arguments.');
        return;
    }

    // Collect files and debounce — Windows launches one process per selected
    // file, so multi-select arrivals are spaced milliseconds apart.
    batchFiles.push(...filePaths);
    scheduleBatch();
}

/** Share what's gathered 500 ms after the last arrival, once the app is ready. */
function scheduleBatch() {
    if (!readyForShares || batchFiles.length === 0) return;
    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = setTimeout(() => {
        const filePaths = [...batchFiles];
        batchFiles = [];
        batchTimer = null;
        if (filePaths.length > 0 && !quitting) shareBatch(filePaths);
    }, BATCH_DEBOUNCE_MS);
}

/** Share a batch, beside any others under way. */
function shareBatch(filePaths) {
    const share = { notice: null };
    shares.add(share);
    startShare(share, filePaths).catch((error) => {
        kit.log.error(`Share with Dropgate couldn't start (${error?.code ?? error?.name ?? 'error'}).`);
        finishUpload({ status: 'error', error: 'The upload couldn\'t start.' }, { share });
    });
}

/**
 * Share a batch: its files read as they are now, the server in Settings
 * checked by the transfer window, and an upload made with Settings' lifetime
 * and download limit, held to the server's (core/share.js). It's queued at
 * once, or, on a server with no end-to-end encryption, once the person says
 * so in the main window.
 * @param {{ notice: Notification | null }} share
 * @param {string[]} filePaths
 */
async function startShare(share, filePaths) {
    // Filter out any files that no longer exist
    const validPaths = filePaths.filter((filePath) => fs.existsSync(filePath));
    if (validPaths.length === 0) {
        showNotification('Upload Failed', 'File(s) not found.');
        endShare(share);
        return;
    }
    if (!watched()) share.notice = showNotification('Initialising Upload', `Preparing ${countOf(validPaths.length, 'file')}…`);

    let files;
    try {
        files = validPaths.map(describeFile);
    } catch (error) {
        kit.log.error(`Couldn't read a file to share (${error?.code ?? 'error'}).`);
        finishUpload({ status: 'error', error: 'Could not read the selected file.' }, { share });
        return;
    }

    const settings = kit.settings.get();
    if (!settings.serverURL) {
        finishUpload({ status: 'error', error: 'Server URL is not configured.' }, { share });
        return;
    }
    const server = serverOf(settings.serverURL);
    const check = await host.check(server).catch(() => ({ ok: false }));
    if (quitting) {
        endShare(share);
        return;
    }
    const decided = shareUpload(settings, check);
    if (!decided.ok) {
        finishUpload({ status: 'error', error: decided.message }, { share });
        return;
    }

    const { id } = transfers.add({ owner: null, share, server, files, options: decided.options });
    if (decided.options.encrypt) startUpload(id, server);
    else askInsecure(id);
}

/**
 * A share to a server with no end-to-end encryption: the main window asks
 * the Upload Security Warning, opened for it if it isn't open (and closed
 * again once no share is left, as it would never have been opened otherwise).
 * The page answers with transfer:start (Upload Anyway) or transfer:cancel.
 */
function askInsecure(id) {
    let win = mainWindow();
    if (!win) {
        // Shown once, here: the window opens for the question.
        win = createWindow({ show: false });
        askWindow = win;
    } else if (win.isMinimized()) {
        win.restore();
    }
    win.show();
    win.focus();
    transfers.get(id).ask = { owner: win.webContents.id, sent: false };
    if (readyWindows.has(win.webContents.id)) sendQuestion(id);
}

/** Send a share's question to the window asked, once. */
function sendQuestion(id) {
    const upload = transfers.get(id);
    const contents = mainWindow()?.webContents;
    if (!upload?.ask || upload.ask.sent || contents?.id !== upload.ask.owner) return;
    upload.ask.sent = true;
    contents.send(IPC.TRANSFER_ASK_INSECURE, { id });
}

/** A window's page has set itself up: a question waiting for it is sent now. */
function windowReady(contents) {
    readyWindows.add(contents.id);
    for (const card of transfers.list()) {
        if (card.ask?.owner === contents.id) sendQuestion(card.id);
    }
}

/** Start an upload waiting, a window's own or a share: it's queued, and runs in the transfer window once it has a place. */
function startUpload(id, server) {
    const upload = transfers.get(id);
    delete upload.ask;
    transfers.start(id, server);
}

/** The registry gave a transfer its place: it runs in the transfer window now. */
function runTransfer(card) {
    if (card.kind === 'download') runDownload(card);
    else runUpload(card);
}

/**
 * A download runs, into its Save to folder as main resolves it now: the
 * file service is granted that folder, and the transfer window the output.
 */
function runDownload(card) {
    const folder = card.saveTo?.folder === 'default' || !card.saveTo ? defaultFolder().path : chosenFolders.get(card.saveTo.folder)?.path;
    try {
        if (!folder) throw new Error("The folder to save to isn't there any more.");
        host.download(card.id, folder, { files: card.chosen, asZip: card.asZip }, card.files.length);
    } catch (error) {
        // Once the registry has finished starting what it's starting.
        const result = { status: 'error', error: error.message };
        setImmediate(() => finishDownload(result, transfers.ended(card.id, result)));
    }
}

/** The registry gave an upload its place: it runs in the transfer window now. */
function runUpload(card) {
    if (card.share && !watched()) {
        card.share.notice?.close();
        card.share.notice = showNotification('Upload Started', `Uploading ${countOf(card.files.length, 'file')}…`);
    }
    host.upload(card.id, card.server, card.options, card.files);
}

/** A paused upload asked to resume while every place was taken has one now. */
function resumeQueued(card) {
    host.resume(card.id).then(({ message }) => {
        if (message) kit.log.info('A queued upload couldn\'t be resumed: It stays paused.');
    }, () => {}).finally(() => transfers.resumed(card.id));
}

/** A share's question declined, or its window gone before it was answered. */
function declineShare(id) {
    const card = transfers.withdraw(id);
    finishUpload({ status: 'error', error: 'Upload cancelled by user (insecure connection).' }, card ?? undefined);
}

// Cancel, from any window: a running upload, one queued, or a share's question declined.
function cancelUpload(id) {
    const upload = transfers.get(id);
    if (upload.started) {
        host.cancel(id);
    } else if (upload.state === 'waiting' && upload.share) {
        declineShare(id);
    } else if (upload.state === 'queued') {
        // Never started: it's told of as cancelled, and its card stays, as one cancelled while running does.
        finishUpload({ status: 'cancelled' }, transfers.ended(id, { status: 'cancelled' }));
    }
}

/**
 * Delete, from a window, once it has asked the person: a finished upload, by
 * the transfer window, with the manage token only it holds. Once deleted, its
 * card says so and its link is forgotten. The answer is the reason when it
 * couldn't be, and the upload stays as it was.
 * @param {string} id
 * @returns {Promise<{ message?: string }>}
 */
async function deleteUpload(id) {
    const card = transfers.get(id);
    if (card.state !== 'done' || !card.deletable) throw new Error('Expected a finished upload that can be deleted.');
    if (card.deleting) return { message: 'This upload is already being deleted.' };
    card.deleting = true;
    try {
        const answer = await host.delete(id);
        if (answer.message) return { message: answer.message };
        transfers.deleted(id);
        kit.log.info('A finished upload was deleted from its server.');
        return {};
    } catch {
        return { message: "The upload couldn't be deleted: Dropgate's transfers stopped." };
    } finally {
        card.deleting = false;
    }
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
 * A transfer changed in the registry: its state, or its snapshot from the
 * transfer window. The window hears of it (paced), and the tray, the taskbar
 * and the power-save blocker follow what's going.
 */
function transferChanged(card) {
    pacer.push(card.id, view(card));
    showProgress();
    followGoing();
}

/** The tray's counts and the power-save blocker, as what's going changes. */
function followGoing() {
    tray.update(transfers.counts());
    keepAwake();
}

/** While anything runs, the system isn't let suspend the app; paused or queued, it is. */
function keepAwake() {
    const running = transfers.counts().running > 0;
    if (running && powerBlocker === null) {
        powerBlocker = powerSaveBlocker.start('prevent-app-suspension');
    } else if (!running && powerBlocker !== null) {
        powerSaveBlocker.stop(powerBlocker);
        powerBlocker = null;
    }
}

/**
 * The main window's title and taskbar progress: one transfer's step and
 * percentage, or how many are going and how far they've got together. The
 * taskbar and window switchers show the title, so it never names a file.
 */
function showProgress() {
    const main = mainWindow();
    if (!main) return;
    const active = goingTransfers();
    if (active.length === 0) return;
    if (active.length > 1) {
        const sized = active.filter((card) => card.snapshot?.totalBytes);
        const total = sized.reduce((sum, card) => sum + card.snapshot.totalBytes, 0);
        const done = sized.reduce((sum, card) => sum + (card.snapshot.processedBytes ?? 0), 0);
        main.setTitle(`${APP_NAME} — ${countsLine(transfers.counts())}`);
        main.setProgressBar(total > 0 ? done / total : 0, { mode: transfers.counts().running > 0 ? 'normal' : 'paused' });
        return;
    }
    const [card] = active;
    const progressData = {
        step: card.state === 'queued' ? 'Queued.' : card.snapshot?.text,
        percent: card.snapshot?.percent,
        paused: card.state === 'paused',
    };
    if (progressData.paused) {
        main.setTitle(`${APP_NAME} — Paused`);
        main.setProgressBar((progressData.percent ?? 0) / 100, { mode: 'paused' });
    } else if (typeof progressData.percent === 'number') {
        main.setTitle(`${APP_NAME} — ${card.kind === 'download' ? 'Downloading' : 'Uploading'} ${progressData.percent.toFixed(0)}%`);
        main.setProgressBar(progressData.percent / 100);
    } else if (progressData.step) {
        main.setTitle(`${APP_NAME} — ${progressData.step}`);
    }
}

/**
 * An upload's one outcome, from the transfer window, or the reason it never
 * started (a window stopped it, or a share couldn't go): the link copied, the
 * main window told, and a notification unless the person is looking at it. A
 * share's ends the share. Once nothing is left going, an app with no window,
 * or with its window in the tray, quits.
 * @param {{ status: 'success', link: string } | { status: 'cancelled' } | { status: 'error', error: string }} result
 * @param {{ id?: string, share?: object }} [upload] - The upload it was, if main made one.
 */
function finishUpload(result, upload) {
    kit.log.info(`Upload finished: ${result.status}`);
    const main = mainWindow();

    // Reset window title and taskbar progress, once nothing else is going.
    if (main && goingTransfers().length > 0) {
        showProgress();
    } else if (main) {
        main.setTitle(APP_NAME);
        if (result.status === 'cancelled') {
            main.setProgressBar(-1);
        } else {
            main.setProgressBar(result.status === 'success' ? 1 : 0,
                { mode: result.status === 'success' ? 'none' : 'error' });
            setTimeout(() => {
                if (mainWindow() && goingTransfers().length === 0) mainWindow().setProgressBar(-1);
            }, 3000);
        }
    }

    // A share's progress notification goes as it ends.
    upload?.share?.notice?.close();

    // A window opened only for a share's question closes once no share is left,
    // so the share is told of as one with no window open.
    const ofShare = Boolean(upload?.share);
    const watching = watched(main) && !(ofShare && main === askWindow);
    const id = upload?.id;
    // Its share is over from here, so it doesn't hold back its own notification.
    if (ofShare) shares.delete(upload.share);

    if (result.status === 'success') {
        copyPrivately(result.link).catch((err) => kit.log.warn(`Couldn't copy the link to the clipboard (${err?.name ?? 'error'}).`));
        if (main) main.webContents.send(IPC.UPLOAD_STATUS, { type: 'success', data: { ...result, id } });
        if (!watching) tellOfEnd({ kind: 'upload', status: 'success' });
    } else if (result.status === 'cancelled') {
        // Whoever cancelled it knows; nothing to notify.
        if (main) main.webContents.send(IPC.UPLOAD_STATUS, { type: 'cancelled', data: { id } });
    } else {
        if (main) main.webContents.send(IPC.UPLOAD_STATUS, { type: 'error', data: { ...result, id } });
        if (!watching) tellOfEnd({ kind: 'upload', status: 'error', error: result.error });
    }

    if (ofShare) endShare(upload.share);
    else settle();
}

/**
 * A download's one outcome, from the transfer window: its card says it, the
 * window title and taskbar follow, and a notification comes unless the person
 * is looking. Nothing is copied: its file is in its folder. Once nothing is
 * left going, an app with its window in the tray quits.
 * @param {{ status: 'success' } | { status: 'cancelled' } | { status: 'error', error: string }} result
 * @param {object | null} card
 */
function finishDownload(result, card) {
    kit.log.info(`Download finished: ${result.status}`);
    const main = mainWindow();
    if (main && goingTransfers().length > 0) {
        showProgress();
    } else if (main) {
        main.setTitle(APP_NAME);
        main.setProgressBar(-1);
    }
    if (card && result.status !== 'cancelled' && !watched(main)) tellOfEnd({ kind: 'download', status: result.status, error: result.error });
    settle();
}

/**
 * A transfer ended while the person wasn't looking: told of in one
 * notification with any others ending within TRANSFERS.NOTICE_GROUP_MS of
 * the first, or at once when nothing else is running or queued to end.
 */
function tellOfEnd(end) {
    ends.push(end);
    endsTimer ??= setTimeout(flushEnds, TRANSFERS.NOTICE_GROUP_MS);
    const { running, queued } = transfers.counts();
    if (running === 0 && queued === 0 && shares.size === 0) flushEnds();
}

/** Show the notification for the transfers that ended, if any. */
function flushEnds() {
    clearTimeout(endsTimer);
    endsTimer = null;
    const notice = endNotice(ends);
    ends = [];
    if (notice) showNotification(notice.title, notice.body);
}

/**
 * A share has ended: the window opened only for its question closes once no
 * share is left, and the app may be done (settle()).
 */
function endShare(share) {
    shares.delete(share);
    if (shares.size === 0 && askWindow && !askWindow.isDestroyed()) {
        const opened = askWindow;
        askWindow = null;
        opened.close();
    }
    settle();
}

/**
 * Once nothing is going: an app with no window (a launch made only for
 * sharing) quits, as one always has, and so does one whose window was closed
 * to the tray, as it would have when it closed.
 */
function settle() {
    if (quitting || going()) return;
    const main = mainWindow();
    if (appWindows.size === 0) {
        kit.log.info('Background task complete, quitting app');
        host?.close();
        app.quit();
    } else if (main && !main.isVisible() && tray.showing) {
        kit.log.info('Every transfer has ended with the window in the tray: Quitting.');
        app.quit();
    }
}

/**
 * A paused upload's server drops it at its deadline, and nothing resumes it by
 * itself, so the transfer window says so 5 minutes before (or as it pauses,
 * when the pause is shorter). The notification gives the time, never a file.
 */
function pauseEnding(id, deadline) {
    const time = new Date(deadline).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const kind = transfers.get(id)?.kind === 'download' ? 'Download' : 'Upload';
    showNotification(`${kind} Still Paused`, `The server drops it at ${time} unless it's resumed.`);
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
