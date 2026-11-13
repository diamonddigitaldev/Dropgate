// A STUN server of the tests' own, on this machine, for direct transfers and the
// desktop app's External IP.
//
// Browsers ask a STUN server which address their packets come from, and offer
// that address to the other peer as a server-reflexive candidate. This one only
// answers binding requests (RFC 8489), and listens on an address of this
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

/** An address's bytes, IPv4 or IPv6. */
function addressBytes(address) {
    if (!address.includes(':')) return Buffer.from(address.split('.').map(Number));
    const [head, tail = ''] = address.split('::');
    const groups = (part) => (part ? part.split(':') : []);
    const missing = 8 - groups(head).length - groups(tail).length;
    const all = [...groups(head), ...Array(address.includes('::') ? missing : 0).fill('0'), ...groups(tail)];
    return Buffer.from(all.flatMap((group) => [parseInt(group, 16) >> 8, parseInt(group, 16) & 0xff]));
}

/** A binding success response giving an address (IPv4 or IPv6) and a port. */
export function bindingResponse(request, { address, port }) {
    const bytes = addressBytes(address);
    const response = Buffer.alloc(HEADER + 4 + 4 + bytes.length + 8);
    response.writeUInt16BE(BINDING_SUCCESS, 0);
    response.writeUInt16BE(response.length - HEADER, 2);
    response.writeUInt32BE(MAGIC_COOKIE, 4);
    request.copy(response, 8, 8, HEADER);

    // XOR-MAPPED-ADDRESS: the port XORed with the magic cookie; the address with the cookie and the transaction ID.
    response.writeUInt16BE(XOR_MAPPED_ADDRESS, HEADER);
    response.writeUInt16BE(4 + bytes.length, HEADER + 2);
    response.writeUInt8(bytes.length === 4 ? 0x01 : 0x02, HEADER + 5);
    response.writeUInt16BE(port ^ (MAGIC_COOKIE >>> 16), HEADER + 6);
    const mask = response.subarray(4, HEADER);
    bytes.forEach((byte, index) => response.writeUInt8(byte ^ mask[index], HEADER + 8 + index));

    // FINGERPRINT: a CRC-32 of everything before it, with the length already counting it.
    const at = HEADER + 8 + bytes.length;
    response.writeUInt16BE(FINGERPRINT, at);
    response.writeUInt16BE(4, at + 2);
    response.writeUInt32BE((zlib.crc32(response.subarray(0, at)) ^ FINGERPRINT_XOR) >>> 0, at + 4);
    return response;
}

/**
 * Start a STUN server on a free UDP port.
 * @param {object} [opts]
 * @param {string} [opts.address] - The IPv4 address to listen on. Loopback, so only this machine can reach it.
 * @param {string} [opts.address6] - An IPv6 address to listen on too, at the same port.
 * @param {string} [opts.name] - The name its URL gives, in place of its address.
 * @param {{ v4?: string, v6?: string }} [opts.mapped] - The addresses it gives, in place of where each request came from: a test can tell an answer from the adapter's own address. Changeable.
 * @param {boolean} [opts.silent] - It hears, and never answers.
 */
export async function startStunServer({ address = '127.0.0.1', address6, name, mapped: given = {}, silent = false } = {}) {
    /** Each server's own: a test changing its answers leaves the options it was started with alone. */
    const mapped = { ...given };
    /** Every address and port it has given a browser, as "address:port". */
    const answered = [];
    /** Each request's source, with its family, and the bytes it was. */
    const requests = [];
    const listen = (socket, family) => socket.on('message', (msg, from) => {
        if (!isBindingRequest(msg)) return;
        requests.push({ family, source: from.address, bytes: Buffer.from(msg) });
        if (silent) return;
        const answer = mapped[family === 6 ? 'v6' : 'v4'];
        answered.push(`${from.address}:${from.port}`);
        socket.send(bindingResponse(msg, answer ? { address: answer, port: from.port } : from), from.port, from.address);
    });
    const socket = listen(dgram.createSocket('udp4'), 4);
    socket.bind(0, address);
    await once(socket, 'listening');
    const { port } = socket.address();
    const socket6 = address6 ? listen(dgram.createSocket('udp6'), 6) : null;
    if (socket6) {
        socket6.bind(port, address6);
        await once(socket6, 'listening');
    }

    return {
        /** Its ICE server URL, as the Dropgate server hands it to browsers. */
        url: `stun:${name ?? address}:${port}`,
        port,
        answered,
        requests,
        mapped,
        stop: async () => {
            await new Promise((resolve) => socket.close(resolve));
            if (socket6) await new Promise((resolve) => socket6.close(resolve));
        },
    };
}
