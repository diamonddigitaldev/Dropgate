// How long an upload lasts: 5 minutes after the last chunk it didn't hold
// (after its start, until one comes), or, paused after one, until the
// operator's pause length runs out. Nothing else keeps it: asking about it,
// pausing it again with no chunk since, or sending what it already holds. At
// its deadline it ends at once: its temp file and its storage reservation go,
// and it's 404 from then. A restart ends every upload, paused or not.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { startServer } from './helpers/harness.mjs';
import {
    MINUTE_MS, QUIET_MS, SMALL_CHUNKS, answer, contentDigest, fileBytes, manageToken, plainObject, sendChunks, startBody, startUpload, uploads,
} from './helpers/dgup4.mjs';

const BASE = { ENABLE_UPLOAD: 'true', UPLOAD_CHUNK_SIZE_BYTES: SMALL_CHUNKS, RATE_LIMIT_MAX_REQUESTS: '0' };
// About 200 KB of storage: room for one of these uploads at a time.
const ONE_AT_A_TIME = '0.0002';
const NOT_FOUND = { status: 404, body: { code: 'NOT_FOUND', error: 'The server has no such upload.' } };
// A small allowance for the time a request takes, in ms.
const SLACK = 2_000;
const MIB = 1024 * 1024;

const threeChunks = () => plainObject({ files: [{ name: 'paused.bin', bytes: fileBytes(2 * 65536 + 10_000) }] });

/** Whether the server would take another upload of `object`: a start, cancelled straight away. */
async function hasRoomFor(server, object) {
    const { status, body } = await answer(await uploads.start(server, startBody(object)));
    if (status === 201) await uploads.cancel(server, body.uploadId);
    return status === 201;
}

/** Every request a client can make of an upload but sending it a chunk it lacks, each answered as it would be. */
async function askEverything(server, uploadId, object, { held = null } = {}) {
    assert.equal((await uploads.status(server, uploadId)).status, 200, 'status');
    assert.equal((await uploads.resume(server, uploadId)).status, 200, 'resume');
    assert.equal((await uploads.complete(server, uploadId)).status, 409, 'finishing early');
    assert.equal((await uploads.chunk(server, uploadId, 2, object.chunks[2], { digest: contentDigest(Buffer.from('other')) })).status, 400, 'a chunk with a wrong digest');
    assert.equal((await uploads.chunk(server, uploadId, 2, object.chunks[2].subarray(1))).status, 400, 'a chunk too short');
    if (held !== null) assert.equal((await uploads.chunk(server, uploadId, held, object.chunks[held])).status, 200, 'a chunk it holds, again');
}

test('uploads that send nothing hold the storage no longer than their first 5 minutes, whatever they ask, and an honest upload is then taken', async (t) => {
    // Ten clients, each starting 100 MiB of a 1 GiB server and sending no byte of it.
    const server = await startServer({
        clock: true,
        env: { ...BASE, UPLOAD_CHUNK_SIZE_BYTES: String(5 * MIB), UPLOAD_MAX_STORAGE_GB: '1', UPLOAD_MAX_FILE_SIZE_MB: '100', TRUST_PROXY: '1' },
    });
    t.after(server.stop);
    const reserve = (n, size) => ({
        encrypted: false, size, files: [{ name: `reserve-${n}.bin`, size }], lifetimeMs: 60 * MINUTE_MS, manageTokenHash: manageToken().hash,
    });
    const held = [];
    for (let n = 0; n < 10; n++) {
        const { status, body } = await answer(await uploads.start(server, reserve(n, 100 * MIB), { 'X-Forwarded-For': `198.51.100.${n + 1}` }));
        assert.equal(status, 201);
        held.push(body.uploadId);
    }
    const honest = async () => (await answer(await uploads.start(server, reserve(99, 30 * MIB), { 'X-Forwarded-For': '203.0.113.99' }))).status;
    assert.equal(await honest(), 507, 'while they hold it, an honest 30 MiB upload is refused SERVER_FULL');

    // Each asks about itself and pauses itself every 2 minutes, as a client keeping it would.
    for (let minute = 2; minute <= 4; minute += 2) {
        await server.advanceClock(2 * MINUTE_MS);
        for (const id of held) {
            assert.equal((await uploads.status(server, id)).status, 200);
            assert.equal((await uploads.pause(server, id)).status, 200);
        }
    }
    await server.advanceClock(MINUTE_MS + SLACK);
    for (const id of held) assert.deepEqual(await answer(await uploads.status(server, id)), NOT_FOUND, 'each ended 5 minutes after its start');
    assert.deepEqual(server.tempFiles(), [], 'their temp files went');
    assert.equal(await honest(), 201, 'and an honest upload is taken');
});

