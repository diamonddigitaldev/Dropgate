'use strict';

const net = require('net');
const { NETWORK } = require('../constants');
const { firstStunUrl, stunTargetOf } = require('./stun');

// The External IP and the connection's health, as main holds them, with no
// Electron. The check is off by default. Once on, it asks the default saved
// server's STUN server, as that server's last check this run listed it: at launch
// (as soon as there's a check to read), when the network changes (with an adapter
// chosen, its addresses; with none, any adapter's), and on Check Again. Turning
// it on is the person asking, so that asks too. Nothing asks on a timer.
//
// What comes back stays in main's memory: it's never written or logged, and it
// goes when the switch is turned off, when the adapter goes, and with the app.
// So does each address's country and ISP, which the service looked up on the
// machine: the service's word is checked here, as any of its is.

/** The OS's name, as every sentence says it. */
const OS_NAME = process.platform === 'win32' ? 'Windows' : 'Linux';

/** The longest a country's name or an ISP's may be: the databases' are well under it. */
const MAX_PLACE_TEXT = 200;

/** A country's name or an ISP's, or null for anything else. */
const placeText = (value) => (typeof value === 'string' && value.trim() !== '' && value.length <= MAX_PLACE_TEXT ? value.trim() : null);

/**
 * What the service said of one address, with only what it should have said:
 * its country code (two capitals, which also name its flag's file), the country's
 * name, the ISP (the AS organisation) and the AS number. Null with nothing left.
 * @param {any} place
 * @returns {{ code: string | null, country: string | null, isp: string | null, asn: number | null } | null}
 */
function placeFrom(place) {
    const held = {
        code: typeof place?.code === 'string' && /^[A-Z]{2}$/.test(place.code) ? place.code : null,
        country: placeText(place?.country),
        isp: placeText(place?.isp),
        asn: Number.isSafeInteger(place?.asn) && place.asn > 0 ? place.asn : null,
    };
    return Object.values(held).some((value) => value !== null) ? held : null;
}

/**
 * The warning when the IPv4 and IPv6 addresses are in different countries, not
 * saying which is outside a VPN: either could be. Null otherwise, and when
 * either's country isn't known.
 * @param {{ places?: { v4: { code: string | null } | null, v6: { code: string | null } | null } } | null} result
 * @returns {string | null}
 */
function countryWarningOf(result) {
    const [v4, v6] = [result?.places?.v4?.code, result?.places?.v6?.code];
    if (!v4 || !v6 || v4 === v6) return null;
    return `Your IPv4 and IPv6 addresses are in different countries (${v4} and ${v6}), so one of them may not be going through your VPN.`;
}

/**
 * Where the External IP is asked, from the default server's last check this
 * run: its stun: URL and that URL's host, or why there's none. `waits`: a later
 * check of the default could change that, and then the launch's check goes.
 * `unchecked`: no reason to give yet, as it's simply not been checked.
 * @param {{ name: string } | null} server - The default saved server, or none.
 * @param {any} check - Its last check this run, or none.
 * @returns {{ url: string, stun: string, server: string } | { reason: string, waits: boolean, server: string | null, unchecked?: true }}
 */
function stunSourceOf(server, check) {
    if (!server) return { reason: "There's no saved server, so there's no STUN server to ask.", waits: true, server: null };
    const { name } = server;
    if (!check) return { reason: `${name} hasn't been checked yet, so its STUN server isn't known.`, waits: true, unchecked: true, server: name };
    if (!check.ok) return { reason: `${name} couldn't be reached, so its STUN server isn't known.`, waits: true, server: name };
    const p2p = check.serverInfo?.capabilities?.p2p;
    const url = firstStunUrl(p2p?.iceServers);
    if (!url) {
        const why = p2p?.enabled ? '' : ' (it has direct transfers off)';
        return { reason: `${name} lists no STUN server${why}, so there's nothing to ask.`, waits: false, server: name };
    }
    return { url, stun: stunTargetOf(url).host, server: name };
}

/**
 * The connection's health, in a status line's terms:
 * - red: the OS says offline, or the adapter chosen is gone;
 * - yellow: online, but the check (while it's on) failed or hasn't run;
 * - green: online, the adapter chosen there, and the check (while it's on) answered.
 * Blue, for the moment it's being found out.
 * @param {object} now
 * @param {boolean} now.online - net.isOnline()
 * @param {string | null} now.name - The adapter chosen.
 * @param {boolean | null} now.present - Whether it's there: null until the service has said.
 * @param {boolean} now.on - Whether the check is on.
 * @param {boolean} now.checking
 * @param {{ ok: boolean, reason?: string } | null} now.result
 * @param {string | null} [now.stun]
 * @param {string} [os]
 * @returns {{ tone: 'success' | 'warning' | 'danger' | 'running', text: string, title: string }}
 */
function healthOf({ online, name, present, on, checking, result, stun = null }, os = OS_NAME) {
    if (!online) return { tone: 'danger', text: 'Offline', title: `${os} says this computer has no network connection.` };
    if (name !== null && present === false) {
        return { tone: 'danger', text: `${name} isn't connected`, title: `Dropgate is set to use only ${name} (Settings > Network), so it connects through nothing until it's back.` };
    }
    if (name !== null && present === null) return { tone: 'running', text: 'Checking…', title: `Finding out whether ${name} is connected.` };
    if (on && checking) return { tone: 'running', text: 'Checking your External IP…', title: stun ? `Asking ${stun} for your address.` : 'Asking for your address.' };
    if (on && !result) return { tone: 'warning', text: 'Connected · External IP Not Checked Yet', title: "Your External IP hasn't been checked since the app started." };
    if (on && !result.ok) return { tone: 'warning', text: 'Connected · External IP Unavailable', title: result.reason };
    if (name !== null) return { tone: 'success', text: `Connected through ${name}`, title: `Connected. Dropgate uses only ${name}.` };
    return { tone: 'success', text: 'Connected', title: `Connected, through whichever adapter ${os} chooses.` };
}

