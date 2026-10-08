// Parity: an upload given a download limit of 2 on the home page can be
// downloaded twice, and then its link is gone. For a bundle, each visit to its
// page is one download, however many it makes: its files one at a time and a
// ZIP count once, when the page goes.
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

/** Download a bundle as one ZIP from its page, already open, and check every entry. */
async function downloadZip(page, files) {
    await expect(page.locator('#bundle-file-count')).toHaveText(String(files.length));
    const zip = await download(page, page.locator('#download-all-button'));
    await expect(page.locator('#status-title')).toHaveText(/download complete/i);
    const entries = readZip(zip.bytes);
    expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.name));
    for (const [i, file] of files.entries()) {
        expect(summary(entries[i].bytes), `${file.name} in the ZIP`).toEqual(summary(file.buffer));
    }
}

/** Download every file in a bundle one at a time from its page, already open. */
async function downloadEachFile(page, files) {
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

        test('with a limit of 2, gives each file and a ZIP on one visit to its page, a ZIP on a second, and then its link is gone', async ({ page, server }) => {
            const files = bundleFiles(encrypted ? 60 : 70);
            const link = await uploadFromHomePage(page, files, { encrypted, maxDownloads: LIMIT });

            // One visit: every file alone, then all of them, which counts once as the page goes.
            await openLink(page, link);
            await downloadEachFile(page, files);
            await downloadZip(page, files);
            // A second visit, which the first's leaving has counted before.
            await openLink(page, link);
            await downloadZip(page, files);
            // Leaving it counts the second.
            await page.goto('about:blank');

            await expectGone(page, link);
            expect(server.storedFiles(), 'files the server still holds').toEqual([]);
        });
    });
}
