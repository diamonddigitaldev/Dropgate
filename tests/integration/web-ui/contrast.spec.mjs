// Every text pairing on every web UI page meets WCAG 2.2 AA, in the light theme
// and the dark one, in each state a person sees: the home page as it opens, with
// files and a field in error, mid-upload, paused, the result screen and its
// modals, a direct transfer's card, the toasts; the download page for one file
// and several; the direct receive page; the not-found and older-version pages.
// axe-core's color-contrast checks each (helpers/contrast.mjs), as electron-kit
// checks the desktop app's. Where the keyboard's focus goes, the ring it shows is
// solid, at least 2px, and 3:1 against the page in both themes.
import { expectContrast, expectFocusRings } from '../helpers/contrast.mjs';
import { madeUpFile } from '../helpers/files.mjs';
import { secretsOf } from '../helpers/privacy.mjs';
import { expect, test } from '../helpers/test.mjs';
import { download, openLink, sendDirectFromHomePage, uploadFromHomePage } from '../helpers/webui.mjs';

/** Open the home page, once it has the server's settings. */
async function openHome(page) {
    await page.goto('/');
    await expect(page.locator('#securityText')).not.toHaveText(/checking/i);
}

test.describe('the home page, on a server without end-to-end encryption', () => {
    test.use({ serverEnv: { UPLOAD_ENABLE_E2EE: 'false', UPLOAD_MAX_FILE_DOWNLOADS: '5', UPLOAD_MAX_PAUSE_MINUTES: '30' } });

    test('as it opens, with files chosen and its fields in error, in each mode, and with the Upload Security Warning', async ({ page }) => {
        await openHome(page);
        await expectContrast(page, 'the home page');

        const files = [madeUpFile('Contrast one é.bin', 1_000, 61), madeUpFile('Contrast two é.bin', 2_000, 62)];
        secretsOf(page).addFiles(files, { storedByServer: true });
        await page.locator('#fileInput').setInputFiles(files);
        await page.locator('#lifetimeValue').fill('48');
        await page.locator('#maxDownloadsValue').fill('9');
        await expect(page.locator('#lifetimeHelp')).toHaveText(/too long/i);
        await expect(page.locator('#maxDownloadsHelp')).toHaveText(/exceeds/i);
        await expectContrast(page, 'the home page, with files chosen and its fields in error');
        await expectFocusRings(page, 'the home page, with files chosen');

        await page.locator('#modeP2P').click();
        await expect(page.locator('#p2pInfo')).toBeVisible();
        await expectContrast(page, 'the home page, in Direct Transfer mode');

        await page.locator('#modeStandard').click();
        await page.locator('#lifetimeValue').fill('2');
        await page.locator('#maxDownloadsValue').fill('2');
        await page.locator('#startBtn').click();
        await expect(page.locator('#insecureUploadModal')).toBeVisible();
        await expectContrast(page, 'the Upload Security Warning');
    });

    test('while an upload runs, and paused', async ({ page }) => {
        // Three 5 MiB chunks: the second is held, so the upload is part-way.
        const file = madeUpFile('Contrast paused é.bin', 12_000_000, 63);
        let sent = 0;
        await page.route('**/api/v4/upload/chunks/*', (route) => (++sent > 1 ? undefined : route.continue()));
        secretsOf(page).addFiles([file], { storedByServer: true });
        await openHome(page);
        await page.locator('#fileInput').setInputFiles([file]);
        await page.locator('#startBtn').click();
        await page.locator('#confirmInsecureUpload').click();
        await expect.poll(() => sent, { message: 'the second chunk should be on its way' }).toBe(2);
        await expect(page.locator('#pauseStandardUpload')).toBeEnabled();
        await expectContrast(page, 'the upload, under way');

        await page.locator('#pauseStandardUpload').click();
        await expect(page.locator('#progressTitle')).toHaveText(/upload paused/i);
        await expect(page.locator('#resumeStandardUpload')).toBeEnabled();
        await expectContrast(page, 'the paused card');
        await page.locator('#cancelStandardUpload').click();
        await expect(page.locator('#startBtn')).toBeVisible();
    });

    test('the result screen, its QR code, Delete This Upload?, and the deleted card', async ({ page }) => {
        await uploadFromHomePage(page, [madeUpFile('Contrast result é.bin', 3_000, 64)], { encrypted: false });
        await expectContrast(page, 'the result screen');
        await expectFocusRings(page, 'the result screen');

        await page.locator('#qrShare').click();
        await expect(page.locator('#qrModal')).toBeVisible();
        await expectContrast(page, 'the QR code');
        await page.locator('#qrModal').getByRole('button', { name: 'Close' }).click();
        await expect(page.locator('#qrModal')).toBeHidden();

        await page.locator('#deleteUpload').click();
        await expect(page.locator('#deleteUploadModal')).toBeVisible();
        await expectContrast(page, 'Delete This Upload?');
        await expectFocusRings(page, 'Delete This Upload?');
        await page.locator('#confirmDeleteUpload').click();
        await expect(page.locator('#shareTitle')).toHaveText(/upload deleted/i);
        await expectContrast(page, 'the deleted card');
    });
});

