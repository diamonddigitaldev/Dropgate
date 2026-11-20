// A new install's first server check. Chromium reads the cookie store before
// any request that may carry cookies, and a new profile's store only starts
// loading from disk at the first one: on CI's Windows runners that took 5-8 s,
// longer than a check waits, so v3's first Test could fail with its request never
// sent. Dropgate uses no cookies, and core omits credentials from every request,
// so the app's requests never read the store, and never wait for it.
import { addServerDialog, expect, openServers, test } from '../helpers/desktop.mjs';
import { cookieStoreLoads, requestsTo } from '../helpers/netlog.mjs';

test("a new profile's first server check reaches the server without ever reading the cookie store", async ({ desktop, server }) => {
    const app = await desktop.launch();
    const window = await app.window();

    // Add Server's Check: the first request a new profile makes.
    await openServers(window);
    await window.locator('#add-server-btn').click();
    const dialog = addServerDialog(window);
    await dialog.getByLabel('Server address').fill(desktop.serverUrl);
    await dialog.getByRole('button', { name: 'Check', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Add Server', exact: true }), 'the server, found').toBeVisible();

    // Quitting finishes the net log.
    await app.quit();
    const requests = requestsTo(app.netLog, [server.baseUrl, desktop.serverUrl]);
    expect(requests.length, "the app's requests to the server").toBeGreaterThan(0);
    expect(requests.filter((r) => r.privacyMode !== 'enabled'), 'requests to the server that could carry cookies').toEqual([]);
    expect(cookieStoreLoads(app.netLog, desktop.started), 'when the cookie store started loading from disk, in ms from the test\'s start').toEqual([]);
});
