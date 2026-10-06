// How the API answers when something's wrong, and who may call it: every
// error is JSON with a code, nothing from the request comes back in it, and
// CORS lets any origin send Dropgate's headers and read the ones its answers
// carry, while pages get no CORS headers at all.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { startServer, waitFor } from './helpers/harness.mjs';
import { initUpload, postJson, sendChunk } from './helpers/uploads.mjs';

const ORIGIN = 'https://integrator.example';
const ALLOWED = ['Content-Type', 'Content-Digest', 'Range', 'If-Range', 'Authorization', 'Dropgate-Upload', 'Dropgate-Lease', 'Dropgate-Manage-Token'];
const EXPOSED = ['ETag', 'Content-Range', 'Accept-Ranges', 'Retry-After', 'Content-Length'];

const headerList = (value) => (value ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean).sort();
const lowerSorted = (names) => names.map((h) => h.toLowerCase()).sort();

/** An answer's status, its type, and its body as JSON. */
async function jsonAnswer(res) {
    assert.match(res.headers.get('content-type') ?? '', /^application\/json/, `${res.url} answered ${res.status} with something other than JSON`);
    return { status: res.status, body: await res.json() };
}

describe('errors', () => {
    let server;

    before(async () => {
        server = await startServer({ env: { ENABLE_UPLOAD: 'true', RATE_LIMIT_MAX_REQUESTS: '0' } });
    });
    after(() => server?.stop());

    test('a route under /api/v4 that doesn\'t exist answers 404 NOT_FOUND, and isn\'t cached', async () => {
        for (const route of ['/api/v4', '/api/v4/', '/api/v4/no-such-route', `/api/v4/objects/${randomUUID()}/nothing`]) {
            const res = await fetch(server.baseUrl + route, { method: 'POST' });
            assert.equal(res.headers.get('cache-control'), 'no-store', route);
            assert.deepEqual(await jsonAnswer(res), { status: 404, body: { code: 'NOT_FOUND', error: 'There is nothing here.' } }, route);
        }
    });

    test('a request body that can\'t be read answers 400 INVALID_REQUEST, and one too large 413 TOO_LARGE, quoting none of it', async () => {
        const unreadable = await fetch(`${server.baseUrl}/upload/init`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"filename": zq7BODY',
        });
        assert.deepEqual(await jsonAnswer(unreadable), { status: 400, body: { code: 'INVALID_REQUEST', error: 'The request could not be read.' } });

        const tooLarge = await postJson(server, '/upload/init', { filename: 'zq7BODY'.repeat(200_000) });
        assert.deepEqual(await jsonAnswer(tooLarge), { status: 413, body: { code: 'TOO_LARGE', error: 'The request is too large.' } });
    });

    test('an error while answering gives 500 SERVER_ERROR, and the log names the route\'s pattern, never its ID', async () => {
        // A stored file that has gone from disk, as when an expiry races a download.
        const { uploadId } = await initUpload(server, 1000, 1);
        await sendChunk(server, uploadId, 0, new Uint8Array(1000).fill(1));
        const { id } = await (await postJson(server, '/upload/complete', { uploadId })).json();
        fs.rmSync(path.join(server.uploadsDir, id));

        const mark = server.mark();
        const res = await fetch(`${server.baseUrl}/api/file/${id}`);
        assert.deepEqual(await jsonAnswer(res), { status: 500, body: { code: 'SERVER_ERROR', error: 'Something went wrong on the server.' } });

        await waitFor(() => server.since(mark).stderr.includes('[ERROR]'), { what: 'the error\'s log line' });
        const { stdout, stderr } = server.since(mark);
        const lines = (stdout + stderr).split(/\r?\n/).filter(Boolean);
        assert.equal(lines.length, 1, `one line was written, not:\n${lines.join('\n')}`);
        assert.match(lines[0], /\[ERROR\] Unexpected error while answering a request to GET \/api\/file\/:fileId \(Error, ENOENT\)\.$/);
        assert.ok(!lines[0].includes(id), 'the log line holds the file\'s ID');
    });
});

test('the rate limit answers 429 RATE_LIMITED, with Retry-After', async (t) => {
    const server = await startServer({ env: { RATE_LIMIT_MAX_REQUESTS: '1' } });
    t.after(server.stop);
    assert.equal((await fetch(`${server.baseUrl}/api/info`)).status, 200);
    const res = await fetch(`${server.baseUrl}/api/info`);
    assert.ok(Number(res.headers.get('retry-after')) > 0, 'Retry-After gives a number of seconds');
    assert.deepEqual(await jsonAnswer(res), { status: 429, body: { code: 'RATE_LIMITED', error: 'Too many requests, please try again later.' } });
});

test('a client address the rate limiter can\'t read is logged by its code alone, and not at all at NONE', async () => {
    // A reverse proxy that passes the client's port along with its address.
    const address = '203.0.113.9:4567';
    for (const level of ['NONE', 'ERROR']) {
        const server = await startServer({ env: { LOG_LEVEL: level } });
        try {
            const res = await fetch(`${server.baseUrl}/api/info`, { headers: { 'X-Forwarded-For': address } });
            assert.equal(res.status, 200);
            await new Promise((resolve) => setTimeout(resolve, 300));
            const written = server.output.stdout + server.output.stderr;
            assert.ok(!written.includes('203.0.113.9'), `${level}: the address was written`);
            if (level === 'NONE') {
                assert.equal(written, '', 'NONE: something was written');
            } else {
                assert.match(written, /\[ERROR\] The rate limiter reported a problem with the server's setup \(ValidationError, ERR_ERL_INVALID_IP_ADDRESS\)\./);
            }
        } finally {
            await server.stop();
        }
    }
});

describe('CORS', () => {
    let server;

    before(async () => {
        server = await startServer({ env: { ENABLE_UPLOAD: 'true', RATE_LIMIT_MAX_REQUESTS: '0' } });
    });
    after(() => server?.stop());

    test('any origin may send the API Dropgate\'s request headers, and only those', async () => {
        for (const route of ['/api/v4/upload', '/api/info']) {
            const res = await fetch(server.baseUrl + route, {
                method: 'OPTIONS',
                headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'dropgate-upload, content-digest, x-something-else' },
            });
            assert.equal(res.status, 204, route);
            assert.equal(res.headers.get('access-control-allow-origin'), '*', route);
            assert.deepEqual(headerList(res.headers.get('access-control-allow-headers')), lowerSorted(ALLOWED), route);
        }
    });

    test('the API\'s answers let any origin read ETag, Content-Range, Accept-Ranges, Retry-After and Content-Length', async () => {
        for (const route of ['/api/info', '/api/v4/no-such-route']) {
            const res = await fetch(server.baseUrl + route, { headers: { Origin: ORIGIN } });
            await res.arrayBuffer();
            assert.equal(res.headers.get('access-control-allow-origin'), '*', route);
            assert.deepEqual(headerList(res.headers.get('access-control-expose-headers')), lowerSorted(EXPOSED), route);
        }
    });

    test('pages and the web UI\'s files get no CORS headers', async () => {
        for (const route of ['/', '/js/theme.js', `/${randomUUID()}`]) {
            const res = await fetch(server.baseUrl + route, { headers: { Origin: ORIGIN } });
            await res.arrayBuffer();
            const cors = [...res.headers.keys()].filter((name) => name.startsWith('access-control-'));
            assert.deepEqual(cors, [], route);
        }
    });
});
