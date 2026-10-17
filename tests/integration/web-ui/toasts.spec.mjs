// The home page's toasts are electron-kit's (kit.ui.toast()): centred at the
// top, newest last, each filled with its type's colour and a darker 4px left
// edge, black text on info and warning and white on success and danger. The
// host is a polite live region (role="status"), and a danger toast an alert of
// its own. Each goes after 4.5 s, or at once from its Dismiss button. It slides
// in 8px, and doesn't move under reduced motion. Their contrast, in both
// themes, is in contrast.spec.mjs.
import { madeUpFile } from '../helpers/files.mjs';
import { expect, test } from '../helpers/test.mjs';
import { uploadFromHomePage } from '../helpers/webui.mjs';

const EMPTY_FILE = { name: 'Empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) };

/** Each type's fill, left edge and text, as electron-kit's css/kit.css has them. */
const LOOK = {
    info: { fill: 'rgb(13, 202, 240)', edge: 'rgb(10, 162, 192)', text: 'rgb(0, 0, 0)', icon: 'info' },
    warning: { fill: 'rgb(255, 193, 7)', edge: 'rgb(204, 154, 6)', text: 'rgb(0, 0, 0)', icon: 'warning' },
    success: { fill: 'rgb(25, 135, 84)', edge: 'rgb(20, 108, 67)', text: 'rgb(255, 255, 255)', icon: 'check_circle' },
    danger: { fill: 'rgb(220, 53, 69)', edge: 'rgb(176, 42, 55)', text: 'rgb(255, 255, 255)', icon: 'error' },
};

/** Expect a toast to look and read as its type's. */
async function expectToast(toast, type, text) {
    await expect(toast).toHaveClass(new RegExp(`\\btoast-${type}\\b`));
    await expect(toast.locator('.toast-body')).toHaveText(text);
    const style = await toast.evaluate((el) => {
        const s = getComputedStyle(el);
        return { fill: s.backgroundColor, edge: s.borderLeftColor, width: s.borderLeftWidth, text: s.color };
    });
    const { icon, ...colours } = LOOK[type];
    expect(style, `a ${type} toast's colours`).toEqual({ ...colours, width: '4px' });
    await expect(toast.locator('.toast-icon')).toHaveText(icon);
    await expect(toast.locator('.toast-icon')).toHaveAttribute('aria-hidden', 'true');
    await expect(toast.getByRole('button', { name: 'Dismiss' })).toBeVisible();
    if (type === 'danger') await expect(toast).toHaveAttribute('role', 'alert');
    else await expect(toast).not.toHaveAttribute('role');
}

test.describe('on a server with a 1 MB limit and no direct transfer', () => {
    test.use({ serverEnv: { UPLOAD_MAX_FILE_SIZE_MB: '1', ENABLE_P2P: 'false' } });

    test('warning and danger toasts stack, newest last, centred at the top, in a polite live region', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#securityText')).not.toHaveText(/checking/i);
        const host = page.locator('#toast-host');
        await expect(host).toHaveAttribute('role', 'status');
        await expect(host).toHaveAttribute('aria-live', 'polite');

        await page.locator('#fileInput').setInputFiles([EMPTY_FILE]);
        await page.locator('#fileInput').setInputFiles([madeUpFile('Too big é.bin', 2_000_000, 91)]);
        const toasts = host.locator('.toast-note');
        await expect(toasts).toHaveCount(2);
        await expectToast(toasts.nth(0), 'warning', 'Skipped 1 empty (0 byte) file.');
        await expectToast(toasts.nth(1), 'danger', /cannot be uploaded/i);

        // Centred across the window, at its top.
        const box = await host.boundingBox();
        const { width } = page.viewportSize();
        expect(Math.abs(box.x + box.width / 2 - width / 2), "the toasts' distance from the middle").toBeLessThan(1);
        expect(box.y).toBeLessThan(40);

        await toasts.nth(0).getByRole('button', { name: 'Dismiss' }).click();
        await expect(toasts).toHaveCount(1);
        await expect(toasts.first()).toHaveClass(/\btoast-danger\b/);
    });

    test('a toast goes after 4.5 seconds', async ({ page }) => {
        await page.clock.install();
        await page.goto('/');
        await expect(page.locator('#securityText')).not.toHaveText(/checking/i);
        // The page's time stands still from here, but for runFor().
        await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
        await page.locator('#fileInput').setInputFiles([EMPTY_FILE]);
        const toast = page.locator('#toast-host .toast-note');
        await expect(toast).toHaveCount(1);
        await page.waitForTimeout(5_000);
        await expect(toast, 'a toast, 5 s later by the clock on the wall').toHaveCount(1);
        await page.clock.runFor(4_400);
        await expect(toast).toHaveCount(1);
        await page.clock.runFor(1_200);
        await expect(toast).toHaveCount(0);
    });

    test("a toast slides in 8px, and doesn't move under reduced motion", async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#securityText')).not.toHaveText(/checking/i);
        /** The newest toast's entrance: how long it takes, and where it starts. */
        const entrance = async () => {
            await page.locator('#fileInput').setInputFiles([EMPTY_FILE]);
            return page.locator('#toast-host .toast-note').last().evaluate((el) => {
                const s = getComputedStyle(el);
                const keyframes = el.getAnimations()[0]?.effect.getKeyframes() ?? [];
                return { duration: parseFloat(s.animationDuration), from: keyframes[0]?.transform, opacity: keyframes[0]?.opacity };
            });
        };

        // The suite asks for reduced motion (playwright.config.mjs).
        expect((await entrance()).duration, 'seconds, under reduced motion').toBeLessThan(0.001);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        const { duration, from, opacity } = await entrance();
        expect(duration, 'seconds').toBe(0.2);
        expect(from).toBe('translateY(-8px)');
        expect(Number(opacity)).toBe(0);
    });
});

test.describe('on a server with a 1 MB limit', () => {
    test.use({ serverEnv: { UPLOAD_MAX_FILE_SIZE_MB: '1' } });

    test('info and success toasts', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#securityText')).not.toHaveText(/checking/i);
        await page.locator('#fileInput').setInputFiles([madeUpFile('Too big é.bin', 2_000_000, 92)]);
        await expectToast(page.locator('#toast-host .toast-note').last(), 'info', /using direct transfer/i);

        await uploadFromHomePage(page, [madeUpFile('Copied é.bin', 3_000, 93)], { encrypted: true });
        await page.locator('#copyShare').click();
        await expectToast(page.locator('#toast-host .toast-note').last(), 'success', 'Copied link.');
    });
});
