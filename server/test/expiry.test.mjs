// An upload is gone the moment its lifetime ends. Every route answers for it
// as it would for an ID that never existed, before the expiry sweep has run;
// the sweep then removes its bytes.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { startServer } from './helpers/harness.mjs';
import {
    HOUR_MS, SMALL_CHUNKS, downloads, encryptedObject, fileBytes, plainObject, takeLease, uploadObject,
} from './helpers/dgup4.mjs';

const LIFETIME_MS = 30_000;
// The expiry sweep runs every minute, so a move of the clock shorter than that,
// soon after the server starts, passes the lifetime without running it.
const PAST_LIFETIME_MS = LIFETIME_MS + 1_000;
const SWEEP_MS = 60_000;
const ENV = { ENABLE_UPLOAD: 'true', UPLOAD_CHUNK_SIZE_BYTES: SMALL_CHUNKS, RATE_LIMIT_MAX_REQUESTS: '0' };

/** An answer's status and type, and its body where it's JSON. (A page's HTML differs by its nonce.) */
async function summary(res) {
    const type = res.headers.get('content-type') ?? '';
    return {
        status: res.status,
        type: type.split(';')[0],
        body: type.includes('json') ? await res.json() : (await res.arrayBuffer(), undefined),
    };
}

/**
 * What every route an upload has answers for one ID: its page, its metadata,
 * a new lease, its bytes and a browser's own download under a lease taken
 * beforehand (or one that never existed), and a delete with a token that
 * isn't its own.
 */
async function answersFor(server, id, lease = randomBytes(32).toString('base64url')) {
    const wrongToken = randomBytes(32).toString('base64url');
    return {
        'GET /<id>': await summary(await fetch(`${server.baseUrl}/${id}`, { redirect: 'manual' })),
        'GET /api/v4/objects/<id>': await summary(await downloads.metadata(server, id)),
        'POST /api/v4/objects/<id>/leases': await summary(await downloads.take(server, id)),
        'GET /api/v4/objects/<id>/content': await summary(await downloads.content(server, id, lease)),
        'GET /api/v4/leases/<lease>': await summary(await downloads.browser(server, lease)),
        'POST /api/v4/lease/renew': await summary(await downloads.renew(server, lease)),
        'DELETE /api/v4/objects/<id>': await summary(await downloads.delete(server, id, wrongToken)),
    };
}

test('an expired upload answers as one that never existed, at once, and the sweep removes its bytes later', async (t) => {
    // Unlimited downloads, so only the lifetime can make an upload go.
    const server = await startServer({ env: { ...ENV, UPLOAD_MAX_FILE_DOWNLOADS: '0' }, clock: true });
    t.after(server.stop);

    const options = { lifetimeMs: LIFETIME_MS, maxDownloads: 0 };
    const uploads = {
        plain: await uploadObject(server, plainObject({ files: [{ name: 'plain.txt', bytes: fileBytes(1000, 1) }] }), options),
        encrypted: await uploadObject(server, encryptedObject({ files: [{ name: 'secret.txt', bytes: fileBytes(1000, 2) }] }), options),
        bundle: await uploadObject(server, encryptedObject({
            files: [{ name: 'first.txt', bytes: fileBytes(1000, 3) }, { name: 'second.txt', bytes: fileBytes(1000, 4) }],
        }), options),
        'unencrypted bundle': await uploadObject(server, plainObject({
            files: [{ name: 'first.txt', bytes: fileBytes(1000, 5) }, { name: 'second.txt', bytes: fileBytes(1000, 6) }],
        }), options),
    };
    // A lease on each, taken while it's there.
    const leases = {};
    for (const [what, { id }] of Object.entries(uploads)) leases[what] = await takeLease(server, id);

    const missing = await answersFor(server, randomUUID());
    for (const [what, { id }] of Object.entries(uploads)) {
        assert.notDeepEqual(await answersFor(server, id, leases[what]), missing, `the ${what} is there before its lifetime ends`);
    }
    assert.equal(server.storedFiles().length, 4);

    await server.advanceClock(PAST_LIFETIME_MS);
    for (const [what, { id }] of Object.entries(uploads)) {
        assert.deepEqual(await answersFor(server, id, leases[what]), missing, `the ${what}, once its lifetime has ended`);
    }
    assert.equal(server.storedFiles().length, 4, 'the sweep hasn\'t run yet');

    await server.advanceClock(SWEEP_MS);
    assert.deepEqual(server.storedFiles(), [], 'the sweep removed the bytes');
});

test('the sweep removes an upload\'s object and record once its lifetime has ended', async (t) => {
    const server = await startServer({ env: { ...ENV, UPLOAD_PRESERVE_UPLOADS: 'true' }, clock: true });
    t.after(server.stop);
    const object = plainObject({ files: [{ name: 'expires.bin', bytes: fileBytes(70_000) }] });
    const short = await uploadObject(server, object, { lifetimeMs: LIFETIME_MS });
    const long = await uploadObject(server, object, { lifetimeMs: HOUR_MS });
    assert.deepEqual(server.storedFiles().sort(), [`objects/${short.id}`, `objects/${long.id}`].sort());

    await server.advanceClock(SWEEP_MS);
    assert.deepEqual(server.storedFiles(), [`objects/${long.id}`], 'the expired one\'s object went');
    assert.deepEqual(server.records('objects.sqlite').map((r) => r.id), [long.id], 'and its record');
});
