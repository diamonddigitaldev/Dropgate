// A paused transfer's deadline as the apps write it, and where a test's clock
// starts, so a check of it means the same at any hour.
//
// The Web UI and the desktop app (formatDeadline() in each) give a deadline as
// a local time, "2:35 PM", with " tomorrow" after it when it's the next day.
// With DROPGATE_TEST_CLOCK_AT=HH:MM, the tests that check one start their
// pages' clocks at that time instead of now: 23:45 puts a 30-minute deadline
// in tomorrow, whatever the hour the tests run.

const MINUTE = 60_000;

/**
 * The local time a deadline `minutes` from now is, and a minute after it, as
 * the page writes a paused transfer's deadline: with " tomorrow" when it's the
 * next day. Asked of the page, so it's the page's clock and locale. With
 * { timeOnly: true }, the time alone, as the desktop's notification gives it.
 * @param {import('@playwright/test').Page} page
 * @param {number} minutes
 * @param {{ timeOnly?: boolean }} [opts]
 * @returns {Promise<string[]>}
 */
export const deadlineTimes = (page, minutes, { timeOnly = false } = {}) => page.evaluate(({ ms, minute, timeOnly }) => {
    const now = new Date();
    return [ms, ms + minute].map((after) => {
        const at = new Date(now.getTime() + after);
        const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        return timeOnly || at.toDateString() === now.toDateString() ? time : `${time} tomorrow`;
    });
}, { ms: minutes * MINUTE, minute: MINUTE, timeOnly });

/**
 * When a test's clock starts if DROPGATE_TEST_CLOCK_AT is set: the next time
 * it's that time here. Always later than now, so the page's clock is ahead of
 * the server's, and the deadline it shows is the page's own: core gives the
 * later of the server's deadline and the pause length from the device's now.
 * @returns {Date | null}
 */
function clockStart() {
    const at = process.env.DROPGATE_TEST_CLOCK_AT;
    if (!at) return null;
    const [, hours, minutes] = /^(\d{1,2}):(\d{2})$/.exec(at) ?? [];
    if (hours === undefined) throw new Error(`DROPGATE_TEST_CLOCK_AT is a local time, HH:MM, not "${at}".`);
    const start = new Date();
    start.setHours(Number(hours), Number(minutes), 0, 0);
    if (start <= new Date()) start.setDate(start.getDate() + 1);
    return start;
}

/**
 * Install the clock of a page's context (every page in it) if the test moves
 * it, or if DROPGATE_TEST_CLOCK_AT says when it starts; otherwise leave the
 * real one. It goes on at its own pace from there.
 * @param {import('@playwright/test').Page} page
 * @param {{ moved?: boolean }} [opts]
 */
export async function installClock(page, { moved = false } = {}) {
    const time = clockStart();
    if (time) await page.clock.install({ time });
    else if (moved) await page.clock.install();
}
