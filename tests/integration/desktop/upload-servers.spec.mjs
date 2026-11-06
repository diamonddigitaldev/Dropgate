// Each upload's own server. A new upload starts on the default server, with
// its settings for new uploads; its "To" lists every saved server by name,
// and while it waits moves it to another, whose settings it takes, and the
// bulk bar's "Upload all to" (or "Upload selected to") moves several. Its
// settings line, Advanced Options and its bounds, its encryption and the
// Upload Security Warning go by its own server's last check, and Upload sends
// it there; once it starts, its server is locked. A server is asked nothing
// until it's used: at launch only the default is checked, and another only
// when an upload picks it or starts on it, or it's tested or added. Share
// with Dropgate stays on the default, with its settings.
//
// Two saved servers are the test's one server at two addresses: the TLS
// proxy's (https://, so uploads are end-to-end encrypted, the default) and
// the server's own (http://, plain). The proxy tells the server a request
// came through it (X-Forwarded-Proto), so the server's record says which
// address each request reached. The plain address's limits are made tighter
// than the server's own in the transfer window (its /api/info answer), so
// each upload's bounds can be told apart.
import fs from 'node:fs';
import path from 'node:path';
import { madeUpFile } from '../helpers/files.mjs';
import {
    ENCRYPTED, NOT_ENCRYPTED, cardButton, expect, openServers, securityWarning, serverRow, serverStatus, test, transfersIn, uploadCards,
} from '../helpers/desktop.mjs';

test.use({
    tlsProxy: true,
    serverEnv: { SERVER_NAME: 'Share Space', UPLOAD_MAX_FILE_DOWNLOADS: '5', UPLOAD_MAX_FILE_LIFETIME_HOURS: '72' },
});

const HOUR = 3_600_000;

/** The plain address's limits, as its /api/info is answered in the transfer window: tighter than the server's own. */
const PLAIN_LIMITS = { maxLifetimeHours: 6, maxFileDownloads: 2 };

/** Whether a request the server received came through the TLS proxy (the https:// address), or straight to its own. */
const viaProxy = ({ headers }) => headers['x-forwarded-proto'] === 'https';

/** The requests the server has received at each address, from `since` (an index into its record) on. */
function requestsAt(server, since = 0) {
    const seen = server.requests().slice(since);
    return { secure: seen.filter(viaProxy), plain: seen.filter((request) => !viaProxy(request)) };
}

/** The upload starts the server received at each address, in order. */
const startsAt = (server) => server.requests().filter(({ method, url }) => method === 'POST' && /^\/api\/v4\/uploads$/.test(url))
    .map((request) => ({ at: viaProxy(request) ? 'secure' : 'plain', ...JSON.parse(request.body.toString('utf8')) }));

/**
 * Answer the plain address's /api/info with its tighter limits, for every
 * window of this run: the transfer window, where checks run, closes when it
 * has had nothing to do for a while, and a new one opens for the next.
 */
async function tightenPlain(app, server) {
    await app.app.context().route(`${server.baseUrl}/api/info`, async (route) => {
        const response = await route.fetch();
        const info = await response.json();
        Object.assign(info.capabilities.upload, PLAIN_LIMITS);
        await route.fulfill({ response, json: info });
    });
}

/** Both addresses saved, the https:// one first (the default); the plain one's settings for new uploads 2 hours and 2 downloads. */
async function saveBoth(desktop, app, window, server) {
    await tightenPlain(app, server);
    await desktop.setUp(window);
    await desktop.setUp(window, { url: server.baseUrl, lifetime: { value: 2, unit: 'hours' }, maxDownloads: 2 });
}

/** The saved servers' IDs, by address, as the app wrote them. */
function savedIds(desktop) {
    const { servers = [] } = JSON.parse(fs.readFileSync(path.join(desktop.profile, 'config.json'), 'utf8')).settings ?? {};
    return Object.fromEntries(servers.map(({ url, id }) => [url, id]));
}

/** Write made-up files to the test's folder, and return their paths. */
function filesFor(desktop, names, seed, { storedByServer = false } = {}) {
    return names.map((name, i) => {
        const file = madeUpFile(name, 30_000, seed + i);
        desktop.secrets.addFiles([file], { storedByServer });
        return desktop.addFile(file);
    });
}

