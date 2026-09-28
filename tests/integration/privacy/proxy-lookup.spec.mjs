// Browsers look for a proxy by themselves when the system says to. Windows does
// by default ("Automatically detect settings", as on GitHub's Windows runners):
// the browser asks the network for a WPAD proxy script, over DHCP and by looking
// up the name "wpad" in DNS. That would leave this machine, so the tests stop it,
// and this checks each browser from its own log of what it did:
// - Chromium is launched with --proxy-server=direct:// (playwright.config.mjs),
//   and its net log must show no proxy lookup;
// - Firefox only follows Windows' setting when network.proxy.system_wpad is on,
//   which it isn't by default, and its proxy log must show no WPAD or proxy script.
// The desktop app's own launches are checked after every desktop test
// (helpers/desktop.mjs).
//
// WebKit keeps no log of how it finds a proxy, so it's skipped. On Windows it has
// no proxy auto-detection to run: it only reads the http_proxy and no_proxy
// variables, and Playwright only sets them when told to use a proxy.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { proxyLookups, proxySettings, requestedUrls } from '../helpers/netlog.mjs';
import { expect, test } from '../helpers/test.mjs';

// A hook rather than a file-level test.skip(), whose callback would start and
// stop a server of its own just to be asked.
test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'WebKit keeps no log of how it finds a proxy (see the top of this file)');
});

/**
 * Launch the browser as the project does, with these extra launch options, open
 * a page and close the browser again, so its logs are finished.
 * @param {import('@playwright/test').BrowserType} browserType
 * @param {import('@playwright/test').LaunchOptions} launchOptions - The project's.
 * @param {import('@playwright/test').LaunchOptions} extra
 * @param {string} url
 */
async function openOnce(browserType, launchOptions, extra, url) {
    const browser = await browserType.launch({ ...launchOptions, ...extra, args: [...(launchOptions.args ?? []), ...(extra.args ?? [])] });
    try {
        const page = await browser.newPage();
        await page.goto(url);
    } finally {
        await browser.close();
    }
}

test('the browser never looks for a proxy by itself, so nothing leaves this machine', async ({ browserName, playwright, launchOptions, server }) => {
    const browserType = playwright[browserName];
    const url = `${server.baseUrl}/`;
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dropgate-proxy-test-'));
    try {
        if (browserName === 'chromium') {
            const netLog = path.join(folder, 'netlog.json');
            await openOnce(browserType, launchOptions, { args: [`--log-net-log=${netLog}`] }, url);
            // A log that recorded nothing would show no lookups either.
            expect(requestedUrls(netLog), 'the requests in the net log').toContain(url);
            expect(proxySettings(netLog), 'the proxy settings in the net log').not.toEqual([]);
            expect(proxyLookups(netLog), 'the times Chromium looked for a proxy by itself (its net log)').toEqual([]);
        } else {
            const base = path.join(folder, 'firefox');
            await openOnce(browserType, launchOptions, { env: { ...process.env, MOZ_LOG: 'timestamp,proxy:5', MOZ_LOG_FILE: base } }, url);
            // Firefox adds to the name, and each process writes its own file.
            const lines = fs.readdirSync(folder)
                .filter((name) => name.startsWith('firefox'))
                .flatMap((name) => fs.readFileSync(path.join(folder, name), 'utf8').split(/\r?\n/));
            // A log that recorded nothing would show no lookups either.
            expect(lines.filter((line) => /\/proxy /.test(line)).length, "the lines in Firefox's proxy log").toBeGreaterThan(0);
            // With the system's settings, Firefox always enters AsyncConfigureWPADOrFromPAC. It only
            // looks when that goes on to WPAD (over DHCP, then DNS) or to a proxy script's address.
            expect(lines.filter((line) => /nsPACMan::ConfigureWPAD|GetPACFromDHCP|DHCP option 252|LoadPACFromURI/.test(line)),
                "the times Firefox looked for a proxy by itself (its proxy log)").toEqual([]);
        }
    } finally {
        fs.rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
    }
});
