// Dropgate 4's downloads: an upload's metadata, which takes and counts
// nothing; leases, each one download, counted once when it ends if it served
// any byte; the bytes, whole or by range; a browser's own downloads; and the
// uploader's delete. Every error is JSON with a code.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { startServer } from './helpers/harness.mjs';
import {
    HOUR_MS, MINUTE_MS, QUIET_MS, SMALL_CHUNKS, answer, bytesOf, downloads, encryptedObject, fileBytes, manageToken,
    openChunk, plainObject, startBody, takeLease, uploadObject, uploads,
} from './helpers/dgup4.mjs';

const CHUNK = Number(SMALL_CHUNKS);
// Persistent, so each test can read the records; and no server limit, so each upload sets its own.
const BASE = {
    ENABLE_UPLOAD: 'true', UPLOAD_CHUNK_SIZE_BYTES: SMALL_CHUNKS, RATE_LIMIT_MAX_REQUESTS: '0',
    UPLOAD_PRESERVE_UPLOADS: 'true', UPLOAD_MAX_FILE_DOWNLOADS: '0',
};
const NOT_FOUND = { status: 404, body: { code: 'NOT_FOUND', error: 'The server has no such upload.' } };
// A small allowance for the time a request takes, in ms.
const SLACK = 2_000;

// How oneFile()'s name is sent, as Dropgate 3 sends a name: as itself in filename*, and in
// filename with a ? for each character that isn't printable ASCII.
const NAMED = 'attachment; filename="notes ? ?t?.txt"; filename*=UTF-8\'\'notes%20%E2%80%93%20%C3%A9t%C3%A9.txt';
const oneFile = () => plainObject({ files: [{ name: 'notes – été.txt', bytes: fileBytes(2 * CHUNK + 10_000, 1) }] });
const twoPlainFiles = () => plainObject({ files: [{ name: 'a.txt', bytes: fileBytes(70_000, 2) }, { name: 'b.txt', bytes: fileBytes(30_000, 3) }] });
const twoFiles = () => encryptedObject({ files: [{ name: 'a.txt', bytes: fileBytes(70_000, 4) }, { name: 'b.txt', bytes: fileBytes(90_000, 5) }] });

/** The record the server keeps for the upload `id`, or undefined once it's gone. */
const recordOf = (server, id) => server.records('objects.sqlite').find((r) => r.id === id)?.value;
const objectFile = (server, id) => path.join(server.uploadsDir, 'objects', id);

/** The whole of an upload's bytes under `lease`, as a client would fetch them. */
const fetchAll = async (server, id, lease) => {
    const got = await bytesOf(await downloads.content(server, id, lease));
    assert.equal(got.status, 200);
    return got.bytes;
};

/** Whether the server would take another upload of `object`: a start, cancelled straight away. */
async function hasRoomFor(server, object) {
    const { status, body } = await answer(await uploads.start(server, startBody(object)));
    if (status === 201) await uploads.cancel(server, body.uploadId);
    return status === 201;
}

describe('an upload\'s metadata', () => {
    let server;
    before(async () => { server = await startServer({ env: BASE }); });
    after(() => server?.stop());

    test('an encrypted upload\'s gives its size, its header from the object\'s first 60 bytes, and its sealed list', async () => {
        const object = twoFiles();
        const { id } = await uploadObject(server, object, { maxDownloads: 1 });
        assert.deepEqual(await answer(await downloads.metadata(server, id)), {
            status: 200,
            body: { encrypted: true, size: object.size, header: object.header.toString('base64url'), meta: object.meta.toString('base64url') },
        });
    });

    test('an unencrypted upload\'s gives its size and its files, and never the expiry or a count', async () => {
        const object = twoPlainFiles();
        const { id } = await uploadObject(server, object, { maxDownloads: 3 });
        const res = await downloads.metadata(server, id);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await answer(res), {
            status: 200, body: { encrypted: false, size: object.size, files: [{ name: 'a.txt', size: 70_000 }, { name: 'b.txt', size: 30_000 }] },
        });
    });

    test('asking takes no lease and counts nothing', async () => {
        const { id } = await uploadObject(server, oneFile(), { maxDownloads: 1 });
        for (let i = 0; i < 3; i++) assert.equal((await downloads.metadata(server, id)).status, 200);
        assert.equal(recordOf(server, id).downloadCount, 0);
        assert.equal((await downloads.take(server, id)).status, 201, 'a download can still take the limit\'s one place');
    });

    test('an unknown ID, one that isn\'t an upload\'s shape, and a deleted upload are 404 NOT_FOUND', async () => {
        const stored = await uploadObject(server, oneFile());
        assert.equal((await downloads.delete(server, stored.id, stored.manageToken)).status, 204);
        for (const id of [crypto.randomUUID(), 'not-an-id', stored.id]) {
            assert.deepEqual(await answer(await downloads.metadata(server, id)), NOT_FOUND, id);
            assert.deepEqual(await answer(await downloads.take(server, id)), NOT_FOUND, id);
        }
    });
});

