// A raw client for the rendezvous: a WebSocket at /api/v4/rendezvous, the
// messages built byte by byte, and what comes back read the same way, so the
// tests check the wire itself rather than anyone's client.
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import WebSocket from 'ws';

export const RENDEZVOUS_PATH = '/api/v4/rendezvous';

export const TYPE = Object.freeze({
    CREATE: 0x01, CODE: 0x02, RENEW: 0x03, SEND: 0x04, DROP: 0x05, LOCK: 0x06,
    CREATED: 0x81, CODE_IS: 0x82, ATTEMPT: 0x83, FRAME_TO_SENDER: 0x84, GONE_TO_SENDER: 0x85, CODE_GONE: 0x86,
    JOIN: 0x11, RECEIVER_SEND: 0x12,
    JOINED: 0x91, FRAME_TO_RECEIVER: 0x92, GONE_TO_RECEIVER: 0x93,
    ERROR: 0xff,
});
export const ERROR = Object.freeze({ VERSION_UNSUPPORTED: 1, NOT_FOUND: 2, BUSY: 3, MALFORMED: 4, LIMIT: 5 });
export const BY = Object.freeze({ LINK: 1, CODE: 2 });

export const MAX_FRAME_BYTES = 8230;
export const MAX_FRAMES_EACH_WAY = 4104;
export const PING_INTERVAL_MS = 30_000;
/** How long a locator that left a room waits before it's handed out again. */
export const QUARANTINE_MS = 5 * 60_000;
/** How long an unused code lasts after its sender last asked for it or renewed it. */
export const RELEASE_MS = 10 * 60_000;
/** The letters a code's locator is made of. */
export const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
/** CPace's first message, from the receiver: the first frame of an attempt by code. */
export const CPACE_MESSAGE1_BYTES = 51;

/** The DGDTP version the server speaks. */
export const VERSION = Object.freeze({ major: 4, minor: 0 });

const bytes = (...parts) => Buffer.concat(parts.map((p) => (typeof p === 'number' ? Buffer.from([p]) : Buffer.from(p))));

/** The messages, as a client sends them. */
export const msg = {
    create: ({ roomId, roomNonce = randomBytes(16), code = false, credential = '', major = VERSION.major, minor = VERSION.minor } = {}) => {
        const length = Buffer.alloc(2);
        length.writeUInt16BE(Buffer.byteLength(credential, 'latin1'));
        return bytes(TYPE.CREATE, major, minor, roomId, roomNonce, code ? 1 : 0, length, Buffer.from(credential, 'latin1'));
    },
    joinByLink: (roomId, { major = VERSION.major, minor = VERSION.minor } = {}) => bytes(TYPE.JOIN, major, minor, BY.LINK, roomId),
    joinByCode: (locator, { major = VERSION.major, minor = VERSION.minor } = {}) =>
        bytes(TYPE.JOIN, major, minor, BY.CODE, locator.length, Buffer.from(locator, 'latin1')),
    send: (tag, frame) => bytes(TYPE.SEND, tag, frame),
    receiverSend: (frame) => bytes(TYPE.RECEIVER_SEND, frame),
    drop: (tag) => bytes(TYPE.DROP, tag),
    lock: () => bytes(TYPE.LOCK),
    code: () => bytes(TYPE.CODE),
    renew: () => bytes(TYPE.RENEW),
};

/**
 * Opens a socket to the rendezvous, keeping every message it's sent in order.
 * @param {{ baseUrl: string }} server
 * @param {object} [opts]
 * @param {boolean} [opts.autoPong] - Answer the server's pings (as every WebSocket does); false for a silent client.
 * @param {Record<string, string>} [opts.headers] - Sent with the upgrade, such as a proxy's X-Forwarded-For.
 * @param {string} [opts.path] - Another path, to see it refused.
 */
