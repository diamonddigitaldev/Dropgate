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
    WINDOW_SHOW: 'window:show',
    FILES_ADD: 'files:add',
    FILE_REVOKE: 'file:revoke',
    SERVER_CHECK: 'server:check',
    TRANSFER_ADD_UPLOAD: 'transfer:add-upload',
    TRANSFER_START: 'transfer:start',
    TRANSFER_PAUSE: 'transfer:pause',
    TRANSFER_RESUME: 'transfer:resume',
    TRANSFER_CANCEL: 'transfer:cancel',
    UPLOAD_FINISHED: 'upload:finished',
    UPLOAD_BUSY: 'upload:busy',
    LINK_COPY: 'link:copy',
    FILE_OPENED: 'file:opened',
    FILE_OPEN_ERROR: 'file:open-error',
    UPLOAD_BACKGROUND_START: 'upload:background-start',
    UPLOAD_STATUS: 'upload:status',
};

/** Listen for a push from main; the callback gets its value, never the IPC event. */
const on = (channel, callback) => ipcRenderer.on(channel, (_event, value) => callback(value));

contextBridge.exposeInMainWorld('electronAPI', {
    rendererReady: () => ipcRenderer.invoke(CH.WINDOW_READY),
    showWindow: () => ipcRenderer.invoke(CH.WINDOW_SHOW),
    addFiles: (paths) => ipcRenderer.invoke(CH.FILES_ADD, paths),
    revokeFileAccess: (handle) => ipcRenderer.invoke(CH.FILE_REVOKE, handle),
    checkServer: (url) => ipcRenderer.invoke(CH.SERVER_CHECK, url),
    addUpload: (upload) => ipcRenderer.invoke(CH.TRANSFER_ADD_UPLOAD, upload),
    startTransfers: (ids) => ipcRenderer.invoke(CH.TRANSFER_START, { ids }),
    pauseTransfer: (id) => ipcRenderer.invoke(CH.TRANSFER_PAUSE, { id }),
    resumeTransfer: (id) => ipcRenderer.invoke(CH.TRANSFER_RESUME, { id }),
    cancelTransfer: (id) => ipcRenderer.invoke(CH.TRANSFER_CANCEL, { id }),
    uploadFinished: (result) => ipcRenderer.invoke(CH.UPLOAD_FINISHED, result),
    isUploading: () => ipcRenderer.invoke(CH.UPLOAD_BUSY),
    copyLink: (link) => ipcRenderer.invoke(CH.LINK_COPY, link),
    onFileOpened: (callback) => on(CH.FILE_OPENED, callback),
    onFileOpenError: (callback) => on(CH.FILE_OPEN_ERROR, callback),
    onBackgroundUploadStart: (callback) => on(CH.UPLOAD_BACKGROUND_START, callback),
    onUploadStatus: (callback) => on(CH.UPLOAD_STATUS, callback),
});
