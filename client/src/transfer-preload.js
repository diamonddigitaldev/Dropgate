// The transfer window's bridge, window.engine: what main sends it, and what
// it tells main. The transfer window is hidden, sandboxed, and in a session of
// its own (kit.sessions.isolated('transfer')), so it has neither the kit's
// bridge nor the app window's. Its page runs core and makes every request to
// a server; main answers its channels for that session only.
//
// This runs in a sandboxed preload, where require() can only load "electron"
// and a few others, so the channel names are inlined, and
// test/transfer-preload.test.mjs holds them to src/constants.js.
const { contextBridge, ipcRenderer } = require('electron');

const CH = {
    PORT: 'engine:port',
    UPLOAD: 'engine:upload',
    PAUSE: 'engine:pause',
    RESUME: 'engine:resume',
    CANCEL: 'engine:cancel',
    CHECK: 'engine:check',
    READY: 'engine:ready',
    UPDATE: 'engine:update',
    PAUSE_ENDING: 'engine:pause-ending',
    FINISHED: 'engine:finished',
    ANSWER: 'engine:answer',
};

/** Listen for work from main; the callback gets its value, never the IPC event. */
const on = (channel, callback) => ipcRenderer.on(channel, (_event, value) => callback(value));

// The file service's port can't cross contextBridge, so it's handed to the
// page as a window message, which the page takes only from its own window.
ipcRenderer.on(CH.PORT, (event) => window.postMessage(CH.PORT, '*', event.ports));

contextBridge.exposeInMainWorld('engine', {
    ready: () => ipcRenderer.invoke(CH.READY),
    update: (id, snapshot) => ipcRenderer.invoke(CH.UPDATE, id, snapshot),
    pauseEnding: (id, deadline) => ipcRenderer.invoke(CH.PAUSE_ENDING, id, deadline),
    finished: (id, result) => ipcRenderer.invoke(CH.FINISHED, id, result),
    answer: (call, value) => ipcRenderer.invoke(CH.ANSWER, call, value),
    onUpload: (callback) => on(CH.UPLOAD, callback),
    onPause: (callback) => on(CH.PAUSE, callback),
    onResume: (callback) => on(CH.RESUME, callback),
    onCancel: (callback) => on(CH.CANCEL, callback),
    onCheck: (callback) => on(CH.CHECK, callback),
});
