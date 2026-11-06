'use strict';

const { randomUUID } = require('crypto');

// Main's registry of transfers (17 §4): every upload the app makes, a
// window's own or Share with Dropgate's, and every download, by the ID main
// made, in the order added, in memory only. Up to `atOnce` run at once,
// uploads and downloads together; the rest wait as queued, and start in the
// order added as places free. A paused one takes no place: resumed with none
// free, it waits as queued, and is resumed when one frees.
//
// A download starts out reading (its link's list of files, read with no
// lease, so the server counts nothing), then waits like an upload, with the
// folder it's saved to (Save to), and once done can be shown in its folder.
// A bundle's download saves all its files or those chosen (by index), as
// files in a folder of their own, or as one ZIP (Advanced Options), and once
// done that folder can be opened. It holds no link: the transfer window keeps
// that.
//
// A transfer's states here: reading (a download's list of files), waiting
// (made, not started: it waits for Upload or Download, and an upload can
// still take more files and new options), queued, running (in the
// transfer window, from its first step to its last), paused, and once it has
// ended, done, failed or cancelled, and a done upload deleted from its server,
// deleted. An ended one stays, with its link or its reason, until it's
// removed (Remove, Clear Finished) or the app quits; its place goes to the
// next queued as it ends. A failed or cancelled one can be tried again, and
// waits once more. A done upload can be deleted while the transfer window
// holds its manage token (deletable): from its end until its card is removed,
// unless the transfer window stopped first. Main never holds the token.
//
// It runs nothing itself: `start` and `resume` hand a transfer to the
// transfer window, and `changed` hears each change, for the window, the tray,
// the taskbar and the power-save blocker. Kept apart from Electron, so the
// client's tests can drive it.

/** The states a transfer is going in: these keep the app running, and Restart Now asks. */
const GOING = Object.freeze(['queued', 'running', 'paused']);

/** The states a transfer has once it has ended: it stays until it's removed. */
const ENDED = Object.freeze(['done', 'failed', 'cancelled', 'deleted']);

/** The state an outcome ends a transfer in. */
const ENDED_AS = Object.freeze({ success: 'done', error: 'failed', cancelled: 'cancelled' });

class Transfers {
    /** @type {Map<string, any>} */
    #cards = new Map();
    #closed = false;

    /**
     * @param {object} options
     * @param {number} options.atOnce - How many run at once.
     * @param {(card: any) => void} options.start - Start one in the transfer window.
     * @param {(card: any) => void} options.resume - Resume a paused one there, now that it has a place.
     * @param {(card: any) => void} [options.changed] - One changed: its state, or its snapshot.
     * @param {(card: any) => void} [options.removed] - One left: removed, or taken back.
     */
    constructor({ atOnce, start, resume, changed = () => {}, removed = () => {} }) {
        this.atOnce = atOnce;
        this.startOne = start;
        this.resumeOne = resume;
        this.changed = changed;
        this.removed = removed;
    }

    /**
     * A transfer, waiting to start: an upload, or a download reading its list of files.
     * An upload names the saved server it goes to (savedServer); where it goes
     * (server) is read from that as it starts, or a share's is given now.
     * @param {{ kind?: 'upload' | 'download', owner: number | null, share?: boolean, server?: object, savedServer?: object | null, files: object[], options: object | null, host?: string, saveTo?: object }} fields
     * @returns {any} the transfer, with its new ID
     */
    add(fields) {
        const kind = fields.kind ?? 'upload';
        const card = {
            id: randomUUID(), ...fields, kind, state: kind === 'download' ? 'reading' : 'waiting', started: false, snapshot: null,
            resumeWhenFree: false, resuming: false, link: null, message: null, deletable: false, ...(kind === 'download' ? { encrypted: null, saved: null, chosen: null, asZip: false } : {}),
        };
        this.#cards.set(card.id, card);
        this.changed(card);
        return card;
    }

    /**
     * A download's list of files is read: it waits for Download. Returns it,
     * or null when it isn't reading (it was removed, or the app is quitting).
     * @param {string} id
     * @param {{ files: { name: string, size: number }[], encrypted: boolean }} list
     */
    read(id, { files, encrypted }) {
        const card = this.#cards.get(id);
        if (!card || card.kind !== 'download' || card.state !== 'reading') return null;
        card.files = files.map(({ name, size }) => ({ name, size }));
        card.encrypted = encrypted;
        this.#set(card, 'waiting');
        return card;
    }

