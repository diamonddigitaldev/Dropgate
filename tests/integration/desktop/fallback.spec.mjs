// The fallback (phase 14). With Allow Fallback on (each server's, for new
// uploads to it, and each upload's own, in Advanced Options), an upload its
// server can't take before any byte is sent moves to the next saved server
// below it, which is checked only then, and says which took it. A server
// that would be a step down (plain HTTP after HTTPS, not encrypted, a shorter
// lifetime) is never used without the window asking; answered Cancel, the
// upload stops, on its own server, with that server's reason. A failure once
// the server has taken the upload's start fails it, with Retry, and nothing
// moves; with Allow Fallback off, the upload stops and says why.
//
// Two saved servers are the test's one server at two addresses, as in
// upload-servers.spec.mjs: the TLS proxy's (https://, end-to-end encrypted)
// and the server's own (http://, plain), whose limits are tighter in the
// transfer window. The proxy tells the server a request came through it
// (X-Forwarded-Proto), so the server's record says which address each
// request reached. A server that "can't take" an upload is made so in the
// app: its requests refused before they leave (unreachable), or its answer
// to the upload's start (or a chunk) made a full server's.
import fs from 'node:fs';
import path from 'node:path';
import { madeUpFile } from '../helpers/files.mjs';
import {
    ENCRYPTED, cardButton, expect, openServers, saved, securityWarning, serverRow, serverStatus, test, transfersIn, uploadCards,
} from '../helpers/desktop.mjs';

test.use({
    tlsProxy: true,
    serverEnv: { SERVER_NAME: 'Share Space', UPLOAD_MAX_FILE_DOWNLOADS: '5', UPLOAD_MAX_FILE_LIFETIME_HOURS: '72' },
});

const HOUR = 3_600_000;

/** A full server's answer, as Dropgate Server gives it. */
const FULL = { status: 507, json: { code: 'SERVER_FULL', error: 'The server is out of space. Try again later.' } };

/** The help lines of a server's Allow Fallback, on and off. */
const SERVER_HELP = {
    on: "A new upload to this server may move on to the next server below if this one can't take it before it starts. Each upload's Advanced Options can change it.",
    off: "A new upload to this server goes here only. Each upload's Advanced Options can change it.",
};

/** Whether a request the server received came through the TLS proxy (the https:// address), or straight to its own. */
const viaProxy = ({ headers }) => headers['x-forwarded-proto'] === 'https';

/** The requests the server has received at each address, from `since` (an index into its record) on, as "METHOD /path". */
function requestsAt(server, since = 0) {
    const seen = server.requests().slice(since);
    const line = ({ method, url }) => `${method} ${url}`;
    return { secure: seen.filter(viaProxy).map(line), plain: seen.filter((request) => !viaProxy(request)).map(line) };
}

/** The upload starts the server received, in order, and where. */
const startsAt = (server) => server.requests().filter(({ method, url }) => method === 'POST' && /^\/api\/v4\/uploads$/.test(url))
    .map((request) => ({ at: viaProxy(request) ? 'secure' : 'plain', ...JSON.parse(request.body.toString('utf8')) }));

/** The plain address's /api/info, answered in the app with tighter limits: 6 hours, 2 downloads. */
async function tightenPlain(app, server) {
    await app.app.context().route(`${server.baseUrl}/api/info`, async (route) => {
        const response = await route.fetch();
        const info = await response.json();
        Object.assign(info.capabilities.upload, { maxLifetimeHours: 6, maxFileDownloads: 2 });
        await route.fulfill({ response, json: info });
    });
}

/** The saved servers' IDs, by address, as the app wrote them. */
function savedIds(desktop) {
    const { servers = [] } = JSON.parse(fs.readFileSync(path.join(desktop.profile, 'config.json'), 'utf8')).settings ?? {};
    return Object.fromEntries(servers.map(({ url, id }) => [url, id]));
}

/** A saved server's Allow Fallback, in its row in Settings > Servers, set as a person does, and saved; its help line says what it does now. */
async function allowFallback(window, url, on) {
    await openServers(window);
    const row = serverRow(window, url);
    if (await row.getByRole('button', { name: 'Show Settings' }).isVisible()) await row.getByRole('button', { name: 'Show Settings' }).click();
    const toggle = row.getByRole('switch', { name: 'Allow Fallback' });
    await toggle.setChecked(on);
    await expect(row.locator('.kit-switch-field .form-text')).toHaveText(on ? SERVER_HELP.on : SERVER_HELP.off);
    await expect.poll(async () => (await saved(window)).servers.find((server) => server.url === url)?.allowFallback, { message: 'saved' }).toBe(on);
    await window.locator('#nav-rail').getByRole('button', { name: 'Upload' }).click();
}

