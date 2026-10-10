// A server on this machine over plain HTTP, with no reverse proxy in front of
// it. Browsers count localhost as a secure context, so the web UI encrypts
// uploads there, and the download page decrypts them there too: the server
// serves the page over HTTP as over HTTPS, and the page checks for itself.
import { madeUpFile, summary } from '../helpers/files.mjs';
import { expect, test } from '../helpers/test.mjs';
import { download, uploadFromHomePage } from '../helpers/webui.mjs';

// Nothing in front of the server says the request came in over HTTPS.
test.use({ extraHTTPHeaders: {} });

test('an encrypted upload downloads from its own link on a plain-HTTP localhost server', async ({ page }) => {
    const file = madeUpFile('Local copy é.bin', 100_000, 3);
    const link = await uploadFromHomePage(page, [file], { encrypted: true });

    const response = await page.goto(link);
    expect(response?.status(), 'the download page for an encrypted file').toBe(200);
    await expect(page.locator('#file-name')).toHaveText(file.name);
    const got = await download(page, page.locator('#download-button'));
    await expect(page.locator('#status-title')).toHaveText(/download complete/i);

    expect(got.name).toBe(file.name);
    expect(summary(got.bytes)).toEqual(summary(file.buffer));
});
