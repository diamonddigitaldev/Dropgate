// A chosen adapter, in the app (phase 19, `09` 18.5-18.9). With one chosen in
// Settings > Network, every request the transfer session makes goes through the
// network service, bound to it, and names are looked up through it. The moment
// it goes, what's running fails, nothing moves anywhere, and nothing connects
// until it's back; nothing restarts by itself.
//
// The adapter is a stand-in, a loopback address the server doesn't listen as
// (network-stand-in.cjs), so the server's record of where each connection came
// from tells a bound one from any other, and nothing leaves the machine. Its
// going is the service's list no longer holding it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startDns } from '../../../client/test/helpers/network.mjs';
import { madeUpFile } from '../helpers/files.mjs';
import { uploadWithCore } from '../helpers/hosted.mjs';
import { outsideLookups, proxySettings, resolverJobs } from '../helpers/netlog.mjs';
import {
    STAND_IN, STAND_IN_ADDRESS, addLink, cardButton, downloadCard, downloadStatus, expect, holdChunks, openServers, saved, securityWarning, serverRow, serverStatus, test, transfersIn,
    uploadCard, uploadCards, uploadLink, uploadStatus,
} from '../helpers/desktop.mjs';

/** What the Adapter card says, on this OS. */
const OS = process.platform === 'win32' ? 'Windows' : 'Linux';
const ANY = `Any interface (as ${OS} chooses)`;
const ANY_HELP = `Dropgate connects through whichever adapter ${OS} chooses for each connection.`;
const CHOSEN_HELP = (name) => `Dropgate connects only through ${name}, and looks names up through it too. If it disconnects, every transfer stops at once and nothing connects until it's back: Dropgate never uses another adapter.`;
const GONE_HELP = (name) => `${name} isn't connected, so Dropgate connects through nothing. Connect it again, or choose another adapter.`;
const NOTE = `Update checks go through the chosen adapter too. Direct transfers can't be held to one adapter, so they're off while one is chosen. Choosing one also sets aside ${OS === 'Windows' ? "Windows'" : "Linux's"} proxy settings for Dropgate.`;

/** How a transfer's card and a refusal say it. */
const FAILED = `Failed: ${STAND_IN} isn't connected.`;
const REASON = `${STAND_IN} isn't connected.`;

/** How soon what's running fails: one read of the adapters, and the stop's few milliseconds. */
const AT_ONCE_MS = 2_000;

const networkSelect = (window) => window.locator('#network-interface');
const networkHelp = (window) => window.locator('#network-interface-help');

async function openNetwork(window) {
    await window.getByRole('button', { name: 'Settings', exact: true }).click();
    await window.getByRole('tab', { name: 'Network' }).click();
}

const goToUpload = (window) => window.locator('#nav-rail').getByRole('button', { name: 'Upload' }).click();

/** The stand-in adapter chosen in Settings > Network, as a person does. */
async function chooseStandIn(window) {
    await openNetwork(window);
    await networkSelect(window).selectOption({ label: `${STAND_IN} · ${STAND_IN_ADDRESS}` });
    await expect(networkHelp(window)).toHaveText(CHOSEN_HELP(STAND_IN));
}

/** Where a connection came from, as the server saw it: an IPv4 address as itself, on a server listening on both families. */
const sourceOf = ({ source }) => String(source).replace(/^::ffff:/, '');

/** Where each connection the server has had came from: one set, so the check names any other. */
const sourcesAt = (server, since = 0) => [...new Set(server.requests().slice(since).map(sourceOf))];

/** The utility processes the app started, by file name. */
const networkServices = (app) => app.eventsOf('utility').filter(({ name }) => name === 'network-service.js');

/** A DNS responder of the test's own, and the app's server as a name it answers: nothing here is looked up anywhere else. */
async function byName(desktop, server) {
    const { port } = new URL(server.baseUrl);
    const dns = await startDns('127.0.0.2', { 'dropgate.test': '127.0.0.1' });
    desktop.dnsServer = dns.server;
    const url = `http://dropgate.test:${port}`;
    desktop.alsoAllowed.push(url);
    return { dns, url };
}

/** Where the network service listens on this machine: IPv6 loopback, else IPv4's. */
const PROXY_HOST = Object.values(os.networkInterfaces()).flat().some(({ address }) => address === '::1') ? '[::1]' : '127.0.0.1';