/** A new upload of one made-up file, picked from the test's folder. Returns its card. */
async function newUpload(desktop, window, name, seed, { storedByServer = false } = {}) {
    const file = madeUpFile(name, 30_000, seed);
    desktop.secrets.addFiles([file], { storedByServer });
    const before = await uploadCards(window).count();
    await window.locator('#file-input').setInputFiles([desktop.addFile(file)]);
    await expect(uploadCards(window)).toHaveCount(before + 1);
    return uploadCards(window).filter({ has: window.locator('.kit-card-name', { hasText: name }) });
}

/** A card's "To". */
const toOf = (card) => card.getByRole('combobox', { name: 'Upload to' });

/** The fallback's question: the next server would be a step down. */
const fallbackQuestion = (window) => window.getByRole('alertdialog', { name: /^Upload to .+ Instead\?$/ });

test('an upload its server refuses before any byte is sent moves to the next server below, checked only then, at once where that\'s no step down, and says which took it', async ({ desktop, server }) => {
    let app = await desktop.launch();
    let window = await app.window();
    // The plain address first, the default, with Allow Fallback on; the https:// one below it.
    await desktop.setUp(window, { url: server.baseUrl });
    await desktop.setUp(window);
    await allowFallback(window, server.baseUrl, true);
    await app.quit();

    // Launched again: only the default is checked, and the plain address refuses every upload's start, as a full server does.
    const since = server.requests().length;
    app = await desktop.launch();
    window = await app.window();
    await app.app.context().route(`${server.baseUrl}/api/v4/uploads`, (route) => route.fulfill(FULL));
    const ids = savedIds(desktop);
    const card = await newUpload(desktop, window, 'Fell back.bin', 700);
    expect((await transfersIn(window)).at(-1).options.allowFallback, "a new upload takes its server's Allow Fallback").toBe(true);
    await expect(card.locator('.kit-card-settings'), 'nothing differs from its server: only that it would go plain').toHaveText('Not encrypted: This server is plain HTTP.');
    expect(requestsAt(server, since).secure, 'the one below, asked nothing yet').toEqual([]);

    // Upload: it's asked about the plain one it's going to, then refused there, then goes to the one below, encrypted, unasked.
    await cardButton(card, 'Upload').click();
    await securityWarning(window).getByRole('button', { name: 'Upload Anyway' }).click();
    await expect(card.locator('.kit-card-status')).toHaveText('Uploaded to Share Space · End-to-End Encrypted', { timeout: 30_000 });
    desktop.secrets.addLink(await card.getByRole('textbox', { name: 'Link' }).inputValue());
    await expect(fallbackQuestion(window), 'no step down: nothing asked').toHaveCount(0);
    // The server it moved from; and its Allow Fallback, the plain one's, which the one that took it doesn't have.
    await expect(card.locator('.kit-card-settings')).toHaveText('Moved From Share Space · Allow Fallback');
    await expect(toOf(card), 'the server that took it').toHaveValue(ids[desktop.serverUrl]);
    await expect(toOf(card)).toBeDisabled();

    // The one below was checked only as the upload fell back, then took it; the plain one never got its start.
    const secure = requestsAt(server, since).secure;
    expect(secure.slice(0, 2), 'the one below: checked as it fell back, then the upload').toEqual(['GET /api/info', 'POST /api/v4/uploads']);
    expect(startsAt(server).map(({ at, encrypted, lifetimeMs, maxDownloads }) => ({ at, encrypted, lifetimeMs, maxDownloads })), 'the uploads the server was asked to start')
        .toEqual([{ at: 'secure', encrypted: true, lifetimeMs: 24 * HOUR, maxDownloads: 1 }]);
    // Its row says what that check found.
    await openServers(window);
    await expect(serverStatus(serverRow(window, desktop.serverUrl))).toHaveText(ENCRYPTED);
});