    /**
     * Where downloads waiting are saved: their Save to. Those not waiting keep theirs.
     * @param {string[]} ids
     * @param {{ folder: string, label: string }} saveTo
     */
    saveTo(ids, saveTo) {
        for (const id of ids) {
            const card = this.#cards.get(id);
            if (card?.kind !== 'download' || !['reading', 'waiting'].includes(card.state)) continue;
            card.saveTo = { ...saveTo };
            this.changed(card);
        }
    }

    /**
     * Advanced Options on a download waiting: which of its files it saves (by
     * their indexes, in order; all of them is null), and whether as one ZIP.
     * Returns it, or null when it isn't waiting any more (it has started).
     * @param {string} id
     * @param {{ files?: number[], asZip?: boolean }} choice
     */
    choose(id, { files, asZip }) {
        const card = this.#cards.get(id);
        if (!card || card.kind !== 'download' || card.state !== 'waiting') return null;
        if (files && files.some((index) => index >= card.files.length)) return null;
        if (files) card.chosen = files.length === card.files.length ? null : [...files];
        if (asZip !== undefined) card.asZip = asZip;
        this.changed(card);
        return card;
    }

    /** A finished download is in its folder, at this path (a bundle saved as files: its own folder): for Show in Folder or Open Folder. */
    saved(id, filePath) {
        const card = this.#cards.get(id);
        if (card?.kind === 'download') card.saved = filePath;
    }

    /** How many run at once changed (Settings > Transfers): more may start now. */
    setAtOnce(atOnce) {
        this.atOnce = atOnce;
        this.#pump();
    }

    get(id) {
        return this.#cards.get(id);
    }

    has(id) {
        return this.#cards.has(id);
    }

