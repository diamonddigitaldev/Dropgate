import { defineConfig, devices } from '@playwright/test';

// Chromium looks for a proxy by itself when the system says to, as Windows does
// by default ("Automatically detect settings"): it asks the network for a WPAD
// proxy script, over DHCP and DNS. direct:// has it connect directly instead.
// Playwright's headless Chromium ignores --no-proxy-server, which the desktop
// app is given (helpers/desktop.mjs). privacy/proxy-lookup.spec.mjs checks the
// browsers, and every desktop test checks the app.
const chromium = { ...devices['Desktop Chrome'], launchOptions: { args: ['--proxy-server=direct://'] } };

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
        { name: 'chromium', testIgnore: 'desktop/**', use: chromium },
        { name: 'firefox', testIgnore: 'desktop/**', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', testIgnore: 'desktop/**', use: { ...devices['Desktop Safari'] } },
        // The desktop app, from client/. Its links are opened in Chromium.
        { name: 'desktop', testMatch: 'desktop/**/*.spec.mjs', use: chromium },
    ],
});
