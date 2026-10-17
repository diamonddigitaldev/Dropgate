// Every size the web UI shows counts in 1024s, as the server's limits, core and
// the desktop app do, labelled KB, MB, GB and TB, with one decimal below 10:
// the server's limit ("Max upload size"), the files chosen and their total, and
// each file and the total on the download and direct receive pages. A size in
// 1000s would read differently for each of these: 1,572,864 bytes is 1.5 MB
// here, and would be "1.57 MB" in 1000s.
import { madeUpFile } from '../helpers/files.mjs';
import { secretsOf } from '../helpers/privacy.mjs';
import { expect, test } from '../helpers/test.mjs';
import { openLink, sendDirectFromHomePage, uploadFromHomePage } from '../helpers/webui.mjs';

const MiB = 1024 * 1024;

test.describe('a server whose limit is 1536 MB', () => {
    test.use({ serverEnv: { UPLOAD_MAX_FILE_SIZE_MB: '1536', ENABLE_P2P: 'false' } });

    test('says "Max upload size: 1.5 GB."', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#maxUploadHint')).toHaveText('Max upload size: 1.5 GB.');
    });
});

test('the home page gives its limit, and the files chosen, in 1024s', async ({ page }) => {
    await page.goto('/');
    // The server's default limit, 100 MB, and direct transfer for anything over.
    await expect(page.locator('#maxUploadHint')).toHaveText('Max upload size: 100 MB. Anything over will use direct transfer (P2P).');

    const files = [madeUpFile('Half a KB more é.bin', 1_536, 101), madeUpFile('One and a half MB é.bin', 1.5 * MiB, 102)];
    secretsOf(page).addFiles(files);
    await page.locator('#fileInput').setInputFiles(files);
    await expect(page.locator('.file-row-size')).toHaveText(['1.5 KB', '1.5 MB']);
    await expect(page.locator('#fileChosenTotal')).toHaveText('Total: 1.5 MB');
});

test('the download page gives each file and the total in 1024s, for one file and several', async ({ page }) => {
    const one = await uploadFromHomePage(page, [madeUpFile('Sized single é.bin', 1.5 * MiB, 103)], { encrypted: true });
    await openLink(page, one);
    await expect(page.locator('#file-size')).toHaveText('1.5 MB');

    const several = await uploadFromHomePage(page, [madeUpFile('Sized first é.bin', 1.5 * MiB, 104), madeUpFile('Sized second é.bin', 12 * 1024, 105)], { encrypted: true });
    await openLink(page, several);
    await expect(page.locator('#bundle-total-size')).toHaveText('1.5 MB');
    await page.locator('#toggle-file-list').click();
    await expect(page.locator('#file-list-items li span.small')).toHaveText(['1.5 MB', '12 KB']);
});

test.describe('direct transfer', () => {
    test.use({ localStun: true });
    test.beforeEach(({ browserName }) => {
        test.skip(browserName === 'webkit' && process.platform === 'win32', "Playwright's WebKit on Windows has no RTCPeerConnection");
    });

    test('the receive page gives the files offered in 1024s', async ({ page, otherContext }) => {
        const { link } = await sendDirectFromHomePage(page, [madeUpFile('Offered first é.bin', 1.5 * MiB, 106), madeUpFile('Offered second é.bin', 12 * 1024, 107)]);
        const receiver = await otherContext.newPage();
        await receiver.goto(link);
        await expect(receiver.locator('#download-button')).toBeVisible({ timeout: 30_000 });
        await expect(receiver.locator('#file-size')).toHaveText('1.5 MB');
        await receiver.locator('#p2p-toggle-file-list').click();
        await expect(receiver.locator('#p2p-file-list-items li span.small')).toHaveText(['1.5 MB', '12 KB']);
    });
});
