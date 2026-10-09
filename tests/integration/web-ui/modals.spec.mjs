// The web UI's modals answer Escape as the desktop app's prompts do: the
// Upload Security Warning, Delete This Upload? and the QR code each close on
// Escape as Cancel, wherever the focus is (on the page, on the modal, or on one
// of its buttons, Upload Anyway and Delete included), as their backdrop and
// close button do, and the focus goes back to the button that opened them.
// Escape closes the modal alone: the page behind it stays as it was. Without a
// modal, Escape never resets the page under an upload.
import { madeUpFile } from '../helpers/files.mjs';
import { secretsOf } from '../helpers/privacy.mjs';
import { expect, test } from '../helpers/test.mjs';
import { sendDirectFromHomePage, uploadFromHomePage } from '../helpers/webui.mjs';

/** The server's requests as `METHOD /path`. */
const routes = (server) => server.requests().map((r) => `${r.method} ${new URL(r.url, server.baseUrl).pathname}`);

/**
 * Where the focus is when Escape is pressed: each way of closing gets a
 * function that puts the focus there, then closes the modal.
 * @param {import('@playwright/test').Locator} modal
 * @param {string[]} buttons - The modal's buttons, by their accessible names.
 */
function waysToClose(modal, buttons) {
    const page = modal.page();
    const escape = () => page.keyboard.press('Escape');
    return [
        ['Escape, with the focus on the page', async () => {
            await page.evaluate(() => document.activeElement?.blur());
            await expect(page.locator('body')).toBeFocused();
            await escape();
        }],
        ['Escape, with the focus on the modal', async () => {
            await modal.focus();
            await expect(modal).toBeFocused();
            await escape();
        }],
        ...buttons.map((name) => [`Escape, with the focus on ${name}`, async () => {
            const button = modal.getByRole('button', { name, exact: true });
            await button.focus();
            await expect(button).toBeFocused();
            await escape();
        }]),
        ['its close button', () => modal.getByRole('button', { name: 'Close', exact: true }).click()],
        // Outside the dialog, on the backdrop: the modal element itself fills the window around it.
        ['its backdrop', () => modal.click({ position: { x: 5, y: 5 } })],
    ];
}

test.describe('the Upload Security Warning', () => {
    test.use({ serverEnv: { UPLOAD_ENABLE_E2EE: 'false' } });

    test('closes as Cancel, starting nothing, and gives the focus back to Start Upload', async ({ page, server }) => {
        const file = madeUpFile('Not sent é.bin', 2_000, 81);
        secretsOf(page).addFiles([file], { storedByServer: true });
        await page.goto('/');
        await expect(page.locator('#securityText')).toHaveText(/will not be encrypted/i);
        await page.locator('#fileInput').setInputFiles([file]);

        const modal = page.locator('#insecureUploadModal');
        for (const [how, close] of waysToClose(modal, ['Cancel', 'Upload Anyway', 'Close'])) {
            await test.step(how, async () => {
                await page.locator('#startBtn').click();
                await expect(modal).toBeVisible();
                await expect(modal, 'the focus, in the modal once it is open').toBeFocused();
                await close();
                await expect(modal).toBeHidden();
                await expect(page.locator('#startBtn'), 'the focus, back on Start Upload').toBeFocused();
                await expect(page.locator('#dzFileCount'), 'the files, still chosen').toHaveText(/1 file selected/i);
                await expect(page.locator('#progressCard')).toBeHidden();
                expect(routes(server).filter((r) => r.startsWith('POST /api/v4/uploads')), 'uploads started').toEqual([]);
            });
        }

        // Asked again, Upload Anyway still goes ahead.
        await page.locator('#startBtn').click();
        await page.locator('#confirmInsecureUpload').click();
        await expect(page.locator('#shareCard')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('#shareLink')).toHaveValue(/^http/);
        secretsOf(page).addLink(await page.locator('#shareLink').inputValue());
    });
});

