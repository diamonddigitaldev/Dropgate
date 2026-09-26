// Steps through the web UI's pages, the way a person would.
//
// Checks on page text match loosely (case-insensitive, on the key words), so a
// copy edit doesn't break a test about behaviour.
import fs from 'node:fs';
import { expect } from './test.mjs';

/**
 * Upload files from the home page with its default options, and return the share link.
 * @param {import('@playwright/test').Page} page
 * @param {{ name: string, mimeType: string, buffer: Buffer }[]} files
 * @param {object} opts
 * @param {boolean} opts.encrypted - Whether the page should say the upload will be end-to-end encrypted.
 *   When it won't be, the page asks first, and this answers "Upload Anyway".
 */
export async function uploadFromHomePage(page, files, { encrypted }) {
    await page.goto('/');
    await expect(page.locator('#securityText')).toHaveText(encrypted ? /will be end-to-end encrypted/i : /will not be encrypted/i);

    await page.locator('#fileInput').setInputFiles(files);
    await page.locator('#startBtn').click();
    if (!encrypted) {
        await expect(page.locator('#insecureUploadModal')).toBeVisible();
        await page.locator('#confirmInsecureUpload').click();
    }

    await expect(page.locator('#shareCard')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#shareTitle')).toHaveText(/upload complete/i);
    await expect(page.locator('#shareLink')).toHaveValue(/^http/);
    return page.locator('#shareLink').inputValue();
}

/**
 * Click something that starts a download, wait for the download to finish, and
 * return its suggested name and its bytes.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} trigger
 */
export async function download(page, trigger) {
    const started = page.waitForEvent('download');
    await trigger.click();
    const dl = await started;
    expect(await dl.failure(), 'download failure').toBeNull();
    return { name: dl.suggestedFilename(), bytes: fs.readFileSync(await dl.path()) };
}