describe('the download page', () => {
    let server;
    before(async () => { server = await startServer({ env: BASE }); });
    after(() => server?.stop());

    /**
     * A page's status, and whether it's the download page, the older-version page or the 404 page.
     * The 404 page also carries the older-version wording, for its script to show for a Dropgate 3 link.
     */
    const page = async (route) => {
        const res = await fetch(server.baseUrl + route, { redirect: 'manual' });
        const html = await res.text();
        const which = html.includes('src="/js/download.js"') ? 'download'
            : html.includes('File Not Found') ? '404'
                : html.includes('Link From an Older Version') ? 'older version' : 'something else';
        return { status: res.status, which };
    };

    test('is one page for a file and several alike, encrypted or not, over plain HTTP, and takes no lease', async () => {
        for (const object of [oneFile(), twoPlainFiles(), twoFiles()]) {
            const { id } = await uploadObject(server, object, { maxDownloads: 1 });
            assert.deepEqual(await page(`/${id}`), { status: 200, which: 'download' });
            assert.equal(recordOf(server, id).downloadCount, 0);
            assert.equal((await downloads.take(server, id)).status, 201, "the limit's one place is still there");
        }
        assert.deepEqual(await page(`/${crypto.randomUUID()}`), { status: 404, which: '404' });
    });

    test("a Dropgate 3 bundle's link is 410, with a page saying it's from an older version, whatever its ID", async () => {
        const { id } = await uploadObject(server, twoFiles());
        for (const route of [`/b/${crypto.randomUUID()}`, `/b/${id}`, '/b/not-an-id']) {
            assert.deepEqual(await page(route), { status: 410, which: 'older version' }, route);
        }
    });
});

test('an expired upload is gone from every route at once, open leases included, and its bytes go at the next sweep', async (t) => {
    const server = await startServer({ env: BASE, clock: true });
    t.after(server.stop);
    const stored = await uploadObject(server, oneFile(), { lifetimeMs: HOUR_MS });
    const lease = await takeLease(server, stored.id);
    // Paused, so the lease stays open past a quiet lease's 5 minutes.
    await downloads.pause(server, lease);
    await server.advanceClock(HOUR_MS - MINUTE_MS);
    assert.equal((await downloads.renew(server, lease)).status, 200, 'still there a minute before');

    await server.advanceClock(MINUTE_MS + SLACK);
    assert.deepEqual(await answer(await downloads.metadata(server, stored.id)), NOT_FOUND);
    assert.deepEqual(await answer(await downloads.take(server, stored.id)), NOT_FOUND);
    assert.deepEqual(await answer(await downloads.content(server, stored.id, lease)), NOT_FOUND);
    assert.deepEqual(await answer(await downloads.renew(server, lease)), NOT_FOUND);
    assert.deepEqual(await answer(await downloads.delete(server, stored.id, stored.manageToken)), NOT_FOUND);
    await server.advanceClock(MINUTE_MS);
    assert.equal(fs.existsSync(objectFile(server, stored.id)), false);
    assert.equal(recordOf(server, stored.id), undefined);
});

test('with E2EE turned off, an encrypted upload is 404 to downloads while an unencrypted one is served; its uploader can still delete it', async (t) => {
    const server = await startServer({ env: BASE });
    t.after(server.stop);
    const encrypted = await uploadObject(server, twoFiles());
    const plain = await uploadObject(server, oneFile());
    await server.restart({ env: { UPLOAD_ENABLE_E2EE: 'false' } });

    assert.deepEqual(await answer(await downloads.metadata(server, encrypted.id)), NOT_FOUND);
    assert.deepEqual(await answer(await downloads.take(server, encrypted.id)), NOT_FOUND);
    assert.equal((await downloads.metadata(server, plain.id)).status, 200);
    assert.equal((await downloads.take(server, plain.id)).status, 201);
    assert.equal((await downloads.delete(server, encrypted.id, encrypted.manageToken)).status, 204);
    assert.equal(fs.existsSync(objectFile(server, encrypted.id)), false);
});

