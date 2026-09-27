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

/**
 * Errors and warnings logged, and errors thrown and not caught, for describePeers():
 * by page, or by context for its service workers.
 */
const consoleLogs = new WeakMap();
const keepLog = (key, line) => {
    if (!consoleLogs.has(key)) consoleLogs.set(key, []);
    consoleLogs.get(key).push(line);
};

/**
 * Keep a record of every RTCPeerConnection in a context: the ICE servers it had,
 * as the browser reports them, the candidates it found and was given, any ICE
 * errors, how its states and data channels changed, and which kinds of message
 * each data channel sent and received (the kind only, never what's in them).
 * Also keep the console errors and warnings of its pages and service workers,
 * and any error they threw and didn't catch. Read the record with
 * peerConnections(), or ask describePeers().
 * @param {import('@playwright/test').BrowserContext} context
 */
export async function recordPeerConnections(context) {
    context.on('console', (msg) => {
        if (msg.type() !== 'error' && msg.type() !== 'warning') return;
        keepLog(msg.page() ?? context, `${msg.type()}: ${msg.text()}`);
    });
    context.on('weberror', (webError) => {
        keepLog(webError.page() ?? context, `uncaught: ${webError.error().message}`);
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
        // Which Dropgate message a data channel message is, from its type field
        // (PeerJS packs { t: 'meta' } as b1 't' b4 'meta'), and nothing else.
        const types = ['hello', 'file_list', 'meta', 'ready', 'chunk_ack', 'chunk', 'file_end_ack', 'file_end',
            'end_ack', 'end', 'ping', 'pong', 'error', 'cancelled', 'resume_ack', 'resume'];
        const kindOf = (data) => {
            if (!(data instanceof ArrayBuffer || ArrayBuffer.isView(data))) return typeof data;
            const bytes = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
            const head = String.fromCharCode(...bytes.subarray(0, 64));
            return types.find((t) => head.includes(`\xb1t${String.fromCharCode(0xb0 + t.length)}${t}`)) ?? 'binary';
        };
        const watch = (channel, note, record) => {
            for (const event of ['open', 'close', 'error']) {
                channel.addEventListener(event, () => note(`data channel ${channel.label} ${event}`));
            }
            const messages = { label: channel.label, sent: [], received: [] };
            record.channels.push(messages);
            channel.addEventListener('message', (e) => messages.received.push(kindOf(e.data)));
            const send = channel.send.bind(channel);
            channel.send = (data) => {
                messages.sent.push(kindOf(data));
                return send(data);
            };
        };
        window.RTCPeerConnection = class extends Native {
            #record = {
                started: false,
                iceServers: [],
                candidates: [],
                remoteCandidates: [],
                errors: [],
                events: [],
                channels: [],
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
                this.addEventListener('datachannel', (e) => watch(e.channel, note, record));
            }

            createDataChannel(...args) {
                const channel = super.createDataChannel(...args);
                watch(channel, this.#note, this.#record);
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
 * @typedef {{ label: string, sent: string[], received: string[] }} ChannelMessages
 * @typedef {{
 *   started: boolean, iceServers: RTCIceServer[], candidates: Candidate[],
 *   remoteCandidates: Candidate[], errors: string[], events: string[], channels: ChannelMessages[],
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
 * What two pages' peers did, as far as each page can tell, for a failed direct
 * transfer test's message: what the page says, what each peer connection found
 * and was given, how its states changed, what its data channels carried, and the
 * console errors of the page and its service workers.
 * @param {Record<string, import('@playwright/test').Page>} pages - Each page, by what to call it.
 */
export async function describePeers(pages) {
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
    // Runs of the same kind of message, in order, with the file data counted
    // apart: "hello, meta, chunk ×46, end (and 229 binary)".
    const runs = (kinds) => {
        const out = [];
        for (const kind of kinds.filter((k) => k !== 'binary')) {
            const last = out.at(-1);
            if (last?.kind === kind) last.n++;
            else out.push({ kind, n: 1 });
        }
        const text = out.map(({ kind, n }) => (n > 1 ? `${kind} ×${n}` : kind)).join(', ') || 'nothing';
        const binary = kinds.length - kinds.filter((k) => k !== 'binary').length;
        return binary ? `${text} (and ${binary} binary)` : text;
    };
    for (const [name, page] of Object.entries(pages)) {
        try {
            lines.push(`${name}, at ${new URL(page.url()).pathname}:`);
            // Each card's heading and the line under it, including cards a later step hid.
            const cards = await page.evaluate(() => [...document.querySelectorAll('.card h5')].map((h) => ({
                text: [h, h.nextElementSibling].map((el) => el?.textContent.trim()).filter(Boolean).join(' / '),
                shown: h.checkVisibility(),
            })));
            const quote = (list) => list.map((c) => `"${c.text}"`).join(', ') || 'nothing';
            lines.push(`  the page says: ${quote(cards.filter((c) => c.shown))}`);
            lines.push(`  and in hidden cards: ${quote(cards.filter((c) => !c.shown))}`);
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
                for (const ch of pc.channels) {
                    lines.push(`    data channel ${ch.label} sent: ${runs(ch.sent)}; received: ${runs(ch.received)}`);
                }
            }
            const logged = consoleLogs.get(page) ?? [];
            if (logged.length) lines.push(`  console: ${logged.slice(-10).join(' | ')}`);
            const workers = consoleLogs.get(page.context()) ?? [];
            if (workers.length) lines.push(`  its service workers' console: ${workers.slice(-10).join(' | ')}`);
        } catch (err) {
            lines.push(`  (couldn't look: ${err.message.split('\n')[0]})`);
        }
    }
    return lines.join('\n');
}
