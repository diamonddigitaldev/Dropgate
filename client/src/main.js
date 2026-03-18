const { app, BrowserWindow, ipcMain, Menu, globalShortcut, dialog, clipboard, Notification, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');
const Store = require('electron-store').default;

// Create a log file for debugging
const logFile = path.join(app.getPath('userData'), 'debug.log');
const originalConsoleLog = console.log; // Save the original console.log

function log(...args) {
    const message = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
    try {
        fs.appendFileSync(logFile, message);
    } catch (e) {
        // If we can't write to log, at least show in console
    }
    originalConsoleLog(...args); // Use the original console.log
}

try {
    fs.writeFileSync(logFile, `=== App started at ${new Date().toISOString()} ===\n`);
    log('Log file created at:', logFile);
} catch (e) {
    console.error('Could not create log file:', e);
}

log('process.argv on startup:', JSON.stringify(process.argv));

if (process.platform === 'win32') {
    app.setAppUserModelId('com.diamonddigitaldev.dropgateclient');
}

const store = new Store();

let mainWindow = null;
let uploadQueue = [];
let isUploading = false;
let activeUploadNotification = null;

// Tracks file paths the renderer is allowed to read ranges from (defense-in-depth for context isolation)
const authorizedFilePaths = new Set();

// Batch collection for multi-file context menu selections.
// Windows launches one process per selected file; we debounce them into a single bundle.
let batchFiles = [];
let batchTimer = null;
const BATCH_DEBOUNCE_MS = 500;

function showNotification(title, body) {
    const notification = new Notification({ title, body });
    notification.on('click', () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
            createWindow();
        }
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    });
    notification.show();
    return notification;
}

// Auto-updater configuration
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function initAutoUpdater() {
    // Check for updates after a short delay to let the app initialize
    setTimeout(() => {
        log('Checking for updates...');
        autoUpdater.checkForUpdates().catch(err => {
            log('Update check failed: ' + err.message);
        });
    }, 5000);

    autoUpdater.on('update-available', (info) => {
        const currentVersion = app.getVersion();
        const newVersion = info.version;

        log(`Update available: ${currentVersion} -> ${newVersion}`);

        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update Available',
            message: 'A new version of Dropgate Client is available!',
            detail: `Current version: ${currentVersion}\nNew version: ${newVersion}\n\nWould you like to download and install this update?`,
            buttons: ['Yes, Update Now', 'No, Later', 'View Changelog'],
            defaultId: 0,
            cancelId: 1
        }).then(result => {
            if (result.response === 0) {
                log('User chose to download update');
                autoUpdater.downloadUpdate();
            } else if (result.response === 2) {
                log('User chose to view changelog');
                shell.openExternal(`https://github.com/WillTDA/Dropgate/releases/tag/${newVersion}`);
            } else {
                log('User declined update');
            }
        });
    });

    autoUpdater.on('update-not-available', () => {
        log('No updates available');
    });

    autoUpdater.on('download-progress', (progress) => {
        log(`Download progress: ${Math.round(progress.percent)}%`);
    });

    autoUpdater.on('update-downloaded', (info) => {
        log('Update downloaded: ' + info.version);

        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update Ready',
            message: 'Update downloaded successfully!',
            detail: `Version ${info.version} is ready to install. The application will restart to complete the update.`,
            buttons: ['Install Now', 'Install on Quit'],
            defaultId: 0,
            cancelId: 1
        }).then(result => {
            if (result.response === 0) {
                log('User chose to install update now');
                autoUpdater.quitAndInstall();
            } else {
                log('Update will install on quit');
            }
        });
    });

    autoUpdater.on('error', (err) => {
        log('Auto-updater error: ' + err.message);
    });
}

function checkForUpdatesManually() {
    log('Manual update check triggered');
    autoUpdater.checkForUpdates().then(result => {
        if (!result || !result.updateInfo || result.updateInfo.version === app.getVersion()) {
            dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'No Updates',
                message: 'You\'re up to date!',
                detail: `Dropgate Client ${app.getVersion()} is the latest version.`,
                buttons: ['OK', 'View Changelog']
            }).then(result => {
                if (result.response === 1) {
                    shell.openExternal(`https://github.com/WillTDA/Dropgate/releases/tag/${app.getVersion()}`);
                }
            });
        }
    }).catch(err => {
        log('Manual update check failed: ' + err.message);
        dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: 'Update Check Failed',
            message: 'Could not check for updates.',
            detail: err.message,
            buttons: ['OK']
        });
    });
}

