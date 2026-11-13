// The packaged desktop app checking for updates: no ID of the install, and the update dot.
// The updater is electron-kit's, and only runs in a packaged app, so these run
// against a test build whose update address is this machine
// (helpers/update-server.mjs), named in DROPGATE_PACKAGED_APP: in CI, the
// Windows build's unpacked app, and the Linux build's AppImage.
//
// v3's updater sent a random ID of the install with every check, kept in the
// profile's .updaterId, so GitHub could link one install's checks across time
// and addresses. The kit sends a fixed value in its place, makes no ID
// at all, and deletes the .updaterId v3 left. Two new profiles' checks, on each channel, must carry nothing that
// tells them apart or ties them together, and leave no ID behind.
//
// With a network adapter chosen, every request of a check or a download goes through the network service, bound to it, and with it gone
// none reaches anything. The adapter is the stand-in the desktop project's
// network.spec.mjs uses, a loopback address the update server sees requests
// come from. This build loads no test preload, so the stand-in comes in through
// Playwright's own hold on main (standInAdapters()), and the build is the
// app as it ships but for its update address.
//
// The update server never has the installer it names, so nothing is ever
// downloaded or installed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { STAND_IN, STAND_IN_ADDRESS, addServer, writeAdapters } from '../helpers/desktop.mjs';
import { expect, test } from '../helpers/test.mjs';
import { outsideLookups, proxyLookups, resolverJobs } from '../helpers/netlog.mjs';
import { startUpdateServer } from '../helpers/update-server.mjs';

const APP = process.env.DROPGATE_PACKAGED_APP;
test.skip(!APP, 'the updater only runs in a packaged app: set DROPGATE_PACKAGED_APP to one built for these tests');
// The update server's port is fixed by the build, so the tests take turns.
test.describe.configure({ mode: 'serial' });

/** The fixed value the kit sends as x-user-staging-id, in place of an ID of the install. */
const FIXED_STAGING_ID = '00000000-0000-0000-0000-000000000000';

/**
 * The request headers that may be the same for two installs, because they're
 * the same for everyone using this build on this machine: none says which
 * install is asking. The sec-fetch-* ones are Chromium's fetch metadata, which
 * say what kind of request it is.
 */
const SAME_FOR_EVERYONE = new Set(['accept', 'accept-encoding', 'accept-language', 'cache-control', 'connection', 'host', 'pragma', 'user-agent', 'x-user-staging-id',
    'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site']);

/** The version the packaged app runs, and a newer one on each channel. */
const current = JSON.parse(fs.readFileSync(new URL('../../../client/package.json', import.meta.url), 'utf8')).version;
const [major, minor, patch] = current.split(/[.-]/).map(Number);
const next = `${major}.${minor}.${patch + 1}`;
const OFFERS = { latest: next, beta: `${next}-beta.1`, alpha: `${next}-alpha.1` };

