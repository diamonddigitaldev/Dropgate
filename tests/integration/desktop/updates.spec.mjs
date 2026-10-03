// The packaged desktop app checking for updates (09 13.11, and the update dot).
// The updater is electron-kit's, and only runs in a packaged app, so these run
// against a test build whose update address is this machine
// (helpers/update-server.mjs), named in DROPGATE_PACKAGED_APP: in CI, the
// Windows build's unpacked app, and the Linux build's AppImage.
//
// v3's updater sent a random ID of the install with every check, kept in the
// profile's .updaterId, so GitHub could link one install's checks across time
// and addresses (PB-D4). The kit sends a fixed value in its place, and makes no
// ID at all. Two new profiles' checks, on each channel, must carry nothing that
// tells them apart or ties them together, and leave no ID behind.
//
// The update server never has the installer it names, so nothing is ever
// downloaded or installed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from '@playwright/test';
import { expect, test } from '../helpers/test.mjs';
import { outsideLookups, proxyLookups } from '../helpers/netlog.mjs';
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
 * Launch the packaged app with a new profile holding these settings, wait for
 * its check at launch (5 s in), and quit.
 * @param {Record<string, unknown>} settings
 * @param {{ requests: { file: string }[] }} server
 * @param {(window: import('@playwright/test').Page) => Promise<void>} [whileOpen]
 */
async function runOnce(settings, server, whileOpen) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dropgate-update-test-'));
    const profile = path.join(root, 'profile');
    fs.mkdirSync(profile);
    // The kit's own store, at its settings' version, so the person's choices are in place from the start.
    fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({ settings, settingsSchema: 1 }));
    const netLog = path.join(root, 'netlog.json');
    const env = { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    const before = server.requests.length;
    const app = await electron.launch({
        executablePath: APP,
        args: [`--user-data-dir=${profile}`, '--no-proxy-server', `--log-net-log=${netLog}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
        env,
    });
    try {
        const window = await app.firstWindow();
        await expect.poll(() => server.requests.length - before, { message: 'the check at launch', timeout: 20_000 }).toBeGreaterThan(0);
        await whileOpen?.(window);
    } finally {
        await app.close();
    }
    const requests = server.requests.slice(before);
    const updaterId = fs.existsSync(path.join(profile, '.updaterId'));
    expect(proxyLookups(netLog), 'the times the app looked for a proxy by itself').toEqual([]);
    expect(outsideLookups(netLog), 'the names the app looked up beyond this machine').toEqual([]);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    return { requests, updaterId };
}

test.beforeEach(() => fs.rmSync(CACHE, { recursive: true, force: true }));
test.afterAll(() => fs.rmSync(CACHE, { recursive: true, force: true }));

for (const channel of ['stable', 'beta', 'alpha']) {
    test(`on ${channel}, two new installs' update checks carry no ID of either, and leave none in the profile (09 13.11)`, async () => {
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