test('metadata, leases and requests under a lease skip the rate limit for an upload that\'s there; anything else, and the delete, don\'t', async (t) => {
    const server = await startServer({ env: { ...BASE, RATE_LIMIT_MAX_REQUESTS: '3' } });
    t.after(server.stop);
    // The start is the first of the three.
    const stored = await uploadObject(server, oneFile());
    for (let i = 0; i < 6; i++) assert.equal((await downloads.metadata(server, stored.id)).status, 200);
    const leases = [];
    for (let i = 0; i < 6; i++) leases.push(await takeLease(server, stored.id));
    for (let i = 0; i < 6; i++) {
        assert.equal((await downloads.renew(server, leases[0])).status, 200);
        await bytesOf(await downloads.content(server, stored.id, leases[1], { Range: 'bytes=0-9' }));
        await bytesOf(await downloads.browser(server, leases[2], 0, { Range: 'bytes=0-9' }));
    }

    assert.equal((await downloads.metadata(server, crypto.randomUUID())).status, 404);
    assert.equal((await downloads.renew(server, manageToken().token)).status, 404);
    assert.equal((await downloads.take(server, crypto.randomUUID())).status, 429, 'the limit is reached');
    assert.equal((await downloads.delete(server, stored.id, stored.manageToken)).status, 429, 'the delete is limited');
    assert.equal((await downloads.renew(server, leases[0])).status, 200, 'a live lease still isn\'t');
});

describe('leases', () => {
    let server;
    before(async () => { server = await startServer({ env: BASE }); });
    after(() => server?.stop());

    test('taking one is 201 with a 32-byte lease, its deadline 5 minutes on, and the upload\'s ETag; each is new', async () => {
        const { id } = await uploadObject(server, oneFile());
        const asked = Date.now();
        const { status, body } = await answer(await downloads.take(server, id));
        assert.equal(status, 201);
        assert.deepEqual(Object.keys(body), ['lease', 'deadline', 'etag']);
        assert.match(body.lease, /^[A-Za-z0-9_-]{43}$/);
        assert.equal(Buffer.from(body.lease, 'base64url').length, 32);
        assert.ok(body.deadline >= asked + QUIET_MS && body.deadline <= Date.now() + QUIET_MS);
        assert.equal(body.etag, `"${id}"`);
        assert.notEqual(await takeLease(server, id), body.lease);
    });

    test('renew keeps it 5 more minutes; pause keeps it for the pause length; release is 204, and then it\'s 404 everywhere', async () => {
        const { id } = await uploadObject(server, oneFile());
        const lease = await takeLease(server, id);
        let asked = Date.now();
        const renewed = await answer(await downloads.renew(server, lease));
        assert.equal(renewed.status, 200);
        assert.deepEqual(Object.keys(renewed.body), ['deadline']);
        assert.ok(Math.abs(renewed.body.deadline - (asked + QUIET_MS)) < SLACK);

        asked = Date.now();
        const paused = await answer(await downloads.pause(server, lease));
        assert.equal(paused.status, 200);
        assert.deepEqual(Object.keys(paused.body), ['paused', 'deadline']);
        assert.equal(paused.body.paused, true);
        assert.ok(Math.abs(paused.body.deadline - (asked + 60 * MINUTE_MS)) < SLACK, 'the default pause, 60 minutes');

        const released = await downloads.release(server, lease);
        assert.equal(released.status, 204);
        assert.equal(await released.text(), '');
        assert.deepEqual(await answer(await downloads.renew(server, lease)), NOT_FOUND);
        assert.deepEqual(await answer(await downloads.pause(server, lease)), NOT_FOUND);
        assert.deepEqual(await answer(await downloads.release(server, lease)), NOT_FOUND);
        assert.deepEqual(await answer(await downloads.content(server, id, lease)), NOT_FOUND);
        assert.deepEqual(await answer(await downloads.browser(server, lease)), NOT_FOUND);
    });

    test('a lease route with no lease, or one the server never gave, is 404 NOT_FOUND', async () => {
        for (const lease of [undefined, '', manageToken().token]) {
            assert.deepEqual(await answer(await downloads.renew(server, lease)), NOT_FOUND);
            assert.deepEqual(await answer(await downloads.pause(server, lease)), NOT_FOUND);
            assert.deepEqual(await answer(await downloads.release(server, lease)), NOT_FOUND);
        }
    });

    test('the bytes with no lease are 400 LEASE_REQUIRED; with another upload\'s lease, 404', async () => {
        const { id } = await uploadObject(server, oneFile());
        const other = await uploadObject(server, oneFile());
        assert.deepEqual(await answer(await downloads.content(server, id)), {
            status: 400, body: { code: 'LEASE_REQUIRED', error: 'A download needs a lease, in the Dropgate-Lease header.' },
        });
        assert.deepEqual(await answer(await downloads.content(server, id, await takeLease(server, other.id))), NOT_FOUND);
    });
});

test('with UPLOAD_MAX_PAUSE_MINUTES=0, pausing a lease is 409 PAUSE_DISABLED and the lease goes on', async (t) => {
    const server = await startServer({ env: { ...BASE, UPLOAD_MAX_PAUSE_MINUTES: '0' } });
    t.after(server.stop);
    const object = oneFile();
    const { id } = await uploadObject(server, object);
    const lease = await takeLease(server, id);
    assert.deepEqual(await answer(await downloads.pause(server, lease)), {
        status: 409, body: { code: 'PAUSE_DISABLED', error: 'Pausing is turned off on this server.' },
    });
    assert.deepEqual(await fetchAll(server, id, lease), object.bytes);
});

