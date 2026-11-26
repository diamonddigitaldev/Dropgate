// How many uploads one address can have in progress at once: at most
// UPLOAD_MAX_IN_PROGRESS_PER_IP (5 by default), paused ones included, so one
// client can't hold the server's storage with uploads from one address. Each
// address is counted under a keyed hash, as the rendezvous counts codes, and
// the address itself is kept nowhere.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { startServer, waitFor } from './helpers/harness.mjs';
import { SMALL_CHUNKS, answer, fileBytes, plainObject, sendChunks, startBody, uploads } from './helpers/dgup4.mjs';

// Behind one reverse proxy, so each request's X-Forwarded-For is its address.
const BASE = { ENABLE_UPLOAD: 'true', UPLOAD_CHUNK_SIZE_BYTES: SMALL_CHUNKS, RATE_LIMIT_MAX_REQUESTS: '0', TRUST_PROXY: '1' };
const BUSY = {
    status: 429,
    body: { code: 'RATE_LIMITED', error: 'This address has as many uploads in progress as the server allows. Finish or cancel one, then try again.' },
};

const twoChunks = () => plainObject({ files: [{ name: 'counted.bin', bytes: fileBytes(65536 + 1000) }] });
const from = (address) => ({ 'X-Forwarded-For': address });
/** Starts an upload of `object` from `address`: its status and body. */
const startFrom = async (server, object, address) => answer(await uploads.start(server, startBody(object), from(address)));
/** Starts `count` uploads from `address`, each expected to be taken, and gives their IDs. */
const startMany = async (server, object, address, count) => {
    const ids = [];
    for (let i = 0; i < count; i++) {
        const { status, body } = await startFrom(server, object, address);
        assert.equal(status, 201, `upload ${i + 1} from ${address}`);
        ids.push(body.uploadId);
    }
    return ids;
};

test('one address has at most 5 uploads in progress, paused ones included: the sixth start is refused 429 before anything is reserved, while another address starts', async (t) => {
    const server = await startServer({ env: BASE });
    t.after(server.stop);
    const object = twoChunks();
    const ids = await startMany(server, object, '203.0.113.10', 5);
    // Two of them part-way and paused, as an honest client's would be.
    for (const id of ids.slice(0, 2)) {
        await sendChunks(server, id, object, 0, 1);
        assert.equal((await uploads.pause(server, id)).status, 200);
    }
    const files = server.tempFiles().sort();
    const refused = await answer(await uploads.start(server, startBody(object), from('203.0.113.10')));
    assert.deepEqual(refused, BUSY);
    assert.deepEqual(server.tempFiles().sort(), files, 'nothing was reserved for it');
    assert.equal((await startFrom(server, object, '203.0.113.11')).status, 201, 'another address still starts one');
});

test('an upload that finishes, is cancelled, or ends at its deadline lets its address start another', async (t) => {
    const server = await startServer({ env: BASE, clock: true });
    t.after(server.stop);
    const object = twoChunks();
    const address = '198.51.100.20';
    const ids = await startMany(server, object, address, 5);
    assert.deepEqual(await startFrom(server, object, address), BUSY);

    await sendChunks(server, ids[0], object);
    assert.equal((await uploads.complete(server, ids[0])).status, 201);
    const [next] = await startMany(server, object, address, 1);
    assert.deepEqual(await startFrom(server, object, address), BUSY, 'one finished: one more');

    assert.equal((await uploads.cancel(server, ids[1])).status, 204);
    await startMany(server, object, address, 1);
    assert.deepEqual(await startFrom(server, object, address), BUSY, 'one cancelled: one more');

    // All of them left to end at their deadlines: then five again.
    await server.advanceClock(5 * 60_000 + 2_000);
    await waitFor(() => server.tempFiles().length === 0, { what: 'every upload to end' });
    assert.ok(next);
    await startMany(server, object, address, 5);
    assert.deepEqual(await startFrom(server, object, address), BUSY);
});

