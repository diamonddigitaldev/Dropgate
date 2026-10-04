// The desktop app's Settings view, which is electron-kit's: Dropgate's own
// Server and Privacy tabs, then Update, then Credits last. The Update tab's preferences are
// kept across a restart, and Credits shows the app's logo. The updater itself
// only runs in a packaged app (desktop/updates.spec.mjs).
//
// And the app keeps no log on disk unless the person asks it to: v3 wrote
// debug.log at every launch, with the paths of the files it was given (PB-D1).
import fs from 'node:fs';
import path from 'node:path';
import { madeUpFile } from '../helpers/files.mjs';
import { expect, test } from '../helpers/desktop.mjs';

/** Settings, open at a tab. */
async function openSettings(window, tab) {
    await window.getByRole('button', { name: 'Settings', exact: true }).click();
    await window.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
    return window.getByRole('tabpanel', { name: new RegExp(`^${tab}`) });
}

test('Settings has Dropgate\'s Server tab, then Update, then Credits, last, with its logo, and keeps the Update tab\'s choices after a restart', async ({ desktop }) => {
    let app = await desktop.launch();
    let window = await app.window();

    const update = await openSettings(window, 'Update');
    expect(await window.getByRole('tab').allTextContents(), 'the Settings tabs').toEqual(['Server', 'Privacy', 'Update', 'Credits']);
    const automatic = update.getByRole('switch', { name: 'Download updates automatically' });
    await expect(automatic, 'automatic downloads, on a new profile').toBeChecked();
    // Run from source, a 3.x build is a stable one.
    await expect(update.getByRole('combobox', { name: 'Update channel' })).toHaveValue('stable');
    await automatic.click();
    await update.getByRole('combobox', { name: 'Update channel' }).selectOption('beta');
    await expect.poll(() => window.evaluate(() => window.kitAPI.getSettings().then(({ autoDownloadUpdates, updateChannel }) => ({ autoDownloadUpdates, updateChannel }))))
        .toEqual({ autoDownloadUpdates: false, updateChannel: 'beta' });

    const credits = await openSettings(window, 'Credits');
    await expect(credits).toContainText('Dropgate Client');
    await expect(credits).toContainText('Logo designed by TheFuturisticIdiot.');
    const logo = credits.locator('img');
    await expect(logo).toBeVisible();
    // v3's Credits window pointed at an icons folder that wasn't there.
    expect(await logo.evaluate((img) => img.complete && img.naturalWidth > 0), 'whether the logo loaded').toBe(true);

    await app.quit();
    app = await desktop.launch();
    window = await app.window();

    const again = await openSettings(window, 'Update');
    await expect(again.getByRole('switch', { name: 'Download updates automatically' }), 'automatic downloads after a restart').not.toBeChecked();
    await expect(again.getByRole('combobox', { name: 'Update channel' }), 'the channel after a restart').toHaveValue('beta');
});

test('keeps no log on disk by default, through an upload and a restart', async ({ desktop }) => {
    let app = await desktop.launch();
    let window = await app.window();
    await desktop.setUp(window);
    await desktop.upload(window, [madeUpFile('Board minutes.bin', 50_000, 31)], { encrypted: false });
    await app.quit();
    app = await desktop.launch();
    await app.window();
    await app.quit();

    // The app's log would be debug.log, at the top of its profile. (Chromium's own stores, in folders of
    // their own, keep LevelDB's .log files, which hold no log lines.)
    const top = fs.readdirSync(desktop.profile).filter((name) => /\.log$/i.test(name));
    const named = fs.readdirSync(desktop.profile, { recursive: true }).map(String).filter((name) => /debug/i.test(name));
    expect([...top, ...named], 'log files in the profile').toEqual([]);
    expect(fs.existsSync(path.join(desktop.profile, 'debug.log'))).toBe(false);
});

// 09 6.1, 6.3, 6.6 to 6.8: the debug log's switch, on Dropgate's Privacy tab. It's the kit's keepLogOnDisk.
test('Keep log on disk for troubleshooting: off and no file by default; on, debug.log holds the run so far and none of its files or links; off, it goes at once', async ({ desktop, secrets }) => {
    const opened = madeUpFile('Opened at launch.bin', 20_000, 33);
    // Uploaded with the picked file, unencrypted, so the server may keep its name.
    secrets.addFiles([opened], { storedByServer: true });
    const app = await desktop.launch(desktop.addFile(opened));
    const window = await app.window();
    await desktop.setUp(window);
    const picked = madeUpFile('Private diary.bin', 50_000, 32);
    const link = await desktop.upload(window, [picked], { encrypted: false });

    const privacy = await openSettings(window, 'Privacy');
    const keep = privacy.getByRole('switch', { name: 'Keep log on disk for troubleshooting' });
    await expect(keep, 'the switch, on a new profile').not.toBeChecked();
    await expect(privacy, 'its privacy note').toContainText('none of your file names, folders or links');
    const log = path.join(desktop.profile, 'debug.log');
    expect(fs.existsSync(log), 'debug.log before it is turned on').toBe(false);

    await keep.click();
    await expect.poll(() => fs.existsSync(log), { message: 'whether debug.log was written' }).toBe(true);
    const text = fs.readFileSync(log, 'utf8');
    expect(text, "the run's banner").toMatch(/^=== Dropgate Client \S+ started at /);
    expect(text, 'the run so far').toContain('Opening 1 file.');
    expect(text).toContain('Upload finished: success');
    const { hash, pathname } = new URL(link);
    for (const secret of [opened.name, picked.name, desktop.folder, path.basename(desktop.folder), link, hash.slice(1), pathname.slice(1)].filter(Boolean)) {
        for (const form of new Set([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)])) {
            expect(text.toLowerCase(), 'debug.log').not.toContain(form.toLowerCase());
        }
    }
    expect(await window.evaluate(() => window.kitAPI.getSettings().then((s) => s.keepLogOnDisk))).toBe(true);

    await keep.click();
    await expect.poll(() => fs.existsSync(log), { message: 'whether debug.log is still there once turned off' }).toBe(false);
    expect(await window.evaluate(() => window.kitAPI.getSettings().then((s) => s.keepLogOnDisk))).toBe(false);
});