test('no lease survives a restart: each is 404 after it, uncounted, and the upload takes new ones', async (t) => {
    const server = await startServer({ env: BASE });
    t.after(server.stop);
    const { id } = await uploadObject(server, oneFile(), { maxDownloads: 1 });
    const lease = await takeLease(server, id);
    await server.restart();
    assert.deepEqual(await answer(await downloads.renew(server, lease)), NOT_FOUND);
    assert.deepEqual(await answer(await downloads.content(server, id, lease)), NOT_FOUND);
    assert.equal(recordOf(server, id).downloadCount, 0);
    assert.equal((await downloads.take(server, id)).status, 201);
});

describe('counting downloads', () => {
    let server;
    before(async () => { server = await startServer({ env: BASE, clock: true }); });
    after(() => server?.stop());

    test('a download counts once, when its lease is released, not while it\'s open', async () => {
        const object = oneFile();
        const { id } = await uploadObject(server, object, { maxDownloads: 3 });
        const lease = await takeLease(server, id);
        assert.deepEqual(await fetchAll(server, id, lease), object.bytes);
        assert.equal(recordOf(server, id).downloadCount, 0, 'not while the lease is open');
        await downloads.release(server, lease);
        assert.equal(recordOf(server, id).downloadCount, 1);
    });

    test('retries, ranges and every file fetched under one lease count once together', async () => {
        const object = twoPlainFiles();
        const { id } = await uploadObject(server, object, { maxDownloads: 3 });
        const lease = await takeLease(server, id);
        await fetchAll(server, id, lease);
        await fetchAll(server, id, lease);
        await bytesOf(await downloads.content(server, id, lease, { Range: 'bytes=0-99' }));
        await bytesOf(await downloads.content(server, id, lease, { Range: 'bytes=100-' }));
        await bytesOf(await downloads.browser(server, lease, 0));
        await bytesOf(await downloads.browser(server, lease, 1));
        await downloads.release(server, lease);
        assert.equal(recordOf(server, id).downloadCount, 1);
    });

    test('a lease that served nothing counts nothing; one cancelled after any byte counts', async () => {
        const { id } = await uploadObject(server, oneFile(), { maxDownloads: 3 });
        const idle = await takeLease(server, id);
        await downloads.metadata(server, id);
        await downloads.renew(server, idle);
        await downloads.pause(server, idle);
        await downloads.release(server, idle);
        assert.equal(recordOf(server, id).downloadCount, 0);

        const cancelled = await takeLease(server, id);
        assert.equal((await bytesOf(await downloads.content(server, id, cancelled, { Range: 'bytes=0-9' }))).status, 206);
        await downloads.release(server, cancelled);
        assert.equal(recordOf(server, id).downloadCount, 1);
    });

    test('one abandoned part-way counts when its lease runs out, 5 minutes after its last request, not before', async () => {
        const { id } = await uploadObject(server, oneFile(), { maxDownloads: 3 });
        const lease = await takeLease(server, id);
        await bytesOf(await downloads.content(server, id, lease, { Range: 'bytes=0-999' }));
        await server.advanceClock(QUIET_MS - SLACK);
        assert.equal(recordOf(server, id).downloadCount, 0, 'not a moment before');
        assert.equal((await downloads.renew(server, lease)).status, 200, 'and the lease is still open');
        await server.advanceClock(QUIET_MS - SLACK);
        assert.equal(recordOf(server, id).downloadCount, 0, 'the renew gave it 5 more minutes');
        await server.advanceClock(2 * SLACK);
        assert.equal(recordOf(server, id).downloadCount, 1);
        assert.deepEqual(await answer(await downloads.renew(server, lease)), NOT_FOUND);
    });

    test('a paused one counts when the pause runs out, not after 5 minutes', async () => {
        // Kept longer than the pause, so it's there at the end of it.
        const { id } = await uploadObject(server, oneFile(), { maxDownloads: 3, lifetimeMs: 3 * HOUR_MS });
        const lease = await takeLease(server, id);
        await bytesOf(await downloads.content(server, id, lease, { Range: 'bytes=0-999' }));
        await downloads.pause(server, lease);
        await server.advanceClock(60 * MINUTE_MS - SLACK);
        assert.equal(recordOf(server, id).downloadCount, 0, 'not a moment before the pause\'s 60 minutes');
        await server.advanceClock(2 * SLACK);
        assert.equal(recordOf(server, id).downloadCount, 1);
        assert.deepEqual(await answer(await downloads.renew(server, lease)), NOT_FOUND);
    });

    test('a paused download continues under the same lease, by range, and counts once', async () => {
        const { id } = await uploadObject(server, oneFile(), { maxDownloads: 3 });
        const lease = await takeLease(server, id);
        await bytesOf(await downloads.content(server, id, lease, { Range: 'bytes=0-999' }));
        await downloads.pause(server, lease);
        await server.advanceClock(30 * MINUTE_MS);
        assert.equal((await bytesOf(await downloads.content(server, id, lease, { Range: 'bytes=1000-' }))).status, 206);
        await downloads.release(server, lease);
        assert.equal(recordOf(server, id).downloadCount, 1);
    });

    test('an upload with no limit keeps no count, and is never removed by downloads', async () => {
        const object = oneFile();
        const { id } = await uploadObject(server, object, { maxDownloads: 0 });
        for (let i = 0; i < 3; i++) {
            const lease = await takeLease(server, id);
            await fetchAll(server, id, lease);
            await downloads.release(server, lease);
        }
        assert.deepEqual(Object.keys(recordOf(server, id)).includes('downloadCount'), false);
        assert.equal(fs.existsSync(objectFile(server, id)), true);
    });
});