test('a step down is never used without asking: plain HTTP after HTTPS, with a shorter lifetime, is asked first; Upload There sends it with that server\'s limits, and Cancel stops it on its own server, with its reason', async ({ desktop, server }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await tightenPlain(app, server);
    // The https:// address first, the default, with Allow Fallback on; the plain one below it, tighter.
    await desktop.setUp(window);
    await desktop.setUp(window, { url: server.baseUrl });
    await allowFallback(window, desktop.serverUrl, true);
    const ids = savedIds(desktop);
    const [secureHost, plainHost] = [new URL(desktop.serverUrl).host, new URL(server.baseUrl).host];

    // The https:// address can't be reached from now on.
    await app.app.context().route(`${desktop.serverUrl}/**`, (route) => route.abort('connectionrefused'));
    const since = server.requests().length;

    // Upload: its server can't be reached, so it falls back, and the one below would be a step down: asked.
    const card = await newUpload(desktop, window, 'Asked first.bin', 710, { storedByServer: true });
    await cardButton(card, 'Upload').click();
    const question = fallbackQuestion(window);
    await expect(question).toHaveAccessibleName(`Upload to ${plainHost} Instead?`);
    await expect(question.locator('#kit-dialog-body')).toHaveText(new RegExp(`^${secureHost.replace(/[.]/g, '\\.')} couldn't take Asked first\\.bin: [A-Z]`));
    await expect(question.locator('#kit-dialog-detail')).toHaveText(`${plainHost} is plain HTTP, so the upload won't be end-to-end encrypted, and the server can read your files. `
        + "It keeps files up to 6 hours, and this upload asks for 24 hours. It would go with the server's limits instead.");
    await expect(securityWarning(window), "the question is the plain server's warning: no other").toHaveCount(0);
    expect(startsAt(server), 'nothing sent anywhere while it asks').toEqual([]);

    // Upload There: it goes to the plain address, unencrypted, held to its limits.
    await question.getByRole('button', { name: 'Upload There' }).click();
    await expect(card.locator('.kit-card-status')).toHaveText('Uploaded to Share Space · Not Encrypted', { timeout: 30_000 });
    desktop.secrets.addLink(await card.getByRole('textbox', { name: 'Link' }).inputValue());
    expect(startsAt(server).map(({ at, encrypted, lifetimeMs, maxDownloads }) => ({ at, encrypted, lifetimeMs, maxDownloads })))
        .toEqual([{ at: 'plain', encrypted: false, lifetimeMs: 6 * HOUR, maxDownloads: 1 }]);
    await expect(toOf(card)).toHaveValue(ids[server.baseUrl]);
    expect(requestsAt(server, since).secure, 'the unreachable one got nothing').toEqual([]);

    // Another, answered Cancel: it stops, on its own server, with why it couldn't go there, and Retry.
    const declined = await newUpload(desktop, window, 'Declined.bin', 720);
    await cardButton(declined, 'Upload').click();
    await fallbackQuestion(window).getByRole('button', { name: 'Cancel' }).click();
    await expect(declined.locator('.kit-card-status')).toHaveText(/^Failed: [A-Z].+$/);
    await expect(cardButton(declined, 'Retry')).toBeVisible();
    await expect(toOf(declined), 'its own server, as it was').toHaveValue(ids[desktop.serverUrl]);
    expect((await transfersIn(window)).at(-1).options.lifetime, 'its own settings, as they were').toEqual({ value: 24, unit: 'hours' });
    expect(startsAt(server), 'nothing more sent').toHaveLength(1);
});

