// Parity: several files sent together from the web UI make one upload, a
// bundle, and its download page gives every one of them back byte for byte,
// one at a time and as a single ZIP. However many downloads the page makes,
// they're under one lease, which the page releases as it goes.
import fs from 'node:fs';
import path from 'node:path';
import { holdsPlaintext, madeUpFile, readZip, summary } from '../helpers/files.mjs';
import { expect, test } from '../helpers/test.mjs';
import { download, uploadFromHomePage } from '../helpers/webui.mjs';

const UPLOAD_ID = /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const bundleFiles = (seed) => [
    madeUpFile('readme.txt', 1_000, seed),
    madeUpFile('photos (holiday).zip', 300_000, seed + 1),
    // Just over one 5 MiB chunk.
    madeUpFile('Tabelle für 2026.xlsx', 6_000_000, seed + 2),
];

/** The server's requests as `METHOD /path`, from `from` on. */
const routes = (server, from = 0) => server.requests().slice(from).map((r) => ({ ...r, route: `${r.method} ${new URL(r.url, server.baseUrl).pathname}` }));

/** Every file one at a time from the download page, then all of them as a ZIP. */
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

/**
 * The page's downloads were under one lease, each file asking only for its
 * own part of the upload; and leaving the page releases it.
 */
async function expectOneLease(page, server, id, from) {
    const sent = routes(server, from);
    expect(sent.filter((r) => r.route === `POST /api/v4/objects/${id}/leases`), 'leases taken').toHaveLength(1);
    const content = sent.filter((r) => r.route === `GET /api/v4/objects/${id}/content`);
    expect(new Set(content.map((r) => r.headers['dropgate-lease'])).size, 'leases the downloads were under').toBe(1);
    expect(content.map((r) => r.headers.range ?? 'whole'), 'what each download asked for').toEqual([
        expect.stringMatching(/^bytes=/), expect.stringMatching(/^bytes=/), expect.stringMatching(/^bytes=/), 'whole',
    ]);
    expect(sent.some((r) => r.route === 'DELETE /api/v4/lease'), 'released while the page is open').toBe(false);

    await page.goto('about:blank');
    await expect.poll(() => routes(server, from).filter((r) => r.route === 'DELETE /api/v4/lease').length, { message: 'released as the page went' }).toBe(1);
}

test.describe('a bundle, unencrypted', () => {
    test.use({ serverEnv: { UPLOAD_ENABLE_E2EE: 'false' } });

    test('uploads from the home page, and its page gives back each file and the ZIP intact, under one lease', async ({ page, server }) => {
        const files = bundleFiles(10);

        const link = await uploadFromHomePage(page, files, { encrypted: false });
        const { pathname } = new URL(link);
        expect(pathname, "the same link as a single file's").toMatch(UPLOAD_ID);
        expect(new URL(link).hash, 'an unencrypted link has no key').toBe('');
        expect(server.storedFiles(), 'one upload').toEqual([`objects${pathname}`]);

        const from = server.requests().length;
        await page.goto(link);
        await expect(page.locator('#bundle-file-count')).toHaveText(String(files.length));
        await expect(page.locator('#bundle-encryption')).toHaveText(/^none$/i);
        await downloadEachThenZip(page, files);
        await expectOneLease(page, server, pathname.slice(1), from);
    });
});

test.describe('a bundle, end-to-end encrypted', () => {
    test('uploads from the home page, is stored encrypted, and its page gives back each file and the ZIP intact, under one lease', async ({ page, server }) => {
        const files = bundleFiles(20);

        const link = await uploadFromHomePage(page, files, { encrypted: true });
        const { pathname, hash } = new URL(link);
        expect(pathname, "the same link as a single file's").toMatch(UPLOAD_ID);
        expect(hash, 'the secret travels in the link fragment').toMatch(/^#[A-Za-z0-9_-]{43}$/);

        expect(server.storedFiles(), 'one upload').toEqual([`objects${pathname}`]);
        const onDisk = fs.readFileSync(path.join(server.uploadsDir, server.storedFiles()[0]));
        for (const file of files) {
            expect(holdsPlaintext(onDisk, file.buffer), `the stored upload holds plaintext of ${file.name}`).toBe(false);
            expect(onDisk.includes(Buffer.from(file.name)), `the stored upload holds the name ${file.name}`).toBe(false);
        }

        const from = server.requests().length;
        await page.goto(link);
        await expect(page.locator('#bundle-file-count')).toHaveText(String(files.length));
        await expect(page.locator('#bundle-encryption')).toHaveText(/end-to-end encrypted/i);
        await downloadEachThenZip(page, files);
        await expectOneLease(page, server, pathname.slice(1), from);
    });
});
