'use strict';

// The file service: a utility process (utilityProcess.fork() in
// transfer-host.js) that reads the files an upload sends and writes the file
// a download saves. It's Node, with no window and no session, and makes no
// network request. Main grants it each file as an upload starts (grant-read,
// with the path), and each download's folder as it starts (grant-output), and
// revokes them as they end; the transfer window asks it for ranges and writes
// over the MessagePort main handed both of them, by grant, never by path
// (core/file-service.js). So a file's bytes go between here and the transfer
// window, and never through main or the app's window. Main starts it with the
// partial folder, where a download is written until it's whole, as its one
// argument, and hears from it only where each download landed (saved).

const { FILE_SERVICE } = require('./constants');
const { FileService } = require('./core/file-service');

const service = new FileService({
    partials: process.argv.at(-1),
    onSaved: ({ output, path }) => process.parentPort.postMessage({ type: FILE_SERVICE.SAVED, output, path }),
});

/** The transfer window's port: each request is answered as it's done (a close can take a while: a copy onto another drive). */
function serve(port) {
    port.on('message', ({ data }) => {
        Promise.resolve(service.answer(data)).then((answer) => port.postMessage(answer));
    });
    port.start();
}

process.parentPort.on('message', ({ data, ports }) => {
    switch (data?.type) {
        case FILE_SERVICE.GRANT_READ:
        case FILE_SERVICE.GRANT_OUTPUT:
            // A grant that isn't one is never made, and its reads and writes are refused.
            try {
                if (data.type === FILE_SERVICE.GRANT_READ) service.grantRead(data);
                else service.grantOutput(data);
            } catch {
                // Nothing to read or write.
            }
            break;
        case FILE_SERVICE.REVOKE:
            if (data.output) service.revokeOutput(data.output);
            else service.revoke(data.handle);
            break;
        case FILE_SERVICE.PORT:
            if (ports?.[0]) serve(ports[0]);
            break;
    }
});

// Stopping: nothing partial is left (main empties the partial folder too, at quit and at the next start).
process.on('exit', () => service.revokeAll());