describe('the download limit', () => {
    let server;
    before(async () => { server = await startServer({ env: { ...BASE, UPLOAD_MAX_STORAGE_GB: '0.0002' } }); });
    after(() => server?.stop());

    test('at a limit of 1, a second download waits, 423 DOWNLOADS_BUSY with Retry-After, while the first\'s lease is open; when it ends, the upload is gone at once', async () => {
        const object = oneFile();
        const { id } = await uploadObject(server, object, { maxDownloads: 1 });
        assert.equal(await hasRoomFor(server, object), false, 'the upload fills the storage');
        const first = await takeLease(server, id);
        const busy = await downloads.take(server, id);
        assert.equal(busy.headers.get('retry-after'), '5');
        assert.deepEqual(await answer(busy), {
            status: 423, body: { code: 'DOWNLOADS_BUSY', error: 'Someone is downloading this right now. Try again shortly.' },
        });

        assert.deepEqual(await fetchAll(server, id, first), object.bytes);
        assert.equal((await downloads.release(server, first)).status, 204);
        assert.deepEqual(await answer(await downloads.metadata(server, id)), NOT_FOUND);
        assert.deepEqual(await answer(await downloads.take(server, id)), NOT_FOUND);
        assert.equal(fs.existsSync(objectFile(server, id)), false, 'its bytes');
        assert.equal(recordOf(server, id), undefined, 'its record');
        assert.equal(await hasRoomFor(server, object), true, 'its storage');
    });

    test('at a limit of 1, a lease that ends having served nothing leaves the place for the next', async () => {
        const object = oneFile();
        const { id } = await uploadObject(server, object, { maxDownloads: 1 });
        await downloads.release(server, await takeLease(server, id));
        const next = await takeLease(server, id);
        assert.deepEqual(await fetchAll(server, id, next), object.bytes);
        await downloads.release(server, next);
        assert.deepEqual(await answer(await downloads.metadata(server, id)), NOT_FOUND);
    });

    test('at a limit of 2, two downloads at once, a third waits; the upload goes when the second has counted', async () => {
        const object = oneFile();
        const { id } = await uploadObject(server, object, { maxDownloads: 2 });
        const first = await takeLease(server, id);
        const second = await takeLease(server, id);
        assert.equal((await downloads.take(server, id)).status, 423);
        await fetchAll(server, id, first);
        await fetchAll(server, id, second);
        await downloads.release(server, first);
        assert.equal(recordOf(server, id).downloadCount, 1);
        assert.equal((await downloads.take(server, id)).status, 423, 'the open lease and the count make the limit');
        await downloads.release(server, second);
        assert.deepEqual(await answer(await downloads.metadata(server, id)), NOT_FOUND);
        assert.equal(fs.existsSync(objectFile(server, id)), false);
    });

    test('an encrypted bundle\'s files fetched by range under one lease count once, and at a limit of 1 nothing of it is left', async () => {
        const object = twoFiles();
        const { id } = await uploadObject(server, object, { maxDownloads: 1 });
        const lease = await takeLease(server, id);
        // Its second file starts at plaintext byte 70,000: chunks 1 and 2.
        const fromChunk = 60 + 1 * (CHUNK + 16);
        assert.equal((await bytesOf(await downloads.content(server, id, lease, { Range: `bytes=${fromChunk}-` }))).status, 206);
        assert.equal((await bytesOf(await downloads.content(server, id, lease, { Range: `bytes=0-${fromChunk - 1}` }))).status, 206);
        await downloads.release(server, lease);
        assert.deepEqual(await answer(await downloads.metadata(server, id)), NOT_FOUND);
        assert.deepEqual(await answer(await downloads.take(server, id)), NOT_FOUND);
        assert.deepEqual(await answer(await downloads.content(server, id, lease)), NOT_FOUND);
        assert.equal(fs.existsSync(objectFile(server, id)), false);
        assert.equal(recordOf(server, id), undefined);
    });
});

