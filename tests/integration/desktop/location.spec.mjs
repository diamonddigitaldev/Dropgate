// Country, ISP and flags, in the app (phase 19, `09` 18.14). Each External IP has
// its flag, a bundled SVG with the country code as its tooltip, and the Connection
// card says "<Country> · <ISP> (<ASN>) · Latency 18 ms", all looked up on the machine
// in the location data: here, a small test database of the test's own, holding the
// made-up answers the STUN responder gives. Everything the network service tries to
// send is written down (network-stand-in.cjs), so a lookup is seen to send nothing,
// and what it finds is looked for in the profile and the log.
//
// The packaged build's real files are desktop/updates.spec.mjs'.
import os from 'node:os';
import { startDns } from '../../../client/test/helpers/network.mjs';
import { writeLocationData } from '../../../client/test/helpers/mmdb.mjs';
import { heldIn } from '../helpers/profile.mjs';
import { STAND_IN, STAND_IN_ADDRESS, expect, test } from '../helpers/desktop.mjs';

const V4 = '203.0.113.42';
const V6 = '2001:db8:5:12::42';
const V6_ELSEWHERE = '2001:db8:e497:4701::8cf5';
const NOT_HELD = '203.0.113.99';
const NO_FLAG = '203.0.113.77';

const NL = { code: 'NL', country: 'Netherlands', isp: 'Example Hosting B.V.', asn: 64500 };
const GB = { code: 'GB', country: 'United Kingdom', isp: 'Example Broadband Ltd', asn: 64511 };
const NO_SET = { code: 'QQ', country: 'Nowhere Listed', isp: 'Example Unlisted Ltd', asn: 64512 };
const PLACES = { [V4]: NL, [V6]: NL, [V6_ELSEWHERE]: GB, [NO_FLAG]: NO_SET };

const IPV6 = Object.values(os.networkInterfaces()).flat().some(({ address }) => address === '::1');

const ips = (window) => window.locator('#connection-ips');
const ip = (window, nth) => window.locator('#connection-ips .network-ip').nth(nth);
const flags = (window) => window.locator('#connection-ips img');
const meta = (window) => window.locator('#connection-meta');
const warning = (window) => window.locator('#connection-warning');
const checkAgain = (window) => window.locator('#connection-check');
const toggle = (window) => window.getByRole('switch', { name: 'Check my External IP' });

async function openNetwork(window) {
    await window.getByRole('button', { name: 'Settings', exact: true }).click();
    await window.getByRole('tab', { name: 'Network' }).click();
}

/** A flag as the page shows it: its bundled file, drawn, and its tooltip the country code. */
async function expectFlag(flag, code) {
    await expect(flag).toHaveAttribute('src', `../node_modules/flag-icons/flags/4x3/${code.toLowerCase()}.svg`);
    await expect(flag).toHaveAttribute('title', code);
    await expect(flag).toHaveAttribute('alt', code);
    await expect.poll(() => flag.evaluate((image) => image.naturalWidth), { message: "the flag's picture, drawn" }).toBeGreaterThan(0);
    await expect.poll(() => flag.evaluate((image) => image.src.startsWith('file:')), { message: 'from the app itself' }).toBe(true);
}

/** Everything the service tried to send, once a check has answered, but the proxy finding its own loopback to listen on. */
const sent = (app) => app.eventsOf('service-network').map(({ how, to }) => `${how} ${to}`.trim()).filter((line) => !['os-lookup ::1', 'os-lookup 127.0.0.1'].includes(line));

