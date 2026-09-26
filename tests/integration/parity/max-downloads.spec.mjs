// Parity: an upload given a download limit of 2 on the home page can be
// downloaded twice, and then its link is gone. For a bundle, only "Download All
// as ZIP" counts: downloading its files one at a time doesn't use up the limit.
import { madeUpFile, readZip, summary } from '../helpers/files.mjs';
import { expect, test } from '../helpers/test.mjs';
import { download, expectGone, openLink, uploadFromHomePage } from '../helpers/webui.mjs';

// The server's default is single-use links, and its page won't offer more.
const ALLOW_UP_TO_5 = { UPLOAD_MAX_FILE_DOWNLOADS: '5' };
const LIMIT = 2;

/** Download a single file from the standard download page, and check it. */
async function downloadFromStandardPage(page, link, file) {
    await openLink(page, link);
    await expect(page.locator('#file-name')).toHaveText(file.name);
    const got = await download(page, page.locator('#download-button'));
    await expect(page.locator('#status-title')).toHaveText(/download complete/i);
    expect(got.name).toBe(file.name);
    expect(summary(got.bytes)).toEqual(summary(file.buffer));
}

/** Download a bundle as one ZIP from the bundle page, and check every entry. */
async function downloadZip(page, link, files) {
    await openLink(page, link);
    await expect(page.locator('#bundle-file-count')).toHaveText(String(files.length));
    const zip = await download(page, page.locator('#download-all-button'));
    await expect(page.locator('#status-title')).toHaveText(/download complete/i);
    const entries = readZip(zip.bytes);
    expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.name));
    for (const [i, file] of files.entries()) {
        expect(summary(entries[i].bytes), `${file.name} in the ZIP`).toEqual(summary(file.buffer));
    }
}

/** Download every file in a bundle one at a time from the bundle page. */
async function downloadEachFile(page, link, files) {
    await openLink(page, link);
    await page.locator('#toggle-file-list').click();
    for (const file of files) {
        const got = await download(page, page.getByTitle(`Download ${file.name}`, { exact: true }));
        expect(got.name).toBe(file.name);
        expect(summary(got.bytes), file.name).toEqual(summary(file.buffer));
    }
}

// Three files, so downloading each one alone is more downloads than the limit.
const bundleFiles = (seed) => [
    madeUpFile('minutes.txt', 1_000, seed),
    madeUpFile('budget (v2).xlsx', 50_000, seed + 1),
    madeUpFile('Grundriss.png', 120_000, seed + 2),
];

for (const encrypted of [true, false]) {
    const kind = encrypted ? 'end-to-end encrypted' : 'unencrypted';

    test.describe(`a single file, ${kind}`, () => {
        test.use({ serverEnv: encrypted ? ALLOW_UP_TO_5 : { ...ALLOW_UP_TO_5, UPLOAD_ENABLE_E2EE: 'false' } });

        test('with a limit of 2, downloads twice from the standard download page, and then its link is gone', async ({ page, server }) => {
            const file = madeUpFile(`Twice only (${encrypted ? 'sealed' : 'plain'}) é.bin`, 300_000, encrypted ? 50 : 51);
            const link = await uploadFromHomePage(page, [file], { encrypted, maxDownloads: LIMIT });

            await downloadFromStandardPage(page, link, file);
            await downloadFromStandardPage(page, link, file);

            await expectGone(page, link);
            expect(server.storedFiles(), 'files the server still holds').toEqual([]);
        });
    });

    test.describe(`a bundle, ${kind}`, () => {
        test.use({ serverEnv: encrypted ? ALLOW_UP_TO_5 : { ...ALLOW_UP_TO_5, UPLOAD_ENABLE_E2EE: 'false' } });

        test('with a limit of 2, gives each file alone without using up the limit, then two ZIPs, and then its link is gone', async ({ page, server }) => {
            const files = bundleFiles(encrypted ? 60 : 70);
            const link = await uploadFromHomePage(page, files, { encrypted, maxDownloads: LIMIT });

            await downloadEachFile(page, link, files);
            await downloadZip(page, link, files);
            await downloadZip(page, link, files);

            await expectGone(page, link);
            // An encrypted bundle's files stay on the server until they expire. That's a
            // known issue, checked by the server suite, so it's only checked here unencrypted.
            if (!encrypted) expect(server.storedFiles(), 'files the server still holds').toEqual([]);
        });
    });
}