describe('the bytes', () => {
    let server;
    before(async () => { server = await startServer({ env: BASE }); });
    after(() => server?.stop());

    const HEADERS = ['content-type', 'content-length', 'accept-ranges', 'etag', 'cache-control', 'content-disposition', 'content-range'];

    test('the whole upload is 200, with Accept-Ranges, its ETag, its length, no-store, and Content-Disposition naming only an unencrypted single file', async () => {
        const cases = [
            [oneFile(), NAMED],
            [twoPlainFiles(), 'attachment'],
            [twoFiles(), 'attachment'],
        ];
        for (const [object, disposition] of cases) {
            const { id } = await uploadObject(server, object);
            const got = await bytesOf(await downloads.content(server, id, await takeLease(server, id)), ...HEADERS);
            assert.deepEqual(got, {
                status: 200,
                'content-type': 'application/octet-stream',
                'content-length': String(object.size),
                'accept-ranges': 'bytes',
                etag: `"${id}"`,
                'cache-control': 'no-store',
                'content-disposition': disposition,
                'content-range': null,
                bytes: object.bytes,
            });
        }
    });

    test('one range is 206 with Content-Range: from and to, from on, the last n bytes, and an end past the last byte', async () => {
        const object = oneFile();
        const { id } = await uploadObject(server, object);
        const lease = await takeLease(server, id);
        const size = object.size;
        for (const [range, first, last] of [
            ['bytes=0-0', 0, 0], ['bytes=100-1099', 100, 1099], [`bytes=${size - 10}-`, size - 10, size - 1],
            ['bytes=-500', size - 500, size - 1], [`bytes=-${size + 5}`, 0, size - 1], [`bytes=5-${size + 1000}`, 5, size - 1],
        ]) {
            const got = await bytesOf(await downloads.content(server, id, lease, { Range: range }), 'content-range', 'content-length', 'etag');
            assert.deepEqual(got, {
                status: 206,
                'content-range': `bytes ${first}-${last}/${size}`,
                'content-length': String(last - first + 1),
                etag: `"${id}"`,
                bytes: object.bytes.subarray(first, last + 1),
            }, range);
        }
    });

    test('a range past the end, several ranges, or anything else is 416 RANGE_NOT_SATISFIABLE with Content-Range: bytes */size', async () => {
        const object = oneFile();
        const { id } = await uploadObject(server, object);
        const lease = await takeLease(server, id);
        for (const range of [`bytes=${object.size}-`, `bytes=${object.size + 5}-${object.size + 9}`, 'bytes=0-9,20-29', 'bytes=-0', 'bytes=10-5', 'bytes=x-y', 'items=0-9']) {
            const res = await downloads.content(server, id, lease, { Range: range });
            assert.equal(res.headers.get('content-range'), `bytes */${object.size}`, range);
            assert.equal(res.headers.get('content-disposition'), null, range);
            assert.deepEqual(await answer(res), {
                status: 416, body: { code: 'RANGE_NOT_SATISFIABLE', error: 'The server can\'t send that range of bytes.' },
            }, range);
        }
        assert.deepEqual(await fetchAll(server, id, lease), object.bytes, 'the lease still works');
    });

    test('If-Range with the upload\'s ETag gives the range; with any other, the whole upload, 200', async () => {
        const object = oneFile();
        const { id } = await uploadObject(server, object);
        const lease = await takeLease(server, id);
        const ranged = await bytesOf(await downloads.content(server, id, lease, { Range: 'bytes=10-19', 'If-Range': `"${id}"` }));
        assert.equal(ranged.status, 206);
        assert.deepEqual(ranged.bytes, object.bytes.subarray(10, 20));
        for (const other of [`"${crypto.randomUUID()}"`, `W/"${id}"`, 'Wed, 21 Oct 2026 07:28:00 GMT']) {
            const whole = await bytesOf(await downloads.content(server, id, lease, { Range: 'bytes=10-19', 'If-Range': other }), 'content-range');
            assert.deepEqual(whole, { status: 200, 'content-range': null, bytes: object.bytes }, other);
        }
    });

    test('a file of an encrypted bundle is one range of whole chunks, which open to exactly its bytes; a whole download ends with the chunk marked last', async () => {
        const object = twoFiles();
        const { id } = await uploadObject(server, object);
        const lease = await takeLease(server, id);
        // The second file is plaintext bytes [70,000, 160,000): chunks 1 and 2.
        const [first, last] = [Math.floor(70_000 / CHUNK), Math.floor((160_000 - 1) / CHUNK)];
        const from = 60 + first * (CHUNK + 16);
        const to = 60 + (last + 1) * (CHUNK + 16) - 1;
        const got = await bytesOf(await downloads.content(server, id, lease, { Range: `bytes=${from}-${to}` }));
        assert.equal(got.status, 206);
        const plaintext = Buffer.concat([first, last].map((i, n) => openChunk(object, i, got.bytes.subarray(n * (CHUNK + 16), (n + 1) * (CHUNK + 16)))));
        assert.deepEqual(plaintext.subarray(70_000 - first * CHUNK, 160_000 - first * CHUNK), fileBytes(90_000, 5));

        const whole = await fetchAll(server, id, lease);
        const lastIndex = object.chunks.length - 1;
        assert.equal(lastIndex, 2);
        assert.doesNotThrow(() => openChunk(object, lastIndex, whole.subarray(60 + lastIndex * (CHUNK + 16))), 'the last chunk opens as the last');
    });

    test('HEAD gives the headers and no bytes, and serves nothing', async () => {
        const object = oneFile();
        const { id } = await uploadObject(server, object, { maxDownloads: 1 });
        const lease = await takeLease(server, id);
        const res = await fetch(`${server.baseUrl}/api/v4/objects/${id}/content`, { method: 'HEAD', headers: { 'Dropgate-Lease': lease } });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-length'), String(object.size));
        await downloads.release(server, lease);
        assert.equal(recordOf(server, id).downloadCount, 0);
    });
});

