// Upload on cards: each upload is a card, waiting until it's started. Files
// picked, dropped or opened together make one; files dropped onto one still
// waiting join it (a file already in it is skipped, with a toast), and onto
// one that has started make a new one, with a toast that says why. Each card's
// Upload starts it, and the action bar's Upload All starts every one waiting:
// each card is one upload, with one link. A finished one keeps its link, which
// was copied as it finished, and Copy Link copies it again; it stays until
// it's removed (its ×, Remove on the bulk bar for those selected, Clear
// Finished), and a failed or cancelled one can be tried again. Uploads ending
// together while the window is out of sight are told of in one notification.
//
// The server is reached through the TLS proxy, so every upload is end-to-end
// encrypted and nothing asks the Upload Security Warning.
import { madeUpFile, sparseFile } from '../helpers/files.mjs';
import {
    actionLine, cardButton, dropFiles, expect, holdChunks, test, transfersIn, uploadCard, uploadCards, uploadsStarted,
} from '../helpers/desktop.mjs';

// Three 5 MiB chunks: the first goes through, the rest can be held.
const SIZE = 12_000_000;

test.use({ tlsProxy: true });

/** Each card's name, in the order they were made. */
const names = (window) => window.locator('#upload-grid .kit-card .kit-card-name');

/** The card named so (a file's name, or "4 files"). */
const card = (window, name) => uploadCards(window).filter({ has: window.locator('.kit-card-name', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });

/** The action bar's Upload All. */
const uploadAll = (window) => window.locator('#action-bar').getByRole('button', { name: 'Upload All', exact: true });

/** Say whether the main window counts as focused (the test preload's __dropgateFocused). */
const focus = (app, focused) => app.app.evaluate((_electron, value) => { globalThis.__dropgateFocused = value; }, focused);

/** Write made-up files to the test's folder, and return them with their paths. */
function filesFor(desktop, names, size = 30_000, seed = 100) {
    return names.map((name, i) => {
        const file = madeUpFile(name, size, seed + i);
        desktop.secrets.addFiles([file]);
        return { ...file, path: desktop.addFile(file) };
    });
}

test('files picked together are one upload; dropped on a waiting one they join it, a repeat skipped; on a started one, a new upload; each card is one upload with one link', async ({ desktop, server, page }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await desktop.setUp(window);
    const picked = filesFor(desktop, ['Picked one é.bin', 'Picked two.bin', 'Picked three.bin'], 30_000, 100);
    const [loose, joining, onStarted] = filesFor(desktop, ['Dropped loose.bin', 'Dropped joining.bin', 'Dropped on started.bin'], 30_000, 110);
    const [big] = filesFor(desktop, ['Held big.bin'], SIZE, 120);

    // Picked together: one upload, waiting, Ready.
    await window.locator('#file-input').setInputFiles(picked.map((file) => file.path));
    await expect(names(window)).toHaveText(['3 files']);
    await expect(card(window, '3 files').locator('.kit-card-status')).toHaveText('Ready');
    await expect(card(window, '3 files').locator('.kit-card-meta')).toHaveText(/ · Picked one é\.bin and 2 More$/);

    // Dropped on Upload's empty space: a new upload.
    await dropFiles(window, window.locator('#upload-area'), [loose.path]);
    await expect(names(window)).toHaveText(['3 files', 'Dropped loose.bin']);

    // Dropped on the waiting one: it joins it, and one already in it is skipped, with a toast.
    await dropFiles(window, card(window, '3 files'), [picked[0].path, joining.path]);
    await expect(names(window)).toHaveText(['4 files', 'Dropped loose.bin']);
    await expect(window.getByText('Skipped 1 file already in that upload.')).toBeVisible();

    // A big one, started with its own Upload, its chunks held after the first.
    await dropFiles(window, window.locator('#upload-area'), [big.path]);
    await expect(names(window)).toHaveText(['4 files', 'Dropped loose.bin', 'Held big.bin']);
    const chunks = await holdChunks(await app.transferWindow());
    await cardButton(card(window, 'Held big.bin'), 'Upload').click();
    await expect.poll(() => chunks.sent.length, { message: 'its second chunk, held' }).toBe(2);
    await expect(card(window, 'Held big.bin').locator('.kit-card-status')).toHaveText(/^Uploading \d+%$/);
    await expect(card(window, 'Held big.bin').getByRole('combobox', { name: 'Upload to' }), 'its server, locked once it has started').toBeDisabled();

    // Dropped on the started one: it takes nothing (its files are sealed), and the file is a new upload, with a toast saying why.
    await dropFiles(window, card(window, 'Held big.bin'), [onStarted.path]);
    await expect(window.getByText('That upload has already started, so this file is a new upload.')).toBeVisible();
    await expect(names(window)).toHaveText(['4 files', 'Dropped loose.bin', 'Held big.bin', 'Dropped on started.bin']);
    expect((await transfersIn(window)).map(({ files }) => files.length), 'how many files each upload has').toEqual([4, 1, 1, 1]);
    await expect(actionLine(window)).toHaveText(/^4 uploads\s*1 Running · 3 Ready$/);

    // Upload All starts every one waiting, and they finish with the held one.
    await uploadAll(window).click();
    chunks.release();
    for (const name of ['4 files', 'Dropped loose.bin', 'Held big.bin', 'Dropped on started.bin']) {
        await expect(card(window, name).locator('.kit-card-status'), name).toHaveText('Uploaded · End-to-End Encrypted', { timeout: 30_000 });
    }
    await expect(uploadAll(window), 'nothing left waiting').toBeDisabled();

    // Each card was one upload, with its own link; the first, of its four files.
    expect(uploadsStarted(server), 'the uploads the server was asked to start').toHaveLength(4);
    const links = [];
    for (const name of ['4 files', 'Dropped loose.bin', 'Held big.bin', 'Dropped on started.bin']) {
        links.push(await card(window, name).getByRole('textbox', { name: 'Link' }).inputValue());
    }
    for (const link of links) desktop.secrets.addLink(link);
    expect(new Set(links).size, 'a link each').toBe(4);
    await page.goto(desktop.receivingUrl(links[0]));
    await expect(page.locator('#bundle-file-count'), 'the files in the first card\'s upload').toHaveText('4');
});

test('a finished upload\'s link is copied as it finishes and shown; Copy Link copies it again; finished ones stay until removed, and a cancelled one can be tried again', async ({ desktop }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await desktop.setUp(window);
    const [first, second] = filesFor(desktop, ['Copied as it finished.bin', 'Cancelled then retried.bin'], 30_000, 130);
    const [big] = filesFor(desktop, ['Cancelled big.bin'], SIZE, 140);

    // As it finishes, the link is copied (kept out of the clipboard's history: share.spec checks the formats) and shown.
    await window.locator('#file-input').setInputFiles([first.path]);
    await cardButton(uploadCard(window), 'Upload').click();
    await expect(uploadCard(window).locator('.kit-card-status')).toHaveText('Uploaded · End-to-End Encrypted', { timeout: 30_000 });
    const link = await uploadCard(window).getByRole('textbox', { name: 'Link' }).inputValue();
    desktop.secrets.addLink(link);
    await expect.poll(() => app.eventsOf('clipboard').map(({ text }) => text), { message: 'what was copied' }).toEqual([link]);
    await expect(window.getByText('Link to Copied as it finished.bin copied.')).toBeVisible();
    await cardButton(uploadCard(window), 'Copy Link').click();
    await expect.poll(() => app.eventsOf('clipboard').map(({ text }) => text), { message: 'what was copied, again' }).toEqual([link, link]);

    // One cancelled while it runs: it stays, Cancelled, with Retry, which makes it wait again, and it uploads.
    const chunks = await holdChunks(await app.transferWindow());
    await window.locator('#file-input').setInputFiles([big.path]);
    await cardButton(uploadCard(window), 'Upload').click();
    await expect.poll(() => chunks.sent.length, { message: 'its second chunk, held' }).toBe(2);
    await cardButton(uploadCard(window), 'Cancel').click();
    await expect(uploadCard(window).locator('.kit-card-status')).toHaveText('Cancelled');
    chunks.release();
    await cardButton(uploadCard(window), 'Retry').click();
    await expect(uploadCard(window).locator('.kit-card-status')).toHaveText('Ready');
    await cardButton(uploadCard(window), 'Upload').click();
    await expect(uploadCard(window).locator('.kit-card-status')).toHaveText('Uploaded · End-to-End Encrypted', { timeout: 30_000 });
    desktop.secrets.addLink(await uploadCard(window).getByRole('textbox', { name: 'Link' }).inputValue());

    // A waiting one goes with its ×; Clear Finished takes every finished one, and leaves the waiting one.
    await window.locator('#file-input').setInputFiles([second.path]);
    await expect(names(window)).toHaveText(['Copied as it finished.bin', 'Cancelled big.bin', 'Cancelled then retried.bin']);
    await card(window, 'Copied as it finished.bin').getByRole('button', { name: 'Remove Copied as it finished.bin' }).click();
    await expect(names(window)).toHaveText(['Cancelled big.bin', 'Cancelled then retried.bin']);
    await window.locator('#action-bar').getByRole('button', { name: 'Clear Finished', exact: true }).click();
    await expect(names(window)).toHaveText(['Cancelled then retried.bin']);
    expect((await transfersIn(window)).map(({ state }) => state), "main's registry").toEqual(['waiting']);
    await card(window, 'Cancelled then retried.bin').getByRole('button', { name: 'Remove Cancelled then retried.bin' }).click();
    await expect(names(window)).toHaveCount(0);
    await expect(window.locator('#empty-state'), 'the drop zone, with nothing left').toBeVisible();
    expect(await transfersIn(window), "main's registry, emptied").toEqual([]);
});

test('Ctrl+A selects every upload, the bulk bar says how many, and its Remove takes those that can go', async ({ desktop }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await desktop.setUp(window);
    const files = filesFor(desktop, ['Selected one.bin', 'Selected two.bin', 'Selected three.bin'], 30_000, 150);
    for (const file of files) await dropFiles(window, window.locator('#upload-area'), [file.path]);
    await expect(names(window)).toHaveCount(3);
    const bulk = window.locator('#upload-bulk');
    await expect(bulk.getByText('Select all', { exact: true })).toBeVisible();
    await expect(bulk.getByText('Upload all to')).toBeVisible();

    // A click selects one; Ctrl+A every one; the bar acts on the selection.
    await card(window, 'Selected two.bin').locator('.kit-card-meta').click();
    await expect(bulk.getByText('1 selected', { exact: true })).toBeVisible();
    await expect(bulk.getByText('Upload selected to')).toBeVisible();
    await window.keyboard.press('Control+A');
    await expect(bulk.getByText('3 selected', { exact: true })).toBeVisible();
    await window.keyboard.press('Escape');
    await expect(bulk.getByText('Select all', { exact: true })).toBeVisible();

    // Two selected, then Remove on the bar: they go, from the window and main's registry.
    await card(window, 'Selected one.bin').locator('.kit-card-meta').click();
    await card(window, 'Selected three.bin').locator('.kit-card-meta').click({ modifiers: ['Control'] });
    await expect(bulk.getByText('2 selected', { exact: true })).toBeVisible();
    await bulk.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(names(window)).toHaveText(['Selected two.bin']);
    expect((await transfersIn(window)).map(({ files: [{ name }] }) => name), "main's registry").toEqual(['Selected two.bin']);
});

test('uploads started together from their cards, ending while the window is out of sight, are told of in one notification; with it in front, none', async ({ desktop }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await desktop.setUp(window);
    const files = filesFor(desktop, ['Told of one é.bin', 'Told of two.bin', 'Told of three.bin'], 30_000, 160);
    for (const file of files) await dropFiles(window, window.locator('#upload-area'), [file.path]);
    await expect(names(window)).toHaveCount(3);

    await focus(app, false);
    await uploadAll(window).click();
    await expect.poll(async () => (await transfersIn(window)).map(({ state }) => state), { message: 'the three, finished', timeout: 30_000 })
        .toEqual(['done', 'done', 'done']);
    const endings = () => app.eventsOf('notification').filter(({ title }) => /Successful|Failed|Finished/.test(title));
    await expect.poll(() => endings().map(({ title, body }) => ({ title, body })), { message: 'what was told of their ending' })
        .toEqual([{ title: '3 Uploads Finished', body: 'The latest link is copied to the clipboard.' }]);
    for (const { text } of app.eventsOf('clipboard')) desktop.secrets.addLink(text);

    // In front, the window shows it: nothing is told.
    await focus(app, true);
    const [another] = filesFor(desktop, ['Watched.bin'], 30_000, 170);
    await window.locator('#file-input').setInputFiles([another.path]);
    await cardButton(uploadCard(window), 'Upload').click();
    await expect(uploadCard(window).locator('.kit-card-status')).toHaveText('Uploaded · End-to-End Encrypted', { timeout: 30_000 });
    for (const { text } of app.eventsOf('clipboard')) desktop.secrets.addLink(text);
    await window.waitForTimeout(500);
    expect(endings(), 'notifications, with the window in front').toHaveLength(1);
    for (const { title, body } of app.eventsOf('notification')) {
        for (const file of [...files, another]) expect(`${title}\n${body}`, 'a notification').not.toContain(file.name);
    }
});

test.describe('on a server with no size limit', () => {
    test.use({ serverEnv: { UPLOAD_MAX_FILE_SIZE_MB: '0' } });

    // Dropgate 3 read a dropped file with no type whole to tell it from a
    // folder, so a large one, an ISO say, was refused as a folder. The app asks
    // the file system instead. The file is sparse: nothing of its 5 GB is
    // written to disk.
    test('a 5 GB file with no type, dropped from disk, is taken as a file, not a folder', async ({ desktop }) => {
        const disc = sparseFile('Disc image é', 5 * 1024 ** 3);
        try {
            desktop.secrets.addFiles([{ name: 'Disc image é' }]);
            const app = await desktop.launch();
            const window = await app.window();
            await desktop.setUp(window);

            await dropFiles(window, window.locator('#upload-area'), [disc.path]);
            await expect(names(window)).toHaveText(['Disc image é']);
            await expect(uploadCard(window).locator('.kit-card-status')).toHaveText('Ready');
            await expect(uploadCard(window).locator('.kit-card-meta')).toHaveText('5.0 GB');
            await expect(window.locator('#toast-host .toast-note')).toHaveCount(0);
        } finally {
            disc.remove();
        }
    });
});
