// v3's Test retried a server over plain HTTP whenever HTTPS failed, so anyone
// on the network who could block HTTPS could turn the app's connection
// insecure. Core never retries now: an address is used as it's given, and only
// one typed with http:// is plain HTTP.
import { expect, test } from '../helpers/desktop.mjs';
import { requestsTo } from '../helpers/netlog.mjs';

test('Test never retries a server over plain HTTP: an https:// address only HTTP answers fails, and says to type http://', async ({ desktop, server }) => {
    const app = await desktop.launch();
    const window = await app.window();
    // The test's server only answers plain HTTP.
    const httpsUrl = server.baseUrl.replace(/^http:/, 'https:');

    await window.getByRole('button', { name: 'Settings', exact: true }).click();
    await window.getByRole('tab', { name: 'Server' }).click();
    await window.locator('#server-url').fill(httpsUrl);
    await window.locator('#test-connection-btn').click();
    await expect(window.locator('#connection-status')).toHaveText(/connection failed.*enter its address starting with http:\/\//i);
    await expect(window.locator('#server-url')).toHaveValue(httpsUrl);

    // Quitting finishes the net log.
    await app.quit();
    const requests = requestsTo(app.netLog, [server.baseUrl]);
    expect(requests.length, "the app's requests to the server's address").toBeGreaterThan(0);
    expect(requests.filter((r) => !r.url.startsWith(`${httpsUrl}/`)), 'requests not over HTTPS').toEqual([]);

    // The test's server, asked over HTTPS: the fixture would count that as somewhere else.
    expect(desktop.elsewhere.filter((url) => !url.startsWith(`${httpsUrl}/`))).toEqual([]);
    desktop.elsewhere.length = 0;
});