describe('a browser\'s own downloads, with the lease in the URL', () => {
    let server;
    before(async () => { server = await startServer({ env: BASE }); });
    after(() => server?.stop());

    test('an unencrypted file: the whole upload or its one file, named, with ranges', async () => {
        const object = oneFile();
        const { id } = await uploadObject(server, object);
        const lease = await takeLease(server, id);
        for (const index of [undefined, 0]) {
            const whole = await bytesOf(await downloads.browser(server, lease, index), 'content-disposition', 'etag', 'accept-ranges');
            assert.deepEqual(whole, {
                status: 200,
                'content-disposition': NAMED,
                etag: `"${id}"`,
                'accept-ranges': 'bytes',
                bytes: object.bytes,
            });
            const ranged = await bytesOf(await downloads.browser(server, lease, index, { Range: 'bytes=100-' }), 'content-range');
            assert.deepEqual(ranged, { status: 206, 'content-range': `bytes 100-${object.size - 1}/${object.size}`, bytes: object.bytes.subarray(100) });
        }
    });

    test('a file of an unencrypted bundle, named, with ranges relative to it; the whole bundle, unnamed', async () => {
        const object = twoPlainFiles();
        const { id } = await uploadObject(server, object);
        const lease = await takeLease(server, id);
        const second = await bytesOf(await downloads.browser(server, lease, 1), 'content-disposition', 'content-length');
        assert.deepEqual(second, { status: 200, 'content-disposition': 'attachment; filename=b.txt', 'content-length': '30000', bytes: fileBytes(30_000, 3) });
        const ranged = await bytesOf(await downloads.browser(server, lease, 1, { Range: 'bytes=10-19' }), 'content-range');
        assert.deepEqual(ranged, { status: 206, 'content-range': 'bytes 10-19/30000', bytes: fileBytes(30_000, 3).subarray(10, 20) });
        const first = await bytesOf(await downloads.browser(server, lease, 0));
        assert.deepEqual(first.bytes, fileBytes(70_000, 2));
        const whole = await bytesOf(await downloads.browser(server, lease), 'content-disposition');
        assert.deepEqual(whole, { status: 200, 'content-disposition': 'attachment', bytes: object.bytes });
    });

    test('never an encrypted upload; a file that isn\'t there, or a lease the server never gave, is 404', async () => {
        const encrypted = await uploadObject(server, twoFiles());
        const lease = await takeLease(server, encrypted.id);
        assert.deepEqual(await answer(await downloads.browser(server, lease)), NOT_FOUND);
        assert.deepEqual(await answer(await downloads.browser(server, lease, 0)), NOT_FOUND);
        assert.equal((await downloads.content(server, encrypted.id, lease)).status, 200, 'it goes through the header');

        const plain = await uploadObject(server, twoPlainFiles());
        const plainLease = await takeLease(server, plain.id);
        for (const index of [2, 'x', -1]) assert.deepEqual(await answer(await downloads.browser(server, plainLease, index)), NOT_FOUND, String(index));
        assert.deepEqual(await answer(await downloads.browser(server, manageToken().token)), NOT_FOUND);
    });

    test('a browser\'s own resume stays under its lease, so at a limit of 1 it isn\'t refused and counts once', async () => {
        const object = oneFile();
        const { id } = await uploadObject(server, object, { maxDownloads: 1 });
        const lease = await takeLease(server, id);
        const start = await bytesOf(await downloads.browser(server, lease, undefined, { Range: 'bytes=0-999' }));
        const rest = await bytesOf(await downloads.browser(server, lease, undefined, { Range: 'bytes=1000-', 'If-Range': `"${id}"` }));
        assert.equal(rest.status, 206);
        assert.deepEqual(Buffer.concat([start.bytes, rest.bytes]), object.bytes);
        await downloads.release(server, lease);
        assert.deepEqual(await answer(await downloads.metadata(server, id)), NOT_FOUND);
    });
});

