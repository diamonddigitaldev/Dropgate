// Dropgate 4's upload routes: the start and what it refuses, chunks that can
// be sent again, the status, the finish that can be asked again, and the
// cancel. Every error is JSON with a code.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { startServer } from './helpers/harness.mjs';
import {
    QUIET_MS, SMALL_CHUNKS, answer, contentDigest, encryptedObject, fileBytes, plainObject, sendChunks, startBody,
    startUpload, uploadObject, uploads,
} from './helpers/dgup4.mjs';

const MIB = 1024 * 1024;
const BASE = { ENABLE_UPLOAD: 'true', UPLOAD_CHUNK_SIZE_BYTES: SMALL_CHUNKS, RATE_LIMIT_MAX_REQUESTS: '0' };
const NOT_FOUND = { code: 'NOT_FOUND', error: 'The server has no such upload.' };

// Three chunks: two of 64 KiB and one of 10,000 bytes, unpadded.
const threeChunks = () => plainObject({ files: [{ name: 'notes.txt', bytes: fileBytes(2 * 65536 + 10_000) }] });
const twoFiles = () => encryptedObject({ files: [{ name: 'a.txt', bytes: fileBytes(70_000, 1) }, { name: 'b.txt', bytes: fileBytes(30_000, 2) }] });