function getIconPath() {
    let iconName;
    switch (process.platform) {
        case 'win32':
            iconName = 'dropgate.ico';
            break;
        case 'darwin': // macOS
            iconName = 'dropgate.icns';
            break;
        case 'linux':
        default:
            iconName = 'dropgate.png';
            break;
    }
    return path.join(__dirname, 'img', iconName);
}

// Determine if the app was launched SOLELY for a background task.
// This is a crucial flag to manage the app's lifecycle.
const wasLaunchedForBackgroundTask = process.argv.some(arg => arg === '--upload');

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    // We're a second instance, the first instance will handle our args
    log('Another instance exists, passing arguments and quitting');
    app.quit();
} else {
    // We're the first instance
    log('Primary instance starting');

    app.on('second-instance', (event, commandLine, workingDirectory) => {
        log('=== Second instance detected ===');
        log('commandLine:', commandLine);

        const isBackgroundUpload = commandLine.some(arg => arg === '--upload');

        if (isBackgroundUpload) {
            log('Background upload via second-instance');
            handleArgs(commandLine);
        } else {
            log('Normal app launch via second-instance');
            if (mainWindow) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.focus();
            } else {
                createWindow();
            }
        }
    });

    // Handle initial launch
    app.whenReady().then(() => {
        log('=== App ready ===');
        log('wasLaunchedForBackgroundTask:', wasLaunchedForBackgroundTask);
        log('process.argv:', JSON.stringify(process.argv));

        // If the app was NOT launched for a background task, create the main window.
        if (!wasLaunchedForBackgroundTask) {
            log('Creating main window (not a background task)');
            createWindow();
            initAutoUpdater();
        } else {
            log('Skipping main window creation (background task detected)');
        }

        // Always handle arguments on startup
        log('Processing startup arguments...');
        handleArgs(process.argv);

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });
}


function createWindow() {
    // Restore saved window bounds or use defaults
    const defaultBounds = {
        width: 600,
        height: 900
    };
    const savedBounds = store.get('windowBounds', defaultBounds);

    mainWindow = new BrowserWindow({
        width: savedBounds.width,
        height: savedBounds.height,
        x: savedBounds.x,
        y: savedBounds.y,
        minWidth: 400,
        minHeight: 700,
        resizable: true,
        title: "Dropgate Client",
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        icon: getIconPath()
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));
    // mainWindow.webContents.openDevTools();

    // Save window bounds when resized or moved
    const saveBounds = () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const bounds = mainWindow.getBounds();
        store.set('windowBounds', bounds);
    };

    // Debounce saving to avoid excessive writes during resizing
    let saveBoundsTimeout;
    const debouncedSaveBounds = () => {
        clearTimeout(saveBoundsTimeout);
        saveBoundsTimeout = setTimeout(saveBounds, 500);
    };

    mainWindow.on('resize', debouncedSaveBounds);
    mainWindow.on('move', debouncedSaveBounds);

    // Save immediately on close
    mainWindow.on('close', saveBounds);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Manage the background upload queue
function processUploadQueue() {
    log('=== processUploadQueue called ===');
    log('isUploading:', isUploading);
    log('Queue length:', uploadQueue.length);

    if (isUploading) {
        log('Already uploading, skipping');
        return;
    }

    if (uploadQueue.length === 0) {
        log('Queue is empty');
        return;
    }

    isUploading = true;
    const { filePaths } = uploadQueue.shift();
    log('Processing upload from queue:', filePaths.length, 'file(s)');
    triggerBackgroundUpload(filePaths);
}