describe('the uploader\'s delete', () => {
    let server;
    before(async () => { server = await startServer({ env: { ...BASE, UPLOAD_MAX_STORAGE_GB: '0.0002' } }); });
    after(() => server?.stop());

    test('the upload\'s manage token is 204: its bytes, record and storage go at once, and an open lease is 404 at its next request', async () => {
        const object = oneFile();
        const stored = await uploadObject(server, object, { maxDownloads: 1 });
        const lease = await takeLease(server, stored.id);
        await bytesOf(await downloads.content(server, stored.id, lease, { Range: 'bytes=0-9' }));
        assert.equal(await hasRoomFor(server, object), false);

        const res = await downloads.delete(server, stored.id, stored.manageToken);
        assert.equal(res.status, 204);
        assert.equal(await res.text(), '');
        assert.equal(fs.existsSync(objectFile(server, stored.id)), false);
        assert.equal(recordOf(server, stored.id), undefined);
        assert.equal(await hasRoomFor(server, object), true);
        assert.deepEqual(await answer(await downloads.metadata(server, stored.id)), NOT_FOUND);
        assert.deepEqual(await answer(await downloads.content(server, stored.id, lease)), NOT_FOUND);
        assert.deepEqual(await answer(await downloads.renew(server, lease)), NOT_FOUND);
        assert.deepEqual(await answer(await downloads.delete(server, stored.id, stored.manageToken)), NOT_FOUND, 'deleting again');
    });

    test('a wrong, empty, malformed or missing token, or another upload\'s, is 403 MANAGE_DENIED, and nothing changes', async () => {
        const object = oneFile();
        const stored = await uploadObject(server, object, { maxDownloads: 1 });
        const lease = await takeLease(server, stored.id);
        const before = recordOf(server, stored.id);
        const other = await uploadObject(server, plainObject({ files: [{ name: 'other.txt', bytes: fileBytes(1_000, 9) }] }));
        const theHash = before.manageTokenHash;
        for (const token of [manageToken().token, '', 'not a token', stored.manageToken.slice(1), `${stored.manageToken}A`, theHash, other.manageToken, undefined]) {
            assert.deepEqual(await answer(await downloads.delete(server, stored.id, token)), {
                status: 403, body: { code: 'MANAGE_DENIED', error: 'That manage token isn\'t this upload\'s.' },
            }, String(token));
        }
        assert.deepEqual(recordOf(server, stored.id), before);
        assert.deepEqual(await fetchAll(server, stored.id, lease), object.bytes, 'the open lease still works');
        assert.equal((await downloads.delete(server, other.id, other.manageToken)).status, 204, 'the other upload\'s token deletes the other upload');
    });

    test('a download in progress stops when its upload is deleted', async () => {
        // Larger than the connection holds, so most of it is still to be sent when it's deleted.
        const big = plainObject({ files: [{ name: 'big.bin', bytes: fileBytes(16 * 1024 * 1024, 11) }] });
        const stopped = await startServer({ env: BASE });
        try {
            const stored = await uploadObject(stopped, big);
            const res = await downloads.content(stopped, stored.id, await takeLease(stopped, stored.id));
            assert.equal(res.status, 200);
            const reader = res.body.getReader();
            let received = (await reader.read()).value.length;
            assert.equal((await downloads.delete(stopped, stored.id, stored.manageToken)).status, 204);
            const cut = await (async () => {
                try {
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) return false;
                        received += value.length;
                    }
                } catch {
                    return true;
                }
            })();
            assert.ok(cut && received < big.size, `the download went on: ${received} of ${big.size} bytes, ${cut ? 'cut' : 'ended normally'}`);
            assert.equal(fs.existsSync(objectFile(stopped, stored.id)), false);
        } finally {
            await stopped.stop();
        }
    });

    test('an unknown upload is 404 NOT_FOUND', async () => {
        assert.deepEqual(await answer(await downloads.delete(server, crypto.randomUUID(), manageToken().token)), NOT_FOUND);
        assert.deepEqual(await answer(await downloads.delete(server, 'not-an-id', manageToken().token)), NOT_FOUND);
    });
});
