// A browser's own background checks mustn't reach beyond this machine either.
//
// Firefox checks for updates to its system add-ons, from aus5.mozilla.org, when
// its update timers first fire, about 30 seconds after it starts. Playwright
// turns Firefox's other updates off, but not that one, so the tests do
// (extensions.systemAddon.update.enabled, playwright.config.mjs). This keeps
// Firefox open, with the project's settings, until the add-on update timer has
// fired, then checks its DNS log for any name but this machine's.
//
// So that it can fail without sending anything, Firefox answers every name
// itself here, as if it were localhost (Mozilla's own test setting), and never
// asks the network: no DNS over HTTPS, and no HTTPS records from the system's
// resolver. Its log still names each lookup it starts.
//
// Chromium is launched with --disable-background-networking by Playwright, and
// its net log is checked for outside lookups in proxy-lookup.spec.mjs. WebKit
// keeps no log to check, and on GitHub's Ubuntu runner it looked up nothing of
// its own while the tests ran.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '../helpers/test.mjs';

// A hook rather than a file-level test.skip(), whose callback would start and
// stop a server of its own just to be asked.
test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'firefox', "Only Firefox's own background checks are checked here (see the top of this file)");
});

/** A name that never leaves this machine. */
const LOCAL_HOST = /^(?:127(?:\.\d+){3}|localhost|\[?::1\]?)$/i;

/** When the profile says the add-on update timer last fired, in seconds since 1970, or 0. */
function addonTimerFired(profile) {
    const file = path.join(profile, 'prefs.js');
    const prefs = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    return Number(/"app\.update\.lastUpdateTime\.addon-background-update-timer", (\d+)\)/.exec(prefs)?.[1] ?? 0);
}

/** Every name Firefox's DNS log says it started to look up, with how many times. */
function namesLookedUp(folder) {
    const names = new Map();
    for (const file of fs.readdirSync(folder).filter((name) => name.startsWith('firefox'))) {
        for (const [, name] of fs.readFileSync(path.join(folder, file), 'utf8').matchAll(/Resolving host \[([^\]]*)\]/g)) {
            names.set(name, (names.get(name) ?? 0) + 1);
        }
    }
    return names;
}

test("Firefox's background update checks look up nothing beyond this machine", async ({ playwright, launchOptions, server }) => {
    // Its update timers first fire about 30 seconds after it starts.
    test.setTimeout(120_000);
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dropgate-background-test-'));
    const profile = path.join(folder, 'profile');
    try {
        const context = await playwright.firefox.launchPersistentContext(profile, {
            ...launchOptions,
            firefoxUserPrefs: {
                ...launchOptions.firefoxUserPrefs,
                // Answer every name here, as localhost, and ask the network nothing.
                'network.dns.native-is-localhost': true,
                'network.dns.native_https_query': false,
                'network.trr.mode': 5,
            },
            env: { ...process.env, MOZ_LOG: 'timestamp,nsHostResolver:5', MOZ_LOG_FILE: path.join(folder, 'firefox') },
        });
        try {
            const page = context.pages()[0] ?? await context.newPage();
            await page.goto(`${server.baseUrl}/`);
            // Firefox writes the time to its profile as the timer fires, just before
            // the check it starts. Then give that check a moment to begin.
            await expect.poll(() => addonTimerFired(profile), {
                message: "the time Firefox's add-on update timer fired (in its profile's prefs.js)",
                timeout: 75_000,
                intervals: [500],
            }).toBeGreaterThan(0);
            await page.waitForTimeout(3_000);
        } finally {
            await context.close();
        }
        const names = namesLookedUp(folder);
        // A log that recorded nothing would show no lookups either.
        expect([...names.keys()], "the names in Firefox's DNS log").toContain('127.0.0.1');
        const outside = [...names].filter(([name]) => !LOCAL_HOST.test(name)).map(([name, n]) => `${name} (×${n})`);
        expect(outside, 'the names Firefox looked up beyond this machine (its DNS log)').toEqual([]);
    } finally {
        fs.rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
    }
});