/** Where electron-updater would keep a download: emptied first, so nothing from an earlier run is installed. */
const CACHE = path.join(process.platform === 'win32' ? process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local') : process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'dropgate-client-updater');

/**
 * Launch the packaged app with a new profile holding these settings.
 * @param {Record<string, unknown>} settings
 * @param {{ oldInstallId?: string }} [options]
 */
async function launch(settings, { oldInstallId } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dropgate-update-test-'));
    const profile = path.join(root, 'profile');
    fs.mkdirSync(profile);
    // The ID of the install v3's updater kept, in a profile it used.
    if (oldInstallId) fs.writeFileSync(path.join(profile, '.updaterId'), oldInstallId);
    // The kit's own store, at its settings' version, so the person's choices are in place from the start.
    fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({ settings, settingsSchema: 4 }));
    const netLog = path.join(root, 'netlog.json');
    const adaptersFile = path.join(root, 'adapters.json');
    writeAdapters(adaptersFile, { [STAND_IN]: STAND_IN_ADDRESS });
    // The stand-in reads this, if the test brings it in; the app itself never does.
    const env = { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1', DROPGATE_TEST_ADAPTERS: adaptersFile };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await electron.launch({
        executablePath: APP,
        args: [`--user-data-dir=${profile}`, '--no-proxy-server', `--log-net-log=${netLog}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
        env,
    });
    return { app, root, profile, netLog, setAdapters: (adapters) => writeAdapters(adaptersFile, adapters) };
}

/** After the app has quit: it looked for no proxy and nothing beyond this machine. Its folder goes. */
function checkedAndGone({ root, netLog }) {
    expect(proxyLookups(netLog), 'the times the app looked for a proxy by itself').toEqual([]);
    expect(outsideLookups(netLog), 'the names the app looked up beyond this machine').toEqual([]);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

/**
 * Launch the packaged app with a new profile holding these settings, wait for
 * its check at launch (5 s in), and quit.
 * @param {Record<string, unknown>} settings
 * @param {{ requests: { file: string }[] }} server
 * @param {(window: import('@playwright/test').Page) => Promise<void>} [whileOpen]
 */
async function runOnce(settings, server, whileOpen, { oldInstallId } = {}) {
    const before = server.requests.length;
    const run = await launch(settings, { oldInstallId });
    const { app, profile } = run;
    try {
        const window = await app.firstWindow();
        if (oldInstallId) await expect.poll(() => fs.existsSync(path.join(profile, '.updaterId')), { message: "whether v3's .updaterId is still there" }).toBe(false);
        await expect.poll(() => server.requests.length - before, { message: 'the check at launch', timeout: 20_000 }).toBeGreaterThan(0);
        await whileOpen?.(window);
    } finally {
        await app.close();
    }
    const requests = server.requests.slice(before);
    const updaterId = fs.existsSync(path.join(profile, '.updaterId'));
    checkedAndGone(run);
    return { requests, updaterId };
}

/**
 * The network service, from here on, with the test's adapters in place of the
 * machine's: the real service, in the packaged app, behind network-stand-in.cjs.
 * Main is reached through Playwright, once it has launched: nothing is added
 * to the build. A service already running keeps the machine's (killService()).
 * Each one forked is counted in globalThis.__dropgateStandIns.
 * @param {import('@playwright/test').ElectronApplication} app
 */
const standInAdapters = (app) => app.evaluate(({ utilityProcess }, standIn) => {
    const fork = utilityProcess.fork;
    globalThis.__dropgateStandIns = 0;
    utilityProcess.fork = function (modulePath, args, options) {
        if (!modulePath.endsWith('network-service.js')) return fork.call(this, modulePath, args, options);
        globalThis.__dropgateStandIns++;
        return fork.call(this, standIn, [modulePath, ...args], options);
    };
}, fileURLToPath(new URL('../helpers/network-stand-in.cjs', import.meta.url)));

const standInsForked = (app) => app.evaluate(() => globalThis.__dropgateStandIns);

/** Kill the running network service, as the OS could: main starts it again. How many stand-ins had been forked, or null with no service to kill. */
const killService = (app) => app.evaluate(({ app: electronApp }) => {
    const services = electronApp.getAppMetrics().filter(({ name }) => name === 'Dropgate Client Network Service');
    for (const { pid } of services) process.kill(pid);
    return services.length > 0 ? globalThis.__dropgateStandIns : null;
});

const updateStatus = (window) => window.evaluate(() => window.kitAPI.getUpdateStatus());
const checkForUpdates = (window) => window.evaluate(() => window.kitAPI.checkForUpdates());

/** Wait for the check at launch to have run, whatever came of it. */
const launchCheckDone = (window) => expect.poll(async () => {
    const { pending, state } = await updateStatus(window);
    return pending || state === 'checking';
}, { message: 'whether the check at launch is still to come', timeout: 20_000 }).toBe(false);

/** Where each of these requests came from: one set, so a check names any other. */
const sourcesOf = (requests) => [...new Set(requests.map(({ source }) => source))];

const channelFile = `latest${process.platform === 'linux' ? '-linux' : ''}.yml`;

const networkSelect = (window) => window.locator('#network-interface');
const networkHelp = (window) => window.locator('#network-interface-help');

test.beforeEach(() => fs.rmSync(CACHE, { recursive: true, force: true }));
test.afterAll(() => fs.rmSync(CACHE, { recursive: true, force: true }));

for (const channel of ['stable', 'beta', 'alpha']) {
    test(`on ${channel}, two new installs' update checks carry no ID of either, and leave none in the profile`, async () => {
        const server = await startUpdateServer(OFFERS);
        try {
            // Automatic downloads off, so the check is all there is.
            const settings = { updateChannel: channel, autoDownloadUpdates: false };
            const runs = [await runOnce(settings, server), await runOnce(settings, server)];

            const file = `${channel === 'stable' ? 'latest' : channel}${process.platform === 'linux' ? '-linux' : ''}.yml`;
            for (const [i, { requests, updaterId }] of runs.entries()) {
                expect(requests.map((r) => r.file), `what install ${i + 1} asked for`).toEqual([file]);
                for (const { headers } of requests) expect(headers['x-user-staging-id'], `install ${i + 1}'s x-user-staging-id`).toBe(FIXED_STAGING_ID);
                expect(updaterId, `whether install ${i + 1}'s profile has a .updaterId`).toBe(false);
            }

            // Every header both installs sent the same is one that's the same for everyone.
            const [a, b] = runs.map(({ requests }) => requests[0].headers);
            const shared = Object.keys(a).filter((name) => JSON.stringify(a[name]) === JSON.stringify(b[name]));
            expect(shared.filter((name) => !SAME_FOR_EVERYONE.has(name)), 'headers both installs sent the same, that could name one').toEqual([]);
            expect(a['user-agent'], 'the user agent names no version or install').toBe('electron-builder');
        } finally {
            await server.close();
        }
    });
}

