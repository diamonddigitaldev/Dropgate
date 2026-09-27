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
 * removing it, so this keeps trying for a few seconds.
 * @param {import('@playwright/test').Page} page
 * @param {string} link
 */
export async function expectGone(page, link) {
    await expect(async () => {
        const response = await openLink(page, link);
        expect(response?.status(), `the page at ${new URL(link).pathname}`).toBe(404);
    }).toPass({ timeout: 5_000 });
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
 * Keep a record of every RTCPeerConnection in a context that starts gathering
 * ICE candidates: the ICE servers it had, as the browser reports them, and the
 * type of each candidate it gathered. Read it with peerConnections().
 *
 * A peer connection only contacts ICE servers once it gathers candidates, which
 * starts with setLocalDescription(). One that never gets that far, like PeerJS's
 * own feature check, contacts nothing, so it isn't recorded.
 * @param {import('@playwright/test').BrowserContext} context
 */
export async function recordPeerConnections(context) {
    await context.addInitScript(() => {
        const Native = window.RTCPeerConnection;
        if (!Native) return;
        const started = [];
        Object.defineProperty(window, '__peerConnections', { value: started });
        window.RTCPeerConnection = class extends Native {
            #record = null;
            setLocalDescription(...args) {
                if (!this.#record) {
                    const record = { iceServers: this.getConfiguration().iceServers ?? [], candidateTypes: [] };
                    this.addEventListener('icecandidate', (e) => {
                        if (e.candidate?.candidate) record.candidateTypes.push(e.candidate.type);
                    });
                    started.push(record);
                    this.#record = record;
                }
                return super.setLocalDescription(...args);
            }
        };
    });
}

/**
 * The peer connections recorded on a page by recordPeerConnections().
 * @returns {Promise<{ iceServers: object[], candidateTypes: string[] }[] | null>}
 */
export const peerConnections = (page) => page.evaluate(() => /** @type {any} */ (window).__peerConnections ?? null);
