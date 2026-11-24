// The web UI's direct transfer pages: the home page's send, and /p2p, the
// receive page, on core's direct handles.
//
// - A link's page (/p2p#<secret>) asks nothing of anyone until Connect, even
//   left open, and the sender learns someone is there only then; the files'
//   names and sizes show only once connected.
// - A code after the # (/p2p#<code>: typed on the home page, or opened as it is)
//   is out of the address before the page asks anything, and connects with
//   no click; it never reaches the server, but for its locator.
// - Pause and Resume from each page, each saying who paused; Cancel each way;
//   Decline; a wrong code, and the sender's new one; no code free.
// - With no usable sink, nothing is accepted, and with none at all the page
//   never connects.
// - A page closed mid-transfer tells the other side it closed, in every
//   engine: core seals that CLOSE with nothing to wait for and sends it first,
//   in the microtask straight after the page's pagehide listener, since a
//   closing Firefox or WebKit page never sees WebCrypto answer, and Firefox
//   gets out only one WebSocket message as the page goes. (Closed within a few
//   milliseconds of the sender's last message to the server, at the very
//   moment of Download, Firefox may still lose it: best effort, DGDTP.md.)
// - The web UI passes core no direct settings; and no frame through the
//   rendezvous holds anything of the connection, an address or a name.
//
// The server offers only the tests' own STUN server (localStun), as in
// parity/direct-transfer.spec.mjs, and every test's requests and storage are
// checked after it (helpers/privacy.mjs).
import fs from 'node:fs';
import { madeUpFile, summary } from '../helpers/files.mjs';
import { secretsOf } from '../helpers/privacy.mjs';
import { expect, savedName, test } from '../helpers/test.mjs';
import { download, openDirectLink, openReceivePage, sendDirectFromHomePage, typeIntoCodeBoxes, typeTheCode, nextCode } from '../helpers/webui.mjs';
import { openRoom } from '../../../server/test/helpers/rendezvous.mjs';

test.use({ localStun: true });

test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit' && process.platform === 'win32', "Playwright's WebKit on Windows has no RTCPeerConnection");
});

const MiB = 1024 * 1024;

/**
 * Make every write into a stream on this context's pages wait `ms` first, as
 * a slow disk would: StreamSaver's writer is the receive page's sink, so the
 * transfer runs at what it takes (each write is one block of 1 MiB), long
 * enough to pause or cancel it part way.
 */
async function slowWrites(context, ms) {
    await context.addInitScript((delay) => {
        const write = WritableStreamDefaultWriter.prototype.write;
        WritableStreamDefaultWriter.prototype.write = async function slowed(chunk) {
            await new Promise((resolve) => setTimeout(resolve, delay));
            return write.call(this, chunk);
        };
    }, ms);
}

/** The receive page's heading and the line under it. */
const receiverSays = async (receiver, title, message) => {
    await expect(receiver.locator('#title')).toHaveText(title, { timeout: 30_000 });
    if (message) await expect(receiver.locator('#message')).toHaveText(message);
};

/** The sending page's progress card: its heading and the line under it. */
const senderShows = async (sender, title, sub) => {
    await expect(sender.locator('#progressTitle')).toHaveText(title, { timeout: 30_000 });
    if (sub) await expect(sender.locator('#progressSub')).toHaveText(sub);
};

/** How the sending page says it ended, on its last card. */
const senderEnded = async (sender, title, sub) => {
    await expect(sender.locator('#shareTitle')).toHaveText(title, { timeout: 30_000 });
    await expect(sender.locator('#shareSub')).toHaveText(sub);
};

/**
 * Send `file` from the home page, open its link as the receiver, Connect, and
 * click Download: the transfer is under way, and the download's promise is
 * returned with the pages.
 */
async function underWay(page, otherContext, file) {
    const sent = await sendDirectFromHomePage(page, [file]);
    const receiver = await otherContext.newPage();
    await openDirectLink(receiver, sent.link);
    await expect(receiver.locator('#download-button')).toBeVisible({ timeout: 30_000 });
    const downloaded = receiver.waitForEvent('download');
    // A test that cancels or closes a page never gets it.
    downloaded.catch(() => undefined);
    await receiver.locator('#download-button').click();
    await receiverSays(receiver, 'Receiving…');
    return { sent, receiver, downloaded };
}

