// The location data's month and its monthly refresh, in the app (phase 19, `09`
// 18.16). Settings > Network's Location Data card says where country and ISP come
// from and the month (the mockup's line for each state of the switch), and the
// details say the month too, with nothing checked and nothing started: main reads
// it from the files themselves. "Refresh location data monthly" is off by default,
// and asks nothing. On, at launch, with the data held from an earlier month than
// this one, the network service downloads this month's two files once, from the
// test's stand-in for db-ip.com (dbip.mjs: nothing leaves the machine), through
// the stand-in adapter, checks them as the build does, and keeps them in the
// profile's Location Data, used at once; a file that isn't DB-IP's is refused,
// the old data kept; a failure waits for the next launch; nothing more that month;
// and a newer app release's own data wins.
//
// "The app's own" is the test's resources folder (desktop.locationData); the
// months are this one and the ones beside it, as the refresh goes by the clock.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { startDns } from '../../../client/test/helpers/network.mjs';
import { locationDatabases, monthFromNow, writeLocationData } from '../../../client/test/helpers/mmdb.mjs';
import { copySlipsShown } from '../helpers/copy-shown.mjs';
import { startDbIp } from '../helpers/dbip.mjs';
import { STAND_IN, STAND_IN_ADDRESS, expect, saved, test } from '../helpers/desktop.mjs';

const require = createRequire(import.meta.url);
const { monthHeld } = require('../../../client/src/core/location.js');

const V4 = '203.0.113.42';
const NL = { code: 'NL', country: 'Netherlands', isp: 'Example Hosting B.V.', asn: 64500 };
const GB = { code: 'GB', country: 'United Kingdom', isp: 'Example Broadband Ltd', asn: 64511 };

const LAST_MONTH = monthFromNow(-1);
const THIS_MONTH = monthFromNow(0);
const NEXT_MONTH = monthFromNow(1);

/** A month as the app says it: "November 2026". */
const monthName = (month) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The card's line, as the mockup has it for each state of the switch. */
const cameWith = (month) => `Country and ISP come from DB-IP's free location data, ${monthName(month)}, which came with this version. Your IP address isn't sent anywhere to look them up.`;
const refreshedOn = (month) => `Country and ISP come from DB-IP's free location data, ${monthName(month)}, refreshed on the 1st. Your IP address isn't sent anywhere to look them up.`;

const line = (window) => window.locator('#location-data-line');
const refreshSwitch = (window) => window.getByRole('switch', { name: 'Refresh location data monthly' });
const refreshHelp = (window) => window.locator('#location-refresh-help');
const checkSwitch = (window) => window.getByRole('switch', { name: 'Check my External IP' });
const meta = (window) => window.locator('#connection-meta');
const details = (window) => window.getByRole('dialog', { name: 'Connection Details' });

async function openNetwork(window) {
    await window.getByRole('button', { name: 'Settings', exact: true }).click();
    await window.getByRole('tab', { name: 'Network' }).click();
}

/** The utility processes the app started, by file name. */
const networkServices = (app) => app.eventsOf('utility').filter(({ name }) => name === 'network-service.js');

/** What the service tried to send to DB-IP, as it tried it (network-stand-in.cjs). */
const toDbIp = (app) => app.eventsOf('service-network').filter(({ to }) => String(to).includes('download.db-ip.com')).map(({ how, to }) => `${how} ${to}`);

/** DB-IP's two files of a month, as the service asks for them. */
const filesOf = (month) => [`dbip-country-lite-${month}.mmdb.gz`, `dbip-asn-lite-${month}.mmdb.gz`];

