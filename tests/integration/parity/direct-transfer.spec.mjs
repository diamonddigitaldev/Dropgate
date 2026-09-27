// Parity: a file sent by direct transfer from the home page reaches a receiver
// in another browser context byte for byte, whether they type the code into the
// home page or open the link. Several files sent together arrive as one ZIP.
//
// The server offers no ICE servers (see NO_ICE_SERVERS), so the two peers only
// use this machine's own addresses, and nothing goes to an outside STUN server.
// The request check can't see STUN, which runs over UDP. So each test also checks
// that the server offered none, and that every peer connection that gathered
// candidates had none and found only host candidates.
//
// If the peers never connect, the failure says why, as each page saw it.
import { madeUpFile, readZip, summary } from '../helpers/files.mjs';
import { expect, test } from '../helpers/test.mjs';
import { download, peerConnections, recordPeerConnections, sendDirectFromHomePage, whyNotConnected } from '../helpers/webui.mjs';

// WebKit is left out for now. Playwright's WebKit on Windows has no
// RTCPeerConnection, and on Linux its two peers don't connect when there are
// no ICE servers.
test.skip(({ browserName }) => browserName === 'webkit',
    "WebKit peers don't connect without ICE servers, and Windows WebKit has no RTCPeerConnection");

// Several data channel messages' worth.
const SIZE = 3_000_000;

/** The server's own settings for direct transfer, as it gives them to every page. */
async function expectNoIceServersOffered(page) {
    const info = await (await page.request.get('/api/info')).json();
    expect(info.capabilities.p2p.enabled, 'direct transfer enabled').toBe(true);
    expect(info.capabilities.p2p.iceServers, 'ICE servers the server offers').toEqual([]);
}

/** Every peer connection each page started: the ICE servers it had, and the candidates it found. */
async function expectNoIceServersUsed(...pages) {
    for (const page of pages) {
        const started = await peerConnections(page);
        const where = new URL(page.url()).pathname;
        expect(started?.length, `peer connections started on ${where}`).toBeGreaterThan(0);
        for (const pc of started) {
            expect(pc.iceServers, `ICE servers a peer connection on ${where} had`).toEqual([]);
            expect(pc.candidates.length, `candidates a peer connection on ${where} found`).toBeGreaterThan(0);
            expect(new Set(pc.candidates.map((c) => c.type)), `kinds of candidate a peer connection on ${where} found`).toEqual(new Set(['host']));
        }
    }
}

/** Wait for the receive page to offer what was sent, and if it never does, say why. */
async function expectConnected(receiver, sender) {
    try {
        await expect(receiver.locator('#download-button')).toBeVisible({ timeout: 30_000 });
    } catch (err) {
        const why = await whyNotConnected({ 'The receiver': receiver, 'The sender': sender });
        throw new Error(`${err.message}\n\n${why}`, { cause: err });
    }
}

/** On the receive page: check what's offered, take it, and compare it with what was sent. */
async function receiveAndCompare(receiver, sender, file) {
    await expectConnected(receiver, sender);
    await expect(receiver.locator('#file-name')).toHaveText(file.name);

    const got = await download(receiver, receiver.locator('#download-button'));
    await expect(receiver.locator('#title')).toHaveText(/transfer complete/i);
    await expect(sender.locator('#shareTitle')).toHaveText(/transfer complete/i);

    expect(got.name).toBe(file.name);
    expect(summary(got.bytes)).toEqual(summary(file.buffer));
}

test('a file sent by direct transfer arrives intact when the receiver types the code into the home page', async ({ page, otherContext }) => {
    await recordPeerConnections(page.context());
    await recordPeerConnections(otherContext);
    await expectNoIceServersOffered(page);
    const file = madeUpFile('Sketches (direct) é.bin', SIZE, 30);

    const sent = await sendDirectFromHomePage(page, [file]);

    const receiver = await otherContext.newPage();
    await receiver.goto('/');
    await receiver.locator('#codeInput').fill(sent.code);
    await receiver.locator('#codeGo').click();
    await expect(receiver).toHaveURL(new RegExp(`/p2p/${sent.code}$`));

    await receiveAndCompare(receiver, page, file);
    await expectNoIceServersUsed(page, receiver);
});

test('a file sent by direct transfer arrives intact when the receiver opens the link', async ({ page, otherContext }) => {
    await recordPeerConnections(page.context());
    await recordPeerConnections(otherContext);
    await expectNoIceServersOffered(page);
    const file = madeUpFile('Sketches (linked) é.bin', SIZE, 31);

    const sent = await sendDirectFromHomePage(page, [file]);
    expect(new URL(sent.link).pathname).toBe(`/p2p/${sent.code}`);

    const receiver = await otherContext.newPage();
    await receiver.goto(sent.link);

    await receiveAndCompare(receiver, page, file);
    await expectNoIceServersUsed(page, receiver);
});

test('several files sent together by direct transfer arrive intact as one ZIP', async ({ page, otherContext }) => {
    await recordPeerConnections(page.context());
    await recordPeerConnections(otherContext);
    const files = [
        madeUpFile('plan.txt', 1_000, 32),
        madeUpFile('drawings (rev 3).pdf', 400_000, 33),
        madeUpFile('Maße und Mengen.csv', 1_500_000, 34),
    ];

    const sent = await sendDirectFromHomePage(page, files);

    const receiver = await otherContext.newPage();
    await receiver.goto(sent.link);
    await expectConnected(receiver, page);
    await expect(receiver.locator('#file-name')).toHaveText(String(files.length));

    const zip = await download(receiver, receiver.locator('#download-button'));
    await expect(receiver.locator('#title')).toHaveText(/transfer complete/i);
    await expect(page.locator('#shareTitle')).toHaveText(/transfer complete/i);

    expect(zip.name).toBe(`dropgate-bundle-${sent.code}.zip`);
    const entries = readZip(zip.bytes);
    expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.name));
    for (const [i, file] of files.entries()) {
        expect(summary(entries[i].bytes), `${file.name} in the ZIP`).toEqual(summary(file.buffer));
    }
    await expectNoIceServersUsed(page, receiver);
});
