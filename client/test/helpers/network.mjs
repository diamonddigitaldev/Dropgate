// What the network service's tests talk to, all on this machine: a SOCKS5
// client as Chromium's is (no authentication, CONNECT by name, IPv4 or IPv6
// address); a server that records where each connection came from, with a
// page, an endless download and a WebSocket, over HTTP and HTTPS; and a DNS
// responder that records where each query came from.
import { once } from 'node:events';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { selfSignedCertificate } from '../../../tests/integration/helpers/tls.mjs';

/** SOCKS5's address types. */
export const ATYP = Object.freeze({ IPV4: 1, NAME: 3, IPV6: 4 });

/**
 * Open a connection through the proxy. Resolves with the socket and the
 * proxy's reply code (0: open); a refused one's socket is ended by the proxy.
 * @param {number} proxyPort
 * @param {string} host
 * @param {number} port
 * @param {number} [type] - how host is sent: by default a name, as Chromium sends even an IP address
 */
export async function socks(proxyPort, host, port, type = ATYP.NAME) {
    const socket = net.connect({ host: '127.0.0.1', port: proxyPort });
    await once(socket, 'connect');
    let address;
    if (type === ATYP.IPV4) address = Buffer.from(host.split('.').map(Number));
    else if (type === ATYP.IPV6) address = Buffer.from(ipv6Bytes(host));
    else address = Buffer.concat([Buffer.from([Buffer.byteLength(host)]), Buffer.from(host, 'latin1')]);
    const portBytes = Buffer.alloc(2);
    portBytes.writeUInt16BE(port);
    socket.write(Buffer.from([5, 1, 0]));
    socket.write(Buffer.concat([Buffer.from([5, 1, 0, type]), address, portBytes]));
    const replied = await readBytes(socket, 2 + 10);
    if (!replied) return { socket, code: null };
    return { socket, code: replied[3] };
}

/** An IPv6 address's 16 bytes. */
function ipv6Bytes(address) {
    const [head, tail = ''] = address.split('::');
    const groups = (part) => (part ? part.split(':') : []);
    const missing = 8 - groups(head).length - groups(tail).length;
    const all = [...groups(head), ...Array(address.includes('::') ? missing : 0).fill('0'), ...groups(tail)];
    return all.flatMap((group) => [parseInt(group, 16) >> 8, parseInt(group, 16) & 0xff]);
}

/** Read exactly n bytes off a socket, leaving the rest; null if it closes first. */
function readBytes(socket, n) {
    return new Promise((resolve) => {
        let buffered = Buffer.alloc(0);
        const onData = (chunk) => {
            buffered = Buffer.concat([buffered, chunk]);
            if (buffered.length < n) return;
            socket.off('data', onData);
            socket.off('close', onClose);
            socket.pause();
            if (buffered.length > n) socket.unshift(buffered.subarray(n));
            resolve(buffered.subarray(0, n));
        };
        const onClose = () => {
            socket.off('data', onData);
            resolve(null);
        };
        socket.on('data', onData);
        socket.on('close', onClose);
    });
}

/** GET a path over a socket already open to the server (through the proxy), and its whole answer's body. */
export async function get(socket, path, host = 'dropgate.test') {
    socket.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
    socket.resume();
    const chunks = [];
    for await (const chunk of socket) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    return text.slice(text.indexOf('\r\n\r\n') + 4);
}

/** TLS over a socket already open to the server, as Chromium's HTTPS is inside the proxy's tunnel. */
export async function overTls(socket, ca) {
    const secure = tls.connect({ socket, ca, servername: 'localhost', checkServerIdentity: () => undefined });
    await once(secure, 'secureConnect');
    return secure;
}

