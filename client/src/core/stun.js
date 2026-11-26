'use strict';

const crypto = require('crypto');
const dgram = require('dgram');
const net = require('net');

// One STUN binding request (RFC 8489), for the External IP: a datagram of 20
// bytes (its type, its length, the magic cookie and a random ID) with nothing
// else in it, and the answer read for the address it came from. It's sent once,
// never again if it's lost: each request tells the STUN server the address, so
// the person's "one request" stays one. Only the peer asked can answer it (the
// socket is connected to it), and only with the ID it was sent.

/** The port a stun: URL means when it names none. */
const STUN_PORT = 3478;

const HEADER_BYTES = 20;
const MAGIC_COOKIE = 0x2112a442;
const BINDING_REQUEST = 0x0001;
const BINDING_SUCCESS = 0x0101;
const MAPPED_ADDRESS = 0x0001;
const XOR_MAPPED_ADDRESS = 0x0020;
const FAMILY_BYTES = Object.freeze({ 1: 4, 2: 16 });

/**
 * Where a stun: URL points: "stun:host", "stun:host:3478", "stun:[::1]:3478".
 * Anything else is no STUN server: a server's answer is only ever a server's.
 * @param {unknown} url
 * @returns {{ host: string, port: number } | null}
 */
function stunTargetOf(url) {
    const found = typeof url === 'string' ? /^stun:(?:\[([^\]]+)\]|([A-Za-z0-9.-]{1,253}))(?::(\d{1,5}))?$/i.exec(url) : null;
    if (!found) return null;
    const [, bracketed, name, port] = found;
    const number = port === undefined ? STUN_PORT : Number(port);
    if (number < 1 || number > 65_535) return null;
    if (bracketed !== undefined && !net.isIPv6(bracketed)) return null;
    return { host: bracketed ?? name, port: number };
}

/**
 * The first stun: URL a server lists, in its ICE servers' shape:
 * [{ urls: 'stun:…' | ['stun:…', 'turn:…'] }]. Null where it lists none.
 * @param {unknown} iceServers
 * @returns {string | null}
 */
function firstStunUrl(iceServers) {
    if (!Array.isArray(iceServers)) return null;
    for (const server of iceServers) {
        for (const url of [server?.urls].flat()) {
            if (stunTargetOf(url)) return url;
        }
    }
    return null;
}

/** A binding request, with its ID: the fixed header and nothing else. */
function bindingRequest(id) {
    const message = Buffer.alloc(HEADER_BYTES);
    message.writeUInt16BE(BINDING_REQUEST, 0);
    message.writeUInt32BE(MAGIC_COOKIE, 4);
    id.copy(message, 8);
    return message;
}

/** An address's text, from its bytes. */
function addressText(bytes) {
    if (bytes.length === 4) return [...bytes].join('.');
    const groups = Array.from({ length: 8 }, (_, group) => bytes.readUInt16BE(group * 2).toString(16));
    // Written the one way URLs write it: "2001:db8::1".
    return new URL(`http://[${groups.join(':')}]`).hostname.slice(1, -1);
}

/**
 * The address a binding response gives, of the family asked: its
 * XOR-MAPPED-ADDRESS, else (a server of the older RFC's) its MAPPED-ADDRESS.
 * Null for anything else: another message, another ID, an address that doesn't
 * fit, or one of the other family.
 * @param {Buffer} message
 * @param {Buffer} id - The 12-byte ID the request was sent with.
 * @param {4 | 6} family
 * @returns {string | null}
 */
function mappedAddress(message, id, family) {
    if (message.length < HEADER_BYTES || message.readUInt16BE(0) !== BINDING_SUCCESS || message.readUInt32BE(4) !== MAGIC_COOKIE) return null;
    if (!message.subarray(8, HEADER_BYTES).equals(id)) return null;
    const end = HEADER_BYTES + message.readUInt16BE(2);
    if (end > message.length) return null;

    let plain = null;
    for (let at = HEADER_BYTES; at + 4 <= end;) {
        const type = message.readUInt16BE(at);
        const length = message.readUInt16BE(at + 2);
        const value = message.subarray(at + 4, at + 4 + length);
        if (value.length !== length || at + 4 + length > end) return null;
        // Attributes are padded to four bytes.
        at += 4 + length + ((4 - (length % 4)) % 4);
        if (type !== XOR_MAPPED_ADDRESS && type !== MAPPED_ADDRESS) continue;
        const bytes = FAMILY_BYTES[value[1]];
        if (bytes !== (family === 4 ? 4 : 16) || length !== 4 + bytes) continue;
        const address = Buffer.from(value.subarray(4));
        if (type === MAPPED_ADDRESS) {
            plain = addressText(address);
            continue;
        }
        // Each byte XORed with the magic cookie and the ID, in order.
        const mask = Buffer.concat([message.subarray(4, 8), id]);
        for (let byte = 0; byte < address.length; byte += 1) address[byte] ^= mask[byte];
        return addressText(address);
    }
    return plain;
}

/**
 * Ask a STUN server, once, which address a request from here comes from.
 * @param {object} options
 * @param {string} options.address - The STUN server's IP address.
 * @param {4 | 6} options.family
 * @param {number} options.port
 * @param {string} [options.local] - The address to send from: none, as the OS routes it.
 * @param {AbortSignal} options.signal - Ends it, with an error, whatever it's waiting for.
 * @returns {Promise<{ ip: string, ms: number }>} The address, and the request's round trip in milliseconds.
 */
function askBinding({ address, family, port, local, signal }) {
    return new Promise((resolve, reject) => {
        const id = crypto.randomBytes(12);
        const socket = dgram.createSocket(family === 6 ? 'udp6' : 'udp4');
        let sent = 0;
        let done = false;
        /** Settled once, and the socket closed once, however many errors it has after that. */
        const finish = (settle, value) => {
            if (done) return;
            done = true;
            signal.removeEventListener('abort', aborted);
            socket.close(() => settle(value));
        };
        const failed = (error) => finish(reject, error);
        const aborted = () => failed(signal.reason);
        socket.on('error', failed);
        socket.on('message', (message) => {
            const ip = mappedAddress(message, id, family);
            if (ip) finish(resolve, { ip, ms: Math.round(performance.now() - sent) });
        });
        if (signal.aborted) return aborted();
        signal.addEventListener('abort', aborted, { once: true });
        socket.bind({ port: 0, ...(local ? { address: local } : {}) }, () => {
            if (done) return;
            socket.connect(port, address, (connectError) => {
                if (done) return;
                if (connectError) return failed(connectError);
                sent = performance.now();
                socket.send(bindingRequest(id));
            });
        });
    });
}

module.exports = { STUN_PORT, askBinding, bindingRequest, firstStunUrl, mappedAddress, stunTargetOf };