describe('starting an upload', () => {
    let server;
    before(async () => {
        server = await startServer({ env: { ...BASE, UPLOAD_MAX_FILE_SIZE_MB: '1', UPLOAD_MAX_FILE_DOWNLOADS: '5' } });
    });
    after(() => server?.stop());

    const start = async (body) => answer(await uploads.start(server, body));

    test('answers 201 with the upload\'s ID, its chunks, the chunk size and a deadline 5 minutes on', async () => {
        const object = twoFiles();
        const asked = Date.now();
        const { status, body } = await start(startBody(object));
        assert.equal(status, 201);
        assert.deepEqual(Object.keys(body).sort(), ['chunkSize', 'chunks', 'deadline', 'uploadId']);
        assert.equal(body.chunks, object.chunks.length);
        assert.equal(body.chunkSize, 65536);
        assert.ok(body.deadline >= asked + QUIET_MS && body.deadline <= Date.now() + QUIET_MS, 'the deadline is 5 minutes on');
        assert.deepEqual(fs.readFileSync(path.join(server.tmpDir, body.uploadId)), object.header, 'the upload begins with its header');
    });

    test('a field that\'s missing or wrong is 400 INVALID_REQUEST, naming the field', async () => {
        const encrypted = startBody(twoFiles());
        const plain = startBody(threeChunks());
        const longName = 'é'.repeat(128);
        const cases = [
            [{ ...encrypted, encrypted: 'yes' }, 'encrypted'],
            [{ ...encrypted, size: 0 }, 'size'],
            [{ ...encrypted, size: 1.5 }, 'size'],
            [{ ...encrypted, header: encrypted.header.slice(0, -2) }, 'header'],
            [{ ...encrypted, header: `${encrypted.header.slice(0, -1)}=` }, 'header'],
            [{ ...encrypted, meta: undefined }, 'meta'],
            [{ ...encrypted, meta: 'AAAA' }, 'meta'],
            [{ ...encrypted, files: plain.files }, 'files'],
            [{ ...plain, header: encrypted.header }, 'header'],
            [{ ...plain, meta: encrypted.meta }, 'meta'],
            [{ ...plain, files: [] }, 'files'],
            [{ ...plain, files: [{ name: 'a/b.txt', size: plain.size }] }, 'files'],
            [{ ...plain, files: [{ name: 'a\\b.txt', size: plain.size }] }, 'files'],
            [{ ...plain, files: [{ name: ' ', size: plain.size }] }, 'files'],
            [{ ...plain, files: [{ name: 'tab\there.txt', size: plain.size }] }, 'files'],
            [{ ...plain, files: [{ name: longName, size: plain.size }] }, 'files'],
            [{ ...plain, files: [{ name: 'a.txt', size: plain.size - 1 }] }, 'files'],
            [{ ...plain, files: [{ name: 'a.txt', size: plain.size }, { name: 'empty.txt', size: 0 }] }, 'files'],
            [{ ...plain, files: Array.from({ length: 1001 }, (_, i) => ({ name: `${i}.txt`, size: 1 })), size: 1001 }, 'files'],
            [{ ...encrypted, lifetimeMs: -1 }, 'lifetimeMs'],
            [{ ...encrypted, lifetimeMs: undefined }, 'lifetimeMs'],
            [{ ...encrypted, maxDownloads: 1.5 }, 'maxDownloads'],
            [{ ...encrypted, manageTokenHash: encrypted.manageTokenHash.slice(1) }, 'manageTokenHash'],
            [{ ...encrypted, manageTokenHash: undefined }, 'manageTokenHash'],
            // No encrypted object can be these sizes: a header and a tag with nothing in
            // between, and one whose last chunk would be a tag alone.
            [{ ...encrypted, size: 60 + 16 }, 'size'],
            [{ ...encrypted, size: 60 + (65536 + 16) + 16 }, 'size'],
            // More than 100,000 chunks.
            [{ ...plain, size: 100_000 * 65536 + 1, files: [{ name: 'huge.bin', size: 100_000 * 65536 + 1 }] }, 'size'],
        ];
        for (const [body, field] of cases) {
            assert.deepEqual(await start(body), {
                status: 400, body: { code: 'INVALID_REQUEST', error: 'A field of the request is missing or wrong.', details: { field } },
            }, `${field}: ${JSON.stringify(body).slice(0, 160)}`);
        }
        assert.deepEqual(await start([]), { status: 400, body: { code: 'INVALID_REQUEST', error: 'A field of the request is missing or wrong.' } });
        assert.deepEqual(server.tempFiles().length, 1, 'only the upload that was started is there');
    });

    test('a header that isn\'t Dropgate 4\'s is 400 UNSUPPORTED_OBJECT, and another chunk size 400 CHUNK_SIZE_MISMATCH', async () => {
        const unsupported = { code: 'UNSUPPORTED_OBJECT', error: 'This upload is in a format this server doesn\'t store.' };
        for (const [at, value] of [[0, 0x45], [4, 3], [5, 2], [6, 1], [7, 1]]) {
            const body = startBody(twoFiles());
            const header = Buffer.from(body.header, 'base64url');
            header[at] = value;
            assert.deepEqual(await start({ ...body, header: header.toString('base64url') }), { status: 400, body: unsupported }, `byte ${at}`);
        }
        const other = encryptedObject({ files: [{ name: 'a.txt', bytes: fileBytes(10) }], chunkSize: 131072 });
        assert.deepEqual(await start(startBody(other)), {
            status: 400, body: { code: 'CHUNK_SIZE_MISMATCH', error: 'This upload\'s chunk size isn\'t the server\'s.' },
        });
    });

    test('the size limit is for the whole upload, padding and all, in 1024s: 413 TOO_LARGE over it', async () => {
        const tooLarge = { status: 413, body: { code: 'TOO_LARGE', error: 'This upload is over the server\'s limit of 1 MB.' } };
        // Two files of 600 KiB, each under 1 MB, are over it together.
        const bundle = plainObject({ files: [{ name: 'one.bin', bytes: fileBytes(600 * 1024, 1) }, { name: 'two.bin', bytes: fileBytes(600 * 1024, 2) }] });
        assert.deepEqual(await start(startBody(bundle)), tooLarge);
        // Exactly 1 MB is within it.
        assert.equal((await start(startBody(plainObject({ files: [{ name: 'mb.bin', bytes: fileBytes(MIB) }] })))).status, 201);

        // Files under the limit whose object, once padded, is over it; and the same, padded only up to the limit.
        const files = [{ name: 'one.bin', bytes: fileBytes(520_000, 1) }, { name: 'two.bin', bytes: fileBytes(520_000, 2) }];
        const padded = encryptedObject({ files });
        assert.ok(padded.size > MIB && 1_040_000 < MIB, 'the files are under the limit, and the padded object over it');
        assert.deepEqual(await start(startBody(padded)), tooLarge);
        const clamped = encryptedObject({ files, maxBytes: MIB });
        assert.equal(clamped.size, MIB);
        assert.equal((await start(startBody(clamped))).status, 201);
    });

    test('a lifetime or download limit over the server\'s is refused, with its own code', async () => {
        const body = startBody(twoFiles());
        const lifetime = (error) => ({ status: 400, body: { code: 'LIFETIME_NOT_ALLOWED', error } });
        assert.deepEqual(await start({ ...body, lifetimeMs: 0 }), lifetime('This server doesn\'t keep uploads without a limit: at most 24 hours.'));
        assert.deepEqual(await start({ ...body, lifetimeMs: 25 * 60 * 60 * 1000 }), lifetime('This server keeps uploads for at most 24 hours.'));
        const downloads = (error) => ({ status: 400, body: { code: 'DOWNLOADS_NOT_ALLOWED', error } });
        assert.deepEqual(await start({ ...body, maxDownloads: 0 }), downloads('This server doesn\'t allow unlimited downloads: at most 5.'));
        assert.deepEqual(await start({ ...body, maxDownloads: 6 }), downloads('This server allows at most 5 downloads.'));
        assert.equal((await start({ ...body, maxDownloads: 5 })).status, 201);
    });

    test('a request that names no upload, or one the server doesn\'t have, is 404 NOT_FOUND on every route', async () => {
        for (const uploadId of [undefined, '00000000-0000-4000-8000-000000000000']) {
            for (const res of [
                await uploads.chunk(server, uploadId, 0, fileBytes(10)),
                await uploads.status(server, uploadId),
                await uploads.pause(server, uploadId),
                await uploads.resume(server, uploadId),
                await uploads.complete(server, uploadId),
                await uploads.cancel(server, uploadId),
            ]) {
                assert.deepEqual(await answer(res), { status: 404, body: NOT_FOUND }, `${res.url}, naming ${uploadId}`);
                assert.equal(res.headers.get('cache-control'), 'no-store');
            }
        }
    });
});

