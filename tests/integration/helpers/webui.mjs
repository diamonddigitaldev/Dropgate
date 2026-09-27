// Steps through the web UI's pages, the way a person would.
//
// Checks on page text match loosely (case-insensitive, on the key words), so a
// copy edit doesn't break a test about behaviour.
import fs from 'node:fs';
import { secretsOf } from './privacy.mjs';
import { expect } from './test.mjs';

/**
 * Upload files from the home page and return the share link.
 * @param {import('@playwright/test').Page} page
 * @param {{ name: string, mimeType: string, buffer: Buffer }[]} files
 * @param {object} opts
 * @param {boolean} opts.encrypted - Whether the page should say the upload will be end-to-end encrypted.
 *   When it won't be, the page asks first, and this answers "Upload Anyway".
 * @param {{ value: number, unit: 'minutes' | 'hours' | 'days' }} [opts.lifetime] - Set File Lifetime
 *   first. The page's default is used when this is left out.
 * @param {number} [opts.maxDownloads] - Set Max Downloads first. The page's default is used when this
 *   is left out.
 */
export async function uploadFromHomePage(page, files, { encrypted, lifetime, maxDownloads }) {
    // Without encryption, the server stores the names; with it, it must never see them.
    secretsOf(page).addFiles(files, { storedByServer: !encrypted });
    await page.goto('/');
    await expect(page.locator('#securityText')).toHaveText(encrypted ? /will be end-to-end encrypted/i : /will not be encrypted/i);

    await page.locator('#fileInput').setInputFiles(files);
    if (lifetime) {
        await page.locator('#lifetimeUnit').selectOption(lifetime.unit);
        await page.locator('#lifetimeValue').fill(String(lifetime.value));
    }
    if (maxDownloads !== undefined) {
        await page.locator('#maxDownloadsValue').fill(String(maxDownloads));
    }
    await page.locator('#startBtn').click();
    if (!encrypted) {
        await expect(page.locator('#insecureUploadModal')).toBeVisible();
        await page.locator('#confirmInsecureUpload').click();
    }

    await expect(page.locator('#shareCard')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#shareTitle')).toHaveText(/upload complete/i);
    await expect(page.locator('#shareLink')).toHaveValue(/^http/);
    const link = await page.locator('#shareLink').inputValue();
    secretsOf(page).addLink(link);
    return link;
}

/**
 * Click something that starts a download, wait for the download to finish, and
 * return its suggested name and its bytes.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} trigger
 */
export async function download(page, trigger) {
    const started = page.waitForEvent('download');
    await trigger.click();
    const dl = await started;
    expect(await dl.failure(), 'download failure').toBeNull();
    return { name: dl.suggestedFilename(), bytes: fs.readFileSync(await dl.path()) };
}

/**
 * Open a share link as a fresh page load, and return the response. An encrypted
 * upload's link carries its key after a #, and going to it again while it's
 * already open would only move to that fragment, without loading the page.
 * @param {import('@playwright/test').Page} page
 * @param {string} link
 */
export async function openLink(page, link) {
    await page.goto('about:blank');
    return page.goto(link);
}

/**
 * Open a share link and expect the server's "not found" page, as someone would
 * see it once the upload has gone. The server may take a moment to finish
 * removing it, so the page's status is asked for over HTTP for a few seconds
 * first. Only then is the page loaded, so a slow page load can't use up that time.
 * @param {import('@playwright/test').Page} page
 * @param {string} link
 */
export async function expectGone(page, link) {
    const { pathname } = new URL(link);
    const where = `the page at ${pathname}`;
    // Without the #, so the key stays in the browser.
    await expect.poll(async () => (await page.request.get(pathname)).status(), { message: where, timeout: 5_000 }).toBe(404);
    const response = await openLink(page, link);
    expect(response?.status(), where).toBe(404);
    await expect(page.locator('#status-title')).toHaveText(/not found/i);
}

/**
 * Start a direct transfer from the home page, and return the code and link it
 * gives. The page has to stay open until the receiver has everything.
 * @param {import('@playwright/test').Page} page
 * @param {{ name: string, mimeType: string, buffer: Buffer }[]} files
 */
export async function sendDirectFromHomePage(page, files) {
    // The names only ever go to the other browser.
    secretsOf(page).addFiles(files);
    await page.goto('/');
    // The security note changes once the page has the server's settings.
    await expect(page.locator('#securityText')).not.toHaveText(/checking/i);
    await page.locator('#modeP2P').click();
    await expect(page.locator('#p2pInfo')).toBeVisible();

    await page.locator('#fileInput').setInputFiles(files);
    await page.locator('#startBtn').click();

    await expect(page.locator('#p2pWaitCard')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#p2pCode')).toHaveText(/^[A-Z]{4}-\d{4}$/);
    await expect(page.locator('#p2pLink')).toHaveValue(/\/p2p\//);
    return {
        code: await page.locator('#p2pCode').innerText(),
        link: await page.locator('#p2pLink').inputValue(),
    };
}

/** Errors and warnings each page has logged, for whyNotConnected(). */
const consoleLogs = new WeakMap();

/**
 * Keep a record of every RTCPeerConnection in a context: the ICE servers it had,
 * as the browser reports them, the candidates it found and was given, any ICE
 * errors, and how its states and data channels changed. Also keep each page's
 * console errors and warnings. Read the record with peerConnections(), or ask
 * whyNotConnected().
 * @param {import('@playwright/test').BrowserContext} context
 */
export async function recordPeerConnections(context) {
    context.on('console', (msg) => {
        if (msg.type() !== 'error' && msg.type() !== 'warning') return;
        const page = msg.page();
        if (!page) return;
        if (!consoleLogs.has(page)) consoleLogs.set(page, []);
        consoleLogs.get(page).push(`${msg.type()}: ${msg.text()}`);
    });
    await context.addInitScript(() => {
        const Native = window.RTCPeerConnection;
        if (!Native) return;
        const all = [];
        Object.defineProperty(window, '__peerConnections', { value: all });
        // "candidate:<foundation> <component> <protocol> <priority> <address> <port> typ <type> ..."
        const parse = (sdp) => {
            const [, , protocol, , address, port, , type] = sdp.split(' ');
            return { type, protocol: protocol?.toLowerCase(), address, port: Number(port) };
        };
        const watch = (channel, note) => {
            for (const event of ['open', 'close', 'error']) {
                channel.addEventListener(event, () => note(`data channel ${channel.label} ${event}`));
            }
        };
        window.RTCPeerConnection = class extends Native {
            #record = {
                started: false,
                iceServers: [],
                candidates: [],
                remoteCandidates: [],
                errors: [],
                events: [],
            };
            #note;

            constructor(...args) {
                super(...args);
                const record = this.#record;
                all.push(record);
                const born = performance.now();
                const note = (what) => record.events.push(`${Math.round(performance.now() - born)} ms ${what}`);
                this.#note = note;
                const states = {
                    signalingstatechange: ['signaling', 'signalingState'],
                    icegatheringstatechange: ['ICE gathering', 'iceGatheringState'],
                    iceconnectionstatechange: ['ICE', 'iceConnectionState'],
                    connectionstatechange: ['connection', 'connectionState'],
                };
                for (const [event, [name, state]] of Object.entries(states)) {
                    this.addEventListener(event, () => note(`${name} ${this[state]}`));
                }
                this.addEventListener('icecandidate', (e) => {
                    if (e.candidate?.candidate) record.candidates.push(parse(e.candidate.candidate));
                });
                this.addEventListener('icecandidateerror', (e) => {
                    record.errors.push(`${e.errorCode} ${e.errorText} (${e.url})`);
                });
                this.addEventListener('datachannel', (e) => watch(e.channel, note));
            }

            createDataChannel(...args) {
                const channel = super.createDataChannel(...args);
                watch(channel, this.#note);
                return channel;
            }

            // A peer connection only contacts ICE servers once it gathers candidates,
            // which starts here. One that never gets this far, like PeerJS's own
            // feature check, contacts nothing.
            setLocalDescription(...args) {
                if (!this.#record.started) {
                    this.#record.started = true;
                    this.#record.iceServers = this.getConfiguration().iceServers ?? [];
                }
                return super.setLocalDescription(...args);
            }

            addIceCandidate(candidate, ...rest) {
                if (candidate?.candidate) this.#record.remoteCandidates.push(parse(candidate.candidate));
                return super.addIceCandidate(candidate, ...rest);
            }
        };
    });
}

/**
 * @typedef {{ type: string, protocol: string, address: string, port: number }} Candidate
 * @typedef {{
 *   started: boolean, iceServers: RTCIceServer[], candidates: Candidate[],
 *   remoteCandidates: Candidate[], errors: string[], events: string[],
 * }} PeerConnectionRecord
 */

/**
 * The peer connections recorded on a page by recordPeerConnections() that
 * started gathering candidates, or null if the page has no RTCPeerConnection.
 * @returns {Promise<PeerConnectionRecord[] | null>}
 */
export const peerConnections = async (page) => (await allPeerConnections(page))?.filter((pc) => pc.started) ?? null;

/** @returns {Promise<PeerConnectionRecord[] | null>} */
const allPeerConnections = (page) => page.evaluate(() => /** @type {any} */ (window).__peerConnections ?? null);

/**
 * Why two pages' peers didn't connect, as far as each page can tell: what the
 * page says, what each peer connection found and was given, how its states
 * changed, and the page's console errors. For a failed test's message.
 * @param {Record<string, import('@playwright/test').Page>} pages - Each page, by what to call it.
 */
export async function whyNotConnected(pages) {
    const lines = [];
    const where = (c) => (c.address?.endsWith('.local') ? 'an mDNS name' : c.address);
    const list = (candidates) => {
        const counts = new Map();
        for (const c of candidates) {
            const key = `${c.type} ${c.protocol} ${where(c)}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return [...counts].map(([key, n]) => (n > 1 ? `${key} (×${n})` : key)).join(', ') || 'none';
    };
    for (const [name, page] of Object.entries(pages)) {
        try {
            lines.push(`${name}, at ${new URL(page.url()).pathname}:`);
            const says = await page.evaluate(() => [...document.querySelectorAll('h5')]
                .filter((h) => h.checkVisibility())
                .map((h) => [h, h.nextElementSibling].map((el) => el?.textContent.trim()).filter(Boolean).join(' / ')));
            lines.push(`  the page says: ${says.map((s) => `"${s}"`).join(', ') || 'nothing'}`);
            const pcs = await allPeerConnections(page);
            if (!pcs) lines.push('  it has no RTCPeerConnection');
            for (const [i, pc] of (pcs ?? []).entries()) {
                if (!pc.started) {
                    lines.push(`  peer connection ${i + 1}: never started gathering candidates`);
                    continue;
                }
                const servers = pc.iceServers.flatMap((s) => [s.urls].flat()).join(', ') || 'none';
                lines.push(`  peer connection ${i + 1}, with ICE servers: ${servers}`);
                lines.push(`    its candidates: ${list(pc.candidates)}`);
                lines.push(`    the other peer's candidates: ${list(pc.remoteCandidates)}`);
                if (pc.errors.length) lines.push(`    ICE errors: ${pc.errors.join('; ')}`);
                lines.push(`    what happened: ${pc.events.join(', ') || 'nothing'}`);
            }
            const logged = consoleLogs.get(page) ?? [];
            if (logged.length) lines.push(`  console: ${logged.slice(-10).join(' | ')}`);
        } catch (err) {
            lines.push(`  (couldn't look: ${err.message.split('\n')[0]})`);
        }
    }
    return `Why the peers didn't connect:\n${lines.join('\n')}`;
}
