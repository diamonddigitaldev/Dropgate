// A TLS reverse proxy on this machine, in front of a test server.
//
// The server expects a proxy in front of it to terminate TLS, and the desktop
// app only encrypts an upload when the server's address starts with https://. So
// the desktop tests put this proxy in front of the server, as a real deployment
// would, and point the app at it. It answers on a free port on 127.0.0.1 with a
// self-signed certificate made up on the spot, which the app is told to accept,
// and passes each request to the server with X-Forwarded-Proto: https.
import { once } from 'node:events';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

// Just enough DER to write one certificate.
function der(tag, ...parts) {
    const body = Buffer.concat(parts);
    let length;
    if (body.length < 0x80) length = [body.length];
    else if (body.length < 0x100) length = [0x81, body.length];
    else length = [0x82, body.length >> 8, body.length & 0xff];
    return Buffer.concat([Buffer.from([tag, ...length]), body]);
}
const sequence = (...parts) => der(0x30, ...parts);
function oid(dotted) {
    const [a, b, ...rest] = dotted.split('.').map(Number);
    const bytes = [40 * a + b];
    for (const arc of rest) {
        const groups = [arc & 0x7f];
        for (let v = arc >> 7; v > 0; v >>= 7) groups.unshift(0x80 | (v & 0x7f));
        bytes.push(...groups);
    }
    return der(0x06, Buffer.from(bytes));
}
const utcTime = (date) => der(0x17, Buffer.from(`${date.toISOString().slice(2, 19).replace(/[-T:]/g, '')}Z`));

/**
 * A self-signed certificate for 127.0.0.1 with a new P-256 key, valid for a day.
 * @returns {{ key: string, cert: string }} Both in PEM form.
 */
export function selfSignedCertificate() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const ecdsaWithSha256 = sequence(oid('1.2.840.10045.4.3.2'));
    const name = sequence(der(0x31, sequence(oid('2.5.4.3'), der(0x0c, Buffer.from('127.0.0.1')))));
    // A DER INTEGER, so positive (first byte below 0x80) and with no leading zero
    // byte, which OpenSSL refuses as padding: the first byte is 0x01 to 0x7f.
    const serial = crypto.randomBytes(8);
    serial[0] = (serial[0] & 0x7f) || 0x01;
    const now = Date.now();

    const tbs = sequence(
        der(0xa0, der(0x02, Buffer.from([2]))), // version 3
        der(0x02, serial),
        ecdsaWithSha256,
        name, // issuer
        sequence(utcTime(new Date(now - 60_000)), utcTime(new Date(now + 86_400_000))),
        name, // subject
        publicKey.export({ type: 'spki', format: 'der' }),
        // subjectAltName: IP address 127.0.0.1
        der(0xa3, sequence(sequence(oid('2.5.29.17'), der(0x04, sequence(der(0x87, Buffer.from([127, 0, 0, 1]))))))),
    );
    const signature = crypto.sign('sha256', tbs, privateKey);
    const certificate = sequence(tbs, ecdsaWithSha256, der(0x03, Buffer.from([0]), signature));

    const lines = certificate.toString('base64').match(/.{1,64}/g).join('\n');
    return {
        key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
        cert: `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----\n`,
    };
}

/**
 * Start a TLS proxy in front of a server on this machine.
 *
 * It keeps a record of what it saw, for a failed test's message (describe()):
 * each connection, when its TLS was set up or why it failed, and when it closed;
 * and each request, when it arrived, when it was passed on in full, when the
 * server answered and with what status, and when the answer was sent in full or
 * the connection closed first. Methods, paths, sizes and times only: never a
 * header or a body.
 * @param {string} target - The server's base URL, http://127.0.0.1:<port>.
 * @returns {Promise<{ url: string, describe: (since: number) => string, stop: () => Promise<void> }>}
 */
