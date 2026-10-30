// Parity: the desktop app's settings. It starts with no server, a server added
// starts with the default options, and the app remembers what it's given
// across a restart, and uploads with it.
import { madeUpFile, summary } from '../helpers/files.mjs';
import { actionLine, expect, openServers, serverRow, serverRows, setServerOptions, test, uploadsStarted } from '../helpers/desktop.mjs';
import { download } from '../helpers/webui.mjs';

// Above v3's default of 1, which makes the app lock Max Downloads at 1.
test.use({ serverEnv: { UPLOAD_MAX_FILE_DOWNLOADS: '5' } });

const THIRTY_MINUTES = 30 * 60 * 1000;

test('starts with no server and the default options, then remembers the server and file lifetime after a restart and uploads with them', async ({ desktop, server, page }) => {
    let app = await desktop.launch();
    let window = await app.window();

    // A new profile has no server, so it asks nothing of any.
    await expect(actionLine(window)).toHaveText(/no server url/i);
    await openServers(window);
    await expect(window.locator('#servers-count')).toHaveText('No servers yet');
    await expect(serverRows(window)).toHaveCount(0);
    expect(server.requests(), 'requests the server got from a new profile').toEqual([]);

    // A server added starts with the default options.
    await desktop.setUp(window);
    await openServers(window);
    const row = serverRow(window, desktop.serverUrl);
    await expect(row.getByLabel('File lifetime')).toHaveValue('24');
    await expect(row.getByRole('combobox', { name: 'Unit' })).toHaveValue('hours');
    await expect(row.getByLabel('Max downloads')).toHaveValue('1');
    await setServerOptions(window, desktop.serverUrl, { lifetime: { value: 30, unit: 'minutes' }, maxDownloads: 3 });
    await window.locator('#nav-rail').getByRole('button', { name: 'Upload' }).click();
    const first = madeUpFile('Quarterly figures é.bin', 1_500_000, 11);
    const link = await desktop.upload(window, [first], { encrypted: false });
    expect(uploadsStarted(server).map(({ lifetimeMs, maxDownloads }) => ({ lifetimeMs, maxDownloads })),
        'the upload the server was asked to start').toEqual([{ lifetimeMs: THIRTY_MINUTES, maxDownloads: 3 }]);

    // Someone receiving it gets it intact.
    await page.goto(link);
    await expect(page.locator('#file-name')).toHaveText(first.name);
    const got = await download(page, page.locator('#download-button'));
    expect(got.name).toBe(first.name);
    expect(summary(got.bytes)).toEqual(summary(first.buffer));

    await app.quit();
    app = await desktop.launch();
    window = await app.window();

    await expect(actionLine(window)).not.toHaveText(/no server url|could not connect/i);
    await openServers(window);
    const again = serverRow(window, desktop.serverUrl);
    await expect(again, 'the server after a restart').toHaveCount(1);
    await expect(again.getByLabel('File lifetime'), 'File Lifetime after a restart').toHaveValue('30');
    await expect(again.getByRole('combobox', { name: 'Unit' }), 'File Lifetime after a restart').toHaveValue('minutes');
    await window.locator('#nav-rail').getByRole('button', { name: 'Upload' }).click();

    await desktop.upload(window, [madeUpFile('Quarterly figures, again.bin', 20_000, 12)], { encrypted: false });
    expect(uploadsStarted(server).at(-1).lifetimeMs, 'the file lifetime of an upload after a restart').toBe(THIRTY_MINUTES);
});

// v3 saved Max Downloads, but never read it back, so it started at 1 again.
test('remembers Max Downloads after a restart', async ({ desktop }) => {
    let app = await desktop.launch();
    let window = await app.window();
    await desktop.setUp(window, { maxDownloads: 3 });

    await app.quit();
    app = await desktop.launch();
    window = await app.window();

    const row = serverRow(window, desktop.serverUrl);
    await expect(row).toHaveCount(1);
    await expect(row.getByLabel('Max downloads')).toBeEnabled();
    await expect(row.getByLabel('Max downloads'), 'Max Downloads after a restart').toHaveValue('3');
});

// v3 saved the server only along with the other settings, when one of them
// changed or an upload started, so a server that had only been tested was forgotten.
test('remembers a server after a restart once it has been tested', async ({ desktop }) => {
    let app = await desktop.launch();
    let window = await app.window();
    await desktop.setUp(window);

    await app.quit();
    app = await desktop.launch();
    window = await app.window();

    await expect(serverRow(window, desktop.serverUrl), 'a tested server after a restart').toHaveCount(1);
});