test('an address is counted as the rate limiter counts it: an IPv4 address in either of its forms, an IPv6 address by its /56 network', async (t) => {
    const server = await startServer({ env: BASE });
    t.after(server.stop);
    const object = twoChunks();
    const given = async (addresses) => {
        let taken = 0;
        for (let i = 0; i < 6; i++) if ((await startFrom(server, object, addresses[i % addresses.length])).status === 201) taken++;
        return taken;
    };
    assert.equal(await given(['192.0.2.20', '::ffff:192.0.2.20']), 5, 'an IPv4 address and its IPv4-mapped form share 5');
    assert.equal(await given(['2001:db8:7:100::1', '2001:db8:7:1ff:ffff::2']), 5, 'two IPv6 addresses in one /56 share 5');
    assert.equal((await startFrom(server, object, '2001:db8:7:200::1')).status, 201, 'the next /56 has its own');
});

test('UPLOAD_MAX_IN_PROGRESS_PER_IP sets the number, and 0 lifts the limit', async (t) => {
    const object = twoChunks();
    const two = await startServer({ env: { ...BASE, UPLOAD_MAX_IN_PROGRESS_PER_IP: '2' } });
    t.after(two.stop);
    await startMany(two, object, '203.0.113.30', 2);
    assert.deepEqual(await startFrom(two, object, '203.0.113.30'), BUSY);

    const none = await startServer({ env: { ...BASE, UPLOAD_MAX_IN_PROGRESS_PER_IP: '0' } });
    t.after(none.stop);
    await startMany(none, object, '203.0.113.30', 12);
});

test('the count holds no address: nothing in memory, on disk or in the log is one, an upload holds only its keyed hash, and an entry goes at 0', async (t) => {
    const server = await startServer({ held: true, env: { ...BASE, LOG_LEVEL: 'DEBUG', UPLOAD_PRESERVE_UPLOADS: 'true' } });
    t.after(server.stop);
    const object = twoChunks();
    const addresses = ['203.0.113.50', '2001:db8:5:100::1', '192.0.2.33'];
    // Each address as it could be written down, and as bytes.
    const forms = (address) => [address, address.toUpperCase(), Buffer.from(address).toString('hex'), Buffer.from(address).toString('base64')];
    const ids = [];
    for (const address of addresses) ids.push(...await startMany(server, object, address, 2));
    for (const id of ids.slice(0, 3)) await sendChunks(server, id, object, 0, 1);
    await uploads.pause(server, ids[0]);

    // In memory: nothing the process holds is any of the addresses, written any way.
    const snapshot = await server.heapSnapshot(path.join(server.dir, 'held.heapsnapshot'));
    const heap = fs.readFileSync(snapshot, 'utf8');
    fs.rmSync(snapshot);
    for (const address of addresses) for (const text of forms(address)) assert.ok(!heap.includes(text), `the server's memory holds ${text}`);

    // The upload holds its address's key, made by the keyed hash and nothing else.
    const source = fs.readFileSync(path.join(server.dir, 'server.js'), 'utf8');
    assert.match(source, /const UPLOAD_COUNT_KEY = crypto\.randomBytes\(32\);/, 'the key is 32 random bytes, made at each start');
    assert.equal(source.match(/UPLOAD_COUNT_KEY/g).length, 2, 'and used only by the keyed hash');
    assert.match(source, /const uploadCountKeyOf = \(address\) => crypto\.createHmac\('sha256', UPLOAD_COUNT_KEY\)\.update\(ipKeyGenerator\(String\(address \?\? ''\)\)\)\.digest\(\)\.toString\('latin1', 0, 16\);/);
    assert.match(source, /const counted = uploadCountKeyOf\(req\.ip\);/);
    assert.equal(source.match(/uploadCountKeyOf\(/g).length, 1, 'made in one place, the start');

    // An entry goes at 0: every upload from an address ended, it has 5 again.
    for (const id of ids.slice(0, 2)) assert.equal((await uploads.cancel(server, id)).status, 204);
    await startMany(server, object, addresses[0], 5);

    const output = server.output.stdout + server.output.stderr;
    for (const address of addresses) for (const text of forms(address)) assert.ok(!output.includes(text), `the log holds ${text}`);
    const onDisk = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'node_modules') continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile()) onDisk.push(fs.readFileSync(full).toString('latin1'));
        }
    };
    walk(server.dataDir);
    for (const address of addresses) for (const text of forms(address)) assert.ok(!onDisk.some((bytes) => bytes.includes(text)), `a file holds ${text}`);
});
