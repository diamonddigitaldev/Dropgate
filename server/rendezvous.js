// Dropgate 4's rendezvous for direct transfers: where a sender's device and a
// receiver's find each other and pass the frames that set up their own
// connection, which the server relays without reading.
//
// Each device has one WebSocket at /api/v4/rendezvous, speaking short binary
// messages: a type byte, then fixed fields, big-endian. The sender's socket
// opens a room (CREATE) under its room ID, which a link's secret makes, and
// holds it while the socket is open. Each receiver's attempt has a socket of
// its own: it joins the room by that ID (JOIN), and the sender hears of it
// (ATTEMPT) under a one-byte tag, which then carries that attempt's frames on
// the sender's one socket. Frames go through whole and in order, each way,
// and the server never parses or keeps one: they're sealed, so it couldn't
// read them, and anything it changed would be found.
//
// What the server holds is in memory only, while the sockets are open: the
// room's ID, its public nonce, and each attempt's socket and tag. Nothing is
// written to disk, nothing about a room is logged but that something
// happened, and an address is never kept (the rate limiter, in server.js, has
// counted the upgrade before a socket reaches here).
//
// Codes come later: a sender asking for one is told none is free, and its room
// works by link; a receiver joining by a code's locator is told there's no
// such room.
const { WebSocketServer } = require('ws');

/** The rendezvous's one path. Nothing about a room is ever in its URL. */
const RENDEZVOUS_PATH = '/api/v4/rendezvous';

/** The largest message: a sender's SEND, with the largest frame (1 + 1 + 8,230). */
const MAX_MESSAGE_BYTES = 8232;
/** The largest frame. An empty one is relayed like any other. */
const MAX_FRAME_BYTES = 8230;
/**
 * The most frames each way in one attempt: 4,096 sealed frames, CPace's three
 * messages, an abort and the close.
 */
const MAX_FRAMES_EACH_WAY = 4104;
/** The most attempts by link one room has at once. */
const MAX_LINK_ATTEMPTS = 4;
/** A socket with more than this waiting to be sent to it is closed: a slow reader can't make the server hold data. */
const MAX_UNSENT_BYTES = 1024 * 1024;
/** How often the server pings each socket. */
const PING_INTERVAL_MS = 30_000;
/** A socket the server hasn't heard from (a message or a pong) for this long is closed. */
const SILENT_LIMIT_MS = 60_000;

const ROOM_ID_BYTES = 16;
const ROOM_NONCE_BYTES = 16;
const MAX_CREDENTIAL_BYTES = 8192;

/** The messages' type bytes. */
const TYPE = Object.freeze({
    // From the sender.
    CREATE: 0x01,
    CODE: 0x02,
    RENEW: 0x03,
    SEND: 0x04,
    DROP: 0x05,
    LOCK: 0x06,
    // To the sender.
    CREATED: 0x81,
    CODE_IS: 0x82,
    ATTEMPT: 0x83,
    FRAME_TO_SENDER: 0x84,
    GONE_TO_SENDER: 0x85,
    // From a receiver.
    JOIN: 0x11,
    RECEIVER_SEND: 0x12,
    // To a receiver.
    JOINED: 0x91,
    FRAME_TO_RECEIVER: 0x92,
    GONE_TO_RECEIVER: 0x93,
    // To either, and then the server closes the socket.
    ERROR: 0xff,
});

/** ERROR's codes. */
const ERROR = Object.freeze({
    VERSION_UNSUPPORTED: 1,
    NOT_FOUND: 2,
    BUSY: 3,
    MALFORMED: 4,
    LIMIT: 5,
});

/** How a receiver joins: by a link's room ID, or by a code's locator. */
const BY = Object.freeze({ LINK: 1, CODE: 2 });

/** The close codes the server uses. */
const CLOSE = Object.freeze({
    /** The attempt or room ended (after GONE). */
    NORMAL: 1000,
    /** After MALFORMED. */
    PROTOCOL_ERROR: 1002,
    /** A text message. */
    UNSUPPORTED_DATA: 1003,
    /** After any other ERROR. */
    POLICY_VIOLATION: 1008,
});

