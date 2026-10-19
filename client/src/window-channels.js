'use strict';

const fs = require('fs');
const { IPC } = require('./constants');
const {
    defaultFolderOf, downloadLink, downloadOptionsOf, failureOf, filesToAdd, handleOf, isId, linkOf, newUpload, optionsOf, pathList, saveToOf, savedServerOf, serverAddress,
    serverMoveOf, serverOptionsOf, serverToAdd, transfersOf, uploadOf, uploadsToStart,
} = require('./core/payloads');
const { NEW_SERVER, serverOf } = require('./core/servers');
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

/**
 * Answer the window's channels.
 * @param {object} main - What they act on, from main.js.
 * @param {any} main.kit - The kit, from start(): its ipc and settings.
 * @param {import('./core/handles').Handles} main.handles - The files handed to each window.
 * @param {import('./core/servers').Servers} main.servers - The saved servers, and the default.
 * @param {import('./core/servers').ServerChecks} main.checks - What each saved server's last check found, in memory.
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
 * @param {(owner: number, download: { link: string, server: object, host: string }) => { id: string }} main.addDownload - A download of a link: its list of files read in the transfer window.
 * @param {(ids: string[], folder: string, owner: number) => void} main.saveTo - Where downloads waiting are saved.
 * @param {(id: string) => void} main.show - Show a finished download in its folder.
 * @param {(sender: Electron.WebContents) => Promise<{ folder: string, label: string } | null>} main.chooseFolder - The system's folder picker.
 * @param {(owner: number, folder: string) => boolean} main.chose - Whether this window chose this folder (folder:choose).
 * @param {() => { path: string, label: string, chosen: boolean }} main.defaultFolder - Where new downloads are saved.
 * @param {(owner: number, folder: string | null) => { path: string, label: string, chosen: boolean }} main.setDefaultFolder - Settings > Transfers' Browse or Reset.
 */
