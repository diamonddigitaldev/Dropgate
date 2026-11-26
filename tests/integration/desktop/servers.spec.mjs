// Settings > Servers, as the signed-off mockup draws it: a row for each saved
// server, in order, with its name, its address under it, its status line in
// its tone, Default, its limits once checked, its settings for new uploads
// bounded by those limits, the account's place (no sign-in yet), Test, Set as
// Default, Move Up, Move Down and Remove (which asks first); and Add Server,
// which checks an address and shows what it found before it's added. The app
// saves the list in its settings (main alone changes it), and keeps what each
// check found in memory only. The list in its settings is the one place in its
// profile a server's address is written: every request to a server is the
// transfer window's, in a session kept in memory (transfer-window.spec.mjs), so
// Chromium's own files hold none, and a server removed or only checked leaves
// nothing.
//
// Two saved servers are the test's one server at two addresses: the TLS
// proxy's (https://, so uploads are end-to-end encrypted) and the server's own
// (http://, plain).
import fs from 'node:fs';
import path from 'node:path';
import { copySlips } from '../../../client/test/helpers/copy.mjs';
import { madeUpFile } from '../helpers/files.mjs';
import { heldIn } from '../helpers/profile.mjs';
import {
    ENCRYPTED, NOT_ENCRYPTED, addServerDialog, defaultServerRow, expect, openServers, securityWarning, serverRow, serverRows, serverStatus, setServerOptions, test,
    uploadsStarted,
} from '../helpers/desktop.mjs';

test.use({
    tlsProxy: true,
    serverEnv: { SERVER_NAME: 'Share Space', UPLOAD_MAX_FILE_DOWNLOADS: '5', UPLOAD_MAX_FILE_LIFETIME_HOURS: '72', UPLOAD_MAX_FILE_SIZE_MB: '1024' },
});

const HOUR = 3_600_000;

/** The app's settings as it wrote them: config.json's. */
const stored = (desktop) => JSON.parse(fs.readFileSync(path.join(desktop.profile, 'config.json'), 'utf8')).settings ?? {};

/** The saved servers' addresses, in order, and the default's, as the app wrote them. */
const storedList = (desktop) => {
    const { servers = [], defaultServer = null } = stored(desktop);
    return { urls: servers.map(({ url }) => url), default: servers.find(({ id }) => id === defaultServer)?.url ?? null };
};

/** The rows' addresses, in the order shown. */
const shownOrder = (window) => serverRows(window).locator('.server-address').allTextContents();

