'use strict';

const { randomUUID } = require('crypto');

// Main's registry of transfers (17 §4): every upload the app makes, a
// window's own or Share with Dropgate's, by the ID main made, in the order
// added, in memory only. Up to `atOnce` run at once; the rest wait as queued,
// and start in the order added as places free. A paused one takes no place:
// resumed with none free, it waits as queued, and is resumed when one frees.
//
// A transfer's states here: waiting (made, not started: it waits for Upload,
// and can still take more files and new options), queued, running (in the
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
     * A transfer, waiting to start.
     * @param {{ kind?: 'upload', owner: number | null, share?: boolean, server?: object, files: object[], options: object }} fields
     * @returns {any} the transfer, with its new ID
     */
    add(fields) {
        const card = { id: randomUUID(), kind: 'upload', ...fields, state: 'waiting', started: false, snapshot: null, resumeWhenFree: false, resuming: false, link: null, message: null, deletable: false };
        this.#cards.set(card.id, card);
        this.changed(card);
        return card;
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

    /** How many run, are paused, and are queued. */
    counts() {
        const counts = { running: 0, paused: 0, queued: 0 };
        for (const { state } of this.#cards.values()) if (Object.hasOwn(counts, state)) counts[state]++;
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
     * @param {{ status: 'success', link: string } | { status: 'cancelled' } | { status: 'error', error: string }} outcome
     */
    ended(id, outcome) {
        const card = this.#cards.get(id);
        if (!card || ENDED.includes(card.state)) return null;
        card.link = outcome.status === 'success' ? outcome.link : null;
        card.message = outcome.status === 'error' ? outcome.error : null;
        // A finished upload's manage token stays in the transfer window, for its Delete.
        card.deletable = outcome.status === 'success';
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
        if (!card || card.state !== 'waiting') return null;
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
     * and the files it keeps (by their indexes, in order). Returns it, or null
     * when it isn't waiting any more (it has started: its options are sealed).
     * @param {string} id
     * @param {{ lifetime?: { value: number, unit: string }, maxDownloads?: number, files?: number[] }} options
     */
    setOptions(id, { lifetime, maxDownloads, files }) {
        const card = this.#cards.get(id);
        if (!card || card.state !== 'waiting') return null;
        if (files && files.some((index) => index >= card.files.length)) return null;
        if (lifetime) card.options.lifetime = { value: lifetime.value, unit: lifetime.unit };
        if (maxDownloads !== undefined) card.options.maxDownloads = maxDownloads;
        if (files) card.files = files.map((index) => card.files[index]);
        this.changed(card);
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
            if (!card || !(card.state === 'waiting' || ENDED.includes(card.state))) continue;
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
        if (!card || !['failed', 'cancelled'].includes(card.state)) return null;
        Object.assign(card, { owner, started: false, snapshot: null, link: null, message: null, resumeWhenFree: false, resuming: false, deletable: false });
        delete card.ask;
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
            ? { lifetime: { ...card.options.lifetime }, maxDownloads: card.options.maxDownloads, encrypt: card.options.encrypt ?? null }
            : null,
        link: card.link,
        message: card.message,
        canDelete: card.state === 'done' && card.deletable === true,
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

module.exports = { Transfers, Pacer, view, GOING, ENDED };