function handleArgs(argv) {
    log('=== handleArgs called ===');
    log('argv:', JSON.stringify(argv));
    log('app.isPackaged:', app.isPackaged);

    // For packaged apps, we need to skip:
    // - argv[0]: the executable path
    // - Any paths that are the app executable itself
    const executablePath = process.execPath.toLowerCase();
    log('Executable path:', executablePath);

    const filePath = argv.find((arg, index) => {
        // Skip first argument (always the executable)
        if (index === 0) {
            log('Skipping index 0:', arg);
            return false;
        }

        // Skip if it's the executable itself
        if (arg.toLowerCase() === executablePath) {
            log('Skipping executable path:', arg);
            return false;
        }

        // Skip our custom flags
        if (arg === '--upload') {
            log('Skipping flag:', arg);
            return false;
        }

        // Check if it's a valid file
        try {
            const exists = fs.existsSync(arg);
            const isFile = exists && fs.lstatSync(arg).isFile();
            log(`Checking arg [${index}]: "${arg}" - exists: ${exists}, isFile: ${isFile}`);
            return isFile;
        } catch (e) {
            log(`Error checking arg [${index}]: "${arg}" - ${e.message}`);
            return false;
        }
    });

    log('Found file path:', filePath);

    if (!filePath) {
        log('No valid file path found in arguments');
        return;
    }

    const isUploadAction = argv.includes('--upload');

    log('Is upload action:', isUploadAction);

    if (isUploadAction) {
        // Check if this file is already pending or queued to prevent duplicates
        const alreadyBatched = batchFiles.includes(filePath);
        const alreadyQueued = uploadQueue.some(item => item.filePaths.includes(filePath));
        if (alreadyBatched || alreadyQueued) {
            log('File already batched/queued, skipping duplicate');
            return;
        }

        // Collect files and debounce — Windows launches one process per selected
        // file, so multi-select arrivals are spaced milliseconds apart.
        batchFiles.push(filePath);
        log('Added to batch. Batch size:', batchFiles.length);

        if (batchTimer) clearTimeout(batchTimer);
        batchTimer = setTimeout(() => {
            if (batchFiles.length > 0) {
                const filePaths = [...batchFiles];
                batchFiles = [];
                batchTimer = null;
                log('Batch timer fired, queuing', filePaths.length, 'file(s)');
                uploadQueue.push({ filePaths });
                processUploadQueue();
            }
        }, BATCH_DEBOUNCE_MS);
    } else {
        log('Not an upload action, ignoring');
    }
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

ipcMain.on('upload-progress', (event, progressData) => {
    // Send to main window if it exists
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-ui', { type: 'progress', data: progressData });

        // Update window title and taskbar progress
        if (progressData.percent !== undefined) {
            mainWindow.setTitle(`Dropgate Client \u2014 Uploading ${progressData.percent.toFixed(0)}%`);
            mainWindow.setProgressBar(progressData.percent / 100);
        } else if (progressData.text) {
            mainWindow.setTitle(`Dropgate Client \u2014 ${progressData.text}`);
        }
    }

    // ALSO send to the window that's uploading (might be a background window)
    const uploaderWindow = BrowserWindow.fromWebContents(event.sender);
    if (uploaderWindow && uploaderWindow !== mainWindow && !uploaderWindow.isDestroyed()) {
        uploaderWindow.webContents.send('update-ui', { type: 'progress', data: progressData });
    }
});

ipcMain.on('upload-finished', (event, result) => {
    log('Upload finished:', result.status);

    // Reset window title and taskbar progress
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setTitle('Dropgate Client');
        mainWindow.setProgressBar(result.status === 'success' ? 1 : 0,
            { mode: result.status === 'success' ? 'none' : 'error' });
        setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(-1);
        }, 3000);
    }

    // Close the active upload notification
    if (activeUploadNotification) {
        activeUploadNotification.close();
        activeUploadNotification = null;
    }

    const uploaderWindow = BrowserWindow.fromWebContents(event.sender);
    const isFocused = mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused();

    if (result.status === 'success') {
        clipboard.writeText(result.link);

        // Send to main window if it exists
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-ui', { type: 'success', data: result });
        }

        // Show notification if main window doesn't exist or isn't focused
        if (!mainWindow || !isFocused) {
            showNotification('Upload Successful', 'Link copied to clipboard.');
        }
    } else {
        // Send to main window if it exists
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-ui', { type: 'error', data: result });
        }

        // Show notification if main window doesn't exist or isn't focused
        if (!mainWindow || !isFocused) {
            showNotification('Upload Failed', result.error || 'An unknown error occurred.');
        }
    }

    // Only destroy background windows, not the main window
    if (uploaderWindow && uploaderWindow !== mainWindow) {
        log('Destroying background window');
        uploaderWindow.destroy();
    }

    isUploading = false;

    // If there are more items, process them.
    if (uploadQueue.length > 0) {
        processUploadQueue();
    } else if (wasLaunchedForBackgroundTask && !mainWindow) {
        log('Background task complete, quitting app');
        app.quit();
    }
});

