'use strict';

const { randomUUID } = require('crypto');
const path = require('path');
const { BrowserWindow, MessageChannelMain, utilityProcess } = require('electron');
const { ENGINE, FILE_SERVICE, TRANSFERS } = require('./constants');
const { answerOf, deadlineOf, isId, outcomeOf, savedOf, snapshotOf } = require('./core/payloads');

// The transfer host: the hidden transfer window, which runs core and makes
// every request Dropgate makes, and the file service, which reads the files
// it sends and writes the files it downloads. Main starts both together on
// demand, and hands each one end of one MessageChannel, so a file's bytes go
// between the file service and the transfer window and never through main.
//
// - They start with the first server check or upload, and close
//   TRANSFERS.WINDOW_IDLE_MS after the last of the transfer window's work
//   ends (no upload running or paused there, no call waiting, and no
//   finished upload's manage token held for its Delete), unless more comes
//   first. The file service lives as long as the transfer window: it
//   holds no file but those granted for an upload running or paused. (Started
//   only for an upload and stopped after it, the app crashed in CI on Linux.)
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
//   path main holds, and writes one only for an output main granted as its
//   download started, into the folder main chose; each is revoked as its
//   transfer ends. It tells main where each download landed (saved), and
//   nothing else.
// - A finished upload's manage token stays in the transfer window, which
//   deletes the upload with it when asked, until its card is removed
//   (engine:forget) or the app quits (engine:quit); so does a download's
//   link, from the moment main hands it over to read its list of files.
//   Main knows only which transfers it holds one for: neither leaves the
//   transfer window, and main never keeps the link it passed on.

/**
 * Start answering the transfer window's channels. Call once the app is ready
 * (after kit.ready): the session is made then.
 * @param {object} options
 * @param {any} options.kit - The kit, from start().
 * @param {{ name: string, version: string }} options.appInfo - For core, for display only.
 * @param {(id: string, snapshot: object) => void} options.onUpdate - An upload's snapshot.
 * @param {(id: string, deadline: number) => void} options.onPauseEnding - A paused upload's server drops it at this time.
 * @param {(id: string, result: object) => void} options.onFinished - An upload's or a download's one outcome.
 * @param {(ids: string[]) => void} [options.onTokensLost] - The transfer window stopped holding these finished uploads' manage tokens, or these downloads' links.
 * @param {(id: string, filePath: string) => void} [options.onSaved] - A download's file is in place, here.
 * @param {string} [options.partials] - The partial folder, where the file service writes a download until it's whole.
 */