    /** Every transfer, in the order added. */
    list() {
        return [...this.#cards.values()];
    }

    /** How many run (and of them, how many are downloads), are paused, and are queued. */
    counts() {
        const counts = { running: 0, paused: 0, queued: 0, downloading: 0 };
        for (const { state, kind } of this.#cards.values()) {
            if (Object.hasOwn(counts, state)) counts[state]++;
            if (state === 'running' && kind === 'download') counts.downloading++;
        }
        return counts;
    }

    /** Whether any transfer runs, is paused or is queued. */
    busy() {
        return this.list().some((card) => GOING.includes(card.state));
    }

    /**
     * Start a waiting transfer: it's queued, and runs as soon as it has a place.
     * @param {string} id
     * @param {object} server - Where it goes, if it has no server of its own yet.
     */
    start(id, server) {
        const card = this.#cards.get(id);
        if (!card || card.state !== 'waiting') return;
        card.server ??= server;
        this.#set(card, 'queued');
        this.#pump();
    }

    /**
     * The transfer window's snapshot of a transfer: running, or paused (a paused
     * one frees its place). One queued to resume stays queued until it has one.
     */
    updated(id, snapshot) {
        const card = this.#cards.get(id);
        if (!card) return;
        card.snapshot = snapshot;
        if (card.state === 'queued') {
            this.changed(card);
            return;
        }
        // While a resume is asked of the server, core still says paused ("Resuming..."): its place is kept.
        this.#set(card, snapshot.status === 'paused' && !card.resuming ? 'paused' : 'running', { always: true });
        if (card.state === 'paused') this.#pump();
    }

    /**
     * The transfer window has answered a resume: done, it runs on; refused,
     * core's snapshot says paused again, and its place goes.
     */
    resumed(id) {
        const card = this.#cards.get(id);
        if (!card?.resuming) return;
        card.resuming = false;
        if (card.snapshot?.status === 'paused') this.updated(id, card.snapshot);
    }

    /**
     * Resume a paused transfer: true when it has a place and the transfer
     * window should be asked now; false when it waits as queued for one (or
     * isn't paused here).
     */
    resume(id) {
        const card = this.#cards.get(id);
        if (!card) return false;
        if (card.state !== 'paused') return card.state === 'running';
        if (this.counts().running >= this.atOnce) {
            card.resumeWhenFree = true;
            this.#set(card, 'queued');
            return false;
        }
        // Its place is kept from now, until the transfer window answers (resumed()).
        card.resuming = true;
        this.#set(card, 'running');
        return true;
    }

    /**
     * Pause a transfer: true when it's in the transfer window and should be
     * asked there; a paused one queued to resume just stays paused.
     */
    pause(id) {
        const card = this.#cards.get(id);
        if (!card) return false;
        if (card.state === 'queued' && card.resumeWhenFree) {
            card.resumeWhenFree = false;
            this.#set(card, 'paused');
            return false;
        }
        return card.state === 'running';
    }

    /**
     * Take back a transfer the transfer window never had, as if it had never
     * been made: a share declined, or a window's waiting one as the window
     * goes. Returns it, or null when it has started or ended.
     */
    withdraw(id) {
        const card = this.#cards.get(id);
        if (!card || card.started || ENDED.includes(card.state)) return null;
        this.#cards.delete(id);
        this.#pump();
        this.removed(card);
        return card;
    }

    /**
     * A transfer has ended: in the transfer window, or cancelled while queued.
     * It stays, done (with its link), failed (with its reason) or cancelled,
     * and its place goes to the next queued.
     * @param {string} id
     * @param {{ status: 'success', link: string } | { status: 'cancelled' } | { status: 'error', error: string, code?: string }} outcome
     */
    ended(id, outcome) {
        const card = this.#cards.get(id);
        if (!card || ENDED.includes(card.state)) return null;
        card.link = outcome.status === 'success' ? outcome.link ?? null : null;
        card.message = outcome.status === 'error' ? outcome.error : null;
        card.code = outcome.status === 'error' ? outcome.code ?? null : null;
        // A finished upload's manage token stays in the transfer window, for its Delete.
        card.deletable = outcome.status === 'success' && card.kind === 'upload';
        card.resumeWhenFree = false;
        card.resuming = false;
        this.#set(card, ENDED_AS[outcome.status], { always: true });
        this.#pump();
        return card;
    }

    /**
     * Files added to a waiting transfer (dropped onto its card): each one not
     * in it already, by its path. Returns how many were added and skipped, or
     * null when it isn't waiting any more (it has started: they make a new one).
     * @param {string} id
     * @param {{ path: string }[]} files
     */
    addFiles(id, files) {
        const card = this.#cards.get(id);
        if (!card || card.kind !== 'upload' || card.state !== 'waiting') return null;
        const known = new Set(card.files.map((file) => file.path));
        const fresh = files.filter((file) => {
            if (known.has(file.path)) return false;
            known.add(file.path);
            return true;
        });
        card.files.push(...fresh);
        if (fresh.length > 0) this.changed(card);
        return { added: fresh.length, skipped: files.length - fresh.length };
    }

    /**
     * Advanced Options on a waiting transfer: its lifetime and download limit,
     * its Allow Fallback, and the files it keeps (by their indexes, in order).
     * Returns it, or null when it isn't waiting any more (it has started: its
     * options are sealed).
     * @param {string} id
     * @param {{ lifetime?: { value: number, unit: string }, maxDownloads?: number, allowFallback?: boolean, files?: number[] }} options
     */
    setOptions(id, { lifetime, maxDownloads, allowFallback, files }) {
        const card = this.#cards.get(id);
        if (!card || card.kind !== 'upload' || card.state !== 'waiting') return null;
        if (files && files.some((index) => index >= card.files.length)) return null;
        if (lifetime) card.options.lifetime = { value: lifetime.value, unit: lifetime.unit };
        if (maxDownloads !== undefined) card.options.maxDownloads = maxDownloads;
        if (allowFallback !== undefined) card.options.allowFallback = allowFallback;
        if (files) card.files = files.map((index) => card.files[index]);
        this.changed(card);
        return card;
    }

    /**
     * An upload waiting goes to another saved server (its "To"): it takes
     * that server's settings for new uploads, and where it goes is read from
     * the server again as it starts. Returns it, or null when it isn't
     * waiting any more (it has started: its server is sealed).
     * @param {string} id
     * @param {{ id: string, name: string, host: string }} savedServer - The saved server, as the window names it.
     * @param {{ lifetime: { value: number, unit: string }, maxDownloads: number, allowFallback: boolean }} options - Its settings for new uploads.
     */
    setServer(id, savedServer, { lifetime, maxDownloads, allowFallback }) {
        const card = this.#cards.get(id);
        if (!card || card.kind !== 'upload' || card.state !== 'waiting') return null;
        card.savedServer = { ...savedServer };
        card.server = null;
        card.options = { ...card.options, lifetime: { value: lifetime.value, unit: lifetime.unit }, maxDownloads, allowFallback };
        this.changed(card);
        return card;
    }

    /**
     * An upload running that its server couldn't take, before any byte was
     * sent, while the next server is checked: it keeps its place, and says so
     * (`text`) until it moves on, is held for the window's answer, or fails.
     * Returns it, or null when it isn't running (cancelled meanwhile).
     * @param {string} id
     * @param {string} text
     */
    trying(id, text) {
        const card = this.#cards.get(id);
        if (!card || card.kind !== 'upload' || card.state !== 'running') return null;
        card.snapshot = { status: 'initializing', phase: 'fallback', text, canPause: false };
        this.changed(card);
        return card;
    }

    /**
     * The fallback: an upload running goes on at once to another saved server,
     * in its place, with what it goes there with: where it goes (server), its
     * options held to that server, and the server it was going to first
     * (movedFrom), which it keeps however often it moves.
     * Returns it, or null when it isn't running (cancelled meanwhile).
     * @param {string} id
     * @param {{ savedServer: object, server: object, options: object, from: { id: string, name: string, host: string } }} to
     */
    moveTo(id, { savedServer, server, options, from }) {
        const card = this.#cards.get(id);
        if (!card || card.kind !== 'upload' || card.state !== 'running') return null;
        Object.assign(card, { savedServer: { ...savedServer }, server: { ...server }, options: { ...card.options, ...options }, snapshot: null });
        card.movedFrom ??= { ...from };
        this.changed(card);
        this.startOne(card);
        return card;
    }

    /**
     * The fallback, where the next server would be a step down: an upload
     * running waits, its place given up, on that server, until the window
     * answers its question (ask): transfer:start goes on there, and anything
     * else stops it, as it was (ask.restore). Returns it, or null when it isn't
     * running (cancelled meanwhile).
     * @param {string} id
     * @param {{ savedServer: object, server: object, options: object, from: { id: string, name: string, host: string }, ask: object }} to
     */
    hold(id, { savedServer, server, options, from, ask }) {
        const card = this.#cards.get(id);
        if (!card || card.kind !== 'upload' || card.state !== 'running') return null;
        const restore = { savedServer: card.savedServer, server: card.server, options: { ...card.options }, movedFrom: card.movedFrom ?? null };
        Object.assign(card, {
            savedServer: { ...savedServer }, server: { ...server }, options: { ...card.options, ...options }, snapshot: null, started: false, ask: { ...ask, restore },
        });
        card.movedFrom ??= { ...from };
        this.#set(card, 'waiting');
        this.#pump();
        return card;
    }

    /**
     * A done upload was deleted from its server: its link no longer works,
     * so it's forgotten, and the transfer window has forgotten its token.
     */
    deleted(id) {
        const card = this.#cards.get(id);
        if (!card || card.state !== 'done') return null;
        card.link = null;
        card.deletable = false;
        this.#set(card, 'deleted');
        return card;
    }

    /** The transfer window stopped: the done uploads whose manage tokens it held can't be deleted from here any more. */
    tokensLost(ids) {
        for (const id of ids) {
            const card = this.#cards.get(id);
            if (!card?.deletable) continue;
            card.deletable = false;
            this.changed(card);
        }
    }

    /**
     * Remove transfers that are waiting or have ended (Remove, Clear
     * Finished). One queued, running or paused stays: it's cancelled instead.
     * Returns those removed.
     * @param {string[]} ids
     */
    remove(ids) {
        const removed = [];
        for (const id of ids) {
            const card = this.#cards.get(id);
            if (!card || !(['reading', 'waiting'].includes(card.state) || ENDED.includes(card.state))) continue;
            this.#cards.delete(id);
            removed.push(card);
            this.removed(card);
        }
        return removed;
    }

    /**
     * Try a failed or cancelled transfer again: it waits once more, for the
     * window that asked to start it, with its files, server and options as
     * they were. Returns it, or null when it can't be.
     * @param {string} id
     * @param {number} owner - The window that asked.
     */
    retry(id, owner) {
        const card = this.#cards.get(id);
        if (!card || !['failed', 'cancelled'].includes(card.state) || (card.kind === 'download' && card.files.length === 0)) return null;
        // An upload that fell back waits on the server it went to, which it now goes to first.
        Object.assign(card, { owner, started: false, snapshot: null, link: null, message: null, code: null, resumeWhenFree: false, resuming: false, deletable: false, movedFrom: null });
        // Nothing of a fallback before carries over: main's note of the server it fell from, or one still to make.
        delete card.ask;
        delete card.fellFrom;
        delete card.fallFrom;
        this.#set(card, 'waiting');
        return card;
    }

    /**
     * The app is quitting: nothing starts from now, and every transfer the
     * transfer window never had is taken back. Returns those.
     */
    close() {
        this.#closed = true;
        const unstarted = this.list().filter((card) => !card.started && !ENDED.includes(card.state));
        for (const card of unstarted) this.#cards.delete(card.id);
        return unstarted;
    }

    #set(card, state, { always = false } = {}) {
        if (card.state === state && !always) return;
        card.state = state;
        this.changed(card);
    }