test('with E2EE off, an encrypted upload is 400 E2EE_DISABLED, and an unencrypted one starts', async (t) => {
    const server = await startServer({ env: { ...BASE, UPLOAD_ENABLE_E2EE: 'false' } });
    t.after(server.stop);
    assert.deepEqual(await answer(await uploads.start(server, startBody(twoFiles()))), {
        status: 400, body: { code: 'E2EE_DISABLED', error: 'This server doesn\'t accept encrypted uploads.' },
    });
    assert.equal((await uploads.start(server, startBody(threeChunks()))).status, 201);
});

test('the storage reserved for uploads in progress counts: 507 SERVER_FULL when there\'s no room, until one is cancelled', async (t) => {
    // About 200 KB of storage: room for one three-chunk upload at a time.
    const server = await startServer({ env: { ...BASE, UPLOAD_MAX_STORAGE_GB: '0.0002' } });
    t.after(server.stop);
    const first = await startUpload(server, threeChunks());
    const full = { status: 507, body: { code: 'SERVER_FULL', error: 'The server is out of space. Try again later.' } };
    assert.deepEqual(await answer(await uploads.start(server, startBody(threeChunks()))), full);
    assert.equal((await uploads.cancel(server, first)).status, 204);
    const { id } = await uploadObject(server, threeChunks());
    assert.ok(id, 'the cancel freed its reservation');
    assert.deepEqual(await answer(await uploads.start(server, startBody(threeChunks()))), full, 'and the stored upload counts');
});

