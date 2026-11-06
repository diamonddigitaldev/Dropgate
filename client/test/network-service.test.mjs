// The network service, in Node, on this machine only: the adapter is stood
// in by a loopback address (127.0.0.3) that the service is given in its own
// list of adapters, the server is on another (127.0.0.2), so each
// connection's source tells a bound one from any other, and the DNS servers
// are local responders on others again. On Linux the stand-in is named lo,
// so the kernel's real route check (`ip route get … from …`) passes for it;
// elsewhere there's no route check, and its own test stands `ip` in. On
// Linux, with two adapters set up in network namespaces (route-netns.sh, as
// CI does), the last test checks the route check against the kernel itself.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import https from 'node:https';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { afterEach, beforeEach, test as nodeTest } from 'node:test';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { startStunServer } from '../../tests/integration/helpers/stun.mjs';
import { selfSignedCertificate } from '../../tests/integration/helpers/tls.mjs';
import { WHOLE, locationDatabases, mmdb, writeLocationData } from './helpers/mmdb.mjs';
import { ATYP, get, openWebSocket, overTls, socks, startDns, startPeer } from './helpers/network.mjs';

const require = createRequire(import.meta.url);
const { NETWORK_SERVICE } = require('../src/constants.js');
const { NetworkService } = require('../src/core/network-service.js');
const { monthOf, openDatabase } = require('../src/core/location.js');
const { RouteCheck, deviceOf } = require('../src/core/routes.js');
const { addressesOf, adapterList } = require('../src/core/adapters.js');
const { REPLY } = require('../src/core/socks5.js');
const bound = require('../src/core/bound-dns.js');

/** Each test, failing rather than waiting for ever if a connection is never closed or answered. */
const test = (name, ...rest) => nodeTest(name, { timeout: 30_000, ...(rest.length > 1 ? rest[0] : {}) }, rest.at(-1));

const STAND_IN = process.platform === 'linux' ? 'lo' : 'Stand-in';
const ADAPTER = '127.0.0.3';
const NAME = 'dropgate.test';

/** An adapter in os.networkInterfaces()' shape. */
const adapter = (address) => [{ address, netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: `${address}/8` }];

let peer;
let ownDns;
let systemDns;
let adapters;
let own;
let told;
let service;
let port;

/** A service watching the test's list, with the test's DNS servers; on Linux, the real route check. */
async function startService(options = {}) {
    service = new NetworkService({
        list: () => structuredClone(adapters),
        ownServers: async () => own,
        systemServers: () => [systemDns.server],
        tell: (message) => told.push(message),
        ...options,
    });
    port = await service.listen();
    return service;
}

beforeEach(async () => {
    peer = await startPeer('127.0.0.2');
    ownDns = await startDns('127.0.0.5', { [NAME]: '127.0.0.2' });
    systemDns = await startDns('127.0.0.6', { [NAME]: '127.0.0.2' });
    adapters = { [STAND_IN]: adapter(ADAPTER) };
    own = [ownDns.server];
    told = [];
});

afterEach(async () => {
    await service?.stop();
    service = null;
    await Promise.all([peer.close(), ownDns.close(), systemDns.close()]);
});

// --- The External IP (`09` 18.11): one binding request a family, held as a connection is ---

/** What main heard of the External IP, once it has. */
async function ipResult() {
    const found = () => told.find(({ type }) => type === NETWORK_SERVICE.IP_RESULT);
    while (!found()) await new Promise((resolve) => setTimeout(resolve, 5));
    return found();
}

/** IPv6's loopback, where the machine has it: its tests are skipped elsewhere. */
const IPV6 = Object.values(os.networkInterfaces()).flat().some(({ address }) => address === '::1');

test('18.11: a request goes from the adapter\'s address alone, with the responder\'s answer and its round trip told to main', async () => {
    const stun = await startStunServer({ address: '127.0.0.2', mapped: { v4: '203.0.113.42' } });
    try {
        await startService();
        service.setInterface(STAND_IN);
        await service.checkIp(1, stun.url);
        const { type, ...answer } = await ipResult();
        assert.equal(type, NETWORK_SERVICE.IP_RESULT);
        assert.deepEqual({ ...answer, latency: 0 }, { id: 1, v4: '203.0.113.42', v6: null, latency: 0 });
        assert.ok(Number.isInteger(answer.latency) && answer.latency >= 0 && answer.latency < 1_000);
        assert.deepEqual(stun.requests.map(({ family, source }) => ({ family, source })), [{ family: 4, source: ADAPTER }]);
    } finally {
        await stun.stop();
    }
});

test('18.14: a result carries each address\'s country and ISP from the location data, with the one request and nothing more; an address it doesn\'t hold has none', async () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dropgate-service-location-'));
    const dns = await startDns('127.0.0.7', { 'stun.test': '127.0.0.2' });
    const stun = await startStunServer({ address: '127.0.0.2', mapped: { v4: '203.0.113.42' } });
    try {
        writeLocationData(data, { '203.0.113.42': { code: 'NL', country: 'Netherlands', isp: 'Example Hosting B.V.', asn: 64500 } });
        await startService({ locationData: data, ownServers: async () => [dns.server] });
        service.setInterface(STAND_IN);
        await service.checkIp(1, stun.url);
        const { location } = await ipResult();
        assert.deepEqual(location, { month: '2026-11', v4: { code: 'NL', country: 'Netherlands', isp: 'Example Hosting B.V.', asn: 64500 }, v6: null });
        assert.equal(stun.requests.length, 1, 'one request, and none for the lookup');
        assert.deepEqual(dns.queries, [], 'no name asked for it');

        told.length = 0;
        stun.mapped.v4 = '203.0.113.99';
        await service.checkIp(2, stun.url);
        const elsewhere = await ipResult();
        assert.equal(elsewhere.v4, '203.0.113.99');
        assert.deepEqual(elsewhere.location, { month: '2026-11', v4: null, v6: null });
    } finally {
        await stun.stop();
        await dns.close();
        fs.rmSync(data, { recursive: true, force: true });
    }
});