ipcMain.on('cancel-upload', (event) => {
    log('Cancel upload requested');

    // Reset window title and taskbar progress
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setTitle('Dropgate Client');
        mainWindow.setProgressBar(-1);
    }

    // Close the active upload notification
    if (activeUploadNotification) {
        activeUploadNotification.close();
        activeUploadNotification = null;
    }

    // Broadcast cancellation to all windows — the upload may be running in a
    // background window while the user clicks cancel in the main window.
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
            win.webContents.send('cancel-upload-trigger');
        }
    }
});

ipcMain.handle('get-settings', () => {
    return {
        serverURL: store.get('serverURL', ''),
        lifetimeValue: store.get('lifetimeValue', '24'),
        lifetimeUnit: store.get('lifetimeUnit', 'hours'),
    };
});

ipcMain.handle('set-settings', (event, settings) => {
    try {
        for (const [key, value] of Object.entries(settings)) {
            if (value !== undefined) {
                store.set(key, value);
            }
        }
    } catch (error) {
        console.error('Failed to save settings:', error);
    }
});

ipcMain.handle('get-client-version', () => {
    return app.getVersion();
});

ipcMain.on('open-external', (event, url) => {
    const allowed = [
        'https://github.com/',
        'https://youtube.com/',
        'https://buymeacoff.ee/'
    ];

    if (allowed.some(prefix => url.startsWith(prefix))) {
        shell.openExternal(url);
    }
});

// Lazy file reading: renderer requests byte ranges instead of loading entire files into memory
ipcMain.handle('read-file-range', async (event, filePath, start, end) => {
    if (!authorizedFilePaths.has(filePath)) {
        throw new Error('File access not authorized.');
    }

    const fd = fs.openSync(filePath, 'r');
    try {
        const length = end - start;
        const buffer = Buffer.alloc(length);
        const { bytesRead } = fs.readSync(fd, buffer, 0, length, start);
        // Return only the bytes actually read (handles EOF)
        return bytesRead < length ? buffer.subarray(0, bytesRead) : buffer;
    } finally {
        fs.closeSync(fd);
    }
});

ipcMain.on('revoke-file-access', (event, filePath) => {
    authorizedFilePaths.delete(filePath);
});

ipcMain.on('show-window', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow && !senderWindow.isDestroyed()) {
        senderWindow.show();
        senderWindow.focus();
    }
});

const menuTemplate = [
    {
        label: 'Menu',
        submenu: [
            {
                label: 'Open File',
                accelerator: 'CmdOrCtrl+O',
                click: handleOpenDialog
            },
            { type: 'separator' },
            {
                label: 'Check for Updates',
                click: checkForUpdatesManually
            },
            { type: 'separator' },
            {
                label: 'Exit',
                accelerator: 'Alt+F4',
                role: 'quit'
            }
        ]
    },
    {
        label: 'Credits',
        accelerator: 'CmdOrCtrl+Shift+C',
        click: () => {
            createCreditsWindow();
        }
    }
];

const menu = Menu.buildFromTemplate(menuTemplate);
Menu.setApplicationMenu(menu);

function createCreditsWindow() {
    const creditsWindow = new BrowserWindow({
        width: 875,
        height: 550,
        parent: mainWindow,
        modal: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        icon: getIconPath()
    });

    // Ensure it cannot be minimized (also disable minimize/maximize buttons)
    creditsWindow.on('minimize', (e) => {
        e.preventDefault();
        creditsWindow.show();
        creditsWindow.focus();
    });

    creditsWindow.setMenu(null);
    creditsWindow.loadFile(path.join(__dirname, 'credits.html'));
}