    /** Start (or resume) the first queued, in the order added, while there's a place. */
    #pump() {
        while (!this.#closed && this.counts().running < this.atOnce) {
            const next = this.list().find((card) => card.state === 'queued');
            if (!next) return;
            this.#set(next, 'running');
            if (next.resumeWhenFree) {
                next.resumeWhenFree = false;
                next.resuming = true;
                this.resumeOne(next);
            } else {
                next.started = true;
                this.startOne(next);
            }
        }
    }
}

/** Whether a download is saved as files in a folder of its own: a bundle's, more than one file, not as a ZIP. */
const inFolder = (card) => card.kind === 'download' && !card.asZip && (card.chosen?.length ?? card.files.length) > 1;

/**
 * A transfer as the window draws it: its files' names and sizes (never a
 * path), its state and options, how it's going, from core's snapshot (which
 * names no file and holds no key), and once it has ended, its link or its
 * reason, and whether it can be deleted (never its manage token).
 */
function view(card) {
    const { snapshot } = card;
    return {
        id: card.id,
        kind: card.kind,
        state: card.state,
        files: card.files.map(({ name, size }) => ({ name, size })),
        status: snapshot?.status ?? null,
        step: snapshot?.text ?? null,
        phase: snapshot?.phase ?? null,
        percent: snapshot?.percent ?? null,
        fileIndex: snapshot?.fileIndex ?? null,
        canPause: snapshot?.canPause === true,
        deadline: snapshot?.deadline ?? null,
        options: card.options
            ? { lifetime: { ...card.options.lifetime }, maxDownloads: card.options.maxDownloads, encrypt: card.options.encrypt ?? null, allowFallback: card.options.allowFallback === true }
            : null,
        link: card.link,
        message: card.message,
        code: card.code ?? null,
        canDelete: card.state === 'done' && card.deletable === true,
        // An upload's: the saved server it goes to (its ID, name and host), or null with none saved when it was made.
        // And, once it has fallen back, the saved server it was going to first (movedFrom); and whether the
        // window is asking about it (a share to a server with no end-to-end encryption, or a step down), so
        // it isn't started from there meanwhile.
        ...(card.kind === 'upload' ? {
            server: card.savedServer ? { ...card.savedServer } : null,
            movedFrom: card.movedFrom ? { ...card.movedFrom } : null,
            asking: Boolean(card.ask),
        } : {}),
        // A download's: its server's host, whether it's encrypted (once read), where it's saved, the files it
        // saves (null for all) and whether as one ZIP, whether it's saved in a folder of its own, and whether
        // it can be shown there.
        ...(card.kind === 'download' ? {
            host: card.host,
            encrypted: card.encrypted,
            saveTo: card.saveTo ? { folder: card.saveTo.folder, label: card.saveTo.label } : null,
            chosen: card.chosen ? [...card.chosen] : null,
            asZip: card.asZip,
            inFolder: inFolder(card),
            canShow: card.state === 'done' && typeof card.saved === 'string',
        } : {}),
    };
}

