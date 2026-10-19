'use strict';

const { randomUUID } = require('crypto');

// The saved servers (17 §8, §9): the list uploads go to, in order (the order a
// fallback tries them in, phase 14's piece 4), and which one is the default,
// which a new upload and Share with Dropgate start on. Each is kept in the
// kit's settings as { id, url, name, lifetime: { value, unit }, maxDownloads,
// allowFallback }: its ID (a UUID made here), its address as the client reads
// it, its name, and its settings for new uploads. Nothing a check found
// (whether it was there, its version, its limits) is ever kept: that's in
// memory only. Main alone changes the list: the page asks it to.
//
// Kept apart from Electron, so the client's tests can drive it.

/**
 * A new server's settings for new uploads (Will, 2026-10-19): v3's defaults,
 * held to the server's limits: 24 hours, or its lifetime limit where that's
 * shorter; 1 download; Allow Fallback off.
 */
const NEW_SERVER = Object.freeze({ lifetime: Object.freeze({ value: 24, unit: 'hours' }), maxDownloads: 1, allowFallback: false });

/** The longest name a server may give itself: one longer is shown by its host. */
const MAX_NAME = 100;

/** A saved server's keys: nothing else is ever kept. */
const SERVER_KEYS = Object.freeze(['id', 'url', 'name', 'lifetime', 'maxDownloads', 'allowFallback']);

