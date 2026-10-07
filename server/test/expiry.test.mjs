// An upload is gone the moment its lifetime ends. Every route answers for it
// as it would for an ID that never existed, before the expiry sweep has run;
// the sweep then removes its bytes.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { startServer } from './helpers/harness.mjs';
import { initUpload, postJson, sendChunk } from './helpers/uploads.mjs';
import { HOUR_MS, SMALL_CHUNKS, fileBytes, plainObject, uploadObject } from './helpers/dgup4.mjs';

const LIFETIME_MS = 30_000;
// The expiry sweep runs every minute, so a move of the clock shorter than that,
// soon after the server starts, passes the lifetime without running it.
const PAST_LIFETIME_MS = LIFETIME_MS + 1_000;
const SWEEP_MS = 60_000;

async function uploadFile(server, { isEncrypted = false } = {}) {
    const { uploadId } = await initUpload(server, 1000, 1, { lifetime: LIFETIME_MS, isEncrypted });
    assert.equal((await sendChunk(server, uploadId, 0, new Uint8Array(1000).fill(7))).status, 200);
    return (await (await postJson(server, '/upload/complete', { uploadId })).json()).id;
}

async function uploadBundle(server) {
    const init = await postJson(server, '/upload/init-bundle', {
        fileCount: 2, isEncrypted: false, lifetime: LIFETIME_MS,
        files: [
            { filename: 'first.txt', totalSize: 1000, totalChunks: 1 },
            { filename: 'second.txt', totalSize: 1000, totalChunks: 1 },
        ],
    });
    const { bundleUploadId, fileUploadIds } = await init.json();
    const members = [];
    for (const uploadId of fileUploadIds) {
        assert.equal((await sendChunk(server, uploadId, 0, new Uint8Array(1000).fill(8))).status, 200);
        members.push((await (await postJson(server, '/upload/complete', { uploadId })).json()).id);
    }
    const { bundleId } = await (await postJson(server, '/upload/complete-bundle', { bundleUploadId })).json();
    return { bundleId, members };
}

/**
 * What every route a file or a bundle has answers for one ID: each status and
 * type, and the body where it's JSON. (A page's HTML differs by its nonce.)
 */
async function answersFor(server, id) {
    const requests = [
        ['GET', `/${id}`],
        ['GET', `/b/${id}`],
        ['GET', `/api/file/${id}/meta`],
        ['GET', `/api/file/${id}`],
        ['GET', `/api/bundle/${id}/meta`],
        ['POST', `/api/bundle/${id}/downloaded`],
    ];
    const answers = {};
    for (const [method, route] of requests) {
        const res = await fetch(server.baseUrl + route, { method, redirect: 'manual' });
        const type = res.headers.get('content-type') ?? '';
        answers[`${method} ${route.replace(id, '<id>')}`] = {
            status: res.status,
            type: type.split(';')[0],
            body: type.includes('json') ? await res.json() : (await res.arrayBuffer(), undefined),
        };
    }
    const resolved = await postJson(server, '/api/resolve', { value: id });
    answers['POST /api/resolve'] = { status: resolved.status, body: await resolved.json() };
    return answers;
}

test('an expired upload answers as one that never existed, at once, and the sweep removes its bytes later', async (t) => {
    // Unlimited downloads, so only the lifetime can make an upload go.
    const server = await startServer({
        env: { ENABLE_UPLOAD: 'true', UPLOAD_MAX_FILE_DOWNLOADS: '0', RATE_LIMIT_MAX_REQUESTS: '0' }, clock: true,
    });
    t.after(server.stop);

    const plain = await uploadFile(server);
    const encrypted = await uploadFile(server, { isEncrypted: true });
    const { bundleId, members } = await uploadBundle(server);
    const ids = { plain, encrypted, bundle: bundleId, 'first member': members[0], 'second member': members[1] };

    const missing = await answersFor(server, randomUUID());
    for (const [what, id] of Object.entries(ids)) {
        assert.notDeepEqual(await answersFor(server, id), missing, `the ${what} is there before its lifetime ends`);
    }
    assert.equal(server.storedFiles().length, 4);

    await server.advanceClock(PAST_LIFETIME_MS);
    for (const [what, id] of Object.entries(ids)) {
        assert.deepEqual(await answersFor(server, id), missing, `the ${what}, once its lifetime has ended`);
    }
    assert.equal(server.storedFiles().length, 4, 'the sweep hasn\'t run yet');

    await server.advanceClock(SWEEP_MS);
    assert.deepEqual(server.storedFiles(), [], 'the sweep removed the bytes');
});

test('the sweep removes a Dropgate 4 upload\'s object and record once its lifetime has ended', async (t) => {
    const server = await startServer({
        env: { ENABLE_UPLOAD: 'true', UPLOAD_CHUNK_SIZE_BYTES: SMALL_CHUNKS, UPLOAD_PRESERVE_UPLOADS: 'true', RATE_LIMIT_MAX_REQUESTS: '0' },
        clock: true,
    });
    t.after(server.stop);
    const object = plainObject({ files: [{ name: 'expires.bin', bytes: fileBytes(70_000) }] });
    const short = await uploadObject(server, object, { lifetimeMs: LIFETIME_MS });
    const long = await uploadObject(server, object, { lifetimeMs: HOUR_MS });
    assert.deepEqual(server.storedFiles().sort(), [`objects/${short.id}`, `objects/${long.id}`].sort());

    await server.advanceClock(SWEEP_MS);
    assert.deepEqual(server.storedFiles(), [`objects/${long.id}`], 'the expired one\'s object went');
    assert.deepEqual(server.records('objects.sqlite').map((r) => r.id), [long.id], 'and its record');
});
