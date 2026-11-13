// v3's Test retried a server over plain HTTP whenever HTTPS failed, so anyone
// on the network who could block HTTPS could turn the app's connection
// insecure. Core never retries now: an address is used as it's given, and only
// one typed with http:// is plain HTTP. Add Server's Check is where an address
// is first tried.
import { addServerDialog, expect, openServers, serverRows, test } from '../helpers/desktop.mjs';
import { requestsTo } from '../helpers/netlog.mjs';

test("Add Server's Check never retries a server over plain HTTP: an https:// address only HTTP answers fails, says to type http://, and is not saved", async ({ desktop, server }) => {
    const app = await desktop.launch();
    const window = await app.window();
    // The test's server only answers plain HTTP.
    const httpsUrl = server.baseUrl.replace(/^http:/, 'https:');

    await openServers(window);
    await window.locator('#add-server-btn').click();
    const dialog = addServerDialog(window);
    await dialog.getByLabel('Server address').fill(httpsUrl);
    await dialog.getByRole('button', { name: 'Check', exact: true }).click();
    await expect(dialog.locator('#add-server-address-help')).toHaveText(/connection failed.*enter its address starting with http:\/\//i);
    await expect(dialog.getByLabel('Server address')).toHaveValue(httpsUrl);
    await expect(dialog.getByRole('button', { name: 'Add Server', exact: true }), 'Add Server, for an address not found').toHaveCount(0);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(serverRows(window), 'servers saved').toHaveCount(0);

    // Quitting finishes the net log.
    await app.quit();
    const requests = requestsTo(app.netLog, [server.baseUrl]);
    expect(requests.length, "the app's requests to the server's address").toBeGreaterThan(0);
    expect(requests.filter((r) => !r.url.startsWith(`${httpsUrl}/`)), 'requests not over HTTPS').toEqual([]);

    // The test's server, asked over HTTPS: the fixture would count that as somewhere else.
    expect(desktop.elsewhere.filter((url) => !url.startsWith(`${httpsUrl}/`))).toEqual([]);
    desktop.elsewhere.length = 0;
});
