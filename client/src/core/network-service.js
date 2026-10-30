'use strict';

const net = require('net');
const { NETWORK_SERVICE } = require('../constants');
const { AdapterWatch, isLoopback } = require('./adapters');
const { BoundResolver, adapterServers, serverAddress, serversFor, systemServers } = require('./bound-dns');
const { RouteCheck } = require('./routes');
const { REPLY, readRequest, reply } = require('./socks5');

// The network service's work, with no Electron: a SOCKS5 proxy on the
// machine's loopback that holds every connection through it to one adapter,
// chosen by its name, and fails closed. While an adapter is chosen, the transfer
// session (and the updater's) send every request through it.
//
// - Each connection is opened from the adapter's address, of the family its
//   destination needs (Windows' strong host model keeps it on that adapter); a
//   family the adapter hasn't got is refused. On Linux, the kernel's route from
//   that address must go through the adapter too (routes.js), or it's refused
//   before anything is sent.
// - Names are looked up by the service itself, through the adapter
//   (bound-dns.js): Chromium resolves nothing through SOCKS5. An IP address
//   sent as a name is taken as an address, and never looked up.
// - The adapter is watched (adapters.js). The moment it goes (its name no
//   longer listed, or no address left), every connection is destroyed, every
//   lookup under way cancelled, and every new connection refused, with
//   nothing tried through any other adapter. When an address changes (a VPN
//   reconnecting), the connections bound to the old one are destroyed, and
//   new ones use the new one.
// - A loopback destination never leaves the machine, so it's connected from
//   the adapter's address only when that address is a loopback one itself (the
//   tests' stand-in adapter), and unbound otherwise.
// - With no adapter chosen, nothing connects.
// It sends nothing of its own, keeps nothing on disk and logs nothing.

/**
 * Where the proxy listens: IPv6 loopback, else IPv4's. Chromium looks up
 * ipv4only.arpa through the OS, past any proxy, when it's handed an IPv4
 * address and its check of IPv4 has just failed (its NAT64 probe). While an
 * adapter is chosen, the proxy's is the only address it's handed, so an IPv6
 * one means it never can; and a machine with no IPv6 never asks.
 */
const LOOPBACKS = Object.freeze(['::1', '127.0.0.1']);

/** How long a connection is given to open. */
const CONNECT_TIMEOUT_MS = 15_000;

/** The reply for why a connection couldn't be opened. */
function replyFor(error) {
    switch (error?.code) {
        case 'ECONNREFUSED': return REPLY.CONNECTION_REFUSED;
        case 'ENETUNREACH':
        case 'EADDRNOTAVAIL':
        case 'EINVAL': return REPLY.NETWORK_UNREACHABLE;
        case 'EHOSTUNREACH':
        case 'ETIMEDOUT': return REPLY.HOST_UNREACHABLE;
        default: return REPLY.FAILURE;
    }
}

/** A refusal, with its reply. */
const refusal = (code) => Object.assign(new Error('Refused.'), { reply: code });

class NetworkService {
    /**
     * @param {object} [options]
     * @param {() => NodeJS.Dict<import('os').NetworkInterfaceInfo[]>} [options.list] - os.networkInterfaces(), unless a test stands one in
     * @param {number} [options.watchMs]
     * @param {NodeJS.Platform} [options.platform]
     * @param {RouteCheck | null} [options.routes] - Linux's route check; none elsewhere
     * @param {(name: string) => Promise<string[]>} [options.ownServers] - the adapter's own DNS servers
     * @param {() => string[]} [options.systemServers] - the system's
     * @param {BoundResolver} [options.resolver]
     * @param {readonly string[]} [options.loopbacks] - where the proxy may listen, in order
     * @param {(message: object) => void} [options.tell] - to main
     */
    constructor({
        list, watchMs, platform = process.platform, routes = platform === 'linux' ? new RouteCheck() : null,
        ownServers = (name) => adapterServers(name, platform), systemServers: system = () => systemServers(platform),
        resolver = new BoundResolver(), loopbacks = LOOPBACKS, tell = () => {},
    } = {}) {
        this.loopbacks = loopbacks;
        this.routes = routes;
        this.ownServers = ownServers;
        this.system = system;
        this.resolver = resolver;
        this.tell = tell;
        /** The adapter chosen, by name, or null for none. */
        this.name = null;
        /** Its own DNS servers, as last read, and the read under way. */
        this.own = [];
        this.reading = Promise.resolve();
        /**
         * Every connection through the proxy: the client's socket, and once
         * it's opened, the one to its destination, with the family and the
         * address it was bound to (none: a loopback destination, unbound).
         * @type {Set<{ client: net.Socket, upstream: net.Socket | null, family: 4 | 6 | null, local: string | null | undefined }>}
         */
        this.connections = new Set();
        this.watch = new AdapterWatch({
            list,
            intervalMs: watchMs,
            onState: (state, before) => this.changed(state, before),
            onList: (adapters) => {
                this.routes?.clear();
                this.tell({ type: NETWORK_SERVICE.ADAPTERS, list: adapters });
            },
        });
        this.server = net.createServer((socket) => this.serve(socket));
    }