/** A credential, when one is sent: RFC 6750's token68. */
const TOKEN68 = /^[A-Za-z0-9\-._~+/]+=*$/;
/** The letters a code's locator is made of, as core's codes are. */
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * The rendezvous, ready for its upgrades.
 * @param {object} opts
 * @param {{ major: number, minor: number }} opts.version - The DGDTP version this server speaks.
 * @param {(level: string, message: string) => void} opts.log - The server's logger.
 */
function createRendezvous({ version, log }) {
    const sockets = new WebSocketServer({
        noServer: true,
        maxPayload: MAX_MESSAGE_BYTES,
        perMessageDeflate: false,
        clientTracking: false,
    });

    /** Every open room, by its ID in hex. */
    const rooms = new Map();
    /** Every connected socket's state. */
    const peers = new Set();

    const message = (...bytes) => Buffer.from(bytes);

    /** Sends to a socket that's still open. One that can't keep up is closed, and its 'close' ends what it held. */
    const send = (peer, bytes) => {
        if (peer.finished || peer.ws.readyState !== peer.ws.OPEN) return;
        peer.ws.send(bytes);
        if (peer.ws.bufferedAmount > MAX_UNSENT_BYTES) peer.ws.terminate();
    };

    /** Tells a socket why it's being closed, then closes it. */
    const fail = (peer, code) => {
        const bytes = code === ERROR.VERSION_UNSUPPORTED
            ? message(TYPE.ERROR, code, version.major, version.minor)
            : message(TYPE.ERROR, code);
        send(peer, bytes);
        peer.ws.close(code === ERROR.MALFORMED ? CLOSE.PROTOCOL_ERROR : CLOSE.POLICY_VIOLATION);
        finish(peer);
    };

    /**
     * Ends an attempt: its tag is free again, and its receiver is told GONE and
     * closed, or given an ERROR. The sender is told GONE unless it asked.
     */
    const endAttempt = (attempt, { tellSender, receiverError = null }) => {
        if (!attempt.live) return;
        attempt.live = false;
        attempt.room.attempts.delete(attempt.tag);
        if (tellSender) send(attempt.room.sender, message(TYPE.GONE_TO_SENDER, attempt.tag));
        const { receiver } = attempt;
        if (receiver.finished) return;
        if (receiverError) return fail(receiver, receiverError);
        send(receiver, message(TYPE.GONE_TO_RECEIVER));
        receiver.ws.close(CLOSE.NORMAL);
        finish(receiver);
    };

    /** Lets go of everything a socket held: a sender's room and its attempts, or a receiver's attempt. Once. */
    const finish = (peer) => {
        if (peer.finished) return;
        peer.finished = true;
        peers.delete(peer);
        if (peer.room) {
            const { room } = peer;
            peer.room = null;
            rooms.delete(room.id);
            for (const attempt of [...room.attempts.values()]) endAttempt(attempt, { tellSender: false });
            log('debug', "A direct transfer's room closed.");
        }
        if (peer.attempt) {
            const { attempt } = peer;
            peer.attempt = null;
            endAttempt(attempt, { tellSender: true });
        }
    };

    /**
     * The next tag for a room's attempt: the first free one after the last
     * given, from 1 to 255 and round again, so a tag just freed isn't given
     * straight back while the sender may still be sending to it. A room has
     * far fewer attempts at once than tags, so one is always free.
     */
    const nextTag = (room) => {
        let tag = room.lastTag;
        do tag = (tag % 255) + 1;
        while (room.attempts.has(tag));
        room.lastTag = tag;
        return tag;
    };

    /** Checks the major in plain, before anything else in CREATE or JOIN: false once the socket has been told. */
    const versionOk = (peer, data) => {
        if (data.length < 2) {
            fail(peer, ERROR.MALFORMED);
            return false;
        }
        // The minor is only passed over: a newer minor adds to the same major.
        if (data[1] !== version.major) {
            fail(peer, ERROR.VERSION_UNSUPPORTED);
            return false;
        }
        return true;
    };

    // CREATE: major (1) ‖ minor (1) ‖ roomId (16) ‖ roomNonce (16) ‖ flags (1) ‖ credential length (2) ‖ credential.
    const CREATE_FIXED_BYTES = 1 + 1 + 1 + ROOM_ID_BYTES + ROOM_NONCE_BYTES + 1 + 2;
    const create = (peer, data) => {
        if (!versionOk(peer, data)) return;
        if (data.length < CREATE_FIXED_BYTES) return fail(peer, ERROR.MALFORMED);
        let at = 3;
        const roomId = data.subarray(at, (at += ROOM_ID_BYTES));
        const roomNonce = data.subarray(at, (at += ROOM_NONCE_BYTES));
        const flags = data[at++];
        const credentialBytes = data.readUInt16BE(at);
        at += 2;
        // Bit 0 asks for a code; the rest are 0.
        if (flags & 0xfe) return fail(peer, ERROR.MALFORMED);
        if (credentialBytes > MAX_CREDENTIAL_BYTES || data.length !== at + credentialBytes) return fail(peer, ERROR.MALFORMED);
        // Nothing asks for a credential yet, so one sent is only checked for its shape, and never kept.
        if (credentialBytes > 0 && !TOKEN68.test(data.toString('latin1', at))) return fail(peer, ERROR.MALFORMED);

        const id = roomId.toString('hex');
        if (rooms.has(id)) return fail(peer, ERROR.BUSY);
        const room = {
            id,
            nonce: Buffer.from(roomNonce),
            sender: peer,
            locked: false,
            attempts: new Map(),
            lastTag: 0,
        };
        rooms.set(id, room);
        peer.role = 'sender';
        peer.room = room;
        log('debug', "A direct transfer's room opened.");
        // No code is ever free yet: the room works by link.
        if (flags & 1) log('debug', 'No code was free.');
        send(peer, message(TYPE.CREATED, 0));
    };

    // JOIN: major (1) ‖ minor (1) ‖ by (1) ‖ roomId (16), or locator length (1) ‖ locator.
    const join = (peer, data) => {
        if (!versionOk(peer, data)) return;
        // Too short for its way of joining is MALFORMED below, as any other wrong length.
        const by = data[3];
        if (by === BY.CODE) {
            const letters = data[4];
            if (data.length !== 5 + letters || (letters !== 2 && letters !== 3)) return fail(peer, ERROR.MALFORMED);
            if ([...data.subarray(5)].some((c) => !CODE_LETTERS.includes(String.fromCharCode(c)))) return fail(peer, ERROR.MALFORMED);
            // No room has a code yet.
            return fail(peer, ERROR.NOT_FOUND);
        }
        if (by !== BY.LINK || data.length !== 4 + ROOM_ID_BYTES) return fail(peer, ERROR.MALFORMED);

        const room = rooms.get(data.toString('hex', 4));
        if (!room) return fail(peer, ERROR.NOT_FOUND);
        if (room.locked) return fail(peer, ERROR.BUSY);
        const byLink = [...room.attempts.values()].filter((a) => a.by === BY.LINK).length;
        if (byLink >= MAX_LINK_ATTEMPTS) return fail(peer, ERROR.BUSY);
        const tag = nextTag(room);

        const attempt = { room, tag, by, receiver: peer, live: true, toSender: 0, toReceiver: 0 };
        room.attempts.set(tag, attempt);
        peer.role = 'receiver';
        peer.attempt = attempt;
        log('debug', 'A receiver joined.');
        // The sender hears of the attempt before any of its frames.
        send(room.sender, message(TYPE.ATTEMPT, tag, by));
        send(peer, Buffer.concat([message(TYPE.JOINED), room.nonce]));
    };

    const fromSender = (peer, data) => {
        const { room } = peer;
        switch (data[0]) {
            case TYPE.SEND: {
                if (data.length < 2) return fail(peer, ERROR.MALFORMED);
                const attempt = room.attempts.get(data[1]);
                // An attempt that has just ended: the sender hears GONE, if it hasn't already.
                if (!attempt) return;
                if (++attempt.toReceiver > MAX_FRAMES_EACH_WAY) return endAttempt(attempt, { tellSender: true, receiverError: ERROR.LIMIT });
                return send(attempt.receiver, Buffer.concat([message(TYPE.FRAME_TO_RECEIVER), data.subarray(2)]));
            }
            case TYPE.DROP: {
                if (data.length !== 2) return fail(peer, ERROR.MALFORMED);
                const attempt = room.attempts.get(data[1]);
                if (attempt) endAttempt(attempt, { tellSender: false });
                return;
            }
            case TYPE.LOCK:
                if (data.length !== 1) return fail(peer, ERROR.MALFORMED);
                room.locked = true;
                return;
            case TYPE.CODE:
                if (data.length !== 1) return fail(peer, ERROR.MALFORMED);
                // No code is ever free yet.
                log('debug', 'No code was free.');
                return send(peer, message(TYPE.CODE_IS, 0));
            case TYPE.RENEW:
                // There's no unused code to keep yet.
                if (data.length !== 1) return fail(peer, ERROR.MALFORMED);
                return;
            default:
                return fail(peer, ERROR.MALFORMED);
        }
    };

    const fromReceiver = (peer, data) => {
        if (data[0] !== TYPE.RECEIVER_SEND || data.length > 1 + MAX_FRAME_BYTES) return fail(peer, ERROR.MALFORMED);
        const { attempt } = peer;
        if (++attempt.toSender > MAX_FRAMES_EACH_WAY) return endAttempt(attempt, { tellSender: true, receiverError: ERROR.LIMIT });
        send(attempt.room.sender, Buffer.concat([message(TYPE.FRAME_TO_SENDER, attempt.tag), data.subarray(1)]));
    };

    const onMessage = (peer, data, isBinary) => {
        if (peer.finished) return;
        peer.heardAt = Date.now();
        if (!isBinary) {
            peer.ws.close(CLOSE.UNSUPPORTED_DATA);
            return finish(peer);
        }
        if (peer.role === 'sender') return fromSender(peer, data);
        if (peer.role === 'receiver') return fromReceiver(peer, data);
        // A socket's first message, and only its first, is CREATE or JOIN.
        if (data[0] === TYPE.CREATE) return create(peer, data);
        if (data[0] === TYPE.JOIN) return join(peer, data);
        return fail(peer, ERROR.MALFORMED);
    };

    const connect = (ws) => {
        const peer = { ws, role: null, room: null, attempt: null, heardAt: Date.now(), finished: false };
        peers.add(peer);
        ws.on('message', (data, isBinary) => onMessage(peer, data, isBinary));
        ws.on('pong', () => { peer.heardAt = Date.now(); });
        ws.on('close', () => finish(peer));
        // A message over the limit, or a broken frame: ws closes the socket itself (1009, 1002 and so on).
        ws.on('error', () => {});
    };

    // Pings keep a socket's proxies from closing it, and find the ones gone silent.
    const heartbeat = setInterval(() => {
        const now = Date.now();
        for (const peer of [...peers]) {
            if (now - peer.heardAt >= SILENT_LIMIT_MS) {
                peer.ws.terminate();
                finish(peer);
            } else if (peer.ws.readyState === peer.ws.OPEN) {
                peer.ws.ping();
            }
        }
    }, PING_INTERVAL_MS);
    heartbeat.unref?.();

    return {
        /** Takes over an upgrade request at the rendezvous's path, once it has been let through. */
        handleUpgrade: (req, socket, head) => sockets.handleUpgrade(req, socket, head, connect),
        /** How much the rendezvous holds right now: counts only. */
        held: () => ({
            sockets: peers.size,
            rooms: rooms.size,
            attempts: [...rooms.values()].reduce((sum, room) => sum + room.attempts.size, 0),
        }),
    };
}

module.exports = { RENDEZVOUS_PATH, createRendezvous };
