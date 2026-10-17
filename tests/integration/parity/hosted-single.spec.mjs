// Parity: one file sent as a hosted upload from the web UI comes back from the
// standard download page byte for byte, under its own name.
import fs from 'node:fs';
import path from 'node:path';
import { holdsPlaintext, madeUpFile, summary } from '../helpers/files.mjs';
import { expect, test } from '../helpers/test.mjs';
import { download, uploadFromHomePage } from '../helpers/webui.mjs';

// Just over one 5 MiB chunk, so the upload and the download each take two.
const SIZE = 6_000_000;

test.describe('a single file, unencrypted', () => {
    // With end-to-end encryption off on the server, the web UI sends the file as it is.
    test.use({ serverEnv: { UPLOAD_ENABLE_E2EE: 'false' } });

    test('uploads from the home page and downloads intact from the standard download page', async ({ page }) => {
        const file = madeUpFile('Field notes (draft) é.bin', SIZE, 1);

        const link = await uploadFromHomePage(page, [file], { encrypted: false });
        expect(new URL(link).hash, 'an unencrypted link has no key').toBe('');

        await page.goto(link);
        await expect(page.locator('#file-name')).toHaveText(file.name);
        await expect(page.locator('#file-encryption')).toHaveText(/^none$/i);
        const got = await download(page, page.locator('#download-button'));
        await expect(page.locator('#status-title')).toHaveText(/download complete/i);

        expect(got.name).toBe(file.name);
        expect(summary(got.bytes)).toEqual(summary(file.buffer));
    });
});

test.describe('a single file, end-to-end encrypted', () => {
    test('uploads from the home page, is stored encrypted, and downloads intact from the standard download page', async ({ page, server }) => {
        const file = madeUpFile('Field notes (sealed) é.bin', SIZE, 2);

        const link = await uploadFromHomePage(page, [file], { encrypted: true });
        expect(new URL(link).hash, 'the key travels in the link fragment').not.toBe('');

        const stored = server.storedFiles();
        expect(stored, 'files the server holds').toHaveLength(1);
        const onDisk = fs.readFileSync(path.join(server.uploadsDir, stored[0]));
        expect(holdsPlaintext(onDisk, file.buffer), 'the stored file holds plaintext').toBe(false);
        expect(onDisk.includes(Buffer.from(file.name)), 'the stored file holds the file name').toBe(false);

        await page.goto(link);
        await expect(page.locator('#file-name')).toHaveText(file.name);
        await expect(page.locator('#file-encryption')).toHaveText(/end-to-end encrypted/i);
        const got = await download(page, page.locator('#download-button'));
        await expect(page.locator('#status-title')).toHaveText(/download complete/i);

        expect(got.name).toBe(file.name);
        expect(summary(got.bytes)).toEqual(summary(file.buffer));
    });
});
