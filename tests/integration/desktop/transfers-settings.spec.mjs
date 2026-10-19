// Settings > Transfers, in the desktop app: Save downloads to (the system's
// Downloads until Browse picks another with the system's picker, and Reset
// goes back), and Transfers at once (the kit's stepped slider, 1 to 6, 3 by
// default), both kept after a restart; downloadFolder is null in the
// settings until a folder is chosen, and the page can't set it itself. A
// profile at settings version 1 is brought to version 2 once, keeping its
// server and its settings for new uploads. Uploads and downloads count
// together toward how many run at once.
import fs from 'node:fs';
import path from 'node:path';
import { madeUpFile, summary } from '../helpers/files.mjs';
import {
    addLink, cardButton, downloadCard, downloadStatus, expect, holdChunks, pickFolder, securityWarning, test, uploadButton, uploadCard, uploadStatus, uploadsStarted,
} from '../helpers/desktop.mjs';
import { uploadWithCore } from '../helpers/hosted.mjs';

/** The settings as the app stored them, in its profile's config.json. */
const stored = (desktop) => JSON.parse(fs.readFileSync(path.join(desktop.profile, 'config.json'), 'utf8'));

async function openTransfers(window) {
    await window.getByRole('button', { name: 'Settings', exact: true }).click();
    await window.getByRole('tab', { name: 'Transfers' }).click();
}

test('Save downloads to and Transfers at once: the system\'s Downloads and 3 at first, Browse and the slider kept after a restart, Reset back', async ({ desktop, server }) => {
    let app = await desktop.launch();
    let window = await app.window();
    await openTransfers(window);
    await expect(window.locator('#downloads-folder')).toHaveValue(desktop.downloads);
    await expect(window.locator('#downloads-reset-btn')).toBeDisabled();
    const slider = window.getByRole('slider', { name: 'Transfers at once' });
    await expect(slider).toHaveValue('3');
    await expect(slider).toHaveAttribute('aria-valuetext', '3 transfers');
    await expect(window.locator('#transfers-at-once-help')).toHaveText("Up to 3 transfers at once, uploads and downloads together. The rest wait as Queued; a paused one doesn't take a place.");
    expect(stored(desktop).settings, 'the settings, before anything is chosen').toMatchObject({ downloadFolder: null, transfersAtOnce: 3 });

    const chosen = path.join(desktop.root, 'Downloads Chosen');
    fs.mkdirSync(chosen);
    await pickFolder(app, chosen);
    await window.locator('#downloads-browse-btn').click();
    await expect(window.locator('#downloads-folder')).toHaveValue(chosen);
    await expect(window.locator('#downloads-reset-btn')).toBeEnabled();
    await slider.focus();
    await window.keyboard.press('ArrowRight');
    await window.keyboard.press('ArrowRight');
    await expect(slider).toHaveValue('5');
    await expect(window.locator('#transfers-at-once-help')).toHaveText(/^Up to 5 transfers at once/);
    await expect.poll(() => stored(desktop).settings).toMatchObject({ downloadFolder: chosen, transfersAtOnce: 5 });

    await app.quit();
    app = await desktop.launch();
    window = await app.window();
    await openTransfers(window);
    await expect(window.locator('#downloads-folder'), 'the folder after a restart').toHaveValue(chosen);
    await expect(window.getByRole('slider', { name: 'Transfers at once' }), 'how many at once after a restart').toHaveValue('5');

    // A new download goes there, by its name.
    const file = madeUpFile('Into the chosen one.bin', 30_000, 101);
    desktop.secrets.addFiles([file]);
    const { link } = await uploadWithCore(server, [file]);
    desktop.secrets.addLink(link);
    await addLink(window, link);
    await expect(downloadStatus(window)).toHaveText('Ready');
    await expect(downloadCard(window).getByRole('combobox', { name: 'Save to' }).locator('option:checked')).toHaveText('Downloads Chosen');
    await cardButton(downloadCard(window), 'Download').click();
    await expect(downloadStatus(window)).toHaveText('Saved to Downloads Chosen', { timeout: 30_000 });
    expect(summary(fs.readFileSync(path.join(chosen, file.name)))).toEqual(summary(file.buffer));

    await openTransfers(window);
    await window.locator('#downloads-reset-btn').click();
    await expect(window.locator('#downloads-folder')).toHaveValue(desktop.downloads);
    await expect.poll(() => stored(desktop).settings.downloadFolder, { message: 'the folder, reset' }).toBe(null);
});