class ExternalIp {
    /**
     * @param {object} options
     * @param {() => ReturnType<typeof stunSourceOf>} options.source - Where to ask, now.
     * @param {() => boolean} options.isOnline
     * @param {() => string | null} options.via - The adapter chosen, now: what a result says it went through.
     * @param {(request: { id: number, stun: string }) => void} options.send - Ask the network service.
     * @param {() => void} [options.changed]
     * @param {() => number} [options.now]
     * @param {number} [options.settleMs]
     */
    constructor({ source, isOnline, via, send, changed = () => {}, now = Date.now, settleMs = NETWORK.IP_SETTLE_MS }) {
        this.source = source;
        this.isOnline = isOnline;
        this.via = via;
        this.send = send;
        this.changed = changed;
        this.now = now;
        this.settleMs = settleMs;
        this.on = false;
        this.checking = false;
        /** The last answer: in memory only. */
        this.result = null;
        /** What the network is now, as a string to compare; null while it can't carry anything. */
        this.network = null;
        /** What it was when last asked: the same again asks nothing. */
        this.askedOf = null;
        /** Waiting for a check of the default server to know where to ask. */
        this.waiting = false;
        /** The request under way: its ID, the STUN server's host and the adapter it went through. */
        this.asking = null;
        this.ids = 0;
        this.timer = null;
    }

    /** Stop what's coming: a request's answer, once heard, is dropped. */
    stopAsking() {
        clearTimeout(this.timer);
        this.timer = null;
        this.asking = null;
        this.checking = false;
    }

    /** The switch: on, it asks now, if it can; off, everything known goes. */
    setOn(on) {
        if (on === this.on) return;
        this.on = on;
        this.stopAsking();
        this.result = null;
        this.askedOf = null;
        this.waiting = false;
        if (on && this.network !== null) this.ask();
        else this.changed();
    }

    /**
     * What the network is now. Changed, it's asked again once it settles.
     * @param {string | null} network - Null while it can't carry anything.
     * @param {{ forget?: boolean }} [options] - Forget: the adapter went, so what was known went with it.
     */
    networkIs(network, { forget = false } = {}) {
        this.network = network;
        if (forget) {
            this.result = null;
            this.askedOf = null;
        }
        if (!this.on) return;
        if (network === null) {
            // Cut off mid-request, it's asked again when the network is back, whatever it comes back as.
            if (this.asking) this.askedOf = null;
            this.stopAsking();
            return;
        }
        if (network === this.askedOf) {
            // Back as it was before settling: what's known still holds, and nothing need be asked. A request under way goes on.
            if (this.timer) this.stopAsking();
            return;
        }
        this.stopAsking();
        this.checking = true;
        this.timer = setTimeout(() => this.ask(), this.settleMs);
    }

    /** The default server's been checked: what waited to know where to ask goes now. */
    serverChecked() {
        if (this.on && this.waiting && this.network !== null && !this.asking && !this.timer) this.ask();
    }

    /** Check Again: asked now, unless a request is under way or nothing could carry it. */
    checkAgain() {
        if (!this.on || this.network === null || this.asking || !this.isOnline()) return;
        this.ask();
    }

    /** Ask, or say why it can't. */
    ask() {
        this.stopAsking();
        this.waiting = false;
        if (!this.on || this.network === null || !this.isOnline()) {
            this.changed();
            return;
        }
        this.askedOf = this.network;
        const source = this.source();
        if (!source.url) {
            this.waiting = source.waits;
            this.result = source.unchecked ? null : { ok: false, reason: source.reason };
            this.changed();
            return;
        }
        this.ids += 1;
        this.asking = { id: this.ids, stun: source.stun, via: this.via() };
        this.checking = true;
        this.send({ id: this.ids, stun: source.url });
        this.changed();
    }

    /**
     * The network service's answer. One for a request since dropped is ignored.
     * @param {{ id: number, v4?: unknown, v6?: unknown, latency?: unknown, location?: any, error?: unknown }} answer
     */
    heard({ id, v4, v6, latency, location, error }) {
        if (!this.asking || id !== this.asking.id) return;
        const { stun, via } = this.asking;
        this.stopAsking();
        const ips = { v4: net.isIPv4(v4) ? v4 : null, v6: net.isIPv6(v6) ? v6 : null };
        if ((ips.v4 || ips.v6) && Number.isFinite(latency) && latency >= 0) {
            const places = { v4: ips.v4 ? placeFrom(location?.v4) : null, v6: ips.v6 ? placeFrom(location?.v6) : null };
            this.result = { ok: true, ...ips, latency, at: this.now(), via, stun, places };
        } else {
            const seconds = NETWORK.STUN_MS / 1000;
            this.result = { ok: false, reason: error === 'timeout' ? `${stun} didn't answer within ${seconds} seconds.` : `${stun} couldn't be reached.` };
        }
        this.changed();
    }

    /** What the window draws. */
    view() {
        const source = this.on ? this.source() : {};
        return {
            on: this.on,
            checking: this.on && this.checking,
            result: this.result,
            warning: countryWarningOf(this.result),
            stun: this.asking?.stun ?? source.stun ?? null,
            server: source.server ?? null,
        };
    }

    stop() {
        this.stopAsking();
    }
}

module.exports = { ExternalIp, OS_NAME, countryWarningOf, healthOf, placeFrom, stunSourceOf };
