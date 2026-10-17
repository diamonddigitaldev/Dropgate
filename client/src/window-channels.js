'use strict';

const fs = require('fs');
const { IPC } = require('./constants');
const { failureOf, filesToAdd, handleOf, linkOf, newUpload, optionsOf, pathList, serverAddress, transfersOf, uploadOf, uploadsToStart } = require('./core/payloads');
const { view } = require('./core/transfers');

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
 * @param {import('./core/transfers').Transfers} main.transfers
 *   Main's registry of transfers, by the ID it made: a window's own (owner), or a share's (no owner), which may be waiting on a window's answer (ask).
 * @param {() => any} main.host - The transfer host (transfer-host.js), once the app is ready.
 * @param {(contents: Electron.WebContents) => void} main.windowReady - A window's page has set itself up.
 * @param {(id: string, server: { url: string, allowInsecure: boolean }) => void} main.start - Start an upload: it's queued, and runs as soon as it has a place.
 * @param {(id: string) => Promise<{ message?: string }>} main.pause - Pause an upload, in the transfer window.
 * @param {(id: string) => Promise<{ message?: string }>} main.resume - Resume one, now or once it has a place.
 * @param {(id: string) => void} main.cancel - Cancel an upload, or decline a share's question.
 * @param {(id: string) => Promise<{ message?: string }>} main.delete - Delete a finished upload from its server, in the transfer window.
 * @param {() => boolean} main.busy - Whether any transfer runs, is paused or is queued (or a share is under way).
 * @param {(result: { status: 'error', error: string }) => void} main.failed - An upload the page made never started.
 * @param {(link: string) => Promise<void>} main.copyLink - Copy a link, kept out of the clipboard's history.
 */
function answerWindowChannels(main) {
    const { kit, handles, transfers } = main;
    const has = (id) => transfers.has(id);

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

    /** The files handed to this window, as the registry keeps them: each one's path, name, size and modification time. */
    const heldFiles = (sender, list) => {
        const held = list.map((handle) => handles.get(sender, handle));
        if (held.some((file) => !file)) throw new Error('Expected files handed to this window.');
        return held.map(({ path: filePath, name, size, mtimeMs }) => ({ path: filePath, name, size, mtimeMs }));
    };

    // An upload of files handed to this window, waiting to start, with the
    // server's settings for new uploads (Settings > Server): its lifetime and
    // download limit. Whether it's encrypted is decided as it starts.
    kit.ipc.handle(IPC.TRANSFER_ADD_UPLOAD, (event, request) => {
        const { files } = newUpload(request);
        const { lifetimeValue, lifetimeUnit, maxDownloads } = kit.settings.get();
        const { id } = transfers.add({
            owner: event.sender.id,
            files: heldFiles(event.sender.id, files),
            options: { lifetime: { value: lifetimeUnit === 'unlimited' ? 0 : lifetimeValue, unit: lifetimeUnit }, maxDownloads },
        });
        return { id };
    });

    // Files dropped onto an upload of this window's that's waiting: each not
    // in it already joins it. One that has started takes none (its files are
    // sealed): the answer says so, and the window makes a new upload of them.
    kit.ipc.handle(IPC.TRANSFER_ADD_FILES, (event, request) => {
        const { id, files } = filesToAdd(request, (upload) => transfers.get(upload)?.owner === event.sender.id);
        return transfers.addFiles(id, heldFiles(event.sender.id, files)) ?? { started: true };
    });

    // Start uploads waiting: this window's own, to the server in Settings,
    // end-to-end encrypted or not as the window found the server (encrypt), or
    // a share it was asked about (Upload Anyway), to the share's server, as
    // the share decided. Each is queued, and runs as soon as it has a place.
    kit.ipc.handle(IPC.TRANSFER_START, (event, request) => {
        const sender = event.sender.id;
        const startable = (id) => {
            const upload = transfers.get(id);
            return Boolean(upload) && upload.state === 'waiting' && (upload.owner === sender || upload.ask?.owner === sender);
        };
        const { ids, encrypt } = uploadsToStart(request, startable);
        const own = ids.filter((id) => transfers.get(id).owner === sender);
        if (own.length > 0 && encrypt === undefined) throw new Error('Expected whether to encrypt.');
        const { serverURL } = kit.settings.get();
        if (!serverURL && ids.some((id) => !transfers.get(id).server)) throw new Error('Server URL is not configured.');
        for (const id of own) transfers.get(id).options.encrypt = encrypt;
        for (const id of ids) main.start(id, transfers.get(id).server ?? serverOf(serverURL));
    });

    // Advanced Options (and Bulk Edit, one call each) on an upload of this
    // window's waiting: its lifetime, download limit and the files it keeps.
    // A share's, or one being asked about, is the share's own.
    kit.ipc.handle(IPC.TRANSFER_SET_OPTIONS, (event, request) => {
        const own = (id) => {
            const upload = transfers.get(id);
            return Boolean(upload) && upload.state === 'waiting' && upload.owner === event.sender.id && !upload.ask;
        };
        const { id, options } = optionsOf(request, own, (upload) => transfers.get(upload).files.length);
        if (!transfers.setOptions(id, options)) throw new Error('Expected an upload of this window\'s waiting to start.');
    });

    // Remove uploads waiting or ended (Remove, Clear Finished): one going is cancelled first.
    kit.ipc.handle(IPC.TRANSFER_REMOVE, (_event, request) => {
        transfers.remove(transfersOf(request, has));
    });

    // Try a failed or cancelled upload again: it waits for this window's Upload once more.
    kit.ipc.handle(IPC.TRANSFER_RETRY, (event, request) => {
        if (!transfers.retry(uploadOf(request, has), event.sender.id)) throw new Error('Expected an upload that failed or was cancelled.');
    });

    // Pause Upload and Resume Upload, from any window. The answer is core's reason
    // when it couldn't, which the window shows. Resumed with no place free, an
    // upload waits as queued.
    kit.ipc.handle(IPC.TRANSFER_PAUSE, (_event, request) => main.pause(uploadOf(request, has)));
    kit.ipc.handle(IPC.TRANSFER_RESUME, (_event, request) => main.resume(uploadOf(request, has)));

    // Cancel, from any window: an upload may run for Share with Dropgate while the
    // person clicks Cancel in the main window. A share waiting on its question is
    // declined.
    kit.ipc.handle(IPC.TRANSFER_CANCEL, (_event, request) => main.cancel(uploadOf(request, has)));

    // Delete, on a finished upload, from any window, once the window has asked
    // the person: the transfer window deletes it with the upload's manage
    // token, which only it holds. The answer is the reason when it couldn't.
    kit.ipc.handle(IPC.TRANSFER_DELETE, (_event, request) => main.delete(uploadOf(request, has)));

    // Restart Now asks first while any transfer runs, is paused or is queued.
    kit.ipc.handle(IPC.TRANSFER_BUSY, () => main.busy());

    // Every transfer, as the window draws it: names and sizes, never a path.
    kit.ipc.handle(IPC.TRANSFERS_LIST, () => transfers.list().map(view));

    // The window stopped an upload before it started: no server, or the security warning declined.
    kit.ipc.handle(IPC.UPLOAD_FINISHED, (_event, result) => main.failed(failureOf(result)));

    // The page's Copy button: the same copy as an upload's.
    kit.ipc.handle(IPC.LINK_COPY, (_event, link) => main.copyLink(linkOf(link)));
}

module.exports = { answerWindowChannels, serverOf };
