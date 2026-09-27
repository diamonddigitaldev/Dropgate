// Test-only preload: once the server is listening, writes the port it listens
// on to listening.json in its working directory.
//
// The harness waits for this rather than for something to answer on the port.
// Another test's server can take the same free port first, and then it would
// answer, while this server failed to listen and exited.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const FILE = path.join(process.cwd(), 'listening.json');

const realListen = net.Server.prototype.listen;
net.Server.prototype.listen = function listen(...args) {
    this.once('listening', () => {
        const address = this.address();
        if (address && typeof address === 'object') fs.writeFileSync(FILE, JSON.stringify({ port: address.port }));
    });
    return realListen.apply(this, args);
};