export async function startTlsProxy(target) {
    const { hostname, port } = new URL(target);
    /** @type {{ n: number, port: number, at: number, tls?: { at: number, protocol: string }, tlsError?: { at: number, message: string }, closed?: number }[]} */
    const connections = [];
    const requests = [];
    // A connection is known by the app's end of it: its port on 127.0.0.1.
    const byPort = new Map();
    const sockets = new Set();
    const connectionOf = (socket) => byPort.get(socket?.remotePort);
    // OpenSSL's messages run to several lines; its reason is the part that says what went wrong.
    const why = (err) => [err.code, err.reason ?? err.message.trim().split('\n')[0]].filter(Boolean).join(': ');

    const proxy = https.createServer(selfSignedCertificate(), (req, res) => {
        const seen = { connection: connectionOf(req.socket)?.n, method: req.method, url: req.url, at: Date.now(), bytesIn: 0, bytesOut: 0 };
        requests.push(seen);
        req.on('data', (chunk) => { seen.bytesIn += chunk.length; });
        req.on('end', () => { seen.receivedAll = Date.now(); });

        const headers = { ...req.headers, 'x-forwarded-proto': 'https' };
        const toServer = http.request({ hostname, port, method: req.method, path: req.url, headers }, (fromServer) => {
            seen.answered = { at: Date.now(), status: fromServer.statusCode };
            res.writeHead(fromServer.statusCode, fromServer.headers);
            fromServer.on('data', (chunk) => { seen.bytesOut += chunk.length; });
            fromServer.pipe(res);
        });
        toServer.on('finish', () => { seen.passedOn = Date.now(); });
        toServer.on('error', (err) => {
            seen.error = { at: Date.now(), message: why(err) };
            res.destroy();
        });
        res.on('close', () => { seen.closed = { at: Date.now(), finished: res.writableFinished }; });
        req.pipe(toServer);
    });
    proxy.on('connection', (socket) => {
        const connection = { n: connections.length + 1, port: socket.remotePort, at: Date.now() };
        connections.push(connection);
        byPort.set(socket.remotePort, connection);
        sockets.add(socket);
        socket.on('close', () => {
            connection.closed = Date.now();
            sockets.delete(socket);
        });
    });
    proxy.on('secureConnection', (socket) => {
        const connection = connectionOf(socket);
        if (connection) connection.tls = { at: Date.now(), protocol: socket.getProtocol() };
    });
    proxy.on('tlsClientError', (err, socket) => {
        const connection = connectionOf(socket) ?? connectionOf(socket?._parent);
        const tlsError = { at: Date.now(), message: why(err) };
        if (connection) connection.tlsError = tlsError;
        else connections.push({ n: connections.length + 1, port: NaN, at: tlsError.at, tlsError });
    });
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');
    const url = `https://127.0.0.1:${proxy.address().port}`;

    return {
        url,
        /**
         * What the proxy saw, one line per connection and one per request, in the
         * order they began, with times in ms from `since`.
         * @param {number} since - A time in ms since 1970.
         */
        describe: (since) => {
            const ms = (at) => `+${at - since} ms`;
            const lines = [];
            for (const c of connections) {
                const what = [];
                if (c.tls) what.push(`TLS set up at ${ms(c.tls.at)} (${c.tls.protocol})`);
                if (c.tlsError) what.push(`TLS failed at ${ms(c.tlsError.at)} (${c.tlsError.message})`);
                if (!c.tls && !c.tlsError) what.push('no TLS set up');
                what.push(c.closed ? `closed at ${ms(c.closed)}` : 'still open');
                const from = Number.isNaN(c.port) ? 'from an unknown port' : `from port ${c.port}`;
                lines.push({ at: c.at, text: `connection ${c.n} opened, ${from}: ${what.join(', ')}` });
            }
            for (const r of requests) {
                const what = [];
                if (r.bytesIn) what.push(`${r.bytesIn} bytes of body`);
                what.push(r.receivedAll ? `all of it received at ${ms(r.receivedAll)}` : 'not all of it received');
                what.push(r.passedOn ? `passed on at ${ms(r.passedOn)}` : 'not passed on in full');
                if (r.error) what.push(`couldn't reach the server at ${ms(r.error.at)} (${r.error.message})`);
                what.push(r.answered ? `the server answered ${r.answered.status} at ${ms(r.answered.at)}` : 'no answer from the server');
                if (r.closed?.finished) what.push(`${r.bytesOut} bytes sent to the app by ${ms(r.closed.at)}`);
                else if (r.closed) what.push(`the connection closed at ${ms(r.closed.at)}, after ${r.bytesOut} bytes of the answer`);
                else what.push(`${r.bytesOut} bytes of the answer sent so far`);
                lines.push({ at: r.at, text: `${r.method} ${r.url} on connection ${r.connection ?? '?'}: ${what.join(', ')}` });
            }
            lines.sort((a, b) => a.at - b.at);
            return lines.map(({ at, text }) => `  ${ms(at)}  ${text}`).join('\n') || '  nothing: no connection was opened';
        },
        stop: async () => {
            // closeAllConnections() only closes connections that got as far as HTTP.
            // One whose TLS never finished would keep close() waiting for good.
            for (const socket of sockets) socket.destroy();
            proxy.closeAllConnections();
            proxy.close();
            await once(proxy, 'close');
        },
    };
}
