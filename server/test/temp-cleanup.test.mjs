// Cancelled and abandoned uploads must leave nothing behind: no temp file, no
// stored file, no database record and no storage reservation.
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { startServer, waitFor } from './helpers/harness.mjs';
import {
    QUIET_MS, SMALL_CHUNKS, answer, contentDigest, encryptedObject, fileBytes, plainObject, sendChunks, startBody,
    startUpload, uploads,
} from './helpers/dgup4.mjs';

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