async function handleOpenDialog() {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (!focusedWindow) return;

    const { canceled, filePaths } = await dialog.showOpenDialog(focusedWindow, {
        properties: ['openFile'],
        title: 'Select a file',
        buttonLabel: 'Select'
    });

    if (canceled || filePaths.length === 0) {
        return;
    }

    const filePath = filePaths[0];
    try {
        const stats = fs.statSync(filePath);
        authorizedFilePaths.add(filePath);
        focusedWindow.webContents.send('file-opened', {
            name: path.basename(filePath),
            size: stats.size,
            filePath: filePath
        });
    } catch (error) {
        console.error('Failed to read the selected file:', error);
        focusedWindow.webContents.send('file-open-error', 'Could not read the selected file.');
    }
}

// BACKGROUND UPLOAD
// Store pending uploads with their windows
const pendingBackgroundUploads = new Map();

// Set up the renderer-ready listener ONCE at the top level
ipcMain.on('renderer-ready', (event) => {
    log('Renderer ready signal received');

    // Find which window sent this event
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
        console.error('Could not find sender window');
        return;
    }

    const windowId = senderWindow.id;
    log('Renderer ready from window ID:', windowId);

    // Check if we have a pending upload for this window
    if (pendingBackgroundUploads.has(windowId)) {
        const { filePaths } = pendingBackgroundUploads.get(windowId);
        log('Found pending upload for this window:', filePaths.length, 'file(s)');

        try {
            const files = filePaths.map(fp => {
                const stats = fs.statSync(fp);
                authorizedFilePaths.add(fp);
                return { name: path.basename(fp), size: stats.size, filePath: fp };
            });

            log('Sending background-upload-start with', files.length, 'file(s)');

            const notifBody = files.length === 1
                ? `Uploading ${files[0].name}...`
                : `Uploading ${files.length} files...`;
            activeUploadNotification = showNotification('Upload Started', notifBody);

            senderWindow.webContents.send('background-upload-start', { files });

            // Clear this pending upload
            pendingBackgroundUploads.delete(windowId);
        } catch (error) {
            console.error('Failed to read file for background upload:', error);
            showNotification('Upload Failed', 'Could not read the selected file.');

            if (senderWindow && !senderWindow.isDestroyed()) {
                senderWindow.destroy();
            }

            pendingBackgroundUploads.delete(windowId);
            isUploading = false;
            processUploadQueue();
        }
    } else {
        log('No pending upload for this window (normal GUI window)');
    }
});

function triggerBackgroundUpload(filePaths) {
    log('=== triggerBackgroundUpload called ===');
    log('Files:', filePaths.length);

    // Filter out any files that no longer exist
    const validPaths = filePaths.filter(fp => {
        const exists = fs.existsSync(fp);
        if (!exists) log('File no longer exists, skipping:', fp);
        return exists;
    });

    if (validPaths.length === 0) {
        showNotification('Upload Failed', 'File(s) not found.');
        isUploading = false;
        processUploadQueue();
        return;
    }

    const backgroundWindow = new BrowserWindow({
        show: false,  // use true for debugging!
        width: 600,
        height: 800,
        minWidth: 400,
        minHeight: 700,
        resizable: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        icon: getIconPath()
    });

    const windowId = backgroundWindow.id;
    log('Created background window with ID:', windowId);

    // Store the pending upload BEFORE loading the file
    pendingBackgroundUploads.set(windowId, { filePaths: validPaths });

    // Clean up if window is closed before upload starts
    backgroundWindow.on('closed', () => {
        log('Background window closed, cleaning up');
        if (pendingBackgroundUploads.has(windowId)) {
            pendingBackgroundUploads.delete(windowId);
            isUploading = false;
            processUploadQueue();
        }
    });

    // backgroundWindow.webContents.openDevTools();

    const notifBody = validPaths.length === 1
        ? `Preparing ${path.basename(validPaths[0])}...`
        : `Preparing ${validPaths.length} files...`;
    activeUploadNotification = showNotification('Initialising Upload', notifBody);

    log('Loading index.html into background window');
    backgroundWindow.loadFile(path.join(__dirname, 'index.html'));
}