test.describe('the toasts', () => {
    // Each kind, brought about as a person would, shown again in each theme: a toast goes after 4.5 s.
    test('warning and success', async ({ page }) => {
        await uploadFromHomePage(page, [madeUpFile('Contrast toast é.bin', 3_000, 65)], { encrypted: true });
        await expectContrast(page, 'a success toast', async () => {
            await page.locator('#copyShare').click();
            await expect(page.locator('#toast-host .toast-success').last()).toHaveText(/copied link/i);
        });

        await page.locator('#newUpload').click();
        await expectContrast(page, 'a warning toast', async () => {
            await page.locator('#fileInput').setInputFiles([{ name: 'Empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) }]);
            await expect(page.locator('#toast-host .toast-warning').last()).toHaveText(/skipped 1 empty/i);
        });
    });

    test.describe('on a server with a 1 MB limit', () => {
        test.use({ serverEnv: { UPLOAD_MAX_FILE_SIZE_MB: '1' } });

        test('info, when files go by direct transfer instead', async ({ page }) => {
            await openHome(page);
            await expectContrast(page, 'an info toast', async () => {
                await page.locator('#modeStandard').click();
                await page.locator('#fileInput').setInputFiles([madeUpFile('Too big é.bin', 2_000_000, 66)]);
                await expect(page.locator('#toast-host .toast-info').last()).toHaveText(/using direct transfer/i);
                await page.locator('#btnClearAll').click();
            });
        });
    });

    test.describe('on a server with a 1 MB limit and no direct transfer', () => {
        test.use({ serverEnv: { UPLOAD_MAX_FILE_SIZE_MB: '1', ENABLE_P2P: 'false' } });

        test('danger, when files are too large to send', async ({ page }) => {
            await openHome(page);
            await expectContrast(page, 'a danger toast', async () => {
                await page.locator('#fileInput').setInputFiles([madeUpFile('Too big é.bin', 2_000_000, 67)]);
                await expect(page.locator('#toast-host .toast-danger').last()).toHaveText(/cannot be uploaded/i);
                await page.locator('#btnClearAll').click();
            });
        });
    });
});

test.describe('direct transfer', () => {
    test.use({ localStun: true });
    test.beforeEach(({ browserName }) => {
        test.skip(browserName === 'webkit' && process.platform === 'win32', "Playwright's WebKit on Windows has no RTCPeerConnection");
    });

    test("the sender's card, and the receive page as it offers several files", async ({ page, otherContext }) => {
        const { link } = await sendDirectFromHomePage(page, [madeUpFile('Direct one é.bin', 3_000, 68), madeUpFile('Direct two é.bin', 3_000, 69)]);
        await expectContrast(page, "the sender's card");

        const receiver = await otherContext.newPage();
        await receiver.goto(link);
        await expect(receiver.locator('#download-button')).toBeVisible({ timeout: 30_000 });
        await receiver.locator('#p2p-toggle-file-list').click();
        await expect(receiver.locator('#p2p-file-list')).toBeVisible();
        await expectContrast(receiver, 'the receive page');
    });
});

test('the home page with end-to-end encryption, and the download page for one file and several, before and after', async ({ page }) => {
    await openHome(page);
    await expect(page.locator('#securityText')).toHaveText(/end-to-end encrypted/i);
    await expectContrast(page, 'the home page, with end-to-end encryption');

    const one = await uploadFromHomePage(page, [madeUpFile('Contrast single é.bin', 300_000, 70)], { encrypted: true });
    await openLink(page, one);
    await expect(page.locator('#download-button')).toBeVisible();
    await expectContrast(page, 'the download page, for one file');
    await download(page, page.locator('#download-button'));
    await expect(page.locator('#status-title')).toHaveText(/download complete/i);
    await expectContrast(page, 'the download page, for one file, downloaded');

    const several = await uploadFromHomePage(page, [madeUpFile('Contrast first é.bin', 300_000, 71), madeUpFile('Contrast second é.bin', 3_000, 72)], { encrypted: true });
    await openLink(page, several);
    await expect(page.locator('#download-all-button')).toBeVisible();
    await page.locator('#toggle-file-list').click();
    await expect(page.locator('#file-list')).toBeVisible();
    await expectContrast(page, 'the download page, for several files');
    await expectFocusRings(page, 'the download page, for several files');
    await download(page, page.locator('#file-item-1 button'));
    await expect(page.locator('#file-progress-text-1')).toHaveText(/download complete/i);
    await expectContrast(page, 'the download page, for several files, with one downloaded');

    // The same upload's link with another secret.
    const { origin, pathname } = new URL(one);
    await openLink(page, `${origin}${pathname}#${'A'.repeat(43)}`);
    await expect(page.locator('#status-title')).toHaveText(/wrong link|not found/i);
    await expectContrast(page, 'the download page, for a wrong link');
});

test("the not-found page, a Dropgate 3 link, the older-version page, and a direct transfer code that isn't there", async ({ page }) => {
    const id = '00000000-0000-4000-8000-000000000000';
    await page.goto(`/${id}`);
    await expect(page.locator('#status-title')).toHaveText(/file not found/i);
    await expectContrast(page, 'the not-found page');

    await openLink(page, `/${id}#${'A'.repeat(43)}=`);
    await expect(page.locator('#status-title')).toHaveText(/older version/i);
    await expectContrast(page, 'the not-found page, for a Dropgate 3 link');

    await page.goto(`/b/${id}`);
    await expect(page.locator('#status-title')).toHaveText(/older version/i);
    await expectContrast(page, 'the older-version page');

    await page.goto('/p2p/ABCD-1234');
    await expect(page.locator('#title')).not.toHaveText(/connecting/i, { timeout: 30_000 });
    await expectContrast(page, "the receive page, for a code that isn't there");
});
