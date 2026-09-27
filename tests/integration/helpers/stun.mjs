// A STUN server of the tests' own, on this machine, for direct transfers.
//
// Browsers ask a STUN server which address their packets come from, and offer
// that address to the other peer as a server-reflexive candidate. This one only
// answers binding requests (RFC 8489), and listens on an IPv4 address of this
// machine, so a browser that asks it learns the address it sent from: one of
// this machine's own. Anything else it's sent is ignored.
import dgram from 'node:dgram';
import { once } from 'node:events';
import zlib from 'node:zlib';

const MAGIC_COOKIE = 0x2112a442;
const BINDING_REQUEST = 0x0001;
const BINDING_SUCCESS = 0x0101;
const XOR_MAPPED_ADDRESS = 0x0020;
const FINGERPRINT = 0x8028;
const FINGERPRINT_XOR = 0x5354554e;
const HEADER = 20;

/** Whether a datagram is a well-formed STUN binding request. */
function isBindingRequest(msg) {
    return msg.length >= HEADER
        && msg.length % 4 === 0
        && msg.readUInt16BE(0) === BINDING_REQUEST
        && msg.readUInt16BE(2) === msg.length - HEADER
        && msg.readUInt32BE(4) === MAGIC_COOKIE;
}

/** A binding success response giving the IPv4 address and port the request came from. */
function bindingResponse(request, { address, port }) {
    const response = Buffer.alloc(HEADER + 12 + 8);
    response.writeUInt16BE(BINDING_SUCCESS, 0);
    response.writeUInt16BE(response.length - HEADER, 2);
    response.writeUInt32BE(MAGIC_COOKIE, 4);
    request.copy(response, 8, 8, HEADER);

    // XOR-MAPPED-ADDRESS: the port and address, each XORed with the magic cookie.
    response.writeUInt16BE(XOR_MAPPED_ADDRESS, HEADER);
    response.writeUInt16BE(8, HEADER + 2);
    response.writeUInt8(0x01, HEADER + 5);
    response.writeUInt16BE(port ^ (MAGIC_COOKIE >>> 16), HEADER + 6);
    const ip = address.split('.').reduce((n, part) => n * 256 + Number(part), 0);
    response.writeUInt32BE((ip ^ MAGIC_COOKIE) >>> 0, HEADER + 8);

    // FINGERPRINT: a CRC-32 of everything before it, with the length already counting it.
    const at = HEADER + 12;
    response.writeUInt16BE(FINGERPRINT, at);
    response.writeUInt16BE(4, at + 2);
    response.writeUInt32BE((zlib.crc32(response.subarray(0, at)) ^ FINGERPRINT_XOR) >>> 0, at + 4);
    return response;
}

/**
 * Start a STUN server on a free UDP port.
 * @param {object} [opts]
 * @param {string} [opts.address] - The IPv4 address to listen on. Loopback, so only this machine can reach it.
 */
export async function startStunServer({ address = '127.0.0.1' } = {}) {
    const socket = dgram.createSocket('udp4');
    /** Every address and port it has given a browser, as "address:port". */
    const answered = [];
    socket.on('message', (msg, from) => {
        if (!isBindingRequest(msg)) return;
        answered.push(`${from.address}:${from.port}`);
        socket.send(bindingResponse(msg, from), from.port, from.address);
    });
    socket.bind(0, address);
    await once(socket, 'listening');

    return {
        /** Its ICE server URL, as the Dropgate server hands it to browsers. */
        url: `stun:${address}:${socket.address().port}`,
        answered,
        stop: () => new Promise((resolve) => socket.close(resolve)),
    };
}