    /** Start the proxy, on the first loopback the machine has, at a port of the system's choosing; main is told both. */
    async listen() {
        let host = null;
        for (const candidate of this.loopbacks) {
            try {
                await new Promise((resolve, reject) => {
                    this.server.once('error', reject);
                    this.server.listen({ host: candidate, port: 0 }, () => {
                        this.server.off('error', reject);
                        resolve();
                    });
                });
                host = candidate;
                break;
            } catch (error) {
                if (error?.code !== 'EADDRNOTAVAIL' && error?.code !== 'EAFNOSUPPORT') throw error;
            }
        }
        if (host === null) throw new Error('The machine has no loopback to listen on.');
        const { port } = /** @type {net.AddressInfo} */ (this.server.address());
        this.tell({ type: NETWORK_SERVICE.LISTENING, port, host });
        // The adapters there are, with none chosen yet: main takes only a name it's told of here.
        this.watch.watch(this.name);
        return port;
    }

    /**
     * Choose the adapter, by name, or none (null). Every connection there is
     * now is closed, whatever it was, and the adapter's own DNS servers are
     * read again.
     * @param {string | null} name
     */
    setInterface(name) {
        this.name = name;
        this.own = [];
        this.close(() => true);
        this.routes?.clear();
        this.reading = name === null ? Promise.resolve() : this.readServers(name);
        this.watch.watch(name);
    }

    /** Read the adapter's own DNS servers, for this name while it's still the one chosen. */
    async readServers(name) {
        const own = await this.ownServers(name).catch(() => []);
        if (this.name === name) this.own = own;
    }

    /** The watched adapter changed: whatever it can't carry now is closed, and main is told. */
    changed(state, before) {
        this.routes?.clear();
        if (!state.present) {
            this.close(() => true);
            if (before.v4 || before.v6) this.tell({ type: NETWORK_SERVICE.GONE, name: state.name });
        } else {
            // A family whose address went or changed: its connections go, and those still opening.
            const moved = [4, 6].filter((family) => (family === 4 ? before.v4 : before.v6) && (family === 4 ? before.v4 !== state.addresses.v4 : before.v6 !== state.addresses.v6));
            if (moved.length > 0) this.close((entry) => entry.family === null || (entry.local && moved.includes(entry.family)));
            // A VPN that reconnects may come back with other DNS servers.
            if (before.v4 || before.v6) this.reading = this.readServers(state.name);
        }
        this.tell({ type: NETWORK_SERVICE.STATE, ...state });
    }

    /** Destroy the connections that match, and cancel every lookup under way if they all go. */
    close(matches) {
        for (const entry of this.connections) {
            if (!matches(entry)) continue;
            entry.client.destroy();
            entry.upstream?.destroy();
            this.connections.delete(entry);
        }
        if (this.connections.size === 0) this.resolver.cancelAll();
    }

    /** Whether the chosen adapter's address is a loopback one: the tests' stand-in. */
    loopbackAdapter(addresses) {
        return [addresses.v4, addresses.v6].some((address) => address && isLoopback(address));
    }

