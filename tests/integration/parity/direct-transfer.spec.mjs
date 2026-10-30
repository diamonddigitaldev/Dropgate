// Parity: a file sent by direct transfer from the home page reaches a receiver
// in another browser context byte for byte, whether they type the code into the
// home page or open the link. Several files sent together arrive as one ZIP.
//
// The server offers one ICE server: the tests' own STUN server on this machine
// (localStun), so the two peers only use this machine's own addresses, and
// nothing goes to an outside STUN server. The request check can't see STUN,
// which runs over UDP. So each test also checks that the server offered only
// that one, and that every peer connection that gathered candidates had only
// that one, and found only host candidates and server-reflexive ones at this
// machine's own addresses.
//
// No browser may look up the other's addresses under mDNS names (<uuid>.local)
// either, which goes out to the local network. Chromium and Firefox are set up
// to use real addresses (playwright.config.mjs), so neither may find or be given
// such a name. WebKit can't be, so its pages drop the names they're given
// (recordPeerConnections()), and none may reach it.
//
// If the peers never connect, or the transfer fails after they do, the failure
// says what each page saw.
import os from 'node:os';
import { holdsPlaintext, madeUpFile, readZip, summary } from '../helpers/files.mjs';
import { expect, test } from '../helpers/test.mjs';
import { describePeers, download, openReceivePage, peerConnections, receiverReaches, recordPeerConnections, sendDirectFromHomePage } from '../helpers/webui.mjs';

test.use({ localStun: true });

// A hook rather than a file-level test.skip(), whose callback would start and
// stop a server of its own just to be asked.
test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit' && process.platform === 'win32', "Playwright's WebKit on Windows has no RTCPeerConnection");
});

// Several data channel messages' worth.
const SIZE = 3_000_000;

/** The server's own settings for direct transfer, as it gives them to every page. */
async function expectOnlyLocalStunOffered(page, stun) {
    const info = await (await page.request.get('/api/info')).json();
    expect(info.capabilities.p2p.enabled, 'direct transfer enabled').toBe(true);
    expect(info.capabilities.p2p.iceServers, 'ICE servers the server offers').toEqual([{ urls: [stun.url] }]);
}

/** Whether a browser hides its own addresses behind mDNS names whatever it's told (see the top of this file). */
const hidesAddresses = (browserName) => browserName === 'webkit';

/** Record the peer connections in both contexts, with WebKit's dropping the mDNS names it's given. */
async function recordBoth(browserName, ...contexts) {
    for (const context of contexts) await recordPeerConnections(context, { dropMdnsNames: hidesAddresses(browserName) });
}

const isMdnsName = (address) => /\.local\.?$/i.test(address ?? '');

/**
 * Every peer connection each page started: the ICE servers it had, the
 * candidates it found, and those it was given. A server-reflexive candidate is
 * an address the STUN server saw, so it has to be one of this machine's own; so
 * does a host candidate, unless it's hidden behind an mDNS name, which only a
 * browser that can't be told otherwise may give. A browser may never take one.
 */
async function expectOnlyLocalCandidates(stun, browserName, ...pages) {
    const ownAddresses = Object.values(os.networkInterfaces()).flat().map((i) => i?.address);
    for (const page of pages) {
        const started = await peerConnections(page);
        const where = new URL(page.url()).pathname;
        expect(started?.length, `peer connections started on ${where}`).toBeGreaterThan(0);
        for (const pc of started ?? []) {
            expect(pc.iceServers.flatMap((s) => [s.urls].flat()), `ICE servers a peer connection on ${where} had`).toEqual([stun.url]);
            expect(pc.candidates.length, `candidates a peer connection on ${where} found`).toBeGreaterThan(0);
            for (const c of pc.candidates) {
                expect(['host', 'srflx'], `the kind of a candidate a peer connection on ${where} found`).toContain(c.type);
                if (isMdnsName(c.address)) {
                    expect(hidesAddresses(browserName), `a peer connection on ${where} found a ${c.type} candidate under an mDNS name`).toBe(true);
                    continue;
                }
                const at = `a ${c.type} candidate a peer connection on ${where} found, at ${c.address}, is one of this machine's addresses`;
                expect(ownAddresses.includes(c.address), at).toBe(true);
            }
            for (const c of pc.remoteCandidates) {
                if (!isMdnsName(c.address)) continue;
                expect(c.dropped, `a peer connection on ${where} was given a ${c.type} candidate under an mDNS name, and it reached the browser`).toBe(true);
            }
        }
    }
}

