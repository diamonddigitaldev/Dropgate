'use strict';

const { randomUUID } = require('crypto');
const path = require('path');
const { BrowserWindow, MessageChannelMain, utilityProcess } = require('electron');
const { ENGINE, FILE_SERVICE, TRANSFERS } = require('./constants');
const { answerOf, deadlineOf, isId, outcomeOf, snapshotOf } = require('./core/payloads');

// The transfer host: the hidden transfer window, which runs core and makes
// every request Dropgate makes, and the file service, which reads the files
// it sends. Main starts each on demand, and hands each one end of one
// MessageChannel, so a file's bytes go from the file service to the transfer
// window and never through main.
//
// - The transfer window starts with the first server check or upload, and
//   closes TRANSFERS.WINDOW_IDLE_MS after the last of its work ends (no upload
//   running or paused there, no call waiting), unless more comes first.
// - The file service starts with the first upload that reads, and stops as
//   the last upload there ends: a paused one keeps it, and its descriptors.
//   Each time it starts, the transfer window is handed a new port to it.
//
// - The transfer window is sandboxed, isolated and without Node, in the kit's
//   isolated "transfer" session (in memory, no permission ever granted, no
//   kit bridge), with its own preload and page, whose CSP allows nothing but
//   its own scripts and requests to servers. It can't navigate or open a
//   window, and its timers aren't slowed while it's hidden: core's timeouts
//   and a paused upload's deadline run on them.
// - Its channels are answered for its page in that session only
//   (kit.ipc.handle(…, { session })), each message's upload must be one main
//   started there, and each payload is checked before anything is done with
//   it (core/payloads.js): the page is never trusted.
// - The file service is a utility process with no window and no session. It
//   reads a file only for a grant main made as its upload started, with the
//   path main holds, and the grant is revoked as the upload ends.

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
    /** The transfer window's end of the channel to the file service, until both are ready for it. */
    let windowPort = null;
    let ready = false;
    /** Whether the file service has spawned: its end of the channel has reached it. */
    let serviceSpawned = false;
    /** Work that reads through the port not handed over yet, sent once it is. */
    let afterPort = [];
    /** What's waiting for the transfer window to be ready: [channel, payload]. */
    let queued = [];
    /** Whether main is closing them: as the app quits, or the transfer window has had nothing to do for a while. */
    let closing = false;
    /** The timer that closes the transfer window once it has had nothing to do for a while. */
    let idleTimer = null;
    /** The uploads running there, with the read grants each was given. */
    const running = new Map();
    /** The calls waiting for the transfer window's answer. */
    const calls = new Map();

    const known = (id) => isId(id) && running.has(id);

    /** Refuse any page but the transfer window main made: the session is its alone, and so is each channel. */
    const fromTransferWindow = (event) => {
        if (!win || win.isDestroyed() || event.sender !== win.webContents) throw new Error('Not the transfer window.');
    };

    kit.ipc.handle(ENGINE.READY, (event) => {
        fromTransferWindow(event);
        ready = true;
        handPort();
        for (const [channel, payload] of queued.splice(0)) win.webContents.send(channel, payload);
        return { appInfo };
    }, { session });

    /** Refuse a message about an upload main didn't start there, or that has ended. */
    const runningId = (id, refusal) => {
        if (!known(id)) throw new Error(refusal);
        return id;
    };

    kit.ipc.handle(ENGINE.UPDATE, (event, id, snapshot) => {
        fromTransferWindow(event);
        onUpdate(runningId(id, 'Expected a snapshot of an upload running.'), snapshotOf(snapshot));
    }, { session });

    kit.ipc.handle(ENGINE.PAUSE_ENDING, (event, id, deadline) => {
        fromTransferWindow(event);
        onPauseEnding(runningId(id, 'Expected a deadline of an upload running.'), deadlineOf(deadline));
    }, { session });

    kit.ipc.handle(ENGINE.FINISHED, (event, id, result) => {
        fromTransferWindow(event);
        const outcome = outcomeOf(result);
        end(runningId(id, 'Expected how an upload running finished.'));
        onFinished(id, outcome);
    }, { session });

    kit.ipc.handle(ENGINE.ANSWER, (event, call, value) => {
        fromTransferWindow(event);
        const answer = isId(call) ? calls.get(call) : undefined;
        if (!answer) throw new Error('Expected the answer to a call.');
        const checked = answerOf(answer.kind, value);
        calls.delete(call);
        answer.resolve(checked);
        idleSoon();
    }, { session });

    /**
     * Hand the transfer window its port to the file service, once both are
     * ready for it: the transfer window's page has set itself up, and the file
     * service has spawned, so the channel's two ends are never on their way
     * at once (with the file service's still waiting for it to start, main
     * stopped answering in CI). Then the work waiting for it goes.
     */
    function handPort() {
        if (!ready || !serviceSpawned || !windowPort) return;
        win.webContents.postMessage(ENGINE.PORT, null, [windowPort]);
        windowPort = null;
        for (const work of afterPort.splice(0)) work();
    }

    /** Work that reads from the file service: sent once the transfer window has its port, so it never reads on one gone. */
    function onceHanded(work) {
        if (windowPort) afterPort.push(work);
        else work();
    }

    /**
     * Grant the file service an upload's files, starting it if it isn't
     * running. A new one gets its channel to the transfer window after the
     * grants: it takes main's messages in order, so it holds them before the
     * first read can reach it.
     */
    function grantReads(granted) {
        const fresh = !fileService;
        if (fresh) {
            const service = utilityProcess.fork(path.join(__dirname, 'file-service.js'), [], {
                serviceName: 'Dropgate Client File Service',
                stdio: 'ignore',
            });
            fileService = service;
            service.once('spawn', () => {
                if (fileService !== service) return;
                serviceSpawned = true;
                handPort();
            });
        }
        for (const { handle, path: filePath, size, mtimeMs } of granted) {
            fileService.postMessage({ type: FILE_SERVICE.GRANT_READ, handle, path: filePath, size, mtimeMs });
        }
        if (fresh) {
            const { port1, port2 } = new MessageChannelMain();
            fileService.postMessage({ type: FILE_SERVICE.PORT }, [port2]);
            windowPort = port1;
            handPort();
        }
    }

    /** Stop the file service: nothing reads now. */
    function stopFileService() {
        fileService?.kill();
        fileService = null;
        serviceSpawned = false;
        windowPort = null;
        afterPort = [];
    }

    /** With nothing running there and no call waiting, the transfer window closes after a while; any work calls that off. */
    function idleSoon() {
        clearTimeout(idleTimer);
        idleTimer = null;
        if (!win || running.size > 0 || calls.size > 0) return;
        idleTimer = setTimeout(() => {
            idleTimer = null;
            if (running.size === 0 && calls.size === 0) close();
        }, TRANSFERS.WINDOW_IDLE_MS);
    }

    /** Stop the transfer window and the file service: whatever runs there ends with them, untold. */
    function close() {
        clearTimeout(idleTimer);
        idleTimer = null;
        closing = true;
        if (win && !win.isDestroyed()) win.destroy();
        else stopped('The transfer window stopped.');
    }

    /** Start the transfer window, if it isn't running. */
    function start() {
        clearTimeout(idleTimer);
        idleTimer = null;
        if (win) return;
        closing = false;

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
        win = null;
        ready = false;
        queued = [];
        stopFileService();
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

    /** Send work that's answered, and wait for its answer: a check's, or a pause's, a resume's or a quit's (all three { message? }). */
    function call(channel, payload) {
        const id = randomUUID();
        const kind = channel === ENGINE.CHECK ? 'check' : 'pause';
        return new Promise((resolve, reject) => {
            calls.set(id, { kind, resolve, reject });
            send(channel, { ...payload, call: id });
        });
    }

    /** An upload has ended: its read grants are revoked, and with nothing else reading, the file service stops. */
    function end(id) {
        const grants = running.get(id) ?? [];
        running.delete(id);
        for (const handle of grants) fileService?.postMessage({ type: FILE_SERVICE.REVOKE, handle });
        if (running.size === 0) stopFileService();
        idleSoon();
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
            if (!isId(id) || running.has(id)) throw new Error('Expected a new upload.');
            start();
            const granted = files.map((file) => ({ ...file, handle: randomUUID() }));
            running.set(id, granted.map((file) => file.handle));
            grantReads(granted);
            onceHanded(() => send(ENGINE.UPLOAD, { id, server, options, files: granted.map(({ handle, name, size }) => ({ handle, name, size })) }));
        },

        /** Pause or resume an upload: the answer is core's reason when it couldn't, or nothing. */
        pause: (id) => (known(id) ? call(ENGINE.PAUSE, { id }) : Promise.resolve({})),
        resume: (id) => (known(id) ? call(ENGINE.RESUME, { id }) : Promise.resolve({})),

        cancel(id) {
            // After its upload's work, if that's still waiting for the port.
            if (known(id)) onceHanded(() => send(ENGINE.CANCEL, { id }));
        },

        /** Whether an upload is running there, paused or not. */
        get busy() {
            return running.size > 0;
        },

        /**
         * The app is quitting: the transfer window cancels everything there,
         * telling each server, and answers once it has (or after
         * TRANSFERS.QUIT_WAIT_MS, whichever comes first). Its uploads' outcomes
         * reach onFinished as they end.
         */
        async quit() {
            if (!win || running.size === 0) return;
            let timer;
            const waited = new Promise((resolve) => {
                timer = setTimeout(resolve, TRANSFERS.QUIT_WAIT_MS);
            });
            // After any upload's work still waiting for the port, so it's cancelled too.
            const asked = new Promise((resolve) => onceHanded(resolve)).then(() => call(ENGINE.QUIT, {}));
            await Promise.race([asked.catch(() => {}), waited]);
            clearTimeout(timer);
        },

        /** Stop the transfer window and the file service, as the app quits: whatever runs there ends with them. */
        close,
    };
}

module.exports = { createTransferHost };