export async function connect(server, { autoPong = true, headers = {}, path = RENDEZVOUS_PATH } = {}) {
    const url = `${server.baseUrl.replace(/^http/, 'ws')}${path}`;
    const ws = new WebSocket(url, { autoPong, headers, perMessageDeflate: false, maxPayload: 1024 * 1024 });
    const received = [];
    const waiting = [];
    let closedWith = null;
    const closed = new Promise((resolve) => ws.once('close', (code) => {
        closedWith = { code };
        for (const w of waiting.splice(0)) w.reject(new Error(`The socket closed (${code}) before a message came.`));
        resolve(closedWith);
    }));
    ws.on('message', (data) => {
        const message = Buffer.from(data);
        const next = waiting.shift();
        if (next) next.resolve(message);
        else received.push(message);
    });
    const pings = [];
    ws.on('ping', () => pings.push(Date.now()));
    ws.on('error', () => {});
    await once(ws, 'open');
    return {
        ws,
        pings,
        closed,
        send: (data) => ws.send(data),
        /** The next message, in order. */
        next: ({ timeoutMs = 5000 } = {}) => {
            if (received.length) return Promise.resolve(received.shift());
            if (closedWith) return Promise.reject(new Error(`The socket closed (${closedWith.code}).`));
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('No message came.')), timeoutMs);
                waiting.push({
                    resolve: (m) => { clearTimeout(timer); resolve(m); },
                    reject: (e) => { clearTimeout(timer); reject(e); },
                });
            });
        },
        /** Everything sent to it so far and not yet taken. */
        pending: () => received.splice(0),
        close: () => ws.close(),
    };
}

/**
 * Whether a WebSocket upgrade is refused, with the status and body the server
 * answered (status 0 if it closed the connection without answering), or null
 * if it switched protocols.
 */
