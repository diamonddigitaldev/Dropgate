// The bottom bar and the connection's details, in the app (phase 19, `09` 18.15),
// and the OS named in every sentence that names one (18.17).
//
// The bar is the kit's (mountShell's statusBar), off by default, with Dropgate's
// one item: the health's dot and its short words (the adapter's name where it's
// well), then each External IP Show IPv4 and Show IPv6 let it show, with its flag.
// Clicking it opens the details, the kit's panel: the health at length, what's
// known (External IP, Country, ISP, Adapter, Latency, Checked), the IPv4/IPv6
// country warning (desktop/location.spec.mjs), then Check Again, Network Settings
// and the location data's month. The bar itself asks nothing and starts nothing.
import os from 'node:os';
import { startDns } from '../../../client/test/helpers/network.mjs';
import { writeLocationData } from '../../../client/test/helpers/mmdb.mjs';
import { copySlipsShown } from '../helpers/copy-shown.mjs';
import { STAND_IN, STAND_IN_ADDRESS, expect, saved, test } from '../helpers/desktop.mjs';

const V4 = '203.0.113.42';
const V6 = '2001:db8:5:12::42';
const NL = { code: 'NL', country: 'Netherlands', isp: 'Example Hosting B.V.', asn: 64500 };
const PLACES = { [V4]: NL, [V6]: NL };

const IPV6 = Object.values(os.networkInterfaces()).flat().some(({ address }) => address === '::1');

/** The OS the app runs on, as it names itself, and the one it doesn't. */
const OS = process.platform === 'win32' ? 'Windows' : 'Linux';
const OTHER = OS === 'Windows' ? 'Linux' : 'Windows';

const statusBar = (window) => window.locator('footer.kit-statusbar');
const item = (window) => window.locator('#kit-statusbar-connection');
const itemLine = (window) => item(window).locator('.kit-status-text');
const itemTone = (window) => item(window).locator('.kit-card-status');
const itemIps = (window) => item(window).locator('.network-addr');
const details = (window) => window.getByRole('dialog', { name: 'Connection Details' });
const detailsLine = (window) => details(window).locator('#details-status .kit-status-text');
const detailsCheck = (window) => details(window).getByRole('button', { name: 'Check Again' });
const barSwitch = (window) => window.getByRole('switch', { name: 'Show the connection in the bottom bar' });
const showIpv4 = (window) => window.getByRole('switch', { name: 'Show IPv4' });
const showIpv6 = (window) => window.getByRole('switch', { name: 'Show IPv6' });
const checkSwitch = (window) => window.getByRole('switch', { name: 'Check my External IP' });

async function openNetwork(window) {
    await window.getByRole('button', { name: 'Settings', exact: true }).click();
    await window.getByRole('tab', { name: 'Network' }).click();
}

/** The utility processes the app started, by file name. */
const networkServices = (app) => app.eventsOf('utility').filter(({ name }) => name === 'network-service.js');

/** The details' rows, as [term, [each line]]. */
const facts = (window) => details(window).locator('#details-facts').evaluate((list) => {
    const rows = [];
    for (const term of list.querySelectorAll('dt')) rows.push([term.textContent, [...term.nextElementSibling.children].map((line) => line.textContent)]);
    return rows;
});

