'use strict';

// The file service: a utility process (utilityProcess.fork() in
// transfer-host.js) that reads the files an upload sends. It's Node, with no
// window and no session, and makes no network request. Main grants it each
// file as an upload starts (grant-read, with the path), and revokes it as the
// upload ends; the transfer window asks it for ranges over the MessagePort main
// handed both of them, by grant, never by path (core/file-service.js). So a
// file's bytes go from here to the transfer window, and never through main or
// the app's window.

const { FILE_SERVICE } = require('./constants');
const { FileService } = require('./core/file-service');

const service = new FileService();

/** The transfer window's port: each request is answered in turn. */
function serve(port) {
    port.on('message', ({ data }) => port.postMessage(service.answer(data)));
    port.start();
}

process.parentPort.on('message', ({ data, ports }) => {
    switch (data?.type) {
        case FILE_SERVICE.GRANT_READ:
            // A grant that isn't one is never made, and its reads are refused.
            try {
                service.grantRead(data);
            } catch {
                // Nothing to read.
            }
            break;
        case FILE_SERVICE.REVOKE:
            service.revoke(data.handle);
            break;
        case FILE_SERVICE.PORT:
            if (ports?.[0]) serve(ports[0]);
            break;
    }
});

process.on('exit', () => service.revokeAll());
