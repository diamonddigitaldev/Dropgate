// Playwright's test and expect, with a fresh local server for every test.
//
// The server is the real server.js, started by the server suite's own harness:
// a throwaway copy on a free port on 127.0.0.1. Pages are opened relative to it,
// so a test never reaches any other host, and the browser's requests are checked
// after each test to prove it.
import { test as base, expect } from '@playwright/test';
import { startServer } from '../../../server/test/helpers/harness.mjs';

export { expect };

export const test = base.extend({
    // Server settings for this test, on top of ENABLE_UPLOAD=true.
    // Set them with test.use({ serverEnv: { ... } }).
    serverEnv: [{}, { option: true }],

    server: async ({ serverEnv }, use) => {
        const server = await startServer({ env: { ENABLE_UPLOAD: 'true', ...serverEnv } });
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
        const serverHost = new URL(server.baseUrl).host;
        const elsewhere = [];
        context.on('request', (request) => {
            const url = new URL(request.url());
            if (/^(https?|wss?):$/.test(url.protocol) && url.host !== serverHost) elsewhere.push(request.url());
        });
        await use(context);
        expect(elsewhere, 'requests to anywhere but the local server').toEqual([]);
    },
});