test('with automatic downloads off, an update found shows the dot on Settings and on the Update tab, and nothing is downloaded', async () => {
    const server = await startUpdateServer(OFFERS);
    try {
        const { requests } = await runOnce({ updateChannel: 'stable', autoDownloadUpdates: false }, server, async (window) => {
            // The rail's, on Settings; then the Update tab's too, once Settings shows.
            await expect(window.locator('#nav-rail .update-dot:visible'), 'the dot on Settings').toHaveCount(1);
            await window.getByRole('button', { name: /^Settings/ }).click();
            await window.getByRole('tab', { name: /^Update/ }).click();
            await expect(window.locator('.update-dot:visible'), 'the update dots').toHaveCount(2);
            const pane = window.getByRole('tabpanel', { name: /^Update/ });
            await expect(pane.getByRole('status')).toHaveText(`Version ${next} is available.`);
            await expect(pane.getByRole('button', { name: 'Download Update' })).toBeVisible();
        });
        expect(requests.map((r) => r.file), 'what the app asked for').toEqual([`latest${process.platform === 'linux' ? '-linux' : ''}.yml`]);
    } finally {
        await server.close();
    }
});

test("an upgrade from v3 deletes the ID of the install v3's updater kept, and never sends it", async () => {
    const server = await startUpdateServer(OFFERS);
    const old = '6f1c2a3b-4d5e-5f60-8a7b-9c0d1e2f3a4b';
    try {
        const { requests, updaterId } = await runOnce({ updateChannel: 'stable', autoDownloadUpdates: false }, server, undefined, { oldInstallId: old });
        expect(updaterId, 'whether the profile has a .updaterId after the launch').toBe(false);
        for (const { headers } of requests) expect(Object.values(headers), 'what the check sent').not.toContain(old);
    } finally {
        await server.close();
    }
});

