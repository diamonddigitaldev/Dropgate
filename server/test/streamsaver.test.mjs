// StreamSaver, which the web UI's download pages save files through: its
// service worker answers a download's address inside the browser. A browser can
// still send that address here, as Firefox does when its own Resume restarts a
// paused download, so the address holds no file name, and the server answers it
// with nothing at all: a page in its place would be saved as the file, marked
// complete.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startServer } from './helpers/harness.mjs';

const PUBLIC_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js');

describe("StreamSaver's folder", () => {
    let server;

    before(async () => {
        server = await startServer({ env: { ENABLE_UPLOAD: 'true', RATE_LIMIT_MAX_REQUESTS: '0' } });
    });
    after(() => server?.stop());

    test('its own files answer as they always have', async () => {
        for (const file of ['streamsaver.js', 'sw.js', 'mitm.html']) {
            const res = await fetch(`${server.baseUrl}/vendor/streamsaver/${file}`);
            assert.equal(res.status, 200, file);
            await res.arrayBuffer();
        }
    });

    test('a download address sent to the server gets no answer: the connection is dropped, so the browser marks the download failed', async () => {
        for (const [method, route] of [
            ['GET', '/vendor/streamsaver/127.0.0.1:52443/0f3a9c2e7b1d4e5f8a6b0c9d2e1f3a4b'],
            ['GET', '/vendor/streamsaver/127.0.0.1:52443/982606/Report.pdf'],
            ['HEAD', '/vendor/streamsaver/127.0.0.1:52443/982606/Report.pdf'],
            ['GET', '/vendor/streamsaver/ping'],
            ['GET', '/vendor/streamsaver/'],
        ]) {
            await assert.rejects(fetch(server.baseUrl + route, { method, headers: { Range: 'bytes=1000-' } }), TypeError, `${method} ${route} was answered`);
        }
        const res = await fetch(`${server.baseUrl}/api/info`);
        assert.equal(res.status, 200, 'and the server carries on');
        await res.arrayBuffer();
    });
});

test("every StreamSaver download the web UI makes goes through saveStream(), whose address is random, with no file name", () => {
    const made = [];
    for (const file of fs.readdirSync(PUBLIC_JS).filter((f) => f.endsWith('.js') && f !== 'dropgate-core.js')) {
        const source = fs.readFileSync(path.join(PUBLIC_JS, file), 'utf8');
        for (const match of source.matchAll(/createWriteStream\(([^)]*)\)/g)) made.push(`${file}: ${match[0]}`);
    }
    assert.deepEqual(made, ["page-common.js: createWriteStream(name, { ...options, pathname: random })"]);
    const common = fs.readFileSync(path.join(PUBLIC_JS, 'page-common.js'), 'utf8');
    assert.match(common, /const random = Array\.from\(crypto\.getRandomValues\(new Uint8Array\(16\)\)/, 'the address is 16 random bytes');
});
