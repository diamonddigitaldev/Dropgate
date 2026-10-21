// The client's own bridge, window.electronAPI. The shared one, window.kitAPI
// (the version, the settings, links out, the updater, the theme, a file's
// path), is the kit's, which it registers on the app's session.
//
// The window holds no path but the ones it hands main once (addFiles), and
// where new downloads are saved, to show it (Settings > Transfers); it asks
// no server anything itself: main runs checks and uploads in the
// transfer window, which has a bridge of its own (transfer-preload.js). It
// changes no saved server itself either: main does, as it asks.
//
// This runs in a sandboxed preload, where require() can only load "electron"
// and a few others. Requiring ./constants here would leave the bridge
// undefined, with no error in main, so the channel names are inlined, and
// test/preload.test.mjs holds them to src/constants.js.
const { contextBridge, ipcRenderer } = require('electron');

const CH = {
    WINDOW_READY: 'window:ready',
    FILES_ADD: 'files:add',
    FILE_REVOKE: 'file:revoke',
    SERVER_CHECK: 'server:check',
    SERVER_ADD: 'server:add',
    SERVER_TEST: 'server:test',
    SERVER_REMOVE: 'server:remove',
    SERVER_MOVE: 'server:move',
    SERVER_SET_DEFAULT: 'server:set-default',
    SERVER_SET_OPTIONS: 'server:set-options',
    TRANSFER_ADD_UPLOAD: 'transfer:add-upload',
    TRANSFER_ADD_FILES: 'transfer:add-files',
    TRANSFER_START: 'transfer:start',
    TRANSFER_REMOVE: 'transfer:remove',
    TRANSFER_RETRY: 'transfer:retry',
    TRANSFER_SET_OPTIONS: 'transfer:set-options',
    TRANSFER_DELETE: 'transfer:delete',
    TRANSFER_ADD_DOWNLOAD: 'transfer:add-download',
    TRANSFER_SAVE_TO: 'transfer:save-to',
    TRANSFER_SHOW: 'transfer:show',
    FOLDER_CHOOSE: 'folder:choose',
    FOLDER_DEFAULT: 'folder:default',
    FOLDER_SET_DEFAULT: 'folder:set-default',
    TRANSFER_PAUSE: 'transfer:pause',
    TRANSFER_RESUME: 'transfer:resume',
    TRANSFER_CANCEL: 'transfer:cancel',
    TRANSFER_BUSY: 'transfer:busy',
    TRANSFERS_LIST: 'transfers:list',
    UPLOAD_FINISHED: 'upload:finished',
    LINK_COPY: 'link:copy',
    FILE_OPENED: 'file:opened',
    FILE_OPEN_ERROR: 'file:open-error',
    TRANSFER_ASK_INSECURE: 'transfer:ask-insecure',
    TRANSFER_ASK_FALLBACK: 'transfer:ask-fallback',
    TRANSFER_CHANGED: 'transfer:changed',
    TRANSFER_REMOVED: 'transfer:removed',
    UPLOAD_STATUS: 'upload:status',
    SERVERS_CHANGED: 'servers:changed',
};

/** Listen for a push from main; the callback gets its value, never the IPC event. */
const on = (channel, callback) => ipcRenderer.on(channel, (_event, value) => callback(value));

