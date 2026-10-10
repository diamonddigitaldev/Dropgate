'use strict';

const { randomUUID } = require('crypto');
const path = require('path');
const { BrowserWindow, MessageChannelMain, utilityProcess } = require('electron');
const { ENGINE, FILE_SERVICE } = require('./constants');

// The transfer host: the hidden transfer window, which runs core and makes
// every request Dropgate makes, and the file service, which reads the files
// it sends. Main starts both on demand, the first time there's work for them,
// and hands each one end of one MessageChannel, so a file's bytes go from the
// file service to the transfer window and never through main.
//
// - The transfer window is sandboxed, isolated and without Node, in the kit's
//   isolated "transfer" session (in memory, no permission ever granted, no
//   kit bridge), with its own preload and page, whose CSP allows nothing but
//   its own scripts and requests to servers. It can't navigate or open a
//   window, and its timers aren't slowed while it's hidden: core's timeouts
//   and a paused upload's deadline run on them.
// - Its channels are answered for its page in that session only
//   (kit.ipc.handle(…, { session })), and each message's upload must be one
//   main started there.
// - The file service is a utility process with no window and no session. It
//   reads a file only for a grant main made as its upload started, with the
//   path main holds, and the grant is revoked as the upload ends.

/** A UUID main made: an upload's ID, or a call's. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Start answering the transfer window's channels. Call once the app is ready
 * (after kit.ready): the session is made then.
 * @param {object} options
 * @param {any} options.kit - The kit, from start().
 * @param {{ name: string, version: string }} options.appInfo - For core, for display only.
 * @param {(id: string, snapshot: object) => void} options.onUpdate - An upload's snapshot.
 * @param {(id: string, deadline: number) => void} options.onPauseEnding - A paused upload's server drops it at this time.
 * @param {(id: string, result: object) => void} options.onFinished - An upload's one outcome.
 */
