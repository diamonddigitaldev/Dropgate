// A new install's first server check. Chromium reads the cookie store before
// any request that may carry cookies, and a new profile's store only starts
// loading from disk at the first one: on CI's Windows runners that took 5-8 s,
// longer than Test waits, so v3's first Test could fail with its request never
// sent. Dropgate uses no cookies, and core omits credentials from every request,
// so the app's requests never read the store, and never wait for it.
import { expect, test } from '../helpers/desktop.mjs';
import { cookieStoreLoads, requestsTo } from '../helpers/netlog.mjs';

test("a new profile's first Test reaches the server without ever reading the cookie store", async ({ desktop, server }) => {
    const app = await desktop.launch();
    const window = await app.window();

    await window.getByRole('button', { name: 'Settings', exact: true }).click();
    await window.getByRole('tab', { name: 'Server' }).click();
    await window.locator('#server-url').fill(desktop.serverUrl);
    await window.locator('#test-connection-btn').click();
    await expect(window.locator('#connection-status')).toHaveText(/connection successful/i);

    // Quitting finishes the net log.
    await app.quit();
    const requests = requestsTo(app.netLog, [server.baseUrl, desktop.serverUrl]);
    expect(requests.length, "the app's requests to the server").toBeGreaterThan(0);
    expect(requests.filter((r) => r.privacyMode !== 'enabled'), 'requests to the server that could carry cookies').toEqual([]);
    expect(cookieStoreLoads(app.netLog, desktop.started), 'when the cookie store started loading from disk, in ms from the test\'s start').toEqual([]);
});