/** The transfer session's proxy for an address, as the session says: 'DIRECT', or 'SOCKS5 <the service's loopback>:<port>'. */
const proxyFor = (app, url) => app.app.evaluate(({ BrowserWindow }, address) => {
    const transfer = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/transfer.html'));
    return transfer.webContents.session.resolveProxy(address);
}, url);

/** A new upload of one made-up file, picked from the test's folder and waiting. */
async function newUpload(desktop, window, name, seed, { size = 30_000 } = {}) {
    const file = madeUpFile(name, size, seed);
    desktop.secrets.addFiles([file], { storedByServer: true });
    const before = await uploadCards(window).count();
    await window.locator('#file-input').setInputFiles([desktop.addFile(file)]);
    await expect(uploadCards(window)).toHaveCount(before + 1);
    return uploadCard(window);
}

/** A saved server, by name, through the stand-in adapter. */
async function addByName(desktop, window, url) {
    await desktop.setUp(window, { url });
    await expect(uploadCards(window)).toHaveCount(0);
}

/** Start an upload that's waiting: its server isn't encrypted, so the Upload Security Warning is answered first. */
async function start(window, card) {
    await cardButton(card, 'Upload').click();
    await securityWarning(window).getByRole('button', { name: 'Upload Anyway' }).click();
}