/**
 * Pass each key's latest value on at most `perSecond` times a second: at
 * once when it's been long enough since the last, or else when it has been.
 * `flush()` passes on what's waiting now, and `drop()` forgets it.
 */
class Pacer {
    #last = new Map();
    #waiting = new Map();

    /**
     * @param {number} perSecond
     * @param {(key: string, value: any) => void} send
     * @param {{ now?: () => number, setTimeout?: typeof setTimeout, clearTimeout?: typeof clearTimeout }} [clock]
     */
    constructor(perSecond, send, clock = {}) {
        this.every = 1000 / perSecond;
        this.send = send;
        this.now = clock.now ?? Date.now;
        this.setTimer = clock.setTimeout ?? setTimeout;
        this.clearTimer = clock.clearTimeout ?? clearTimeout;
    }

    push(key, value) {
        const waiting = this.#waiting.get(key);
        const wait = (this.#last.get(key) ?? -Infinity) + this.every - this.now();
        if (wait <= 0 && !waiting) {
            this.#pass(key, value);
        } else if (waiting) {
            waiting.value = value;
        } else {
            this.#waiting.set(key, { value, timer: this.setTimer(() => this.flush(key), wait) });
        }
    }

    flush(key) {
        const waiting = this.#waiting.get(key);
        if (!waiting) return;
        this.clearTimer(waiting.timer);
        this.#waiting.delete(key);
        this.#pass(key, waiting.value);
    }

    drop(key) {
        const waiting = this.#waiting.get(key);
        if (waiting) this.clearTimer(waiting.timer);
        this.#waiting.delete(key);
        this.#last.delete(key);
    }

    #pass(key, value) {
        this.#last.set(key, this.now());
        this.send(key, value);
    }
}

module.exports = { Transfers, Pacer, view, inFolder, GOING, ENDED };
