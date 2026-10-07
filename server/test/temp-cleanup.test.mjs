// Cancelled and abandoned uploads must leave nothing behind: no temp file, no
// stored file, no database record and no storage reservation.
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { startServer, waitFor } from './helpers/harness.mjs';
import { HOUR_MS, PAST_SESSION_EXPIRY_MS, initUpload, postJson, sendChunk } from './helpers/uploads.mjs';
import {
    QUIET_MS, SMALL_CHUNKS, answer, contentDigest, encryptedObject, fileBytes, plainObject, sendChunks, startBody,
    startUpload, uploads,
} from './helpers/dgup4.mjs';

// Sweep every 100 ms, and turn off rate limiting so polling can't trip it.
const ENV = { ENABLE_UPLOAD: 'true', UPLOAD_ZOMBIE_CLEANUP_INTERVAL_MS: '100', RATE_LIMIT_MAX_REQUESTS: '0' };

test('cancelling a single upload part-way leaves nothing behind', async () => {
    const server = await startServer({ env: ENV });
    try {
        const { uploadId } = await initUpload(server, 1000, 2);
        assert.equal((await sendChunk(server, uploadId, 0, new Uint8Array(500).fill(1))).status, 200);
        assert.equal(server.tempFiles().length, 1);

        assert.equal((await postJson(server, '/upload/cancel', { uploadId })).status, 200);

        assert.deepEqual(server.tempFiles(), []);
        assert.deepEqual(server.storedFiles(), []);
        assert.equal((await sendChunk(server, uploadId, 1, new Uint8Array(500).fill(1))).status, 410);
    } finally {
        await server.stop();
    }
});

test('an upload abandoned part-way is swept, and its storage reservation released', async () => {
    // 10 KB of storage: room for one 6 KB upload at a time.
    const server = await startServer({ env: { ...ENV, UPLOAD_MAX_STORAGE_GB: '0.00001' }, clock: true });
    try {
        const first = await initUpload(server, 6000, 2);
        assert.equal((await sendChunk(server, first.uploadId, 0, new Uint8Array(3000).fill(1))).status, 200);
        assert.equal((await initUpload(server, 6000, 2)).status, 507, 'the first upload reserves the space');

        // The client goes away without cancelling.
        await server.advanceClock(PAST_SESSION_EXPIRY_MS);
        await waitFor(() => server.tempFiles().length === 0, { what: 'the zombie sweep' });

        assert.deepEqual(server.storedFiles(), []);
        assert.equal((await initUpload(server, 6000, 2)).status, 200, 'the reservation is released');
    } finally {
        await server.stop();
    }
});

test('cancelling a bundle part-way leaves nothing behind', {
    expectFailure: {
        label: 'known issue until the v4 server rewrite: finished member files are left on disk',
        match: /left on disk/,
    },
}, async () => {
    const server = await startServer({ env: ENV, clock: true });
    try {
        const init = await postJson(server, '/upload/init-bundle', {
            fileCount: 2, isEncrypted: false, lifetime: HOUR_MS,
            files: [
                { filename: 'member-one.txt', totalSize: 1000, totalChunks: 1 },
                { filename: 'member-two.txt', totalSize: 1000, totalChunks: 1 },
            ],
        });
        const { fileUploadIds } = await init.json();
        assert.equal((await sendChunk(server, fileUploadIds[0], 0, new Uint8Array(1000).fill(1))).status, 200);
        const { id: finishedFileId } = await (await postJson(server, '/upload/complete', { uploadId: fileUploadIds[0] })).json();

        // What the client does on cancel: cancel every upload in the bundle.
        for (const uploadId of fileUploadIds) await postJson(server, '/upload/cancel', { uploadId });

        await server.advanceClock(PAST_SESSION_EXPIRY_MS);
        await waitFor(async () => (await fetch(`${server.baseUrl}/api/file/${finishedFileId}/meta`)).status === 404,
            { what: 'the zombie sweep to remove the finished member' });

        assert.deepEqual(server.tempFiles(), []);
        assert.deepEqual(server.storedFiles(), [], 'A finished member file was left on disk with no record');
    } finally {
        await server.stop();
    }
});

// ===== Dropgate 4's uploads =====

