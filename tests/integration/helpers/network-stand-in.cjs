// Test-only entry for the network service. desktop-preload.cjs forks this in
// its place, with the real entry as its one argument, so the real service runs
// with only what it reads from the machine stood in, and nothing leaves it:
// - its adapters are the test's own, from the file in DROPGATE_TEST_ADAPTERS
//   ({ name: os.networkInterfaces() entries }), read each time as the OS's list
//   is: a test takes one away by writing the file;
// - the system's DNS server, with DROPGATE_TEST_DNS, is the test's responder.
//   On Linux, systemd-resolved's upstream servers would be asked instead of a
//   server on the machine, so that file reads as not there;
// - DB-IP's downloads (the location data's monthly refresh) go to the test's
//   stand-in for db-ip.com (DROPGATE_TEST_DBIP, dbip.mjs), over plain HTTP, with
//   everything else as the service made them: the address it binds to, and with
//   an adapter chosen, the address it looked download.db-ip.com up as, through
//   the adapter (the test's DNS server answers the stand-in's). With no stand-in,
//   they're refused on this machine. Nothing reaches db-ip.com.
// (The location data, with DROPGATE_TEST_LOCATION_DATA, is the test's own small
// databases in place of the app's resources: desktop-preload.cjs names that
// folder in the service's arguments.)
// With DROPGATE_TEST_EVENTS, everything the service tries to send is written down
// there as it's tried, as { event: 'service-network', how, to }: a datagram, a
// connection, a name looked up by the OS or asked of a DNS server, or a request
// by HTTP or fetch: so a test can tell a lookup sends nothing.
// With DROPGATE_TEST_NETWORK_SILENT=1 it runs and never answers: the real
// entry isn't started, so main never hears its port or its adapters.
'use strict';
const dgram = require('node:dgram');
const dns = require('node:dns');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');

// Its arguments: the real entry, then main's two, the location data's folders.
const entry = process.argv.at(-3);

/** DB-IP's host: its requests go to the test's stand-in, or nowhere. */
const DBIP_HOST = 'download.db-ip.com';

/** Send each request for DB-IP's files to the stand-in, and the rest on as they were. */
function redirectDbIp() {
    const plain = http.request;
    const secure = https.request;
    https.request = function (first, ...rest) {
        const url = first instanceof URL ? first : typeof first === 'string' ? new URL(first) : null;
        if (url?.hostname !== DBIP_HOST) return secure.call(this, first, ...rest);
        const [options = {}, callback] = typeof rest[0] === 'function' ? [{}, rest[0]] : rest;
        // With no stand-in, a port on this machine nothing answers.
        const standIn = new URL(process.env.DROPGATE_TEST_DBIP || 'http://127.0.0.1:9');
        return plain.call(this, {
            ...options,
            protocol: 'http:',
            // Looked up through the adapter, the address the service found is kept; with none, the OS isn't asked.
            hostname: options.lookup ? url.hostname : standIn.hostname,
            port: standIn.port,
            path: `${url.pathname}${url.search}`,
            headers: { ...options.headers, host: url.host },
        }, callback);
    };
}

/** Write down each call of this, with where it's going, and carry on. */
function noteCalls(holder, name, how, to) {
    const events = process.env.DROPGATE_TEST_EVENTS;
    if (!events) return;
    const real = holder[name];
    holder[name] = function (...args) {
        fs.appendFileSync(events, `${JSON.stringify({ at: Date.now(), pid: process.pid, event: 'service-network', how, to: to(...args) })}\n`);
        return real.apply(this, args);
    };
}

if (process.env.DROPGATE_TEST_NETWORK_SILENT === '1') {
    setInterval(() => {}, 60_000);
} else {
    // Before the watch, so it's the service's own request that's written down.
    redirectDbIp();
    // A STUN request's socket is connected first, then sends with no address.
    noteCalls(dgram.Socket.prototype, 'connect', 'datagram-to', (port, address) => `${port} ${address}`);
    noteCalls(dgram.Socket.prototype, 'send', 'datagram', (...args) => args.filter((arg) => ['string', 'number'].includes(typeof arg)).slice(-2).join(' '));
    // A connect's own options, or its [options, callback] as Node passes them on inside.
    noteCalls(net.Socket.prototype, 'connect', 'connection', (first) => {
        const options = Array.isArray(first) ? first[0] : first;
        return `${options?.host ?? ''}:${options?.port ?? ''}`;
    });
    noteCalls(dns, 'lookup', 'os-lookup', (name) => String(name));
    noteCalls(dns.promises, 'lookup', 'os-lookup', (name) => String(name));
    noteCalls(dns.promises.Resolver.prototype, 'resolve4', 'dns', (name) => String(name));
    noteCalls(dns.promises.Resolver.prototype, 'resolve6', 'dns', (name) => String(name));
    noteCalls(http, 'request', 'http', (first) => String(first?.href ?? first?.host ?? first));
    noteCalls(https, 'request', 'https', (first) => String(first?.href ?? first?.host ?? first));
    noteCalls(globalThis, 'fetch', 'fetch', (first) => String(first?.url ?? first));
    const adapters = process.env.DROPGATE_TEST_ADAPTERS;
    if (!adapters) throw new Error('DROPGATE_TEST_ADAPTERS must name the file of stand-in adapters.');
    os.networkInterfaces = () => JSON.parse(fs.readFileSync(adapters, 'utf8'));
    const server = process.env.DROPGATE_TEST_DNS;
    if (server) {
        dns.getServers = () => [server];
        const read = fs.readFileSync;
        fs.readFileSync = function (file, ...rest) {
            if (String(file).includes('systemd/resolve')) throw Object.assign(new Error('Not there.'), { code: 'ENOENT' });
            return read.call(this, file, ...rest);
        };
    }
    require(entry);
}