test('18.14: with no location data, a result has the address and its latency, and says nothing of a location', async () => {
    const stun = await startStunServer({ address: '127.0.0.2', mapped: { v4: '203.0.113.42' } });
    try {
        await startService({ locationData: path.join(os.tmpdir(), 'dropgate-nowhere') });
        service.setInterface(STAND_IN);
        await service.checkIp(1, stun.url);
        const { v4, location, ...rest } = await ipResult();
        assert.equal(v4, '203.0.113.42');
        assert.equal(location, undefined);
        assert.ok(Number.isInteger(rest.latency));
    } finally {
        await stun.stop();
    }
});

test('18.14: an answer for a check called off while its data is read isn\'t told', async () => {
    const stun = await startStunServer({ address: '127.0.0.2', mapped: { v4: '203.0.113.42' } });
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dropgate-service-location-'));
    const realRead = fs.promises.readFile;
    try {
        writeLocationData(data, { '203.0.113.42': { code: 'NL', country: 'Netherlands', isp: 'Example Hosting B.V.', asn: 64500 } });
        await startService({ locationData: data });
        service.setInterface(STAND_IN);
        let reached;
        let release;
        const reading = new Promise((resolve) => { reached = resolve; });
        const held = new Promise((resolve) => { release = resolve; });
        fs.promises.readFile = async (...args) => {
            reached();
            await held;
            return realRead(...args);
        };
        const asking = service.checkIp(1, stun.url);
        await reading;
        service.setInterface(null);
        release();
        await asking;
        assert.equal(told.some(({ type }) => type === NETWORK_SERVICE.IP_RESULT), false);
    } finally {
        fs.promises.readFile = realRead;
        await stun.stop();
        fs.rmSync(data, { recursive: true, force: true });
    }
});

// --- The location data's monthly refresh (`09` 18.16): held as a connection is ---

/** DB-IP's files, as whole as its own (WHOLE nodes), packed, made once a month. */
const packedMonths = new Map();
function packedMonth(month) {
    if (!packedMonths.has(month)) {
        const { country, asn } = locationDatabases({ '203.0.113.42': { code: 'GB', country: 'United Kingdom', isp: 'Example Broadband Ltd', asn: 64511 } }, { month, minNodes: WHOLE });
        packedMonths.set(month, { country: zlib.gzipSync(country), asn: zlib.gzipSync(asn) });
    }
    return packedMonths.get(month);
}

/**
 * A stand-in for download.db-ip.com over HTTPS, on 127.0.0.2: the files it
 * serves, by name; every request, with where it came from. A file may be held
 * until released, or answered with a redirect.
 */
