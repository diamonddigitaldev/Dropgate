// A server and a DNS responder on one address, run inside a network namespace
// (route-netns.sh) by the route check's test: it prints its ports once
// listening, then the source of each connection and each DNS query, a line
// of JSON each.
import { startDns, startPeer } from './network.mjs';

const [address] = process.argv.slice(2);
const peer = await startPeer(address);
const dns = await startDns(address, { 'dropgate.test': address });
const told = { tcp: 0, dns: 0 };
setInterval(() => {
    while (told.tcp < peer.sources.length) console.log(JSON.stringify({ tcp: peer.sources[told.tcp++] }));
    while (told.dns < dns.queries.length) console.log(JSON.stringify({ dns: dns.queries[told.dns++].source }));
}, 20);
console.log(JSON.stringify({ ready: { port: peer.port, dns: dns.server } }));
