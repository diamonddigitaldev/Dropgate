'use strict';

const { execFile } = require('child_process');
const dns = require('dns');
const fs = require('fs');
const net = require('net');
const { isLoopback } = require('./adapters');

// Names, looked up through the chosen adapter. Chromium resolves nothing
// itself through a SOCKS5 proxy: the network service does, with c-ares
// (dns.Resolver), each query sent from the adapter's address
// (setLocalAddress()), so Windows keeps it on that adapter and Linux's route
// check can hold it there. It asks the adapter's own DNS servers where it has
// some (a VPN's, read from the registry on Windows, from resolvectl on Linux),
// else the system's (a VPN that sets none, such as Tailscale, uses the
// system's through its tunnel). A server it can't reach fails the name: no
// other server or adapter is tried for it.
//
// A DNS server on the machine itself (systemd-resolved's 127.0.0.53, a local
// DNS proxy) would look the name up from its own sockets, through whichever
// adapter it likes, so one is never asked unless the adapter is a loopback
// one (the tests' stand-in). On Linux, where the system's servers are
// systemd-resolved's stub, its upstream servers are the system's instead.

/** How long a query is given, and how often it's sent. */
const QUERY_TIMEOUT_MS = 3_000;
const QUERY_TRIES = 2;

/** How long the registry or resolvectl is given to answer. */
const READ_TIMEOUT_MS = 2_000;

/** Windows' adapters' settings: each one's GUID, under which its name is kept. */
const NETWORK_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Network\\{4D36E972-E325-11CE-BFC1-08002BE10318}';
/** Each adapter's IPv4 and IPv6 settings, by GUID. */
const INTERFACE_KEYS = [
    'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\',
    'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip6\\Parameters\\Interfaces\\',
];

/** systemd-resolved's own list of the servers it forwards to. */
const RESOLVED_UPSTREAMS = '/run/systemd/resolve/resolv.conf';

/** A program's output, or null if it failed or isn't there. */
function run(file, args) {
    return new Promise((resolve) => {
        execFile(file, args, { timeout: READ_TIMEOUT_MS, windowsHide: true, encoding: 'utf8' }, (error, stdout) => resolve(error ? null : stdout));
    });
}

/** The IP address in a DNS server as c-ares takes one: "1.1.1.1", "1.1.1.1:5353", "[2606:4700::1111]:53", "2606:4700::1111". */
function serverAddress(server) {
    const text = String(server);
    if (net.isIP(text)) return text;
    const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(text);
    if (bracketed) return bracketed[1];
    const withPort = /^([^:]+):\d+$/.exec(text);
    return withPort ? withPort[1] : null;
}

/** The addresses in a registry NameServer value: "1.1.1.1,1.0.0.1" or "1.1.1.1 1.0.0.1". */
function splitServers(value) {
    return String(value ?? '').split(/[\s,]+/).filter((server) => net.isIP(server));
}

/**
 * The GUID `reg query <NETWORK_KEY> /s /v Name` gives an adapter's name:
 * "…\{GUID}\Connection" with "    Name    REG_SZ    Ethernet 3" under it.
 * @param {string} output
 * @param {string} name
 */
function guidOf(output, name) {
    const pattern = /\\(\{[0-9A-Fa-f-]+\})\\Connection\r?\n\s+Name\s+REG_SZ\s+([^\r\n]*)/g;
    for (const [, guid, listed] of String(output).matchAll(pattern)) {
        if (listed.trim() === name) return guid;
    }
    return null;
}

/**
 * The DNS servers in `reg query <INTERFACE_KEYS[n]><GUID>`'s output: its
 * NameServer, set by hand or by a VPN, else the one DHCP gave it.
 * @param {string} output
 */
function registryServers(output) {
    const value = (key) => new RegExp(`^\\s+${key}\\s+REG_SZ\\s+([^\\r\\n]*)$`, 'mi').exec(String(output))?.[1];
    const set = splitServers(value('NameServer'));
    return set.length > 0 ? set : splitServers(value('DhcpNameServer'));
}

