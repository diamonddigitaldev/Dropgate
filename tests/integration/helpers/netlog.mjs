// Chromium's net log for one run of the desktop app, for a failed test's report.
//
// The desktop fixtures launch the app with --log-net-log, so its network stack
// writes down everything it does, as it does it. Playwright only says how far a
// request got once some of an answer has arrived; this says where one that got
// none was held. describeNetLog() gives the proxy settings the app found, each
// time it looked for a proxy on its own (proxy auto-detection, with its DHCP and
// DNS lookups), and each request to the test's addresses: how long it waited for
// a proxy decision, when it connected, sent and had its answer, and how it ended.
// Names, times and error codes only. The log itself stays in the test's
// temporary folder, which is deleted with it.
import fs from 'node:fs';

/**
 * The log's constants and events. It's only valid JSON once the app has quit,
 * so it's read a line at a time: the constants on the first line, then one
 * event per line. While the app runs, the last line may be half written.
 * @param {string} file
 */
function readNetLog(file) {
    const [first, ...rest] = fs.readFileSync(file, 'utf8').split('\n');
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
 * What the app's network stack did, one line each, with times in ms from `since`.
 * @param {string} file - The net log.
 * @param {number} since - A time in ms since 1970.
 * @param {string[]} origins - The test's own addresses (the server's, and the TLS proxy's if there is one).
 */
export function describeNetLog(file, since, origins) {
    if (!fs.existsSync(file)) return '  (no net log)';
    const { constants, events } = readNetLog(file);
    const name = (table, value) => Object.keys(constants[table]).find((key) => constants[table][key] === value) ?? String(value);
    const type = (e) => name('logEventTypes', e.type);
    const errorName = (code) => `${name('netError', code)} (${code})`;
    const offset = Number(constants.timeTickOffset);
    const ms = (e) => `+${Math.round(Number(e.time) + offset - since)} ms`;
    const took = (a, b) => `${Number(b.time) - Number(a.time)} ms`;

    const sources = new Map();
    for (const e of events) {
        if (!sources.has(e.source.id)) sources.set(e.source.id, { kind: name('logSourceType', e.source.type), events: [] });
        sources.get(e.source.id).events.push(e);
    }
    const begin = constants.logEventPhase.PHASE_BEGIN;
    const end = constants.logEventPhase.PHASE_END;
    /** The first begin and the next end of an event type in a list, if they're there. */
    const span = (list, kind) => {
        const b = list.find((e) => type(e) === kind && e.phase === begin);
        const en = b && list.find((e) => type(e) === kind && e.phase === end && Number(e.time) >= Number(b.time));
        return { b, e: en };
    };

    const lines = [];
    for (const e of events) {
        if (type(e) === 'PROXY_CONFIG_CHANGED') lines.push({ at: e, text: `proxy settings: ${JSON.stringify(e.params?.new_config ?? {})}` });
    }
    for (const { kind, events: list } of sources.values()) {
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
        const whole = e ? `took ${took(b, e)}` : 'still running';
        lines.push({ at: b, text: `proxy auto-detection ${whole}: ${steps.map((s) => s.text).join('; ') || 'no steps'}` });
    }

    // Each request to the test's addresses, with the stream job it was bound to (where the proxy is decided).
    const controllers = [...sources.values()].filter((s) => s.kind === 'HTTP_STREAM_JOB_CONTROLLER');
    for (const [id, { kind, events: list }] of sources) {
        if (kind !== 'URL_REQUEST') continue;
        const url = list.find((e) => e.params?.url)?.params.url;
        if (!url || !origins.some((origin) => url.startsWith(origin))) continue;
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
        if (alive.e) {
            const error = alive.e.params?.net_error;
            parts.push(error ? `ended at ${ms(alive.e)} with ${errorName(error)}` : `done at ${ms(alive.e)}`);
        } else {
            parts.push('not ended');
        }
        const method = list.find((e) => e.params?.method)?.params.method ?? '';
        lines.push({ at: alive.b, text: `${method} ${url}: ${parts.join(', ')}`.trim() });
    }

    lines.sort((a, b) => Number(a.at.time) - Number(b.at.time));
    return lines.map(({ at, text }) => `  ${ms(at)}  ${text}`).join('\n') || '  nothing';
}