/** The upload card named so. */
const named = (window, name) => uploadCards(window).filter({ has: window.locator('.kit-card-name', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });

/** A card's "To". */
const toOf = (card) => card.getByRole('combobox', { name: 'Upload to' });

/** A select's options' labels, and the value chosen. */
const shownOf = (select) => select.evaluate((element) => ({ labels: [...element.options].map((option) => option.textContent), value: element.value }));

/** Each upload in main's registry, by its first file's name: the saved server it goes to, and its lifetime and download limit. */
async function registry(window) {
    return Object.fromEntries((await transfersIn(window)).map(({ files: [{ name }], server, options }) => [name, { server: server?.id, lifetime: options.lifetime, maxDownloads: options.maxDownloads }]));
}

test('a new upload starts on the default with its settings; its "To" lists every saved server and moves it, with that server\'s settings, line, bounds, encryption and warning, and Upload sends it there; started, it\'s locked', async ({ desktop, server }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await saveBoth(desktop, app, window, server);
    const ids = savedIds(desktop);
    const [secureHost, plainHost] = [new URL(desktop.serverUrl).host, new URL(server.baseUrl).host];

    // A new upload: on the default, with its settings (24 hours, 1 download); nothing differs, so no settings line.
    const [moved] = filesFor(desktop, ['Moved to the plain one.bin'], 600, { storedByServer: true });
    await window.locator('#file-input').setInputFiles([moved]);
    const card = named(window, 'Moved to the plain one.bin');
    expect(await shownOf(toOf(card)), 'every saved server by name, the same name told apart by its host, the default chosen').toEqual({
        labels: [`Share Space (${secureHost}) (default)`, `Share Space (${plainHost})`],
        value: ids[desktop.serverUrl],
    });
    await expect(card.locator('.kit-card-settings')).toBeHidden();
    expect((await registry(window))['Moved to the plain one.bin']).toEqual({ server: ids[desktop.serverUrl], lifetime: { value: 24, unit: 'hours' }, maxDownloads: 1 });

    // Moved: it takes the plain one's settings, and its line says it won't be encrypted.
    await toOf(card).selectOption(ids[server.baseUrl]);
    await expect(card.locator('.kit-card-settings')).toHaveText('Not encrypted: This server is plain HTTP.');
    await expect.poll(async () => (await registry(window))['Moved to the plain one.bin'], { message: 'its server and settings in main' })
        .toEqual({ server: ids[server.baseUrl], lifetime: { value: 2, unit: 'hours' }, maxDownloads: 2 });

    // Its Advanced Options: bounded by the plain one's limits, which it names, and its encryption.
    await card.getByRole('button', { name: 'Advanced Options' }).click();
    const dialog = window.getByRole('dialog', { name: 'Advanced Options' });
    await expect(dialog.locator('#options-lifetime-help')).toHaveText(`${plainHost} keeps files up to 6 hours.`);
    await expect(dialog.locator('#options-downloads-help')).toHaveText(`${plainHost} allows up to 2 downloads.`);
    await expect(dialog.getByLabel('Max downloads')).toHaveAttribute('max', '2');
    await expect(dialog.locator('.options-encryption')).toHaveText(`gpp_badNot encrypted: ${plainHost} is plain HTTP, so the server can read your files.`);
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    // Upload: the Upload Security Warning first, then it goes to the plain address, with its settings.
    await cardButton(card, 'Upload').click();
    await securityWarning(window).getByRole('button', { name: 'Upload Anyway' }).click();
    await expect(card.locator('.kit-card-status')).toHaveText('Uploaded · Not Encrypted', { timeout: 30_000 });
    desktop.secrets.addLink(await card.getByRole('textbox', { name: 'Link' }).inputValue());
    expect(startsAt(server).map(({ at, encrypted, lifetimeMs, maxDownloads }) => ({ at, encrypted, lifetimeMs, maxDownloads })), 'the upload the server was asked to start')
        .toEqual([{ at: 'plain', encrypted: false, lifetimeMs: 2 * HOUR, maxDownloads: 2 }]);
    await expect(toOf(card), 'its server, locked once it has started').toBeDisabled();

    // One left on the default goes there, end-to-end encrypted, with no warning.
    const [stayed] = filesFor(desktop, ['Stayed on the default.bin'], 610);
    await window.locator('#file-input').setInputFiles([stayed]);
    await cardButton(named(window, 'Stayed on the default.bin'), 'Upload').click();
    await expect(named(window, 'Stayed on the default.bin').locator('.kit-card-status')).toHaveText('Uploaded · End-to-End Encrypted', { timeout: 30_000 });
    desktop.secrets.addLink(await named(window, 'Stayed on the default.bin').getByRole('textbox', { name: 'Link' }).inputValue());
    expect(startsAt(server).at(-1)).toMatchObject({ at: 'secure', encrypted: true, lifetimeMs: 24 * HOUR, maxDownloads: 1 });
    await expect(securityWarning(window)).toHaveCount(0);
});

test('"Upload all to" moves every upload waiting, and "Upload selected to" those selected; Upload All sends each to its own, asking the Upload Security Warning once for the plain one', async ({ desktop, server }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await saveBoth(desktop, app, window, server);
    const ids = savedIds(desktop);
    const bulk = window.locator('#upload-bulk');
    const target = bulk.locator('select');

    const paths = filesFor(desktop, ['Bulk one.bin', 'Bulk two.bin', 'Bulk three.bin'], 620, { storedByServer: true });
    for (const file of paths) await window.locator('#file-input').setInputFiles([file]);
    await expect(uploadCards(window)).toHaveCount(3);
    await expect(bulk.getByText('Upload all to')).toBeVisible();
    expect((await shownOf(target)).value, 'the bulk bar starts on the default').toBe(ids[desktop.serverUrl]);

    // Upload all to: every one waiting moves, with the plain one's settings.
    await target.selectOption(ids[server.baseUrl]);
    await expect.poll(async () => Object.values(await registry(window)).map(({ server: id }) => id), { message: 'each one\'s server in main' })
        .toEqual([ids[server.baseUrl], ids[server.baseUrl], ids[server.baseUrl]]);
    for (const name of ['Bulk one.bin', 'Bulk two.bin', 'Bulk three.bin']) {
        await expect(toOf(named(window, name)), name).toHaveValue(ids[server.baseUrl]);
    }

    // Upload selected to: only the one selected moves back, with the default's settings.
    await named(window, 'Bulk two.bin').locator('.kit-card-meta').click();
    await expect(bulk.getByText('Upload selected to')).toBeVisible();
    await target.selectOption(ids[desktop.serverUrl]);
    await expect.poll(async () => registry(window), { message: 'each one\'s server and settings in main' }).toEqual({
        'Bulk one.bin': { server: ids[server.baseUrl], lifetime: { value: 2, unit: 'hours' }, maxDownloads: 2 },
        'Bulk two.bin': { server: ids[desktop.serverUrl], lifetime: { value: 24, unit: 'hours' }, maxDownloads: 1 },
        'Bulk three.bin': { server: ids[server.baseUrl], lifetime: { value: 2, unit: 'hours' }, maxDownloads: 2 },
    });
    await window.keyboard.press('Escape');

    // Upload All: the plain ones ask once; each goes to its own address.
    await window.locator('#action-bar').getByRole('button', { name: 'Upload All', exact: true }).click();
    await securityWarning(window).getByRole('button', { name: 'Upload Anyway' }).click();
    for (const name of ['Bulk one.bin', 'Bulk two.bin', 'Bulk three.bin']) {
        await expect(named(window, name).locator('.kit-card-status'), name).toHaveText(/^Uploaded · /, { timeout: 30_000 });
        desktop.secrets.addLink(await named(window, name).getByRole('textbox', { name: 'Link' }).inputValue());
    }
    await expect(securityWarning(window), 'asked once').toHaveCount(0);
    expect(startsAt(server).map(({ at, encrypted, maxDownloads }) => ({ at, encrypted, maxDownloads })).sort((a, b) => a.at.localeCompare(b.at)), 'the uploads the server was asked to start').toEqual([
        { at: 'plain', encrypted: false, maxDownloads: 2 },
        { at: 'plain', encrypted: false, maxDownloads: 2 },
        { at: 'secure', encrypted: true, maxDownloads: 1 },
    ]);
    await expect(target, 'with none left waiting, the bulk bar still shows').toBeVisible();
});

test('at launch only the default server is asked anything; another only once an upload picks it (not again while this run found it) or starts on it; what was found is kept in memory only', async ({ desktop, server }) => {
    let app = await desktop.launch();
    let window = await app.window();
    await saveBoth(desktop, app, window, server);
    await app.quit();

    // Launched again: only the default is checked.
    const since = server.requests().length;
    app = await desktop.launch();
    window = await app.window();
    await tightenPlain(app, server);
    await openServers(window);
    await expect(serverStatus(serverRow(window, desktop.serverUrl))).toHaveText(ENCRYPTED);
    await expect(serverStatus(serverRow(window, server.baseUrl))).toHaveText('Not checked yet');
    expect(requestsAt(server, since).secure.map(({ url }) => url), 'the default, checked as the window opened').toEqual(['/api/info']);
    expect(requestsAt(server, since).plain, 'the other, asked nothing').toEqual([]);

    // A new upload on the default asks nothing of the other.
    await window.locator('#nav-rail').getByRole('button', { name: 'Upload' }).click();
    const [first, second] = filesFor(desktop, ['Picked first.bin', 'Picked second.bin'], 640, { storedByServer: true });
    await window.locator('#file-input').setInputFiles([first]);
    await expect(uploadCards(window)).toHaveCount(1);
    expect(requestsAt(server, since).plain, 'the other, still asked nothing').toEqual([]);

    // Picked: it's checked now, and its row says what it found.
    const ids = savedIds(desktop);
    await toOf(named(window, 'Picked first.bin')).selectOption(ids[server.baseUrl]);
    await expect.poll(() => requestsAt(server, since).plain.map(({ url }) => url), { message: 'the plain one, checked as it was picked' }).toEqual(['/api/info']);
    await expect(named(window, 'Picked first.bin').locator('.kit-card-settings')).toHaveText('Not encrypted: This server is plain HTTP.');

    // Picked again by another upload: this run found it already, so it isn't asked again.
    await window.locator('#file-input').setInputFiles([second]);
    await toOf(named(window, 'Picked second.bin')).selectOption(ids[server.baseUrl]);
    await expect.poll(async () => (await registry(window))['Picked second.bin'].server).toBe(ids[server.baseUrl]);
    await window.waitForTimeout(500);
    expect(requestsAt(server, since).plain.map(({ url }) => url), 'not asked again').toEqual(['/api/info']);

    // Started on it: checked again, then the upload.
    await cardButton(named(window, 'Picked first.bin'), 'Upload').click();
    await securityWarning(window).getByRole('button', { name: 'Upload Anyway' }).click();
    await expect(named(window, 'Picked first.bin').locator('.kit-card-status')).toHaveText('Uploaded · Not Encrypted', { timeout: 30_000 });
    desktop.secrets.addLink(await named(window, 'Picked first.bin').getByRole('textbox', { name: 'Link' }).inputValue());
    const plain = requestsAt(server, since).plain.map(({ method, url }) => `${method} ${url}`);
    expect(plain.slice(0, 3), 'the plain one: picked, then checked again as the upload started on it, then the upload').toEqual(['GET /api/info', 'GET /api/info', 'POST /api/v4/uploads']);
    await openServers(window);
    await expect(serverStatus(serverRow(window, server.baseUrl))).toHaveText(NOT_ENCRYPTED);

    // Nothing a check found is written down.
    await window.evaluate(() => window.kitAPI.getSettings());
    expect(fs.readFileSync(path.join(desktop.profile, 'config.json'), 'utf8'), 'what the checks found, in the settings').not.toMatch(/maxLifetimeHours|maxFileDownloads|capabilities|"version"/);
});

test('Share with Dropgate stays on the default server, with its settings for new uploads, and asks nothing of the other', async ({ desktop, server }) => {
    const setUp = await desktop.launch();
    const window = await setUp.window();
    await tightenPlain(setUp, server);
    await desktop.setUp(window, { lifetime: { value: 30, unit: 'minutes' } });
    await desktop.setUp(window, { url: server.baseUrl, lifetime: { value: 2, unit: 'hours' }, maxDownloads: 2 });
    await setUp.quit();

    const file = madeUpFile('Shared to the default.bin', 30_000, 660);
    desktop.secrets.addFiles([file]);
    const since = server.requests().length;
    const app = await desktop.share(desktop.addFile(file));
    expect(await app.exited(), "the app's exit code").toBe(0);
    for (const { text } of app.eventsOf('clipboard')) desktop.secrets.addLink(text);
    expect(app.eventsOf('upload-finished').map(({ status }) => status), 'how the share finished').toEqual(['success']);
    expect(startsAt(server).map(({ at, encrypted, lifetimeMs, maxDownloads }) => ({ at, encrypted, lifetimeMs, maxDownloads })), 'the upload the server was asked to start')
        .toEqual([{ at: 'secure', encrypted: true, lifetimeMs: 30 * 60_000, maxDownloads: 1 }]);
    expect(requestsAt(server, since).plain, 'the other server, asked nothing').toEqual([]);
});