/** A server's name, until it gives its own: its address's host, as typed (one with no scheme is HTTPS). */
function hostOf(url) {
    try {
        return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`).host || url;
    } catch {
        return url;
    }
}

/**
 * A new saved server: its address, its name (the one it gives, or its host),
 * and the settings for new uploads it starts with (NEW_SERVER), within the
 * limits it gave as it was checked.
 * @param {string} url - Its address as the client reads it.
 * @param {{ name?: string, capabilities?: { upload?: { maxLifetimeHours?: number } } } | null} [serverInfo] - What its check found.
 */
function newServer(url, serverInfo = null) {
    const limitHours = serverInfo?.capabilities?.upload?.maxLifetimeHours;
    const shorter = Number.isFinite(limitHours) && limitHours > 0 && limitHours < NEW_SERVER.lifetime.value;
    const own = typeof serverInfo?.name === 'string' ? serverInfo.name.trim() : '';
    const name = own && own.length <= MAX_NAME ? own : hostOf(url);
    return {
        id: randomUUID(),
        url,
        name,
        lifetime: shorter ? { value: limitHours, unit: 'hours' } : { ...NEW_SERVER.lifetime },
        maxDownloads: NEW_SERVER.maxDownloads,
        allowFallback: NEW_SERVER.allowFallback,
    };
}

/**
 * Settings version 3's servers, from version 2's (or 1's): the one server,
 * with its settings for new uploads as they were, becomes the first saved
 * server, and the default. None was given: the list is empty.
 * @param {{ serverURL?: unknown, lifetimeValue?: unknown, lifetimeUnit?: unknown, maxDownloads?: unknown }} settings
 * @returns {{ servers: object[], defaultServer: string | null }}
 */
function serversFrom({ serverURL, lifetimeValue, lifetimeUnit, maxDownloads }) {
    const url = typeof serverURL === 'string' ? serverURL.trim() : '';
    if (!url) return { servers: [], defaultServer: null };
    const server = newServer(url);
    const units = ['minutes', 'hours', 'days', 'unlimited'];
    if (units.includes(lifetimeUnit)) {
        if (lifetimeUnit === 'unlimited') server.lifetime = { value: 0, unit: 'unlimited' };
        else if (Number.isFinite(lifetimeValue) && lifetimeValue > 0) server.lifetime = { value: lifetimeValue, unit: lifetimeUnit };
    }
    if (Number.isSafeInteger(maxDownloads) && maxDownloads >= 0) server.maxDownloads = maxDownloads;
    return { servers: [server], defaultServer: server.id };
}

/**
 * The saved servers, as main keeps them in the kit's settings: read from
 * there each time, and written back whole as each change is made.
 */
class Servers {
    /**
     * @param {object} settings - The kit's settings: get() and set(changes).
     */
    constructor(settings) {
        this.settings = settings;
    }

    /** Every saved server, in order, and the default's ID (null with none). */
    list() {
        const { servers, defaultServer } = this.settings.get();
        const saved = Array.isArray(servers) ? servers : [];
        return { servers: saved, defaultServer: saved.some((s) => s.id === defaultServer) ? defaultServer : saved[0]?.id ?? null };
    }

    /** A saved server, by its ID. */
    get(id) {
        return this.list().servers.find((server) => server.id === id) ?? null;
    }

    /** The default server: new uploads and Share with Dropgate start on it. Null with none saved. */
    default() {
        const { servers, defaultServer } = this.list();
        return servers.find((server) => server.id === defaultServer) ?? null;
    }

    /**
     * Add a server, checked first (its address as the client read it, and
     * what the check found). One already saved, by its address, is given back
     * as it is, never twice. The first saved is the default.
     * @param {string} url
     * @param {object | null} serverInfo
     * @returns {{ server: object, added: boolean }}
     */
    add(url, serverInfo) {
        const same = (server) => server.url.toLowerCase() === url.toLowerCase();
        const { servers, defaultServer } = this.list();
        const saved = servers.find(same);
        if (saved) return { server: saved, added: false };
        const server = newServer(url, serverInfo);
        this.#save([...servers, server], defaultServer ?? server.id);
        return { server, added: true };
    }

    /**
     * Remove a server: the default's place goes to the first left, if any.
     * @returns {boolean} whether it was saved
     */
    remove(id) {
        const { servers, defaultServer } = this.list();
        if (!servers.some((server) => server.id === id)) return false;
        const left = servers.filter((server) => server.id !== id);
        this.#save(left, defaultServer === id ? left[0]?.id ?? null : defaultServer);
        return true;
    }

    /**
     * Move a server up (-1) or down (1) in the order: the first can't go up,
     * nor the last down.
     * @returns {boolean} whether it moved
     */
    move(id, by) {
        const { servers, defaultServer } = this.list();
        const at = servers.findIndex((server) => server.id === id);
        const to = at + by;
        if (at < 0 || to < 0 || to >= servers.length) return false;
        const order = [...servers];
        [order[at], order[to]] = [order[to], order[at]];
        this.#save(order, defaultServer);
        return true;
    }

    /** Make a saved server the default. */
    setDefault(id) {
        const { servers } = this.list();
        if (!servers.some((server) => server.id === id)) return false;
        this.#save(servers, id);
        return true;
    }

    /**
     * A server's settings for new uploads: its file lifetime, download limit
     * and Allow Fallback, any of them. Uploads already made keep theirs.
     * @param {string} id
     * @param {{ lifetime?: { value: number, unit: string }, maxDownloads?: number, allowFallback?: boolean }} options
     */
    setOptions(id, { lifetime, maxDownloads, allowFallback }) {
        const { servers, defaultServer } = this.list();
        if (!servers.some((server) => server.id === id)) return false;
        this.#save(servers.map((server) => (server.id !== id ? server : {
            ...server,
            ...(lifetime ? { lifetime: { value: lifetime.unit === 'unlimited' ? 0 : lifetime.value, unit: lifetime.unit } } : {}),
            ...(maxDownloads === undefined ? {} : { maxDownloads }),
            ...(allowFallback === undefined ? {} : { allowFallback }),
        })), defaultServer);
        return true;
    }

    /** Write the list back whole: each server's own keys only, never anything a check found. */
    #save(servers, defaultServer) {
        const kept = servers.map((server) => Object.fromEntries(SERVER_KEYS.map((key) => [key, server[key]])));
        this.settings.set({ servers: kept, defaultServer });
    }
}

/**
 * What each saved server's last check found, by its ID, as the transfer
 * window answered it: whether it was there, its version, its capabilities and
 * limits, or why it couldn't be reached. In main's memory only, never
 * written: it goes when the server is removed, and when the app quits.
 */
class ServerChecks {
    #found = new Map();

    /** Keep a saved server's latest check, in place of the one before. */
    set(id, check) {
        this.#found.set(id, check);
    }

    get(id) {
        return this.#found.get(id) ?? null;
    }

    /** A removed server's check goes with it. */
    forget(id) {
        this.#found.delete(id);
    }

    /**
     * The checks of the servers given (those saved now), by ID: one not
     * checked since the app started has none.
     * @param {{ id: string }[]} servers
     */
    of(servers) {
        return Object.fromEntries(servers.filter(({ id }) => this.#found.has(id)).map(({ id }) => [id, this.#found.get(id)]));
    }
}

/** The server an upload or a check goes to: plain HTTP only for an address typed with http://. */
const serverOf = (url) => ({ url, allowInsecure: /^http:\/\//i.test(url) });

module.exports = { NEW_SERVER, SERVER_KEYS, ServerChecks, Servers, hostOf, newServer, serverOf, serversFrom };