function createTransferHost({ kit, appInfo, onUpdate, onPauseEnding, onFinished, onTokensLost = () => {}, onSaved = () => {}, partials = '' }) {
    const session = kit.sessions.isolated('transfer');

    /** @type {BrowserWindow | null} */
    let win = null;
    /** @type {Electron.UtilityProcess | null} */
    let fileService = null;
    /** The transfer window's end of the channel to the file service, until it's ready for it. */
    let windowPort = null;
    let ready = false;
    /** What's waiting for the transfer window to be ready: [channel, payload]. */
    let queued = [];
    /** Whether main is closing them: as the app quits, or the transfer window has had nothing to do for a while. */
    let closing = false;
    /** The timer that closes the transfer window once it has had nothing to do for a while. */
    let idleTimer = null;
    /** The transfers running there: each one's kind, the read grants an upload was given, and a download's output. */
    const running = new Map();
    /** Each download's output, back to the download. */
    const outputs = new Map();
    /** The calls waiting for the transfer window's answer. */
    const calls = new Map();
    /** The finished uploads whose manage tokens the transfer window holds, and the downloads whose links it holds, by ID: never the tokens or links. */
    const kept = new Set();
    /** The file service's exit, while it runs. */
    let fileServiceExit = null;

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
        runningId(id, 'Expected how an upload running finished.');
        // A completed upload has its link, and a download none: its file is in its folder.
        const { kind } = running.get(id);
        if (outcome.status === 'success' && Boolean(outcome.link) !== (kind === 'upload')) throw new Error('Expected how an upload running finished.');
        // A completed upload's manage token stays there, for its Delete (a download's link is there already).
        if (outcome.status === 'success') kept.add(id);
        end(id);
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

    /** Hand the transfer window its port to the file service, once its page is ready for it. */
    function handPort() {
        if (!ready || !windowPort) return;
        win.webContents.postMessage(ENGINE.PORT, null, [windowPort]);
        windowPort = null;
    }

    /** Start the file service, with one end of a new channel; the transfer window gets the other once it's ready. */
    function startFileService() {
        fileService = utilityProcess.fork(path.join(__dirname, 'file-service.js'), [partials], {
            serviceName: 'Dropgate Client File Service',
            stdio: 'ignore',
        });
        const child = fileService;
        fileServiceExit = new Promise((resolve) => child.on('exit', resolve));
        // Where a download landed: for its own output only, an absolute path.
        child.on('message', (message) => {
            let saved;
            try {
                saved = savedOf(message, (output) => outputs.has(output));
            } catch {
                return;
            }
            onSaved(outputs.get(saved.output), saved.path);
        });
        const { port1, port2 } = new MessageChannelMain();
        fileService.postMessage({ type: FILE_SERVICE.PORT }, [port2]);
        windowPort = port1;
    }

    /** Stop the file service, with the transfer window. */
    function stopFileService() {
        fileService?.kill();
        fileService = null;
        fileServiceExit = null;
        windowPort = null;
        outputs.clear();
    }

    /** Whether the transfer window has anything to do or keep: an upload, a call waiting, a manage token. */
    const working = () => running.size > 0 || calls.size > 0 || kept.size > 0;

    /** With nothing running there, no call waiting and no token held, the transfer window closes after a while; any work calls that off. */
    function idleSoon() {
        clearTimeout(idleTimer);
        idleTimer = null;
        if (!win || working()) return;
        idleTimer = setTimeout(() => {
            idleTimer = null;
            if (!working()) close();
        }, TRANSFERS.WINDOW_IDLE_MS);
    }

    /**
     * Stop the transfer window and the file service: whatever runs there ends
     * with them, untold. Gives a promise that resolves once the file service
     * has exited (at most 3 seconds), so nothing holds a partial file open
     * when the partial folder is emptied.
     */
    function close() {
        clearTimeout(idleTimer);
        idleTimer = null;
        closing = true;
        const exited = fileServiceExit;
        if (win && !win.isDestroyed()) win.destroy();
        else stopped('The transfer window stopped.');
        let timer;
        return Promise.race([exited ?? Promise.resolve(), new Promise((resolve) => { timer = setTimeout(resolve, 3_000); })]).finally(() => clearTimeout(timer));
    }

    /** Start the transfer window, if it isn't running. */
    function start() {
        clearTimeout(idleTimer);
        idleTimer = null;
        if (win) return;
        closing = false;
        startFileService();

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
        // Its tokens went with it: those uploads can't be deleted from here any more.
        const lost = [...kept];
        kept.clear();
        if (lost.length > 0 && !closing) onTokensLost(lost);
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

    /** Send work that's answered, and wait for its answer: a check's, or a pause's, a resume's, a delete's or a quit's (each { message? }). */
    function call(channel, payload) {
        const id = randomUUID();
        const kind = channel === ENGINE.CHECK ? 'check' : channel === ENGINE.METADATA ? 'metadata' : 'pause';
        return new Promise((resolve, reject) => {
            calls.set(id, { kind, resolve, reject });
            send(channel, { ...payload, call: id });
        });
    }

    /** A transfer has ended: an upload's read grants are revoked, and a download's output. */
    function end(id) {
        const { grants = [], output = null } = running.get(id) ?? {};
        running.delete(id);
        for (const handle of grants) fileService?.postMessage({ type: FILE_SERVICE.REVOKE, handle });
        if (output) {
            fileService?.postMessage({ type: FILE_SERVICE.REVOKE, output });
            // Its saved report, if one is still on its way, comes first: the service answers in order.
            setImmediate(() => outputs.delete(output));
        }
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
            running.set(id, { kind: 'upload', grants: granted.map((file) => file.handle) });
            for (const { handle, path: filePath, size, mtimeMs } of granted) {
                fileService.postMessage({ type: FILE_SERVICE.GRANT_READ, handle, path: filePath, size, mtimeMs });
            }
            send(ENGINE.UPLOAD, { id, server, options, files: granted.map(({ handle, name, size }) => ({ handle, name, size })) });
        },

        /**
         * Read a download's list of files: the transfer window keeps its link
         * (main passes it on and keeps none of it), reads the list with no
         * lease, and answers it, or why it couldn't (then it keeps nothing).
         * @param {string} id - The download's ID, which main made.
         * @param {string} link
         * @returns {Promise<{ files: { name: string, size: number }[], encrypted: boolean } | { message: string }>}
         */
        async metadata(id, link) {
            if (!isId(id) || running.has(id) || kept.has(id)) throw new Error('Expected a new download.');
            kept.add(id);
            const answer = await call(ENGINE.METADATA, { id, link }).catch((error) => ({ message: error.message }));
            if (answer.message) kept.delete(id);
            idleSoon();
            return answer;
        },

        /**
         * Start a download whose list of files was read: its folder is granted
         * to the file service as an output, and the transfer window gets the
         * output, never the folder.
         * @param {string} id
         * @param {string} folder - Where it's saved, as main resolved it.
         */
        download(id, folder) {
            if (!isId(id) || running.has(id)) throw new Error('Expected a new download.');
            if (!kept.has(id)) throw new Error('The link to this download is no longer held: Paste it again.');
            start();
            const output = randomUUID();
            running.set(id, { kind: 'download', grants: [], output });
            outputs.set(output, id);
            fileService.postMessage({ type: FILE_SERVICE.GRANT_OUTPUT, output, folder, shape: 'file' });
            send(ENGINE.DOWNLOAD, { id, output });
        },

        /** Whether the transfer window holds a download's link: from its list being read until it's removed, unless the transfer window stopped. */
        holds: (id) => kept.has(id),

        /** Pause or resume an upload: the answer is core's reason when it couldn't, or nothing. */
        pause: (id) => (known(id) ? call(ENGINE.PAUSE, { id }) : Promise.resolve({})),
        resume: (id) => (known(id) ? call(ENGINE.RESUME, { id }) : Promise.resolve({})),

        cancel(id) {
            if (known(id)) send(ENGINE.CANCEL, { id });
        },

        /**
         * Delete a finished upload from its server, with the manage token the
         * transfer window holds: the answer is the reason when it couldn't, or
         * nothing, and then the token is gone.
         * @param {string} id
         */
        async delete(id) {
            if (!kept.has(id)) return { message: "This upload can't be deleted from here any more." };
            const answer = await call(ENGINE.DELETE, { id });
            if (!answer.message) kept.delete(id);
            idleSoon();
            return answer;
        },

        /** A finished upload's card is gone: the transfer window forgets its manage token. Nothing is started for it. */
        forget(id) {
            if (!kept.delete(id)) return;
            if (win && ready) win.webContents.send(ENGINE.FORGET, { id });
            else if (win) queued.push([ENGINE.FORGET, { id }]);
            idleSoon();
        },

        /** Whether an upload is running there, paused or not. */
        get busy() {
            return running.size > 0;
        },

        /** Whether the transfer window holds a finished upload's manage token: quitting asks it to forget them. */
        get keeping() {
            return kept.size > 0;
        },

        /**
         * The app is quitting: the transfer window cancels everything there,
         * telling each server, forgets every manage token, and answers once it
         * has (or after TRANSFERS.QUIT_WAIT_MS, whichever comes first). Its
         * uploads' outcomes reach onFinished as they end.
         */
        async quit() {
            if (!win || (running.size === 0 && kept.size === 0)) return;
            kept.clear();
            let timer;
            const waited = new Promise((resolve) => {
                timer = setTimeout(resolve, TRANSFERS.QUIT_WAIT_MS);
            });
            await Promise.race([call(ENGINE.QUIT, {}).catch(() => {}), waited]);
            clearTimeout(timer);
        },

        /** Stop the transfer window and the file service, as the app quits: whatever runs there ends with them. */
        close,
    };
}

module.exports = { createTransferHost };
