'use strict';

const { randomUUID } = require('crypto');
const { countOf } = require('@diamonddigitaldev/electron-kit/format');

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

/** A saved server as an upload knows it, for the window to name: its ID, its name and its address's host. */
const uploadServerOf = (server) => ({ id: server.id, name: server.name, host: hostOf(server.url) });

/** Whether uploads go end-to-end encrypted to a server, as a check found it: it has it, and was reached over HTTPS. */
const encryptsBy = (check) => Boolean(check?.ok && check.serverInfo?.capabilities?.upload?.e2ee) && typeof check.baseUrl === 'string' && check.baseUrl.startsWith('https://');

// --- The fallback (phase 14) ---
// An upload that allows it (its Allow Fallback, from its server's) and that
// its server can't take before any byte is sent moves to the next saved
// server below, in the saved order, checked only then. A server that would be
// a step down (plain HTTP after HTTPS, not encrypted where it would have been,
// a shorter lifetime or fewer downloads than the upload asks for) is never
// used without the window asking. One too small for the upload can't take it,
// and is passed over. Main decides each move from its own checks, never from
// the page.

/** Core's codes for a server that can't take an upload, as it refuses one before any byte is sent: the fallback moves on from these alone. */
const FALLBACK_CODES = Object.freeze([
    'SERVER_UNREACHABLE', 'TIMED_OUT', 'CAPABILITY_UNSUPPORTED', 'FILE_TOO_LARGE', 'SERVER_FULL', 'LIFETIME_NOT_ALLOWED', 'VERSION_UNSUPPORTED', 'AUTH_REQUIRED',
]);

/** A file lifetime's units, in ms: payloads.js' LIFETIME_UNIT_MS (kept here, as servers.js needs nothing else of it). */
const UNIT_MS = Object.freeze({ minutes: 60_000, hours: 3_600_000, days: 86_400_000 });

/** What a server allows uploads, from a check that reached it: its capabilities' upload part, or null. */
const uploadsBy = (check) => (check?.ok && check.serverInfo?.version && check.serverInfo?.capabilities?.upload) || null;

/** A server's limits on a lifetime (in hours, 0 for none) and on downloads (0 for none), as its check said them. */
const limitsBy = (upload) => ({ hours: Number(upload.maxLifetimeHours) || 0, downloads: upload.maxFileDownloads ?? 1 });

/** Whether a lifetime is longer than a server allows: unlimited, or past its limit, in whole ms as the page reckons it. */
function lifetimeOutside(lifetime, limits) {
    if (limits.hours === 0) return false;
    const ms = lifetime.unit !== 'unlimited' && lifetime.value > 0 && UNIT_MS[lifetime.unit] ? Math.round(lifetime.value * UNIT_MS[lifetime.unit]) : 0;
    return ms === 0 || ms > limits.hours * 3_600_000;
}

/** Whether a download limit is more than a server allows: unlimited, or past its limit. */
const downloadsOutside = (n, limits) => limits.downloads > 0 && (n === 0 || n > limits.downloads);

/**
 * Whether a failed upload moves on: Allow Fallback on, refused before any
 * byte was sent (`begun` false: its server never took its start), for one of
 * the reasons a server can't take it.
 * @param {{ options: { allowFallback?: boolean } }} upload
 * @param {{ status: string, code?: string, begun?: boolean }} outcome
 */
const movesOn = (upload, outcome) => upload?.options?.allowFallback === true && outcome.status === 'error' && outcome.begun === false && FALLBACK_CODES.includes(outcome.code);