/** A WebSocket opened over a socket already open to the server: the upgrade done, and its first message read. */
export async function openWebSocket(socket) {
    const key = crypto.randomBytes(16).toString('base64');
    socket.write(`GET /socket HTTP/1.1\r\nHost: dropgate.test\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    // Read with a listener: leaving a for await loop over a socket destroys it.
    const text = await new Promise((resolve) => {
        let read = '';
        const onData = (chunk) => {
            read += chunk.toString('latin1');
            if (!read.includes('\r\n\r\n')) return;
            socket.off('data', onData);
            resolve(read);
        };
        socket.on('data', onData);
        socket.once('close', () => resolve(read));
        socket.resume();
    });
    if (!text.startsWith('HTTP/1.1 101')) throw new Error(`The WebSocket wasn't opened: ${text.split('\r\n')[0]}`);
    return socket;
}

/**
 * A server on one address, over HTTP and HTTPS, recording the source of each
 * connection: /hello answers with that source; /stream never ends; /socket is
 * a WebSocket that sends a message every 50 ms.
 * @param {string} address
 */
export async function startPeer(address) {
    const { key, cert } = selfSignedCertificate();
    /** Each connection's source address, as it came in. */
    const sources = [];
    const open = new Set();
    const handler = (request, response) => {
        if (request.url === '/stream') {
            response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
            const timer = setInterval(() => response.write(Buffer.alloc(1024)), 20);
            response.on('close', () => clearInterval(timer));
            return;
        }
        response.end(request.socket.remoteAddress);
    };
    const upgrade = (request, socket) => {
        const accept = crypto.createHash('sha1').update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
        const timer = setInterval(() => socket.write(Buffer.from([0x81, 2, 0x68, 0x69])), 50);
        socket.on('close', () => clearInterval(timer));
        socket.on('error', () => {});
    };
    const track = (socket) => {
        sources.push(socket.remoteAddress);
        open.add(socket);
        socket.on('close', () => open.delete(socket));
    };
    const plain = http.createServer(handler).on('upgrade', upgrade).on('connection', track);
    const secure = https.createServer({ key, cert }, handler).on('upgrade', upgrade).on('connection', track);
    plain.listen(0, address);
    secure.listen(0, address);
    await Promise.all([once(plain, 'listening'), once(secure, 'listening')]);
    return {
        address,
        port: plain.address().port,
        securePort: secure.address().port,
        ca: cert,
        sources,
        async close() {
            for (const socket of open) socket.destroy();
            await Promise.all([new Promise((resolve) => plain.close(resolve)), new Promise((resolve) => secure.close(resolve))]);
        },
    };
}

/**
 * A DNS responder on one address, answering A queries for the names given,
 * AAAA queries with no address (or the IPv6 one given), and anything else
 * with "no such name"; it records each query's name, type and source.
 * @param {string} address
 * @param {Record<string, string>} names - name to IPv4 address
 * @param {Record<string, string>} [names6] - name to IPv6 address
 */
export async function startDns(address, names, names6 = {}) {
    const socket = dgram.createSocket('udp4');
    const queries = [];
    socket.on('message', (message, from) => {
        let offset = 12;
        const labels = [];
        while (message[offset] !== 0) {
            labels.push(message.subarray(offset + 1, offset + 1 + message[offset]).toString('latin1'));
            offset += 1 + message[offset];
        }
        const name = labels.join('.').toLowerCase();
        const type = message.readUInt16BE(offset + 1);
        const question = message.subarray(12, offset + 5);
        queries.push({ name, type: type === 1 ? 'A' : type === 28 ? 'AAAA' : String(type), source: from.address });
        const known = Object.hasOwn(names, name) || Object.hasOwn(names6, name);
        const answer = type === 1 && names[name] ? Buffer.from(names[name].split('.').map(Number))
            : type === 28 && names6[name] ? Buffer.from(ipv6Bytes(names6[name])) : null;
        const header = Buffer.alloc(12);
        message.copy(header, 0, 0, 2);
        header.writeUInt16BE(0x8180 | (known ? 0 : 3), 2);
        header.writeUInt16BE(1, 4);
        header.writeUInt16BE(answer ? 1 : 0, 6);
        const record = answer ? Buffer.concat([Buffer.from([0xc0, 0x0c]), Buffer.from([0, type, 0, 1, 0, 0, 0, 60, 0, answer.length]), answer]) : Buffer.alloc(0);
        socket.send(Buffer.concat([header, question, record]), from.port, from.address);
    });
    socket.bind(0, address);
    await once(socket, 'listening');
    return {
        server: `${address}:${socket.address().port}`,
        queries,
        close: () => new Promise((resolve) => socket.close(resolve)),
    };
}
