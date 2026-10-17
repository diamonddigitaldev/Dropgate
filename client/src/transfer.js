import { DropgateClient, DropgateError, lifetime } from './dropgate-core.js';

// The transfer window's page: hidden, sandboxed, in a session of its own, with
// no bridge but window.engine (transfer-preload.js). It runs core, holds every
// upload's key and link while the upload runs, and makes every request
// Dropgate makes, server checks included and deletes. Main sends it work and
// hears how it goes; the app's window never runs core. A finished upload's
// manage token stays here, and only here, until its card is removed or the
// app quits: main is told the upload's link, never its token. A file's bytes come from the file
// service, over the MessagePort main hands this page, by the grant main made
// for it: never through main, and never by path.

const engine = window.engine;

/** How much of a file one read asks for: constants.js' READ_PIECE_BYTES. */
const READ_PIECE_BYTES = 1024 * 1024;

/** How long before a paused upload's deadline the notification comes. */
const PAUSE_WARNING_MS = 5 * 60 * 1000;

/** How often an upload's progress alone is passed on: a change of step goes at once. */
const UPDATE_EVERY_MS = 250;

/** The statuses an upload has while it's still going. */
const GOING = ['initializing', 'uploading', 'paused', 'completing'];

// --- The file service ---

// The file service's port, taken only from this window's own preload. Main
// starts the file service for the first upload that reads, and stops it once
// none is left, so each time it starts again this page is handed a new port,
// before the upload that needs it.
let nextRequest = 0;
const waiting = new Map();
let takePort;
let port = new Promise((resolve) => {
    takePort = resolve;
});
window.addEventListener('message', (event) => {
    if (event.source !== window || event.data !== 'engine:port' || !event.ports?.[0]) return;
    const [p] = event.ports;
    p.onmessage = ({ data }) => {
        const answer = waiting.get(data?.id);
        if (!answer) return;
        waiting.delete(data.id);
        answer(data);
    };
    takePort(p);
    port = Promise.resolve(p);
});

/** Ask the file service, and wait for its answer. */
async function ask(request) {
    const p = await port;
    const id = nextRequest++;
    return new Promise((resolve) => {
        waiting.set(id, resolve);
        p.postMessage({ id, ...request });
    });
}

/** Core's SOURCE_UNAVAILABLE, with what happened to the file. */
const unavailable = (message) => new DropgateError({ code: 'SOURCE_UNAVAILABLE', message });

/**
 * A file main granted this page, as one of core's file sources: core asks for
 * one range at a time, and the file service reads just that, in pieces. Like a
 * browser's File, it can't be read once the file has changed since it was
 * chosen (the file service checks its size and modification time), so a file
 * edited during an upload, or while it's paused, is never sent part old, part
 * new: the upload fails SOURCE_UNAVAILABLE, as core's own sources.fileHandle()
 * does.
 */
class GrantedFile {
    constructor({ handle, name, size }) {
        this.handle = handle;
        this.name = name;
        this.size = size;
    }

    async read(start, end) {
        const bytes = new Uint8Array(end - start);
        for (let at = start; at < end; at += READ_PIECE_BYTES) {
            const answer = await ask({ op: 'read', handle: this.handle, start: at, end: Math.min(end, at + READ_PIECE_BYTES) });
            if (answer.changed) throw unavailable("A file changed after the upload started, so the rest of it can't be read as it was.");
            if (answer.gone) throw unavailable("A file can't be read any more: It was moved or deleted.");
            if (!answer.bytes) throw unavailable("A file couldn't be read.");
            bytes.set(answer.bytes, at - start);
        }
        return bytes;
    }
}

// --- Servers ---

/** Main's answer to this page being ready: the app's name and version, for display only (core never sends them). */
let started = null;

/** Each server's client, by its address: a check makes a new one, as the app's Test always has, and an upload uses it. */
const clients = new Map();
const keyOf = (server) => `${server.allowInsecure ? 'insecure' : 'secure'} ${server.url}`;

/**
 * Every request core has going, so quitting can wait for them: a cancelled
 * upload tells its server as it ends, and the request that does isn't part of
 * its outcome.
 */
