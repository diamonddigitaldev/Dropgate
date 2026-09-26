// Parity: several files sent together from the web UI make a bundle, and the
// bundle page gives every one of them back byte for byte, one at a time and as
// a single ZIP.
import fs from 'node:fs';
import path from 'node:path';
import { holdsPlaintext, madeUpFile, readZip, summary } from '../helpers/files.mjs';
import { expect, test } from '../helpers/test.mjs';
import { download, uploadFromHomePage } from '../helpers/webui.mjs';

const bundleFiles = (seed) => [
    madeUpFile('readme.txt', 1_000, seed),
    madeUpFile('photos (holiday).zip', 300_000, seed + 1),
    // Just over one 5 MiB chunk.
    madeUpFile('Tabelle für 2026.xlsx', 6_000_000, seed + 2),
];

/** Every file one at a time from the bundle page, then all of them as a ZIP. */
async function downloadEachThenZip(page, files) {
    await page.locator('#toggle-file-list').click();
    for (const file of files) {
        const got = await download(page, page.getByTitle(`Download ${file.name}`, { exact: true }));
        expect(got.name).toBe(file.name);
        expect(summary(got.bytes), file.name).toEqual(summary(file.buffer));
    }

    const zip = await download(page, page.locator('#download-all-button'));
    await expect(page.locator('#status-title')).toHaveText(/download complete/i);
    expect(zip.name).toMatch(/^dropgate-bundle-.+\.zip$/);
    const entries = readZip(zip.bytes);
    expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.name));
    for (const [i, file] of files.entries()) {
        expect(summary(entries[i].bytes), `${file.name} in the ZIP`).toEqual(summary(file.buffer));
    }
}

test.describe('a bundle, unencrypted', () => {
    test.use({ serverEnv: { UPLOAD_ENABLE_E2EE: 'false' } });

    test('uploads from the home page, and the bundle page gives back each file and the ZIP intact', async ({ page }) => {
        const files = bundleFiles(10);

        const link = await uploadFromHomePage(page, files, { encrypted: false });
        expect(new URL(link).pathname).toMatch(/^\/b\//);
        expect(new URL(link).hash, 'an unencrypted link has no key').toBe('');

        await page.goto(link);
        await expect(page.locator('#bundle-file-count')).toHaveText(String(files.length));
        await expect(page.locator('#bundle-encryption')).toHaveText(/^none$/i);
        await downloadEachThenZip(page, files);
    });
});

test.describe('a bundle, end-to-end encrypted', () => {
    test('uploads from the home page, is stored encrypted, and the bundle page gives back each file and the ZIP intact', async ({ page, server }) => {
        const files = bundleFiles(20);

        const link = await uploadFromHomePage(page, files, { encrypted: true });
        expect(new URL(link).pathname).toMatch(/^\/b\//);
        expect(new URL(link).hash, 'the key travels in the link fragment').not.toBe('');

        const stored = server.storedFiles().map((f) => fs.readFileSync(path.join(server.uploadsDir, f)));
        expect(stored.length, 'files the server holds').toBeGreaterThan(0);
        for (const onDisk of stored) {
            for (const file of files) {
                expect(holdsPlaintext(onDisk, file.buffer), `a stored file holds plaintext of ${file.name}`).toBe(false);
                expect(onDisk.includes(Buffer.from(file.name)), `a stored file holds the name ${file.name}`).toBe(false);
            }
        }

        await page.goto(link);
        await expect(page.locator('#bundle-file-count')).toHaveText(String(files.length));
        await expect(page.locator('#bundle-encryption')).toHaveText(/end-to-end encrypted/i);
        await downloadEachThenZip(page, files);
    });
});
