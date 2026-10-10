// The main window's page has a Content-Security-Policy: it loads only its own
// scripts, styles, fonts and images (and Bootstrap's data: SVGs, for its
// switches and selects), and makes no request at all, since every request to
// a server is the transfer window's. Nothing the page does by itself is
// refused (the console says nothing of the policy as every view is opened),
// and what it doesn't do is: an inline script, an inline style, a request.
import { expect, test } from '../helpers/desktop.mjs';

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'";

test('the main window\'s page has its CSP: nothing it does is refused, and an inline script, an inline style and any request are', async ({ desktop, server }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await expect(window.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute('content', CSP);

    // Every view and tab, a server tested and a toast: none of it refused.
    await desktop.setUp(window);
    await window.getByRole('button', { name: 'Settings', exact: true }).click();
    for (const tab of ['Server', 'Privacy', 'Update', 'Credits']) {
        await window.getByRole('tab', { name: tab }).click();
        await expect(window.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
    }
    await expect(window.locator('img[src$="dropgate.png"]'), "Credits' logo").toBeVisible();
    await window.getByRole('tab', { name: 'Privacy' }).click();
    await expect(window.locator('#keep-log-on-disk'), 'a switch, drawn with a data: SVG').toBeVisible();
    await window.locator('#nav-rail').getByRole('button', { name: 'Upload' }).click();
    await expect(window.locator('#file-lifetime-unit'), 'a select, drawn with a data: SVG').toBeVisible();
    await expect(window.locator('#browse-more-btn .button-icon')).toHaveCSS('font-size', '16px');
    await window.evaluate(() => window.kit.ui.toast('A toast.', { type: 'success' }));
    await expect(window.getByText('A toast.')).toBeVisible();
    await expect.poll(async () => window.evaluate(() => document.fonts.check('24px "Material Icons Round"')), { message: 'the icon font, loaded' }).toBe(true);
    expect(app.eventsOf('csp'), 'what the page\'s CSP refused while it was used').toEqual([]);

    // An inline script doesn't run. (Not eval: the test's own evaluation is allowed it, whatever the page's CSP.)
    expect(await window.evaluate(() => {
        const script = document.createElement('script');
        script.textContent = 'window.inlineRan = true;';
        document.head.append(script);
        return window.inlineRan === true;
    }), 'whether an inline script ran').toBe(false);
    // An inline style isn't applied.
    expect(await window.evaluate(() => {
        const probe = document.createElement('div');
        probe.setAttribute('style', 'width: 123px');
        document.body.append(probe);
        const width = getComputedStyle(probe).width;
        probe.remove();
        return width;
    }), 'an inline style\'s width').not.toBe('123px');

    // No request, to the server or anywhere: connect-src 'none'.
    const before = server.requests().length;
    const refused = await window.evaluate(async (url) => Promise.all([url, 'data:,x'].map((to) => fetch(to).then(() => 'fetched', (err) => err.name))), `${server.baseUrl}/api/info`);
    expect(refused, 'requests from the page').toEqual(['TypeError', 'TypeError']);
    await window.waitForTimeout(500);
    expect(server.requests().slice(before), 'what reached the server from the page').toEqual([]);
    expect(app.eventsOf('request').filter(({ page }) => page === 'index.html'), 'requests the page sent').toEqual([]);
    expect(app.eventsOf('csp').length, 'each of those refused, as the console says').toBeGreaterThanOrEqual(3);
});