/** The servers `resolvectl dns <name>` lists for a link: "Link 3 (wg0): 10.2.0.1 fd00::1". */
function resolvectlServers(output) {
    const listed = /^Link \d+ \([^)]*\):(.*)$/m.exec(String(output ?? ''))?.[1] ?? '';
    // "1.1.1.1#cloudflare-dns.com" is a server reached over TLS, by its name; a link-local one ("fe80::1%wg0") can't be given to c-ares.
    return listed.trim().split(/\s+/).map((server) => server.replace(/#.*$/, '')).filter((server) => !server.includes('%') && net.isIP(server));
}

/** The nameserver lines of a resolv.conf. */
function resolvConfServers(text) {
    return [...String(text ?? '').matchAll(/^\s*nameserver\s+(\S+)/gm)].map(([, server]) => server).filter((server) => net.isIP(server));
}

/**
 * An adapter's own DNS servers, as the OS keeps them: on Windows from the
 * registry, by its GUID (about 50 ms); on Linux from resolvectl. None where it
 * has none, or they can't be read.
 * @param {string} name
 * @param {NodeJS.Platform} [platform]
 * @returns {Promise<string[]>}
 */
async function adapterServers(name, platform = process.platform) {
    if (platform === 'win32') {
        const guid = guidOf(await run('reg', ['query', NETWORK_KEY, '/s', '/v', 'Name']) ?? '', name);
        if (!guid) return [];
        const outputs = await Promise.all(INTERFACE_KEYS.map((key) => run('reg', ['query', `${key}${guid}`])));
        return outputs.flatMap((output) => (output ? registryServers(output) : []));
    }
    if (platform === 'linux') return resolvectlServers(await run('resolvectl', ['dns', name]));
    return [];
}

/**
 * The system's DNS servers: Node's (c-ares'), or on Linux, where they're all
 * on the machine (systemd-resolved's stub), the servers it forwards to.
 * @param {NodeJS.Platform} [platform]
 * @param {(file: string) => string} [read]
 * @param {() => string[]} [getServers]
 */
function systemServers(platform = process.platform, read = (file) => fs.readFileSync(file, 'utf8'), getServers = () => dns.getServers()) {
    const servers = getServers();
    if (platform !== 'linux' || !servers.every((server) => isLoopback(serverAddress(server) ?? ''))) return servers;
    try {
        return resolvConfServers(read(RESOLVED_UPSTREAMS));
    } catch {
        return servers;
    }
}

/**
 * The servers a name is asked of through an adapter: its own where it has
 * some, else the system's; only those of a family it has an address of, no
 * link-local one, and none on the machine itself unless it's a loopback
 * adapter.
 * @param {{ own: string[], system: string[], addresses: { v4: string | null, v6: string | null } }} options
 */
function serversFor({ own, system, addresses }) {
    const loopbackAdapter = [addresses.v4, addresses.v6].some((address) => address && isLoopback(address));
    return (own.length > 0 ? own : system).filter((server) => {
        const address = serverAddress(server);
        if (!address) return false;
        const family = net.isIP(address);
        if (!(family === 4 ? addresses.v4 : addresses.v6)) return false;
        // A link-local server (fe80::, a router's) is reached by its link's scope, which no bound socket names.
        if (family === 6 && /^fe[89ab]/i.test(address)) return false;
        return loopbackAdapter || !isLoopback(address);
    });
}

/**
 * Looks names up through one adapter's addresses, from the servers it's
 * given. Each lookup has a resolver of its own, so the adapter's address in
 * use is always the one it has now, and every lookup under way can be
 * cancelled the moment it goes.
 */
class BoundResolver {
    /**
     * @param {object} [options]
     * @param {typeof dns.promises.Resolver} [options.Resolver]
     * @param {number} [options.timeoutMs]
     */
    constructor({ Resolver = dns.promises.Resolver, timeoutMs = QUERY_TIMEOUT_MS } = {}) {
        this.Resolver = Resolver;
        this.timeoutMs = timeoutMs;
        /** @type {Set<dns.promises.Resolver>} */
        this.running = new Set();
    }

    /**
     * The addresses a name has, of the families the adapter has (IPv4 first),
     * asked of these servers only, from the adapter's addresses.
     * @param {string} name
     * @param {{ addresses: { v4: string | null, v6: string | null }, servers: string[] }} through
     * @returns {Promise<{ address: string, family: 4 | 6 }>}
     */
    async lookup(name, { addresses, servers }) {
        if (servers.length === 0) throw Object.assign(new Error('No DNS server can be reached through the adapter.'), { code: 'ENETUNREACH' });
        let failure = null;
        for (const family of [4, 6]) {
            const local = family === 4 ? addresses.v4 : addresses.v6;
            if (!local) continue;
            const resolver = new this.Resolver({ timeout: this.timeoutMs, tries: QUERY_TRIES });
            // Every query from the adapter's address, of either family: a server of the family it hasn't got is never given.
            resolver.setLocalAddress(addresses.v4 ?? '0.0.0.0', addresses.v6 ?? '::0');
            resolver.setServers(servers);
            this.running.add(resolver);
            try {
                const found = await (family === 4 ? resolver.resolve4(name) : resolver.resolve6(name));
                if (found.length > 0) return { address: found[0], family };
            } catch (error) {
                failure = error;
            } finally {
                this.running.delete(resolver);
            }
        }
        throw failure ?? Object.assign(new Error(`${name} has no address of a family the adapter has.`), { code: 'ENOTFOUND' });
    }

    /** Stop every lookup under way: each fails. */
    cancelAll() {
        for (const resolver of this.running) resolver.cancel();
        this.running.clear();
    }
}

module.exports = {
    BoundResolver, adapterServers, systemServers, serversFor, serverAddress, guidOf, registryServers, resolvectlServers, resolvConfServers,
};
