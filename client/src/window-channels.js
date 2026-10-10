'use strict';

const { randomUUID } = require('crypto');
const fs = require('fs');
const { IPC } = require('./constants');
const { failureOf, handleOf, linkOf, newUpload, pathList, serverAddress, uploadOf, uploadsToStart } = require('./core/payloads');

// The window's channels: what its page asks main, through window.electronAPI.
// Each is answered through kit.ipc.handle(), for the app's own page in the UI
// session only, so the transfer window's page is refused every one of them.
// Each payload is checked first (core/payloads.js): a value of the wrong kind,
// an unsafe number, or a handle or an upload main never made, or never made
// for this window, is refused before anything is done. The page holds no
// path but the ones it hands main once, on files:add: a file is a handle from
// then on.
//
// Kept apart from main.js, with what they act on passed in, so the client's
// tests can load them without Electron.

/** The server an upload or a check goes to: plain HTTP only for an address typed with http://. */
const serverOf = (url) => ({ url, allowInsecure: /^http:\/\//i.test(url) });

/**
 * Answer the window's channels.
 * @param {object} main - What they act on, from main.js.
 * @param {any} main.kit - The kit, from start(): its ipc and settings.
 * @param {import('./core/handles').Handles} main.handles - The files handed to each window.
 * @param {Map<string, { owner: number | null, ask?: { owner: number }, server?: { url: string, allowInsecure: boolean }, started: boolean }>} main.uploads
 *   Main's uploads, by the ID it made: a window's own (owner), or a share's (no owner), which may be waiting on a window's answer (ask).
 * @param {() => any} main.host - The transfer host (transfer-host.js), once the app is ready.
 * @param {(contents: Electron.WebContents) => void} main.windowReady - A window's page has set itself up.
 * @param {(id: string, server: { url: string, allowInsecure: boolean }) => void} main.start - Start an upload, in the transfer window.
 * @param {(id: string) => void} main.cancel - Cancel an upload, or decline a share's question.
 * @param {() => boolean} main.busy - Whether any upload runs, is paused, or is waiting to.
 * @param {(result: { status: 'error', error: string }) => void} main.failed - An upload the page made never started.
 * @param {(link: string) => Promise<void>} main.copyLink - Copy a link, kept out of the clipboard's history.
 */
function answerWindowChannels(main) {
    const { kit, handles, uploads } = main;
    const has = (id) => uploads.has(id);

    // A window's page has set itself up: a share's question waiting for it is sent now.
    kit.ipc.handle(IPC.WINDOW_READY, (event) => main.windowReady(event.sender));

    // Files dropped on Upload, picked with its file input, or opened with the app:
    // the page has their paths from the kit (kitAPI.getPathForFile, from the File
    // the person dropped or picked), and gets a handle for each. This is the one
    // channel that takes a path. Folders aren't uploaded, and are counted so the
    // page can say so.
    kit.ipc.handle(IPC.FILES_ADD, (event, paths) => {
        const files = [];
        let folders = 0;
        for (const filePath of pathList(paths)) {
            try {
                if (fs.statSync(filePath).isDirectory()) folders++;
                else files.push(handles.add(event.sender.id, filePath));
            } catch {
                // Gone since it was dropped: nothing to add.
            }
        }
        return { files, folders };
    });

    // The window is done with a file: removed from its list, or uploaded.
    kit.ipc.handle(IPC.FILE_REVOKE, (event, handle) => {
        if (!handles.get(event.sender.id, handleOf(handle))) throw new Error('Expected a file handed to this window.');
        handles.revoke(event.sender.id, handle);
    });

    // Test, and the check before an upload: asked of the server by the transfer window.
    kit.ipc.handle(IPC.SERVER_CHECK, (_event, url) => main.host().check(serverOf(serverAddress(url))));

    // An upload of files handed to this window, waiting to start.
    kit.ipc.handle(IPC.TRANSFER_ADD_UPLOAD, (event, request) => {
        const { files, options } = newUpload(request);
        const held = files.map((handle) => handles.get(event.sender.id, handle));
        if (held.some((file) => !file)) throw new Error('Expected files handed to this window.');
        const id = randomUUID();
        uploads.set(id, {
            owner: event.sender.id,
            files: held.map(({ path: filePath, name, size, mtimeMs }) => ({ path: filePath, name, size, mtimeMs })),
            options,
            started: false,
        });
        return { id };
    });

    // Start uploads waiting: this window's own, to the server in Settings, or a
    // share it was asked about (Upload Anyway), to the share's server.
    kit.ipc.handle(IPC.TRANSFER_START, (event, request) => {
        const sender = event.sender.id;
        const startable = (id) => {
            const upload = uploads.get(id);
            return Boolean(upload) && !upload.started && (upload.owner === sender || upload.ask?.owner === sender);
        };
        const ids = uploadsToStart(request, startable);
        const { serverURL } = kit.settings.get();
        if (!serverURL && ids.some((id) => !uploads.get(id).server)) throw new Error('Server URL is not configured.');
        for (const id of ids) main.start(id, uploads.get(id).server ?? serverOf(serverURL));
    });

    // Pause Upload and Resume Upload, from any window. The answer is core's reason
    // when it couldn't, which the window shows.
    kit.ipc.handle(IPC.TRANSFER_PAUSE, (_event, request) => main.host().pause(uploadOf(request, has)));
    kit.ipc.handle(IPC.TRANSFER_RESUME, (_event, request) => main.host().resume(uploadOf(request, has)));

    // Cancel, from any window: an upload may run for Share with Dropgate while the
    // person clicks Cancel in the main window. A share waiting on its question is
    // declined.
    kit.ipc.handle(IPC.TRANSFER_CANCEL, (_event, request) => main.cancel(uploadOf(request, has)));

    // Restart Now asks first while any upload runs, is paused, or is waiting to.
    kit.ipc.handle(IPC.TRANSFER_BUSY, () => main.busy());

    // The window stopped an upload before it started: no server, or the security warning declined.
    kit.ipc.handle(IPC.UPLOAD_FINISHED, (_event, result) => main.failed(failureOf(result)));

    // The page's Copy button: the same copy as an upload's.
    kit.ipc.handle(IPC.LINK_COPY, (_event, link) => main.copyLink(linkOf(link)));
}

module.exports = { answerWindowChannels, serverOf };