const requests = new Set();
function countedFetch(input, init) {
    const request = fetch(input, init);
    requests.add(request);
    request.then(() => requests.delete(request), () => requests.delete(request));
    return request;
}

async function newClient(server) {
    const { appInfo } = await started;
    const client = new DropgateClient({
        server: server.url,
        // Only an address typed with http:// is used over plain HTTP, and
        // then as it is: an https:// one is never retried over HTTP.
        allowInsecure: server.allowInsecure,
        appInfo,
        fetchFn: countedFetch,
    });
    clients.set(keyOf(server), client);
    return client;
}

const clientFor = async (server) => clients.get(keyOf(server)) ?? newClient(server);

// A server check: whether the server is there, and what it allows.
engine.onCheck(async ({ call, server }) => {
    let value;
    try {
        const client = await newClient(server);
        const compat = await client.server.connect({ timeoutMs: 5000 });
        value = {
            ok: true,
            baseUrl: client.server.baseUrl,
            serverVersion: compat.serverVersion,
            serverInfo: compat.serverInfo ? JSON.parse(JSON.stringify(compat.serverInfo)) : null,
            dgup: { compatible: compat.dgup.compatible, message: compat.dgup.message },
        };
    } catch (error) {
        value = { ok: false, code: error?.code ?? null, message: error?.message || String(error) };
    }
    engine.answer(call, value);
});

// --- Uploads ---

/** The uploads running, by the ID main gave each. */
const uploads = new Map();

/**
 * Each finished upload's server, its ID there and its manage token, by the ID
 * main gave it, for its Delete: from its completion until main says its card
 * is gone (engine:forget), it's deleted, or the app quits.
 */
const finished = new Map();

/** What main hears of a snapshot: core's own fields, which never name a file or hold a key. */
const SNAPSHOT_FIELDS = ['status', 'phase', 'text', 'percent', 'processedBytes', 'totalBytes', 'fileIndex', 'totalFiles', 'canPause', 'deadline'];
const pick = (snapshot) => Object.fromEntries(SNAPSHOT_FIELDS.filter((field) => snapshot[field] !== undefined).map((field) => [field, snapshot[field]]));

/** A change of step goes to main at once; progress alone at most every UPDATE_EVERY_MS. */
const stepOf = ({ status, phase, text, canPause, deadline, fileIndex }) => JSON.stringify([status, phase, text, canPause, deadline, fileIndex]);

engine.onUpload(async ({ id, server, options, files }) => {
    let operation;
    try {
        const sources = files.map((file) => new GrantedFile(file));
        operation = (await clientFor(server)).hosted.upload({
            files: sources.length === 1 ? sources[0] : sources,
            lifetimeMs: lifetime.toMs(options.lifetime.value, options.lifetime.unit),
            maxDownloads: options.maxDownloads,
            encrypt: options.encrypt,
        });
    } catch (error) {
        // Only an upload that never started gets here.
        engine.finished(id, { status: 'error', message: error?.message || String(error) });
        return;
    }

    const upload = { operation, sent: null, lastSent: 0, trailing: null, pauseEnding: { timer: null, deadline: null } };
    uploads.set(id, upload);
    const report = (snapshot) => send(id, upload, snapshot);
    report(operation.snapshot);
    operation.subscribe(report);

    // The upload's one outcome: completed, cancelled or failed.
    const outcome = await operation.result;
    uploads.delete(id);
    clearTimeout(upload.trailing);
    warnBeforeDeadline(id, upload, null);
    if (outcome.status === 'completed') {
        finished.set(id, { server, upload: outcome.value.id, manageToken: outcome.value.manageToken });
        engine.finished(id, { status: 'success', link: outcome.value.downloadUrl });
    }
    else if (outcome.status === 'cancelled') engine.finished(id, { status: 'cancelled' });
    else engine.finished(id, { status: 'error', message: outcome.error.message });
});

