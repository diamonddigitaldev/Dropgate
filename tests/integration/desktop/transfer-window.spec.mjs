// The desktop app's transfer window: a hidden, sandboxed window in a session
// of its own, which runs core and makes every request the app makes to a
// server, server checks included. The app's window runs no core and asks no
// server anything, and main never carries a file's bytes: the file service
// reads them, and hands them to the transfer window over a channel of their
// own.
//
// Which session sent a request comes from that session's own request hooks
// (the test preload's): Chromium's net log names no session. The net log
// still checks that nothing went to the server that the sessions didn't see.
import { madeUpFile, summary } from '../helpers/files.mjs';
import { expect, securityWarning, test, uploadButton, uploadStatus } from '../helpers/desktop.mjs';
import { requestsTo } from '../helpers/netlog.mjs';
import { download } from '../helpers/webui.mjs';

// Three 5 MiB chunks.
const SIZE = 12_000_000;

/** The transfer window as main sees it: where it is, how it's made, and its session. */
const transferWindowFacts = (app) => app.app.evaluate(({ BrowserWindow, session }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/transfer.html'));
    const prefs = win.webContents.getLastWebPreferences();
    const ses = win.webContents.session;
    return {
        visible: win.isVisible(),
        sandbox: prefs.sandbox,
        contextIsolation: prefs.contextIsolation,
        nodeIntegration: prefs.nodeIntegration,
        uiSession: ses === session.defaultSession,
        persistent: ses.isPersistent(),
        preloads: ses.getPreloadScripts().length,
        windows: BrowserWindow.getAllWindows().length,
    };
});

test('the transfer window is hidden, sandboxed and isolated, in a session that keeps nothing and grants nothing, with no Node and no bridge but its own, its CSP, and no way to navigate or open a window', async ({ desktop, server }) => {
    const app = await desktop.launch();
    const window = await app.window();
    // Test is its first work.
    await desktop.setUp(window);
    const transfer = await app.transferWindow();

    const facts = await transferWindowFacts(app);
    expect(facts, 'the transfer window, as main made it').toMatchObject({
        visible: false, sandbox: true, contextIsolation: true, nodeIntegration: false, uiSession: false, persistent: false, preloads: 0,
    });

    expect(await transfer.evaluate(() => [typeof require, typeof process, typeof window.kitAPI, typeof window.electronAPI, typeof window.engine]),
        'require, process, kitAPI, electronAPI and engine in its page').toEqual(['undefined', 'undefined', 'undefined', 'undefined', 'object']);

    // Its CSP: nothing but its own scripts, and requests to servers over HTTP(S).
    await expect(transfer.locator('meta[http-equiv="Content-Security-Policy"]'))
        .toHaveAttribute('content', "default-src 'none'; script-src 'self'; connect-src http: https:");
    // Enforced: an inline script added to the page doesn't run, and nothing loads but from a server.
    // (Not eval: the test's own evaluation is allowed it, whatever the page's CSP.)
    expect(await transfer.evaluate(() => {
        const script = document.createElement('script');
        script.textContent = 'window.inlineRan = true;';
        document.head.append(script);
        return window.inlineRan === true;
    }), 'whether an inline script ran').toBe(false);
    expect(await transfer.evaluate(() => fetch('data:,x').then(() => 'fetched', (err) => err.name)), 'a request that isn\'t to a server').toBe('TypeError');
    expect(await transfer.evaluate(() => new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve('loaded');
        image.onerror = () => resolve('refused');
        image.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    })), 'an image').toBe('refused');

    // No permission is granted, or ever asked for.
    expect(await transfer.evaluate(() => Notification.requestPermission()), 'notifications').toBe('denied');
    expect(await transfer.evaluate(() => navigator.permissions.query({ name: 'geolocation' }).then((p) => p.state)), 'location').toBe('denied');

    // It can't go anywhere else, or open anything.
    const before = server.requests().length;
    expect(await transfer.evaluate((url) => window.open(url), server.baseUrl), 'window.open()').toBeNull();
    await transfer.evaluate((url) => { window.location.href = url; }, server.baseUrl);
    await transfer.waitForTimeout(1_000);
    expect(transfer.url(), 'where the transfer window is').toMatch(/\/transfer\.html$/);
    expect((await transferWindowFacts(app)).windows, 'the app\'s windows: its own and the transfer window').toBe(facts.windows);
    expect(server.requests().slice(before), 'requests to the server from navigating or opening').toEqual([]);
});