test('an upload that has received nothing ends 5 minutes after its start, whatever it is asked, and a pause holds it no longer', async (t) => {
    const server = await startServer({ env: BASE, clock: true });
    t.after(server.stop);
    const object = threeChunks();
    const started = Date.now();
    const uploadId = await startUpload(server, object);

    await server.advanceClock(4 * MINUTE_MS);
    await askEverything(server, uploadId, object);
    const paused = await answer(await uploads.pause(server, uploadId));
    assert.equal(paused.status, 200);
    assert.equal(paused.body.paused, true, 'it\'s paused');
    assert.ok(Math.abs(paused.body.deadline - (started + QUIET_MS)) < SLACK, 'but its deadline stays 5 minutes from its start');
    assert.equal((await answer(await uploads.pause(server, uploadId))).body.deadline, paused.body.deadline, 'and pausing again doesn\'t move it');

    await server.advanceClock(MINUTE_MS - SLACK);
    assert.ok(server.tempFiles().includes(uploadId), 'not before its deadline');
    await server.advanceClock(2 * SLACK);
    assert.deepEqual(server.tempFiles(), [], 'gone at it');
    assert.deepEqual(await answer(await uploads.resume(server, uploadId)), NOT_FOUND);
});

test('once a chunk has come, only another it didn\'t hold renews its 5 minutes: the same chunk again, a wrong one, status, resume and finishing early don\'t', async (t) => {
    const server = await startServer({ env: BASE, clock: true });
    t.after(server.stop);
    const object = threeChunks();
    const uploadId = await startUpload(server, object);
    await server.advanceClock(2 * MINUTE_MS);
    // The server's clock, moved on.
    const sent = Date.now() + 2 * MINUTE_MS;
    const chunked = await answer(await uploads.chunk(server, uploadId, 0, object.chunks[0]));
    assert.equal(chunked.status, 200);
    assert.ok(Math.abs(chunked.body.deadline - (sent + QUIET_MS)) < SLACK, 'a new chunk gives it 5 minutes from then');

    await server.advanceClock(4 * MINUTE_MS);
    await askEverything(server, uploadId, object, { held: 0 });
    assert.equal((await answer(await uploads.status(server, uploadId))).body.deadline, chunked.body.deadline, 'its deadline hasn\'t moved');

    await server.advanceClock(MINUTE_MS - SLACK);
    assert.ok(server.tempFiles().includes(uploadId), 'not before 5 minutes from its last chunk');
    await server.advanceClock(2 * SLACK);
    assert.deepEqual(server.tempFiles(), [], 'gone at them');
    assert.deepEqual(await answer(await uploads.status(server, uploadId)), NOT_FOUND);
});

test('a pause after a chunk keeps an upload for the pause length; pausing again renews it only once another chunk has come; at its end the upload is gone', async (t) => {
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
    assert.equal((await answer(await uploads.pause(server, uploadId))).body.deadline, paused.body.deadline, 'pausing again with no chunk since keeps its deadline');

    // A chunk sent before the deadline continues the upload, and a pause after it renews from then.
    await server.advanceClock(19 * MINUTE_MS);
    await sendChunks(server, uploadId, object, 1, 2);
    const resumed = await answer(await uploads.status(server, uploadId));
    assert.equal(resumed.body.paused, false, 'a chunk resumes it');
    // The server's clock, moved on 59 minutes.
    const askedAgain = Date.now() + 59 * MINUTE_MS;
    const again = await answer(await uploads.pause(server, uploadId));
    assert.ok(Math.abs(again.body.deadline - (askedAgain + 60 * MINUTE_MS)) < SLACK, 'pausing after a chunk renews it from then');

    // Then left past its deadline.
    assert.equal(await hasRoomFor(server, object), false, 'the paused upload holds its reservation');
    await server.advanceClock(60 * MINUTE_MS - SLACK);
    assert.ok(server.tempFiles().includes(uploadId), 'not before its deadline');
    await server.advanceClock(2 * SLACK);
    assert.deepEqual(server.tempFiles(), [], 'its temp file went at its deadline');
    assert.equal(await hasRoomFor(server, object), true, 'and its reservation');
    assert.deepEqual(await answer(await uploads.resume(server, uploadId)), NOT_FOUND);
    assert.deepEqual(await answer(await uploads.chunk(server, uploadId, 2, object.chunks[2])), NOT_FOUND);
});

