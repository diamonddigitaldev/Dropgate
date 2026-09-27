// Test-only preload: writes down every request that reaches the server, so a
// test can check what the server was sent, whatever the browser did first.
//
// Each request's method, URL and headers are written the moment it arrives, and
// each piece of its body as the server receives it, before any handler sees
// them. WebSocket upgrades are written the same way. Everything goes to
// requests.jsonl in the working directory, one JSON object per line:
//   { n, method, url, headers }   when request n arrives;
//   { n, body }                   for each piece of its body, in base64.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const LOG = path.join(process.cwd(), 'requests.jsonl');
fs.writeFileSync(LOG, '');

const write = (entry) => fs.appendFileSync(LOG, `${JSON.stringify(entry)}\n`);
let count = 0;

const realEmit = http.Server.prototype.emit;
http.Server.prototype.emit = function emit(event, req, ...rest) {
    if (event === 'request' || event === 'upgrade') {
        const n = ++count;
        write({ n, method: req.method, url: req.url, headers: req.headers });
        // The body arrives after this event, and push() is how it reaches the request stream.
        const realPush = req.push;
        req.push = function push(chunk, encoding) {
            if (chunk && chunk.length) write({ n, body: Buffer.from(chunk, encoding).toString('base64') });
            return realPush.call(this, chunk, encoding);
        };
    }
    return realEmit.call(this, event, req, ...rest);
};
