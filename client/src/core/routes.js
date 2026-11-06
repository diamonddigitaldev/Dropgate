'use strict';

const { execFile } = require('child_process');

// Linux's route check. Linux uses the weak host model: a socket bound to one
// adapter's address can still leave through another adapter, wherever the
// kernel routes its destination (a SYN from a VPN's address out of the LAN's
// adapter). Node has no SO_BINDTODEVICE, so before each connection and each
// DNS query the network service asks the kernel which adapter the
// destination's route from that address goes through (`ip route get <dst>
// from <src>`, about 2 ms), and refuses it unless it's the chosen adapter.
// `ip route get … from …` follows the policy rules for that source too. An
// answer that can't be read, or no `ip` at all, is a refusal.

/** How long an answer is kept: a few seconds, and cleared whenever the adapters change. */
const ROUTE_CACHE_MS = 5_000;

/** How long `ip` is given to answer. */
const ROUTE_TIMEOUT_MS = 2_000;

/**
 * The adapter `ip route get`'s answer names: "10.0.0.2 from 10.0.0.1 dev eth0
 * uid 1000 \n cache", or "local 127.0.0.2 from 127.0.0.3 dev lo table local …".
 * @param {string} output
 * @returns {string | null}
 */
function deviceOf(output) {
    return /(?:^|\s)dev\s+(\S+)/.exec(output)?.[1] ?? null;
}

/** Ask the kernel itself: `ip route get <dst> from <src>`, its output, or null if it refused or couldn't run. */
function askIp(destination, source) {
    return new Promise((resolve) => {
        execFile('ip', ['route', 'get', destination, 'from', source], { timeout: ROUTE_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
            resolve(error ? null : String(stdout));
        });
    });
}

class RouteCheck {
    /**
     * @param {object} [options]
     * @param {(destination: string, source: string) => Promise<string | null>} [options.ask] - `ip route get`, unless a test stands one in
     * @param {number} [options.cacheMs]
     * @param {() => number} [options.now]
     */
    constructor({ ask = askIp, cacheMs = ROUTE_CACHE_MS, now = Date.now } = {}) {
        this.ask = ask;
        this.cacheMs = cacheMs;
        this.now = now;
        /** @type {Map<string, { device: string | null, until: number }>} */
        this.answers = new Map();
    }

    /**
     * Whether the kernel routes a destination, from this source, through this adapter.
     * @param {string} destination - an IP address
     * @param {string} source - the adapter's address
     * @param {string} adapter - its name
     */
    async through(destination, source, adapter) {
        const key = `${destination} ${source}`;
        let answer = this.answers.get(key);
        if (!answer || answer.until <= this.now()) {
            const output = await this.ask(destination, source).catch(() => null);
            answer = { device: output === null ? null : deviceOf(output), until: this.now() + this.cacheMs };
            this.answers.set(key, answer);
        }
        return answer.device !== null && answer.device === adapter;
    }

    /** Forget every answer: the adapters, or their addresses, have changed. */
    clear() {
        this.answers.clear();
    }
}

module.exports = { RouteCheck, deviceOf, ROUTE_CACHE_MS };
