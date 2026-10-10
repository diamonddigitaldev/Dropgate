'use strict';

const { randomUUID } = require('crypto');

// Main's registry of transfers (17 §4): every upload the app makes, a
// window's own or Share with Dropgate's, by the ID main made, in the order
// added, in memory only. Up to `atOnce` run at once; the rest wait as queued,
// and start in the order added as places free. A paused one takes no place:
// resumed with none free, it waits as queued, and is resumed when one frees.
//
// A transfer's states here: waiting (made, not started), queued, running
// (in the transfer window, from its first step to its last) and paused. One
// that ends (done, failed, cancelled) leaves the registry as it ends: today's
// window keeps its link itself, and has no card to keep (phase 7, piece 4
// keeps them until they're removed).
//
// It runs nothing itself: `start` and `resume` hand a transfer to the
// transfer window, and `changed` hears each change, for the window, the tray,
// the taskbar and the power-save blocker. Kept apart from Electron, so the
// client's tests can drive it.

/** The states a transfer is going in: these keep the app running, and Restart Now asks. */
const GOING = Object.freeze(['queued', 'running', 'paused']);

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
     * @param {(card: any) => void} [options.removed] - One left: it ended, or was taken back.
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
        const card = { id: randomUUID(), kind: 'upload', ...fields, state: 'waiting', started: false, snapshot: null, resumeWhenFree: false, resuming: false };
        this.#cards.set(card.id, card);
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
     * Take back a transfer the transfer window never had: waiting, or queued
     * and never started. Returns it, or null when it's running there (cancel
     * it there instead).
     */
    withdraw(id) {
        const card = this.#cards.get(id);
        if (!card || card.started) return null;
        this.#cards.delete(id);
        this.#pump();
        this.removed(card);
        return card;
    }

    /** A transfer has ended in the transfer window: it leaves, and its place goes to the next queued. */
    ended(id) {
        const card = this.#cards.get(id);
        if (!card) return null;
        this.#cards.delete(id);
        this.#pump();
        this.removed(card);
        return card;
    }

    /**
     * The app is quitting: nothing starts from now, and every transfer the
     * transfer window never had is taken back. Returns those.
     */
    close() {
        this.#closed = true;
        const unstarted = this.list().filter((card) => !card.started);
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
 * path), its state, and how it's going, from core's snapshot (which names no
 * file and holds no key).
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

module.exports = { Transfers, Pacer, view, GOING };