/**
 * Run one part of a direct transfer. If it fails, the failure also says what both
 * pages saw, under `heading`.
 */
async function explained(heading, receiver, sender, part) {
    try {
        return await part();
    } catch (err) {
        const seen = await describePeers({ 'The receiver': receiver, 'The sender': sender });
        throw new Error(`${err.message}\n\n${heading}:\n${seen}`, { cause: err });
    }
}

/**
 * Where any of the files' bytes reached the server: the body of a request, or a
 * WebSocket message either page sent. A file sent directly goes from peer to
 * peer, so none should. (Their names are checked after every test, with the keys.)
 */
function bytesSent(server, secrets, files) {
    const sent = [
        ...server.requests().map(({ method, url, body }) => ({ where: `the body of ${method} ${new URL(url, 'http://server').pathname}`, bytes: body })),
        ...secrets.messagesSent.map(({ url, payload }) => ({
            where: `a WebSocket message to ${new URL(url).pathname}`,
            bytes: typeof payload === 'string' ? Buffer.from(payload, 'latin1') : Buffer.from(payload),
        })),
    ];
    const found = [];
    for (const file of files) {
        for (const { where, bytes } of sent) {
            if (bytes?.length && holdsPlaintext(bytes, file.buffer)) found.push(`${file.name}, in ${where}`);
        }
    }
    return found;
}

/** Wait for the receive page to offer what was sent, and if it never does, say why. */
const expectConnected = (receiver, sender) => explained("Why the peers didn't connect", receiver, sender,
    () => expect(receiver.locator('#download-button')).toBeVisible({ timeout: 30_000 }));

/** Take what the receive page offers, and wait for both pages to say the transfer is complete. */
const takeDownload = (receiver, sender) => explained('What the peers did', receiver, sender, async () => {
    const got = await download(receiver, receiver.locator('#download-button'));
    await expect(receiver.locator('#title')).toHaveText(/transfer complete/i);
    await expect(sender.locator('#shareTitle')).toHaveText(/transfer complete/i);
    return got;
});

/**
 * As the receiver, open the home page, type the code and press Go, and wait
 * until the page is at the code's receive page, whether or not Playwright
 * hears either navigation (openReceivePage(), receiverReaches()). Go's click
 * doesn't wait for the navigation it starts, as a click otherwise does: one
 * Playwright never hears commit would hold it until the test runs out.
 */
async function typeTheCode(receiver, server, code, { loseNavigation } = {}) {
    await openReceivePage(receiver, new URL('/', server.baseUrl).href, { loseNavigation, what: 'the home page' });
    await receiver.locator('#codeInput').fill(code);
    await receiver.locator('#codeGo').click({ noWaitAfter: true });
    await receiverReaches(receiver, new URL(`/p2p/${code}`, server.baseUrl).href);
}

/** On the receive page: check what's offered, take it, and compare it with what was sent. */
async function receiveAndCompare(receiver, sender, file) {
    await expectConnected(receiver, sender);
    await expect(receiver.locator('#file-name')).toHaveText(file.name);

    const got = await takeDownload(receiver, sender);
    expect(got.name).toBe(file.name);
    expect(summary(got.bytes)).toEqual(summary(file.buffer));
}

test('a file sent by direct transfer arrives intact when the receiver types the code into the home page, and none of it passes through the server', async ({ page, otherContext, stun, browserName, server, secrets }) => {
    await recordBoth(browserName, page.context(), otherContext);
    await expectOnlyLocalStunOffered(page, stun);
    const file = madeUpFile('Sketches (direct) é.bin', SIZE, 30);

    const sent = await sendDirectFromHomePage(page, [file]);

    const receiver = await otherContext.newPage();
    await typeTheCode(receiver, server, sent.code);

    await receiveAndCompare(receiver, page, file);
    await expectOnlyLocalCandidates(stun, browserName, page, receiver);
    expect(bytesSent(server, secrets, [file]), "the file's bytes the server got").toEqual([]);
});