test.describe('with no adapter chosen, on IPv4', () => {
    test.use({ localStun: { address: '127.0.0.2', mapped: { v4: V4 } } });

    test('off by default, and its switches with it; on, the dot and the health, its tooltip saying what the colour means; the details open, close and say what\'s known; it starts nothing, and stays on', async ({ desktop, stun }) => {
        const app = await desktop.launch();
        const window = await app.window();
        await desktop.setUp(window);
        await expect(statusBar(window), 'off by default').toBeHidden();
        await openNetwork(window);
        await expect(barSwitch(window)).not.toBeChecked();
        await expect(window.locator('#network-bar-help')).toHaveText("The bottom bar is hidden. The connection's health shows here only.");
        await expect(showIpv4(window)).toBeChecked();
        await expect(showIpv6(window)).toBeChecked();
        await expect(showIpv4(window), 'greyed with the bar off').toBeDisabled();
        await expect(showIpv6(window)).toBeDisabled();
        expect((await saved(window)).networkBar).toBe(false);

        await barSwitch(window).check();
        await expect(statusBar(window)).toBeVisible();
        await expect(window.locator('#network-bar-help')).toHaveText("The bar along the bottom of the window shows the connection's health, and your External IP when it's checked. Click it for the details.");
        await expect(itemLine(window)).toHaveText('Connected');
        await expect(itemLine(window)).toHaveAttribute('title', `Connected, through whichever adapter ${OS} chooses.`);
        await expect(itemTone(window)).toHaveClass(/kit-tone-success/);
        await expect(item(window).locator('.kit-status-dot')).toBeVisible();
        await expect(itemIps(window)).toHaveCount(0);
        await expect(showIpv4(window), 'greyed with the check off').toBeDisabled();
        expect((await saved(window)).networkBar).toBe(true);

        // The details: on a click, with focus in them; the head says it at length.
        await item(window).click();
        await expect(details(window)).toBeVisible();
        await expect(item(window)).toHaveAttribute('aria-expanded', 'true');
        await expect(detailsLine(window)).toHaveText('Connected');
        expect(await facts(window)).toEqual([
            ['External IP', ['Not checked. Turn on Check my External IP in Settings > Network.']],
            ['Adapter', [`Any interface, as ${OS} chooses`]],
        ]);
        await expect(detailsCheck(window)).toBeDisabled();
        await expect(details(window).getByRole('button', { name: 'Network Settings' })).toBeEnabled();
        await expect(details(window).locator('#details-data'), 'no month known with nothing looked up').toBeHidden();
        await expect(details(window).locator('#details-warning')).toBeHidden();
        expect(await copySlipsShown(window, [], 'the details, with nothing checked'), 'the copy rules').toEqual([]);

        // Escape closes them, the focus back on the item; a click outside closes them too.
        await window.keyboard.press('Escape');
        await expect(details(window)).toBeHidden();
        await expect(item(window)).toBeFocused();
        await item(window).click();
        await expect(details(window)).toBeVisible();
        await window.locator('#network-settings').click({ position: { x: 5, y: 5 } });
        await expect(details(window)).toBeHidden();

        // Network Settings: they close, and the tab shows.
        await window.locator('#nav-rail').getByRole('button', { name: 'Upload' }).click();
        await item(window).click();
        await details(window).getByRole('button', { name: 'Network Settings' }).click();
        await expect(details(window)).toBeHidden();
        await expect(window.getByRole('tab', { name: 'Network' })).toHaveAttribute('aria-selected', 'true');
        await expect(barSwitch(window)).toBeVisible();

        // Offline, as the OS says: red, in the bar too, with nothing open.
        await window.locator('#nav-rail').getByRole('button', { name: 'Upload' }).click();
        await app.app.evaluate(() => { globalThis.__dropgateOnline = false; });
        await expect(itemLine(window)).toHaveText('Offline');
        await expect(itemLine(window)).toHaveAttribute('title', `${OS} says this computer has no network connection.`);
        await expect(itemTone(window)).toHaveClass(/kit-tone-danger/);
        await app.app.evaluate(() => { globalThis.__dropgateOnline = true; });
        await expect(itemLine(window)).toHaveText('Connected');
        await app.quit();

        // Kept: the next launch shows it at once, and the bar alone (Settings > Network never opened) starts nothing and asks nothing.
        const again = await desktop.launch();
        const next = await again.window();
        await expect(itemLine(next)).toHaveText('Connected');
        await expect(statusBar(next)).toBeVisible();
        await next.waitForTimeout(3_000);
        expect(networkServices(again)).toEqual([]);
        expect(stun.requests, 'what the STUN server heard').toEqual([]);
    });

    test('with the check on, each External IP Show IPv4 lets it show, with its flag; the details hold the mockup\'s rows and the data\'s month, and Check Again asks once', async ({ desktop, stun }) => {
        writeLocationData(desktop.locationData, PLACES);
        const app = await desktop.launch();
        const window = await app.window();
        await desktop.setUp(window);
        await openNetwork(window);
        await checkSwitch(window).check();
        await expect(window.locator('#connection-ips')).toHaveText(V4);
        await expect(showIpv4(window), 'greyed with the bar off, the check on').toBeDisabled();
        await expect(showIpv6(window)).toBeDisabled();
        await barSwitch(window).check();

        await expect(itemIps(window)).toHaveText([V4]);
        await expect(itemLine(window)).toHaveText('Connected');
        const flag = itemIps(window).locator('img');
        await expect(flag).toHaveAttribute('src', '../node_modules/flag-icons/flags/4x3/nl.svg');
        await expect(flag).toHaveAttribute('title', 'NL');
        await expect(showIpv4(window)).toBeEnabled();
        await expect(showIpv6(window)).toBeEnabled();

        await item(window).click();
        await expect(details(window)).toBeVisible();
        const rows = await facts(window);
        expect(rows.map(([term]) => term), 'the mockup\'s rows, in its order').toEqual(['External IP', 'Country', 'ISP', 'Adapter', 'Latency', 'Checked']);
        expect(rows.slice(0, 4)).toEqual([
            ['External IP', [V4]],
            ['Country', ['Netherlands (NL)']],
            ['ISP', ['Example Hosting B.V. (AS64500)']],
            ['Adapter', [`Any interface, as ${OS} chooses`]],
        ]);
        expect(rows[4][1][0]).toMatch(/^\d+ ms to 127\.0\.0\.2$/);
        expect(rows[5][1][0]).toMatch(/^\S+( \S+)?, by asking 127\.0\.0\.2$/);
        await expect(details(window).locator('#details-facts img')).toHaveAttribute('title', 'NL');
        await expect(details(window).locator('#details-data')).toHaveText('Location data: DB-IP, November 2026');
        // Check Again, Network Settings and the month, on one line.
        const tops = await details(window).locator('.network-details-foot > *').evaluateAll((parts) => parts.map((part) => Math.round(part.getBoundingClientRect().top + part.getBoundingClientRect().height / 2)));
        expect(new Set(tops).size, 'one line').toBe(1);
        const width = await details(window).evaluate((panel) => panel.getBoundingClientRect().width);
        expect(width, "the mockup's 440px").toBe(440);
        expect(await copySlipsShown(window, [V4], 'the details, checked'), 'the copy rules').toEqual([]);

        // Check Again, from the details: once, busy until it's answered, the details open throughout and the focus back on it.
        const asked = stun.requests.length;
        await detailsCheck(window).click();
        await expect(detailsCheck(window)).toHaveText('Check Again');
        await expect(detailsCheck(window)).toBeEnabled();
        await expect(detailsCheck(window)).toBeFocused();
        expect(stun.requests.length - asked, 'one request').toBe(1);
        await window.keyboard.press('Escape');
        await expect(details(window)).toBeHidden();

        // Show IPv4 off: the bar leaves it out; the card and the details keep it.
        await showIpv4(window).uncheck();
        await expect(itemIps(window)).toHaveCount(0);
        await expect(item(window).locator('img')).toHaveCount(0);
        await expect(window.locator('#network-bar-ipv4-help')).toHaveText("The bottom bar leaves out your IPv4 address. It's still here and in the details.");
        await expect(window.locator('#connection-ips')).toHaveText(V4);
        await item(window).click();
        expect((await facts(window))[0]).toEqual(['External IP', [V4]]);
        await window.keyboard.press('Escape');
        expect((await saved(window)).barShowsIpv4).toBe(false);
        await showIpv4(window).check();
        await expect(itemIps(window)).toHaveText([V4]);

        // The check off: no address anywhere, and Show IPv4 and Show IPv6 greyed again.
        await checkSwitch(window).uncheck();
        await expect(itemIps(window)).toHaveCount(0);
        await expect(itemLine(window)).toHaveText('Connected');
        await expect(showIpv4(window)).toBeDisabled();
        await expect(showIpv6(window)).toBeDisabled();
    });
});

