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
import { createRequire } from 'node:module';
import net from 'node:net';
import readline from 'node:readline';
import { afterEach, beforeEach, test as nodeTest } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ATYP, get, openWebSocket, overTls, socks, startDns, startPeer } from './helpers/network.mjs';

const require = createRequire(import.meta.url);
const { NETWORK_SERVICE } = require('../src/constants.js');
const { NetworkService } = require('../src/core/network-service.js');
const { RouteCheck, deviceOf } = require('../src/core/routes.js');
const { addressesOf, adapterList } = require('../src/core/adapters.js');
const { REPLY } = require('../src/core/socks5.js');
const bound = require('../src/core/bound-dns.js');

/** Each test, failing rather than waiting for ever if a connection is never closed or answered. */
const test = (name, fn) => nodeTest(name, { timeout: 30_000 }, fn);

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
        const socket = net.connect({ host: '127.0.0.1', port });
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
