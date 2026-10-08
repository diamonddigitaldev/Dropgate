// The one download page, /<id>, for a single file: what a link looks like,
// what a chat preview of it sees, and how a page with no secure context
// downloads an unencrypted file.
import { chromium } from '@playwright/test';
import { madeUpFile, summary } from '../helpers/files.mjs';
import { expect, test } from '../helpers/test.mjs';
import { uploadFromHomePage } from '../helpers/webui.mjs';

const UPLOAD_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

for (const encrypted of [true, false]) {
    test.describe(`a link, fetched without its # part as a chat preview does, ${encrypted ? 'end-to-end encrypted' : 'unencrypted'}`, () => {
        // With end-to-end encryption off on the server, the web UI sends the file as it is.
        if (!encrypted) test.use({ serverEnv: { UPLOAD_ENABLE_E2EE: 'false' } });

        test(`is the upload's ID${encrypted ? ' and a 43-character secret' : ''}, and its page shows only the server's name and takes no lease`, async ({ page, server }) => {
            const file = madeUpFile(`Preview me ${encrypted ? 'sealed' : 'plain'} é.bin`, 123_456, encrypted ? 40 : 41);
            const link = await uploadFromHomePage(page, [file], { encrypted });

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
            expect(html, 'the file name').not.toContain(file.name);
            expect(html, 'the file size').not.toMatch(/123[,.]?456|123\.5 KB|120\.6 KB/);
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
});
