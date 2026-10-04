// A whole share link pasted into the home page's "Enter Sharing Code" box. Core
// reads the link in the page: it asks the server about the ID only, never the
// key after the #, and opens the download page with the key still on it.
import { madeUpFile } from '../helpers/files.mjs';
import { expectNoSecretsSent, expectNothingStored } from '../helpers/privacy.mjs';
import { expect, test } from '../helpers/test.mjs';
import { uploadFromHomePage } from '../helpers/webui.mjs';

test("pasting an end-to-end encrypted link into Enter Sharing Code doesn't send its key to the server", async ({ page, server, secrets }) => {
    const file = madeUpFile('Pasted link é.bin', 50_000, 90);
    const link = await uploadFromHomePage(page, [file], { encrypted: true });
    const { pathname } = new URL(link);

    await page.goto('/');
    await page.locator('#codeInput').fill(link);
    const answered = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/resolve');
    await page.locator('#codeGo').click();
    await answered;
    await page.waitForURL((url) => url.pathname === pathname);
    await expect(page.locator('#file-name')).toHaveText(file.name);

    await expectNothingStored(page.context(), server.baseUrl, 'the browser');
    expectNoSecretsSent(server, secrets);
});

test('pasting an end-to-end encrypted link into Enter Sharing Code opens its download page with its key', async ({ page }) => {
    const file = madeUpFile('Pasted and opened é.bin', 50_000, 91);
    const link = await uploadFromHomePage(page, [file], { encrypted: true });
    const { pathname, hash } = new URL(link);

    await page.goto('/');
    // Behind the TLS proxy these tests stand in for, the page's own link would
    // start with https://, and the server takes its origin from the proxy. So
    // the link is pasted as that proxy would have given it.
    await page.locator('#codeInput').fill(link.replace(/^http:/, 'https:'));
    await page.locator('#codeGo').click();
    await page.waitForURL((url) => url.pathname === pathname);

    expect(new URL(page.url()).hash, "the key in the download page's address").toBe(hash);
    await expect(page.locator('#file-name')).toHaveText(file.name);
});
