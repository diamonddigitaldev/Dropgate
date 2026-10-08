// The one download page, /<id>, for a single file and several alike: what a
// link looks like, what a chat preview of it sees, and how a page with no
// secure context downloads an unencrypted upload.
import { chromium } from '@playwright/test';
import { madeUpFile, summary } from '../helpers/files.mjs';
import { expect, test } from '../helpers/test.mjs';
import { uploadFromHomePage } from '../helpers/webui.mjs';

const UPLOAD_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

for (const several of [false, true]) for (const encrypted of [true, false]) {
    const what = `${several ? 'several files' : 'a file'}, ${encrypted ? 'end-to-end encrypted' : 'unencrypted'}`;
    test.describe(`a link to ${what}, fetched without its # part as a chat preview does`, () => {
        // With end-to-end encryption off on the server, the web UI sends the files as they are.
        if (!encrypted) test.use({ serverEnv: { UPLOAD_ENABLE_E2EE: 'false' } });

        test(`is the upload's ID${encrypted ? ' and a 43-character secret' : ''}, and its page shows only the server's name and takes no lease`, async ({ page, server }) => {
            const seed = (several ? 44 : 40) + (encrypted ? 0 : 1);
            const file = madeUpFile(`Preview me ${encrypted ? 'sealed' : 'plain'} é.bin`, 123_456, seed);
            const files = several ? [file, madeUpFile('And me too.txt', 2_000, seed + 10), madeUpFile('Me as well.txt', 3_000, seed + 20)] : [file];
            const link = await uploadFromHomePage(page, files, { encrypted });

            const { pathname, hash } = new URL(link);
            expect(pathname).toMatch(new RegExp(`^/${UPLOAD_ID}$`));
            if (encrypted) {
                expect(hash).toMatch(/^#[A-Za-z0-9_-]{43}$/);
                expect(Buffer.from(hash.slice(1), 'base64url')).toHaveLength(32);
            } else {
                expect(hash, 'an unencrypted link has no # part').toBe('');
            }

            const before = server.requests().length;
            const { name } = await (await page.request.get('/api/info')).json();
            const response = await page.request.get(pathname);
            expect(response.status()).toBe(200);
            const html = await response.text();
            expect(html).toContain(`<meta name="og:title" content="${name}">`);
            expect(html).toContain('<meta name="og:description" content="A lightweight, open-source, privacy-focused file sharing tool.">');
            for (const each of files) expect(html, 'a file name').not.toContain(each.name);
            expect(html, 'the file size').not.toMatch(/123[,.]?456|123\.5 KB|120\.6 KB/);
            expect(html, 'how many files').not.toMatch(/3 files/);
            expect(server.requests().slice(before).map((r) => `${r.method} ${r.url}`), 'what the preview asked for').toEqual([
                'GET /api/info', `GET ${pathname}`,
            ]);
        });
    });
}

test.describe('a page with no secure context', () => {
    test.use({ serverEnv: { UPLOAD_ENABLE_E2EE: 'false' } });

    // Plain HTTP to a name that isn't this machine's is no secure context. Chromium
    // can be told a name's address, so it never asks the network for it.
    test('downloads an unencrypted file through the browser itself, under one lease, in that URL only', async ({ page, server, browserName }) => {
        test.skip(browserName !== 'chromium', 'Chromium alone can be given a name for this machine without asking the network.');
        const file = madeUpFile('Over plain HTTP é.bin', 200_000, 42);
        const link = await uploadFromHomePage(page, [file], { encrypted: false });
        const { pathname, port } = new URL(link);

        const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP plain-http.test 127.0.0.1', '--proxy-server=direct://'] });
        try {
            const other = await (await browser.newContext({ acceptDownloads: true })).newPage();
            await other.goto(`http://plain-http.test:${port}${pathname}`);
            expect(await other.evaluate(() => window.isSecureContext), 'a secure context').toBe(false);
            await expect(other.locator('#file-name')).toHaveText(file.name);

            const before = server.requests().length;
            const started = other.waitForEvent('download');
            await other.locator('#download-button').click();
            const dl = await started;
            expect(await dl.failure(), 'download failure').toBeNull();
            expect(dl.suggestedFilename()).toBe(file.name);
            const fs = await import('node:fs');
            expect(summary(fs.readFileSync(await dl.path()))).toEqual(summary(file.buffer));

            // The page took a lease, and the browser downloaded with it in the URL.
            const sent = server.requests().slice(before);
            const take = sent.find((r) => r.method === 'POST' && r.url === `/api/v4/objects${pathname}/leases`);
            expect(take, 'the lease taken').toBeTruthy();
            const leaseRequests = sent.filter((r) => r.url.startsWith('/api/v4/leases/'));
            expect(leaseRequests.map((r) => r.method)).toEqual(['GET']);
            expect(leaseRequests[0].url).toMatch(/^\/api\/v4\/leases\/[A-Za-z0-9_-]{43}$/);
        } finally {
            await browser.close();
        }
    });

    test("downloads several files' each through the browser itself, one by one and all together, under one lease, in those URLs only", async ({ page, server, browserName }) => {
        test.skip(browserName !== 'chromium', 'Chromium alone can be given a name for this machine without asking the network.');
        const files = [madeUpFile('First over HTTP é.bin', 50_000, 43), madeUpFile('Second over HTTP.txt', 2_000, 44), madeUpFile('Third over HTTP.bin', 70_000, 45)];
        const link = await uploadFromHomePage(page, files, { encrypted: false });
        const { pathname, port } = new URL(link);
        const fs = await import('node:fs');

        const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP plain-http.test 127.0.0.1', '--proxy-server=direct://'] });
        try {
            const other = await (await browser.newContext({ acceptDownloads: true })).newPage();
            await other.goto(`http://plain-http.test:${port}${pathname}`);
            expect(await other.evaluate(() => window.isSecureContext), 'a secure context').toBe(false);
            await expect(other.locator('#bundle-file-count')).toHaveText(String(files.length));

            const before = server.requests().length;
            /** Each download the page starts, with its name and bytes. */
            const downloadsOf = async (count, trigger) => {
                const got = [];
                const done = new Promise((resolve) => {
                    other.on('download', async function onDownload(dl) {
                        expect(await dl.failure(), 'download failure').toBeNull();
                        got.push({ name: dl.suggestedFilename(), bytes: fs.readFileSync(await dl.path()) });
                        if (got.length === count) { other.off('download', onDownload); resolve(); }
                    });
                });
                await trigger();
                await done;
                return got;
            };

            await other.locator('#toggle-file-list').click();
            for (const file of files) {
                const [got] = await downloadsOf(1, () => other.getByTitle(`Download ${file.name}`, { exact: true }).click());
                expect(got.name).toBe(file.name);
                expect(summary(got.bytes), file.name).toEqual(summary(file.buffer));
            }
            const all = await downloadsOf(files.length, () => other.locator('#download-all-button').click());
            for (const file of files) {
                const got = all.find((d) => d.name === file.name);
                expect(got, file.name).toBeTruthy();
                expect(summary(got.bytes), file.name).toEqual(summary(file.buffer));
            }

            // One lease, taken by the page, and every file under it, by its index.
            const sent = server.requests().slice(before);
            expect(sent.filter((r) => r.method === 'POST' && r.url === `/api/v4/objects${pathname}/leases`)).toHaveLength(1);
            const fileRequests = sent.filter((r) => r.url.startsWith('/api/v4/leases/'));
            expect(fileRequests.map((r) => r.url.replace(/[A-Za-z0-9_-]{43}/, '<lease>'))).toEqual(
                [0, 1, 2, 0, 1, 2].map((i) => `/api/v4/leases/<lease>/files/${i}`),
            );
            expect(new Set(fileRequests.map((r) => r.url.split('/')[4])).size, 'leases in the URLs').toBe(1);
        } finally {
            await browser.close();
        }
    });
});