test.describe("a link's page", () => {
    // Every file the receive page loads itself: nothing else, before Connect.
    const PAGE_FILES = new Set([
        '/p2p', '/css/bootstrap-base.css', '/css/download-common.css', '/css/code-input.css', '/vendor/bootstrap/bootstrap.min.css',
        '/vendor/material-icons/round.css', '/vendor/material-icons/material-icons-round.woff2', '/vendor/material-icons/material-icons-round.woff',
        '/vendor/streamsaver/streamsaver.js', '/js/theme.js', '/js/download-p2p.js', '/js/dropgate-core.js', '/js/page-common.js',
        '/js/status-card.js', '/js/code-input.js', '/assets/icon.png', '/assets/favicon.ico', '/manifest.json',
    ]);

    test('asks nothing of anyone until Connect, even 30 s on, shows nothing of the files, and the sender learns of the receiver only after Connect', async ({ page, otherContext, server }) => {
        const file = madeUpFile('Holiday plans (draft).pdf', 200_000, 40);
        const sent = await sendDirectFromHomePage(page, [file]);

        const receiver = await otherContext.newPage();
        const requests = [];
        const sockets = [];
        otherContext.on('request', (request) => requests.push(request.url()));
        receiver.on('websocket', (ws) => sockets.push(ws.url()));
        await receiver.clock.install();
        const before = server.requests().length;
        await openDirectLink(receiver, sent.link, { connect: false });
        // No timer, prefetch or worker asks anything later either.
        await receiver.clock.runFor(30_000);
        await expect(receiver.locator('#connect-button')).toBeVisible();

        const origin = new URL(server.baseUrl).origin;
        const asked = requests.map((url) => new URL(url));
        expect(asked.filter((url) => url.origin !== origin).map(String), 'requests elsewhere').toEqual([]);
        expect(asked.map((url) => url.pathname).filter((path) => !PAGE_FILES.has(path)), "requests that aren't the page's own files").toEqual([]);
        expect(asked.filter((url) => url.search || url.hash).map(String), 'requests with a query or a fragment').toEqual([]);
        expect(sockets, 'WebSockets opened').toEqual([]);
        expect(server.requests().slice(before).map((r) => r.url).filter((url) => url.startsWith('/api')), 'what the server was asked').toEqual([]);
        // The files' names and sizes only come over the connection.
        const text = await receiver.locator('body').innerText();
        expect(text).not.toContain(file.name);
        expect(text).not.toContain('195');
        await expect(page.locator('#p2pWaitTitle')).toHaveText('Awaiting connection…');

        await receiver.locator('#connect-button').click();
        // The secret is out of the address once it's been handed to core.
        await expect.poll(() => receiver.evaluate(() => location.href)).toBe(`${origin}/p2p`);
        await expect(receiver.locator('#file-name')).toHaveText(file.name, { timeout: 30_000 });
        await expect(receiver.locator('#file-size')).toHaveText('195 KB');
        expect(sockets.map((url) => new URL(url).pathname)).toEqual(['/api/v4/rendezvous']);
        await expect(page.locator('#p2pWaitSub')).toHaveText('Connected. Waiting for them to accept.');

        const got = await download(receiver, receiver.locator('#download-button'));
        await receiverSays(receiver, 'Transfer Complete', 'Handed to your browser. Check your downloads.');
        await senderEnded(page, 'Transfer Complete', "Delivered to the receiver's browser.");
        expect(got.name).toBe(savedName(file.name));
        expect(summary(got.bytes)).toEqual(summary(file.buffer));
    });

    test("a link to a transfer that has gone says so after Connect, and Retry tries it again from the page's memory", async ({ page, otherContext }) => {
        const sent = await sendDirectFromHomePage(page, [madeUpFile('gone.bin', 1000, 41)]);
        await page.locator('#cancelP2P').click();
        await expect(page.locator('#codeCard')).toBeVisible();

        const receiver = await otherContext.newPage();
        await openDirectLink(receiver, sent.link);
        await receiverSays(receiver, 'Transfer Failed', 'No transfer has that code or link. It may have ended, or the code was used.');
        await expect(receiver.locator('#retry-button')).toBeVisible();
        expect(new URL(receiver.url()).hash).toBe('');
        await receiver.locator('#retry-button').click();
        await receiverSays(receiver, 'Transfer Failed', 'No transfer has that code or link. It may have ended, or the code was used.');
    });
});

