// How long an upload lasts: 5 minutes after its last request, or, paused,
// until the operator's pause length runs out. At its deadline it ends at
// once: its temp file and its storage reservation go, and it's 404 from then.
// A restart ends every upload, paused or not.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { startServer } from './helpers/harness.mjs';
import {
    MINUTE_MS, QUIET_MS, SMALL_CHUNKS, answer, fileBytes, plainObject, sendChunks, startBody, startUpload, uploads,
} from './helpers/dgup4.mjs';

const BASE = { ENABLE_UPLOAD: 'true', UPLOAD_CHUNK_SIZE_BYTES: SMALL_CHUNKS, RATE_LIMIT_MAX_REQUESTS: '0' };
// About 200 KB of storage: room for one of these uploads at a time.
const ONE_AT_A_TIME = '0.0002';
const NOT_FOUND = { status: 404, body: { code: 'NOT_FOUND', error: 'The server has no such upload.' } };
// A small allowance for the time a request takes, in ms.
const SLACK = 2_000;

const threeChunks = () => plainObject({ files: [{ name: 'paused.bin', bytes: fileBytes(2 * 65536 + 10_000) }] });

/** Whether the server would take another upload of `object`: a start, cancelled straight away. */
async function hasRoomFor(server, object) {
    const { status, body } = await answer(await uploads.start(server, startBody(object)));
    if (status === 201) await uploads.cancel(server, body.uploadId);
    return status === 201;
}

test('a pause keeps an upload for the pause length, a pause again renews it from then, and at its end the upload is gone', async (t) => {
    const server = await startServer({ env: { ...BASE, UPLOAD_MAX_STORAGE_GB: ONE_AT_A_TIME }, clock: true });
    t.after(server.stop);
    const object = threeChunks();
    const uploadId = await startUpload(server, object);
    await sendChunks(server, uploadId, object, 0, 1);

    const asked = Date.now();
    const paused = await answer(await uploads.pause(server, uploadId));
    assert.equal(paused.status, 200);
    assert.deepEqual(Object.keys(paused.body), ['paused', 'deadline']);
    assert.equal(paused.body.paused, true);
    assert.ok(Math.abs(paused.body.deadline - (asked + 60 * MINUTE_MS)) < SLACK, 'the deadline is 60 minutes on, the default');
    assert.equal((await answer(await uploads.status(server, uploadId))).body.paused, true);

    // Long past the 5 minutes a quiet upload has, and the status asked meanwhile doesn't renew a pause.
    await server.advanceClock(40 * MINUTE_MS);
    const status = await answer(await uploads.status(server, uploadId));
    assert.deepEqual(status.body, { chunks: 3, received: [[0, 0]], paused: true, deadline: paused.body.deadline });

    const again = await answer(await uploads.pause(server, uploadId));
    assert.ok(Math.abs(again.body.deadline - (paused.body.deadline + 40 * MINUTE_MS)) < SLACK, 'pausing again renews it from then');

    // A chunk sent before the deadline continues the upload.
    await server.advanceClock(59 * MINUTE_MS);
    await sendChunks(server, uploadId, object, 1, 2);
    const resumed = await answer(await uploads.status(server, uploadId));
    assert.equal(resumed.body.paused, false, 'a chunk resumes it');

    // Paused once more, then left past its deadline.
    await uploads.pause(server, uploadId);
    assert.equal(await hasRoomFor(server, object), false, 'the paused upload holds its reservation');
    await server.advanceClock(60 * MINUTE_MS - SLACK);
    assert.ok(server.tempFiles().includes(uploadId), 'not before its deadline');
    await server.advanceClock(2 * SLACK);
    assert.deepEqual(server.tempFiles(), [], 'its temp file went at its deadline');
    assert.equal(await hasRoomFor(server, object), true, 'and its reservation');
    assert.deepEqual(await answer(await uploads.resume(server, uploadId)), NOT_FOUND);
    assert.deepEqual(await answer(await uploads.chunk(server, uploadId, 2, object.chunks[2])), NOT_FOUND);
});