    /** The DNS servers a name is asked of now: the adapter's (or the system's), each one's route through it checked on Linux. */
    async servers(addresses) {
        await this.reading;
        const candidates = serversFor({ own: this.own, system: this.system(), addresses });
        if (!this.routes) return candidates;
        const through = await Promise.all(candidates.map((server) => {
            const address = serverAddress(server);
            return this.routes.through(address, net.isIP(address) === 4 ? addresses.v4 : addresses.v6, this.name);
        }));
        return candidates.filter((_, index) => through[index]);
    }

    /**
     * Where a connection to this host goes, and from which address: refused
     * with no adapter, the adapter gone, no address of the family needed, or
     * (on Linux) the route not through the adapter.
     * @param {string} host - a name, or an IP address (often sent as a name)
     */
    async destination(host) {
        const addresses = this.watch.addresses;
        if (!addresses || !this.watch.present()) throw refusal(REPLY.NETWORK_UNREACHABLE);
        // An IPv6 address may come as a name in its URL's brackets.
        let address = /^\[[^\]]+\]$/.test(host) && net.isIPv6(host.slice(1, -1)) ? host.slice(1, -1) : host;
        let family = net.isIP(address);
        if (family === 0) {
            const servers = await this.servers(addresses);
            if (servers.length === 0) throw refusal(REPLY.NETWORK_UNREACHABLE);
            try {
                ({ address, family } = await this.resolver.lookup(address, { addresses, servers }));
            } catch (error) {
                throw refusal(error?.code === 'ENETUNREACH' ? REPLY.NETWORK_UNREACHABLE : REPLY.HOST_UNREACHABLE);
            }
        }
        if (isLoopback(address) && !this.loopbackAdapter(addresses)) return { address, family, local: undefined };
        const local = family === 4 ? addresses.v4 : addresses.v6;
        if (!local) throw refusal(REPLY.NETWORK_UNREACHABLE);
        if (this.routes && !(await this.routes.through(address, local, this.name))) throw refusal(REPLY.NETWORK_UNREACHABLE);
        return { address, family, local };
    }

    /** One client of the proxy: its request read, its destination opened, then the two piped together. */
    async serve(client) {
        const entry = { client, upstream: null, family: null, local: null };
        this.connections.add(entry);
        client.on('error', () => {});
        client.on('close', () => {
            entry.upstream?.destroy();
            this.connections.delete(entry);
        });
        const refuse = (code) => {
            if (!client.destroyed) client.end(reply(code));
        };
        const request = await readRequest(client);
        if (!request || client.destroyed) return;
        if (this.name === null) return refuse(REPLY.NOT_ALLOWED);

        let target;
        try {
            target = await this.destination(request.host);
        } catch (error) {
            return refuse(error?.reply ?? REPLY.FAILURE);
        }
        // Closed meanwhile: the adapter went, or changed, while its destination was found.
        if (client.destroyed) return;

        const upstream = net.connect({
            host: target.address,
            port: request.port,
            family: target.family,
            ...(target.local ? { localAddress: target.local } : {}),
        });
        Object.assign(entry, { upstream, family: target.family, local: target.local });
        upstream.setTimeout(CONNECT_TIMEOUT_MS, () => upstream.destroy(Object.assign(new Error('Timed out.'), { code: 'ETIMEDOUT' })));
        let open = false;
        upstream.once('connect', () => {
            open = true;
            upstream.setTimeout(0);
            if (client.destroyed) return upstream.destroy();
            client.write(reply(REPLY.OK));
            if (request.rest.length > 0) upstream.write(request.rest);
            client.pipe(upstream);
            upstream.pipe(client);
        });
        upstream.on('error', (error) => {
            if (open) return client.destroy();
            // The adapter may have gone since the last read: main hears that first, so it never reads this as the server's own failure.
            if (error?.code === 'EADDRNOTAVAIL' || error?.code === 'ENETUNREACH') this.watch.read();
            refuse(replyFor(error));
        });
        upstream.on('close', (hadError) => {
            if (hadError) client.destroy();
        });
    }

    /** Stop: every connection closed, nothing more taken, the watch stopped. */
    async stop() {
        this.watch.stop();
        this.name = null;
        this.close(() => true);
        await new Promise((resolve) => this.server.close(() => resolve()));
    }
}

module.exports = { NetworkService, CONNECT_TIMEOUT_MS, LOOPBACKS };
