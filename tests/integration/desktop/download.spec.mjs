// Download, in the desktop app: a link pasted into its box makes a download
// that reads the link's list of files with no lease (so the server counts
// nothing) and waits, Ready, until Download; then the file is written byte for
// byte into its Save to folder (the system's Downloads unless another is
// chosen, the test's own here), under its own name, and Show in Folder shows
// it there: nothing received is ever opened. A direct transfer's code or link
// says those come later; a link that isn't Dropgate's is refused. Main never
// carries the file's bytes.
//
// The uploads are made by the test, with the client's own copy of core
// (helpers/hosted.mjs), end-to-end encrypted, over the test server's plain
// HTTP: the link carries its key, and the app's transfer window decrypts.
import fs from 'node:fs';
import path from 'node:path';
import { madeUpFile, summary } from '../helpers/files.mjs';
import { addLink, cardButton, downloadCard, downloadCards, downloadStatus, expect, pickFolder, test } from '../helpers/desktop.mjs';
import { uploadWithCore } from '../helpers/hosted.mjs';
import { heldIn } from '../helpers/profile.mjs';

/** The server's requests as `METHOD /path`. */
const routes = (server) => server.requests().map((r) => `${r.method} ${new URL(r.url, server.baseUrl).pathname}`);

/** Upload a made-up file with core, noting its name and key as secrets the app must keep from the server. */
async function uploaded(desktop, server, name, size, seed) {
    const file = madeUpFile(name, size, seed);
    desktop.secrets.addFiles([file]);
    const { link, id } = await uploadWithCore(server, [file]);
    desktop.secrets.addLink(link);
    return { file, link, id };
}

test('a pasted link reads its list of files with no lease and waits; Download saves it byte for byte in Downloads, and Show in Folder shows it there', async ({ desktop, server }) => {
    const { file, link, id } = await uploaded(desktop, server, 'Quarterly accounts é.pdf', 300_000, 61);
    const app = await desktop.launch();
    const window = await app.window();
    const before = routes(server).length;

    await addLink(window, link);
    await expect(downloadStatus(window)).toHaveText('Ready');
    await expect(window.locator('#link-input'), 'the box, once the link is handed over').toHaveValue('');
    const card = downloadCard(window);
    await expect(card.locator('.kit-card-name')).toHaveText(file.name);
    await expect(card.locator('.kit-card-meta')).toHaveText(`293 KB · ${new URL(link).host} · Encrypted`);
    await expect(card.getByRole('combobox', { name: 'Save to' })).toHaveValue('default');
    await expect(card.getByRole('combobox', { name: 'Save to' }).locator('option:checked')).toHaveText('Downloads');

    // Read with no lease: the upload's details, and nothing that counts a download.
    const read = routes(server).slice(before);
    expect(read.filter((r) => r.startsWith('GET /api/v4/objects/')), 'the reads of its details').toEqual([`GET /api/v4/objects/${id}`]);
    expect(read.filter((r) => /lease/.test(r)), 'leases taken while it waits').toEqual([]);
    await window.waitForTimeout(1_000);
    await expect(downloadStatus(window), 'nothing starts by itself').toHaveText('Ready');

    await cardButton(card, 'Download').click();
    await expect(downloadStatus(window)).toHaveText('Saved to Downloads', { timeout: 30_000 });
    expect(fs.readdirSync(desktop.downloads), 'the Downloads folder').toEqual([file.name]);
    expect(summary(fs.readFileSync(path.join(desktop.downloads, file.name)))).toEqual(summary(file.buffer));
    expect(routes(server).filter((r) => r === `POST /api/v4/objects/${id}/leases`), 'one lease: one download').toHaveLength(1);
    expect(app.eventsOf('download-finished').map(({ status }) => status)).toEqual(['success']);

    await cardButton(card, 'Show in Folder').click();
    await expect.poll(() => app.eventsOf('shell')).toEqual([expect.objectContaining({ method: 'showItemInFolder', path: path.join(fs.realpathSync(desktop.downloads), file.name) })]);

    // Main never carried the file's bytes: no message to or from it is bigger than a snapshot.
    await app.quit();
    const [{ sizes }] = app.eventsOf('ipc-sizes');
    expect(app.eventsOf('ipc-large'), 'messages to or from main over 64 KiB').toEqual([]);
    const biggest = Math.max(...Object.values(sizes).map(({ max }) => max));
    expect(biggest, 'the biggest message main sent or got').toBeLessThan(16 * 1024);
    for (const channel of ['page → main transfer:add-download', 'main → page engine:metadata', 'main → page engine:download', 'main → utility grant-output', 'utility → main']) {
        expect(Object.keys(sizes), `${channel} was seen`).toContain(channel);
    }
});