/**
 * Whether a server can take an upload, as its check found it, or why not:
 * reached, a Dropgate server this version works with, taking uploads, and big
 * enough for it; and, with `limits` (the server the upload was going to),
 * allowing its lifetime and download limit. With no check, it's not known:
 * the upload goes, and the server says.
 * @param {object | null} check
 * @param {{ files: { size: number }[], options: { lifetime: { value: number, unit: string }, maxDownloads: number } }} upload
 * @param {{ limits?: boolean }} [opts]
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function canTake(check, upload, { limits = false } = {}) {
    const no = (reason) => ({ ok: false, reason });
    if (!check) return { ok: true };
    if (!check.ok) return no(check.message || 'Could not connect to the server.');
    const info = check.serverInfo;
    if (!info?.version || !info?.capabilities) return no("Cannot determine the server's version or capabilities.");
    if (!check.dgup?.compatible) return no(check.dgup?.message || 'Server is not compatible.');
    const allows = info.capabilities.upload;
    if (!allows || allows.enabled === false) return no('File uploads are disabled on this server.');
    const size = upload.files.reduce((sum, file) => sum + file.size, 0);
    const maxMB = Number(allows.maxSizeMB);
    if (maxMB > 0 && size > maxMB * 1024 * 1024) return no(`This upload is over the server's limit of ${maxMB} MB.`);
    if (limits) {
        const bounds = limitsBy(allows);
        const hours = Number.isInteger(bounds.hours) ? countOf(bounds.hours, 'hour') : `${bounds.hours} hours`;
        if (lifetimeOutside(upload.options.lifetime, bounds)) return no(`The server keeps files up to ${hours}.`);
        if (downloadsOutside(upload.options.maxDownloads, bounds)) return no(`The server allows up to ${countOf(bounds.downloads, 'download')}.`);
    }
    return { ok: true };
}

/**
 * How moving an upload from its server to another would be a step down, as
 * each one's check found it: plain HTTP after HTTPS; not end-to-end encrypted,
 * where it would have been (its encrypt isn't the person's own false, said to
 * the Upload Security Warning); and the other's limits, where they're less
 * than the upload asks for. None of them: it moves without asking.
 * @param {{ url: string }} from - The saved server it was going to.
 * @param {{ url: string }} to - The one below.
 * @param {object} check - The one below's check.
 * @param {{ options: { lifetime: object, maxDownloads: number, encrypt?: boolean } }} upload
 * @returns {{ plain: boolean, unencrypted: boolean, lifetime: number | null, downloads: number | null }}
 *   lifetime and downloads: the other's limit, where the upload asks for more.
 */
function stepDowns(from, to, check, upload) {
    // An address with no scheme is HTTPS, as core reads it: only one typed with http:// is plain.
    const insecure = (url) => /^http:\/\//i.test(url);
    const plain = !insecure(from.url) && insecure(to.url);
    const limits = limitsBy(uploadsBy(check) ?? {});
    return {
        plain,
        unencrypted: upload.options.encrypt !== false && !encryptsBy(check),
        lifetime: lifetimeOutside(upload.options.lifetime, limits) ? limits.hours : null,
        downloads: downloadsOutside(upload.options.maxDownloads, limits) ? limits.downloads : null,
    };
}

/** Whether a step down is any at all. */
const anyStepDown = (steps) => steps.plain || steps.unencrypted || steps.lifetime !== null || steps.downloads !== null;

/**
 * An upload's options held to a server's limits: each one outside becomes its limit.
 * @param {{ lifetime: object, maxDownloads: number }} options
 * @param {object} check
 */
function heldTo(options, check) {
    const limits = limitsBy(uploadsBy(check) ?? {});
    return {
        lifetime: lifetimeOutside(options.lifetime, limits) ? { value: limits.hours, unit: 'hours' } : { ...options.lifetime },
        maxDownloads: downloadsOutside(options.maxDownloads, limits) ? limits.downloads : options.maxDownloads,
    };
}

/**
 * The saved servers an upload may fall back to from the one it was going to,
 * in the saved order: every one below it. None when that one isn't saved any
 * more (removed since), or is the last.
 * @param {{ id: string }[]} servers - Every saved server, in order.
 * @param {string} from - The ID of the one it was going to.
 */
function serversBelow(servers, from) {
    const at = servers.findIndex((server) => server.id === from);
    return at < 0 ? [] : servers.slice(at + 1);
}

module.exports = {
    FALLBACK_CODES, NEW_SERVER, SERVER_KEYS, ServerChecks, Servers, anyStepDown, canTake, encryptsBy, heldTo, hostOf, movesOn, newServer, serverOf, serversBelow, serversFrom,
    stepDowns, uploadServerOf,
};
