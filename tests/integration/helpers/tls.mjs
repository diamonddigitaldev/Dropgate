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
 * @param {string} target - The server's base URL, http://127.0.0.1:<port>.
 * @returns {Promise<{ url: string, stop: () => Promise<void> }>}
 */
export async function startTlsProxy(target) {
    const { hostname, port } = new URL(target);
    const proxy = https.createServer(selfSignedCertificate(), (req, res) => {
        const headers = { ...req.headers, 'x-forwarded-proto': 'https' };
        const toServer = http.request({ hostname, port, method: req.method, path: req.url, headers }, (fromServer) => {
            res.writeHead(fromServer.statusCode, fromServer.headers);
            fromServer.pipe(res);
        });
        toServer.on('error', () => res.destroy());
        req.pipe(toServer);
    });
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');

    return {
        url: `https://127.0.0.1:${proxy.address().port}`,
        stop: async () => {
            proxy.closeAllConnections();
            proxy.close();
            await once(proxy, 'close');
        },
    };
}