test.describe('with an adapter chosen, and both addresses', () => {
    test.skip(!IPV6, 'no IPv6 loopback here');
    test.use({ localStun: { address: '127.0.0.2', address6: '::1', name: 'stun.test', mapped: { v4: V4, v6: V6 } } });

    test('the bar names the adapter and shows both, Show IPv6 leaving one out; gone, red with why, in the bar and the details; back, as it was', async ({ desktop }) => {
        const dns = await startDns('127.0.0.2', { 'stun.test': '127.0.0.2' }, { 'stun.test': '::1' });
        try {
            writeLocationData(desktop.locationData, PLACES);
            desktop.dnsServer = dns.server;
            desktop.setAdapters({ [STAND_IN]: [STAND_IN_ADDRESS, '::1'] });
            const app = await desktop.launch();
            const window = await app.window();
            await openNetwork(window);
            await window.locator('#network-interface').selectOption(STAND_IN);
            await desktop.setUp(window);
            await openNetwork(window);
            await barSwitch(window).check();
            await checkSwitch(window).check();

            await expect(itemIps(window)).toHaveText([V4, V6]);
            await expect(itemLine(window)).toHaveText(STAND_IN);
            await expect(itemLine(window)).toHaveAttribute('title', `Connected. Dropgate uses only ${STAND_IN}.`);
            await expect(itemTone(window)).toHaveClass(/kit-tone-success/);

            await showIpv6(window).uncheck();
            await expect(itemIps(window)).toHaveText([V4]);
            await showIpv6(window).check();
            await expect(itemIps(window)).toHaveText([V4, V6]);

            await item(window).click();
            await expect(detailsLine(window)).toHaveText(`Connected through ${STAND_IN}`);
            const rows = await facts(window);
            expect(rows.slice(0, 4)).toEqual([
                ['External IP', [V4, V6]],
                ['Country', ['Netherlands (NL)']],
                ['ISP', ['Example Hosting B.V. (AS64500)']],
                ['Adapter', [`${STAND_IN} · ${STAND_IN_ADDRESS}`, 'Dropgate uses only this adapter.']],
            ]);
            expect(await copySlipsShown(window, [STAND_IN, V4, V6], 'the details, through an adapter'), 'the copy rules').toEqual([]);

            // Gone: red, in both; nothing known shows; Check Again can't.
            desktop.setAdapters({});
            await expect(itemLine(window)).toHaveText(`${STAND_IN} isn't connected`);
            await expect(itemLine(window)).toHaveAttribute('title', `Dropgate is set to use only ${STAND_IN} (Settings > Network), so it connects through nothing until it's back.`);
            await expect(itemTone(window)).toHaveClass(/kit-tone-danger/);
            await expect(itemIps(window)).toHaveCount(0);
            await expect(details(window)).toBeVisible();
            await expect(detailsLine(window)).toHaveText(`${STAND_IN} isn't connected`);
            expect(await facts(window)).toEqual([
                ['External IP', ["Not known while there's no connection."]],
                ['Adapter', [`${STAND_IN} · Not Connected`, 'Dropgate uses only this adapter.']],
            ]);
            await expect(detailsCheck(window)).toBeDisabled();
            expect(await copySlipsShown(window, [STAND_IN], 'the details, the adapter gone'), 'the copy rules').toEqual([]);

            // Back: asked again by itself, and as it was.
            desktop.setAdapters({ [STAND_IN]: [STAND_IN_ADDRESS, '::1'] });
            await expect(itemIps(window)).toHaveText([V4, V6], { timeout: 10_000 });
            await expect(itemLine(window)).toHaveText(STAND_IN);
        } finally {
            await dns.close();
        }
    });
});

