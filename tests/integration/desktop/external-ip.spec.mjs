// The External IP and the connection's health, in the app (phase 19, `09`
// 18.11-18.13). Off by default, and then nothing is asked of anyone. Once on,
// one binding request a family to the default server's STUN server, at launch,
// when the network changes and on Check Again, and never on a timer, from the
// chosen adapter's address; what comes back stays in main's memory.
//
// The STUN server is a responder of the test's own, listed by the test's server,
// that gives a made-up address in place of where each request came from: what's
// on screen is its answer, and a scan of the profile can look for it.
import os from 'node:os';
import { startDns } from '../../../client/test/helpers/network.mjs';
import { madeUpFile } from '../helpers/files.mjs';
import { heldIn } from '../helpers/profile.mjs';
import { STAND_IN, STAND_IN_ADDRESS, expect, openServers, serverRow, serverStatus, test } from '../helpers/desktop.mjs';

const V4 = '203.0.113.42';
const V6 = '2001:db8:5:12::42';
const ELSEWHERE = '203.0.113.99';

/** What the Connection card and the switch are, on any screen. */
const line = (window) => window.locator('#connection-status .kit-status-text');
const ips = (window) => window.locator('#connection-ips');
const meta = (window) => window.locator('#connection-meta');
const checked = (window) => window.locator('#connection-checked');
const checkAgain = (window) => window.locator('#connection-check');
const toggle = (window) => window.getByRole('switch', { name: 'Check my External IP' });

async function openNetwork(window) {
    await window.getByRole('button', { name: 'Settings', exact: true }).click();
    await window.getByRole('tab', { name: 'Network' }).click();
}

/** The utility processes the app started, by file name. */
const networkServices = (app) => app.eventsOf('utility').filter(({ name }) => name === 'network-service.js');

/** Each request's family and source, in the order they came. */
const requestsAt = (stun, since = 0) => stun.requests.slice(since).map(({ family, source }) => ({ family, source }));

/** An app with a server saved and the check on, quit: the next launch is the one a person makes. */
async function savedOn(desktop) {
    const first = await desktop.launch();
    const window = await first.window();
    await desktop.setUp(window);
    await openNetwork(window);
    await toggle(window).check();
    await expect(ips(window)).not.toBeEmpty();
    await first.quit();
}

/** How long a change takes to reach a request: the watch's read, then it settling. */
const AFTER_A_CHANGE_MS = 1_000 + 2_000 + 1_500;

const IPV6 = Object.values(os.networkInterfaces()).flat().some(({ address }) => address === '::1');

test.describe('with the check off, as it is by default', () => {
    test.use({ localStun: { address: '127.0.0.2', mapped: { v4: V4 } } });

    test('nothing is asked of the STUN server, at launch or ever; the card says so, and the service isn\'t started for it', async ({ desktop, server, stun }) => {
        const app = await desktop.launch();
        const window = await app.window();
        await desktop.setUp(window);
        expect(networkServices(app), 'the network service, with nothing asking for it').toEqual([]);

        await openNetwork(window);
        await expect(toggle(window)).not.toBeChecked();
        await expect(window.locator('#external-ip-check-help')).toHaveText("Your External IP isn't checked, and nothing is asked of any server for it.");
        await expect(line(window)).toHaveText('Connected');
        await expect(line(window)).toHaveAttribute('title', `Connected, through whichever adapter ${process.platform === 'win32' ? 'Windows' : 'Linux'} chooses.`);
        await expect(ips(window)).toBeEmpty();
        await expect(meta(window)).toHaveText("Your External IP isn't checked. Turn on Check my External IP below to see it.");
        await expect(checked(window)).toBeHidden();
        await expect(checkAgain(window)).toBeHidden();

        // The network changing asks nothing, and nor does the server's own check.
        desktop.setAdapters({ [STAND_IN]: '127.0.0.4' });
        await openServers(window);
        const row = serverRow(window, server.baseUrl);
        await row.getByRole('button', { name: 'Test' }).click();
        await expect(serverStatus(row)).toHaveText(/^Online · /);
        await window.waitForTimeout(AFTER_A_CHANGE_MS);
        expect(requestsAt(stun), 'what the STUN server heard').toEqual([]);
    });
});

