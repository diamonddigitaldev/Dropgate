// Playwright's test and expect, with a fresh local server for every test.
//
// The server is the real server.js, started by the server suite's own harness:
// a throwaway copy on a free port on 127.0.0.1. Pages are opened relative to it,
// so a test never reaches any other origin, and the browser's requests are
// checked after each test to prove it.
//
// Once a test has passed, the fixtures also check what its flows left in the
// browser and what they sent the server (see privacy.mjs). They're skipped for
// a test.fail() test, which runs any it needs inside onlyFailsWith(), so that a
// failure here can't stand in for the one it expects.
import { test as base, expect } from '@playwright/test';
import { startServer } from '../../../server/test/helpers/harness.mjs';
import { expectNoSecretsSent, expectNothingStored, keepSecretsFor, Secrets } from './privacy.mjs';
import { startStunServer } from './stun.mjs';

export { expect };

// The server hands browsers a public STUN server by default. Set to none, it
// offers no ICE servers at all. Direct transfer tests offer the tests' own STUN
// server instead (localStun), so either way nothing leaves this machine.
export const NO_ICE_SERVERS = 'none';

/** Whether the test body passed, as it was meant to. */
export const passed = (testInfo) => testInfo.status === 'passed' && testInfo.expectedStatus === 'passed';

// Before each action and expect(), Playwright waits until no page it drives is
// in the middle of a navigation, as it knows them. It reads this variable at
// every step, in this worker's process.
const SKIP_NAVIGATION_CHECK = 'PLAYWRIGHT_SKIP_NAVIGATION_CHECK';

/**
 * Turn off Playwright's wait for a navigation to finish before each step, for
 * every page in the rest of this test. The steps still wait for what they
 * check. Only for a page whose navigation Playwright will never hear the end
 * of (helpers/webui.mjs' openReceivePage()); the navigationCheck fixture turns
 * it back on once the test is over.
 */
export function skipNavigationCheckForThisTest() {
    process.env[SKIP_NAVIGATION_CHECK] = '1';
}

// WebKit on some Linux systems saves every space in a download's name as an
// underscore: "photos (holiday).zip" is saved as "photos_(holiday).zip". It's
// the system's WebKit, not the page: Ubuntu 26.04's own WebKitGTK does it, and
// Playwright's WebKit built for it, from a plain Blob as from any
// Content-Disposition header; the same WebKit on Ubuntu 24.04 and Windows
// keeps the spaces. Chromium and Firefox never do it. The downloadNaming
// fixture finds out once per worker whether this browser does.
let spacesSavedAsUnderscores;

/**
 * The name this browser saves a download called `name` under: `name` itself,
 * except in a WebKit that saves spaces as underscores (above).
 * @param {string} name
 */
export function savedName(name) {
    if (spacesSavedAsUnderscores === undefined) throw new Error("savedName() before the downloadNaming fixture found this browser's rule");
    return spacesSavedAsUnderscores ? name.replace(/ /g, '_') : name;
}

/**
 * Whether this WebKit saves spaces in a download's name as underscores: a Blob
 * named with a space, saved from a page that isn't Dropgate's, tells. Any
 * other change to its name is something this doesn't know, and fails.
 * @param {import('@playwright/test').BrowserType} webkit
 */
async function webkitSavesSpacesAsUnderscores(webkit) {
    const browser = await webkit.launch();
    try {
        const page = await browser.newPage({ acceptDownloads: true });
        await page.setContent('<a id="save">save</a>');
        await page.evaluate(() => {
            const a = document.getElementById('save');
            a.href = URL.createObjectURL(new Blob(['probe'], { type: 'application/octet-stream' }));
            a.download = 'a b.txt';
        });
        const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#save').click()]);
        const name = dl.suggestedFilename();
        await dl.cancel();
        if (name === 'a b.txt') return false;
        if (name === 'a_b.txt') return true;
        throw new Error(`WebKit saved a download called "a b.txt" as "${name}"`);
    } finally {
        await browser.close();
    }
}

/**
 * Record every http(s) and ws(s) request a browser context makes to anywhere but
 * the server's own origin, and every WebSocket message its pages send.
 */
function watchContext(context, server, secrets) {
    const origin = new URL(server.baseUrl).origin;
    const sameOrigin = new Set([origin, origin.replace(/^http/, 'ws')]);
    const elsewhere = [];
    const check = (url) => {
        const { protocol, origin: to } = new URL(url);
        if (/^(https?|wss?):$/.test(protocol) && !sameOrigin.has(to)) elsewhere.push(url);
    };
    context.on('request', (request) => check(request.url()));
    context.on('page', (page) => page.on('websocket', (ws) => {
        check(ws.url());
        ws.on('framesent', ({ payload }) => secrets.messagesSent.push({ url: ws.url(), payload }));
    }));
    return () => expect(elsewhere, "requests that weren't to the local server's origin").toEqual([]);
}

