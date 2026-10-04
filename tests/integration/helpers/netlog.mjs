// Chromium's net log for one run of a browser or the desktop app: for a failed
// desktop test's report, and to check that nothing a test starts looks for a
// proxy by itself, or looks up any name beyond this machine.
//
// The desktop fixtures launch the app with --log-net-log, so its network stack
// writes down everything it does, as it does it. Playwright only says how far a
// request got once some of an answer has arrived; this says where one that got
// none was held. describeNetLog() gives the proxy settings the app found, each
// time it looked for a proxy on its own (proxy auto-detection, with its DHCP and
// DNS lookups), and each request to the test's addresses: how long it waited for
// a proxy decision, when it connected, sent and had its answer, and how it ended.
// proxyLookups() gives only the times it looked for a proxy, which on a network
// with WPAD go out to that network, and outsideLookups() every DNS lookup of a
// name that isn't this machine's. Names, times and error codes only. The log
// itself stays in the test's temporary folder, which is deleted with it.
import fs from 'node:fs';

/**
 * The log's constants and events, or null for an empty log. It's only valid
 * JSON once the app has quit, so it's read a line at a time: the constants on
 * the first line, then one event per line. While the app runs, the last line may
 * be half written.
 * @param {string} file
 */
function readNetLog(file) {
    const text = fs.readFileSync(file, 'utf8');
    // A launch that only hands its arguments to the app already running quits
    // before its network stack starts, and leaves its log empty.
    if (!text) return null;
    const [first, ...rest] = text.split('\n');
    const { constants } = JSON.parse(`${first.replace(/,\s*$/, '')}}`);
    const events = [];
    for (const line of rest) {
        if (!line.startsWith('{"')) continue;
        try {
            events.push(JSON.parse(line.replace(/\]?,?\s*$/, '')));
        } catch {
            // The line still being written.
        }
    }
    return { constants, events };
}

/**
 * A net log, read for the functions below: its events, grouped by what they
 * belong to (their source), with ways to name and time them.
 * @param {{ constants: any, events: any[] }} log - What readNetLog() gave.
 */
function netLog({ constants, events }) {
    const name = (table, value) => Object.keys(constants[table]).find((key) => constants[table][key] === value) ?? String(value);
    const type = (e) => name('logEventTypes', e.type);
    const begin = constants.logEventPhase.PHASE_BEGIN;
    const end = constants.logEventPhase.PHASE_END;
    const sources = new Map();
    for (const e of events) {
        if (!sources.has(e.source.id)) sources.set(e.source.id, { kind: name('logSourceType', e.source.type), events: [] });
        sources.get(e.source.id).events.push(e);
    }
    return {
        events,
        sources,
        type,
        begin,
        end,
        errorName: (code) => `${name('netError', code)} (${code})`,
        /** When an event happened, in ms since 1970. */
        timeOf: (e) => Number(e.time) + Number(constants.timeTickOffset),
        took: (a, b) => `${Number(b.time) - Number(a.time)} ms`,
        phaseOf: (e) => ({ [begin]: 'began', [end]: 'ended' })[e.phase] ?? 'logged',
        /** The first begin and the next end of an event type in a list, if they're there. */
        span: (list, kind) => {
            const b = list.find((e) => type(e) === kind && e.phase === begin);
            const en = b && list.find((e) => type(e) === kind && e.phase === end && Number(e.time) >= Number(b.time));
            return { b, e: en };
        },
    };
}

/**
 * Each time the network stack looked for a proxy script (proxy auto-detection,
 * or a proxy script's address), with each place it looked, in order.
 * @param {ReturnType<typeof netLog>} log
 * @param {(e: any) => string} ms - How to give an event's time.
 * @returns {{ at: any, text: string }[]}
 */