describe('chunks', () => {
    let server;
    before(async () => {
        server = await startServer({ env: BASE });
    });
    after(() => server?.stop());

    test('chunks can come in any order, each written where it goes', async () => {
        const object = twoFiles();
        const uploadId = await startUpload(server, object);
        for (const i of [1, 0]) {
            const { status, body } = await answer(await uploads.chunk(server, uploadId, i, object.chunks[i]));
            assert.equal(status, 200);
            assert.deepEqual(Object.keys(body), ['deadline']);
        }
        assert.deepEqual(fs.readFileSync(path.join(server.tmpDir, uploadId)), object.bytes);
    });

    test('the same bytes again are 200 and not written again; different bytes are 409 CHUNK_CONFLICT', async () => {
        const object = threeChunks();
        const uploadId = await startUpload(server, object);
        await sendChunks(server, uploadId, object, 0, 1);

        // Change what's on disk: a chunk written again would put it back.
        const temp = path.join(server.tmpDir, uploadId);
        const changed = Buffer.alloc(65536, 0xee);
        fs.writeFileSync(temp, changed);
        assert.equal((await uploads.chunk(server, uploadId, 0, object.chunks[0])).status, 200);
        assert.deepEqual(fs.readFileSync(temp), changed, 'the chunk was written again');

        const different = Buffer.from(object.chunks[0]);
        different[0] ^= 1;
        assert.deepEqual(await answer(await uploads.chunk(server, uploadId, 0, different)), {
            status: 409, body: { code: 'CHUNK_CONFLICT', error: 'The server already holds different bytes for that chunk.' },
        });
        assert.deepEqual(fs.readFileSync(temp), changed);
    });

    test('a Content-Digest that\'s missing, malformed or wrong is 400 DIGEST_MISMATCH, and nothing is written', async () => {
        const object = threeChunks();
        const uploadId = await startUpload(server, object);
        const mismatch = { status: 400, body: { code: 'DIGEST_MISMATCH', error: 'The chunk\'s Content-Digest is missing, or doesn\'t match its bytes.' } };
        const other = contentDigest(Buffer.from('other bytes'));
        for (const digest of [null, other, other.replace('sha-256', 'sha-512'), 'sha-256=:abc:', `sha-256=${other.slice(9, -1)}`]) {
            assert.deepEqual(await answer(await uploads.chunk(server, uploadId, 0, object.chunks[0], { digest })), mismatch, String(digest));
        }
        // Another algorithm beside it is fine.
        const both = `sha-512=:${Buffer.alloc(64).toString('base64')}:, ${contentDigest(object.chunks[0])}`;
        assert.equal((await uploads.chunk(server, uploadId, 0, object.chunks[0], { digest: both })).status, 200);
        assert.deepEqual(await answer(await uploads.status(server, uploadId)).then((a) => a.body.received), [[0, 0]]);
    });

    test('an index out of range, or a chunk of the wrong length, is 400 INVALID_CHUNK', async () => {
        const object = threeChunks();
        const uploadId = await startUpload(server, object);
        const noSuch = { status: 400, body: { code: 'INVALID_CHUNK', error: 'There is no chunk with that index in this upload.' } };
        for (const index of ['3', '-1', 'x', '1.0', '0x1', '9999999']) {
            assert.deepEqual(await answer(await uploads.chunk(server, uploadId, index, object.chunks[0])), noSuch, index);
        }
        const wrong = { status: 400, body: { code: 'INVALID_CHUNK', error: 'That chunk is the wrong length.' } };
        const short = object.chunks[0].subarray(1);
        const long = Buffer.concat([object.chunks[2], Buffer.alloc(1)]);
        assert.deepEqual(await answer(await uploads.chunk(server, uploadId, 0, short)), wrong, 'one byte short');
        assert.deepEqual(await answer(await uploads.chunk(server, uploadId, 2, long)), wrong, 'one byte over');
        assert.deepEqual(await answer(await uploads.chunk(server, uploadId, 0, object.chunks[2])), wrong, 'the last chunk\'s length');
        assert.deepEqual(await answer(await uploads.status(server, uploadId)).then((a) => a.body.received), []);
    });
});

