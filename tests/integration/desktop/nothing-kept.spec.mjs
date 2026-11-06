// What the desktop app keeps of its transfers: nothing. With its log kept on
// disk (Settings > Privacy), downloads (a bundle as files into a folder
// chosen for it, a bundle as one ZIP) are logged with no file's name, no folder, no link, no
// key and no upload's ID. And after a run of uploads, a Delete, downloads
// saved and one left paused at quit, nothing anywhere in the profile holds a
// file's name, path, folder or bytes, a link, a key, an upload's ID or a
// manage token. What the person chose to save is the one exception: it's in
// the folders they chose, outside the profile.
import fs from 'node:fs';
import path from 'node:path';
import { madeUpFile } from '../helpers/files.mjs';
import { addLink, cardButton, downloadCards, expect, pickFolder, test, uploadCard, uploadCards } from '../helpers/desktop.mjs';
import { uploadWithCore } from '../helpers/hosted.mjs';
import { heldIn, secretHashedIn } from '../helpers/profile.mjs';

// The app's own uploads end-to-end encrypted (to an https:// address, through the test's TLS proxy), and a
// download that can be paused.
test.use({ tlsProxy: true, serverEnv: { UPLOAD_MAX_PAUSE_MINUTES: '30' } });

const partialsOf = (desktop) => path.join(desktop.profile, 'Partial Downloads');
const listing = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
const advancedOptions = (window) => window.getByRole('dialog', { name: 'Advanced Options' });

/** Each upload's manage token, as the server knows it: its SHA-256, from the request that started it. */
const tokenHashes = (server) => server.requests()
    .filter(({ method, url }) => method === 'POST' && url === '/api/v4/uploads')
    .map(({ body }) => JSON.parse(body.toString('utf8')).manageTokenHash);

/** Everything secret about an upload's link: the link, its key and the upload's ID. */
const partsOf = (link) => {
    const url = new URL(link);
    return [link, url.hash.slice(1), url.pathname.slice(1)].filter(Boolean);
};

/** Settings, open at a tab. */
async function openSettings(window, tab) {
    await window.getByRole('button', { name: 'Settings', exact: true }).click();
    await window.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
    return window.getByRole('tabpanel', { name: new RegExp(`^${tab}`) });
}

/** Upload made-up files with core, as a link to download, noting their names and key as secrets. */
async function hosted(desktop, server, files) {
    desktop.secrets.addFiles(files);
    const { link } = await uploadWithCore(server, files);
    desktop.secrets.addLink(link);
    return link;
}

/** Add a link, and give its download's card, by its place (downloadCard() is whichever is newest), once it's Ready. */
async function added(window, link) {
    const place = await downloadCards(window).count();
    await addLink(window, link);
    const card = downloadCards(window).nth(place);
    await expect(card.locator('.kit-card-status')).toHaveText('Ready');
    return card;
}

test('the log kept on disk holds the downloads, and none of their names, folders, links, keys or IDs', async ({ desktop, server }) => {
    const bundle = [madeUpFile('Logged bundle first é.pdf', 40_000, 201), madeUpFile('Logged bundle second é.txt', 30_000, 202)];
    const zipped = [madeUpFile('Logged as a ZIP é.bin', 50_000, 203), madeUpFile('Logged in the ZIP too é.bin', 20_000, 204)];
    const bundleLink = await hosted(desktop, server, bundle);
    const zipLink = await hosted(desktop, server, zipped);
    const chosen = path.join(desktop.root, 'Private Downloads Folder');
    fs.mkdirSync(chosen);

    const app = await desktop.launch();
    const window = await app.window();
    const privacy = await openSettings(window, 'Privacy');
    await privacy.getByRole('switch', { name: 'Keep log on disk for troubleshooting' }).click();
    const log = path.join(desktop.profile, 'debug.log');
    await expect.poll(() => fs.existsSync(log), { message: 'whether debug.log was written' }).toBe(true);

    // A bundle into a folder chosen for it, as files.
    await pickFolder(app, chosen);
    const first = await added(window, bundleLink);
    await first.getByRole('combobox', { name: 'Save to' }).selectOption({ label: 'Choose Folder…' });
    await expect(first.getByRole('combobox', { name: 'Save to' }).locator('option:checked')).toHaveText('Private Downloads Folder');
    await cardButton(first, 'Download').click();
    await expect(first.locator('.kit-card-status')).toHaveText('Saved to Private Downloads Folder · In a Folder of Its Own', { timeout: 30_000 });
    // A bundle as one ZIP, into Downloads.
    const second = await added(window, zipLink);
    await second.getByRole('button', { name: 'Advanced Options' }).click();
    await advancedOptions(window).getByRole('switch', { name: 'Save as one ZIP' }).check();
    await advancedOptions(window).getByRole('button', { name: 'Apply' }).click();
    await expect(second.locator('.kit-card-settings')).toHaveText('As One ZIP');
    await cardButton(second, 'Download').click();
    await expect(second.locator('.kit-card-status')).toHaveText('Saved to Downloads', { timeout: 30_000 });
    await cardButton(first, 'Open Folder').click();
    await cardButton(second, 'Show in Folder').click();
    await expect.poll(() => app.eventsOf('shell').length).toBe(2);

    await expect.poll(() => (fs.readFileSync(log, 'utf8').match(/Download finished: success/g) ?? []).length, { message: 'both downloads, in the log' }).toBe(2);
    const text = fs.readFileSync(log, 'utf8').toLowerCase();
    const bundleFolder = listing(chosen)[0];
    const secrets = [
        ...[...bundle, ...zipped].map((file) => file.name), ...partsOf(bundleLink), ...partsOf(zipLink),
        chosen, path.basename(chosen), path.join(chosen, bundleFolder), desktop.downloads, partialsOf(desktop),
    ];
    for (const secret of secrets) {
        for (const form of new Set([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1), secret.replaceAll('\\', '/')])) {
            expect(text, `debug.log, for ${secret}`).not.toContain(form.toLowerCase());
        }
    }
});

