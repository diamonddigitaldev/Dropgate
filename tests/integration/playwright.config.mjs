import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: '.',
    testMatch: '**/*.spec.mjs',
    // Each test starts its own server, so tests can run side by side.
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    // A flaky test gets fixed, not retried.
    retries: 0,
    // One line per test, with its name, in the terminal and the CI log.
    reporter: 'list',
    timeout: 60_000,
    use: {
        trace: 'off',
        // The server expects to sit behind a reverse proxy that terminates TLS,
        // and only serves encrypted download pages to requests that came in over
        // HTTPS. It trusts one proxy hop, so this header plays the proxy's part.
        // The pages themselves load from http://127.0.0.1, which browsers treat as
        // a secure context, so the Web Crypto API and service workers still work.
        extraHTTPHeaders: { 'X-Forwarded-Proto': 'https' },
        // Bootstrap scrolls smoothly unless the user prefers reduced motion. A page
        // that's still scrolling can move a button out from under a click, so the
        // browsers ask for reduced motion, as some people do.
        reducedMotion: 'reduce',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ],
});
