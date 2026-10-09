// What the desktop app leaves on disk: the files it's given, an upload, paused
// or finished, and its link are held in memory only. After a run, nothing in
// the profile (the app's own files and Chromium's alike) holds a file's name,
// its folder, its bytes, the link, its key or the upload's ID, in any form the
// app or Chromium would write them. Settings are the one thing the app keeps,
// and they name no file.
//
// Each file is opened with the app, as "Open with" does, so main hands it to
// the page and the page reads it through main, as it does every file on disk.
import fs from 'node:fs';
import path from 'node:path';
import { holdsPlaintext, madeUpFile } from '../helpers/files.mjs';
import { expect, test, uploadButton, uploadStatus } from '../helpers/desktop.mjs';

// End-to-end encrypted, so the link carries a key.
test.use({ tlsProxy: true });

/** Every file under a folder, with its bytes. */
function filesUnder(dir) {
    return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(entry.parentPath, entry.name))
        .map((file) => ({ file, bytes: fs.readFileSync(file) }));
}

/** Each way a text could be written: as it is, URL-encoded, JSON-escaped, with / for \, in UTF-8 and UTF-16. */
function forms(text) {
    const texts = new Set([text, encodeURIComponent(text), JSON.stringify(text).slice(1, -1), text.replaceAll('\\', '/')]);
    return [...texts].flatMap((t) => [Buffer.from(t, 'utf8'), Buffer.from(t, 'utf16le')]);
}

/** The files in the profile holding any of the texts, or any part of the bytes. */
function heldIn(profile, { texts, bytes }) {
    const found = [];
    for (const { file, bytes: held } of filesUnder(profile)) {
        const name = path.relative(profile, file);
        for (const text of texts) {
            if (forms(text).some((form) => held.includes(form))) found.push(`${name}: "${text}"`);
        }
        for (const plaintext of bytes) {
            // A piece every 64 KiB: a cache of any of it would hold one.
            if (holdsPlaintext(held, plaintext, { every: 65_536 })) found.push(`${name}: the file's bytes`);
        }
    }
    return found;
}

/** Launch the app with a made-up file, as "Open with" does, and point it at the server. */
async function launchWith(desktop, file) {
    desktop.secrets.addFiles([file]);
    const filePath = desktop.addFile(file);
    const app = await desktop.launch(filePath);
    const window = await app.window();
    await desktop.setUp(window);
    await expect(window.locator('#file-list .file-row-name')).toHaveText([file.name]);
    await expect(window.locator('#security-text')).toHaveText(/will be end-to-end encrypted/i);
    return { app, window, filePath };
}

test('after an upload and a restart, nothing in the profile holds the file\'s name, its folder, its bytes, the link or its key', async ({ desktop }) => {
    const file = madeUpFile('Quarterly accounts (draft).bin', 300_000, 51);
    const { app, window, filePath } = await launchWith(desktop, file);
    await uploadButton(window).click();
    await expect(uploadStatus(window)).toHaveText(/upload successful/i, { timeout: 30_000 });
    const link = await window.locator('#download-link').inputValue();
    desktop.secrets.addLink(link);
    await app.quit();
    const again = await desktop.launch();
    await again.window();
    await again.quit();

    const { pathname, hash } = new URL(link);
    expect(hash.length, 'the link has a key').toBeGreaterThan(40);
    const texts = [file.name, filePath, desktop.folder, path.basename(desktop.folder), link, pathname.slice(1), hash.slice(1)];
    expect(heldIn(desktop.profile, { texts, bytes: [file.buffer] }), 'what the profile holds of the upload').toEqual([]);
});

test('quit with an upload paused part-way, nothing in the profile holds the file\'s name, its folder, its bytes or the upload\'s ID', async ({ desktop }) => {
    // Three 5 MiB chunks, the second held until the pause.
    const file = madeUpFile('Board minutes, unsigned.bin', 12_000_000, 52);
    const { app, window, filePath } = await launchWith(desktop, file);
    const uploadIds = new Set();
    await window.route('**/api/v4/upload/chunks/*', (route) => {
        uploadIds.add(route.request().headers()['dropgate-upload']);
        const index = Number(new URL(route.request().url()).pathname.split('/').pop());
        return index === 0 ? route.continue() : undefined;
    });
    await uploadButton(window).click();
    const pause = window.locator('#action-bar').getByRole('button', { name: 'Pause Upload', exact: true });
    await expect.poll(() => uploadIds.size, { message: 'the upload should be sending its chunks' }).toBe(1);
    await expect(pause).toBeEnabled();
    await pause.click();
    await expect(uploadStatus(window)).toHaveText(/^Paused\. Kept until /);
    await app.quit();

    const [uploadId] = uploadIds;
    expect(uploadId, "the upload's ID, from its chunks' header").toMatch(/^[0-9a-f-]{36}$/);
    const texts = [file.name, filePath, desktop.folder, path.basename(desktop.folder), uploadId];
    expect(heldIn(desktop.profile, { texts, bytes: [file.buffer] }), 'what the profile holds of the paused upload').toEqual([]);
});