test.describe('a code after the #', () => {
    /**
     * Record, on every page of `context`, where the page was and how long its
     * history was each time it asked anything with fetch() or a WebSocket,
     * and how long its history was as it opened.
     */
    const recordAsks = (context) => context.addInitScript(() => {
        const asks = [];
        Object.defineProperty(window, '__asks', { value: asks });
        Object.defineProperty(window, '__historyAtStart', { value: history.length });
        const fetch = window.fetch;
        window.fetch = function recorded(...args) {
            asks.push({ what: 'fetch', at: location.href, history: history.length });
            return fetch.apply(this, args);
        };
        const Socket = window.WebSocket;
        window.WebSocket = class extends Socket {
            constructor(...args) {
                asks.push({ what: 'WebSocket', at: location.href, history: history.length });
                super(...args);
            }
        };
    });

    test('opened as /p2p#abcd 1234 is out of the address, in its place in history, before the page asks anything, and connects with no click', async ({ page, otherContext, server }) => {
        const file = madeUpFile('Typed in (direct).bin', 300_000, 42);
        const sent = await sendDirectFromHomePage(page, [file]);
        await recordAsks(otherContext);

        const receiver = await otherContext.newPage();
        // As someone might type it into the address bar: lower case, with a space.
        const typed = `${sent.code.slice(0, 4).toLowerCase()} ${sent.code.slice(5)}`;
        await openReceivePage(receiver, `${server.baseUrl}/p2p#${typed}`);
        await expect(receiver.locator('#download-button')).toBeVisible({ timeout: 30_000 });
        await expect(receiver.locator('#file-name')).toHaveText(file.name);

        const { asks, start } = await receiver.evaluate(() => ({ asks: window.__asks, start: window.__historyAtStart }));
        expect(asks.length).toBeGreaterThan(0);
        for (const ask of asks) {
            expect(ask.at, `where the page was at a ${ask.what}`).toBe(`${server.baseUrl}/p2p`);
            // Replaced, not added: the history never grows. (Firefox drops the new tab's blank first entry as the page
            // opens, so it can shrink.)
            expect(ask.history, `the history's length at a ${ask.what}`).toBeLessThanOrEqual(start);
        }

        const got = await download(receiver, receiver.locator('#download-button'));
        await receiverSays(receiver, 'Transfer Complete');
        expect(summary(got.bytes)).toEqual(summary(file.buffer));
    });

    test("a code typed on the home page opens /p2p#<code>, which connects at once; the code is out of the address before anything is asked", async ({ page, otherContext, server }) => {
        const file = madeUpFile('From the home page.bin', 300_000, 43);
        const sent = await sendDirectFromHomePage(page, [file]);
        await recordAsks(otherContext);

        const receiver = await otherContext.newPage();
        await typeTheCode(receiver, server.baseUrl, sent.code);
        await expect(receiver.locator('#download-button')).toBeVisible({ timeout: 30_000 });
        const asks = await receiver.evaluate(() => window.__asks);
        expect(asks.length).toBeGreaterThan(0);
        expect(asks.filter((ask) => ask.at !== `${server.baseUrl}/p2p`), 'asks made with the code in the address').toEqual([]);
        await receiver.locator('#decline-button').click();
        await receiverSays(receiver, 'Transfer Declined', 'You declined the transfer.');
    });

    test("a wrong code fails the receive, and the sender's page shows its new code, which then connects from the receive page's code entry", async ({ page, otherContext, server }) => {
        const sent = await sendDirectFromHomePage(page, [madeUpFile('second try.bin', 1000, 44)]);
        // The same locator, so it reaches the sender's room, with the wrong password.
        const last = Number(sent.code.at(-1));
        const wrong = `${sent.code.slice(0, -1)}${(last + 1) % 10}`;
        const receiver = await otherContext.newPage();
        // It's this test's, so the privacy check looks for it too.
        secretsOf(receiver).addCode(wrong);
        await openReceivePage(receiver, `${server.baseUrl}/p2p#${wrong}`);
        await receiverSays(receiver, 'Transfer Failed');
        await expect(receiver.locator('#code-card')).toBeVisible();
        await expect(receiver.locator('#code-status')).toHaveText('Ask the sender for the code their page shows now.');

        const fresh = await nextCode(page, sent.code);
        await expect(page.locator('#p2pCodeNote')).toHaveText("Someone entered the wrong code. Here's a new one.");
        await expect(page.locator('#p2pWaitTitle')).toHaveText('Awaiting connection…');

        await typeIntoCodeBoxes(receiver, fresh.toLowerCase());
        await expect(receiver.locator('#download-button')).toBeVisible({ timeout: 30_000 });
        await receiver.locator('#decline-button').click();
        await senderEnded(page, 'Transfer Declined', 'The receiver declined the transfer.');
    });
});