function createTransferHost({ kit, appInfo, onUpdate, onPauseEnding, onFinished }) {
    const session = kit.sessions.isolated('transfer');

    /** @type {BrowserWindow | null} */
    let win = null;
    /** @type {Electron.UtilityProcess | null} */
    let fileService = null;
    /** The file service's end of the channel, until the transfer window is ready for its own. */
    let windowPort = null;
    let ready = false;
    /** What's waiting for the transfer window to be ready: [channel, payload]. */
    let queued = [];
    /** Whether main is closing them, as the app quits. */
    let closing = false;
    /** The uploads running there, with the read grants each was given. */
    const running = new Map();
    /** The calls waiting for the transfer window's answer. */
    const calls = new Map();

    const known = (id) => typeof id === 'string' && running.has(id);

    kit.ipc.handle(ENGINE.READY, (event) => {
        if (!win || event.sender !== win.webContents) throw new Error('Not the transfer window.');
        if (windowPort) {
            event.sender.postMessage(ENGINE.PORT, null, [windowPort]);
            windowPort = null;
        }
        ready = true;
        for (const [channel, payload] of queued.splice(0)) win.webContents.send(channel, payload);
        return { appInfo };
    }, { session });

    kit.ipc.handle(ENGINE.UPDATE, (_event, id, snapshot) => {
        if (!known(id) || typeof snapshot !== 'object' || snapshot === null) throw new Error('Expected a snapshot of an upload running.');
        onUpdate(id, snapshot);
    }, { session });

    kit.ipc.handle(ENGINE.PAUSE_ENDING, (_event, id, deadline) => {
        if (!known(id) || !Number.isFinite(deadline)) throw new Error('Expected a deadline of an upload running.');
        onPauseEnding(id, deadline);
    }, { session });

    kit.ipc.handle(ENGINE.FINISHED, (_event, id, result) => {
        if (!known(id) || !['success', 'cancelled', 'error'].includes(result?.status)) throw new Error('Expected how an upload running finished.');
        end(id);
        onFinished(id, result);
    }, { session });

    kit.ipc.handle(ENGINE.ANSWER, (_event, call, value) => {
        const answer = typeof call === 'string' ? calls.get(call) : undefined;
        if (!answer) throw new Error('Expected the answer to a call.');
        calls.delete(call);
        answer.resolve(value);
    }, { session });

    /** Start the file service and the transfer window, if they aren't running. */
    function start() {
        if (win) return;
        closing = false;
        fileService = utilityProcess.fork(path.join(__dirname, 'file-service.js'), [], {
            serviceName: 'Dropgate Client File Service',
            stdio: 'ignore',
        });
        const { port1, port2 } = new MessageChannelMain();
        fileService.postMessage({ type: FILE_SERVICE.PORT }, [port2]);
        windowPort = port1;

        win = new BrowserWindow({
            show: false,
            webPreferences: {
                preload: path.join(__dirname, 'transfer-preload.js'),
                session,
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
                spellcheck: false,
                backgroundThrottling: false,
            },
        });
        win.removeMenu();
        const contents = win.webContents;
        contents.on('will-navigate', (event) => event.preventDefault());
        contents.on('will-redirect', (event) => event.preventDefault());
        contents.setWindowOpenHandler(() => ({ action: 'deny' }));
        contents.on('will-attach-webview', (event) => event.preventDefault());
        // It stopped (closed by quitting, or its renderer crashed): what ran there ends with it.
        win.on('closed', () => stopped('The transfer window stopped.'));
        contents.on('render-process-gone', () => {
            if (win && !win.isDestroyed()) win.destroy();
        });
        win.loadFile(path.join(__dirname, 'transfer.html'));
    }

    /**
     * The transfer window and the file service are gone: every call is
     * answered, and every upload there fails, unless main closed them as the
     * app quits.
     */
    function stopped(message) {
        const service = fileService;
        win = null;
        fileService = null;
        windowPort = null;
        ready = false;
        queued = [];
        service?.kill();
        for (const id of [...running.keys()]) {
            running.delete(id);
            if (!closing) onFinished(id, { status: 'error', message });
        }
        for (const [call, answer] of calls) {
            calls.delete(call);
            answer.reject(new Error(message));
        }
    }

    /** Send the transfer window its work, starting it if need be. */
    function send(channel, payload) {
        start();
        if (ready) win.webContents.send(channel, payload);
        else queued.push([channel, payload]);
    }

    /** Send work that's answered, and wait for its answer. */
    function call(channel, payload) {
        const id = randomUUID();
        return new Promise((resolve, reject) => {
            calls.set(id, { resolve, reject });
            send(channel, { ...payload, call: id });
        });
    }

    /** An upload has ended: its read grants are revoked. */
    function end(id) {
        const grants = running.get(id) ?? [];
        running.delete(id);
        for (const handle of grants) fileService?.postMessage({ type: FILE_SERVICE.REVOKE, handle });
    }

    return {
        /**
         * Ask a server whether it's there, and what it allows.
         * @param {{ url: string, allowInsecure: boolean }} server
         */
        check: (server) => call(ENGINE.CHECK, { server }),

        /**
         * Start an upload. Each file is granted to the file service, and the
         * transfer window gets its grant, name and size, never its path.
         * @param {string} id - The upload's ID, which main made.
         * @param {{ url: string, allowInsecure: boolean }} server
         * @param {object} options - Its lifetime, download limit and whether it's encrypted.
         * @param {{ path: string, name: string, size: number, mtimeMs: number }[]} files
         */
        upload(id, server, options, files) {
            if (!ID.test(id) || running.has(id)) throw new Error('Expected a new upload.');
            start();
            const granted = files.map((file) => ({ ...file, handle: randomUUID() }));
            running.set(id, granted.map((file) => file.handle));
            for (const { handle, path: filePath, size, mtimeMs } of granted) {
                fileService.postMessage({ type: FILE_SERVICE.GRANT_READ, handle, path: filePath, size, mtimeMs });
            }
            send(ENGINE.UPLOAD, { id, server, options, files: granted.map(({ handle, name, size }) => ({ handle, name, size })) });
        },

        /** Pause or resume an upload: the answer is core's reason when it couldn't, or nothing. */
        pause: (id) => (known(id) ? call(ENGINE.PAUSE, { id }) : Promise.resolve({})),
        resume: (id) => (known(id) ? call(ENGINE.RESUME, { id }) : Promise.resolve({})),

        cancel(id) {
            if (known(id)) send(ENGINE.CANCEL, { id });
        },

        /** Whether an upload is running there, paused or not. */
        get busy() {
            return running.size > 0;
        },

        /** Stop the transfer window and the file service, as the app quits: whatever runs there ends with them. */
        close() {
            closing = true;
            if (win && !win.isDestroyed()) win.destroy();
            else stopped('The transfer window stopped.');
        },
    };
}

module.exports = { createTransferHost };