describe('the status, the finish and the cancel', () => {
    let server;
    before(async () => {
        server = await startServer({ env: { ...BASE, UPLOAD_PRESERVE_UPLOADS: 'true' }, clock: true, requests: true });
    });
    after(() => server?.stop());

    test('the status gives the chunks held, as ranges, whether it\'s paused, and the deadline', async () => {
        const object = plainObject({ files: [{ name: 'six.bin', bytes: fileBytes(5 * 65536 + 1) }] });
        const uploadId = await startUpload(server, object);
        for (const i of [0, 1, 3, 5]) await sendChunks(server, uploadId, object, i, i + 1);
        const { status, body } = await answer(await uploads.status(server, uploadId));
        assert.equal(status, 200);
        assert.deepEqual({ ...body, deadline: typeof body.deadline }, { chunks: 6, received: [[0, 1], [3, 3], [5, 5]], paused: false, deadline: 'number' });
    });

    test('finishing before every chunk is 409 UPLOAD_INCOMPLETE with what\'s held; then 201, and the same again', async () => {
        const object = threeChunks();
        const uploadId = await startUpload(server, object);
        await sendChunks(server, uploadId, object, 0, 2);
        assert.deepEqual(await answer(await uploads.complete(server, uploadId)), {
            status: 409,
            body: { code: 'UPLOAD_INCOMPLETE', error: 'The server doesn\'t hold every chunk of this upload yet.', details: { received: [[0, 1]] } },
        });

        await sendChunks(server, uploadId, object, 2);
        const first = await answer(await uploads.complete(server, uploadId));
        assert.equal(first.status, 201);
        assert.deepEqual(Object.keys(first.body), ['id']);
        assert.deepEqual(await answer(await uploads.complete(server, uploadId)), first, 'finishing again gets the same answer');
        assert.deepEqual(fs.readFileSync(path.join(server.uploadsDir, 'objects', first.body.id)), object.bytes);
        assert.ok(!server.tempFiles().includes(uploadId), 'its temp file became the object');

        // It's finished: nothing else can change it, and a cancel never removes it.
        for (const res of [
            await uploads.chunk(server, uploadId, 0, object.chunks[0]), await uploads.status(server, uploadId),
            await uploads.pause(server, uploadId), await uploads.resume(server, uploadId), await uploads.cancel(server, uploadId),
        ]) {
            assert.deepEqual(await answer(res), { status: 404, body: NOT_FOUND }, res.url);
        }
        assert.ok(server.storedFiles().includes(`objects/${first.body.id}`));

        // The answer is kept 5 minutes.
        await server.advanceClock(QUIET_MS - 1_000);
        assert.deepEqual(await answer(await uploads.complete(server, uploadId)), first);
        await server.advanceClock(2_000);
        assert.deepEqual(await answer(await uploads.complete(server, uploadId)), { status: 404, body: NOT_FOUND });
        assert.ok(server.storedFiles().includes(`objects/${first.body.id}`), 'the upload itself stays');
    });

    test('two finishes at once store one object, and both get its ID', async () => {
        const object = twoFiles();
        const uploadId = await startUpload(server, object);
        await sendChunks(server, uploadId, object);
        const before = server.storedFiles().length;
        const [a, b] = await Promise.all([uploads.complete(server, uploadId), uploads.complete(server, uploadId)].map((p) => p.then(answer)));
        assert.equal(a.status, 201);
        assert.deepEqual(b, a);
        assert.equal(server.storedFiles().length, before + 1);
    });

    test('a cancel is 204, and the upload\'s temp file goes; after it, the upload is 404', async () => {
        const object = threeChunks();
        const uploadId = await startUpload(server, object);
        await sendChunks(server, uploadId, object, 0, 1);
        const cancelled = await uploads.cancel(server, uploadId);
        assert.equal(cancelled.status, 204);
        assert.equal(await cancelled.text(), '');
        assert.ok(!server.tempFiles().includes(uploadId));
        assert.deepEqual(await answer(await uploads.chunk(server, uploadId, 1, object.chunks[1])), { status: 404, body: NOT_FOUND });
        assert.deepEqual(await answer(await uploads.cancel(server, uploadId)), { status: 404, body: NOT_FOUND });
    });

    test('an upload\'s ID is never in a URL, nor in its record', async () => {
        const mark = server.requests().length;
        const { uploadId, id } = await uploadObject(server, twoFiles());
        await uploads.status(server, uploadId);
        const sent = server.requests().slice(mark);
        assert.ok(sent.length >= 4);
        assert.deepEqual(sent.filter((r) => r.url.includes(uploadId)).map((r) => r.url), []);
        assert.ok(sent.every((r) => r.url === '/api/v4/uploads' || r.headers['dropgate-upload'] === uploadId), 'every later request names it in Dropgate-Upload');
        const [record] = server.records('objects.sqlite').filter((r) => r.id === id);
        assert.ok(!JSON.stringify(record).includes(uploadId));
    });
});

test('an upload\'s later requests skip the rate limit; a start, or a request for an upload the server doesn\'t have, doesn\'t', async (t) => {
    const server = await startServer({ env: { ...BASE, RATE_LIMIT_MAX_REQUESTS: '2' } });
    t.after(server.stop);
    const object = plainObject({ files: [{ name: 'many.bin', bytes: fileBytes(12 * 65536) }] });
    const uploadId = await startUpload(server, object);
    await sendChunks(server, uploadId, object);
    for (let i = 0; i < 5; i++) assert.equal((await uploads.status(server, uploadId)).status, 200);
    assert.equal((await uploads.complete(server, uploadId)).status, 201);
    assert.equal((await uploads.complete(server, uploadId)).status, 201, 'a repeated finish too');

    assert.equal((await uploads.start(server, startBody(object))).status, 201, 'the second start is within the limit');
    const limited = await answer(await uploads.start(server, startBody(object)));
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, 'RATE_LIMITED');
    assert.equal((await uploads.status(server, '00000000-0000-4000-8000-000000000000')).status, 429);
});