test.describe('while it runs', () => {
    test.beforeEach(async ({ otherContext }) => {
        await slowWrites(otherContext, 300);
    });

    test('Pause and Resume from each page: both stop, each says who paused, and the file still arrives whole', async ({ page, otherContext }) => {
        const file = madeUpFile('Paused both ways.bin', 12 * MiB, 45);
        const { receiver, downloaded } = await underWay(page, otherContext, file);

        await receiver.locator('#pause-button').click();
        await receiverSays(receiver, 'Transfer Paused', 'You paused the transfer.');
        await senderShows(page, 'Transfer Paused', 'The receiver paused the transfer.');
        // Each page offers Resume only for its own hold, and Pause only while it holds nothing.
        await expect(receiver.locator('#resume-button')).toBeVisible();
        await expect(receiver.locator('#pause-button')).toBeHidden();
        await expect(page.locator('#resumeStandardUpload')).toBeHidden();
        await expect(page.locator('#pauseStandardUpload')).toBeVisible();

        await page.locator('#pauseStandardUpload').click();
        await senderShows(page, 'Transfer Paused', 'Paused by both of you.');
        await receiverSays(receiver, 'Transfer Paused', 'Paused by both of you.');
        await expect(page.locator('#resumeStandardUpload')).toBeVisible();
        await expect(page.locator('#pauseStandardUpload')).toBeHidden();

        await receiver.locator('#resume-button').click();
        await receiverSays(receiver, 'Transfer Paused', 'The sender paused the transfer.');
        await senderShows(page, 'Transfer Paused', 'You paused the transfer.');
        await expect(receiver.locator('#resume-button')).toBeHidden();
        await expect(receiver.locator('#pause-button')).toBeVisible();

        await page.locator('#resumeStandardUpload').click();
        await receiverSays(receiver, 'Transfer Complete', 'Handed to your browser. Check your downloads.');
        await senderEnded(page, 'Transfer Complete', "Delivered to the receiver's browser.");
        const dl = await downloaded;
        expect(await dl.failure()).toBeNull();
        expect(summary(fs.readFileSync(await dl.path()))).toEqual(summary(file.buffer));
    });

    test('Cancel on the sending page: the receiver reads that the sender cancelled', async ({ page, otherContext }) => {
        const { receiver } = await underWay(page, otherContext, madeUpFile('cancelled by sender.bin', 8 * MiB, 46));
        await page.locator('#cancelP2PSend').click();
        await receiverSays(receiver, 'Transfer Cancelled', 'The sender cancelled the transfer.');
        await expect(page.locator('#codeCard')).toBeVisible();
        await expect(page.locator('#toast-host')).toContainText('Transfer cancelled.');
    });

    test('Cancel on the receive page: the sender reads that the receiver cancelled', async ({ page, otherContext }) => {
        const { receiver } = await underWay(page, otherContext, madeUpFile('cancelled by receiver.bin', 8 * MiB, 47));
        await receiver.locator('#cancel-button').click();
        await receiverSays(receiver, 'Transfer Cancelled', 'You cancelled the transfer.');
        await senderEnded(page, 'Transfer Cancelled', 'The receiver cancelled the transfer.');
    });

    /** Mid-transfer: the receive page's bar has moved, so a block has been saved. */
    const bytesMoved = (receiver) => expect.poll(() => receiver.locator('#bar').evaluate((bar) => bar.style.width), { timeout: 30_000 }).not.toBe('0%');

    test('a receive page closed mid-transfer ends the send, telling the sender the receiver closed Dropgate', async ({ page, otherContext }) => {
        const { receiver } = await underWay(page, otherContext, madeUpFile('closed by receiver.bin', 8 * MiB, 48));
        await bytesMoved(receiver);
        await receiver.close();
        await senderEnded(page, 'Transfer Failed', 'The receiver closed Dropgate before the transfer finished.');
    });

    test('a sending page closed mid-transfer ends the receive, telling the receiver the sender closed Dropgate', async ({ page, otherContext }) => {
        const { receiver } = await underWay(page, otherContext, madeUpFile('closed by sender.bin', 8 * MiB, 49));
        await bytesMoved(receiver);
        await page.close();
        await receiverSays(receiver, 'Transfer Failed', 'The sender closed Dropgate before the transfer finished.');
    });
});