test.describe('on a server allowing 5 downloads', () => {
    // The page holds Max downloads to the server's limit, so the server allows the profile's 5.
    test.use({ serverEnv: { UPLOAD_MAX_FILE_DOWNLOADS: '5' } });

    test('a version 1 profile is brought to version 3 once, its server the first saved and the default, with its settings; the page can\'t set the downloads folder or the saved servers', async ({ desktop, server }) => {
        fs.mkdirSync(desktop.profile, { recursive: true });
        // Within the server's limits (24 hours, 5 downloads), so the upload below goes as it was set.
        const v1 = { serverURL: desktop.serverUrl, lifetimeValue: 12, lifetimeUnit: 'hours', maxDownloads: 5, navCollapsed: true };
        fs.writeFileSync(path.join(desktop.profile, 'config.json'), JSON.stringify({ settings: v1, settingsSchema: 1 }));
        const app = await desktop.launch();
        const window = await app.window();
        const settings = await window.evaluate(() => window.kitAPI.getSettings());
        const [saved] = settings.servers;
        expect(settings).toMatchObject({ navCollapsed: true, downloadFolder: null, transfersAtOnce: 3, defaultServer: saved.id });
        expect(settings.servers).toEqual([{ id: saved.id, url: desktop.serverUrl, name: new URL(desktop.serverUrl).host, lifetime: { value: 12, unit: 'hours' }, maxDownloads: 5, allowFallback: false }]);
        await expect.poll(() => stored(desktop).settingsSchema).toBe(3);
        for (const key of ['serverURL', 'lifetimeValue', 'lifetimeUnit', 'maxDownloads']) expect(Object.keys(stored(desktop).settings), `${key} after version 3`).not.toContain(key);

        // Settings > Server shows it, and a new upload takes its settings.
        await window.getByRole('button', { name: 'Settings', exact: true }).click();
        await window.getByRole('tab', { name: 'Server' }).click();
        await expect(window.locator('#server-url')).toHaveValue(desktop.serverUrl);
        await expect(window.locator('#file-lifetime-value')).toHaveValue('12');
        await expect(window.locator('#file-lifetime-unit')).toHaveValue('hours');
        await expect(window.locator('#max-downloads-value')).toHaveValue('5');
        await window.locator('#nav-rail').getByRole('button', { name: 'Upload' }).click();
        const sent = madeUpFile('From version 1.bin', 20_000, 104);
        await desktop.upload(window, [sent], { encrypted: false });
        expect(uploadsStarted(server).map(({ lifetimeMs, maxDownloads }) => ({ lifetimeMs, maxDownloads }))).toEqual([{ lifetimeMs: 12 * 3_600_000, maxDownloads: 5 }]);

        // Only main's folder picker chooses where downloads land, only main changes the saved servers, and the slider's range holds.
        const refusal = (changes) => window.evaluate((c) => window.kitAPI.setSettings(c).then(() => 'set', (error) => error.message), changes);
        expect(await refusal({ downloadFolder: desktop.root })).toMatch(/downloadFolder can't be changed from the page\./);
        expect(await refusal({ downloadFolder: null, transfersAtOnce: 2 })).toMatch(/downloadFolder can't be changed from the page\./);
        expect(await refusal({ servers: [{ ...saved, url: 'https://elsewhere.example' }] })).toMatch(/servers can't be changed from the page\./);
        expect(await refusal({ defaultServer: null })).toMatch(/defaultServer can't be changed from the page\./);
        expect(await refusal({ transfersAtOnce: 9 })).toMatch(/Expected transfers at once from 1 to 6\./);
        expect(await refusal({ transfersAtOnce: 2.5 })).toMatch(/Expected transfers at once from 1 to 6\./);
        expect(stored(desktop).settings, 'nothing refused was kept').toMatchObject({ downloadFolder: null, transfersAtOnce: 3, servers: [saved], defaultServer: saved.id });
        // The kit's own settings still change from the page.
        expect(await refusal({ navCollapsed: false })).toBe('set');
    });
});

test('uploads and downloads count together: at one at once, a download waits behind an upload running, and starts when it ends', async ({ desktop, server }) => {
    const file = madeUpFile('After the upload.bin', 30_000, 102);
    desktop.secrets.addFiles([file]);
    const { link } = await uploadWithCore(server, [file]);
    desktop.secrets.addLink(link);
    const app = await desktop.launch();
    const window = await app.window();
    await openTransfers(window);
    const slider = window.getByRole('slider', { name: 'Transfers at once' });
    await slider.focus();
    await window.keyboard.press('Home');
    await expect(slider).toHaveValue('1');
    await desktop.setUp(window);

    // An upload, its chunks held after the first, so it runs.
    const sent = madeUpFile('Running first.bin', 12_000_000, 103);
    desktop.secrets.addFiles([sent], { storedByServer: true });
    await window.locator('#file-input').setInputFiles([desktop.addFile(sent)]);
    const chunks = await holdChunks(await app.transferWindow());
    await uploadButton(window).click();
    await securityWarning(window).getByRole('button', { name: 'Upload Anyway' }).click();
    await expect.poll(() => chunks.sent.length, { message: 'the upload should be sending its chunks' }).toBeGreaterThan(1);

    await addLink(window, link);
    await expect(downloadStatus(window)).toHaveText('Ready');
    await cardButton(downloadCard(window), 'Download').click();
    await expect(downloadStatus(window)).toHaveText('Queued: Starts when one of the 1 running finishes.');
    await window.waitForTimeout(500);
    await expect(downloadStatus(window), 'still waiting its turn').toHaveText(/^Queued/);

    chunks.release();
    await window.locator('#nav-rail').getByRole('button', { name: 'Upload' }).click();
    await expect(uploadStatus(window)).toHaveText(/^Uploaded · /, { timeout: 30_000 });
    await window.locator('#nav-rail').getByRole('button', { name: 'Download' }).click();
    await expect(downloadStatus(window)).toHaveText('Saved to Downloads', { timeout: 30_000 });
    expect(summary(fs.readFileSync(path.join(desktop.downloads, file.name)))).toEqual(summary(file.buffer));
    await expect(uploadCard(window)).toHaveCount(1);
});