/** Tell main where an upload is: a new step at once, progress alone at most every UPDATE_EVERY_MS. */
function send(id, upload, snapshot, { now = false } = {}) {
    const { status, text, deadline } = snapshot;
    // Paused, the server holds the upload until its deadline, and nothing resumes it but Resume Upload.
    if (status !== 'paused') warnBeforeDeadline(id, upload, null);
    if (status === 'paused' && text === 'Paused.' && deadline) warnBeforeDeadline(id, upload, deadline);

    const step = stepOf(snapshot);
    clearTimeout(upload.trailing);
    const wait = upload.lastSent + UPDATE_EVERY_MS - Date.now();
    if (now || step !== upload.sent || wait <= 0) {
        upload.sent = step;
        upload.lastSent = Date.now();
        engine.update(id, pick(snapshot));
    } else {
        upload.trailing = setTimeout(() => send(id, upload, upload.operation.snapshot, { now: true }), wait);
    }
}

/**
 * The notification that a paused upload's server will drop it, 5 minutes
 * before its deadline, or at once when less is left: nothing resumes it by
 * itself. With null, or a new deadline, the one waiting is called off. Pausing
 * again renews the deadline, and so the notification. Its timer is here, where
 * core's own deadline timer is.
 */
function warnBeforeDeadline(id, upload, deadline) {
    const { pauseEnding } = upload;
    if (deadline === pauseEnding.deadline) return;
    clearTimeout(pauseEnding.timer);
    upload.pauseEnding = { timer: null, deadline };
    if (deadline === null) return;
    const wait = Math.max(0, deadline - PAUSE_WARNING_MS - Date.now());
    upload.pauseEnding.timer = setTimeout(() => engine.pauseEnding(id, deadline), wait);
}

/** Pause or resume an upload; the answer is core's reason when it couldn't, or nothing. */
async function pauseOrResume({ id, call }, pause) {
    const upload = uploads.get(id);
    let value = {};
    if (upload) {
        const { operation } = upload;
        try {
            await (pause ? operation.pause() : operation.resume());
        } catch (error) {
            // It moved on before the click landed: it's finishing, or a pause is already settling.
            const ended = !GOING.includes(operation.snapshot.status);
            if (!ended && !DropgateError.is(error, 'PAUSE_UNAVAILABLE')) {
                // The server refused the pause, or couldn't be asked to resume: nothing changed.
                value = { message: error?.message || (pause ? "The upload couldn't be paused." : "The upload couldn't be resumed.") };
            }
        } finally {
            // The buttons, as the upload is now: a click disabled its own.
            if (uploads.get(id) === upload) send(id, upload, operation.snapshot, { now: true });
        }
    }
    engine.answer(call, value);
}

engine.onPause((work) => pauseOrResume(work, true));
engine.onResume((work) => pauseOrResume(work, false));
engine.onCancel(({ id }) => uploads.get(id)?.operation.cancel());

// Delete a finished upload from its server, with its manage token, which then
// goes. One the server no longer has (it expired, or reached its download
// limit) is gone all the same: its link no longer works either way.
engine.onDelete(async ({ id, call }) => {
    const kept = finished.get(id);
    let value = {};
    if (!kept) {
        value = { message: "This upload can't be deleted from here any more." };
    } else {
        try {
            await (await clientFor(kept.server)).hosted.delete({ id: kept.upload, manageToken: kept.manageToken });
            finished.delete(id);
        } catch (error) {
            if (DropgateError.is(error, 'NOT_FOUND')) finished.delete(id);
            else value = { message: error?.message || "The upload couldn't be deleted." };
        }
    }
    engine.answer(call, value);
});

// Its card is gone: so is its manage token.
engine.onForget(({ id }) => finished.delete(id));

// The app is quitting: every finished upload's manage token is forgotten,
// every upload is cancelled, each server told (core asks it to drop the
// upload), and main is answered once they've all ended and every request
// still going has finished: the ones telling the servers among them. Nothing
// here outlives the app.
engine.onQuit(async ({ call }) => {
    finished.clear();
    // Each upload's own operation: a check makes a new client, so an upload's may no longer be in clients.
    const operations = [...uploads.values()].map(({ operation }) => operation);
    for (const operation of operations) operation.cancel();
    await Promise.allSettled(operations.map((operation) => operation.result));
    while (requests.size > 0) await Promise.allSettled([...requests]);
    engine.answer(call, {});
});

// Ready: main hands over the file service's port, then the work waiting.
started = engine.ready();