test.describe('with no adapter chosen', () => {
    test.use({ localStun: { address: '127.0.0.2', mapped: { v4: V4 } } });

    test('turned on, it asks once, as the OS routes it, and draws the answer; a launch asks once; a change once; Check Again once', async ({ desktop, stun }) => {
        const app = await desktop.launch();
        const window = await app.window();
        await desktop.setUp(window);
        await openNetwork(window);

        await toggle(window).check();
        await expect(ips(window)).toHaveText(V4);
        await expect(line(window)).toHaveText('Connected');
        await expect(meta(window)).toHaveText(/^Latency \d+ ms$/);
        await expect(checked(window)).toHaveText(/^Checked at \S+( \S+)?, by asking 127\.0\.0\.2\.$/);
        await expect(window.locator('#external-ip-check-help')).toHaveText(/^Dropgate asks 127\.0\.0\.2, the STUN server .+ \(your default server\) lists, for your address at launch, when your network changes, and when you click Check Again\. Over IPv6 too, where the adapter has it\. That server sees your IP address\.$/);
        await expect(checkAgain(window)).toBeEnabled();
        expect(requestsAt(stun), 'turned on: from wherever the OS sends it').toEqual([{ family: 4, source: '127.0.0.1' }]);
        expect(stun.requests[0].bytes.length, 'a binding request, and nothing else').toBe(20);

        await app.quit();
        const asked = stun.requests.length;

        // A launch: the service started for it, once the default server's check has said where to ask.
        const again = await desktop.launch();
        const next = await again.window();
        await openNetwork(next);
        await expect(ips(next)).toHaveText(V4);
        expect(networkServices(again)).toHaveLength(1);
        expect(requestsAt(stun, asked), 'at launch').toHaveLength(1);

        // The stand-in's address changing: once, once it's settled.
        const beforeChange = stun.requests.length;
        stun.mapped.v4 = ELSEWHERE;
        desktop.setAdapters({ [STAND_IN]: '127.0.0.4' });
        await expect(ips(next)).toHaveText(ELSEWHERE, { timeout: AFTER_A_CHANGE_MS + 5_000 });
        expect(requestsAt(stun, beforeChange), 'for the change').toHaveLength(1);

        // Check Again: once for each press.
        const beforeCheck = stun.requests.length;
        stun.mapped.v4 = V4;
        await checkAgain(next).click();
        await expect(ips(next)).toHaveText(V4);
        expect(requestsAt(stun, beforeCheck)).toHaveLength(1);
        await expect(checkAgain(next)).toBeEnabled();

        // Off: what was known goes, and nothing's asked by anything.
        const beforeOff = stun.requests.length;
        await toggle(next).uncheck();
        await expect(ips(next)).toBeEmpty();
        await expect(checkAgain(next)).toBeHidden();
        desktop.setAdapters({ [STAND_IN]: '127.0.0.5' });
        await next.waitForTimeout(AFTER_A_CHANGE_MS);
        expect(requestsAt(stun, beforeOff), 'off').toEqual([]);
    });

    test('never on a timer: three minutes with nothing happening asks nothing', async ({ desktop, stun }) => {
        test.setTimeout(240_000);
        await savedOn(desktop);
        const asked = stun.requests.length;
        const app = await desktop.launch();
        const window = await app.window();
        await openNetwork(window);
        await expect(ips(window)).toHaveText(V4);
        expect(stun.requests.length - asked, 'once, at launch').toBe(1);
        await window.waitForTimeout(180_000);
        expect(stun.requests.length - asked, 'three minutes on').toBe(1);
    });

    test.describe('over HTTPS, so a share needs no window', () => {
        test.use({ tlsProxy: true });

        test('a launch to share a file asks nothing, and starts nothing for it', async ({ desktop, stun }) => {
            await savedOn(desktop);
            const asked = stun.requests.length;
            const file = madeUpFile('Shared with the check on.bin', 10_000, 70);
            desktop.secrets.addFiles([file]);
            const app = await desktop.share(desktop.addFile(file));
            expect(await app.exited(), 'its exit code').toBe(0);
            expect(app.eventsOf('upload-finished').at(-1)?.status, 'the share itself').toBe('success');
            expect(networkServices(app), 'the network service').toEqual([]);
            expect(stun.requests.length, 'what the STUN server heard').toBe(asked);
        });
    });

    test('what it finds is nowhere in the profile or the log it keeps', async ({ desktop, stun }) => {
        const app = await desktop.launch();
        const window = await app.window();
        await desktop.setUp(window);
        await window.getByRole('button', { name: 'Settings', exact: true }).click();
        await window.getByRole('tab', { name: 'Privacy' }).click();
        await window.getByRole('switch', { name: 'Keep log on disk for troubleshooting' }).check();
        await openNetwork(window);
        await toggle(window).check();
        await expect(ips(window)).toHaveText(V4);
        stun.mapped.v4 = ELSEWHERE;
        await checkAgain(window).click();
        await expect(ips(window)).toHaveText(ELSEWHERE);
        await app.quit();

        expect(heldIn(desktop.profile, { texts: [V4, ELSEWHERE], bytes: [] }), 'what the profile holds').toEqual([]);
    });

    test('offline (the OS says): red, nothing to press, and nothing asked; back, it\'s as it was', async ({ desktop, stun }) => {
        const app = await desktop.launch();
        const window = await app.window();
        await desktop.setUp(window);
        await openNetwork(window);
        await toggle(window).check();
        await expect(ips(window)).toHaveText(V4);
        const asked = stun.requests.length;

        await app.app.evaluate(() => { globalThis.__dropgateOnline = false; });
        await expect(line(window)).toHaveText('Offline');
        await expect(line(window)).toHaveAttribute('title', /says this computer has no network connection\.$/);
        await expect(window.locator('#connection-status .kit-card-status')).toHaveClass(/kit-tone-danger/);
        await expect(ips(window)).toBeEmpty();
        await expect(meta(window)).toHaveText("Your External IP isn't known while there's no connection.");
        await expect(checkAgain(window)).toBeDisabled();
        expect(stun.requests.length).toBe(asked);

        await app.app.evaluate(() => { globalThis.__dropgateOnline = true; });
        await expect(line(window)).toHaveText('Connected');
        await expect(ips(window)).toHaveText(V4);
    });
});