test('after uploads, a Delete, downloads saved and one paused at quit, nothing in the profile holds a name, path, folder, bytes, link, key, upload ID or manage token', async ({ desktop, server }) => {
    const bundle = [madeUpFile('Scanned bundle first é.pdf', 40_000, 211), madeUpFile('Scanned bundle second é.txt', 30_000, 212)];
    const paused = [madeUpFile('Scanned paused download é.bin', 200_000, 213)];
    const bundleLink = await hosted(desktop, server, bundle);
    const pausedLink = await hosted(desktop, server, paused);
    const chosen = path.join(desktop.root, 'Private Downloads Folder');
    fs.mkdirSync(chosen);

    const app = await desktop.launch();
    const window = await app.window();
    await desktop.setUp(window);

    // Two uploads, from their cards; the first deleted from its server.
    const uploads = [madeUpFile('Scanned upload kept é.bin', 30_000, 214), madeUpFile('Scanned upload deleted é.bin', 30_000, 215)];
    const links = [];
    for (const file of uploads) {
        desktop.secrets.addFiles([file]);
        await window.locator('#file-input').setInputFiles([desktop.addFile(file)]);
        await expect(uploadCard(window).locator('.kit-card-name')).toHaveText(file.name);
        await cardButton(uploadCard(window), 'Upload').click();
        await expect(uploadCard(window).locator('.kit-card-status')).toHaveText('Uploaded · End-to-End Encrypted', { timeout: 30_000 });
        links.push(await uploadCard(window).getByRole('textbox', { name: 'Link' }).inputValue());
        desktop.secrets.addLink(links.at(-1));
    }
    await cardButton(uploadCards(window).last(), 'Delete').click();
    await window.getByRole('alertdialog', { name: 'Delete This Upload?' }).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(uploadCards(window).last().locator('.kit-card-status')).toHaveText('Deleted from the server. Its link no longer works.');

    // A bundle saved as files into a folder chosen for it.
    await pickFolder(app, chosen);
    const saved = await added(window, bundleLink);
    await saved.getByRole('combobox', { name: 'Save to' }).selectOption({ label: 'Choose Folder…' });
    await cardButton(saved, 'Download').click();
    await expect(saved.locator('.kit-card-status')).toHaveText('Saved to Private Downloads Folder · In a Folder of Its Own', { timeout: 30_000 });

    // And one paused as the app quits, its content held in the transfer window until it's paused.
    const downloader = await app.transferWindow();
    const held = [];
    await downloader.route('**/api/v4/objects/*/content', (route) => {
        held.push(route);
    });
    const pausing = await added(window, pausedLink);
    await cardButton(pausing, 'Download').click();
    await expect.poll(() => held.length, { message: 'its content should be on its way' }).toBe(1);
    await cardButton(pausing, 'Pause').click();
    await expect(pausing.locator('.kit-card-status')).toHaveText(/^Paused\. Kept until /);
    expect(listing(partialsOf(desktop)), 'held open while paused').toHaveLength(1);
    await expect(downloadCards(window)).toHaveCount(2);
    await app.quit();

    expect(listing(partialsOf(desktop)), 'the partial folder, after quitting').toEqual([]);
    // The app's two uploads' manage tokens, and the test's own two (which the app never had).
    const hashes = tokenHashes(server);
    expect(hashes, "the uploads' manage tokens").toHaveLength(4);
    const texts = [
        ...[...uploads, ...bundle, ...paused].map((file) => file.name),
        ...[...links, bundleLink, pausedLink].flatMap(partsOf),
        desktop.folder, path.basename(desktop.folder), chosen, path.basename(chosen), path.join(chosen, listing(chosen)[0]),
    ];
    expect(heldIn(desktop.profile, { texts, bytes: [...uploads, ...bundle, ...paused].map((file) => file.buffer) }), 'what the profile holds').toEqual([]);
    for (const hash of hashes) expect(secretHashedIn(desktop.profile, hash), 'a manage token, in the profile').toEqual([]);
    // What the person chose to save is where they chose: the bundle, in its own folder.
    expect(listing(path.join(chosen, listing(chosen)[0]))).toEqual(bundle.map((file) => file.name).sort());
});