async function startDbIp() {
    const { key, cert } = selfSignedCertificate();
    const files = new Map();
    const redirects = new Map();
    const requests = [];
    let holding = null;
    /** Every URL the service asked for, whatever became of it. */
    const asked = [];
    const server = https.createServer({ key, cert }, async (request, response) => {
        requests.push({ path: request.url, from: request.socket.remoteAddress });
        if (redirects.has(request.url)) {
            response.writeHead(302, { Location: redirects.get(request.url) }).end();
            return;
        }
        const body = files.get(request.url.replace(/^\/free\//, ''));
        if (!body) {
            response.writeHead(404).end();
            return;
        }
        response.writeHead(200, { 'Content-Length': body.length });
        if (holding) {
            response.write(body.subarray(0, 1024));
            await holding.promise;
        }
        response.end(holding ? body.subarray(1024) : body);
    });
    const open = new Set();
    server.on('connection', (socket) => {
        open.add(socket);
        socket.on('close', () => open.delete(socket));
    });
    server.listen(0, '127.0.0.2');
    await once(server, 'listening');
    const { port } = server.address();
    return {
        port,
        requests,
        asked,
        files,
        redirects,
        /** The service's way of asking it: trusting its certificate, whatever name it was asked by. */
        request: (url, options, callback) => {
            asked.push(String(url));
            return https.request(url, { ...options, ca: cert, checkServerIdentity: () => undefined }, callback);
        },
        serve(month, instead = {}) {
            const packed = packedMonth(month);
            for (const kind of ['country', 'asn']) files.set(`dbip-${kind}-lite-${month}.mmdb.gz`, instead[kind] ?? packed[kind]);
        },
        hold() {
            holding = Promise.withResolvers();
        },
        release: () => holding?.resolve(),
        async close() {
            holding?.resolve();
            for (const socket of open) socket.destroy();
            await new Promise((resolve) => server.close(resolve));
        },
    };
}

/** A month of the test's own: DB-IP's files are asked for by name, whatever the month. */
const MONTH = '2026-11';

/** Wait until this holds, 20 s at most, so a test that's gone wrong ends instead of waiting for ever. */
async function waitFor(holds, what) {
    const end = Date.now() + 20_000;
    while (!holds()) {
        if (Date.now() > end) throw new Error(`Waited 20 s for ${what}.`);
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

/** What main heard of the refresh, once it has. */
async function refreshed() {
    const found = () => told.find(({ type }) => type === NETWORK_SERVICE.LOCATION_REFRESHED);
    await waitFor(found, 'the refresh to be told');
    return found();
}

/** A folder of the test's own, gone after it. */
const tempFolder = (t) => {
    const made = fs.mkdtempSync(path.join(os.tmpdir(), 'dropgate-service-refresh-'));
    t.after(() => fs.rmSync(made, { recursive: true, force: true }));
    return made;
};

/** The months the files in a folder are from, as main reads them. */
const monthsIn = async (folder) => Promise.all(['dbip-country-lite.mmdb', 'dbip-asn-lite.mmdb'].map(async (file) => {
    try {
        return monthOf(openDatabase(file.includes('asn') ? 'asn' : 'country', fs.readFileSync(path.join(folder, file))));
    } catch {
        return null;
    }
}));

test('18.16: the refresh downloads the month\'s two files from the adapter\'s address, its name looked up through the adapter, checks them, and keeps both; main is told the month', async (t) => {
    const dbip = await startDbIp();
    t.after(() => dbip.close());
    const into = tempFolder(t);
    dbip.serve(MONTH);
    await startService({ refreshInto: into, locationBase: `https://${NAME}:${dbip.port}/free/`, request: dbip.request });
    service.setInterface(STAND_IN);
    await service.reading;
    await service.refreshLocation(MONTH);
    assert.deepEqual(await refreshed(), { type: NETWORK_SERVICE.LOCATION_REFRESHED, month: MONTH });
    assert.deepEqual(dbip.requests.map(({ path: asked }) => asked), [`/free/dbip-country-lite-${MONTH}.mmdb.gz`, `/free/dbip-asn-lite-${MONTH}.mmdb.gz`]);
    assert.deepEqual([...new Set(dbip.requests.map(({ from }) => from))], [ADAPTER], 'from the adapter\'s address alone');
    assert.ok(ownDns.queries.some(({ name }) => name === NAME), 'its name asked of the adapter\'s own DNS server');
    assert.deepEqual(systemDns.queries, [], 'and of no other');
    assert.deepEqual(await monthsIn(into), [MONTH, MONTH]);
    assert.deepEqual(fs.readdirSync(into).sort(), ['dbip-asn-lite.mmdb', 'dbip-country-lite.mmdb'], 'nothing else left');
});

test('18.16: with no adapter chosen, it goes as the OS routes it', async (t) => {
    const dbip = await startDbIp();
    t.after(() => dbip.close());
    const into = tempFolder(t);
    dbip.serve(MONTH);
    await startService({ refreshInto: into, locationBase: `https://127.0.0.2:${dbip.port}/free/`, request: dbip.request });
    await service.refreshLocation(MONTH);
    assert.deepEqual(await refreshed(), { type: NETWORK_SERVICE.LOCATION_REFRESHED, month: MONTH });
    assert.equal(dbip.requests.length, 2);
    assert.ok(dbip.requests.every(({ from }) => from !== ADAPTER), 'not bound');
});

test('18.16: a file that isn\'t DB-IP\'s, of another month, too small or not packed is refused, and neither is kept: the data there stays; one not there is unreachable', async (t) => {
    const dbip = await startDbIp();
    t.after(() => dbip.close());
    const into = tempFolder(t);
    writeLocationData(into, { '203.0.113.42': { code: 'NL', country: 'Netherlands', isp: 'Example Hosting B.V.', asn: 64500 } }, { month: '2026-10' });
    const record = { '8.8.8.8': { country: { iso_code: 'US', names: { en: 'United States' } } } };
    const refusals = {
        "MaxMind's": { country: zlib.gzipSync(mmdb({ type: 'GeoLite2-Country', description: 'GeoLite2 Country database', records: record, minNodes: WHOLE })) },
        'another month\'s': { asn: packedMonth('2026-09').asn },
        'a small one': { country: zlib.gzipSync(locationDatabases({}, { month: MONTH }).country) },
        'not packed': { asn: Buffer.from('<html>Rate limited</html>') },
    };
    for (const [what, instead] of Object.entries(refusals)) {
        dbip.serve(MONTH, instead);
        told = [];
        await startService({ refreshInto: into, locationBase: `https://127.0.0.2:${dbip.port}/free/`, request: dbip.request });
        await service.refreshLocation(MONTH);
        assert.deepEqual(await refreshed(), { type: NETWORK_SERVICE.LOCATION_REFRESHED, error: 'refused' }, what);
        assert.deepEqual(await monthsIn(into), ['2026-10', '2026-10'], `${what}: the old data stays, whole`);
        assert.deepEqual(fs.readdirSync(into).sort(), ['dbip-asn-lite.mmdb', 'dbip-country-lite.mmdb'], `${what}: nothing else left`);
        await service.stop();
    }
    dbip.files.clear();
    told = [];
    await startService({ refreshInto: into, locationBase: `https://127.0.0.2:${dbip.port}/free/`, request: dbip.request });
    await service.refreshLocation(MONTH);
    assert.deepEqual(await refreshed(), { type: NETWORK_SERVICE.LOCATION_REFRESHED, error: 'unreachable' });
    assert.deepEqual(await monthsIn(into), ['2026-10', '2026-10']);
});

test('18.16: with an adapter chosen and gone, nothing is sent; gone mid-download, it\'s called off and nothing is kept', async (t) => {
    const dbip = await startDbIp();
    t.after(() => dbip.close());
    const into = tempFolder(t);
    dbip.serve(MONTH);
    adapters = {};
    await startService({ refreshInto: into, locationBase: `https://${NAME}:${dbip.port}/free/`, request: dbip.request, watchMs: 50 });
    service.setInterface(STAND_IN);
    await service.refreshLocation(MONTH);
    assert.deepEqual(await refreshed(), { type: NETWORK_SERVICE.LOCATION_REFRESHED, error: 'unreachable' });
    assert.deepEqual(dbip.requests, [], 'nothing sent');

    adapters = { [STAND_IN]: adapter(ADAPTER) };
    await new Promise((resolve) => setTimeout(resolve, 200));
    told = [];
    dbip.hold();
    const asking = service.refreshLocation(MONTH);
    await waitFor(() => dbip.requests.length > 0, 'the download to start');
    adapters = {};
    await asking;
    assert.deepEqual(await refreshed(), { type: NETWORK_SERVICE.LOCATION_REFRESHED, error: 'unreachable' });
    assert.deepEqual(fs.readdirSync(into), [], 'nothing kept');
});

test('18.16: a redirect is followed to HTTPS, through the adapter as the first was, three at most; never to plain HTTP', async (t) => {
    const dbip = await startDbIp();
    t.after(() => dbip.close());
    const into = tempFolder(t);
    dbip.serve(MONTH);
    const base = `https://${NAME}:${dbip.port}`;
    dbip.redirects.set(`/free/dbip-country-lite-${MONTH}.mmdb.gz`, `${base}/elsewhere/1`);
    dbip.redirects.set('/elsewhere/1', `/free/dbip-country-lite-${MONTH}.mmdb.gz?moved`);
    dbip.files.set(`dbip-country-lite-${MONTH}.mmdb.gz?moved`, dbip.files.get(`dbip-country-lite-${MONTH}.mmdb.gz`));
    await startService({ refreshInto: into, locationBase: `${base}/free/`, request: dbip.request });
    service.setInterface(STAND_IN);
    await service.refreshLocation(MONTH);
    assert.deepEqual(await refreshed(), { type: NETWORK_SERVICE.LOCATION_REFRESHED, month: MONTH });
    assert.equal(dbip.requests.length, 4);
    assert.deepEqual([...new Set(dbip.requests.map(({ from }) => from))], [ADAPTER]);

    for (const [what, target] of [['plain HTTP', `http://${NAME}:${dbip.port}/free/x`], ['round and round', `/free/dbip-asn-lite-${MONTH}.mmdb.gz`]]) {
        told = [];
        dbip.requests.length = 0;
        dbip.redirects.clear();
        dbip.redirects.set(`/free/dbip-asn-lite-${MONTH}.mmdb.gz`, target);
        dbip.asked.length = 0;
        await service.refreshLocation(MONTH);
        assert.ok((await refreshed()).error, what);
        assert.ok(dbip.requests.length <= 1 + 1 + 3, `${what}: three redirects at most`);
        assert.ok(dbip.asked.every((url) => url.startsWith('https:')), `${what}: nothing asked but over HTTPS: ${dbip.asked}`);
    }
    assert.deepEqual(await monthsIn(into), [MONTH, MONTH], 'what was kept stays');
});

test('18.16: a check looks its address up in the newest data held: the refresh\'s, once kept, at once', async (t) => {
    const dbip = await startDbIp();
    t.after(() => dbip.close());
    const own = tempFolder(t);
    const into = tempFolder(t);
    writeLocationData(own, { '203.0.113.42': { code: 'NL', country: 'Netherlands', isp: 'Example Hosting B.V.', asn: 64500 } }, { month: '2026-10' });
    const stun = await startStunServer({ address: '127.0.0.2', mapped: { v4: '203.0.113.42' } });
    t.after(() => stun.stop());
    dbip.serve(MONTH);
    await startService({ locationData: [own, into], refreshInto: into, locationBase: `https://127.0.0.2:${dbip.port}/free/`, request: dbip.request });
    await service.checkIp(1, stun.url);
    assert.deepEqual((await ipResult()).location, { month: '2026-10', v4: { code: 'NL', country: 'Netherlands', isp: 'Example Hosting B.V.', asn: 64500 }, v6: null });
    await service.refreshLocation(MONTH);
    assert.equal((await refreshed()).month, MONTH);
    told = [];
    await service.checkIp(2, stun.url);
    assert.deepEqual((await ipResult()).location, { month: MONTH, v4: { code: 'GB', country: 'United Kingdom', isp: 'Example Broadband Ltd', asn: 64511 }, v6: null });
});

test('18.11: a name is looked up through the adapter, and with an IPv6 address a second request goes, from that address',{ skip: !IPV6 && 'no IPv6 loopback here' }, async () => {
    const stun = await startStunServer({ address: '127.0.0.2', address6: '::1', mapped: { v4: '203.0.113.42', v6: '2001:db8:5:12::42' } });
    const dns = await startDns('127.0.0.5', { 'stun.test': '127.0.0.2' }, { 'stun.test': '::1' });
    try {
        own = [dns.server];
        adapters = { [STAND_IN]: [...adapter(ADAPTER), { address: '::1', netmask: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', family: 'IPv6', mac: '00:00:00:00:00:00', internal: false, cidr: '::1/128', scopeid: 0 }] };
        await startService();
        service.setInterface(STAND_IN);
        await service.checkIp(1, `stun:stun.test:${stun.port}`);
        const { v4, v6 } = await ipResult();
        assert.deepEqual({ v4, v6 }, { v4: '203.0.113.42', v6: '2001:db8:5:12::42' });
        assert.deepEqual(stun.requests.map(({ family, source }) => ({ family, source })).sort((a, b) => a.family - b.family), [{ family: 4, source: ADAPTER }, { family: 6, source: '::1' }]);
        assert.deepEqual([...new Set(dns.queries.map(({ source }) => source))], [ADAPTER], 'every lookup through it');
        assert.deepEqual(dns.queries.map(({ type }) => type).sort(), ['A', 'AAAA']);
    } finally {
        await Promise.all([stun.stop(), dns.close()]);
    }
});

test('18.11: an adapter with no IPv6 address asks nothing over IPv6, of a name or of an IPv6 address', { skip: !IPV6 && 'no IPv6 loopback here' }, async () => {
    const stun = await startStunServer({ address: '127.0.0.2', address6: '::1' });
    const dns = await startDns('127.0.0.5', { 'stun.test': '127.0.0.2' }, { 'stun.test': '::1' });
    try {
        own = [dns.server];
        await startService();
        service.setInterface(STAND_IN);
        await service.checkIp(1, `stun:stun.test:${stun.port}`);
        await ipResult();
        assert.deepEqual(stun.requests.map(({ family }) => family), [4]);
        assert.deepEqual(dns.queries.map(({ type }) => type), ['A']);

        told.length = 0;
        await service.checkIp(2, `stun:[::1]:${stun.port}`);
        assert.deepEqual(await ipResult(), { type: NETWORK_SERVICE.IP_RESULT, id: 2, error: 'unreachable' });
        assert.equal(stun.requests.length, 1);
    } finally {
        await Promise.all([stun.stop(), dns.close()]);
    }
});

test('18.11: with no adapter chosen, it goes as the OS routes it, through the OS\'s resolver for a name, and IPv6 only where the machine has an address for it', { skip: !IPV6 && 'no IPv6 loopback here' }, async () => {
    const stun = await startStunServer({ address: '127.0.0.2', address6: '::1', mapped: { v4: '203.0.113.42', v6: '2001:db8:5:12::42' } });
    const lookups = [];
    try {
        await startService({
            osLookup: async (name, { family }) => {
                lookups.push({ name, family });
                return { address: family === 4 ? '127.0.0.2' : '::1', family };
            },
        });
        await service.checkIp(1, `stun:stun.test:${stun.port}`);
        assert.deepEqual((await ipResult()).v6, null, 'the machine has none');
        assert.deepEqual(lookups, [{ name: 'stun.test', family: 4 }]);
        assert.deepEqual(stun.requests.map(({ family, source }) => ({ family, source })), [{ family: 4, source: '127.0.0.1' }], 'not the stand-in adapter\'s address: unbound');

        told.length = 0;
        adapters[STAND_IN].push({ address: '2001:db8::5', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: '00:00:00:00:00:00', internal: false, cidr: '2001:db8::5/64', scopeid: 0 });
        await service.checkIp(2, `stun:stun.test:${stun.port}`);
        assert.deepEqual((await ipResult()).v6, '2001:db8:5:12::42');
        assert.deepEqual(stun.requests.map(({ family }) => family).sort(), [4, 4, 6]);
    } finally {
        await stun.stop();
    }
});

test('18.11: one that doesn\'t answer is told as a timeout, after one request; a family that answers is told without the one that doesn\'t', async () => {
    const stun = await startStunServer({ address: '127.0.0.2', silent: true });
    try {
        await startService({ stunMs: 300 });
        service.setInterface(STAND_IN);
        await service.checkIp(1, stun.url);
        assert.deepEqual(await ipResult(), { type: NETWORK_SERVICE.IP_RESULT, id: 1, error: 'timeout' });
        assert.equal(stun.requests.length, 1);
    } finally {
        await stun.stop();
    }
    assert.equal(new NetworkService({ list: () => ({}), tell: () => {} }).stunMs, 5_000, 'five seconds to answer');
});

test('18.11: a bad URL or a name the adapter can\'t look up is told as unreachable, with nothing sent', async () => {
    const stun = await startStunServer({ address: '127.0.0.2' });
    try {
        await startService();
        service.setInterface(STAND_IN);
        await service.checkIp(1, 'http://127.0.0.2/');
        assert.deepEqual(await ipResult(), { type: NETWORK_SERVICE.IP_RESULT, id: 1, error: 'unreachable' });
        told.length = 0;
        await service.checkIp(2, `stun:nowhere.test:${stun.port}`);
        assert.deepEqual(await ipResult(), { type: NETWORK_SERVICE.IP_RESULT, id: 2, error: 'unreachable' });
        assert.deepEqual(stun.requests, []);
    } finally {
        await stun.stop();
    }
});

test('18.11: the adapter gone, nothing is sent; gone or changed mid-request, it\'s called off, and nothing more is told of it', async () => {
    const stun = await startStunServer({ address: '127.0.0.2', silent: true });
    try {
        await startService();
        service.setInterface(STAND_IN);
        const asking = service.checkIp(1, stun.url);
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(stun.requests.length, 1);
        adapters = {};
        service.watch.read();
        await asking;
        assert.equal(told.some(({ type }) => type === NETWORK_SERVICE.IP_RESULT), false, 'called off, it says nothing');

        // Gone: it can't go.
        await service.checkIp(2, stun.url);
        assert.deepEqual(await ipResult(), { type: NETWORK_SERVICE.IP_RESULT, id: 2, error: 'unreachable' });
        assert.equal(stun.requests.length, 1, 'nothing sent through nothing');

        // Changed mid-request.
        told.length = 0;
        adapters = { [STAND_IN]: adapter(ADAPTER) };
        service.watch.read();
        const moving = service.checkIp(3, stun.url);
        await new Promise((resolve) => setTimeout(resolve, 50));
        adapters = { [STAND_IN]: adapter('127.0.0.4') };
        service.watch.read();
        await moving;
        assert.equal(told.some(({ type }) => type === NETWORK_SERVICE.IP_RESULT), false);

        // Another asked: the one before is called off.
        const first = service.checkIp(4, stun.url);
        const second = service.checkIp(5, 'not a url');
        await Promise.all([first, second]);
        assert.deepEqual(told.filter(({ type }) => type === NETWORK_SERVICE.IP_RESULT).map(({ id }) => id), [5]);
    } finally {
        await stun.stop();
    }
});

test('18.11: on Linux, a route not through the adapter is refused before anything is sent, and one through it goes', async () => {
    const stun = await startStunServer({ address: '127.0.0.2', mapped: { v4: '203.0.113.42' } });
    try {
        let device = 'eth1';
        const routes = new RouteCheck({ ask: async () => `127.0.0.2 from ${ADAPTER} dev ${device} uid 1000\n    cache\n`, cacheMs: 0 });
        await startService({ routes });
        service.setInterface(STAND_IN);
        await service.checkIp(1, stun.url);
        assert.deepEqual(await ipResult(), { type: NETWORK_SERVICE.IP_RESULT, id: 1, error: 'unreachable' });
        assert.deepEqual(stun.requests, [], 'refused before anything is sent');

        told.length = 0;
        device = STAND_IN;
        await service.checkIp(2, stun.url);
        assert.equal((await ipResult()).v4, '203.0.113.42');
        assert.equal(stun.requests.length, 1);
    } finally {
        await stun.stop();
    }
});

/** Wait for a socket to close, 5 s at most; how long it took (Infinity: it didn't). */
async function closes(socket) {
    if (socket.destroyed) return 0;
    const started = performance.now();
    const closed = await Promise.race([once(socket, 'close').then(() => true), new Promise((resolve) => setTimeout(resolve, 5_000, false))]);
    return closed ? performance.now() - started : Infinity;
}

test('through the proxy, a request by name, by an IPv4 address sent as a name, over TLS and over a WebSocket comes from the adapter\'s address only', async () => {
    await startService();
    service.setInterface(STAND_IN);

    let { socket, code } = await socks(port, NAME, peer.port);
    assert.equal(code, REPLY.OK);
    assert.equal(await get(socket, '/hello'), ADAPTER, 'by name');

    ({ socket, code } = await socks(port, '127.0.0.2', peer.port));
    assert.equal(code, REPLY.OK);
    assert.equal(await get(socket, '/hello'), ADAPTER, 'by an address sent as a name');
    assert.deepEqual(ownDns.queries.filter((query) => query.name === '127.0.0.2'), [], 'an address is never looked up');

    ({ socket, code } = await socks(port, '127.0.0.2', peer.port, ATYP.IPV4));
    assert.equal(code, REPLY.OK);
    assert.equal(await get(socket, '/hello'), ADAPTER, 'by an IPv4 address');

    ({ socket, code } = await socks(port, NAME, peer.securePort));
    assert.equal(code, REPLY.OK);
    assert.equal(await get(await overTls(socket, peer.ca), '/hello'), ADAPTER, 'over TLS');

    ({ socket, code } = await socks(port, NAME, peer.port));
    assert.equal(code, REPLY.OK);
    const ws = await openWebSocket(socket);
    ws.destroy();

    assert.equal(peer.sources.length, 5);
    assert.deepEqual(new Set(peer.sources), new Set([ADAPTER]), 'every connection the server saw came from the adapter\'s address');
    assert.deepEqual(new Set(ownDns.queries.map((query) => query.source)), new Set([ADAPTER]), 'every query came from the adapter\'s address');
    assert.ok(told.some((message) => message.type === NETWORK_SERVICE.LISTENING && message.port === port));
    assert.ok(told.some((message) => message.type === NETWORK_SERVICE.STATE && message.name === STAND_IN && message.present && message.addresses.v4 === ADAPTER));
});

test('a destination of a family the adapter hasn\'t got is refused, and with no adapter chosen nothing connects', async () => {
    const six = net.createServer((socket) => socket.destroy());
    const reached = [];
    six.on('connection', (socket) => reached.push(socket.remoteAddress));
    await new Promise((resolve) => six.listen(0, '::1', resolve));
    try {
        await startService();
        service.setInterface(STAND_IN);
        const { code } = await socks(port, '::1', six.address().port, ATYP.IPV6);
        assert.equal(code, REPLY.NETWORK_UNREACHABLE, 'the adapter has no IPv6 address');
        assert.equal((await socks(port, '[::1]', six.address().port)).code, REPLY.NETWORK_UNREACHABLE, 'nor as a name');
        assert.deepEqual(reached, []);

        service.setInterface(null);
        for (const [host, type] of [[NAME, ATYP.NAME], ['127.0.0.2', ATYP.IPV4], ['127.0.0.2', ATYP.NAME]]) {
            assert.equal((await socks(port, host, peer.port, type)).code, REPLY.NOT_ALLOWED, host);
        }
        assert.deepEqual([peer.sources, ownDns.queries, systemDns.queries], [[], [], []], 'nothing reached the server or a DNS server');
    } finally {
        await new Promise((resolve) => six.close(resolve));
    }
});

test('names are asked of the adapter\'s own DNS servers, else the system\'s, always from its address; one it can\'t reach fails the name', async () => {
    await startService();
    service.setInterface(STAND_IN);
    assert.equal(await get((await socks(port, NAME, peer.port)).socket, '/hello'), ADAPTER);
    assert.deepEqual(ownDns.queries.map(({ name, type, source }) => [name, type, source]), [[NAME, 'A', ADAPTER]]);
    assert.deepEqual(systemDns.queries, [], 'the system\'s weren\'t asked: the adapter has its own');

    // An adapter with none of its own: the system's, still from its address.
    own = [];
    service.setInterface(STAND_IN);
    assert.equal(await get((await socks(port, NAME, peer.port)).socket, '/hello'), ADAPTER);
    assert.deepEqual(systemDns.queries.map(({ name, source }) => [name, source]), [[NAME, ADAPTER]]);

    // Its own server can't be reached (nothing listens there): the name fails, and no other server is asked.
    const closed = await startDns('127.0.0.7', {});
    const unreachable = closed.server;
    await closed.close();
    own = [unreachable];
    service.setInterface(STAND_IN);
    const before = [ownDns.queries.length, systemDns.queries.length];
    const { code } = await socks(port, NAME, peer.port);
    assert.equal(code, REPLY.HOST_UNREACHABLE);
    assert.deepEqual([ownDns.queries.length, systemDns.queries.length], before, 'no other DNS server was asked');
    assert.equal(peer.sources.length, 2, 'nothing reached the server for it');
});

test('the adapter leaving the list closes a download and a WebSocket through it within 1.5 s, refuses every connection after, and an address change rebinds', async () => {
    await startService();
    service.setInterface(STAND_IN);
    const download = (await socks(port, NAME, peer.port)).socket;
    download.write(`GET /stream HTTP/1.1\r\nHost: ${NAME}\r\n\r\n`);
    download.resume();
    await once(download, 'data');
    const socket = await openWebSocket((await socks(port, NAME, peer.port)).socket);
    await once(socket, 'data');

    delete adapters[STAND_IN];
    const [downloadMs, socketMs] = await Promise.all([closes(download), closes(socket)]);
    assert.ok(downloadMs < 1_500, `the download closed in ${Math.round(downloadMs)} ms`);
    assert.ok(socketMs < 1_500, `the WebSocket closed in ${Math.round(socketMs)} ms`);
    assert.ok(told.some((message) => message.type === NETWORK_SERVICE.GONE && message.name === STAND_IN));
    for (const [host, type] of [[NAME, ATYP.NAME], ['127.0.0.2', ATYP.IPV4]]) {
        assert.equal((await socks(port, host, peer.port, type)).code, REPLY.NETWORK_UNREACHABLE, `${host} after it's gone`);
    }
    assert.deepEqual(peer.sources, [ADAPTER, ADAPTER], 'the server saw no connection from any other source');

    // Back with a new address (a VPN reconnecting): what's open on the old one closes; new ones use the new one.
    adapters = { [STAND_IN]: adapter(ADAPTER) };
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const held = (await socks(port, NAME, peer.port)).socket;
    held.write(`GET /stream HTTP/1.1\r\nHost: ${NAME}\r\n\r\n`);
    held.resume();
    await once(held, 'data');
    adapters = { [STAND_IN]: adapter('127.0.0.4') };
    assert.ok(await closes(held) < 1_500, 'the old address\'s connection closed');
    assert.equal(await get((await socks(port, NAME, peer.port)).socket, '/hello'), '127.0.0.4');
    assert.deepEqual(peer.sources.slice(2), [ADAPTER, '127.0.0.4']);
});

test('the route check: a destination or a DNS server whose route from the adapter\'s address isn\'t through it is refused before anything is sent', async () => {
    // `ip route get` stood in, so this runs everywhere; on Linux the real one runs in the namespaced test below.
    let device = 'eth9';
    const asked = [];
    const routes = new RouteCheck({ ask: async (destination, source) => {
        asked.push([destination, source]);
        return `${destination} from ${source} dev ${device} uid 1000 \n    cache `;
    } });
    await startService({ routes });
    service.setInterface('Stand-in');
    adapters = { 'Stand-in': adapter(ADAPTER) };
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    routes.clear();
    asked.length = 0;

    assert.equal((await socks(port, '127.0.0.2', peer.port, ATYP.IPV4)).code, REPLY.NETWORK_UNREACHABLE, 'a connection');
    assert.equal((await socks(port, NAME, peer.port)).code, REPLY.NETWORK_UNREACHABLE, 'a name: its DNS server\'s route is checked first');
    assert.deepEqual(asked, [['127.0.0.2', ADAPTER], ['127.0.0.5', ADAPTER]]);
    assert.deepEqual([peer.sources, ownDns.queries], [[], []], 'no connection and no query was sent');

    device = 'Stand-in';
    routes.clear();
    assert.equal(await get((await socks(port, NAME, peer.port)).socket, '/hello'), ADAPTER, 'through the adapter, it goes');
    assert.deepEqual(ownDns.queries.map(({ source }) => source), [ADAPTER]);
});

test('the route check reads the adapter `ip route get` names, keeps each answer a few seconds, and refuses what it can\'t read', async () => {
    assert.equal(deviceOf('10.0.0.2 from 10.0.0.1 dev wg0 uid 1000 \n    cache '), 'wg0');
    assert.equal(deviceOf('local 127.0.0.2 from 127.0.0.3 dev lo table local uid 1000 \n    cache <local> '), 'lo');
    assert.equal(deviceOf('RTNETLINK answers: Network is unreachable'), null);
    let now = 0;
    let calls = 0;
    let answer = '10.0.0.2 from 10.0.0.1 dev wg0 ';
    const routes = new RouteCheck({ ask: async () => (calls++, answer), now: () => now });
    assert.equal(await routes.through('10.0.0.2', '10.0.0.1', 'wg0'), true);
    assert.equal(await routes.through('10.0.0.2', '10.0.0.1', 'eth0'), false);
    assert.equal(calls, 1, 'kept');
    now += 6_000;
    answer = null;
    assert.equal(await routes.through('10.0.0.2', '10.0.0.1', 'wg0'), false, 'no answer is a refusal');
    assert.equal(calls, 2);
});

test('the DNS servers asked: the adapter\'s own, else the system\'s; never one of a family it hasn\'t got, a link-local one, or one on the machine for a real adapter', () => {
    const lan = { v4: '192.168.1.242', v6: '2001:db8::2' };
    assert.deepEqual(bound.serversFor({ own: ['10.2.0.1'], system: ['1.1.1.1'], addresses: lan }), ['10.2.0.1']);
    assert.deepEqual(bound.serversFor({ own: [], system: ['1.1.1.1', '2606:4700::1111', 'fe80::1', '127.0.0.53', '[2606:4700::1001]:53'], addresses: lan }),
        ['1.1.1.1', '2606:4700::1111', '[2606:4700::1001]:53']);
    assert.deepEqual(bound.serversFor({ own: [], system: ['1.1.1.1', '2606:4700::1111'], addresses: { v4: '100.80.130.2', v6: null } }), ['1.1.1.1']);
    assert.deepEqual(bound.serversFor({ own: ['127.0.0.5:5353'], system: [], addresses: { v4: ADAPTER, v6: null } }), ['127.0.0.5:5353'], 'a loopback adapter asks a loopback server');
    // Linux with systemd-resolved: its stub is the system's server, so the servers it forwards to are asked instead.
    const read = (file) => (file === '/run/systemd/resolve/resolv.conf' ? '# upstreams\nnameserver 192.168.1.254\nnameserver 2001:db8::53\nsearch lan\n' : '');
    assert.deepEqual(bound.systemServers('linux', read, () => ['127.0.0.53']), ['192.168.1.254', '2001:db8::53']);
    assert.deepEqual(bound.systemServers('linux', read, () => ['9.9.9.9']), ['9.9.9.9'], "a real server is the system's as it is");
    assert.deepEqual(bound.systemServers('win32', read, () => ['127.0.0.53']), ['127.0.0.53'], 'Windows has no systemd-resolved');
});

test('an adapter\'s own DNS servers are read as Windows\' registry and resolvectl give them', () => {
    const names = [
        'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Network\\{4D36E972-E325-11CE-BFC1-08002BE10318}\\{0E06D5E7-DD07-45EC-A54E-6015CE240E0D}\\Connection',
        '    Name    REG_SZ    Ethernet 2',
        '',
        'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Network\\{4D36E972-E325-11CE-BFC1-08002BE10318}\\{37217669-42DA-4657-A55B-0D995D328250}\\Connection',
        '    Name    REG_SZ    Tailscale',
        '',
    ].join('\r\n');
    assert.equal(bound.guidOf(names, 'Tailscale'), '{37217669-42DA-4657-A55B-0D995D328250}');
    assert.equal(bound.guidOf(names, 'Ethernet'), null, 'by the whole name');
    const settings = (server, dhcp) => `\r\nHKEY_LOCAL_MACHINE\\…\\{GUID}\r\n    EnableDHCP    REG_DWORD    0x1\r\n    NameServer    REG_SZ    ${server}\r\n    DhcpNameServer    REG_SZ    ${dhcp}\r\n`;
    assert.deepEqual(bound.registryServers(settings('1.1.1.1,1.0.0.1', '192.168.1.254')), ['1.1.1.1', '1.0.0.1'], 'set by hand, or by a VPN');
    assert.deepEqual(bound.registryServers(settings('', '192.168.1.254 192.168.1.1')), ['192.168.1.254', '192.168.1.1'], 'else DHCP\'s');
    assert.deepEqual(bound.registryServers('\r\n    EnableDHCP    REG_DWORD    0x1\r\n'), []);
    assert.deepEqual(bound.resolvectlServers('Link 5 (wg0): 10.2.0.1 1.1.1.1#cloudflare-dns.com fe80::1%wg0 fd00::53'), ['10.2.0.1', '1.1.1.1', 'fd00::53']);
    assert.deepEqual(bound.resolvectlServers('Link 3 (dga0):'), []);
    assert.deepEqual(bound.resolvConfServers('nameserver 127.0.0.53\noptions edns0\n nameserver 9.9.9.9\n'), ['127.0.0.53', '9.9.9.9']);
});

test('the adapters listed are those up with an address, the system\'s loopback left out; one is bound by its IPv4 address and its global IPv6 one', () => {
    const interfaces = {
        'Loopback Pseudo-Interface 1': [{ address: '127.0.0.1', family: 'IPv4', internal: true }, { address: '::1', family: 'IPv6', internal: true, scopeid: 0 }],
        'Ethernet 3': [
            { address: 'fe80::1c2d:3e4f:5a6b:7c8d', family: 'IPv6', internal: false, scopeid: 12 },
            { address: '2001:db8::2', family: 'IPv6', internal: false, scopeid: 0 },
            { address: '192.168.1.242', family: 'IPv4', internal: false },
        ],
        Tailscale: [{ address: '100.80.130.2', family: 'IPv4', internal: false }],
    };
    assert.deepEqual(adapterList(interfaces).map(({ name }) => name), ['Ethernet 3', 'Tailscale']);
    assert.deepEqual(addressesOf(interfaces, 'Ethernet 3'), { v4: '192.168.1.242', v6: '2001:db8::2' });
    assert.deepEqual(addressesOf(interfaces, 'Tailscale'), { v4: '100.80.130.2', v6: null });
    assert.equal(addressesOf(interfaces, 'Ethernet'), null, 'by the whole name only');
});

test('the proxy refuses what isn\'t SOCKS5\'s CONNECT with no authentication', async () => {
    await startService();
    service.setInterface(STAND_IN);
    const talk = async (...writes) => {
        const socket = net.connect({ host: 'localhost', port });
        await once(socket, 'connect');
        for (const bytes of writes) socket.write(Buffer.from(bytes));
        const chunks = [];
        for await (const chunk of socket) chunks.push(chunk);
        return [...Buffer.concat(chunks)];
    };
    assert.deepEqual(await talk([5, 1, 2]), [5, 0xff], 'a password only: no method');
    assert.deepEqual(await talk([5, 1, 0], [5, 2, 0, 1, 127, 0, 0, 2, 0, 80]), [5, 0, 5, REPLY.COMMAND_NOT_SUPPORTED, 0, 1, 0, 0, 0, 0, 0, 0], 'BIND');
    assert.deepEqual(await talk([5, 1, 0], [5, 1, 0, 9, 0, 0]), [5, 0, 5, REPLY.ADDRESS_NOT_SUPPORTED, 0, 1, 0, 0, 0, 0, 0, 0], 'an address type there isn\'t');
    assert.deepEqual(await talk([4, 1, 0, 80, 127, 0, 0, 2, 0]), [], 'SOCKS4');
    assert.deepEqual(peer.sources, []);
});

/**
 * A server and DNS responder in a network namespace (helpers/route-peer.mjs),
 * through sudo unless this is root: its ports, and each source it sees as it sees it.
 */
async function namespacedPeer(namespace, address) {
    const command = ['ip', 'netns', 'exec', namespace, process.execPath, fileURLToPath(new URL('helpers/route-peer.mjs', import.meta.url)), address];
    const child = process.getuid?.() === 0 ? spawn(command[0], command.slice(1)) : spawn('sudo', ['-n', ...command]);
    const seen = { tcp: [], dns: [] };
    const lines = readline.createInterface({ input: child.stdout });
    const ready = new Promise((resolve, reject) => {
        child.once('exit', (code) => reject(new Error(`The peer in ${namespace} exited (${code}).`)));
        lines.on('line', (line) => {
            const message = JSON.parse(line);
            if (message.ready) resolve(message.ready);
            if (message.tcp) seen.tcp.push(message.tcp);
            if (message.dns) seen.dns.push(message.dns);
        });
    });
    return { ...(await ready), seen, stop: () => child.kill() };
}

nodeTest('on Linux, a destination or a DNS server whose route from the adapter\'s address goes out of another adapter is refused before anything is sent; one through it goes', {
    timeout: 60_000,
    skip: process.env.DROPGATE_ROUTE_NETNS === '1' ? false : 'Linux with helpers/route-netns.sh set up (DROPGATE_ROUTE_NETNS=1), as CI\'s Ubuntu job has it',
}, async () => {
    const [chosen, other] = await Promise.all([namespacedPeer('dg-a', '10.201.0.2'), namespacedPeer('dg-b', '10.202.0.2')]);
    try {
        // The real list of adapters and the kernel's own route check: dga0 is chosen, and dgb0 is another adapter.
        own = [chosen.dns];
        service = new NetworkService({ ownServers: async () => own, systemServers: () => [], tell: (message) => told.push(message) });
        port = await service.listen();
        service.setInterface('dga0');
        const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

        // Through the adapter, by name: its query and its connection both come from its address.
        assert.equal(await get((await socks(port, NAME, chosen.port)).socket, '/hello'), '10.201.0.1');
        await settle();
        assert.deepEqual([chosen.seen.dns, chosen.seen.tcp], [['10.201.0.1'], ['10.201.0.1']]);

        // A destination the kernel routes out of dgb0, though bound to dga0's address: refused, and dg-b sees nothing.
        assert.equal((await socks(port, '10.202.0.2', other.port, ATYP.IPV4)).code, REPLY.NETWORK_UNREACHABLE);
        // So is a DNS server there: the name fails with no query sent.
        own = [other.dns];
        service.setInterface('dga0');
        assert.equal((await socks(port, NAME, chosen.port)).code, REPLY.NETWORK_UNREACHABLE);
        await settle();
        assert.deepEqual([other.seen.tcp, other.seen.dns], [[], []], 'nothing left through dgb0');
    } finally {
        chosen.stop();
        other.stop();
    }
});

test('the proxy listens on IPv6 loopback, else IPv4\'s, and nowhere but loopback; main is told where', async () => {
    const { LOOPBACKS, NetworkService: Service } = require('../src/core/network-service.js');
    assert.deepEqual([...LOOPBACKS], ['::1', '127.0.0.1']);

    // A machine that hasn't got the first (a documentation address stands for it): the next is used.
    const told_ = [];
    const fallback = new Service({ loopbacks: ['2001:db8::1', '127.0.0.1'], ownServers: async () => [], systemServers: () => [], tell: (message) => told_.push(message) });
    const at = await fallback.listen();
    assert.deepEqual(told_.find(({ type }) => type === NETWORK_SERVICE.LISTENING), { type: NETWORK_SERVICE.LISTENING, port: at, host: '127.0.0.1' });
    assert.equal(fallback.server.address().address, '127.0.0.1');
    await fallback.stop();

    // None at all: it says so, and main's session stays pointing at nothing.
    const none = new Service({ loopbacks: ['2001:db8::1'], ownServers: async () => [], systemServers: () => [] });
    await assert.rejects(none.listen(), /no loopback/);
    none.watch.stop();

    // As it runs, wherever this machine lets it.
    const told2 = [];
    const real = new Service({ ownServers: async () => [], systemServers: () => [], tell: (message) => told2.push(message) });
    await real.listen();
    const { host } = told2.find(({ type }) => type === NETWORK_SERVICE.LISTENING);
    assert.ok(LOOPBACKS.includes(host));
    assert.equal(real.server.address().address, host);
    await real.stop();
});