export const test = base.extend({
    // Server settings for this test, on top of ENABLE_UPLOAD=true and its ICE servers.
    // Set them with test.use({ serverEnv: { ... } }).
    serverEnv: [{}, { option: true }],

    // Start the server with the test clock, so the test can call server.advanceClock().
    // Set it with test.use({ serverClock: true }).
    serverClock: [false, { option: true }],

    // Let the test ask what the server's rendezvous holds, with server.rendezvousHeld().
    // Set it with test.use({ serverHeld: true }).
    serverHeld: [false, { option: true }],

    // Have the server offer the tests' own STUN server, on this machine, as its only
    // ICE server. Set it with test.use({ localStun: true }), or to startStunServer()'s options.
    localStun: [false, { option: true }],

    // That STUN server, or null when the server offers no ICE servers.
    stun: async ({ localStun }, use) => {
        if (!localStun) {
            await use(null);
            return;
        }
        const stun = await startStunServer(localStun === true ? {} : localStun);
        try {
            await use(stun);
        } finally {
            await stun.stop();
        }
    },

    // Playwright's navigation check back as it was after every test, so one
    // test's skipNavigationCheckForThisTest() never reaches the next.
    navigationCheck: [async ({}, use) => {
        const before = process.env[SKIP_NAVIGATION_CHECK];
        try {
            await use();
        } finally {
            if (before === undefined) delete process.env[SKIP_NAVIGATION_CHECK];
            else process.env[SKIP_NAVIGATION_CHECK] = before;
        }
    }, { auto: true }],

    // How this worker's browser names what it saves, for savedName(). Only WebKit
    // is asked; Chromium and Firefox keep a download's name as it's given.
    downloadNaming: [async ({ playwright, browserName }, use) => {
        spacesSavedAsUnderscores = browserName === 'webkit' && await webkitSavesSpacesAsUnderscores(playwright.webkit);
        await use(spacesSavedAsUnderscores);
    }, { scope: 'worker', auto: true }],

    // The file names and keys this test's flows handle. The web UI helpers add to it.
    secrets: async ({}, use) => {
        await use(new Secrets());
    },

    server: async ({ serverEnv, serverClock, serverHeld, stun, secrets }, use, testInfo) => {
        const server = await startServer({
            env: { ENABLE_UPLOAD: 'true', P2P_STUN_SERVERS: stun?.url ?? NO_ICE_SERVERS, ...serverEnv },
            clock: serverClock,
            held: serverHeld,
            requests: true,
        });
        try {
            await use(server);
            // Both browser contexts have closed by now, so every request is in.
            if (passed(testInfo)) expectNoSecretsSent(server, secrets);
        } finally {
            await server.stop();
        }
    },

    baseURL: async ({ server }, use) => {
        await use(server.baseUrl);
    },

    context: async ({ context, server, secrets }, use, testInfo) => {
        keepSecretsFor(context, secrets);
        const check = watchContext(context, server, secrets);
        await use(context);
        if (passed(testInfo)) await expectNothingStored(context, server.baseUrl, 'the browser');
        check();
    },

    // A second, separate browser context, like another person on another device.
    // It has the same base URL, headers and permissions as the first, and the
    // same checks.
    otherContext: async ({ browser, baseURL, extraHTTPHeaders, permissions, server, secrets }, use, testInfo) => {
        const context = await browser.newContext({ baseURL, extraHTTPHeaders, permissions });
        keepSecretsFor(context, secrets);
        const check = watchContext(context, server, secrets);
        try {
            await use(context);
            if (passed(testInfo)) await expectNothingStored(context, server.baseUrl, 'the other browser');
        } finally {
            await context.close();
        }
        check();
    },
});

/**
 * Runs the body of a test.fail() test, and only counts the failure it names.
 *
 * test.fail() passes on any error, so a broken step would look just like the
 * known issue. This rethrows only an error whose message matches `match`. Any
 * other error is logged and swallowed, so test.fail() reports the test as
 * failed. It fails the same way once the issue is fixed: then make it a plain
 * test() and drop this wrapper.
 * @param {RegExp} match
 * @param {() => Promise<void>} body
 */
export async function onlyFailsWith(match, body) {
    try {
        await body();
    } catch (err) {
        if (err instanceof Error && match.test(err.message)) throw err;
        console.error(`Failed, but not with ${match}:`, err);
    }
}
