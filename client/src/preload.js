// The client's own bridge, window.electronAPI. The shared one, window.kitAPI
// (the version, the settings, links out, the updater, the theme), is the
// kit's, which it registers on the app's session.
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
    FILE_READ_RANGE: 'file:read-range',
    FILE_REVOKE: 'file:revoke',
    UPLOAD_PROGRESS: 'upload:progress',
    UPLOAD_FINISHED: 'upload:finished',
    UPLOAD_CANCEL: 'upload:cancel',
    UPLOAD_BUSY: 'upload:busy',
    LINK_COPY: 'link:copy',
    FILE_OPENED: 'file:opened',
    FILE_OPEN_ERROR: 'file:open-error',
    UPLOAD_BACKGROUND_START: 'upload:background-start',
    UPLOAD_STATUS: 'upload:status',
    UPLOAD_CANCEL_REQUESTED: 'upload:cancel-requested',
};

/** Listen for a push from main; the callback gets its value, never the IPC event. */
const on = (channel, callback) => ipcRenderer.on(channel, (_event, value) => callback(value));

contextBridge.exposeInMainWorld('electronAPI', {
    rendererReady: () => ipcRenderer.invoke(CH.WINDOW_READY),
    showWindow: () => ipcRenderer.invoke(CH.WINDOW_SHOW),
    addFiles: (paths) => ipcRenderer.invoke(CH.FILES_ADD, paths),
    readFileRange: (filePath, start, end) => ipcRenderer.invoke(CH.FILE_READ_RANGE, filePath, start, end),
    revokeFileAccess: (filePath) => ipcRenderer.invoke(CH.FILE_REVOKE, filePath),
    uploadProgress: (progress) => ipcRenderer.invoke(CH.UPLOAD_PROGRESS, progress),
    uploadFinished: (result) => ipcRenderer.invoke(CH.UPLOAD_FINISHED, result),
    cancelUpload: () => ipcRenderer.invoke(CH.UPLOAD_CANCEL),
    isUploading: () => ipcRenderer.invoke(CH.UPLOAD_BUSY),
    copyLink: (link) => ipcRenderer.invoke(CH.LINK_COPY, link),
    onFileOpened: (callback) => on(CH.FILE_OPENED, callback),
    onFileOpenError: (callback) => on(CH.FILE_OPEN_ERROR, callback),
    onBackgroundUploadStart: (callback) => on(CH.UPLOAD_BACKGROUND_START, callback),
    onUploadStatus: (callback) => on(CH.UPLOAD_STATUS, callback),
    onCancelUpload: (callback) => on(CH.UPLOAD_CANCEL_REQUESTED, callback),
});