function answerWindowChannels(main) {
    const { kit, handles, transfers, servers, checks } = main;
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

    // Add Server's Check: an address not saved, asked of the server by the
    // transfer window, before the person chooses to add it. What it found is
    // the page's to show, and kept nowhere.
    kit.ipc.handle(IPC.SERVER_CHECK, (_event, url) => main.host().check(serverOf(serverAddress(url))));

    // The saved servers (Settings > Servers). Each change is main's: the page
    // asks, and is answered with the list as it is now, with what each one's
    // last check found (main's memory only: checks). A server is checked by
    // the transfer window before it's saved, and saved once it answered as a
    // Dropgate server, under its address as the client read it, with the
    // settings for new uploads a new server starts with. Nothing a check found
    // is saved.
    const saved = (id) => Boolean(servers.get(id));
    const listed = () => {
        const list = servers.list();
        return { ...list, checks: checks.of(list.servers) };
    };
    kit.ipc.handle(IPC.SERVER_ADD, async (_event, request) => {
        const url = serverToAdd(request);
        const check = await main.host().check(serverOf(url));
        // The transfer window's answer is checked too: the address it found must be one.
        let found = null;
        try {
            found = check.ok && check.serverInfo?.version && check.serverInfo?.capabilities ? serverAddress(check.baseUrl) : null;
        } catch {
            found = null;
        }
        const server = found ? servers.add(found, check.serverInfo).server : null;
        if (server) checks.set(server.id, check);
        return { check, ...(server ? { server } : {}), ...listed() };
    });
    // Test, the default server as the window opens, and the default again
    // before an upload starts on it: a saved server checked at its address.
    // Its check is kept in memory, unless it was removed meanwhile.
    kit.ipc.handle(IPC.SERVER_TEST, async (_event, request) => {
        const id = savedServerOf(request, saved);
        const check = await main.host().check(serverOf(servers.get(id).url));
        if (saved(id)) checks.set(id, check);
        return { check, ...listed() };
    });
    kit.ipc.handle(IPC.SERVER_REMOVE, (_event, request) => {
        const id = savedServerOf(request, saved);
        servers.remove(id);
        checks.forget(id);
        return listed();
    });
    kit.ipc.handle(IPC.SERVER_MOVE, (_event, request) => {
        const { id, by } = serverMoveOf(request, saved);
        servers.move(id, by);
        return listed();
    });
    kit.ipc.handle(IPC.SERVER_SET_DEFAULT, (_event, request) => {
        servers.setDefault(savedServerOf(request, saved));
        return listed();
    });
    kit.ipc.handle(IPC.SERVER_SET_OPTIONS, (_event, request) => {
        const { id, options } = serverOptionsOf(request, saved);
        servers.setOptions(id, options);
        return listed();
    });

    /** The files handed to this window, as the registry keeps them: each one's path, name, size and modification time. */
    const heldFiles = (sender, list) => {
        const held = list.map((handle) => handles.get(sender, handle));
        if (held.some((file) => !file)) throw new Error('Expected files handed to this window.');
        return held.map(({ path: filePath, name, size, mtimeMs }) => ({ path: filePath, name, size, mtimeMs }));
    };

    // An upload of files handed to this window, waiting to start, with the
    // default server's settings for new uploads: its lifetime and download
    // limit (a new server's, with none saved). Whether it's encrypted is
    // decided as it starts.
    kit.ipc.handle(IPC.TRANSFER_ADD_UPLOAD, (event, request) => {
        const { files } = newUpload(request);
        const { lifetime, maxDownloads } = servers.default() ?? NEW_SERVER;
        const { id } = transfers.add({
            owner: event.sender.id,
            files: heldFiles(event.sender.id, files),
            options: { lifetime: { value: lifetime.unit === 'unlimited' ? 0 : lifetime.value, unit: lifetime.unit }, maxDownloads },
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

    // Start uploads waiting: this window's own, to the default server,
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
        // A download needs no word on encryption: its upload decided that.
        const own = ids.filter((id) => transfers.get(id).owner === sender && transfers.get(id).kind === 'upload');
        if (own.length > 0 && encrypt === undefined) throw new Error('Expected whether to encrypt.');
        const server = servers.default();
        if (!server && ids.some((id) => !transfers.get(id).server)) throw new Error('Server URL is not configured.');
        for (const id of own) transfers.get(id).options.encrypt = encrypt;
        for (const id of ids) main.start(id, transfers.get(id).server ?? serverOf(server.url));
    });

    // A link pasted into Download, as the page holds it until now: main checks
    // its shape and passes it to the transfer window, which reads its list of
    // files (no lease: the server counts nothing). Main keeps where it points
    // (the server's address and host), never the link: not stored, not logged.
    kit.ipc.handle(IPC.TRANSFER_ADD_DOWNLOAD, (event, request) => main.addDownload(event.sender.id, downloadLink(request)));

    // Save to, on downloads of this window's waiting (or reading their list):
    // Settings > Transfers' folder, or one this window chose with the system's
    // picker, by the ID main made for it. Never a path from the page.
    kit.ipc.handle(IPC.TRANSFER_SAVE_TO, (event, request) => {
        const owner = event.sender.id;
        const own = (id) => {
            const download = transfers.get(id);
            return download?.kind === 'download' && download.owner === owner && ['reading', 'waiting'].includes(download.state);
        };
        const { ids, folder } = saveToOf(request, own, (chosen) => main.chose(owner, chosen));
        main.saveTo(ids, folder, owner);
    });

    // Show in Folder, on a finished download: its folder, with it selected; Open
    // Folder, on a bundle saved as files: its own folder. Nothing received is ever opened.
    kit.ipc.handle(IPC.TRANSFER_SHOW, (_event, request) => {
        const id = uploadOf(request, has);
        if (!transfers.get(id).saved || transfers.get(id).state !== 'done') throw new Error('Expected a finished download.');
        main.show(id);
    });

    // The system's folder picker, for Save to and Settings > Transfers: the
    // page gets an ID for the folder (this window's, for this run) and the
    // folder's own name, never its path.
    kit.ipc.handle(IPC.FOLDER_CHOOSE, (event) => main.chooseFolder(event.sender));

    // Where new downloads are saved, for Settings > Transfers to show.
    kit.ipc.handle(IPC.FOLDER_DEFAULT, () => main.defaultFolder());

    // Settings > Transfers' Browse (a folder this window chose) or Reset (null: the system's Downloads).
    kit.ipc.handle(IPC.FOLDER_SET_DEFAULT, (event, request) => {
        const owner = event.sender.id;
        return main.setDefaultFolder(owner, defaultFolderOf(request, (chosen) => main.chose(owner, chosen)));
    });

    // Advanced Options (and Bulk Edit, one call each) on a transfer of this
    // window's waiting: an upload's lifetime, download limit and the files it
    // keeps (a share's, or one being asked about, is the share's own); a
    // download's files it saves and whether as one ZIP.
    kit.ipc.handle(IPC.TRANSFER_SET_OPTIONS, (event, request) => {
        const own = (kind) => (id) => {
            const transfer = transfers.get(id);
            return Boolean(transfer) && transfer.kind === kind && transfer.state === 'waiting' && transfer.owner === event.sender.id && !transfer.ask;
        };
        const fileCount = (id) => transfers.get(id).files.length;
        if (isId(request?.id) && transfers.get(request.id)?.kind === 'download') {
            const { id, options } = downloadOptionsOf(request, own('download'), fileCount);
            if (!transfers.choose(id, options)) throw new Error('Expected a download of this window\'s waiting to start.');
            return;
        }
        const { id, options } = optionsOf(request, own('upload'), fileCount);
        if (!transfers.setOptions(id, options)) throw new Error('Expected an upload of this window\'s waiting to start.');
    });

    // Remove uploads waiting or ended (Remove, Clear Finished): one going is cancelled first.
    kit.ipc.handle(IPC.TRANSFER_REMOVE, (_event, request) => {
        transfers.remove(transfersOf(request, has));
    });

    // Try a failed or cancelled upload again: it waits for this window's Upload once more.
    kit.ipc.handle(IPC.TRANSFER_RETRY, (event, request) => {
        if (!transfers.retry(uploadOf(request, has), event.sender.id)) throw new Error('Expected an upload or a download that failed or was cancelled.');
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

module.exports = { answerWindowChannels };
