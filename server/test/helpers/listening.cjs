// Test-only preload: once the server is listening, writes the port it listens
// on to listening.json in its working directory. If it can't listen, it writes
// the error's code to listen-error.json instead, whatever LOG_LEVEL lets the
// server print.
//
// The harness waits for this rather than for something to answer on the port.
// Another test's server can take the same free port first, and then it would
// answer, while this server failed to listen and exited.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const FILE = path.join(process.cwd(), 'listening.json');
const ERROR_FILE = path.join(process.cwd(), 'listen-error.json');

const realListen = net.Server.prototype.listen;
net.Server.prototype.listen = function listen(...args) {
    this.once('listening', () => {
        const address = this.address();
        if (address && typeof address === 'object') fs.writeFileSync(FILE, JSON.stringify({ port: address.port }));
    });
    this.prependOnceListener('error', (err) => {
        fs.writeFileSync(ERROR_FILE, JSON.stringify({ code: err.code ?? null }));
        // With no listener of its own, the error goes on as it would have.
        if (this.listenerCount('error') === 0) throw err;
    });
    return realListen.apply(this, args);
};