function proxyScriptSearches(log, ms) {
    const { type, begin, end, took, errorName, span } = log;
    /** Where something that never finished got to: the last thing logged for it. */
    const lastStep = (e) => `its last step, ${type(e)}, ${log.phaseOf(e)} at ${ms(e)}`;
    const lines = [];
    for (const { kind, events: list } of log.sources.values()) {
        if (kind !== 'PAC_FILE_DECIDER') continue;
        const { b, e } = span(list, 'PAC_FILE_DECIDER');
        if (!b) continue;
        // Each place it looked, in order: WPAD over DHCP, then the name "wpad" in DNS, and so on.
        const steps = [];
        for (const step of ['PAC_FILE_DECIDER_FETCH_PAC_SCRIPT', 'HOST_RESOLVER_MANAGER_REQUEST', 'PAC_FILE_DECIDER_WAIT']) {
            for (const s of list.filter((x) => type(x) === step && x.phase === begin)) {
                const done = list.find((x) => type(x) === step && x.phase === end && Number(x.time) >= Number(s.time));
                const what = s.params?.source ?? s.params?.host ?? step.toLowerCase();
                const how = done ? `${took(s, done)}${done.params?.net_error ? `, ${errorName(done.params.net_error)}` : ''}` : 'unfinished';
                steps.push({ t: Number(s.time), text: `${what} ${how}` });
            }
        }
        steps.sort((x, y) => x.t - y.t);
        const whole = e ? `took ${took(b, e)}` : `still going (${lastStep(list.at(-1))})`;
        lines.push({ at: b, text: `looking for a proxy script ${whole}: ${steps.map((s) => s.text).join('; ') || 'no steps'}` });
    }
    return lines;
}

/** A host name WPAD looks up: "wpad", or "wpad" in a domain, with or without a port. */
const WPAD_HOST = /^(?:[a-z]+:\/\/)?wpad(?:[.:/]|$)/i;

/**
 * Each time the network stack looked for a proxy by itself, one line each, with
 * times in ms from the log's first event:
 * - proxy settings that tell it to (auto-detection, or a proxy script's address);
 * - each search for a proxy script, with where it looked;
 * - any other DNS lookup of the name "wpad".
 *
 * On a network with WPAD, each of these goes out to that network. An empty log
 * gives none: its network stack never started, so it couldn't look. No log at
 * all gives a line, as there's nothing to tell from.
 * @param {string} file - The net log.
 * @returns {string[]}
 */
export function proxyLookups(file) {
    if (!fs.existsSync(file)) return [`no net log at ${file}, so there's nothing to tell from`];
    const read = readNetLog(file);
    if (!read) return [];
    const log = netLog(read);
    const start = read.events.length ? log.timeOf(read.events[0]) : 0;
    const ms = (e) => `+${Math.round(log.timeOf(e) - start)} ms`;
    const lines = proxyScriptSearches(log, ms);
    for (const e of read.events) {
        const config = e.params?.new_config;
        if (log.type(e) === 'PROXY_CONFIG_CHANGED' && (config?.auto_detect || config?.pac_url)) {
            lines.push({ at: e, text: `proxy settings that look for a proxy: ${JSON.stringify(config)}` });
        }
    }
    // A search for a proxy script logs its own lookups, so these are any others.
    for (const { kind, events: list } of log.sources.values()) {
        if (kind === 'PAC_FILE_DECIDER') continue;
        for (const e of list) {
            if (log.type(e) === 'HOST_RESOLVER_MANAGER_REQUEST' && e.phase === log.begin && WPAD_HOST.test(e.params?.host ?? '')) {
                lines.push({ at: e, text: `a DNS lookup of ${e.params.host}` });
            }
        }
    }
    lines.sort((a, b) => Number(a.at.time) - Number(b.at.time));
    return lines.map(({ at, text }) => `${ms(at)}  ${text}`);
}

/** A name that never leaves this machine: loopback, or "localhost" itself. */
const LOCAL_HOST = /^(?:127(?:\.\d+){3}|localhost|\[?::1\]?)$/i;

/**
 * Each DNS lookup the network stack made of a name that isn't this machine's
 * own (127.x, localhost or ::1), one line each, with times in ms from the log's
 * first event. A lookup like that goes out to the network's DNS server, so a
 * test should never start one. An empty log gives none; no log at all gives a
 * line, as there's nothing to tell from.
 * @param {string} file - The net log.
 * @returns {string[]}
 */
export function outsideLookups(file) {
    if (!fs.existsSync(file)) return [`no net log at ${file}, so there's nothing to tell from`];
    return lookups(file)
        .filter(({ host }) => !LOCAL_HOST.test(/^(?:[a-z][a-z0-9+.-]*:\/\/)?(\[[^\]]*\]|[^:/]*)/i.exec(host)?.[1] ?? host))
        .map(({ at, host }) => `+${at} ms  a DNS lookup of ${host}`);
}