test.describe('with an adapter chosen', () => {
    test('every request of an upload, a download, a delete and every check reaches the server from its address, and every name is looked up through it', async ({ desktop, server }) => {
        const { dns, url } = await byName(desktop, server);
        try {
            const app = await desktop.launch();
            const window = await app.window();
            await chooseStandIn(window);
            await addByName(desktop, window, url);

            const card = await newUpload(desktop, window, 'Bound upload.bin', 41);
            await start(window, card);
            await expect(uploadStatus(window)).toHaveText(/^Uploaded · /, { timeout: 30_000 });
            await expect(uploadLink(window)).toHaveValue(/dropgate\.test/);
            desktop.secrets.addLink(await uploadLink(window).inputValue());

            await cardButton(card, 'Delete').click();
            await window.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
            await expect(uploadStatus(window)).toHaveText('Deleted from the server. Its link no longer works.');

            // A download, of a link to the server by its name.
            const file = madeUpFile('Bound download.bin', 40_000, 42);
            desktop.secrets.addFiles([file], { storedByServer: true });
            const { link } = await uploadWithCore(server, [file], { encrypt: false });
            const beforeDownload = server.requests().length;
            const bound = new URL(link);
            bound.hostname = 'dropgate.test';
            desktop.secrets.addLink(bound.href);
            await addLink(window, bound.href);
            await expect(downloadStatus(window)).toHaveText('Ready');
            await cardButton(downloadCard(window), 'Download').click();
            await expect(downloadStatus(window)).toHaveText(/^Saved to /, { timeout: 30_000 });

            // Every request the app made, whatever it was for. uploadWithCore()'s upload, made here in the test, isn't one.
            const asked = server.requests().filter(({ headers }) => /\bElectron\//.test(headers['user-agent'] ?? ''));
            expect(asked.length, 'requests the app made').toBeGreaterThan(5);
            expect([...new Set(asked.map(sourceOf))], 'where each of them came from').toEqual([STAND_IN_ADDRESS]);
            expect(server.requests().slice(beforeDownload).map(sourceOf).every((source) => source === STAND_IN_ADDRESS), 'the download').toBe(true);
            expect(asked.some(({ method, url: asked_ }) => method === 'DELETE' && /uploads|objects/.test(asked_)), 'the delete').toBe(true);

            // Names are the service's: every query came from the adapter, and Chromium looked up nothing.
            expect(dns.queries.length, 'queries the responder had').toBeGreaterThan(0);
            expect([...new Set(dns.queries.map(({ source }) => source))], 'where each query came from').toEqual([STAND_IN_ADDRESS]);
            expect((await proxyFor(app, url)).replace(/:\d+$/, ''), 'where the session sends everything').toBe(`SOCKS5 ${PROXY_HOST}`);

            await app.quit();
            // Past the proxy, nothing: no job at all (the server's name, wpad, the NAT64 probe's ipv4only.arpa), and no lookup asked for.
            expect(resolverJobs(app.netLog), "the host resolver's jobs").toEqual([]);
            expect(outsideLookups(app.netLog), 'what Chromium looked up').toEqual([]);
            // Never an IPv4 address, for itself or the proxy's: one is what makes its NAT64 probe look up ipv4only.arpa.
            const proxies = proxySettings(app.netLog).flatMap(({ single_proxy: single }) => single ?? []);
            expect(proxies.length, 'the proxy settings it had').toBeGreaterThan(0);
            if (PROXY_HOST === '[::1]') expect(proxies.filter((proxy) => proxy.includes('127.0.0.1')), 'an IPv4 address as its proxy').toEqual([]);
        } finally {
            await dns.close();
        }
    });

    test('with Any interface, the session is left as it is, connections come as ever, and the service is never started until the tab asks', async ({ desktop, server }) => {
        const app = await desktop.launch();
        const window = await app.window();
        await desktop.setUp(window);
        const card = await newUpload(desktop, window, 'Any interface.bin', 43);
        await start(window, card);
        await expect(uploadStatus(window)).toHaveText(/^Uploaded · /, { timeout: 30_000 });

        expect(sourcesAt(server), 'where each connection came from').toEqual(['127.0.0.1']);
        expect(networkServices(app), 'the network service, with nothing asking for it').toEqual([]);
        expect(await proxyFor(app, server.baseUrl)).toBe('DIRECT');

        // The tab starts it, for its list of adapters; choosing Any leaves the session as it was.
        await openNetwork(window);
        await expect(networkSelect(window).locator('option')).toHaveText([ANY, `${STAND_IN} · ${STAND_IN_ADDRESS}`]);
        expect(networkServices(app).length).toBe(1);
        await expect(networkSelect(window)).toHaveValue('');
        await expect(networkHelp(window)).toHaveText(ANY_HELP);
        await expect(window.locator('#network-interface-note')).toHaveText(NOTE);
    });
});

test.describe('when the chosen adapter goes', () => {
    test.use({ serverEnv: { UPLOAD_MAX_PAUSE_MINUTES: '30', UPLOAD_MAX_FILE_DOWNLOADS: '5' } });

    test('an upload running fails at once, one queued at its turn, nothing moves to the next server, and Retry works once it is back', async ({ desktop, server }) => {
        const { dns, url } = await byName(desktop, server);
        try {
            const app = await desktop.launch();
            const window = await app.window();
            await chooseStandIn(window);
            await addByName(desktop, window, url);
            // A second saved server below it: the test's server at its own address, whose requests the host header tells.
            await desktop.setUp(window);
            await goToUpload(window);
            await window.evaluate(() => window.kitAPI.setSettings({ transfersAtOnce: 1 }));
            const settings = await saved(window);
            expect(settings.servers.map((saved_) => saved_.url)).toEqual([url, server.baseUrl]);

            const running = await newUpload(desktop, window, 'Going when it goes.bin', 44, { size: 12_000_000 });
            const runningId = (await transfersIn(window)).at(-1).id;
            await window.evaluate((id) => window.electronAPI.setTransferOptions(id, { allowFallback: true }), runningId);
            const transfer = await app.transferWindow();
            const chunks = await holdChunks(transfer);
            await start(window, running);
            await expect(running.locator('.kit-card-status')).toHaveText(/^Uploading /, { timeout: 15_000 });
            await expect.poll(() => chunks.sent.length).toBeGreaterThan(1);

            const queued = await newUpload(desktop, window, 'Waiting its turn.bin', 45);
            const queuedId = (await transfersIn(window)).at(-1).id;
            await window.evaluate((id) => window.electronAPI.setTransferOptions(id, { allowFallback: true }), queuedId);
            await start(window, queued);
            await expect(queued.locator('.kit-card-status')).toHaveText(/^Queued/);

            const before = server.requests().length;
            const went = Date.now();
            desktop.setAdapters({});
            await expect(running.locator('.kit-card-status')).toHaveText(FAILED, { timeout: AT_ONCE_MS + 1_000 });
            expect(Date.now() - went, 'how soon it failed, in ms').toBeLessThan(AT_ONCE_MS + 500);
            await expect(queued.locator('.kit-card-status')).toHaveText(FAILED);
            expect(app.eventsOf('request').filter(({ at, url: tried }) => at >= went && tried.endsWith('/api/v4/uploads')), 'an upload started, even to be refused').toEqual([]);
            await expect(cardButton(running, 'Retry')).toBeVisible();
            await expect(cardButton(queued, 'Retry')).toBeVisible();

            // Nothing else was asked of anyone, from anywhere: no fallback, no other server, no other address.
            await window.waitForTimeout(1_500);
            const after = server.requests().slice(before);
            expect(after.filter(({ method, url: asked }) => method === 'POST' && /^\/api\/v4\/uploads$/.test(asked)), 'an upload started anywhere').toEqual([]);
            expect(after.filter(({ headers }) => !headers.host?.startsWith('dropgate.test')), 'a request to the next server').toEqual([]);
            expect(sourcesAt(server).filter((source) => source !== STAND_IN_ADDRESS && source !== '127.0.0.1'), 'any other source').toEqual([]);

            // A server's Test says why, asking nothing. A file picked now fails at its turn too.
            const asked = server.requests().length;
            await openServers(window);
            const row = serverRow(window, url);
            await row.getByRole('button', { name: 'Test' }).click();
            await expect(serverStatus(row)).toHaveText("Can't connect");
            await expect(serverStatus(row).locator('.kit-status-text')).toHaveAttribute('title', REASON);
            expect(server.requests().length, 'requests during the test').toBe(asked);

            // The tab says so, and keeps it chosen.
            await openNetwork(window);
            await expect(networkSelect(window)).toHaveValue(STAND_IN);
            await expect(networkSelect(window).locator('option:checked')).toHaveText(`${STAND_IN} (not connected)`);
            await expect(networkSelect(window)).toHaveClass(/is-invalid/);
            await expect(networkHelp(window)).toHaveText(GONE_HELP(STAND_IN));
            expect((await saved(window)).networkInterface, 'nothing changes it but the person').toBe(STAND_IN);

            // Back: nothing starts by itself. Retry waits for its Upload, and goes through it.
            desktop.setAdapters({ [STAND_IN]: STAND_IN_ADDRESS });
            await expect(networkHelp(window)).toHaveText(CHOSEN_HELP(STAND_IN));
            await window.waitForTimeout(1_500);
            await goToUpload(window);
            await expect(running.locator('.kit-card-status')).toHaveText(FAILED);
            await expect(queued.locator('.kit-card-status')).toHaveText(FAILED);
            expect(server.requests().length, 'requests since it went, with it back and nothing started').toBe(asked);
            await window.evaluate(() => window.kitAPI.setSettings({ transfersAtOnce: 3 }));
            await cardButton(queued, 'Retry').click();
            await expect(queued.locator('.kit-card-status')).toHaveText('Ready');
            await start(window, queued);
            await expect(queued.locator('.kit-card-status')).toHaveText(/^Uploaded · /, { timeout: 30_000 });
            chunks.release();
        } finally {
            await dns.close();
        }
    });

    test('a download running fails at once, and works again by Retry once it is back', async ({ desktop, server }) => {
        const file = madeUpFile('Download when it goes.bin', 200_000, 46);
        desktop.secrets.addFiles([file]);
        const { link } = await uploadWithCore(server, [file], { maxDownloads: 5 });
        desktop.secrets.addLink(link);
        const app = await desktop.launch();
        const window = await app.window();
        await chooseStandIn(window);
        await addLink(window, link);
        await expect(downloadStatus(window)).toHaveText('Ready');

        const downloader = await app.transferWindow();
        const held = [];
        await downloader.route('**/api/v4/objects/*/content', (route) => {
            held.push(route);
        });
        const before = server.requests().length;
        await cardButton(downloadCard(window), 'Download').click();
        await expect.poll(() => held.length, { message: 'its content should be on its way' }).toBe(1);

        const went = Date.now();
        desktop.setAdapters({});
        await expect(downloadStatus(window)).toHaveText(FAILED, { timeout: AT_ONCE_MS + 1_000 });
        expect(Date.now() - went, 'how soon it failed, in ms').toBeLessThan(AT_ONCE_MS + 500);
        const retry = cardButton(downloadCard(window), 'Retry');
        await expect(retry).toBeVisible();
        expect(sourcesAt(server, before).filter((source) => source !== STAND_IN_ADDRESS), 'any other source').toEqual([]);

        // Started again while it's gone, it fails at its turn.
        await retry.click();
        await cardButton(downloadCard(window), 'Download').click();
        await expect(downloadStatus(window)).toHaveText(FAILED);

        desktop.setAdapters({ [STAND_IN]: STAND_IN_ADDRESS });
        await openNetwork(window);
        await expect(networkHelp(window)).toHaveText(CHOSEN_HELP(STAND_IN));
        await window.locator('#nav-rail').getByRole('button', { name: 'Download' }).click();
        await downloader.unroute('**/api/v4/objects/*/content');
        await cardButton(downloadCard(window), 'Retry').click();
        await cardButton(downloadCard(window), 'Download').click();
        await expect(downloadStatus(window)).toHaveText(/^Saved to /, { timeout: 30_000 });
    });

    test('a paused upload stays paused, its Resume refused with why, and resumes once it is back', async ({ desktop, server }) => {
        const app = await desktop.launch();
        const window = await app.window();
        await chooseStandIn(window);
        await desktop.setUp(window);
        const card = await newUpload(desktop, window, 'Paused when it goes.bin', 47, { size: 12_000_000 });
        const transfer = await app.transferWindow();
        const chunks = await holdChunks(transfer);
        await start(window, card);
        await expect(card.locator('.kit-card-status')).toHaveText(/^Uploading /, { timeout: 15_000 });
        await cardButton(card, 'Pause').click();
        await expect(card.locator('.kit-card-status')).toHaveText(/^Paused/);
        chunks.release();

        desktop.setAdapters({});
        await openNetwork(window);
        await expect(networkHelp(window)).toHaveText(GONE_HELP(STAND_IN));
        await goToUpload(window);
        await expect(card.locator('.kit-card-status')).toHaveText(/^Paused/);

        await cardButton(card, 'Resume').click();
        await expect(window.getByText(REASON, { exact: true }), 'the toast').toBeVisible();
        await expect(card.locator('.kit-card-status')).toHaveText(/^Paused/);

        desktop.setAdapters({ [STAND_IN]: STAND_IN_ADDRESS });
        await openNetwork(window);
        await expect(networkHelp(window)).toHaveText(CHOSEN_HELP(STAND_IN));
        await goToUpload(window);
        await cardButton(card, 'Resume').click();
        await expect(card.locator('.kit-card-status')).toHaveText(/^Uploaded · /, { timeout: 30_000 });
        expect(sourcesAt(server).filter((source) => source !== STAND_IN_ADDRESS), 'any other source').toEqual([]);
    });
});

test.describe('a launch with the chosen adapter gone', () => {
    test('Share with Dropgate says why and quits, with nothing asked of the server', async ({ desktop, server }) => {
        const first = await desktop.launch();
        const window = await first.window();
        await chooseStandIn(window);
        await desktop.setUp(window);
        await first.quit();
        const before = server.requests().length;

        desktop.setAdapters({});
        const app = await desktop.share(desktop.addFile(madeUpFile('Shared with it gone.bin', 10_000, 50)));
        expect(await app.exited(), 'its exit code').toBe(0);
        expect(app.eventsOf('notification').at(-1), 'the last notification').toMatchObject({ title: 'Upload Failed', body: REASON });
        expect(server.requests().length, 'requests that reached the server').toBe(before);
    });

    test('the window shows it not connected, chosen still, and a server says why', async ({ desktop, server }) => {
        const first = await desktop.launch();
        const before = await first.window();
        await chooseStandIn(before);
        await desktop.setUp(before);
        await first.quit();

        desktop.setAdapters({});
        const app = await desktop.launch();
        const window = await app.window();
        await openNetwork(window);
        await expect(networkSelect(window)).toHaveValue(STAND_IN);
        await expect(networkSelect(window).locator('option:checked')).toHaveText(`${STAND_IN} (not connected)`);
        await expect(networkHelp(window)).toHaveText(GONE_HELP(STAND_IN));
        await openServers(window);
        const row = serverRow(window, server.baseUrl);
        await row.getByRole('button', { name: 'Test' }).click();
        await expect(serverStatus(row)).toHaveText("Can't connect");
        await expect(serverStatus(row).locator('.kit-status-text')).toHaveAttribute('title', REASON);
    });
});

test.describe('when the network service stops', () => {
    test('killed, what runs fails, nothing reaches the server from anywhere else, and it is started again', async ({ desktop, server }) => {
        const app = await desktop.launch();
        const window = await app.window();
        await chooseStandIn(window);
        await desktop.setUp(window);
        const card = await newUpload(desktop, window, 'Service killed.bin', 48, { size: 12_000_000 });
        const transfer = await app.transferWindow();
        const chunks = await holdChunks(transfer);
        await start(window, card);
        await expect(card.locator('.kit-card-status')).toHaveText(/^Uploading /, { timeout: 15_000 });
        await expect.poll(() => chunks.sent.length).toBeGreaterThan(1);
        expect(networkServices(app).length).toBe(1);

        const before = server.requests().length;
        await app.app.evaluate(() => globalThis.__dropgateNetworkService.kill());
        await expect(card.locator('.kit-card-status')).toHaveText(FAILED, { timeout: AT_ONCE_MS + 1_000 });
        await expect(cardButton(card, 'Retry')).toBeVisible();

        // Started again by itself, and held to the adapter as before.
        await expect.poll(() => networkServices(app).length, { message: 'the service, started again', timeout: 15_000 }).toBe(2);
        await openServers(window);
        const row = serverRow(window, server.baseUrl);
        await expect(async () => {
            await row.getByRole('button', { name: 'Test' }).click();
            await expect(serverStatus(row)).toHaveText(/^Online · /, { timeout: 2_000 });
        }).toPass({ timeout: 15_000 });
        expect(sourcesAt(server, before).filter((source) => source !== STAND_IN_ADDRESS), 'any other source').toEqual([]);
        chunks.release();
    });

    test('never listening, nothing connects: the session points at nothing, and a request sent regardless reaches no server', async ({ desktop, server }) => {
        // Saved from a run before.
        const first = await desktop.launch();
        const window = await first.window();
        await chooseStandIn(window);
        await desktop.setUp(window);
        await first.quit();

        desktop.silentNetwork = true;
        const app = await desktop.launch();
        const silent = await app.window();
        await expect.poll(() => silent.evaluate(() => window.electronAPI.watchNetwork(false)), { message: 'the adapter taken as gone', timeout: 15_000 })
            .toEqual({ name: STAND_IN, present: false, adapters: null });

        const before = server.requests().length;
        await openServers(silent);
        const row = serverRow(silent, server.baseUrl);
        await row.getByRole('button', { name: 'Test' }).click();
        await expect(serverStatus(row)).toHaveText("Can't connect");

        // The page's own request, by a route nothing guards: refused by the proxy setting alone.
        const transfer = await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((win) => win.webContents.getURL().endsWith('/transfer.html')));
        if (!transfer) await silent.evaluate((url) => window.electronAPI.checkServer(url), server.baseUrl);
        const page = await app.transferWindow();
        const answer = await page.evaluate((url) => fetch(`${url}/api/info`).then(() => 'answered', (error) => `refused: ${error.message}`), server.baseUrl);
        expect(answer).toMatch(/^refused: /);
        expect(server.requests().length, 'requests that reached the server').toBe(before);
    });
});