test('a file sent by direct transfer arrives intact when the receiver opens the link, and none of it passes through the server', async ({ page, otherContext, stun, browserName, server, secrets }) => {
    await recordBoth(browserName, page.context(), otherContext);
    await expectOnlyLocalStunOffered(page, stun);
    const file = madeUpFile('Sketches (linked) é.bin', SIZE, 31);

    const sent = await sendDirectFromHomePage(page, [file]);
    expect(new URL(sent.link).pathname).toBe(`/p2p/${sent.code}`);

    const receiver = await otherContext.newPage();
    await openReceivePage(receiver, sent.link);

    await receiveAndCompare(receiver, page, file);
    await expectOnlyLocalCandidates(stun, browserName, page, receiver);
    expect(bytesSent(server, secrets, [file]), "the file's bytes the server got").toEqual([]);
});

// Now and then on CI's runner, Playwright's Firefox never hears that a
// receiver's navigation committed or loaded, while the page works on. This
// loses it on purpose, so openReceivePage() is shown to carry the receiver's
// checks through it. Run every receiver this way with DROPGATE_TEST_LOSE_NAVIGATION=1.
test("a file sent by direct transfer arrives intact when the receiver opens the link and Playwright never hears the page's navigation finish", async ({ page, otherContext, browserName }) => {
    test.skip(browserName !== 'firefox', 'Only Firefox is seen to lose it, and only its page can be made to');
    const file = madeUpFile('Sketches (lost) é.bin', SIZE, 35);

    const sent = await sendDirectFromHomePage(page, [file]);

    const receiver = await otherContext.newPage();
    await openReceivePage(receiver, sent.link, { loseNavigation: true });
    expect(receiver.url(), "where Playwright's frame thinks the receiver is").toBe('about:blank');

    await receiveAndCompare(receiver, page, file);
});

// The same for a receiver who types the code: Playwright loses the home page's
// navigation, and then the receive page's, once Go is clicked.
test("a file sent by direct transfer arrives intact when the receiver types the code and Playwright never hears either page's navigation finish", async ({ page, otherContext, browserName, server }) => {
    test.skip(browserName !== 'firefox', 'Only Firefox is seen to lose it, and only its page can be made to');
    const file = madeUpFile('Sketches (lost, typed) é.bin', SIZE, 36);

    const sent = await sendDirectFromHomePage(page, [file]);

    const receiver = await otherContext.newPage();
    await typeTheCode(receiver, server, sent.code, { loseNavigation: true });
    expect(receiver.url(), "where Playwright's frame thinks the receiver is").toBe('about:blank');

    await receiveAndCompare(receiver, page, file);
});

test('several files sent together by direct transfer arrive intact as one ZIP, and none of them passes through the server', async ({ page, otherContext, stun, browserName, server, secrets }) => {
    await recordBoth(browserName, page.context(), otherContext);
    const files = [
        madeUpFile('plan.txt', 1_000, 32),
        madeUpFile('drawings (rev 3).pdf', 400_000, 33),
        madeUpFile('Maße und Mengen.csv', 1_500_000, 34),
    ];

    const sent = await sendDirectFromHomePage(page, files);

    const receiver = await otherContext.newPage();
    await openReceivePage(receiver, sent.link);
    await expectConnected(receiver, page);
    await expect(receiver.locator('#file-name')).toHaveText(String(files.length));

    const zip = await takeDownload(receiver, page);
    expect(zip.name).toMatch(/^dropgate-bundle-\d{8}-\d{6}\.zip$/);
    const entries = readZip(zip.bytes);
    expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.name));
    for (const [i, file] of files.entries()) {
        expect(summary(entries[i].bytes), `${file.name} in the ZIP`).toEqual(summary(file.buffer));
    }
    await expectOnlyLocalCandidates(stun, browserName, page, receiver);
    expect(bytesSent(server, secrets, files), "the files' bytes the server got").toEqual([]);
});