/**
 * Every host the network stack was asked to look up, in order, as the log gives
 * it: a scheme, host and port ("http://127.0.0.1:52443"), or a host and port.
 * @param {string} file - The net log.
 * @returns {string[]}
 */
export const hostLookups = (file) => (fs.existsSync(file) ? lookups(file).map(({ host }) => host) : []);

/** @returns {{ at: number, host: string }[]} Each lookup, with its time in ms from the log's first event. */
function lookups(file) {
    const read = readNetLog(file);
    if (!read) return [];
    const log = netLog(read);
    const start = read.events.length ? log.timeOf(read.events[0]) : 0;
    return read.events
        .filter((e) => log.type(e) === 'HOST_RESOLVER_MANAGER_REQUEST' && e.phase === log.begin)
        .map((e) => ({ at: Math.round(log.timeOf(e) - start), host: String(e.params?.host ?? '') }));
}

/**
 * The proxy settings the network stack found, one for each of its network
 * contexts, in order. A log with none recorded nothing a proxy check could go on.
 * @param {string} file - The net log.
 * @returns {object[]}
 */
export function proxySettings(file) {
    const read = fs.existsSync(file) && readNetLog(file);
    if (!read) return [];
    const log = netLog(read);
    return read.events.filter((e) => log.type(e) === 'PROXY_CONFIG_CHANGED').map((e) => e.params?.new_config ?? {});
}

/**
 * The address of every request in the log, in the order they began.
 * @param {string} file - The net log.
 * @returns {string[]}
 */
export function requestedUrls(file) {
    const read = fs.existsSync(file) && readNetLog(file);
    if (!read) return [];
    const log = netLog(read);
    return [...log.sources.values()]
        .filter(({ kind }) => kind === 'URL_REQUEST')
        .map(({ events: list }) => list.find((e) => e.params?.url)?.params.url)
        .filter(Boolean);
}

/**
 * Each request to the given addresses, with whether it could carry cookies:
 * its privacy mode as the log gives it. A request made with credentials
 * omitted goes in privacy mode, so the network stack never reads cookies for it,
 * and never waits for the cookie store to load from disk.
 * @param {string} file - The net log.
 * @param {string[]} origins - The addresses to look at.
 * @returns {{ method: string, url: string, privacyMode: string }[]}
 */
export function requestsTo(file, origins) {
    const read = fs.existsSync(file) && readNetLog(file);
    if (!read) return [];
    const log = netLog(read);
    const hosts = new Set(origins.map((origin) => new URL(origin).host));
    const requests = [];
    for (const { kind, events: list } of log.sources.values()) {
        if (kind !== 'URL_REQUEST') continue;
        const start = list.find((e) => log.type(e) === 'URL_REQUEST_START_JOB' && e.params?.url);
        if (!start || !hosts.has(new URL(start.params.url).host)) continue;
        const privacy = list.find((e) => log.type(e) === 'COMPUTED_PRIVACY_MODE');
        requests.push({ method: start.params.method ?? '', url: start.params.url, privacyMode: String(privacy?.params?.privacy_mode ?? 'not logged') });
    }
    return requests;
}

/**
 * Each time the cookie store started loading from disk, in ms from `since`.
 * @param {string} file - The net log.
 * @param {number} since - A time in ms since 1970.
 * @returns {number[]}
 */
export function cookieStoreLoads(file, since) {
    const read = fs.existsSync(file) && readNetLog(file);
    if (!read) return [];
    const log = netLog(read);
    return read.events
        .filter((e) => log.type(e) === 'COOKIE_PERSISTENT_STORE_LOAD' && e.phase === log.begin)
        .map((e) => Math.round(log.timeOf(e) - since));
}

/**
 * What the app's network stack did, one line each, with times in ms from `since`.
 * @param {string} file - The net log.
 * @param {number} since - A time in ms since 1970.
 * @param {string[]} origins - The test's own addresses (the server's, and the TLS proxy's if there is one).
 */