test.describe('the setting', () => {
    test('a version 3 profile is brought to version 4 once, its servers kept; the page is refused the adapter; only a name the service lists now, or none, is taken', async ({ desktop, server }) => {
        const servers = [{ id: '11111111-1111-4111-8111-111111111111', url: server.baseUrl, name: 'Kept', lifetime: { value: 3, unit: 'days' }, maxDownloads: 2, allowFallback: true }];
        fs.mkdirSync(desktop.profile, { recursive: true });
        const file = path.join(desktop.profile, 'config.json');
        fs.writeFileSync(file, JSON.stringify({ settings: { servers, defaultServer: servers[0].id, downloadFolder: null, transfersAtOnce: 5 }, settingsSchema: 3 }));

        const app = await desktop.launch();
        const window = await app.window();
        const stored = () => JSON.parse(fs.readFileSync(file, 'utf8'));
        expect(stored().settingsSchema).toBe(4);
        expect(stored().settings).toMatchObject({
            servers, defaultServer: servers[0].id, transfersAtOnce: 5, networkInterface: null, networkBar: false, externalIpCheck: false, barShowsIpv4: true, barShowsIpv6: true, locationRefresh: false,
        });

        // Through the kit, the page is refused it.
        const refused = await window.evaluate(() => window.kitAPI.setSettings({ networkInterface: 'Anything' }).then(() => 'taken', (error) => error.message));
        expect(refused).toMatch(/networkInterface.+can't be changed from the page/);

        // Through main, only what's there now.
        await openNetwork(window);
        await expect(networkSelect(window).locator('option')).toHaveText([ANY, `${STAND_IN} · ${STAND_IN_ADDRESS}`]);
        const asked = await window.evaluate(() => window.electronAPI.setNetworkInterface('Not There').then(() => 'taken', (error) => error.message));
        expect(asked).toMatch(/Not There isn't connected\./);
        for (const junk of [7, '', {}, ['Test Adapter']]) {
            const answer = await window.evaluate((name) => window.electronAPI.setNetworkInterface(name).then(() => 'taken', () => 'refused'), junk);
            expect(answer, `set-interface with ${JSON.stringify(junk)}`).toBe('refused');
        }
        expect(stored().settings.networkInterface).toBeNull();

        // A second adapter appears in the list as the tab shows.
        desktop.setAdapters({ [STAND_IN]: STAND_IN_ADDRESS, 'Second Adapter': '127.0.0.4' });
        await expect(networkSelect(window).locator('option')).toHaveText([ANY, `${STAND_IN} · ${STAND_IN_ADDRESS}`, 'Second Adapter · 127.0.0.4']);

        // Chosen, and back to none: the name is saved, and then isn't.
        await networkSelect(window).selectOption('Second Adapter');
        await expect(networkHelp(window)).toHaveText(CHOSEN_HELP('Second Adapter'));
        expect(stored().settings.networkInterface).toBe('Second Adapter');
        await networkSelect(window).selectOption('');
        await expect(networkHelp(window)).toHaveText(ANY_HELP);
        expect(stored().settings.networkInterface).toBeNull();

        // Once only: a change made since isn't undone by the next launch.
        await window.evaluate(() => window.kitAPI.setSettings({ networkBar: true }));
        await saved(window);
        await app.quit();
        const again = await desktop.launch();
        await again.window();
        expect(stored().settings.networkBar).toBe(true);
        expect(stored().settings.servers).toEqual(servers);
    });

    test('with something running, changing the adapter asks first, and stops it on its old route', async ({ desktop, server }) => {
        const app = await desktop.launch();
        const window = await app.window();
        await desktop.setUp(window);
        const card = await newUpload(desktop, window, 'Running as it changes.bin', 49, { size: 12_000_000 });
        const transfer = await app.transferWindow();
        const chunks = await holdChunks(transfer);
        await start(window, card);
        await expect(card.locator('.kit-card-status')).toHaveText(/^Uploading /, { timeout: 15_000 });

        await openNetwork(window);
        const prompt = window.getByRole('alertdialog', { name: 'Change the Network Interface?' });
        await networkSelect(window).selectOption(STAND_IN);
        await expect(prompt).toContainText('1 transfer is running, and changing the network interface stops it. Retry starts it again.');
        await prompt.getByRole('button', { name: 'Cancel' }).click();
        await expect(networkSelect(window)).toHaveValue('');
        expect(await transfersIn(window).then((list) => list.at(-1).state)).toBe('running');

        await networkSelect(window).selectOption(STAND_IN);
        await prompt.getByRole('button', { name: 'Change and Stop' }).click();
        await expect(networkHelp(window)).toHaveText(CHOSEN_HELP(STAND_IN));
        await goToUpload(window);
        await expect(card.locator('.kit-card-status')).toHaveText('Failed: The network interface changed.');
        await expect(cardButton(card, 'Retry')).toBeVisible();
        chunks.release();

        const before = server.requests().length;
        await cardButton(card, 'Retry').click();
        await start(window, card);
        await expect(card.locator('.kit-card-status')).toHaveText(/^Uploaded · /, { timeout: 30_000 });
        expect(sourcesAt(server, before), 'where the retry came from').toEqual([STAND_IN_ADDRESS]);
    });
});
