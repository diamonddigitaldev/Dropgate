// Test-only preload: lets a test move the server's Date.now() forward over IPC,
// so time-based cleanup can be exercised without waiting for real minutes.
//
// Timers keep to the moved clock too. When the clock moves, every setInterval()
// that would have come due in the skipped time runs once, and then every
// setTimeout() that would have, in the order they were due, each finishing
// before the reply. So a sweep on a real one-minute interval, such as the
// expired-file cleanup, runs after a move of a minute or more, and an upload's
// deadline passes when the clock passes it.
const { promisify } = require('node:util');

const realNow = Date.now;
const realSetInterval = globalThis.setInterval;
const realSetTimeout = globalThis.setTimeout;
const realClearInterval = globalThis.clearInterval;
const realClearTimeout = globalThis.clearTimeout;
let offsetMs = 0;

Date.now = () => realNow() + offsetMs;

// Each live interval by its handle, with when it next comes due on the moved clock.
const intervals = new Map();

globalThis.setInterval = function setInterval(callback, ms, ...args) {
    // Node runs anything under 1 ms as 1 ms.
    const period = Math.max(1, Number(ms) || 0);
    const entry = { callback, args, period, due: Date.now() + period };
    const handle = realSetInterval(function tick() {
        entry.due = Date.now() + period;
        return callback.apply(this, args);
    }, ms);
    intervals.set(handle, entry);
    return handle;
};

// Each pending timeout by its handle, with when it comes due on the moved clock.
const timeouts = new Map();

globalThis.setTimeout = function setTimeout(callback, ms, ...args) {
    const entry = { callback, args, due: Date.now() + Math.max(1, Number(ms) || 0) };
    const handle = realSetTimeout(function fire() {
        timeouts.delete(handle);
        return callback.apply(this, args);
    }, ms);
    timeouts.set(handle, entry);
    return handle;
};
globalThis.setTimeout[promisify.custom] = realSetTimeout[promisify.custom];

// Node lets either one clear an interval or a timeout.
globalThis.clearInterval = function clearInterval(handle) {
    intervals.delete(handle);
    timeouts.delete(handle);
    return realClearInterval(handle);
};
globalThis.clearTimeout = function clearTimeout(handle) {
    intervals.delete(handle);
    timeouts.delete(handle);
    return realClearTimeout(handle);
};

process.on('message', async (msg) => {
    if (msg && msg.type === 'advance-clock') {
        offsetMs += msg.ms;
        const now = Date.now();
        const failures = [];
        for (const [handle, entry] of intervals) {
            if (entry.due > now) continue;
            entry.due = now + entry.period;
            try {
                await entry.callback.apply(handle, entry.args);
            } catch (err) {
                failures.push(err);
            }
        }
        const due = [...timeouts].filter(([, entry]) => entry.due <= now).sort(([, a], [, b]) => a.due - b.due);
        for (const [handle, entry] of due) {
            // Cleared by a timeout that ran before it.
            if (!timeouts.has(handle)) continue;
            timeouts.delete(handle);
            realClearTimeout(handle);
            try {
                await entry.callback.apply(handle, entry.args);
            } catch (err) {
                failures.push(err);
            }
        }
        process.send({ type: 'clock-advanced', offsetMs });
        // A timer that throws still takes the server down, as it would have without this clock.
        for (const err of failures) setImmediate(() => { throw err; });
    }
});