export function describeNetLog(file, since, origins) {
    if (!fs.existsSync(file)) return '  (no net log)';
    const read = readNetLog(file);
    if (!read) return '  (an empty net log: its network stack never started)';
    const log = netLog(read);
    const { events } = read;
    const { type, sources, errorName, took, phaseOf, span } = log;
    const ms = (e) => `+${Math.round(log.timeOf(e) - since)} ms`;
    /** Where something that never finished got to: the last thing logged for it. */
    const lastStep = (e) => `its last step, ${type(e)}, ${phaseOf(e)} at ${ms(e)}`;

    const lines = [];
    for (const e of events) {
        if (type(e) === 'PROXY_CONFIG_CHANGED') lines.push({ at: e, text: `proxy settings: ${JSON.stringify(e.params?.new_config ?? {})}` });
    }
    lines.push(...proxyScriptSearches(log, ms));

    // The cookie store on disk: a request reads cookies before anything else, so it waits for this.
    for (const { kind, events: list } of sources.values()) {
        if (kind !== 'COOKIE_STORE' || !list[0].params?.persistent_store) continue;
        const { b, e } = span(list, 'COOKIE_PERSISTENT_STORE_LOAD');
        if (!b) continue;
        const keys = list.filter((x) => type(x) === 'COOKIE_PERSISTENT_STORE_KEY_LOAD_COMPLETED')
            .map((x) => `${x.params?.domain ?? 'some'} at ${ms(x)}`);
        const load = e ? `took ${took(b, e)}` : `still going (${lastStep(list.at(-1))})`;
        lines.push({ at: b, text: `loading the cookie store from disk ${load}${keys.length ? `; cookies for ${keys.join(', ')}` : ''}` });
    }

    // Each request to the test's addresses, whatever its scheme (v3 retries https:// as http://),
    // with the stream job it was bound to, which is where the proxy is decided.
    const hosts = new Set(origins.map((origin) => new URL(origin).host));
    const controllers = [...sources.values()].filter((s) => s.kind === 'HTTP_STREAM_JOB_CONTROLLER');
    for (const [id, { kind, events: list }] of sources) {
        if (kind !== 'URL_REQUEST') continue;
        const url = list.find((e) => e.params?.url)?.params.url;
        if (!url || !hosts.has(new URL(url).host)) continue;
        const alive = span(list, 'REQUEST_ALIVE');
        if (!alive.b) continue;
        const parts = [];
        const bound = controllers.filter((c) => c.events.some((e) => type(e) === 'HTTP_STREAM_JOB_CONTROLLER_BOUND' && e.params?.source_dependency?.id === id));
        for (const c of bound) {
            const proxy = span(c.events, 'PROXY_RESOLUTION_SERVICE');
            if (proxy.b) parts.push(proxy.e ? `waited ${took(proxy.b, proxy.e)} for a proxy decision, from ${ms(proxy.b)}` : `waiting for a proxy decision since ${ms(proxy.b)}`);
        }
        const send = span(list, 'HTTP_TRANSACTION_SEND_REQUEST');
        if (send.b) parts.push(`sent at ${ms(send.b)}`);
        const headers = span(list, 'HTTP_TRANSACTION_READ_HEADERS');
        if (headers.e) parts.push(`answer's headers at ${ms(headers.e)}`);
        // A request its page gave up on is cancelled; one that failed ends with an error.
        const cancelled = list.findIndex((e) => type(e) === 'CANCELLED');
        const error = [...list].reverse().find((e) => e.params?.net_error < 0)?.params.net_error;
        if (cancelled > 0) parts.push(`cancelled at ${ms(list[cancelled])}, ${lastStep(list[cancelled - 1])}`);
        else if (alive.e && error) parts.push(`ended at ${ms(alive.e)} with ${errorName(error)}`);
        else if (alive.e) parts.push(`done at ${ms(alive.e)}`);
        else parts.push(`not ended, ${lastStep(list.at(-1))}`);
        // Where it was held: every gap of 100 ms or more between one step and the next.
        for (let i = 1; i < list.length; i++) {
            const gap = Number(list[i].time) - Number(list[i - 1].time);
            if (gap >= 100) parts.push(`held ${gap} ms after ${type(list[i - 1])} ${phaseOf(list[i - 1])}, until ${type(list[i])} ${phaseOf(list[i])} at ${ms(list[i])}`);
        }
        const method = list.find((e) => e.params?.method)?.params.method ?? '';
        lines.push({ at: alive.b, text: `${method} ${url}: ${parts.join(', ')}`.trim() });
    }

    lines.sort((a, b) => Number(a.at.time) - Number(b.at.time));
    return lines.map(({ at, text }) => `  ${ms(at)}  ${text}`).join('\n') || '  nothing';
}
