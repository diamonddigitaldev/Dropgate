// A whole share link pasted into the home page's "Enter Sharing Code" box. Core
// reads the link in the page and asks the server nothing about it: it opens the
// download page, with the secret after the # still on it, and that page asks
// about the upload.
import { madeUpFile } from '../helpers/files.mjs';
import { expectNoSecretsSent, expectNothingStored } from '../helpers/privacy.mjs';
import { expect, test } from '../helpers/test.mjs';
import { uploadFromHomePage } from '../helpers/webui.mjs';

test("pasting an end-to-end encrypted link into Enter Sharing Code sends nothing of it to the server", async ({ page, server, secrets }) => {
    const file = madeUpFile('Pasted link é.bin', 50_000, 90);
    const link = await uploadFromHomePage(page, [file], { encrypted: true });
    const { pathname } = new URL(link);
    const id = pathname.slice(1);

    await page.goto('/');
    const before = server.requests().length;
    await page.locator('#codeInput').fill(link);
    await page.locator('#codeGo').click();
    await page.waitForURL((url) => url.pathname === pathname);
    await expect(page.locator('#file-name')).toHaveText(file.name);

    // Until the download page opened, nothing that was sent named the upload.
    const sent = server.requests().slice(before);
    const opened = sent.findIndex((r) => r.method === 'GET' && r.url === pathname);
    expect(opened, 'the download page was asked for').toBeGreaterThanOrEqual(0);
    expect(sent.slice(0, opened).filter((r) => r.url.includes(id) || r.body.includes(id)).map((r) => `${r.method} ${r.url}`)).toEqual([]);

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
