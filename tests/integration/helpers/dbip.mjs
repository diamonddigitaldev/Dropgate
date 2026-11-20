// A stand-in for db-ip.com's downloads, on this machine, for the location data's
// monthly refresh: the network service's requests to
// download.db-ip.com are sent here instead (network-stand-in.cjs), over plain
// HTTP, with everything else about them as the service made them (the address
// it bound to, and with an adapter chosen, the address it looked the name up as).
// It serves each month's two files, packed as DB-IP packs them, and writes down
// every request, with the address it came from: nothing leaves the machine.
import { once } from 'node:events';
import http from 'node:http';
import zlib from 'node:zlib';
import { WHOLE, locationDatabases } from '../../../client/test/helpers/mmdb.mjs';

/** DB-IP's name for one month's file, packed. */
export const fileOf = (kind, month) => `dbip-${kind}-lite-${month}.mmdb.gz`;

/**
 * Start it.
 * @param {string} [address] - Another loopback address than the stand-in adapter's (127.0.0.3).
 */
export async function startDbIp(address = '127.0.0.2') {
    /** What it serves, by file name, packed. */
    const files = new Map();
    /** Every request: its path, the address it came from, the host it named, and its headers' names. */
    const requests = [];
    const open = new Set();
    const server = http.createServer((request, response) => {
        requests.push({ path: request.url, from: request.socket.remoteAddress, host: request.headers.host, headers: Object.keys(request.headers).sort() });
        const body = files.get(request.url.replace(/^\/free\//, ''));
        if (!body) {
            response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
            return;
        }
        response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length }).end(body);
    });
    server.on('connection', (socket) => {
        open.add(socket);
        socket.on('close', () => open.delete(socket));
    });
    server.listen(0, address);
    await once(server, 'listening');
    return {
        /** Where the stand-in service sends DB-IP's requests (DROPGATE_TEST_DBIP). */
        url: `http://${address}:${server.address().port}`,
        address,
        requests,
        files,
        /** The files asked for, by name, in order. */
        asked: () => requests.map(({ path }) => path.replace(/^\/free\//, '')),
        /**
         * Serve a month's two files, as whole as DB-IP's, holding these places; either may be replaced by other bytes, packed here.
         * @param {string} month
         * @param {Record<string, object>} places
         * @param {{ country?: Buffer, asn?: Buffer }} [instead]
         */
        serve(month, places, instead = {}) {
            const databases = locationDatabases(places, { month, minNodes: WHOLE });
            for (const kind of ['country', 'asn']) files.set(fileOf(kind, month), zlib.gzipSync(instead[kind] ?? databases[kind]));
        },
        async close() {
            for (const socket of open) socket.destroy();
            await new Promise((resolve) => server.close(resolve));
        },
    };
}
