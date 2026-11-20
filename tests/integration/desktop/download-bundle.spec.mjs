// A link to several files, in the desktop app: its files are listed when it's
// added, and Advanced Options chooses which of them to download and whether
// as one ZIP ("3 of 4 Files · As One ZIP" on its settings line). Saved as
// files, they go into a new folder of their own in Save to's folder, named
// for when they're saved ("dropgate-bundle-20261010-143205", made unique), each
// under the name core makes safe, made unique among them; Open Folder opens
// that folder, and nothing received is ever opened. Saved as one ZIP, it's
// one file there ("dropgate-bundle-20261010-143205.zip"), read back whole, its
// members' names made safe by core's ZIP writer; Show in Folder shows it.
// Bulk Edit sets Save as one ZIP on several at once. On Windows, every file
// saved carries the Mark of the Web: a Zone.Identifier stream of the zone
// alone, and no other stream.
//
// The uploads are made by the test with the client's own copy of core
// (helpers/hosted.mjs), end-to-end encrypted: the link carries the key, and
// the app's transfer window decrypts.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { madeUpFile, readZip, summary } from '../helpers/files.mjs';
import { addLink, cardButton, downloadCard, downloadCards, downloadStatus, expect, test } from '../helpers/desktop.mjs';
import { uploadWithCore } from '../helpers/hosted.mjs';

/** The partial folder in the app's profile: where a download is written until it's whole. */
const partialsOf = (desktop) => path.join(desktop.profile, 'Partial Downloads');
const listing = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
const routes = (server) => server.requests().map((r) => `${r.method} ${new URL(r.url, server.baseUrl).pathname}`);
const advancedOptions = (window) => window.getByRole('dialog', { name: 'Advanced Options' });

/** The name a bundle's folder (or, with .zip, its ZIP) has when it's saved at `at`, in local time. */
const two = (n) => String(n).padStart(2, '0');
const savedName = (at) => `dropgate-bundle-${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}`;

/** The names a bundle saved in the next 30 seconds can have: each second's. */
const savedNamesFromNow = () => Array.from({ length: 30 }, (_, s) => savedName(new Date(Date.now() + s * 1000)));

/**
 * A bundle of four made-up files, uploaded with core, end-to-end encrypted:
 * two of them a.b and a_b, which core makes the same safe name, and CON.txt,
 * which Windows keeps for itself.
 */
async function bundleOf(desktop, server, seed) {
    const files = [
        madeUpFile('Minutes é.pdf', 120_000, seed),
        madeUpFile('a:b', 3_000, seed + 1),
        madeUpFile('a_b', 4_000, seed + 2),
        madeUpFile('CON.txt', 5_000, seed + 3),
    ];
    // A name of a few bytes turns up by chance in an encrypted chunk's random bytes, so only the longer
    // ones are looked for in what the server got; every one is still checked on disk.
    desktop.secrets.addFiles(files.filter((file) => Buffer.byteLength(file.name) >= 6));
    const { link, id } = await uploadWithCore(server, files);
    desktop.secrets.addLink(link);
    return { files, link, id };
}

/** Tick a download's files in Advanced Options so only those named stay, set Save as one ZIP, and Apply. */
async function choose(window, card, { keep, asZip }) {
    await card.getByRole('button', { name: 'Advanced Options' }).click();
    const dialog = advancedOptions(window);
    await expect(dialog.getByRole('group', { name: 'Files to download' })).toBeVisible();
    for (const row of await dialog.locator('.options-file-pick').all()) {
        const name = await row.locator('.options-file-name').innerText();
        await row.getByRole('checkbox').setChecked(keep.includes(name));
    }
    await dialog.getByRole('switch', { name: 'Save as one ZIP' }).setChecked(asZip);
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();
}

/** The streams a file has on Windows' NTFS, besides its own data, as PowerShell lists them. */
function streamsOf(file) {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', '(Get-Item -LiteralPath $env:TARGET -Stream *).Stream -join "|"'], {
        env: { ...process.env, TARGET: file },
        encoding: 'utf8',
    });
    return out.trim().split('|').filter((stream) => stream && stream !== ':$DATA');
}

