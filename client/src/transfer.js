import { DropgateClient, DropgateError, lifetime } from './dropgate-core.js';

// The transfer window's page: hidden, sandboxed, in a session of its own, with
// no bridge but window.engine (transfer-preload.js). It runs core, holds every
// upload's key and link while the upload runs, and makes every request
// Dropgate makes, server checks included, downloads and deletes. Main sends it
// work and hears how it goes; the app's window never runs core. A finished
// upload's manage token stays here, and only here, until its card is removed
// or the app quits: main is told the upload's link, never its token. A
// download's link stays here too, from the moment main hands it over to read
// its list of files, until its card is removed or the app quits, so its
// download (and a retry) can be made from it: main keeps none of it. A file's
// bytes go between this page and the file service, over the MessagePort main
// hands this page, by the grant or output main made for it: never through
// main, and never by path.

const engine = window.engine;

/** How much of a file one read asks for: constants.js' READ_PIECE_BYTES. */
const READ_PIECE_BYTES = 1024 * 1024;

/** How long before a paused transfer's deadline the notification comes. */
const PAUSE_WARNING_MS = 5 * 60 * 1000;

/** How often a transfer's progress alone is passed on: a change of step goes at once. */
const UPDATE_EVERY_MS = 250;

/** The statuses a transfer has while it's still going. */
const GOING = ['initializing', 'uploading', 'downloading', 'paused', 'completing'];

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

/** Core's OUTPUT_WRITE_FAILED, with the file service's reason (which names no file or folder). */
const notSaved = (answer) => new DropgateError({ code: 'OUTPUT_WRITE_FAILED', message: answer.failed || "The file couldn't be saved." });

/**
 * A file a download saves, as one of core's sinks: the file service opens it
 * in the output main granted (under the name it makes safe and unique there),
 * writes each piece as core gives it (core waits for each, so a slow disk
 * slows the download instead of filling memory), moves it into place once
 * it's whole (close), or deletes it (abort). Paused, core writes nothing, and
 * the file stays open in the file service.
 */
class OutputSink {
    /**
     * The file's sink. One that couldn't be opened is given all the same, and
     * fails at its first write or close with the file service's reason: core
     * puts a reason of its own on a sink function that throws.
     * @param {string} output
     * @param {{ name: string, size: number, index: number }} file
     */
    static async open(output, { name, size, index }) {
        const answer = await ask({ op: 'open', output, name, size, index });
        return new OutputSink(answer.sink ?? null, answer.sink ? null : notSaved(answer));
    }

    constructor(sink, failure = null) {
        this.sink = sink;
        this.failure = failure;
    }

    async write(chunk) {
        if (this.failure) throw this.failure;
        // A copy of just these bytes: a view's whole buffer would be copied with it otherwise.
        const answer = await ask({ op: 'write', sink: this.sink, bytes: chunk.byteLength === chunk.buffer.byteLength ? chunk : chunk.slice() });
        if (!answer.ok) throw notSaved(answer);
    }

    async close() {
        if (this.failure) throw this.failure;
        const answer = await ask({ op: 'close', sink: this.sink });
        if (!answer.ok) throw notSaved(answer);
    }

    async abort() {
        if (this.sink) await ask({ op: 'abort', sink: this.sink });
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

// --- Transfers ---

/** The uploads and downloads running, by the ID main gave each. */
const running = new Map();

/**
 * Each finished upload's server, its ID there and its manage token, by the ID
 * main gave it, for its Delete: from its completion until main says its card
 * is gone (engine:forget), it's deleted, or the app quits.
 */
const finished = new Map();

/**
 * Each download's server, the upload's ID there and the secret from its link,
 * by the ID main gave it: from the moment main handed over the link until its
 * card is gone (engine:forget) or the app quits. Main never keeps the link.
 */
const links = new Map();

/** What main hears of a snapshot: core's own fields, which never name a file or hold a key. */
const SNAPSHOT_FIELDS = ['status', 'phase', 'text', 'percent', 'processedBytes', 'totalBytes', 'fileIndex', 'totalFiles', 'canPause', 'deadline'];
const pick = (snapshot) => Object.fromEntries(SNAPSHOT_FIELDS.filter((field) => snapshot[field] !== undefined).map((field) => [field, snapshot[field]]));

/** A change of step goes to main at once; progress alone at most every UPDATE_EVERY_MS. */
const stepOf = ({ status, phase, text, canPause, deadline, fileIndex }) => JSON.stringify([status, phase, text, canPause, deadline, fileIndex]);

/**
 * Follow a transfer that has started in core: main hears each snapshot, and
 * its one outcome, then `done` is given it.
 */
async function follow(id, operation, done) {
    const transfer = { operation, sent: null, lastSent: 0, trailing: null, pauseEnding: { timer: null, deadline: null } };
    running.set(id, transfer);
    const report = (snapshot) => send(id, transfer, snapshot);
    report(operation.snapshot);
    operation.subscribe(report);

    // Its one outcome: completed, cancelled or failed.
    const outcome = await operation.result;
    running.delete(id);
    clearTimeout(transfer.trailing);
    warnBeforeDeadline(id, transfer, null);
    if (outcome.status === 'completed') done(outcome.value);
    else if (outcome.status === 'cancelled') engine.finished(id, { status: 'cancelled' });
    else engine.finished(id, { status: 'error', message: outcome.error.message });
}

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
    await follow(id, operation, (value) => {
        finished.set(id, { server, upload: value.id, manageToken: value.manageToken });
        engine.finished(id, { status: 'success', link: value.downloadUrl });
    });
});

