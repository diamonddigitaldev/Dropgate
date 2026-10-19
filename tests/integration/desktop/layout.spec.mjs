// The desktop app's page at its smallest: nothing on Upload scrolls sideways
// (Linux's VM pass, 2026-10-04, saw a horizontal scrollbar under the link: the
// lifetime and downloads row's negative margins reached past the column), nor
// on Settings > Servers, where each server's row of them is now. And the
// Servers tab names Share with Dropgate only on Windows, which has it.
import { madeUpFile } from '../helpers/files.mjs';
import { expect, openServers, test, uploadLink } from '../helpers/desktop.mjs';

/** How far an element's content reaches sideways past it, and the height of its horizontal scrollbar. */
const sideways = (window, selector) => window.evaluate((sel) => {
    const element = document.querySelector(sel);
    const cs = getComputedStyle(element);
    const borders = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    // A horizontal scrollbar takes its height from the element: offsetHeight counts it, clientHeight doesn't.
    return { overflowX: cs.overflowX, scrollbar: element.offsetHeight - element.clientHeight - borders };
}, selector);

test('at the window\'s smallest, with a link shown, nothing on Upload scrolls sideways', async ({ desktop }) => {
    const app = await desktop.launch();
    const window = await app.window();
    const min = await app.app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        const [width, height] = win.getMinimumSize();
        win.setSize(width, height);
        return { width, height };
    });
    expect(min.width, "the window's minimum width").toBeGreaterThan(0);
    await desktop.setUp(window);
    // The Servers tab, with the server's settings for new uploads shown.
    await openServers(window);
    await expect(window.locator('#server-list .server-body').first()).toBeVisible();
    expect(await window.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'how far Settings > Servers scrolls sideways').toBeLessThanOrEqual(0);
    await window.locator('#nav-rail').getByRole('button', { name: 'Upload' }).click();

    // An upload's card as it is when it's done, with a long link.
    await desktop.upload(window, [madeUpFile('Narrow window.bin', 1_000, 90)], { encrypted: false });
    await uploadLink(window).evaluate((input) => {
        input.value = `https://dropgate.example.test/40418c60-e655-4d32-ba0c-c225a94e8c3b#${'k'.repeat(43)}`;
    });
    await expect.poll(() => sideways(window, '#upload-area'), { message: "Upload's sideways overflow, and its horizontal scrollbar's height" })
        .toEqual({ overflowX: 'hidden', scrollbar: 0 });
    expect(await window.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'how far the page scrolls sideways').toBeLessThanOrEqual(0);
});

test('the Servers tab mentions Share with Dropgate only on Windows', async ({ desktop }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await openServers(window);
    await expect(window.locator('#servers-help')).toHaveText(process.platform === 'win32'
        ? "A new upload starts on the default server, with that server's settings, and so does Share with Dropgate. Each server is checked only when it's used."
        : "A new upload starts on the default server, with that server's settings. Each server is checked only when it's used.");
});