test.describe('with an adapter chosen', () => {
    test.use({ localStun: { address: '127.0.0.2', address6: IPV6 ? '::1' : undefined, name: 'stun.test', mapped: { v4: V4, v6: V6 } } });

    test('each family\'s request comes from the adapter\'s address, its name looked up through it; gone, nothing\'s asked and it\'s red; back, it asks', async ({ desktop, stun }) => {
        const dns = await startDns('127.0.0.2', { 'stun.test': '127.0.0.2' }, IPV6 ? { 'stun.test': '::1' } : {});
        try {
            desktop.dnsServer = dns.server;
            desktop.setAdapters({ [STAND_IN]: IPV6 ? [STAND_IN_ADDRESS, '::1'] : STAND_IN_ADDRESS });
            const app = await desktop.launch();
            const window = await app.window();
            await openNetwork(window);
            await window.locator('#network-interface').selectOption(STAND_IN);
            await expect(line(window)).toHaveText(`Connected through ${STAND_IN}`);
            await desktop.setUp(window);
            await openNetwork(window);
            await toggle(window).check();

            await expect(ips(window)).toContainText(V4);
            if (IPV6) await expect(ips(window)).toContainText(V6);
            await expect(checked(window)).toHaveText(new RegExp(`^Checked at \\S+( \\S+)? through ${STAND_IN}, by asking stun\\.test\\.$`));
            const want = [{ family: 4, source: STAND_IN_ADDRESS }, ...(IPV6 ? [{ family: 6, source: '::1' }] : [])];
            expect(requestsAt(stun).sort((a, b) => a.family - b.family), 'each from the adapter').toEqual(want);
            expect([...new Set(dns.queries.filter(({ name }) => name === 'stun.test').map(({ source }) => source))], 'its name, through the adapter').toEqual([STAND_IN_ADDRESS]);

            // Gone: red, with why; what was known goes; nothing can be asked.
            const asked = stun.requests.length;
            desktop.setAdapters({});
            await expect(line(window)).toHaveText(`${STAND_IN} isn't connected`);
            await expect(line(window)).toHaveAttribute('title', `Dropgate is set to use only ${STAND_IN} (Settings > Network), so it connects through nothing until it's back.`);
            await expect(window.locator('#connection-status .kit-card-status')).toHaveClass(/kit-tone-danger/);
            await expect(ips(window)).toBeEmpty();
            await expect(checkAgain(window)).toBeDisabled();
            await window.waitForTimeout(AFTER_A_CHANGE_MS);
            expect(stun.requests.length, 'through nothing').toBe(asked);

            // Back: asked again, by itself: it's a change of the network.
            desktop.setAdapters({ [STAND_IN]: IPV6 ? [STAND_IN_ADDRESS, '::1'] : STAND_IN_ADDRESS });
            await expect(ips(window)).toContainText(V4, { timeout: AFTER_A_CHANGE_MS + 5_000 });
            await expect(line(window)).toHaveText(`Connected through ${STAND_IN}`);
            expect(requestsAt(stun, asked).sort((a, b) => a.family - b.family)).toEqual(want);
        } finally {
            await dns.close();
        }
    });
});