// A download's link: read its list of files from its server, with no lease,
// so nothing is counted, and keep the link for its download. One that can't be
// read is answered with why, and nothing of it is kept.
engine.onMetadata(async ({ id, call, link }) => {
    let value;
    try {
        const url = new URL(link);
        const kept = {
            server: { url: url.origin, allowInsecure: url.protocol === 'http:' },
            upload: url.pathname.slice(1).toLowerCase(),
            secret: url.hash.slice(1) || undefined,
        };
        const meta = await (await clientFor(kept.server)).hosted.metadata({ id: kept.upload, secret: kept.secret });
        links.set(id, kept);
        value = { files: meta.files.map(({ name, size }) => ({ name, size })), encrypted: meta.encrypted };
    } catch (error) {
        value = { message: error?.message || "The link's list of files couldn't be read." };
    }
    engine.answer(call, value);
});

// Download one, from the link kept for it, into the output main granted the
// file service: core takes a lease, counted as one download, and gives each
// file to a sink there as it starts.
engine.onDownload(async ({ id, output }) => {
    const kept = links.get(id);
    let operation;
    try {
        if (!kept) throw new Error('The link to this download is no longer held: Paste it again.');
        operation = (await clientFor(kept.server)).hosted.download({
            id: kept.upload,
            secret: kept.secret,
            sink: (file) => OutputSink.open(output, file),
        });
    } catch (error) {
        // Only a download that never started gets here.
        engine.finished(id, { status: 'error', message: error?.message || String(error) });
        return;
    }
    await follow(id, operation, () => engine.finished(id, { status: 'success' }));
});

/** Tell main where a transfer is: a new step at once, progress alone at most every UPDATE_EVERY_MS. */
function send(id, transfer, snapshot, { now = false } = {}) {
    const { status, text, deadline } = snapshot;
    // Paused, the server holds it until its deadline, and nothing resumes it but Resume.
    if (status !== 'paused') warnBeforeDeadline(id, transfer, null);
    if (status === 'paused' && text === 'Paused.' && deadline) warnBeforeDeadline(id, transfer, deadline);

    const step = stepOf(snapshot);
    clearTimeout(transfer.trailing);
    const wait = transfer.lastSent + UPDATE_EVERY_MS - Date.now();
    if (now || step !== transfer.sent || wait <= 0) {
        transfer.sent = step;
        transfer.lastSent = Date.now();
        engine.update(id, pick(snapshot));
    } else {
        transfer.trailing = setTimeout(() => send(id, transfer, transfer.operation.snapshot, { now: true }), wait);
    }
}

/**
 * The notification that a paused transfer's server will drop it, 5 minutes
 * before its deadline, or at once when less is left: nothing resumes it by
 * itself. With null, or a new deadline, the one waiting is called off. Pausing
 * again renews the deadline, and so the notification. Its timer is here, where
 * core's own deadline timer is.
 */
function warnBeforeDeadline(id, transfer, deadline) {
    const { pauseEnding } = transfer;
    if (deadline === pauseEnding.deadline) return;
    clearTimeout(pauseEnding.timer);
    transfer.pauseEnding = { timer: null, deadline };
    if (deadline === null) return;
    const wait = Math.max(0, deadline - PAUSE_WARNING_MS - Date.now());
    transfer.pauseEnding.timer = setTimeout(() => engine.pauseEnding(id, deadline), wait);
}

/** Pause or resume a transfer; the answer is core's reason when it couldn't, or nothing. */
async function pauseOrResume({ id, call }, pause) {
    const transfer = running.get(id);
    let value = {};
    if (transfer) {
        const { operation } = transfer;
        try {
            await (pause ? operation.pause() : operation.resume());
        } catch (error) {
            // It moved on before the click landed: it's finishing, or a pause is already settling.
            const ended = !GOING.includes(operation.snapshot.status);
            if (!ended && !DropgateError.is(error, 'PAUSE_UNAVAILABLE')) {
                // The server refused the pause, or couldn't be asked to resume: nothing changed.
                value = { message: error?.message || (pause ? "It couldn't be paused." : "It couldn't be resumed.") };
            }
        } finally {
            // The buttons, as it is now: a click disabled its own.
            if (running.get(id) === transfer) send(id, transfer, operation.snapshot, { now: true });
        }
    }
    engine.answer(call, value);
}

engine.onPause((work) => pauseOrResume(work, true));
engine.onResume((work) => pauseOrResume(work, false));
engine.onCancel(({ id }) => running.get(id)?.operation.cancel());

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

// Its card is gone: so is its manage token, or its link.
engine.onForget(({ id }) => {
    finished.delete(id);
    links.delete(id);
});

// The app is quitting: every finished upload's manage token and every
// download's link are forgotten, every transfer is cancelled (an upload's
// server asked to drop it, a download's file deleted and its lease
// released), and main is answered once they've all ended and every request
// still going has finished: the ones telling the servers among them. Nothing
// here outlives the app.
engine.onQuit(async ({ call }) => {
    finished.clear();
    links.clear();
    // Each transfer's own operation: a check makes a new client, so a transfer's may no longer be in clients.
    const operations = [...running.values()].map(({ operation }) => operation);
    for (const operation of operations) operation.cancel();
    await Promise.allSettled(operations.map((operation) => operation.result));
    while (requests.size > 0) await Promise.allSettled([...requests]);
    engine.answer(call, {});
});

// Ready: main hands over the file service's port, then the work waiting.
started = engine.ready();
