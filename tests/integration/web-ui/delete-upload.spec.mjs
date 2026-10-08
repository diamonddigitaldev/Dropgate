// The uploader's Delete: the home page's result screen deletes the upload it
// just made, with the manage token only that page holds, in its memory. The
// token goes to the server only in the delete's Dropgate-Manage-Token header,
// and a reload, which drops it, drops the button too.
import crypto from 'node:crypto';
import { madeUpFile } from '../helpers/files.mjs';
import { expect, test } from '../helpers/test.mjs';
import { expectGone, uploadFromHomePage } from '../helpers/webui.mjs';

const SIZE = 300_000;

/** The server's requests as `METHOD /path`, with their headers and bodies. */
const requests = (server) => server.requests().map((r) => ({ ...r, route: `${r.method} ${new URL(r.url, server.baseUrl).pathname}` }));

for (const encrypted of [false, true]) {
    test.describe(encrypted ? 'end-to-end encrypted' : 'unencrypted', () => {
        if (!encrypted) test.use({ serverEnv: { UPLOAD_ENABLE_E2EE: 'false' } });

        test("the result screen's Delete removes the upload, once confirmed; its link then shows it's gone", async ({ page, server }) => {
            const file = madeUpFile(`Deleted ${encrypted ? 'sealed' : 'plain'} é.bin`, SIZE, encrypted ? 21 : 22);
            const link = await uploadFromHomePage(page, [file], { encrypted });
            const { pathname } = new URL(link);
            const id = pathname.slice(1);
            expect(server.storedFiles()).toEqual([`objects/${id}`]);

            // Cancel deletes nothing.
            await expect(page.locator('#deleteUpload')).toBeVisible();
            await page.locator('#deleteUpload').click();
            await expect(page.locator('#deleteUploadModal')).toBeVisible();
            await page.locator('#deleteUploadModal').getByRole('button', { name: 'Cancel' }).click();
            await expect(page.locator('#deleteUploadModal')).toBeHidden();
            expect(requests(server).filter((r) => r.method === 'DELETE' && r.route.startsWith('/api/v4/objects/'))).toEqual([]);

            await page.locator('#deleteUpload').click();
            await page.locator('#confirmDeleteUpload').click();
            await expect(page.locator('#shareTitle')).toHaveText(/upload deleted/i);
            await expect(page.locator('#statusAlert')).toHaveText(/upload deleted/i);
            await expect(page.locator('#deleteUpload')).toBeHidden();
            await expect(page.locator('#shareLinkGroup')).toBeHidden();
            expect(server.storedFiles(), 'files the server holds').toEqual([]);

            // The token went once, in its header, and the start sent only its SHA-256.
            const all = requests(server);
            const deletes = all.filter((r) => r.route === `DELETE /api/v4/objects/${id}`);
            expect(deletes).toHaveLength(1);
            const token = deletes[0].headers['dropgate-manage-token'];
            expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
            const start = all.find((r) => r.route === 'POST /api/v4/uploads');
            expect(JSON.parse(start.body.toString('utf8')).manageTokenHash)
                .toBe(crypto.createHash('sha256').update(Buffer.from(token, 'base64url')).digest('base64url'));
            const elsewhere = all.filter((r) => r !== deletes[0]
                && [r.url, JSON.stringify(r.headers), r.body.toString('latin1')].some((part) => part.includes(token)));
            expect(elsewhere.map((r) => r.route), 'requests holding the manage token').toEqual([]);
            expect(deletes[0].url.includes(token)).toBe(false);
            expect(await page.content(), 'the page shows the manage token').not.toContain(token);

            await expectGone(page, link);
        });

        test('a reload drops the manage token, and the Delete button with it', async ({ page, server }) => {
            const file = madeUpFile(`Kept ${encrypted ? 'sealed' : 'plain'} é.bin`, SIZE, encrypted ? 23 : 24);
            await uploadFromHomePage(page, [file], { encrypted });
            await expect(page.locator('#deleteUpload')).toBeVisible();

            await page.reload();
            await expect(page.locator('#startBtn')).toBeVisible();
            await expect(page.locator('#shareCard')).toBeHidden();
            await expect(page.locator('#deleteUpload')).toBeHidden();
            // Still there: nothing was deleted. The fixtures check the origin keeps no storage.
            expect(server.storedFiles()).toHaveLength(1);
            expect(requests(server).filter((r) => r.method === 'DELETE' && r.route.startsWith('/api/v4/objects/'))).toEqual([]);
        });
    });
}

test("a bundle's result screen has Delete too, which removes the whole upload, once confirmed, with the token in its header alone", async ({ page, server }) => {
    const link = await uploadFromHomePage(page, [madeUpFile('One of two é.bin', SIZE, 26), madeUpFile('Two of two é.bin', SIZE, 27)], { encrypted: true });
    const id = new URL(link).pathname.slice(1);
    expect(server.storedFiles()).toEqual([`objects/${id}`]);

    await page.locator('#deleteUpload').click();
    await page.locator('#confirmDeleteUpload').click();
    await expect(page.locator('#shareTitle')).toHaveText(/upload deleted/i);
    expect(server.storedFiles(), 'files the server holds').toEqual([]);

    const all = requests(server);
    const deletes = all.filter((r) => r.route === `DELETE /api/v4/objects/${id}`);
    expect(deletes).toHaveLength(1);
    const token = deletes[0].headers['dropgate-manage-token'];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const elsewhere = all.filter((r) => r !== deletes[0]
        && [r.url, JSON.stringify(r.headers), r.body.toString('latin1')].some((part) => part.includes(token)));
    expect(elsewhere.map((r) => r.route), 'requests holding the manage token').toEqual([]);

    await expectGone(page, link);
});

test('"Send more files" drops the manage token and the Delete button too', async ({ page }) => {
    await uploadFromHomePage(page, [madeUpFile('Sent on é.bin', SIZE, 25)], { encrypted: true });
    await page.locator('#newUpload').click();
    await expect(page.locator('#startBtn')).toBeVisible();
    await expect(page.locator('#deleteUpload')).toBeHidden();
});