test('through an upload, a pause and a resume, every request to the server comes from the transfer window\'s session, none from the app\'s window, and none from main', async ({ desktop, server, page }) => {
    const file = madeUpFile('Sent from the transfer window é.bin', SIZE, 71);
    desktop.secrets.addFiles([file], { storedByServer: true });
    const app = await desktop.launch(desktop.addFile(file));
    const window = await app.window();
    await desktop.setUp(window);
    await expect(window.locator('#file-list .file-row-name')).toHaveText([file.name]);

    // The second chunk waits until the upload is paused.
    const transfer = await app.transferWindow();
    let holding = true;
    let chunks = 0;
    await transfer.route('**/api/v4/upload/chunks/*', (route) => {
        chunks += 1;
        return chunks === 1 || !holding ? route.continue() : undefined;
    });
    await uploadButton(window).click();
    await securityWarning(window).getByRole('button', { name: 'Upload Anyway' }).click();
    await expect.poll(() => chunks, { message: 'the second chunk should be on its way' }).toBe(2);
    await window.locator('#action-bar').getByRole('button', { name: 'Pause Upload', exact: true }).click();
    await expect(uploadStatus(window)).toHaveText(/^Paused\. Kept until /);
    holding = false;
    await window.locator('#action-bar').getByRole('button', { name: 'Resume Upload', exact: true }).click();
    await expect(uploadStatus(window)).toHaveText(/upload successful/i, { timeout: 30_000 });
    const link = await window.locator('#download-link').inputValue();
    desktop.secrets.addLink(link);
    await transfer.unrouteAll({ behavior: 'ignoreErrors' });
    await app.quit();

    const toServer = app.eventsOf('request');
    const routes = toServer.map(({ url }) => new URL(url).pathname);
    for (const route of ['/api/info', '/api/v4/uploads', '/api/v4/upload/chunks/0', '/api/v4/upload/pause', '/api/v4/upload/resume', '/api/v4/upload/complete']) {
        expect(routes, `the requests the sessions sent: ${route}`).toContain(route);
    }
    expect(toServer.filter((r) => !(r.session === 'isolated' && !r.persistent && r.page === 'transfer.html')),
        'requests from anywhere but the transfer window, in its in-memory session').toEqual([]);

    // The network stack sent nothing to the server that the sessions didn't see.
    const seen = new Set(toServer.map(({ url }) => url));
    const logged = requestsTo(app.netLog, [server.baseUrl]);
    expect(logged.length, "the app's requests to the server, in its net log").toBeGreaterThan(0);
    expect(logged.filter(({ url }) => !seen.has(url)), 'requests in the net log no session sent').toEqual([]);

    // And the upload is whole.
    await page.goto(desktop.receivingUrl(link));
    await expect(page.locator('#file-name')).toHaveText(file.name);
    const got = await download(page, page.locator('#download-button'));
    expect(summary(got.bytes)).toEqual(summary(file.buffer));
});

test('main never carries a file\'s bytes: through an upload of 12 MB, no message to or from it is bigger than a snapshot', async ({ desktop }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await desktop.setUp(window);
    await desktop.upload(window, [madeUpFile('Never through main.bin', SIZE, 72)], { encrypted: false });
    await app.quit();

    expect(app.eventsOf('ipc-large'), 'messages to or from main over 64 KiB').toEqual([]);
    const [{ sizes }] = app.eventsOf('ipc-sizes');
    // What was measured: the transfer window's snapshots and outcome, and the file service's grant.
    for (const channel of ['page → main engine:update', 'page → main engine:finished', 'main → utility grant-read', 'main → page engine:upload']) {
        expect(sizes[channel]?.count, `messages on ${channel}`).toBeGreaterThan(0);
    }
    const biggest = Math.max(...Object.values(sizes).map(({ max }) => max));
    expect(biggest, 'the biggest message to or from main, in bytes').toBeLessThan(16 * 1024);
});
