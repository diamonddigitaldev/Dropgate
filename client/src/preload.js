// The client's own bridge, window.electronAPI. The shared one, window.kitAPI
// (the version, the settings, links out, the updater, the theme, a file's
// path), is the kit's, which it registers on the app's session.
//
// The window holds no path but the ones it hands main once (addFiles), and
// asks no server anything itself: main runs checks and uploads in the
// transfer window, which has a bridge of its own (transfer-preload.js).
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
    TRANSFER_ADD_UPLOAD: 'transfer:add-upload',
    TRANSFER_ADD_FILES: 'transfer:add-files',
    TRANSFER_START: 'transfer:start',
    TRANSFER_REMOVE: 'transfer:remove',
    TRANSFER_RETRY: 'transfer:retry',
    TRANSFER_SET_OPTIONS: 'transfer:set-options',
    TRANSFER_DELETE: 'transfer:delete',
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
    TRANSFER_CHANGED: 'transfer:changed',
    TRANSFER_REMOVED: 'transfer:removed',
    UPLOAD_STATUS: 'upload:status',
};

/** Listen for a push from main; the callback gets its value, never the IPC event. */
const on = (channel, callback) => ipcRenderer.on(channel, (_event, value) => callback(value));

contextBridge.exposeInMainWorld('electronAPI', {
    rendererReady: () => ipcRenderer.invoke(CH.WINDOW_READY),
    addFiles: (paths) => ipcRenderer.invoke(CH.FILES_ADD, paths),
    revokeFileAccess: (handle) => ipcRenderer.invoke(CH.FILE_REVOKE, handle),
    checkServer: (url) => ipcRenderer.invoke(CH.SERVER_CHECK, url),
    addUpload: (upload) => ipcRenderer.invoke(CH.TRANSFER_ADD_UPLOAD, upload),
    addToUpload: (id, files) => ipcRenderer.invoke(CH.TRANSFER_ADD_FILES, { id, files }),
    // encrypt is given for the page's own uploads only: a share it was asked about decided its own.
    startTransfers: (ids, encrypt) => ipcRenderer.invoke(CH.TRANSFER_START, encrypt === undefined ? { ids } : { ids, encrypt }),
    removeTransfers: (ids) => ipcRenderer.invoke(CH.TRANSFER_REMOVE, { ids }),
    retryTransfer: (id) => ipcRenderer.invoke(CH.TRANSFER_RETRY, { id }),
    setTransferOptions: (id, options) => ipcRenderer.invoke(CH.TRANSFER_SET_OPTIONS, { id, options }),
    deleteTransfer: (id) => ipcRenderer.invoke(CH.TRANSFER_DELETE, { id }),
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
    onTransferChanged: (callback) => on(CH.TRANSFER_CHANGED, callback),
    onTransfersRemoved: (callback) => on(CH.TRANSFER_REMOVED, callback),
    onUploadStatus: (callback) => on(CH.UPLOAD_STATUS, callback),
});