test('resume answers with the chunks held and a deadline 5 minutes on', async (t) => {
    const server = await startServer({ env: BASE, clock: true });
    t.after(server.stop);
    const object = threeChunks();
    const uploadId = await startUpload(server, object);
    await sendChunks(server, uploadId, object, 1, 2);
    await uploads.pause(server, uploadId);
    await server.advanceClock(30 * MINUTE_MS);

    const status = await answer(await uploads.status(server, uploadId));
    const resumed = await answer(await uploads.resume(server, uploadId));
    assert.equal(resumed.status, 200);
    assert.deepEqual(Object.keys(resumed.body), ['paused', 'deadline', 'received']);
    assert.equal(resumed.body.paused, false);
    assert.deepEqual(resumed.body.received, [[1, 1]]);
    // 30 minutes into a 60-minute pause, a quiet upload's 5 minutes are sooner.
    assert.ok(resumed.body.deadline < status.body.deadline - 20 * MINUTE_MS, 'the deadline is a quiet upload\'s again');

    await server.advanceClock(QUIET_MS + SLACK);
    assert.deepEqual(await answer(await uploads.status(server, uploadId)), NOT_FOUND, 'and it goes quiet like any other');
});

test('an upload that goes quiet ends 5 minutes after its last request, not before; a paused one beside it is kept', async (t) => {
    const server = await startServer({ env: { ...BASE, UPLOAD_MAX_PAUSE_MINUTES: '20' }, clock: true });
    t.after(server.stop);
    const object = threeChunks();
    const quiet = await startUpload(server, object);
    const paused = await startUpload(server, object);
    await sendChunks(server, quiet, object, 0, 1);
    await sendChunks(server, paused, object, 0, 1);
    await uploads.pause(server, paused);
    // The quiet one's last request.
    await uploads.status(server, quiet);

    await server.advanceClock(QUIET_MS - SLACK);
    assert.deepEqual(server.tempFiles().sort(), [quiet, paused].sort(), 'both are there a moment before 5 minutes');
    await server.advanceClock(2 * SLACK);
    assert.deepEqual(server.tempFiles(), [paused], 'the quiet one ended at 5 minutes');
    assert.deepEqual(await answer(await uploads.status(server, quiet)), NOT_FOUND);

    await server.advanceClock(15 * MINUTE_MS - 2 * SLACK);
    assert.deepEqual(server.tempFiles(), [paused], 'the paused one is kept to its deadline');
    await server.advanceClock(2 * SLACK);
    assert.deepEqual(server.tempFiles(), [], 'and ends at it');
    assert.deepEqual(await answer(await uploads.status(server, paused)), NOT_FOUND);
});

test('with UPLOAD_MAX_PAUSE_MINUTES=0, a pause is 409 PAUSE_DISABLED and the upload goes on unpaused', async (t) => {
    const server = await startServer({ env: { ...BASE, UPLOAD_MAX_PAUSE_MINUTES: '0' } });
    t.after(server.stop);
    const info = await (await fetch(`${server.baseUrl}/api/info`)).json();
    assert.equal(info.capabilities.upload.maxPauseMinutes, 0);

    const object = threeChunks();
    const uploadId = await startUpload(server, object);
    assert.deepEqual(await answer(await uploads.pause(server, uploadId)), {
        status: 409, body: { code: 'PAUSE_DISABLED', error: 'Pausing is turned off on this server.' },
    });
    assert.equal((await answer(await uploads.status(server, uploadId))).body.paused, false);
    await sendChunks(server, uploadId, object);
    assert.equal((await uploads.complete(server, uploadId)).status, 201);
});

test('a restart ends a paused upload, in persistent mode too: it\'s 404, its temp file is gone, and no database holds it', async (t) => {
    const server = await startServer({ env: { ...BASE, UPLOAD_PRESERVE_UPLOADS: 'true' } });
    t.after(server.stop);
    const object = threeChunks();
    const uploadId = await startUpload(server, object);
    await sendChunks(server, uploadId, object, 0, 2);
    assert.equal((await uploads.pause(server, uploadId)).status, 200);
    assert.deepEqual(server.tempFiles(), [uploadId]);

    await server.restart();
    assert.deepEqual(await answer(await uploads.resume(server, uploadId)), NOT_FOUND);
    assert.deepEqual(server.tempFiles(), []);
    const databases = fs.readdirSync(path.join(server.uploadsDir, 'db')).filter((f) => f.endsWith('.sqlite'));
    assert.ok(databases.includes('objects.sqlite'));
    for (const name of databases) {
        assert.ok(!JSON.stringify(server.records(name)).includes(uploadId), `${name} holds the upload`);
    }
    assert.deepEqual(server.records('objects.sqlite'), []);
});