test('Delete This Upload? closes as Cancel, deleting nothing, and gives the focus back to Delete', async ({ page, server }) => {
    await uploadFromHomePage(page, [madeUpFile('Kept é.bin', 2_000, 82)], { encrypted: true });

    const modal = page.locator('#deleteUploadModal');
    for (const [how, close] of waysToClose(modal, ['Cancel', 'Delete', 'Close'])) {
        await test.step(how, async () => {
            await page.locator('#deleteUpload').click();
            await expect(modal).toBeVisible();
            await expect(modal, 'the focus, in the modal once it is open').toBeFocused();
            await close();
            await expect(modal).toBeHidden();
            await expect(page.locator('#deleteUpload'), 'the focus, back on Delete').toBeFocused();
            await expect(page.locator('#shareTitle'), 'the result screen, as it was').toHaveText(/upload complete/i);
            expect(routes(server).filter((r) => r.startsWith('DELETE ')), 'deletes').toEqual([]);
        });
    }
    expect(server.storedFiles()).toHaveLength(1);
});

test("the QR code closes, and gives the focus back to its button, with the result screen as it was", async ({ page }) => {
    const link = await uploadFromHomePage(page, [madeUpFile('Shown é.bin', 2_000, 83)], { encrypted: true });

    const modal = page.locator('#qrModal');
    for (const [how, close] of waysToClose(modal, ['Close'])) {
        await test.step(how, async () => {
            await page.locator('#qrShare').click();
            await expect(modal).toBeVisible();
            await expect(modal, 'the focus, in the modal once it is open').toBeFocused();
            await close();
            await expect(modal).toBeHidden();
            await expect(page.locator('#qrShare'), 'the focus, back on the QR code button').toBeFocused();
            await expect(page.locator('#shareTitle')).toHaveText(/upload complete/i);
            await expect(page.locator('#shareLink')).toHaveValue(link);
        });
    }
});

test.describe('a direct transfer', () => {
    test.beforeEach(({ browserName }) => {
        test.skip(browserName === 'webkit' && process.platform === 'win32', "Playwright's WebKit on Windows has no RTCPeerConnection");
    });

    test("its QR code closes on Escape, and the transfer still waits for its receiver", async ({ page }) => {
        const { code } = await sendDirectFromHomePage(page, [madeUpFile('Waiting é.bin', 2_000, 84)]);

        const modal = page.locator('#qrModal');
        // Escape at once, in the same task as the click, while the modal is still opening (which
        // Bootstrap's hide() ignores): it closes as soon as it's open.
        await page.evaluate(() => {
            document.getElementById('qrP2PLink').click();
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        await expect(modal).toBeHidden();
        await expect(page.locator('#qrP2PLink')).toBeFocused();
        await expect(page.locator('#p2pWaitCard')).toBeVisible();
        await expect(page.locator('#p2pCode')).toHaveText(code);
    });
});

test('without a modal, Escape leaves an upload under way on its card', async ({ page }) => {
    // Three 5 MiB chunks: the second is held, so the upload is part-way.
    const file = madeUpFile('Under way é.bin', 12_000_000, 85);
    let sent = 0;
    await page.route('**/api/v4/upload/chunks/*', (route) => (++sent > 1 ? undefined : route.continue()));
    secretsOf(page).addFiles([file]);
    await page.goto('/');
    await expect(page.locator('#securityText')).toHaveText(/end-to-end encrypted/i);
    await page.locator('#fileInput').setInputFiles([file]);
    await page.locator('#startBtn').click();
    await expect.poll(() => sent, { message: 'the second chunk should be on its way' }).toBe(2);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await expect(page.locator('#progressCard')).toBeVisible();
    await expect(page.locator('#progressTitle')).toHaveText(/uploading/i);
    await expect(page.locator('#cancelStandardUpload')).toBeVisible();
    await page.locator('#cancelStandardUpload').click();
    await expect(page.locator('#startBtn')).toBeVisible();
});
