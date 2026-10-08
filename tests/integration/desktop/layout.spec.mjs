// The desktop app's page at its smallest: nothing on Upload scrolls sideways
// (Linux's VM pass, 2026-10-04, saw a horizontal scrollbar under the link: the
// lifetime and downloads row's negative margins reached past the column). And
// the Server tab names Share with Dropgate only on Windows, which has it.
import { expect, test } from '../helpers/desktop.mjs';

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
    // The link row as it is after an upload, with a long link.
    await window.evaluate(() => {
        document.getElementById('link-section').classList.remove('d-none');
        document.getElementById('download-link').value = `https://dropgate.example.test/40418c60-e655-4d32-ba0c-c225a94e8c3b#${'k'.repeat(43)}`;
    });
    // A horizontal scrollbar takes its height from the view: offsetHeight counts it, clientHeight doesn't.
    // (The row still reaches past the column, so scrollWidth stays wider: it's clipped, not scrollable.)
    await expect.poll(() => window.evaluate(() => {
        const view = document.getElementById('upload-view');
        const cs = getComputedStyle(view);
        const borders = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
        return { overflowX: cs.overflowX, scrollbar: view.offsetHeight - view.clientHeight - borders };
    }), { message: "Upload's sideways overflow, and its horizontal scrollbar's height" }).toEqual({ overflowX: 'hidden', scrollbar: 0 });
    expect(await window.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'how far the page scrolls sideways').toBeLessThanOrEqual(0);
});

test('the Server tab mentions Share with Dropgate only on Windows', async ({ desktop }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await window.getByRole('button', { name: 'Settings', exact: true }).click();
    await window.getByRole('tab', { name: 'Server' }).click();
    await expect(window.locator('#server-help')).toHaveText(process.platform === 'win32'
        ? 'Uploads go to this server, and so does Share with Dropgate.'
        : 'Uploads go to this server.');
});