test.describe('the Location Data card and the monthly refresh', () => {
    test.use({ localStun: { address: '127.0.0.2', mapped: { v4: V4 } } });

    /** @type {Awaited<ReturnType<typeof startDbIp>>} */
    let dbip;
    test.beforeEach(async ({ desktop }) => {
        dbip = await startDbIp();
        desktop.dbIp = dbip.url;
    });
    test.afterEach(async () => {
        await dbip.close();
    });

    test('off by default, nothing is asked; the card and the details say the month that came with this version, with nothing checked and nothing started', async ({ desktop }) => {
        writeLocationData(desktop.locationData, { [V4]: NL }, { month: LAST_MONTH });
        dbip.serve(THIS_MONTH, { [V4]: GB });
        const app = await desktop.launch();
        const window = await app.window();
        await openNetwork(window);
        await expect(line(window)).toHaveText(cameWith(LAST_MONTH));
        await expect(refreshSwitch(window)).not.toBeChecked();
        await expect(refreshHelp(window)).toHaveText(`Dropgate uses the location data that came with this version (${monthName(LAST_MONTH)}).`);
        expect((await saved(window)).locationRefresh).toBe(false);
        expect(await copySlipsShown(window, [], 'Settings > Network, the refresh off'), 'the copy rules').toEqual([]);
        await window.getByRole('switch', { name: 'Show the connection in the bottom bar' }).check();
        // Settings > Network running the service, nothing is asked of DB-IP however long it's left.
        await window.waitForTimeout(3_000);
        await app.quit();

        // The next launch, the bar alone: the details say the month, with nothing started for it.
        const again = await desktop.launch();
        const next = await again.window();
        await next.locator('#kit-statusbar-connection').click();
        await expect(details(next).locator('#details-data')).toHaveText(`Location data: DB-IP, ${monthName(LAST_MONTH)}`);
        await next.waitForTimeout(3_000);
        expect(networkServices(again), 'nothing started').toEqual([]);
        expect(dbip.requests, 'what the stand-in for db-ip.com heard').toEqual([]);
        expect([...toDbIp(app), ...toDbIp(again)], 'what the service tried to send to DB-IP').toEqual([]);
        expect(fs.existsSync(desktop.refreshedData), 'nothing kept').toBe(false);
    });

    test('on, with the data from an earlier month: a failure waits for the next launch; then one download of each file, through the stand-in adapter, checked, kept and used at once; nothing more that month', async ({ desktop }) => {
        const dns = await startDns('127.0.0.2', { 'download.db-ip.com': '127.0.0.2' });
        try {
            writeLocationData(desktop.locationData, { [V4]: NL }, { month: LAST_MONTH });
            desktop.dnsServer = dns.server;
            const app = await desktop.launch();
            const window = await app.window();
            await openNetwork(window);
            await window.locator('#network-interface').selectOption(STAND_IN);
            await expect(window.locator('#network-interface-help')).toHaveText(new RegExp(`^Dropgate connects only through ${STAND_IN},`));

            // Turned on, it's the person asking: it goes now. DB-IP has nothing yet, so nothing is kept.
            await refreshSwitch(window).check();
            await expect(refreshHelp(window)).toHaveText("Once a month, Dropgate downloads DB-IP's newest location data from db-ip.com, which sees your IP address.");
            await expect.poll(() => dbip.asked(), { message: 'what the stand-in was asked' }).toEqual([filesOf(THIS_MONTH)[0]]);
            await expect(line(window)).toHaveText(refreshedOn(LAST_MONTH));
            expect(await copySlipsShown(window, [STAND_IN], 'Settings > Network, the refresh on'), 'the copy rules').toEqual([]);
            // Never sooner than the next launch: not by the switch, however long it's left.
            await refreshSwitch(window).uncheck();
            await expect(line(window)).toHaveText(cameWith(LAST_MONTH));
            await refreshSwitch(window).check();
            await window.waitForTimeout(3_000);
            expect(dbip.requests).toHaveLength(1);
            expect(fs.existsSync(desktop.refreshedData), 'nothing kept').toBe(false);
            await app.quit();

            // The next launch: this month's, once each, from the stand-in adapter's address, its name looked up through it.
            dbip.serve(THIS_MONTH, { [V4]: GB });
            const second = await desktop.launch();
            const window2 = await second.window();
            await openNetwork(window2);
            await expect(line(window2)).toHaveText(refreshedOn(THIS_MONTH), { timeout: 30_000 });
            expect(dbip.asked().slice(1)).toEqual(filesOf(THIS_MONTH));
            expect(dbip.requests.map(({ from }) => from), 'from the stand-in adapter alone').toEqual([STAND_IN_ADDRESS, STAND_IN_ADDRESS, STAND_IN_ADDRESS]);
            expect(dbip.requests.map(({ host }) => host)).toEqual(Array(3).fill('download.db-ip.com'));
            // Nothing sent but what a download needs: no user agent, no cookie, nothing of the installation.
            expect(dbip.requests.map(({ headers }) => headers), "each request's headers").toEqual(Array(3).fill(['accept-encoding', 'connection', 'host']));
            expect(dns.queries.filter(({ name }) => name === 'download.db-ip.com').length, "DB-IP's name, asked through the adapter").toBeGreaterThan(0);
            expect(toDbIp(second).map((tried) => tried.replace(/:\d+$/, ':<port>')), 'all the service tried for it').toEqual(filesOf(THIS_MONTH).flatMap((file) => [
                'dns download.db-ip.com',
                `https https://download.db-ip.com/free/${file}`,
                'connection download.db-ip.com:<port>',
            ]));
            expect(await monthHeld(desktop.refreshedData), 'kept in Location Data').toBe(THIS_MONTH);
            expect(fs.readdirSync(desktop.refreshedData).sort()).toEqual(['dbip-asn-lite.mmdb', 'dbip-country-lite.mmdb']);
            await expect(refreshHelp(window2)).toHaveText("Once a month, Dropgate downloads DB-IP's newest location data from db-ip.com, which sees your IP address.");

            // Used at once: the External IP's country is the new data's.
            await desktop.setUp(window2);
            await openNetwork(window2);
            await checkSwitch(window2).check();
            await expect(meta(window2)).toHaveText(/^United Kingdom · Example Broadband Ltd \(AS64511\) · Latency \d+ ms$/);
            await second.quit();

            // Not again that month.
            const third = await desktop.launch();
            const window3 = await third.window();
            await openNetwork(window3);
            await expect(line(window3)).toHaveText(refreshedOn(THIS_MONTH));
            await window3.waitForTimeout(3_000);
            expect(dbip.requests, 'nothing more asked').toHaveLength(3);
            expect(toDbIp(third)).toEqual([]);
        } finally {
            await dns.close();
        }
    });

    test('a file that isn\'t DB-IP\'s is refused, and neither is kept: the old data stays, as the card and the country say', async ({ desktop }) => {
        writeLocationData(desktop.locationData, { [V4]: NL }, { month: LAST_MONTH });
        // It names itself DB-IP's, of this month, as its metadata would pass; but it's far too small to be the database.
        dbip.serve(THIS_MONTH, { [V4]: GB }, { asn: locationDatabases({ [V4]: GB }, { month: THIS_MONTH }).asn });
        const app = await desktop.launch();
        const window = await app.window();
        await desktop.setUp(window);
        await openNetwork(window);
        await refreshSwitch(window).check();
        await expect.poll(() => dbip.requests.length, { message: 'both asked for' }).toBe(2);
        // The second checked, and refused: given the time to have been kept, nothing is.
        await window.waitForTimeout(2_000);
        expect(fs.existsSync(desktop.refreshedData) ? fs.readdirSync(desktop.refreshedData) : [], 'nothing kept').toEqual([]);
        await expect(line(window)).toHaveText(refreshedOn(LAST_MONTH));
        await checkSwitch(window).check();
        await expect(meta(window)).toHaveText(/^Netherlands · Example Hosting B\.V\. \(AS64500\) · Latency \d+ ms$/);
        expect(dbip.requests.map(({ from }) => from), 'with Any, as the OS routes it: not the stand-in adapter').not.toContain(STAND_IN_ADDRESS);
        expect(await monthHeld(desktop.refreshedData)).toBe(null);
    });

    test('a newer app release\'s own data wins: the refresh\'s older files are deleted, and nothing is asked', async ({ desktop }) => {
        writeLocationData(desktop.locationData, { [V4]: NL }, { month: THIS_MONTH });
        const app = await desktop.launch();
        const window = await app.window();
        await openNetwork(window);
        await refreshSwitch(window).check();
        await expect(line(window)).toHaveText(refreshedOn(THIS_MONTH));
        await app.quit();

        // As a refresh would have left them last month, then this release, bringing next month's.
        writeLocationData(desktop.refreshedData, { [V4]: GB }, { month: THIS_MONTH });
        writeLocationData(desktop.locationData, { [V4]: NL }, { month: NEXT_MONTH });
        const again = await desktop.launch();
        const next = await again.window();
        await desktop.setUp(next);
        await openNetwork(next);
        await expect(line(next)).toHaveText(refreshedOn(NEXT_MONTH));
        await expect.poll(() => fs.existsSync(desktop.refreshedData), { message: "the refresh's older files, deleted" }).toBe(false);
        await checkSwitch(next).check();
        await expect(meta(next)).toHaveText(/^Netherlands · /);
        await next.waitForTimeout(2_000);
        expect(dbip.requests, 'nothing asked').toEqual([]);

        // Off, the app's own are said to be the ones used.
        await refreshSwitch(next).uncheck();
        await expect(line(next)).toHaveText(cameWith(NEXT_MONTH));
        await expect(refreshHelp(next)).toHaveText(`Dropgate uses the location data that came with this version (${monthName(NEXT_MONTH)}).`);
    });
});