test('resume answers with the chunks held and keeps the pause\'s deadline; its next chunk gives it a quiet 5 minutes again', async (t) => {
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
    assert.equal(resumed.body.deadline, status.body.deadline, 'resuming doesn\'t move the deadline');

    // The server's clock, moved on 30 minutes.
    const sent = Date.now() + 30 * MINUTE_MS;
    const chunked = await answer(await uploads.chunk(server, uploadId, 0, object.chunks[0]));
    assert.ok(Math.abs(chunked.body.deadline - (sent + QUIET_MS)) < SLACK, 'the next chunk makes it a quiet upload\'s again');
    await server.advanceClock(QUIET_MS + SLACK);
    assert.deepEqual(await answer(await uploads.status(server, uploadId)), NOT_FOUND, 'and it goes quiet like any other');
});

test('pausing, resuming and pausing again with no chunk between keeps an upload no later than its first pause gave', async (t) => {
    const server = await startServer({ env: BASE, clock: true });
    t.after(server.stop);
    const object = threeChunks();
    const uploadId = await startUpload(server, object);
    await sendChunks(server, uploadId, object, 0, 1);
    const { deadline } = (await answer(await uploads.pause(server, uploadId))).body;
    for (let step = 0; step < 5; step++) {
        await server.advanceClock(11 * MINUTE_MS);
        assert.equal((await answer(await uploads.resume(server, uploadId))).body.deadline, deadline, 'resume');
        assert.equal((await answer(await uploads.pause(server, uploadId))).body.deadline, deadline, 'and pause again');
    }
    await server.advanceClock(5 * MINUTE_MS + SLACK);
    assert.deepEqual(await answer(await uploads.status(server, uploadId)), NOT_FOUND, 'gone at the first pause\'s deadline');
});

test('a chunk already on its way when a pause comes is kept and leaves the upload paused; one sent while paused resumes it', async (t) => {
    const server = await startServer({ env: BASE });
    t.after(server.stop);
    const object = threeChunks();
    const uploadId = await startUpload(server, object);

    // Chunk 0's first half reaches the server, then the pause, then the rest of it.
    const chunk = object.chunks[0];
    let more;
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(chunk.subarray(0, 1000));
            more = () => { controller.enqueue(chunk.subarray(1000)); controller.close(); };
        },
    });
    const sent = fetch(`${server.baseUrl}/api/v4/upload/chunks/0`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(chunk.length), 'Content-Digest': contentDigest(chunk), 'Dropgate-Upload': uploadId },
        body,
        duplex: 'half',
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const paused = await answer(await uploads.pause(server, uploadId));
    assert.equal(paused.status, 200);
    more();
    assert.equal((await sent).status, 200);

    const status = await answer(await uploads.status(server, uploadId));
    assert.deepEqual(status.body, { chunks: 3, received: [[0, 0]], paused: true, deadline: paused.body.deadline }, 'still paused, with its deadline');

    await sendChunks(server, uploadId, object, 1, 2);
    assert.equal((await answer(await uploads.status(server, uploadId))).body.paused, false, 'a chunk sent while paused resumes it');
});

test('an upload that goes quiet ends 5 minutes after its last chunk, not before, however often it asks meanwhile; a paused one beside it is kept', async (t) => {
    const server = await startServer({ env: { ...BASE, UPLOAD_MAX_PAUSE_MINUTES: '20' }, clock: true });
    t.after(server.stop);
    const object = threeChunks();
    const quiet = await startUpload(server, object);
    const paused = await startUpload(server, object);
    await sendChunks(server, quiet, object, 0, 1);
    await sendChunks(server, paused, object, 0, 1);
    await uploads.pause(server, paused);

    await server.advanceClock(2 * MINUTE_MS);
    await uploads.status(server, quiet);
    await server.advanceClock(3 * MINUTE_MS - 2 * SLACK);
    assert.deepEqual(server.tempFiles().sort(), [quiet, paused].sort(), 'both are there a moment before 5 minutes');
    await server.advanceClock(3 * SLACK);
    assert.deepEqual(server.tempFiles(), [paused], 'the quiet one ended 5 minutes after its chunk, its status asked meanwhile');
    assert.deepEqual(await answer(await uploads.status(server, quiet)), NOT_FOUND);

    await server.advanceClock(15 * MINUTE_MS - 3 * SLACK);
    assert.deepEqual(server.tempFiles(), [paused], 'the paused one is kept to its deadline');
    await server.advanceClock(3 * SLACK);
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
