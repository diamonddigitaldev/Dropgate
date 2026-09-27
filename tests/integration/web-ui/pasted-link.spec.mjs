// A whole share link pasted into the home page's "Enter Sharing Code" box. The
// page asks the server where the link leads, and for an end-to-end encrypted
// upload it sends the whole link, key and all, though the server only needs
// the part before the #. Then it goes where the server says, which has no #, so
// the download page has no key either.
import { madeUpFile } from '../helpers/files.mjs';
import { expectNoSecretsSent, expectNothingStored, secretsSent } from '../helpers/privacy.mjs';
import { expect, onlyFailsWith, test } from '../helpers/test.mjs';
import { uploadFromHomePage } from '../helpers/webui.mjs';

// The known issue, as secretsSent() describes it.
const KEY_IN_RESOLVE = /the key from the link to \/\S+, in the body of POST \/api\/resolve/;

test.fail("pasting an end-to-end encrypted link into Enter Sharing Code doesn't send its key to the server (known issue until the v4 core rework)", async ({ page, server, secrets }) => {
    await onlyFailsWith(KEY_IN_RESOLVE, async () => {
        const file = madeUpFile('Pasted link é.bin', 50_000, 90);
        const link = await uploadFromHomePage(page, [file], { encrypted: true });

        await page.goto('/');
        await page.locator('#codeInput').fill(link);
        const answered = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/resolve');
        await page.locator('#codeGo').click();
        await answered;

        await expectNothingStored(page.context(), server.baseUrl, 'the browser');
        // Anything else the server was sent fails as itself, so the known issue can't hide it.
        const sent = secretsSent(server, secrets);
        expect(sent.filter((s) => !KEY_IN_RESOLVE.test(s)), 'file names and keys the server was sent, besides the known issue').toEqual([]);
        expectNoSecretsSent(server, secrets);
    });
});

test.fail('pasting an end-to-end encrypted link into Enter Sharing Code opens its download page with its key (known issue until the v4 core rework)', async ({ page }) => {
    await onlyFailsWith(/the key in the download page's address/, async () => {
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
});