test('a bundle\'s chosen files are saved as files into a new folder of their own, named for when, made unique, each name made safe and unique; Open Folder opens it', async ({ desktop, server }) => {
    const { files, link, id } = await bundleOf(desktop, server, 21);
    const app = await desktop.launch();
    const window = await app.window();
    await addLink(window, link);
    await expect(downloadStatus(window)).toHaveText('Ready');
    const card = downloadCard(window);
    await expect(card.locator('.kit-card-name')).toHaveText('4 files');
    await expect(card.locator('.kit-card-meta')).toHaveText(`129 KB · Minutes é.pdf and 3 More · ${new URL(link).host} · Encrypted`);
    await expect(card.locator('.kit-card-settings'), 'all of them, as files: nothing set').toBeHidden();

    // Advanced Options: its files, each ticked, and Save as one ZIP, off, with its help line.
    await card.getByRole('button', { name: 'Advanced Options' }).click();
    const dialog = advancedOptions(window);
    await expect(dialog.locator('.options-file-name')).toHaveText(files.map((file) => file.name));
    for (const box of await dialog.getByRole('checkbox').all()) await expect(box).toBeChecked();
    const zip = dialog.getByRole('switch', { name: 'Save as one ZIP' });
    await expect(zip).not.toBeChecked();
    await expect(dialog).toContainText('Each file is saved on its own, together in a new folder.');
    // None ticked: Apply is off, and says why.
    for (const box of await dialog.getByRole('checkbox').all()) await box.uncheck();
    await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await expect(dialog).toContainText('Choose at least one file to download.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(card.locator('.kit-card-settings'), 'Cancel leaves it as it was').toBeHidden();

    await choose(window, card, { keep: ['Minutes é.pdf', 'a:b', 'a_b'], asZip: false });
    await expect(card.locator('.kit-card-settings')).toHaveText('3 of 4 Files');

    // Names a bundle saved now could have, taken already: its folder is made unique.
    const taken = savedNamesFromNow();
    for (const name of taken) fs.mkdirSync(path.join(desktop.downloads, name));
    await cardButton(card, 'Download').click();
    await expect(downloadStatus(window)).toHaveText('Saved to Downloads · In a Folder of Its Own', { timeout: 30_000 });

    const made = listing(desktop.downloads).filter((name) => !taken.includes(name));
    expect(made, 'the bundle\'s folder').toHaveLength(1);
    expect(taken.map((name) => `${name} (1)`), 'named for when it was saved, made unique').toContain(made[0]);
    const bundle = path.join(desktop.downloads, made[0]);
    // Only the files chosen, each under its made-safe name, the two that make the same one told apart.
    expect(listing(bundle)).toEqual(['Minutes é.pdf', 'a_b', 'a_b (1)']);
    expect(summary(fs.readFileSync(path.join(bundle, 'Minutes é.pdf')))).toEqual(summary(files[0].buffer));
    expect(summary(fs.readFileSync(path.join(bundle, 'a_b')))).toEqual(summary(files[1].buffer));
    expect(summary(fs.readFileSync(path.join(bundle, 'a_b (1)')))).toEqual(summary(files[2].buffer));
    for (const name of taken) expect(listing(path.join(desktop.downloads, name)), 'the folders there already, untouched').toEqual([]);
    expect(listing(partialsOf(desktop)), 'the partial folder, once it\'s saved').toEqual([]);
    expect(routes(server).filter((r) => r === `POST /api/v4/objects/${id}/leases`), 'one lease: one download').toHaveLength(1);

    // Open Folder opens the bundle's own folder: never a file in it.
    await cardButton(card, 'Open Folder').click();
    await expect.poll(() => app.eventsOf('shell')).toEqual([expect.objectContaining({ method: 'openPath', path: path.join(fs.realpathSync(desktop.downloads), made[0]) })]);
    expect(app.eventsOf('shell').filter(({ method }) => method === 'showItemInFolder')).toEqual([]);
});

test('a bundle as one ZIP: only its chosen files, read back whole under core\'s made-safe names, named for when it\'s saved; Bulk Edit sets it on several', async ({ desktop, server }) => {
    const first = await bundleOf(desktop, server, 31);
    const second = await bundleOf(desktop, server, 41);
    const app = await desktop.launch();
    const window = await app.window();
    await addLink(window, first.link);
    await expect(downloadStatus(window)).toHaveText('Ready');
    await addLink(window, second.link);
    await expect(downloadCards(window)).toHaveCount(2);
    await expect(downloadStatus(window)).toHaveText('Ready');
    const [firstCard, secondCard] = [downloadCards(window).first(), downloadCards(window).last()];

    // Bulk Edit, on the two selected: Save as one ZIP for both.
    await window.locator('#download-bulk').getByRole('checkbox', { name: /^Select all/ }).check();
    await window.locator('#download-bulk').getByRole('button', { name: 'Bulk Edit' }).click();
    const dialog = advancedOptions(window);
    await expect(dialog).toContainText('For the 2 downloads selected.');
    await expect(dialog.getByRole('checkbox'), 'no files to choose for several').toHaveCount(0);
    await dialog.getByRole('switch', { name: 'Save as one ZIP' }).check();
    await expect(dialog).toContainText('The files are saved together, as one ZIP file.');
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(firstCard.locator('.kit-card-settings')).toHaveText('As One ZIP');
    await expect(secondCard.locator('.kit-card-settings')).toHaveText('As One ZIP');
    await window.locator('#download-bulk').getByRole('button', { name: 'Deselect' }).click();

    // The first, three of its four files.
    await choose(window, firstCard, { keep: ['a:b', 'a_b', 'CON.txt'], asZip: true });
    await expect(firstCard.locator('.kit-card-settings')).toHaveText('3 of 4 Files · As One ZIP');
    const names = savedNamesFromNow();
    await cardButton(firstCard, 'Download').click();
    await expect(firstCard.locator('.kit-card-status')).toHaveText('Saved to Downloads', { timeout: 30_000 });
    const [zipName] = listing(desktop.downloads);
    expect(listing(desktop.downloads)).toHaveLength(1);
    expect(names.map((name) => `${name}.zip`), 'named for when it was saved').toContain(zipName);
    const entries = readZip(fs.readFileSync(path.join(desktop.downloads, zipName)));
    expect(entries.map(({ name }) => name), 'its members: only those chosen, their names made safe and told apart').toEqual(['a_b', 'a_b (1)', '_CON.txt']);
    expect(entries.map(({ bytes }) => summary(bytes))).toEqual([1, 2, 3].map((i) => summary(first.files[i].buffer)));
    expect(listing(partialsOf(desktop))).toEqual([]);

    // Show in Folder shows the ZIP in its folder.
    await cardButton(firstCard, 'Show in Folder').click();
    await expect.poll(() => app.eventsOf('shell')).toEqual([expect.objectContaining({ method: 'showItemInFolder', path: path.join(fs.realpathSync(desktop.downloads), zipName) })]);

    // The second, all of it, beside the first: a name of its own.
    await cardButton(secondCard, 'Download').click();
    await expect(secondCard.locator('.kit-card-status')).toHaveText('Saved to Downloads', { timeout: 30_000 });
    const [otherName] = listing(desktop.downloads).filter((name) => name !== zipName);
    expect(otherName).toMatch(/^dropgate-bundle-\d{8}-\d{6}( \(1\))?\.zip$/);
    expect(readZip(fs.readFileSync(path.join(desktop.downloads, otherName))).map(({ name }) => name)).toEqual(['Minutes é.pdf', 'a_b', 'a_b (1)', '_CON.txt']);
});

test('on Windows, every file saved carries the Mark of the Web, the zone alone, and no other stream: one file, a ZIP, and each of a bundle\'s', async ({ desktop, server }) => {
    test.skip(process.platform !== 'win32', 'Windows\' Mark of the Web');
    const single = madeUpFile('Report é.pdf', 50_000, 51);
    desktop.secrets.addFiles([single]);
    const one = await uploadWithCore(server, [single]);
    desktop.secrets.addLink(one.link);
    const asZip = await bundleOf(desktop, server, 61);
    const asFiles = await bundleOf(desktop, server, 71);

    const app = await desktop.launch();
    const window = await app.window();
    for (const { link } of [one, asZip, asFiles]) {
        await addLink(window, link);
        await expect(downloadStatus(window)).toHaveText('Ready');
    }
    await choose(window, downloadCards(window).nth(1), { keep: asZip.files.map((file) => file.name), asZip: true });
    for (const card of await downloadCards(window).all()) {
        await cardButton(card, 'Download').click();
        await expect(card.locator('.kit-card-status')).toHaveText(/^Saved to Downloads/, { timeout: 30_000 });
    }

    const top = listing(desktop.downloads);
    const zip = top.find((name) => name.endsWith('.zip'));
    const folder = top.find((name) => name.startsWith('dropgate-bundle-') && !name.endsWith('.zip'));
    const saved = [
        path.join(desktop.downloads, 'Report é.pdf'),
        path.join(desktop.downloads, zip),
        ...listing(path.join(desktop.downloads, folder)).map((name) => path.join(desktop.downloads, folder, name)),
    ];
    expect(saved).toHaveLength(6);
    for (const file of saved) {
        // Exactly the zone: no HostUrl or ReferrerUrl, so nothing says where it came from.
        expect(fs.readFileSync(`${file}:Zone.Identifier`, 'utf8'), file).toBe('[ZoneTransfer]\r\nZoneId=3\r\n');
        expect(streamsOf(file), file).toEqual(['Zone.Identifier']);
    }
    expect(streamsOf(path.join(desktop.downloads, folder)), 'the bundle\'s folder').toEqual([]);
});