test("a receiver with the right code who leaves before accepting spends the code without being called wrong: the sender's new code shows with no note", async ({ page, otherContext, server }) => {
    const sent = await sendDirectFromHomePage(page, [madeUpFile('left early.bin', 1000, 56)]);
    const receiver = await otherContext.newPage();
    await openReceivePage(receiver, `${server.baseUrl}/p2p#${sent.code}`);
    await expect(receiver.locator('#download-button')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#p2pWaitSub')).toHaveText('Connected. Waiting for them to accept.');
    await receiver.close();

    // Nobody accepted, so the send waits again, with a new code: the old one was spent.
    await expect(page.locator('#p2pWaitTitle')).toHaveText('Awaiting connection…', { timeout: 30_000 });
    const fresh = await nextCode(page, sent.code);
    await expect(page.locator('#p2pCodeNote')).toBeHidden();

    // And a wrong code after that is called wrong.
    const wrong = `${fresh.slice(0, -1)}${(Number(fresh.at(-1)) + 1) % 10}`;
    const guesser = await otherContext.newPage();
    secretsOf(guesser).addCode(wrong);
    await openReceivePage(guesser, `${server.baseUrl}/p2p#${wrong}`);
    await receiverSays(guesser, 'Transfer Failed');
    await nextCode(page, fresh);
    await expect(page.locator('#p2pCodeNote')).toHaveText("Someone entered the wrong code. Here's a new one.");
});

test('Decline on the receive page: nothing is downloaded, and the sender reads that the receiver declined', async ({ page, otherContext }) => {
    const sent = await sendDirectFromHomePage(page, [madeUpFile('declined.bin', 1000, 50)]);
    const receiver = await otherContext.newPage();
    let downloads = 0;
    receiver.on('download', () => downloads++);
    await openDirectLink(receiver, sent.link);
    await expect(receiver.locator('#decline-button')).toBeVisible({ timeout: 30_000 });
    await receiver.locator('#decline-button').click();
    await receiverSays(receiver, 'Transfer Declined', 'You declined the transfer.');
    await senderEnded(page, 'Transfer Declined', 'The receiver declined the transfer.');
    expect(downloads).toBe(0);
});

test.describe('with no usable sink', () => {
    test("StreamSaver missing: a link's page and a code's say so and never connect, and the code isn't spent", async ({ page, otherContext, server }) => {
        const sent = await sendDirectFromHomePage(page, [madeUpFile('nowhere to go.bin', 1000, 51)]);
        await otherContext.route('**/vendor/streamsaver/streamsaver.js', (route) => route.fulfill({ status: 404, body: '' }));
        const sockets = [];
        otherContext.on('page', (p) => p.on('websocket', (ws) => sockets.push(ws.url())));

        const byLink = await otherContext.newPage();
        await openReceivePage(byLink, sent.link);
        await receiverSays(byLink, "Can't Save Here", "This browser can't save the download here.");
        await expect(byLink.locator('#connect-button')).toBeHidden();

        const byCode = await otherContext.newPage();
        await openReceivePage(byCode, `${server.baseUrl}/p2p#${sent.code}`);
        await receiverSays(byCode, "Can't Save Here", "This browser can't save the download here.");
        expect(new URL(byCode.url()).hash, 'the code is out of the address all the same').toBe('');

        expect(sockets, 'WebSockets opened').toEqual([]);
        await expect(page.locator('#p2pCode')).toHaveText(sent.code);
        await expect(page.locator('#p2pWaitTitle')).toHaveText('Awaiting connection…');
    });

    test("a sink that can't be made at Download: nothing is accepted, the page says so, and the sender waits for another receiver, its link still good", async ({ page, otherContext }) => {
        const sent = await sendDirectFromHomePage(page, [madeUpFile('no sink.bin', 1000, 52)]);
        await otherContext.route('**/vendor/streamsaver/streamsaver.js', async (route) => {
            const res = await route.fetch();
            const body = `${await res.text()}\n;streamSaver.createWriteStream = () => { throw new Error('No stream here.'); };\n`;
            await route.fulfill({ response: res, body });
        });
        const receiver = await otherContext.newPage();
        await openDirectLink(receiver, sent.link);
        await expect(receiver.locator('#download-button')).toBeVisible({ timeout: 30_000 });
        await receiver.locator('#download-button').click();
        await receiverSays(receiver, "Can't Save Here", "This browser can't save the download here.");
        // Nothing was accepted, so the send isn't over: anyone else with the link can still take it.
        await expect(page.locator('#p2pWaitTitle')).toHaveText('Awaiting connection…');
        await expect(page.locator('#p2pLink')).toHaveValue(sent.link);
    });
});

test('the web UI passes core no direct settings: the client, the send and the receive each have only their own options', async ({ page, otherContext }) => {
    // Every page's client is made in page-common.js: recorded there, as made and as used.
    const spy = async (context) => context.route('**/js/page-common.js', async (route) => {
        const res = await route.fetch();
        const source = await res.text();
        const made = 'return new DropgateClient(';
        if (!source.includes(made)) throw new Error("page-common.js doesn't make its client as this test expects.");
        const body = `${source.replace(made, 'return spied(')}
function spied(options) {
  const seen = window.__directSpy ?? Object.defineProperty(window, '__directSpy', { value: { clients: [], calls: [] } }).__directSpy;
  seen.clients.push(Object.keys(options));
  const client = new DropgateClient(options);
  const direct = client.direct;
  const wrapped = Object.freeze({
    ...direct,
    send: (o) => { seen.calls.push(['send', Object.keys(o)]); return direct.send(o); },
    receive: (o) => { seen.calls.push(['receive', Object.keys(o)]); return direct.receive(o); },
  });
  return new Proxy(client, { get: (target, key) => (key === 'direct' ? wrapped : Reflect.get(target, key)) });
}
`;
        await route.fulfill({ response: res, body });
    });
    await spy(page.context());
    await spy(otherContext);

    const sent = await sendDirectFromHomePage(page, [madeUpFile('defaults.bin', 1000, 53)]);
    const receiver = await otherContext.newPage();
    await openDirectLink(receiver, sent.link);
    await expect(receiver.locator('#decline-button')).toBeVisible({ timeout: 30_000 });
    await receiver.locator('#decline-button').click();
    await senderEnded(page, 'Transfer Declined', 'The receiver declined the transfer.');

    const sending = await page.evaluate(() => window.__directSpy);
    const receiving = await receiver.evaluate(() => window.__directSpy);
    for (const seen of [sending, receiving]) {
        for (const options of seen.clients) expect(options.sort()).toEqual(['allowInsecure', 'server']);
    }
    expect(sending.calls).toEqual([['send', ['files']]]);
    expect(receiving.calls).toEqual([['receive', ['link']]]);
});

test.describe('with every code held', () => {
    // Each of the server's 576 codes held by a sender of the test's own, from this machine.
    test.use({ serverEnv: { P2P_MAX_CODES_PER_IP: '1000', RATE_LIMIT_MAX_REQUESTS: '0' } });

    test('the sending page shows the link and says no short code is free; the link connects and the transfer completes', async ({ page, otherContext, server }) => {
        const rooms = [];
        try {
            for (let at = 0; at < 576; at += 96) {
                rooms.push(...await Promise.all(Array.from({ length: Math.min(96, 576 - at) }, () => openRoom(server, { code: true }))));
            }
            expect(rooms.every((room) => room.locator !== null), 'every code held').toBe(true);

            const file = madeUpFile('no code free.bin', 300_000, 54);
            const sent = await sendDirectFromHomePage(page, [file], { code: false });
            await expect(page.locator('#p2pCodeNote')).toHaveText('No short code is free right now. The link works, and a code will show here when one frees.');
            await expect(page.locator('#p2pWaitSub')).toHaveText('Share this link with your recipient:');

            const receiver = await otherContext.newPage();
            await openDirectLink(receiver, sent.link);
            await expect(receiver.locator('#download-button')).toBeVisible({ timeout: 30_000 });
            const got = await download(receiver, receiver.locator('#download-button'));
            await receiverSays(receiver, 'Transfer Complete');
            await senderEnded(page, 'Transfer Complete', "Delivered to the receiver's browser.");
            expect(summary(got.bytes)).toEqual(summary(file.buffer));
        } finally {
            for (const room of rooms) room.sender.close();
        }
    });
});

test('nothing that goes through the rendezvous, either way, holds anything of the connection, an address or a name, and no frame is over its cap', async ({ page, otherContext, server }) => {
    const frames = [];
    const record = (p, who) => p.on('websocket', (ws) => {
        ws.on('framesent', ({ payload }) => frames.push({ who, way: 'sent', payload }));
        ws.on('framereceived', ({ payload }) => frames.push({ who, way: 'received', payload }));
    });
    record(page, 'the sender');
    otherContext.on('page', (p) => record(p, 'the receiver'));

    const file = madeUpFile('Rendezvous frames é.bin', 2 * MiB, 55);
    const sent = await sendDirectFromHomePage(page, [file]);
    const receiver = await otherContext.newPage();
    await typeTheCode(receiver, server.baseUrl, sent.code);
    await expect(receiver.locator('#download-button')).toBeVisible({ timeout: 30_000 });
    const got = await download(receiver, receiver.locator('#download-button'));
    await receiverSays(receiver, 'Transfer Complete');
    await senderEnded(page, 'Transfer Complete', "Delivered to the receiver's browser.");
    expect(summary(got.bytes)).toEqual(summary(file.buffer));

    expect(frames.filter((f) => f.who === 'the receiver').length, "the receiver's frames").toBeGreaterThan(3);
    expect(frames.filter((f) => f.who === 'the sender').length, "the sender's frames").toBeGreaterThan(3);
    const forbidden = [
        /a=fingerprint/i, /a=ice-ufrag/i, /a=ice-pwd/i, /candidate:/i, /\.local\b/i,
        // An IPv4 address, and an IPv6 one of four groups or more (shorter runs turn up by chance in sealed bytes).
        /\b(?:\d{1,3}\.){3}\d{1,3}\b/, /\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){3,7}\b/i,
    ];
    for (const { who, way, payload } of frames) {
        const bytes = typeof payload === 'string' ? Buffer.from(payload) : Buffer.from(payload);
        // The largest message the rendezvous takes or gives: a frame of 8,230 bytes and its 2-byte header.
        expect(bytes.length, `a message ${who} ${way}`).toBeLessThanOrEqual(8232);
        expect(typeof payload, `a message ${who} ${way} is binary`).not.toBe('string');
        const text = bytes.toString('latin1');
        for (const pattern of forbidden) expect(pattern.test(text), `a message ${who} ${way} matches ${pattern}`).toBe(false);
        expect(text.includes(file.name) || bytes.includes(Buffer.from(file.name)), `a message ${who} ${way} holds the file's name`).toBe(false);
    }
});