test('once its server has taken its start, a failure fails the upload, with Retry, and nothing moves; with Allow Fallback off (Advanced Options), it stops and says why', async ({ desktop, server }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await desktop.setUp(window);
    await desktop.setUp(window, { url: server.baseUrl });
    await allowFallback(window, desktop.serverUrl, true);
    const secureHost = new URL(desktop.serverUrl).host;

    // A chunk refused as by a full server: the upload had begun, so it fails there.
    await app.app.context().route(`${desktop.serverUrl}/api/v4/upload/chunks/*`, (route) => route.fulfill(FULL));
    const since = server.requests().length;
    const begun = await newUpload(desktop, window, 'Begun.bin', 730);
    await cardButton(begun, 'Upload').click();
    await expect(begun.locator('.kit-card-status')).toHaveText('Failed: The server is out of space. Try again later.', { timeout: 30_000 });
    await expect(cardButton(begun, 'Retry')).toBeVisible();
    await expect(fallbackQuestion(window)).toHaveCount(0);
    expect(requestsAt(server, since).plain, 'the one below, asked nothing').toEqual([]);
    expect(startsAt(server).map(({ at }) => at), 'started on its own server only').toEqual(['secure']);
    await app.app.context().unroute(`${desktop.serverUrl}/api/v4/upload/chunks/*`);

    // Allow Fallback off for one upload, in its Advanced Options: its settings line says so, and refused at its start, it stops there.
    await app.app.context().route(`${desktop.serverUrl}/api/v4/uploads`, (route) => route.fulfill(FULL));
    const off = await newUpload(desktop, window, 'Not moved.bin', 740);
    await off.getByRole('button', { name: 'Advanced Options' }).click();
    const dialog = window.getByRole('dialog', { name: 'Advanced Options' });
    const toggle = dialog.getByRole('switch', { name: 'Allow Fallback' });
    await expect(toggle, "its server's, to start with").toBeChecked();
    await expect(dialog.locator('#options-fallback-help')).toHaveText(`If ${secureHost} can't take this upload before it starts, the next server in Settings › Servers is tried. `
        + "A less private one, or one with smaller limits, is never tried without asking. Each server tried learns your IP address and the upload's size.");
    await toggle.setChecked(false);
    await expect(dialog.locator('#options-fallback-help')).toHaveText(`This upload goes to ${secureHost} only. If it can't take it, the upload stops and says why.`);
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(off.locator('.kit-card-settings')).toHaveText('No Fallback');
    expect((await transfersIn(window)).at(-1).options.allowFallback).toBe(false);

    const before = server.requests().length;
    await cardButton(off, 'Upload').click();
    await expect(off.locator('.kit-card-status')).toHaveText('Failed: The server is out of space. Try again later.', { timeout: 30_000 });
    await expect(cardButton(off, 'Retry')).toBeVisible();
    expect(requestsAt(server, before).plain, 'the one below, asked nothing').toEqual([]);
});

test('Share with Dropgate takes the default server\'s Allow Fallback: one the default can\'t take falls back, and a step down opens the window to ask', async ({ desktop, server }) => {
    const setUp = await desktop.launch();
    const window = await setUp.window();
    await desktop.setUp(window, { url: server.baseUrl });
    await desktop.setUp(window);
    await setUp.quit();
    // The default (the plain address) with Allow Fallback on, and a lifetime the server doesn't allow (it keeps files up to 72 hours), as an edited config.json has it.
    const config = path.join(desktop.profile, 'config.json');
    const contents = JSON.parse(fs.readFileSync(config, 'utf8'));
    Object.assign(contents.settings.servers.find(({ url }) => url === server.baseUrl), { allowFallback: true, lifetime: { value: 100, unit: 'hours' } });
    fs.writeFileSync(config, JSON.stringify(contents));

    const file = madeUpFile('Shared and fell back.bin', 30_000, 750);
    desktop.secrets.addFiles([file]);
    const app = await desktop.share(desktop.addFile(file));
    const asked = await app.window();
    const question = fallbackQuestion(asked);
    await expect(question).toHaveAccessibleName(`Upload to ${new URL(desktop.serverUrl).host} Instead?`);
    await expect(question.locator('#kit-dialog-body')).toHaveText(`${new URL(server.baseUrl).host} couldn't take Shared and fell back.bin: File lifetime too long. Server limit: 72 hours.`);
    await expect(question.locator('#kit-dialog-detail')).toHaveText("It keeps files up to 72 hours, and this upload asks for 100 hours. It would go with the server's limits instead.");
    await question.getByRole('button', { name: 'Upload There' }).click();
    expect(await app.exited(), "the app's exit code").toBe(0);
    for (const { text } of app.eventsOf('clipboard')) desktop.secrets.addLink(text);
    expect(app.eventsOf('upload-finished').map(({ status }) => status), 'how the share finished').toEqual(['success']);
    expect(startsAt(server).map(({ at, encrypted, lifetimeMs }) => ({ at, encrypted, lifetimeMs })), 'the upload the server was asked to start')
        .toEqual([{ at: 'secure', encrypted: true, lifetimeMs: 72 * HOUR }]);
});
