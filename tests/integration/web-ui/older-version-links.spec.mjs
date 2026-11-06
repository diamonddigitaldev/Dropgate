// Links made by Dropgate 3. A bundle's (/b/<id>) gets the older-version page.
// A single file's (/<id>#<key>, the key 44 characters of standard base64)
// names an upload a Dropgate 4 server never has, so its page finds nothing,
// sees the older key, and says the same, without sending the key anywhere.
// Any other missing upload still says it isn't there.
import crypto from 'node:crypto';
import { secretsOf } from '../helpers/privacy.mjs';
import { expect, test } from '../helpers/test.mjs';
import { openLink } from '../helpers/webui.mjs';

/** A Dropgate 3 file key: 32 bytes in standard base64, here starting with + and /, as some do. */
function v3Key() {
    const key = crypto.randomBytes(32);
    key.set([0xfb, 0xff, 0xbf], 0);
    const b64 = key.toString('base64');
    expect(b64).toMatch(/^\+\/\+\/[A-Za-z0-9+/]{39}=$/);
    return b64;
}

/** Expects the older-version wording, and not the not-found page's. */
async function expectOlderVersion(page) {
    await expect(page.locator('#status-title')).toHaveText(/link from an older version/i);
    await expect(page.locator('#status-message')).toHaveText(/made with an older version of Dropgate/i);
    await expect(page.locator('#help-statement')).toHaveText(/update Dropgate and send the files again/i);
    await expect(page.getByText(/not found/i)).toHaveCount(0);
}

test("a Dropgate 3 bundle's link shows the older-version page", async ({ page }) => {
    const response = await openLink(page, `/b/${crypto.randomUUID()}`);
    expect(response?.status()).toBe(410);
    await expectOlderVersion(page);
});

test("a Dropgate 3 single file's link says it's from an older version, and sends nothing of its key", async ({ page, server }) => {
    const id = crypto.randomUUID();
    const key = v3Key();
    const link = `${server.baseUrl}/${id}#${key}`;
    secretsOf(page).addLink(link);

    const response = await openLink(page, link);
    expect(response?.status(), 'no such upload').toBe(404);
    await expectOlderVersion(page);

    // As a chat app may write it, with the = and the / percent-encoded.
    const encoded = `${server.baseUrl}/${id}#${key.replaceAll('/', '%2F').replace('=', '%3D')}`;
    await openLink(page, encoded);
    await expectOlderVersion(page);
});

test("a Dropgate 3 single file's link pasted into Enter Sharing Code opens the same", async ({ page, server }) => {
    const link = `${server.baseUrl}/${crypto.randomUUID()}#${v3Key()}`;
    secretsOf(page).addLink(link);
    await page.goto('/');
    await page.locator('#codeInput').fill(link);
    await page.locator('#codeGo').click();
    await expect(page).toHaveURL(link);
    await expectOlderVersion(page);
});

test("any other link to an upload that isn't there says it isn't there", async ({ page, server }) => {
    const id = crypto.randomUUID();
    const v4Secret = crypto.randomBytes(32).toString('base64url');
    for (const link of [
        `/${id}`,
        // A Dropgate 4 secret: 43 characters of URL-safe base64.
        `/${id}#${v4Secret}`,
        // A Dropgate 3 key, on a path that isn't an upload's.
        `/not-an-upload#${v3Key()}`,
        // 32 bytes of standard base64 without its =.
        `/${id}#${v3Key().slice(0, 43)}`,
    ]) {
        secretsOf(page).addLink(server.baseUrl + link);
        const response = await openLink(page, link);
        expect(response?.status(), link).toBe(404);
        await expect(page.locator('#status-title'), link).toHaveText(/file not found/i);
        await expect(page.getByText(/older version/i), link).toHaveCount(0);
    }
});