/** Note, in the window, every button that comes to say it's doing something: its label, whether it's disabled, and whether it has the kit's spinner. */
const watchBusyButtons = (window) => window.evaluate(() => {
    const seen = [];
    globalThis.__busySeen = seen;
    new MutationObserver(() => {
        for (const button of document.querySelectorAll('button')) {
            const label = button.textContent.trim();
            if (!/ing…$/.test(label) || seen.some((s) => s.button === button && s.label === label)) continue;
            seen.push({ button, label, disabled: button.disabled, spinner: Boolean(button.querySelector('.spinner-border[aria-hidden="true"]')) });
        }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
});
const busySeen = (window) => window.evaluate(() => globalThis.__busySeen.map(({ label, disabled, spinner }) => ({ label, disabled, spinner })));

/** The limits the test's server gives, as a row and Add Server say them, in Title Case between bullets. */
const limitsShown = (window) => window.evaluate(() => `Keeps Files Up to 72 Hours · Up to 5 Downloads · Up to ${window.kit.format.formatBytes(1024 ** 3)}`);

test('Add Server checks an address first, showing its name, version, encryption and limits, and saves nothing until Add Server; the first added is the default', async ({ desktop, server }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await openServers(window);
    await watchBusyButtons(window);
    await window.locator('#add-server-btn').click();
    const dialog = addServerDialog(window);
    await expect(dialog.getByLabel('Server address')).toBeFocused();
    await expect(dialog.locator('#add-server-address-help'), 'an invite link, said not to be taken yet').toHaveText(/Invite links aren't supported yet\./);

    // Check: what it found, and nothing saved.
    await dialog.getByLabel('Server address').fill(desktop.serverUrl);
    await dialog.getByRole('button', { name: 'Check', exact: true }).click();
    const found = dialog.locator('.server-found');
    await expect(found).toBeVisible();
    const version = (await (await fetch(`${server.baseUrl}/api/info`)).json()).version;
    await expect(found.locator('div').nth(0)).toHaveText(`Share Space · Dropgate ${version}`);
    await expect(found.locator('div').nth(1)).toHaveText('Online · End-to-End Encrypted');
    await expect(found.locator('div').nth(2)).toHaveText(await limitsShown(window));
    await expect(found.locator('.server-address')).toHaveText(desktop.serverUrl);
    await expect(dialog.getByRole('button', { name: 'Add Server', exact: true })).toBeVisible();
    expect(storedList(desktop).urls, 'servers saved once it was only checked').toEqual([]);

    // Typing again goes back to Check; Cancel saves nothing.
    await dialog.getByLabel('Server address').fill(server.baseUrl);
    await expect(found).toBeHidden();
    await expect(dialog.getByRole('button', { name: 'Check', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Check', exact: true }).click();
    await expect(found.locator('div').nth(1), 'a plain HTTP server, found').toHaveText('Online · Plain HTTP · Not Encrypted');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(serverRows(window)).toHaveCount(0);
    expect(storedList(desktop).urls, 'servers saved after Cancel').toEqual([]);

    // Add Server: saved under the address it was found at, the default, with a new server's settings.
    await window.locator('#add-server-btn').click();
    await dialog.getByLabel('Server address').fill(desktop.serverUrl);
    await dialog.getByRole('button', { name: 'Check', exact: true }).click();
    await dialog.getByRole('button', { name: 'Add Server', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(serverRows(window)).toHaveCount(1);
    await expect(defaultServerRow(window).locator('.server-address')).toHaveText(desktop.serverUrl);
    const [saved] = stored(desktop).servers;
    expect(saved).toEqual({ id: saved.id, url: desktop.serverUrl, name: 'Share Space', lifetime: { value: 24, unit: 'hours' }, maxDownloads: 1, allowFallback: false });
    expect(stored(desktop).defaultServer).toBe(saved.id);
    expect(JSON.stringify(stored(desktop)), 'nothing its check found, in the settings').not.toMatch(/maxLifetimeHours|maxFileDownloads|capabilities|"version"/);

    // The same address again is the same server, never two.
    await window.locator('#add-server-btn').click();
    await dialog.getByLabel('Server address').fill(desktop.serverUrl);
    await dialog.getByRole('button', { name: 'Check', exact: true }).click();
    await dialog.getByRole('button', { name: 'Add Server', exact: true }).click();
    await expect(window.getByText('Share Space is saved already.')).toBeVisible();
    await expect(serverRows(window)).toHaveCount(1);

    // Each Check and Add Server, busy: disabled, with the kit's spinner.
    const seen = await busySeen(window);
    expect(new Set(seen.map(({ label }) => label)), 'the buttons that said they were busy').toEqual(new Set(['Checking…', 'Adding…']));
    for (const one of seen) expect(one, one.label).toEqual({ label: one.label, disabled: true, spinner: true });
});

test('Add, Set as Default, Move Up, Move Down and Remove (which asks first) change the saved list; each server\'s settings for new uploads are bounded by its limits, and a new upload starts on the default with its settings', async ({ desktop, server }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await desktop.setUp(window);
    await desktop.setUp(window, { url: server.baseUrl });
    await openServers(window);
    const secure = serverRow(window, desktop.serverUrl);
    const plain = serverRow(window, server.baseUrl);
    expect(await shownOrder(window), 'in the order added').toEqual([desktop.serverUrl, server.baseUrl]);
    expect(storedList(desktop)).toEqual({ urls: [desktop.serverUrl, server.baseUrl], default: desktop.serverUrl });
    await expect(secure.locator('.pill-default'), 'the first added is the default').toBeVisible();
    await expect(plain.locator('.pill-default')).toBeHidden();
    await expect(secure.getByRole('button', { name: 'Set as Default' }), 'the default has no Set as Default').toHaveCount(0);

    // Move Up and Move Down: the ends don't move.
    await expect(secure.getByRole('button', { name: 'Move Up' })).toBeDisabled();
    await expect(plain.getByRole('button', { name: 'Move Down' })).toBeDisabled();
    await secure.getByRole('button', { name: 'Move Down' }).click();
    await expect.poll(() => shownOrder(window)).toEqual([server.baseUrl, desktop.serverUrl]);
    expect(storedList(desktop).urls).toEqual([server.baseUrl, desktop.serverUrl]);
    await expect(secure.getByRole('button', { name: 'Move Down' })).toBeDisabled();
    await secure.getByRole('button', { name: 'Move Up' }).click();
    await expect.poll(() => shownOrder(window)).toEqual([desktop.serverUrl, server.baseUrl]);
    expect(storedList(desktop).urls).toEqual([desktop.serverUrl, server.baseUrl]);

    // Its settings for new uploads offer only what it allows: 72 hours, 5 downloads.
    const downloads = plain.getByLabel('Max downloads');
    const lifetime = plain.getByLabel('File lifetime');
    const downloadsHelp = plain.locator('[id$="-downloads-help"]');
    const lifetimeHelp = plain.locator('[id$="-lifetime-help"]');
    await expect(downloads).toHaveAttribute('max', '5');
    await expect(lifetime).toHaveAttribute('max', '72');
    await expect(plain.getByRole('combobox', { name: 'Unit' }).locator('option[value="unlimited"]')).toBeDisabled();
    await expect(plain.getByRole('combobox', { name: 'Unit' }).locator('option[value="unlimited"]')).toHaveText('Unlimited (not allowed by the server)');
    await expect(lifetimeHelp).toHaveText('Up to 72 hours.');
    await expect(downloadsHelp).toHaveText('Up to 5 downloads.');
    await downloads.fill('6');
    await expect(downloadsHelp).toHaveText('Too many: This server allows up to 5 downloads.');
    await downloads.fill('0');
    await expect(downloadsHelp).toHaveText("This server doesn't allow unlimited downloads. It allows up to 5 downloads.");
    await lifetime.fill('100');
    await expect(lifetimeHelp).toHaveText('Too long: This server keeps files up to 72 hours.');
    await window.evaluate(() => window.kitAPI.getSettings());
    const kept = stored(desktop).servers.find(({ url }) => url === server.baseUrl);
    expect({ lifetime: kept.lifetime, maxDownloads: kept.maxDownloads }, 'what was outside its limits, never saved').toEqual({ lifetime: { value: 24, unit: 'hours' }, maxDownloads: 1 });
    await setServerOptions(window, server.baseUrl, { lifetime: { value: 2, unit: 'hours' }, maxDownloads: 3 });
    await expect(downloadsHelp).toHaveText('Up to 5 downloads.');
    const set = stored(desktop).servers.find(({ url }) => url === server.baseUrl);
    expect({ lifetime: set.lifetime, maxDownloads: set.maxDownloads }).toEqual({ lifetime: { value: 2, unit: 'hours' }, maxDownloads: 3 });

    // Set as Default: a new upload starts there, with its settings.
    await plain.getByRole('button', { name: 'Set as Default' }).click();
    await expect(plain.locator('.pill-default')).toBeVisible();
    await expect(secure.locator('.pill-default')).toBeHidden();
    expect(storedList(desktop).default).toBe(server.baseUrl);
    await window.locator('#nav-rail').getByRole('button', { name: 'Upload' }).click();
    await desktop.upload(window, [madeUpFile('On the plain one.bin', 20_000, 501)], { encrypted: false });
    expect(uploadsStarted(server).map(({ lifetimeMs, maxDownloads }) => ({ lifetimeMs, maxDownloads })), 'the upload the server was asked to start')
        .toEqual([{ lifetimeMs: 2 * HOUR, maxDownloads: 3 }]);

    // Remove asks first: Cancel keeps it; Remove takes it, and the default's place goes to the first left.
    await openServers(window);
    await plain.getByRole('button', { name: 'Remove' }).click();
    const asks = window.getByRole('alertdialog', { name: 'Remove This Server?' });
    await expect(asks).toContainText('Share Space leaves your list, with its settings for new uploads. Uploads already under way to it carry on.');
    await asks.getByRole('button', { name: 'Cancel' }).click();
    await expect(serverRows(window)).toHaveCount(2);
    await plain.getByRole('button', { name: 'Remove' }).click();
    await asks.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(serverRows(window)).toHaveCount(1);
    await expect(secure.locator('.pill-default')).toBeVisible();
    expect(storedList(desktop)).toEqual({ urls: [desktop.serverUrl], default: desktop.serverUrl });

    // The new default's settings, end-to-end encrypted.
    await window.locator('#nav-rail').getByRole('button', { name: 'Upload' }).click();
    await desktop.upload(window, [madeUpFile('On the secure one.bin', 20_000, 502)], { encrypted: true });
    expect(uploadsStarted(server).at(-1)).toMatchObject({ lifetimeMs: 24 * HOUR, maxDownloads: 1 });
    await expect(securityWarning(window)).toHaveCount(0);
});

test('a row looks as the mockup: its name with its address under it, its status line\'s tone, Default, its limits in Title Case between bullets, the account\'s place with no sign-in yet, Not checked yet until one is used, Test busy with its spinner, and Can\'t connect', async ({ desktop, server }) => {
    let app = await desktop.launch();
    let window = await app.window();
    await desktop.setUp(window);
    await desktop.setUp(window, { url: server.baseUrl });
    await openServers(window);
    let secure = serverRow(window, desktop.serverUrl);
    let plain = serverRow(window, server.baseUrl);

    await expect(secure.locator('.server-name')).toHaveText('Share Space');
    await expect(secure.locator('.server-address')).toHaveText(desktop.serverUrl);
    await expect(serverStatus(secure)).toHaveText(ENCRYPTED);
    await expect(serverStatus(secure)).toHaveClass(/\bkit-tone-success\b/);
    await expect(serverStatus(plain)).toHaveText(/^Online · Dropgate \S+ · Plain HTTP · Not Encrypted$/);
    await expect(serverStatus(plain)).toHaveClass(/\bkit-tone-warning\b/);
    await expect(secure.locator('.pill-default')).toHaveText('Default');
    const limits = await limitsShown(window);
    await expect(secure.locator('.server-limits')).toHaveText(limits);
    expect(copySlips(limits), 'the limits, against the copy rules').toEqual([]);

    // The account's place: what a server with no accounts says, and none of the sign-in buttons yet.
    await expect(secure.locator('.server-slot')).toContainText("This server doesn't use accounts.");
    for (const name of ['Sign In', 'Sign Out', 'Redeem Invite', 'New Account Number', 'Manage Accounts']) {
        await expect(window.getByRole('tabpanel').getByRole('button', { name }), name).toHaveCount(0);
    }
    // Its settings for new uploads show and hide.
    await expect(secure.getByLabel('Max downloads')).toBeVisible();
    await secure.getByRole('button', { name: 'Hide Settings' }).click();
    await expect(secure.getByLabel('Max downloads')).toBeHidden();
    await secure.getByRole('button', { name: 'Show Settings' }).click();
    await expect(secure.getByLabel('Max downloads')).toBeVisible();

    // After a restart only the default was checked, as the window opened: the other says so, with no limits, and its fields wait for a Test.
    await app.quit();
    app = await desktop.launch();
    window = await app.window();
    await openServers(window);
    secure = serverRow(window, desktop.serverUrl);
    plain = serverRow(window, server.baseUrl);
    await expect(serverStatus(secure)).toHaveText(ENCRYPTED);
    await expect(serverStatus(plain)).toHaveText('Not checked yet');
    await expect(serverStatus(plain)).toHaveClass(/\bkit-tone-muted\b/);
    await expect(plain.locator('.server-limits')).toBeHidden();
    await plain.getByRole('button', { name: 'Show Settings' }).click();
    await expect(plain.getByLabel('Max downloads')).toBeDisabled();
    await expect(plain.locator('[id$="-lifetime-help"]')).toHaveText('Test the server to see its limits.');

    // Test: Checking… while it's asked, Test busy with the kit's spinner, then what it found.
    const transfer = await app.transferWindow();
    let held = null;
    await transfer.route('**/api/info', (route) => {
        held = route;
    });
    await plain.getByRole('button', { name: 'Test', exact: true }).click();
    await expect.poll(() => held !== null, { message: 'the check, held' }).toBe(true);
    await expect(serverStatus(plain)).toHaveText('Checking…');
    await expect(serverStatus(plain)).toHaveClass(/\bkit-tone-running\b/);
    const busy = plain.locator('.server-actions button').first();
    await expect(busy).toHaveText('Testing…');
    await expect(busy).toBeDisabled();
    await expect(busy.locator('.spinner-border[aria-hidden="true"]')).toHaveCount(1);
    await held.continue();
    await expect(serverStatus(plain)).toHaveText(NOT_ENCRYPTED);
    await expect(plain.getByRole('button', { name: 'Test', exact: true })).toBeEnabled();
    await expect(plain.locator('.server-limits')).toHaveText(limits);
    await expect(plain.getByLabel('Max downloads')).toBeEnabled();

    // One that can't be reached says so, with why in its tooltip, and no limits.
    await transfer.unroute('**/api/info');
    await transfer.route('**/api/info', (route) => route.abort());
    await plain.getByRole('button', { name: 'Test', exact: true }).click();
    await expect(serverStatus(plain)).toHaveText("Can't connect");
    await expect(serverStatus(plain)).toHaveClass(/\bkit-tone-danger\b/);
    await expect(serverStatus(plain).locator('.kit-status-text')).toHaveAttribute('title', /^Connection failed\. Check the URL, and that the server is running\./);
    await expect(plain.locator('.server-limits')).toBeHidden();
    await expect(plain.getByLabel('Max downloads')).toBeDisabled();
});

test('the profile names a saved server in config.json alone, and one only checked, or used and removed, nowhere: the app\'s own browser files hold no server\'s address', async ({ desktop, server }) => {
    const secureHost = new URL(desktop.serverUrl).host;
    const plainHost = new URL(server.baseUrl).host;
    expect(secureHost.startsWith(plainHost) || plainHost.startsWith(secureHost), 'two addresses, neither part of the other').toBe(false);
    let app = await desktop.launch();
    let window = await app.window();

    // The plain one, only checked in Add Server, then Cancel.
    await openServers(window);
    await window.locator('#add-server-btn').click();
    const dialog = addServerDialog(window);
    await dialog.getByLabel('Server address').fill(server.baseUrl);
    await dialog.getByRole('button', { name: 'Check', exact: true }).click();
    await expect(dialog.locator('.server-found')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();

    // The secure one added, the default, and uploaded to (over HTTPS); the plain one added, tested, made the default and uploaded to.
    await desktop.setUp(window);
    await desktop.upload(window, [madeUpFile('To the secure one.bin', 20_000, 511)], { encrypted: true });
    await desktop.setUp(window, { url: server.baseUrl });
    await openServers(window);
    const plain = serverRow(window, server.baseUrl);
    await plain.getByRole('button', { name: 'Test', exact: true }).click();
    await expect(serverStatus(plain)).toHaveText(NOT_ENCRYPTED);
    await plain.getByRole('button', { name: 'Set as Default' }).click();
    await window.locator('#nav-rail').getByRole('button', { name: 'Upload' }).click();
    await desktop.upload(window, [madeUpFile('To the plain one.bin', 20_000, 512)], { encrypted: false });
    await app.quit();

    // Restarted, the plain one, the default, is checked as the window opens; then removed, and the secure one tested.
    app = await desktop.launch();
    window = await app.window();
    await openServers(window);
    await expect(serverStatus(serverRow(window, server.baseUrl))).toHaveText(NOT_ENCRYPTED);
    await serverRow(window, server.baseUrl).getByRole('button', { name: 'Remove' }).click();
    await window.getByRole('alertdialog', { name: 'Remove This Server?' }).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(serverRows(window)).toHaveCount(1);
    const secure = serverRow(window, desktop.serverUrl);
    await secure.getByRole('button', { name: 'Test', exact: true }).click();
    await expect(serverStatus(secure)).toHaveText(ENCRYPTED);
    await app.quit();

    // Every file in the profile, each address in each way it could be written: the saved one only in the settings.
    expect(heldIn(desktop.profile, { texts: [secureHost], bytes: [] }), 'the saved server').toEqual([`config.json: "${secureHost}"`]);
    expect(heldIn(desktop.profile, { texts: [plainHost], bytes: [] }), 'the server checked, used and removed').toEqual([]);
});