test.describe('with nothing to ask', () => {
    test('no saved server: yellow, with why, and nothing sent; the first server saved brings the check', async ({ desktop }) => {
        const app = await desktop.launch();
        const window = await app.window();
        await openNetwork(window);
        await toggle(window).check();
        await expect(line(window)).toHaveText('Connected · External IP Unavailable');
        await expect(line(window)).toHaveAttribute('title', "There's no saved server, so there's no STUN server to ask.");
        await expect(window.locator('#connection-status .kit-card-status')).toHaveClass(/kit-tone-warning/);
        await expect(meta(window)).toHaveText("There's no saved server, so there's no STUN server to ask.");
        await expect(window.locator('#external-ip-check-help')).toHaveText(/^Dropgate asks the STUN server your default server lists for your address at launch/);
    });

    test('a default with no STUN server: yellow, with why, and nothing sent', async ({ desktop }) => {
        const app = await desktop.launch();
        const window = await app.window();
        await desktop.setUp(window);
        await openNetwork(window);
        await toggle(window).check();
        await expect(line(window)).toHaveText('Connected · External IP Unavailable');
        await expect(line(window)).toHaveAttribute('title', /^.+ lists no STUN server, so there's nothing to ask\.$/);
        await expect(meta(window)).toHaveText(/^.+ lists no STUN server, so there's nothing to ask\.$/);
        await expect(ips(window)).toBeEmpty();
        await app.quit();
        expect(Object.keys(app.eventsOf('ipc-sizes').at(-1).sizes).filter((channel) => channel.includes('check-ip') && channel.includes('utility')), 'a request of the service').toEqual([]);
    });

    test.describe('direct transfers off', () => {
        test.use({ serverEnv: { ENABLE_P2P: 'false' } });

        test('a default with direct transfers off says so', async ({ desktop }) => {
            const app = await desktop.launch();
            const window = await app.window();
            await desktop.setUp(window);
            await openNetwork(window);
            await toggle(window).check();
            await expect(meta(window)).toHaveText(/^.+ lists no STUN server \(it has direct transfers off\), so there's nothing to ask\.$/);
        });
    });
});

test.describe('a STUN server that doesn\'t answer', () => {
    test.use({ localStun: { address: '127.0.0.2', silent: true } });

    // The service just started for it, so it's first told of the network, and waits for that to settle: 2 s, then the 5 s to answer.
    test('yellow after 5 seconds, with why, after one request; Check Again is there', async ({ desktop, stun }) => {
        const app = await desktop.launch();
        const window = await app.window();
        await desktop.setUp(window);
        await openNetwork(window);
        await toggle(window).check();
        await expect(line(window)).toHaveText('Checking your External IP…');
        await expect(meta(window)).toHaveText('Asking 127.0.0.2…');
        await expect(checkAgain(window)).toBeDisabled();
        await expect(checkAgain(window)).toHaveText('Checking…');
        await expect(line(window)).toHaveText('Connected · External IP Unavailable', { timeout: 10_000 });
        await expect(line(window)).toHaveAttribute('title', "127.0.0.2 didn't answer within 5 seconds.");
        await expect(meta(window)).toHaveText("127.0.0.2 didn't answer within 5 seconds.");
        await expect(checkAgain(window)).toHaveText('Check Again');
        await expect(checkAgain(window)).toBeEnabled();
        expect(stun.requests.length, 'one, and never again by itself').toBe(1);
    });
});