test.describe('with no adapter chosen, on IPv4', () => {
    test.use({ localStun: { address: '127.0.0.2', mapped: { v4: V4 } } });

    test('the flag and "<Country> · <ISP> (<ASN>) · Latency"; the lookup sends nothing but the one request, and asks no name', async ({ desktop, stun }) => {
        writeLocationData(desktop.locationData, PLACES);
        const app = await desktop.launch();
        const window = await app.window();
        await desktop.setUp(window);
        await openNetwork(window);

        await expect(meta(window)).toHaveText("Your External IP isn't checked. Turn on Check my External IP below to see it, with its country and ISP.");
        await expect(flags(window)).toHaveCount(0);

        await toggle(window).check();
        await expect(ips(window)).toHaveText(V4);
        await expect(flags(window)).toHaveCount(1);
        await expectFlag(flags(window), 'NL');
        await expect(meta(window)).toHaveText(/^Netherlands · Example Hosting B\.V\. \(AS64500\) · Latency \d+ ms$/);
        await expect(window.locator('#external-ip-check-help')).toHaveText(/That server sees your IP address\. Country and ISP are looked up on this computer\.$/);
        await expect(warning(window), 'one address, so no second country').toBeHidden();

        // Nothing but the binding request left the service: no connection, no name, no request for the lookup.
        expect(stun.requests.length, 'what the STUN server heard').toBe(1);
        expect(sent(app), 'all the service tried to send').toEqual([`datagram-to ${stun.port} 127.0.0.2`, 'datagram']);
        expect(app.eventsOf('csp'), "what the page's Content Security Policy refused").toEqual([]);
        // The net log's check, after every desktop test, says the rest of the app looked up nothing beyond this machine.
    });

    test('an address the data doesn\'t hold has no flag, and only its latency; a country with no flag in the set shows its code', async ({ desktop, stun }) => {
        writeLocationData(desktop.locationData, PLACES);
        const app = await desktop.launch();
        const window = await app.window();
        await desktop.setUp(window);
        await openNetwork(window);

        stun.mapped.v4 = NOT_HELD;
        await toggle(window).check();
        await expect(ips(window)).toHaveText(NOT_HELD);
        await expect(flags(window)).toHaveCount(0);
        await expect(meta(window)).toHaveText(/^Latency \d+ ms$/);

        stun.mapped.v4 = NO_FLAG;
        await checkAgain(window).click();
        await expect(window.locator('#connection-ips .network-flag-code')).toHaveText('QQ');
        await expect(window.locator('#connection-ips .network-flag-code')).toHaveAttribute('title', 'QQ');
        await expect(flags(window)).toHaveCount(0);
        await expect(meta(window)).toHaveText(/^Nowhere Listed · Example Unlisted Ltd \(AS64512\) · Latency \d+ ms$/);
    });

    test('with no location data (as from source, nothing fetched), the address and its latency still show', async ({ desktop }) => {
        const app = await desktop.launch();
        const window = await app.window();
        await desktop.setUp(window);
        await openNetwork(window);
        await toggle(window).check();
        await expect(ips(window)).toHaveText(V4);
        await expect(flags(window)).toHaveCount(0);
        await expect(meta(window)).toHaveText(/^Latency \d+ ms$/);
    });

    test('what it finds is nowhere in the profile or the log it keeps; off, it goes from the card', async ({ desktop }) => {
        writeLocationData(desktop.locationData, PLACES);
        const app = await desktop.launch();
        const window = await app.window();
        await desktop.setUp(window);
        await window.getByRole('button', { name: 'Settings', exact: true }).click();
        await window.getByRole('tab', { name: 'Privacy' }).click();
        await window.getByRole('switch', { name: 'Keep log on disk for troubleshooting' }).check();
        await openNetwork(window);
        await toggle(window).check();
        await expect(meta(window)).toHaveText(/^Netherlands · /);

        await toggle(window).uncheck();
        await expect(flags(window)).toHaveCount(0);
        await expect(meta(window)).toHaveText(/^Your External IP isn't checked\./);
        await app.quit();

        expect(heldIn(desktop.profile, { texts: [V4, NL.country, NL.isp, 'AS64500'], bytes: [] }), 'what the profile holds').toEqual([]);
    });
});

test.describe('with both addresses', () => {
    test.skip(!IPV6, 'no IPv6 loopback here');
    test.use({ localStun: { address: '127.0.0.2', address6: '::1', name: 'stun.test', mapped: { v4: V4, v6: V6 } } });

    test('each has its own flag; the warning shows when their countries differ, naming both, and not otherwise', async ({ desktop, stun }) => {
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
            await toggle(window).check();

            // The same country: a flag each, and no warning.
            await expect(ip(window, 0)).toHaveText(V4);
            await expect(ip(window, 1)).toHaveText(V6);
            await expectFlag(ip(window, 0).locator('img'), 'NL');
            await expectFlag(ip(window, 1).locator('img'), 'NL');
            await expect(meta(window)).toHaveText(/^Netherlands · Example Hosting B\.V\. \(AS64500\) · Latency \d+ ms$/);
            await expect(warning(window)).toBeHidden();
            const names = () => dns.queries.filter(({ name }) => name === 'stun.test').length;
            const asked = stun.requests.length;
            const askedNames = names();

            // Different countries: a flag each, and the warning, in the order of the addresses.
            stun.mapped.v6 = V6_ELSEWHERE;
            await checkAgain(window).click();
            await expect(ip(window, 1)).toHaveText(V6_ELSEWHERE);
            await expectFlag(ip(window, 0).locator('img'), 'NL');
            await expectFlag(ip(window, 1).locator('img'), 'GB');
            await expect(warning(window)).toBeVisible();
            await expect(window.locator('#connection-warning-text')).toHaveText('Your IPv4 and IPv6 addresses are in different countries (NL and GB), so one of them may not be going through your VPN.');
            expect(stun.requests.length - asked, 'one request a family, and none more for the lookups').toBe(2);
            expect(names() - askedNames, 'the STUN server\'s name, for each request').toBeLessThanOrEqual(2);
            expect(dns.queries.filter(({ name }) => name !== 'stun.test'), 'nothing asked of the DNS server for a lookup').toEqual([]);

            // Back the same: it goes.
            stun.mapped.v6 = V6;
            await checkAgain(window).click();
            await expect(ip(window, 1)).toHaveText(V6);
            await expect(warning(window)).toBeHidden();

            // Offline: what was found is kept, but nothing shows, the warning least of all; back, it's as it was.
            stun.mapped.v6 = V6_ELSEWHERE;
            await checkAgain(window).click();
            await expect(warning(window)).toBeVisible();
            await app.app.evaluate(() => { globalThis.__dropgateOnline = false; });
            await expect(warning(window)).toBeHidden();
            await expect(flags(window)).toHaveCount(0);
            await app.app.evaluate(() => { globalThis.__dropgateOnline = true; });
            await expect(warning(window)).toBeVisible();

            // Gone: nothing shows, and nothing's kept.
            desktop.setAdapters({});
            await expect(warning(window)).toBeHidden();
            await expect(flags(window)).toHaveCount(0);
        } finally {
            await dns.close();
        }
    });
});

test('Credits names DB-IP, its licence and flag-icons, each linked', async ({ desktop }) => {
    const app = await desktop.launch();
    const window = await app.window();
    await window.getByRole('button', { name: 'Settings', exact: true }).click();
    await window.getByRole('tab', { name: 'Credits' }).click();
    const credits = window.locator('.credits');
    await expect(credits).toContainText('Location data: IP Geolocation by DB-IP, licensed under the Creative Commons Attribution 4.0 International License.');
    await expect(credits).toContainText('Country flags from flag-icons, licensed under the MIT License.');
    await expect(credits.getByRole('link', { name: 'IP Geolocation by DB-IP' })).toBeVisible();
    await expect(credits.getByRole('link', { name: 'Creative Commons Attribution 4.0 International License' })).toBeVisible();
    await expect(credits.getByRole('link', { name: 'flag-icons' })).toBeVisible();
});
