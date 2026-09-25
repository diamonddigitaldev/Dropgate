// Cancelled and abandoned uploads must leave nothing behind: no temp file, no
// stored file, no database record and no storage reservation.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer, waitFor } from './helpers/harness.mjs';
import { HOUR_MS, PAST_SESSION_EXPIRY_MS, initUpload, postJson, sendChunk } from './helpers/uploads.mjs';

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