test('a code or a direct transfer\'s link says direct transfers come later; a link that isn\'t Dropgate\'s is refused; neither makes a download', async ({ desktop, server }) => {
    const app = await desktop.launch();
    const window = await app.window();
    for (const typed of ['ABCD-1234', 'abcd1234', `${server.baseUrl}/p2p#${'k'.repeat(43)}`, `${server.baseUrl}/p2p/ABCD-1234`]) {
        await addLink(window, typed);
        await expect(window.getByText('Direct transfers come to the desktop app later. For now, this box takes links to uploads.').last(), typed).toBeVisible();
    }
    for (const typed of ['https://example.com/', 'not a link at all', `${server.baseUrl}/f5aa7a2f-ce3a-4deb-b92f#${'k'.repeat(43)}`, `ftp://127.0.0.1/f5aa7a2f-ce3a-4deb-b92f-2da74b6b9bae`]) {
        await addLink(window, typed);
        await expect(window.getByText("That isn't a Dropgate link.").last(), typed).toBeVisible();
    }
    await addLink(window, `${server.baseUrl}/b/f5aa7a2f-ce3a-4deb-b92f-2da74b6b9bae#${'k'.repeat(43)}`);
    await expect(window.getByText("That link was made with an older version of Dropgate, which this app can't download.")).toBeVisible();
    await expect(downloadCards(window)).toHaveCount(0);
    expect(routes(server).filter((r) => r.startsWith('GET /api/v4/objects')), 'requests about uploads').toEqual([]);
});

test('a download\'s own folder: Choose Folder… with the system\'s picker; a name taken there becomes "name (1).ext", and nothing is replaced or asked', async ({ desktop, server }) => {
    const { file, link } = await uploaded(desktop, server, 'report.pdf', 40_000, 62);
    const chosen = path.join(desktop.root, 'Chosen Folder');
    fs.mkdirSync(chosen);
    fs.writeFileSync(path.join(chosen, 'Report.PDF'), 'mine');
    const app = await desktop.launch();
    const window = await app.window();
    await pickFolder(app, chosen);

    await addLink(window, link);
    await expect(downloadStatus(window)).toHaveText('Ready');
    const saveTo = downloadCard(window).getByRole('combobox', { name: 'Save to' });
    await saveTo.selectOption({ label: 'Choose Folder…' });
    await expect(saveTo.locator('option:checked')).toHaveText('Chosen Folder');
    expect(app.eventsOf('folder-picker'), 'the system\'s picker, asked once').toHaveLength(1);

    await cardButton(downloadCard(window), 'Download').click();
    await expect(downloadStatus(window)).toHaveText('Saved to Chosen Folder', { timeout: 30_000 });
    expect(fs.readdirSync(chosen).sort()).toEqual(['Report.PDF', 'report (1).pdf']);
    expect(fs.readFileSync(path.join(chosen, 'Report.PDF'), 'utf8'), 'the file there, untouched').toBe('mine');
    expect(summary(fs.readFileSync(path.join(chosen, 'report (1).pdf')))).toEqual(summary(file.buffer));
    expect(fs.readdirSync(desktop.downloads), 'Downloads').toEqual([]);
    // Nothing asked: no prompt came up.
    await expect(window.getByRole('alertdialog')).toHaveCount(0);

    // A folder picked and cancelled leaves Save to as it was.
    const next = await uploaded(desktop, server, 'second.bin', 1_000, 63);
    await addLink(window, next.link);
    await expect(downloadStatus(window)).toHaveText('Ready');
    await pickFolder(app, null);
    const secondSaveTo = downloadCard(window).getByRole('combobox', { name: 'Save to' });
    await secondSaveTo.selectOption({ label: 'Choose Folder…' });
    await expect(secondSaveTo).toHaveValue('default');
});

test('after a download and a restart, nothing in the profile holds the link, its key, the upload\'s ID, the file\'s name, its bytes or its folder', async ({ desktop, server }) => {
    const { file, link, id } = await uploaded(desktop, server, 'Tax return, final é.pdf', 120_000, 64);
    const folder = path.join(desktop.root, 'Private Papers Folder');
    fs.mkdirSync(folder);
    const app = await desktop.launch();
    const window = await app.window();
    await pickFolder(app, folder);
    await addLink(window, link);
    await expect(downloadStatus(window)).toHaveText('Ready');
    await downloadCard(window).getByRole('combobox', { name: 'Save to' }).selectOption({ label: 'Choose Folder…' });
    await cardButton(downloadCard(window), 'Download').click();
    await expect(downloadStatus(window)).toHaveText('Saved to Private Papers Folder', { timeout: 30_000 });
    await cardButton(downloadCard(window), 'Show in Folder').click();
    await app.quit();
    const again = await desktop.launch();
    await again.window();
    await again.quit();

    expect(fs.readdirSync(folder), 'the file, where it was saved').toEqual([file.name]);
    const { hash } = new URL(link);
    const texts = [file.name, link, id, hash.slice(1), folder, path.basename(folder), path.join(folder, file.name)];
    expect(heldIn(desktop.profile, { texts, bytes: [file.buffer] }), 'what the profile holds of the download').toEqual([]);
    const partials = path.join(desktop.profile, 'Partial Downloads');
    expect(fs.existsSync(partials) ? fs.readdirSync(partials) : [], 'the partial folder').toEqual([]);
});