test.describe('a STUN server that doesn\'t answer', () => {
    test.use({ localStun: { address: '127.0.0.2', silent: true } });

    test('checking, then "External IP unavailable", its tooltip saying why, and the details the same', async ({ desktop }) => {
        const app = await desktop.launch();
        const window = await app.window();
        await desktop.setUp(window);
        await openNetwork(window);
        await barSwitch(window).check();
        await checkSwitch(window).check();
        await expect(itemLine(window)).toHaveText('Checking…');
        await expect(itemTone(window)).toHaveClass(/kit-tone-running/);
        await expect(itemLine(window)).toHaveText('External IP unavailable', { timeout: 10_000 });
        await expect(itemLine(window)).toHaveAttribute('title', "127.0.0.2 didn't answer within 5 seconds.");
        await expect(itemTone(window)).toHaveClass(/kit-tone-warning/);
        await item(window).click();
        await expect(detailsLine(window)).toHaveText('Connected · External IP Unavailable');
        expect((await facts(window))[0]).toEqual(['External IP', ["127.0.0.2 didn't answer within 5 seconds."]]);
        await expect(detailsCheck(window)).toBeEnabled();
        expect(await copySlipsShown(window, [], 'the details, unanswered'), 'the copy rules').toEqual([]);
    });
});

test('18.17: every sentence that names the OS names the one it runs on: the adapter\'s choice and its help, the proxy note, the health, offline, and the details', async ({ desktop }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await openNetwork(window);
    await barSwitch(window).check();
    await expect(window.locator('#network-interface option').first()).toHaveText(`Any interface (as ${OS} chooses)`);
    await expect(window.locator('#network-interface-help')).toHaveText(`Dropgate connects through whichever adapter ${OS} chooses for each connection.`);
    await expect(window.locator('#network-interface-note')).toContainText(`Choosing one also sets aside ${OS === 'Windows' ? "Windows'" : "Linux's"} proxy settings for Dropgate.`);
    await expect(window.locator('#connection-status .kit-status-text')).toHaveAttribute('title', `Connected, through whichever adapter ${OS} chooses.`);
    await expect(itemLine(window)).toHaveAttribute('title', `Connected, through whichever adapter ${OS} chooses.`);
    await item(window).click();
    expect((await facts(window)).find(([term]) => term === 'Adapter')).toEqual(['Adapter', [`Any interface, as ${OS} chooses`]]);

    /** Every word the tab and the details show, and their tooltips. */
    const said = () => window.evaluate(() => [document.getElementById('network-settings'), document.getElementById('kit-statusbar-connection-panel'), document.getElementById('kit-statusbar-connection')]
        .flatMap((part) => [part.innerText, ...[...part.querySelectorAll('[title], option')].map((node) => node.title || node.textContent)]).join('\n'));
    expect(await said(), `nothing names ${OTHER}`).not.toContain(OTHER);

    await app.app.evaluate(() => { globalThis.__dropgateOnline = false; });
    await expect(window.locator('#connection-status .kit-status-text')).toHaveAttribute('title', `${OS} says this computer has no network connection.`);
    await expect(itemLine(window)).toHaveAttribute('title', `${OS} says this computer has no network connection.`);
    expect(await said(), `offline, nothing names ${OTHER}`).not.toContain(OTHER);
});