const V4 = { ENABLE_UPLOAD: 'true', UPLOAD_CHUNK_SIZE_BYTES: SMALL_CHUNKS, RATE_LIMIT_MAX_REQUESTS: '0', UPLOAD_PRESERVE_UPLOADS: 'true' };
const threeChunks = () => plainObject({ files: [{ name: 'cleanup-test.bin', bytes: fileBytes(2 * 65536 + 10_000) }] });

/**
 * A chunk's request that has sent only the first `sent` bytes of its body, once
 * the server has them. Gives the request, to finish or drop, and its answer.
 */
async function chunkPartWay(server, uploadId, index, bytes, sent) {
    const url = `${server.baseUrl}/api/v4/upload/chunks/${index}`;
    const req = http.request(url, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length,
            'Content-Digest': contentDigest(bytes), 'Dropgate-Upload': uploadId,
        },
    });
    const answered = new Promise((resolve) => {
        req.on('response', (res) => {
            let text = '';
            res.on('data', (d) => { text += d; });
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
        });
        req.on('error', () => resolve(null));
    });
    req.write(bytes.subarray(0, sent));
    await waitFor(() => server.requests().some((r) => r.url.endsWith(`/chunks/${index}`) && r.body.length >= sent),
        { what: 'the server to have the chunk\'s first bytes' });
    return { req, answered };
}

/** Whether nothing of any upload is left: no temp file, stored object or record. */
function assertNothingLeft(server) {
    assert.deepEqual(server.tempFiles(), [], 'temp files');
    assert.deepEqual(server.storedFiles(), [], 'stored objects');
    assert.deepEqual(server.records('objects.sqlite'), [], 'records');
}

test('cancelling a Dropgate 4 upload while a chunk is arriving leaves nothing behind, and the chunk is refused', async (t) => {
    const server = await startServer({ env: V4, requests: true });
    t.after(server.stop);
    const object = threeChunks();
    const uploadId = await startUpload(server, object);
    await sendChunks(server, uploadId, object, 0, 1);
    const { req, answered } = await chunkPartWay(server, uploadId, 1, object.chunks[1], 30_000);

    assert.equal((await uploads.cancel(server, uploadId)).status, 204);
    req.end(object.chunks[1].subarray(30_000));
    assert.deepEqual(await answered, { status: 404, body: { code: 'NOT_FOUND', error: 'The server has no such upload.' } });
    assertNothingLeft(server);
});

test('cancelling a Dropgate 4 bundle part-way leaves nothing behind: it\'s one upload, with no finished files of its own', async (t) => {
    const server = await startServer({ env: V4 });
    t.after(server.stop);
    for (const object of [
        encryptedObject({ files: [{ name: 'member-one.txt', bytes: fileBytes(65536, 1) }, { name: 'member-two.txt', bytes: fileBytes(65536, 2) }] }),
        plainObject({ files: [{ name: 'member-one.txt', bytes: fileBytes(65536, 1) }, { name: 'member-two.txt', bytes: fileBytes(65536, 2) }] }),
    ]) {
        const uploadId = await startUpload(server, object);
        // The first file's bytes are all there.
        await sendChunks(server, uploadId, object, 0, 1);
        assert.equal((await uploads.cancel(server, uploadId)).status, 204);
        assertNothingLeft(server);
    }
});

test('a Dropgate 4 upload whose client goes mid-chunk, with no cancel, ends 5 minutes on, and its reservation is freed', async (t) => {
    // About 200 KB of storage: room for one of these uploads at a time.
    const server = await startServer({ env: { ...V4, UPLOAD_MAX_STORAGE_GB: '0.0002' }, clock: true, requests: true });
    t.after(server.stop);
    const object = threeChunks();
    const uploadId = await startUpload(server, object);
    await sendChunks(server, uploadId, object, 0, 1);
    const { req } = await chunkPartWay(server, uploadId, 1, object.chunks[1], 30_000);
    req.destroy();
    await waitFor(() => server.requests().some((r) => r.url.endsWith('/chunks/1') && r.answer), { what: 'the server to see the connection go' });
    assert.equal((await uploads.start(server, startBody(object))).status, 507, 'the upload still holds its reservation');

    await server.advanceClock(QUIET_MS - 2_000);
    assert.deepEqual(server.tempFiles(), [uploadId], 'not before 5 minutes');
    await server.advanceClock(4_000);
    assertNothingLeft(server);
    const next = await answer(await uploads.start(server, startBody(object)));
    assert.equal(next.status, 201, 'the reservation is freed');
});