contextBridge.exposeInMainWorld('electronAPI', {
    rendererReady: () => ipcRenderer.invoke(CH.WINDOW_READY),
    addFiles: (paths) => ipcRenderer.invoke(CH.FILES_ADD, paths),
    revokeFileAccess: (handle) => ipcRenderer.invoke(CH.FILE_REVOKE, handle),
    checkServer: (url) => ipcRenderer.invoke(CH.SERVER_CHECK, url),
    // The saved servers are main's: each change is asked of it, and answered with the list as it is now, and what each one's last check found.
    addServer: (url) => ipcRenderer.invoke(CH.SERVER_ADD, { url }),
    testServer: (id) => ipcRenderer.invoke(CH.SERVER_TEST, { id }),
    removeServer: (id) => ipcRenderer.invoke(CH.SERVER_REMOVE, { id }),
    moveServer: (id, by) => ipcRenderer.invoke(CH.SERVER_MOVE, { id, by }),
    setDefaultServer: (id) => ipcRenderer.invoke(CH.SERVER_SET_DEFAULT, { id }),
    setServerOptions: (id, options) => ipcRenderer.invoke(CH.SERVER_SET_OPTIONS, { id, options }),
    addUpload: (upload) => ipcRenderer.invoke(CH.TRANSFER_ADD_UPLOAD, upload),
    addToUpload: (id, files) => ipcRenderer.invoke(CH.TRANSFER_ADD_FILES, { id, files }),
    // encrypt is given for the page's own uploads only: a share it was asked about decided its own.
    startTransfers: (ids, encrypt) => ipcRenderer.invoke(CH.TRANSFER_START, encrypt === undefined ? { ids } : { ids, encrypt }),
    removeTransfers: (ids) => ipcRenderer.invoke(CH.TRANSFER_REMOVE, { ids }),
    retryTransfer: (id) => ipcRenderer.invoke(CH.TRANSFER_RETRY, { id }),
    setTransferOptions: (id, options) => ipcRenderer.invoke(CH.TRANSFER_SET_OPTIONS, { id, options }),
    deleteTransfer: (id) => ipcRenderer.invoke(CH.TRANSFER_DELETE, { id }),
    // A link pasted into Download: main passes it on to be read, and keeps none of it.
    addDownload: (link) => ipcRenderer.invoke(CH.TRANSFER_ADD_DOWNLOAD, { link }),
    saveDownloadsTo: (ids, folder) => ipcRenderer.invoke(CH.TRANSFER_SAVE_TO, { ids, folder }),
    showInFolder: (id) => ipcRenderer.invoke(CH.TRANSFER_SHOW, { id }),
    // A folder is an ID main made and its own name, never its path.
    chooseFolder: () => ipcRenderer.invoke(CH.FOLDER_CHOOSE),
    getDownloadFolder: () => ipcRenderer.invoke(CH.FOLDER_DEFAULT),
    setDownloadFolder: (folder) => ipcRenderer.invoke(CH.FOLDER_SET_DEFAULT, { folder }),
    pauseTransfer: (id) => ipcRenderer.invoke(CH.TRANSFER_PAUSE, { id }),
    resumeTransfer: (id) => ipcRenderer.invoke(CH.TRANSFER_RESUME, { id }),
    cancelTransfer: (id) => ipcRenderer.invoke(CH.TRANSFER_CANCEL, { id }),
    uploadFinished: (result) => ipcRenderer.invoke(CH.UPLOAD_FINISHED, result),
    isBusy: () => ipcRenderer.invoke(CH.TRANSFER_BUSY),
    listTransfers: () => ipcRenderer.invoke(CH.TRANSFERS_LIST),
    copyLink: (link) => ipcRenderer.invoke(CH.LINK_COPY, link),
    onFileOpened: (callback) => on(CH.FILE_OPENED, callback),
    onFileOpenError: (callback) => on(CH.FILE_OPEN_ERROR, callback),
    onAskInsecure: (callback) => on(CH.TRANSFER_ASK_INSECURE, callback),
    onAskFallback: (callback) => on(CH.TRANSFER_ASK_FALLBACK, callback),
    onTransferChanged: (callback) => on(CH.TRANSFER_CHANGED, callback),
    onTransfersRemoved: (callback) => on(CH.TRANSFER_REMOVED, callback),
    onUploadStatus: (callback) => on(CH.UPLOAD_STATUS, callback),
    // A saved server checked by main itself (a fallback trying it): the list, and what each one's last check found.
    onServersChanged: (callback) => on(CH.SERVERS_CHANGED, callback),
});