export function upgradeRefused(server, { path = RENDEZVOUS_PATH, headers = {} } = {}) {
    return new Promise((resolve) => {
        const req = http.get(`${server.baseUrl}${path}`, {
            headers: {
                Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
                'Sec-WebSocket-Key': randomBytes(16).toString('base64'), ...headers,
            },
        });
        req.on('upgrade', (_res, socket) => {
            socket.destroy();
            resolve(null);
        });
        req.on('response', (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (d) => { body += d; });
            res.on('end', () => resolve({ status: res.statusCode, body }));
            res.on('error', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', () => resolve({ status: 0, body: '' }));
    });
}

/** A CREATED or CODE_IS message's locator, or null for none. */
export function locatorOf(message, type) {
    if (message[0] !== type || message.length !== 2 + message[1]) throw new Error(`Expected ${type.toString(16)}, got ${message.toString('hex')}.`);
    return message[1] === 0 ? null : message.toString('latin1', 2);
}

/**
 * A sender with its room open: CREATE sent and CREATED taken, with the code's
 * locator it was given (null for none). Without a code asked for, CREATED has
 * to carry none.
 */
export async function openRoom(server, { roomId = randomBytes(16), roomNonce = randomBytes(16), code = false, ...opts } = {}) {
    const sender = await connect(server, opts);
    sender.send(msg.create({ roomId, roomNonce, code }));
    const created = await sender.next();
    const locator = locatorOf(created, TYPE.CREATED);
    if (!code && locator !== null) throw new Error(`CREATE was answered ${created.toString('hex')}.`);
    return { sender, roomId, roomNonce, locator };
}

/** The sender asks for a code (CODE), and is told it, or none (null). */
export async function askCode(sender) {
    sender.send(msg.code());
    return locatorOf(await sender.next(), TYPE.CODE_IS);
}

/** A receiver joined to a room by its ID, with the tag the sender was told. */
export async function joinRoom(server, { sender, roomId, roomNonce }, opts = {}) {
    const receiver = await connect(server, opts);
    receiver.send(msg.joinByLink(roomId));
    const joined = await receiver.next();
    if (!joined.equals(bytes(TYPE.JOINED, roomNonce))) throw new Error(`JOIN was answered ${joined.toString('hex')}.`);
    const attempt = await sender.next();
    if (attempt[0] !== TYPE.ATTEMPT || attempt.length !== 3 || attempt[2] !== BY.LINK) throw new Error(`The sender was told ${attempt.toString('hex')}.`);
    return { receiver, tag: attempt[1] };
}

/** A receiver joined to a room by its code's locator, with the tag the sender was told. */
export async function joinByCode(server, { sender, roomNonce, locator }, opts = {}) {
    const receiver = await connect(server, opts);
    receiver.send(msg.joinByCode(locator));
    const joined = await receiver.next();
    if (!joined.equals(bytes(TYPE.JOINED, roomNonce))) throw new Error(`JOIN by ${locator} was answered ${joined.toString('hex')}.`);
    const attempt = await sender.next();
    if (attempt[0] !== TYPE.ATTEMPT || attempt.length !== 3 || attempt[2] !== BY.CODE) throw new Error(`The sender was told ${attempt.toString('hex')}.`);
    return { receiver, tag: attempt[1] };
}

/** An ERROR message's bytes. */
export const errorMessage = (code) => (code === ERROR.VERSION_UNSUPPORTED
    ? Buffer.from([TYPE.ERROR, code, VERSION.major, VERSION.minor])
    : Buffer.from([TYPE.ERROR, code]));

/**
 * Expects a socket to be sent this ERROR and closed with this code (1002 after
 * MALFORMED, 1008 after any other).
 */
export async function expectError(client, code) {
    const message = await client.next();
    const { code: closeCode } = await client.closed;
    return { message: message.toString('hex'), closeCode, expected: { message: errorMessage(code).toString('hex'), closeCode: code === ERROR.MALFORMED ? 1002 : 1008 } };
}

/** The address a proxy says each of runRendezvous()'s sockets came from: its own, so the run has its own rate limit. */
export const RENDEZVOUS_CLIENT_IP = '203.0.113.78';
/** In every frame runRendezvous() sends, so a test can look for it. */
export const FRAME_MARKER = 'zq7FRAMEmarker';
/** runRendezvous()'s credential, which nothing asks for. */
export const RENDEZVOUS_CREDENTIAL = 'zq7RENDEZVOUScredential';

/**
 * A run of everything the rendezvous does, ending with nothing open: rooms by
 * link with and without a code asked for, joins by link and by code, frames
 * each way (empty and the largest), a code used up by its first frame and a
 * later join by it refused, CODE and RENEW, DROP, LOCK (releasing a code) and
 * BUSY, a receiver and a sender leaving, the address's cap on codes reached,
 * and each ERROR (VERSION_UNSUPPORTED, NOT_FOUND by ID and by locator, BUSY,
 * MALFORMED, LIMIT), a text message and one too large.
 * @returns {Promise<{ secrets: Set<string>, locators: Set<string> }>} Every room ID, nonce, address and frame
 * marker it used, as they could be written: hex, base64 and base64url; and every locator it was given, which, at
 * two or three letters, only a whole word in a line can be.
 */
export async function runRendezvous(server) {
    const headers = { 'X-Forwarded-For': RENDEZVOUS_CLIENT_IP, 'User-Agent': 'DropgateTestAgent/1.0' };
    const secrets = new Set([RENDEZVOUS_CLIENT_IP, FRAME_MARKER, RENDEZVOUS_CREDENTIAL, 'QXW']);
    const locators = new Set();
    const note = (b) => {
        for (const encoding of ['hex', 'base64', 'base64url']) secrets.add(Buffer.from(b).toString(encoding).replace(/=+$/, ''));
    };
    const frame = (n) => Buffer.from(`${FRAME_MARKER}-${n}`);
    const ended = async (client) => {
        await client.closed;
    };

    // A room by link, asking for a code, with two receivers.
    const roomId = randomBytes(16);
    const roomNonce = randomBytes(16);
    note(roomId);
    note(roomNonce);
    const sender = await connect(server, { headers });
    sender.send(msg.create({ roomId, roomNonce, code: true, credential: RENDEZVOUS_CREDENTIAL }));
    const locator = locatorOf(await sender.next(), TYPE.CREATED);
    if (!locator) throw new Error("The run's first room was given no code.");
    locators.add(locator);
    const room = { sender, roomId, roomNonce, locator };
    const first = await joinRoom(server, room, { headers });
    const second = await joinRoom(server, room, { headers });
    first.receiver.send(msg.receiverSend(frame(1)));
    first.receiver.send(msg.receiverSend(Buffer.alloc(0)));
    sender.send(msg.send(first.tag, frame(2)));
    sender.send(msg.send(first.tag, Buffer.concat([frame(3), randomBytes(MAX_FRAME_BYTES - 40)])));
    await sender.next();
    await sender.next();
    await first.receiver.next();
    await first.receiver.next();

    // By the code: a receiver who leaves before any frame, which leaves it
    // unused; then one whose first frame, CPace's first message, uses it up, so
    // a later join by it finds nothing.
    const leaver = await joinByCode(server, room, { headers });
    leaver.receiver.close();
    await sender.next();
    const byCode = await joinByCode(server, room, { headers });
    byCode.receiver.send(msg.receiverSend(Buffer.concat([frame(6), randomBytes(CPACE_MESSAGE1_BYTES - frame(6).length)])));
    await sender.next();
    const spent = await connect(server, { headers });
    spent.send(msg.joinByCode(locator));
    await ended(spent);
    sender.send(msg.send(byCode.tag, frame(7)));
    await byCode.receiver.next();

    // A new code, renewed, which LOCK below releases.
    const next = await askCode(sender);
    if (!next) throw new Error("The run's first room was given no second code.");
    locators.add(next);
    sender.send(msg.renew());
    // DROP the second, then LOCK: a late receiver is BUSY.
    sender.send(msg.drop(second.tag));
    await ended(second.receiver);
    sender.send(msg.lock());
    const late = await connect(server, { headers });
    late.send(msg.joinByLink(roomId));
    await ended(late);
    const released = await connect(server, { headers });
    released.send(msg.joinByCode(next));
    await ended(released);

    // The first receiver sends past the limit.
    for (let i = 0; i <= MAX_FRAMES_EACH_WAY; i++) first.receiver.send(msg.receiverSend(frame(4)));
    await ended(first.receiver);
    while ((await sender.next())[0] !== TYPE.GONE_TO_SENDER);

    // A second room, whose receiver leaves, then whose sender leaves with a receiver joined.
    const other = await openRoom(server, { headers });
    note(other.roomId);
    note(other.roomNonce);
    const leaving = await joinRoom(server, other, { headers });
    leaving.receiver.close();
    await other.sender.next();
    const staying = await joinRoom(server, other, { headers });
    other.sender.close();
    await ended(staying.receiver);
    sender.close();
    await ended(sender);

    // Each refusal, on a socket of its own.
    const refused = async (message, opts = {}) => {
        const client = await connect(server, { headers });
        if (opts.text) client.ws.send(message);
        else client.send(message);
        await ended(client);
    };
    const gone = randomBytes(16);
    note(gone);
    await refused(msg.joinByLink(gone));
    await refused(msg.joinByCode('QXW'));
    await refused(msg.create({ roomId: gone, major: 3 }));
    await refused(msg.joinByLink(gone, { major: 5 }));
    await refused(Buffer.from([TYPE.SEND, 1, ...frame(5)]));
    await refused(`{"roomId":"${roomId.toString('hex')}"}`, { text: true });
    await refused(Buffer.alloc(9000));
    const taken = await openRoom(server, { headers });
    note(taken.roomId);
    note(taken.roomNonce);
    await refused(msg.create({ roomId: taken.roomId }));
    taken.sender.close();
    await ended(taken.sender);

    // Rooms from one address, each with a code, until the address has as many as it may.
    const capped = [];
    for (let given = true; given;) {
        const one = await openRoom(server, { headers, code: true });
        note(one.roomId);
        note(one.roomNonce);
        if (one.locator) locators.add(one.locator);
        capped.push(one.sender);
        given = one.locator !== null;
    }
    for (const one of capped) {
        one.close();
        await ended(one);
    }
    return { secrets, locators };
}
