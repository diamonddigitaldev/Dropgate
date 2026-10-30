'use strict';

// The network service: a utility process (utilityProcess.fork()) holding the
// SOCKS5 proxy that every request Dropgate makes goes through while an
// adapter is chosen in Settings > Network (core/network-service.js). It's
// Node, with no window and no session, and the only process that opens
// sockets for it: each one bound to the chosen adapter, every one closed the
// moment that adapter goes, and nothing connecting with none chosen. Main
// tells it the adapter by name (set-interface), and hears the proxy's port,
// the adapters there are, and the chosen one's state as it changes. If it
// exits, the sessions' proxy points at nothing, so nothing connects at all.

const { NETWORK_SERVICE } = require('./constants');
const { NetworkService } = require('./core/network-service');

const service = new NetworkService({ tell: (message) => process.parentPort.postMessage(message) });

process.parentPort.on('message', ({ data }) => {
    switch (data?.type) {
        case NETWORK_SERVICE.SET_INTERFACE:
            // Anything but a name or null chooses none: nothing connects.
            service.setInterface(typeof data.name === 'string' && data.name !== '' ? data.name : null);
            break;
        case NETWORK_SERVICE.STOP:
            service.stop().finally(() => process.exit(0));
            break;
    }
});

service.listen().catch(() => process.exit(1));
