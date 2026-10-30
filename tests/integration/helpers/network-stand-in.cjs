// Test-only entry for the network service. desktop-preload.cjs forks this in
// its place, with the real entry as its one argument, so the real service runs
// with only what it reads from the machine stood in, and nothing leaves it:
// - its adapters are the test's own, from the file in DROPGATE_TEST_ADAPTERS
//   ({ name: os.networkInterfaces() entries }), read each time as the OS's list
//   is: a test takes one away by writing the file;
// - the system's DNS server, with DROPGATE_TEST_DNS, is the test's responder.
//   On Linux, systemd-resolved's upstream servers would be asked instead of a
//   server on the machine, so that file reads as not there.
// With DROPGATE_TEST_NETWORK_SILENT=1 it runs and never answers: the real
// entry isn't started, so main never hears its port or its adapters.
'use strict';
const dns = require('node:dns');
const fs = require('node:fs');
const os = require('node:os');

const entry = process.argv.at(-1);

if (process.env.DROPGATE_TEST_NETWORK_SILENT === '1') {
    setInterval(() => {}, 60_000);
} else {
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
