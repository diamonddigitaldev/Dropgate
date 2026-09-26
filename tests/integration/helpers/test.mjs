// Playwright's test and expect, with a fresh local server for every test.
//
// The server is the real server.js, started by the server suite's own harness:
// a throwaway copy on a free port on 127.0.0.1. Pages are opened relative to it,
// so a test never reaches any other host, and the browser's requests are checked
// after each test to prove it.
import { test as base, expect } from '@playwright/test';
import { startServer } from '../../../server/test/helpers/harness.mjs';

export { expect };

// The server hands browsers a public STUN server by default, and an empty value
// falls back to that default. A lone comma is a list with nothing in it, so the
// server offers no ICE servers at all and direct transfers stay on this machine.
export const NO_ICE_SERVERS = ',';

/** Record every http(s) and ws(s) request a browser context makes to a host other than the server. */
function watchForOtherHosts(context, server) {
    const serverHost = new URL(server.baseUrl).host;
    const elsewhere = [];
    context.on('request', (request) => {
        const url = new URL(request.url());
        if (/^(https?|wss?):$/.test(url.protocol) && url.host !== serverHost) elsewhere.push(request.url());
    });
    return () => expect(elsewhere, 'requests to anywhere but the local server').toEqual([]);
}

export const test = base.extend({
    // Server settings for this test, on top of ENABLE_UPLOAD=true and no ICE servers.
    // Set them with test.use({ serverEnv: { ... } }).
    serverEnv: [{}, { option: true }],

    // Start the server with the test clock, so the test can call server.advanceClock().
    // Set it with test.use({ serverClock: true }).
    serverClock: [false, { option: true }],

    server: async ({ serverEnv, serverClock }, use) => {
        const server = await startServer({
            env: { ENABLE_UPLOAD: 'true', P2P_STUN_SERVERS: NO_ICE_SERVERS, ...serverEnv },
            clock: serverClock,
        });
        try {
            await use(server);
        } finally {
            await server.stop();
        }
    },

    baseURL: async ({ server }, use) => {
        await use(server.baseUrl);
    },

    context: async ({ context, server }, use) => {
        const check = watchForOtherHosts(context, server);
        await use(context);
        check();
    },

    // A second, separate browser context, like another person on another device.
    // It has the same base URL and headers as the first, and the same host check.
    otherContext: async ({ browser, baseURL, extraHTTPHeaders, server }, use) => {
        const context = await browser.newContext({ baseURL, extraHTTPHeaders });
        const check = watchForOtherHosts(context, server);
        try {
            await use(context);
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
