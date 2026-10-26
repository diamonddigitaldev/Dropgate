'use strict';

// SOCKS5's server side (RFC 1928), as much of it as Chromium's SOCKS5 client
// uses: no authentication, and CONNECT to a name, an IPv4 address or an IPv6
// address. Chromium sends even an IP address as a name (ATYP 3), so whoever
// reads a request checks a name with net.isIP() before looking it up.

/** The replies a request gets (RFC 1928 §6). */
const REPLY = Object.freeze({
    OK: 0x00,
    FAILURE: 0x01,
    NOT_ALLOWED: 0x02,
    NETWORK_UNREACHABLE: 0x03,
    HOST_UNREACHABLE: 0x04,
    CONNECTION_REFUSED: 0x05,
    COMMAND_NOT_SUPPORTED: 0x07,
    ADDRESS_NOT_SUPPORTED: 0x08,
});

const VERSION = 0x05;
const NO_AUTH = 0x00;
const NO_METHOD = 0xff;
const CONNECT = 0x01;
const ATYP = Object.freeze({ IPV4: 0x01, NAME: 0x03, IPV6: 0x04 });

/** The longest a greeting and a request can be together: 2 + 255 methods, and 4 + 1 + 255 + 2. */
const MOST_BYTES = 257 + 262;

/** A reply to a request, with no bound address of its own to give (0.0.0.0:0). */
function reply(code) {
    return Buffer.from([VERSION, code, 0x00, ATYP.IPV4, 0, 0, 0, 0, 0, 0]);
}

/** An IPv6 address from its 16 bytes, as net.isIP() and net.connect() take it. */
function ipv6Of(bytes) {
    const groups = [];
    for (let i = 0; i < 16; i += 2) groups.push(bytes.readUInt16BE(i).toString(16));
    return groups.join(':');
}

/**
 * Read a client's greeting and its CONNECT request off a socket, answering
 * the greeting. Resolves with where it asks to go and any bytes it sent after
 * the request; or with null once it's been answered with a refusal (no
 * method it offers, a command or address type that isn't CONNECT's, or what
 * isn't SOCKS5) and ended. Nothing is read from the socket after the request.
 * @param {import('net').Socket} socket
 * @returns {Promise<{ host: string, port: number, rest: Buffer } | null>}
 */
function readRequest(socket) {
    return new Promise((resolve) => {
        let buffered = Buffer.alloc(0);
        let greeted = false;
        const finish = (result) => {
            socket.off('data', onData);
            socket.off('close', onClose);
            // Held until it's piped, so nothing it sends next is lost.
            socket.pause();
            resolve(result);
        };
        const refuse = (bytes) => {
            if (bytes) socket.end(bytes);
            else socket.destroy();
            finish(null);
        };
        const onClose = () => finish(null);
        function onData(chunk) {
            buffered = Buffer.concat([buffered, chunk]);
            if (buffered.length > MOST_BYTES) return refuse();
            if (!greeted) {
                if (buffered.length < 2) return;
                if (buffered[0] !== VERSION) return refuse();
                const methods = buffered[1];
                if (buffered.length < 2 + methods) return;
                if (!buffered.subarray(2, 2 + methods).includes(NO_AUTH)) return refuse(Buffer.from([VERSION, NO_METHOD]));
                socket.write(Buffer.from([VERSION, NO_AUTH]));
                buffered = buffered.subarray(2 + methods);
                greeted = true;
            }
            if (buffered.length < 5) return;
            if (buffered[0] !== VERSION) return refuse();
            if (buffered[1] !== CONNECT) return refuse(reply(REPLY.COMMAND_NOT_SUPPORTED));
            const type = buffered[3];
            const length = type === ATYP.IPV4 ? 4 : type === ATYP.IPV6 ? 16 : type === ATYP.NAME ? 1 + buffered[4] : -1;
            if (length < 0) return refuse(reply(REPLY.ADDRESS_NOT_SUPPORTED));
            if (buffered.length < 4 + length + 2) return;
            const address = buffered.subarray(4, 4 + length);
            const host = type === ATYP.IPV4 ? [...address].join('.') : type === ATYP.IPV6 ? ipv6Of(address) : address.subarray(1).toString('latin1');
            const port = buffered.readUInt16BE(4 + length);
            if (host === '' || port === 0) return refuse(reply(REPLY.HOST_UNREACHABLE));
            finish({ host, port, rest: buffered.subarray(4 + length + 2) });
        }
        socket.on('data', onData);
        socket.on('close', onClose);
    });
}

module.exports = { REPLY, ATYP, readRequest, reply };