test('with an adapter chosen, every request of a check and a download comes from its address; with it gone, none reaches the server; with Any, as ever', async () => {
    const server = await startUpdateServer(OFFERS);
    const run = await launch({ updateChannel: 'stable', autoDownloadUpdates: false });
    const { app } = run;
    /** Run this, and answer the requests it made. */
    const asked = async (action) => {
        const before = server.requests.length;
        const answer = await action();
        return { answer, requests: server.requests.slice(before) };
    };
    try {
        // Any interface has never started the service, so it starts with the test's adapters.
        await standInAdapters(app);
        const window = await app.firstWindow();

        // With Any, the check at launch comes as ever.
        await expect.poll(() => server.requests.length, { message: 'the check at launch', timeout: 20_000 }).toBeGreaterThan(0);
        expect(sourcesOf(server.requests), 'where the check at launch came from, with Any').toEqual(['127.0.0.1']);

        await window.getByRole('button', { name: /^Settings/ }).click();
        await window.getByRole('tab', { name: 'Network' }).click();
        await networkSelect(window).selectOption({ label: `${STAND_IN} · ${STAND_IN_ADDRESS}` });
        await expect(networkHelp(window)).toHaveText(/connects only through/);

        const bound = await asked(() => checkForUpdates(window));
        expect(bound.answer.state, 'what the check found').toBe('available');
        expect(bound.requests.map(({ file }) => file), 'what it asked for').toEqual([channelFile]);
        expect(sourcesOf(bound.requests), 'where the check came from').toEqual([STAND_IN_ADDRESS]);
        expect(bound.requests[0].headers['x-user-staging-id'], 'its x-user-staging-id').toBe(FIXED_STAGING_ID);

        // The download goes the same way: the update server has no installer to give it.
        const download = await asked(() => window.evaluate(() => window.kitAPI.downloadUpdate()));
        expect(download.answer.state, 'what became of the download').toBe('error');
        expect(download.requests.filter(({ file }) => !file.endsWith('.yml')).length, 'requests for the installer').toBeGreaterThan(0);
        expect(sourcesOf(download.requests), 'where the download came from').toEqual([STAND_IN_ADDRESS]);

        // Gone: asked, it fails, and nothing reaches the server from anywhere.
        run.setAdapters({});
        await expect(networkHelp(window)).toHaveText(/isn't connected/);
        const gone = await asked(() => checkForUpdates(window));
        expect(gone.answer, 'what became of the check').toMatchObject({ state: 'error', error: 'check' });
        expect(gone.requests, 'requests that reached the server').toEqual([]);

        // Back, it goes through it again.
        run.setAdapters({ [STAND_IN]: STAND_IN_ADDRESS });
        await expect(networkHelp(window)).toHaveText(/connects only through/);
        const back = await asked(() => checkForUpdates(window));
        expect(back.answer.state, 'what the check found').toBe('available');
        expect(sourcesOf(back.requests), 'where the check came from, once it was back').toEqual([STAND_IN_ADDRESS]);

        // Any again: as the app was launched.
        await networkSelect(window).selectOption('');
        await expect(networkHelp(window)).toHaveText(/whichever adapter/);
        const any = await asked(() => checkForUpdates(window));
        expect(any.answer.state, 'what the check found').toBe('available');
        expect(sourcesOf(any.requests), 'where the check came from, with Any again').toEqual(['127.0.0.1']);
    } finally {
        await app.close();
        await server.close();
    }
    checkedAndGone(run);
});

test('a saved adapter holds the check at launch: nothing goes direct, and once the service has it, every request comes from its address', async () => {
    const server = await startUpdateServer(OFFERS);
    const run = await launch({ updateChannel: 'stable', autoDownloadUpdates: false, networkInterface: STAND_IN });
    const { app } = run;
    try {
        await standInAdapters(app);
        // The service started with the launch, on the machine's adapters: killed well before the check at launch, 5 s in. Started again, it has the test's.
        let forked = null;
        await expect.poll(async () => {
            forked = await killService(app);
            return forked !== null;
        }, { message: 'whether the service has started', intervals: [50] }).toBe(true);
        await expect.poll(() => standInsForked(app), { message: 'the service, started again', timeout: 15_000 }).toBeGreaterThan(forked);
        const window = await app.firstWindow();
        await expect.poll(() => window.evaluate(() => window.electronAPI.watchNetwork(false)).then(({ present }) => present), { message: 'whether the service has the adapter', timeout: 15_000 }).toBe(true);

        // However the check at launch fell with all that, it came from the adapter's address or reached nothing.
        await launchCheckDone(window);
        expect((await checkForUpdates(window)).state, 'what the check found').toBe('available');
        expect(server.requests.length, 'requests that reached the server').toBeGreaterThan(0);
        expect(sourcesOf(server.requests), 'where every request came from').toEqual([STAND_IN_ADDRESS]);
    } finally {
        await app.close();
        await server.close();
    }
    expect(resolverJobs(run.netLog), "the host resolver's jobs").toEqual([]);
    checkedAndGone(run);
});

test('a saved adapter that is not there: the check at launch reaches nothing, and says it could not check', async () => {
    const server = await startUpdateServer(OFFERS);
    // The real service, on the machine's adapters: none has this name.
    const run = await launch({ updateChannel: 'stable', autoDownloadUpdates: false, networkInterface: 'Not There' });
    const { app } = run;
    try {
        const window = await app.firstWindow();
        await launchCheckDone(window);
        expect(await updateStatus(window), 'what became of the check').toMatchObject({ state: 'error', error: 'check' });
        expect(server.requests, 'requests that reached the server').toEqual([]);

        await window.getByRole('button', { name: /^Settings/ }).click();
        await window.getByRole('tab', { name: /^Update/ }).click();
        await expect(window.getByRole('tabpanel', { name: /^Update/ }).getByRole('status')).toHaveText("Couldn't check for updates. Try again later.");
    } finally {
        await app.close();
        await server.close();
    }
    expect(resolverJobs(run.netLog), "the host resolver's jobs").toEqual([]);
    checkedAndGone(run);
});

// The same build carries DB-IP's real files in its resources, and flag-icons' flags in
// app.asar, as a person's would. A real address, so a real record: what
// it says is DB-IP's to change, bar Cloudflare's AS number and the shape of the line.
test.describe('the location data the build put in it', () => {
    test.use({ localStun: { address: '127.0.0.2', mapped: { v4: '1.1.1.1' } } });

    test('an External IP gets its flag, country and ISP from the app\'s own resources, with no request for them', async ({ server, stun }) => {
        const run = await launch({});
        const { app } = run;
        try {
            await standInAdapters(app);
            const window = await app.firstWindow();
            await addServer(window, server.baseUrl);
            await window.getByRole('tab', { name: 'Network' }).click();
            await window.getByRole('switch', { name: 'Check my External IP' }).check();

            await expect(window.locator('#connection-ips')).toHaveText('1.1.1.1');
            await expect(window.locator('#connection-meta')).toHaveText(/^[^·]+ · [^·]+ \(AS13335\) · Latency \d+ ms$/);
            const flag = window.locator('#connection-ips img');
            await expect(flag).toHaveAttribute('title', /^[A-Z]{2}$/);
            await expect(flag).toHaveAttribute('src', /^\.\.\/node_modules\/flag-icons\/flags\/4x3\/[a-z]{2}\.svg$/);
            await expect.poll(() => flag.evaluate((image) => image.naturalWidth), { message: "the flag's picture, drawn from app.asar" }).toBeGreaterThan(0);
            expect(stun.requests.length, 'what the STUN server heard').toBe(1);
        } finally {
            await app.close();
        }
        checkedAndGone(run);
    });
});
