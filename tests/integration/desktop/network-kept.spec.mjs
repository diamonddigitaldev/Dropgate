// What Settings > Network leaves in the profile (phase 19, `09` 18.19): the
// adapter's name and the switches, in config.json, and DB-IP's public files in
// Location Data, and nothing more. After choosing an adapter, refreshing the
// location data through it and checking the External IP, with the bar and its
// details shown and the log kept on disk, then a launch that checks again,
// nothing anywhere in the profile holds an External IP, a country, an ISP or an
// adapter's address (13.10's scan). The refreshed files are public data, and
// hold countries and ISPs by design: they're left out of the scan by name, and
// checked to be exactly what the stand-in for db-ip.com served.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { startDns } from '../../../client/test/helpers/network.mjs';
import { monthFromNow, writeLocationData } from '../../../client/test/helpers/mmdb.mjs';
import { fileOf, startDbIp } from '../helpers/dbip.mjs';
import { heldIn } from '../helpers/profile.mjs';
import { STAND_IN, STAND_IN_ADDRESS, expect, test } from '../helpers/desktop.mjs';

const V4 = '203.0.113.42';
const NL = { code: 'NL', country: 'Netherlands', isp: 'Example Hosting B.V.', asn: 64500 };
const GB = { code: 'GB', country: 'United Kingdom', isp: 'Example Broadband Ltd', asn: 64511 };

const LAST_MONTH = monthFromNow(-1);
const THIS_MONTH = monthFromNow(0);

/** What the refresh keeps, by name, in the profile: DB-IP's two files, unpacked. */
const KEPT = { country: path.join('Location Data', 'dbip-country-lite.mmdb'), asn: path.join('Location Data', 'dbip-asn-lite.mmdb') };

const meta = (window) => window.locator('#connection-meta');
const details = (window) => window.getByRole('dialog', { name: 'Connection Details' });

async function openSettings(window, tab) {
    await window.getByRole('button', { name: 'Settings', exact: true }).click();
    await window.getByRole('tab', { name: tab }).click();
}

/** The app's settings as it wrote them: config.json's. */
const stored = (desktop) => JSON.parse(fs.readFileSync(path.join(desktop.profile, 'config.json'), 'utf8')).settings ?? {};

test.describe('Settings > Network', () => {
    test.use({ localStun: { address: '127.0.0.2', mapped: { v4: V4 } } });

    test('after choosing an adapter, refreshing the location data and checking the External IP, the profile holds the adapter\'s name and the switches in config.json, DB-IP\'s files in Location Data, and nothing of any External IP, country, ISP or adapter address', async ({ desktop }) => {
        const dns = await startDns('127.0.0.2', { 'download.db-ip.com': '127.0.0.2' });
        const dbip = await startDbIp();
        try {
            writeLocationData(desktop.locationData, { [V4]: NL }, { month: LAST_MONTH });
            dbip.serve(THIS_MONTH, { [V4]: GB });
            desktop.dnsServer = dns.server;
            desktop.dbIp = dbip.url;
            const app = await desktop.launch();
            const window = await app.window();
            await openSettings(window, 'Privacy');
            await window.getByRole('switch', { name: 'Keep log on disk for troubleshooting' }).check();
            await openSettings(window, 'Network');
            await window.locator('#network-interface').selectOption(STAND_IN);
            await expect(window.locator('#network-interface-help')).toHaveText(new RegExp(`^Dropgate connects only through ${STAND_IN},`));

            // The refresh, through the adapter: this month's, kept and used.
            await window.getByRole('switch', { name: 'Refresh location data monthly' }).check();
            await expect.poll(() => dbip.asked(), { message: 'what the stand-in was asked', timeout: 30_000 }).toEqual([fileOf('country', THIS_MONTH), fileOf('asn', THIS_MONTH)]);
            await expect(window.locator('#location-data-line')).toHaveText(/, refreshed on the 1st\./);

            // The check, through the adapter, its country and ISP from the refreshed data; the bar and its details drawn.
            await desktop.setUp(window);
            await openSettings(window, 'Network');
            await window.getByRole('switch', { name: 'Check my External IP' }).check();
            await expect(meta(window)).toHaveText(/^United Kingdom · Example Broadband Ltd \(AS64511\) · Latency \d+ ms$/);
            await window.getByRole('switch', { name: 'Show the connection in the bottom bar' }).check();
            await window.locator('#kit-statusbar-connection').click();
            await expect(details(window).locator('#details-facts')).toContainText(V4);
            await window.keyboard.press('Escape');
            await app.quit();

            // A launch a person makes: the check goes again, through the adapter, and nothing more is downloaded.
            const again = await desktop.launch();
            const next = await again.window();
            await openSettings(next, 'Network');
            await expect(meta(next)).toHaveText(/^United Kingdom · Example Broadband Ltd \(AS64511\) · Latency \d+ ms$/);
            await again.quit();
            expect(dbip.requests, 'nothing more asked of DB-IP').toHaveLength(2);

            // config.json: the adapter's name and the switches.
            expect(stored(desktop)).toMatchObject({
                networkInterface: STAND_IN, networkBar: true, externalIpCheck: true, barShowsIpv4: true, barShowsIpv6: true, locationRefresh: true,
            });
            // Location Data: DB-IP's two files, as the stand-in for db-ip.com served them, and nothing else.
            expect(fs.readdirSync(desktop.refreshedData).sort(), 'Location Data').toEqual(['dbip-asn-lite.mmdb', 'dbip-country-lite.mmdb']);
            for (const [kind, file] of Object.entries(KEPT)) {
                const served = zlib.gunzipSync(dbip.files.get(fileOf(kind, THIS_MONTH)));
                expect(fs.readFileSync(path.join(desktop.profile, file)).equals(served), `${file}: the stand-in's, byte for byte`).toBe(true);
            }
            // Everything else in the profile: nothing of the External IP, either data's country or ISP, or the adapter's address.
            const results = [V4, NL.country, NL.isp, `AS${NL.asn}`, GB.country, GB.isp, `AS${GB.asn}`, STAND_IN_ADDRESS];
            expect(heldIn(desktop.profile, { texts: results, bytes: [], except: Object.values(KEPT) }), 'what the profile holds').toEqual([]);
            expect(fs.existsSync(path.join(desktop.profile, 'debug.log')), 'the log, kept on disk, was scanned').toBe(true);
            // The adapter's name in config.json alone (Linux's stand-in is "lo", too short to look for).
            if (process.platform !== 'linux') {
                expect(heldIn(desktop.profile, { texts: [STAND_IN], bytes: [], except: Object.values(KEPT) }), "the adapter's name").toEqual([`config.json: "${STAND_IN}"`]);
            }
        } finally {
            await dbip.close();
            await dns.close();
        }
    });
});
