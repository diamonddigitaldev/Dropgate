// Dropgate 4's object, byte for byte. The server's test builder, a second
// implementation on node:crypto, must make exactly the bytes core's pinned
// vectors give; and an upload of each stores exactly that object.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { startServer } from './helpers/harness.mjs';
import { SMALL_CHUNKS, encryptedObject, sha256, uploadObject } from './helpers/dgup4.mjs';

const { vectors } = JSON.parse(fs.readFileSync(
    new URL('../../packages/dropgate-core/tests/fixtures/dgup4-object-vectors.json', import.meta.url), 'utf8',
));

// Byte j of vector file k, as the vectors say: (7j + 13k + 1) mod 256.
const vectorFile = ({ name, size }, k) => ({ name, bytes: Buffer.from(Array.from({ length: size }, (_, j) => (7 * j + 13 * k + 1) & 0xff)) });

const build = ({ input }) => encryptedObject({
    files: input.files.map(vectorFile),
    chunkSize: input.chunkSize,
    maxBytes: input.maxBytes,
    secret: Buffer.from(input.secret, 'hex'),
    salt: Buffer.from(input.salt, 'hex'),
    metaNonce: Buffer.from(input.metaNonce, 'hex'),
});

test('the test builder makes exactly the bytes of core\'s pinned vectors', () => {
    assert.ok(vectors.length >= 3, 'the vectors were read');
    for (const vector of vectors) {
        const { output } = vector;
        const object = build(vector);
        const hex = (b) => b.toString('hex');
        assert.deepEqual(
            { header: hex(object.keys.header), payload: hex(object.keys.payload), meta: hex(object.keys.meta) },
            output.keys, `${vector.name}: the keys`,
        );
        assert.equal(hex(object.header), output.header, `${vector.name}: the header`);
        assert.equal(object.padded, output.paddedLength, `${vector.name}: the padded length`);
        assert.equal(object.size, output.storedSize, `${vector.name}: the stored size`);
        assert.deepEqual(
            object.chunks.map((c) => ({ length: c.length, sha256: hex(sha256(c)) })),
            output.chunks, `${vector.name}: the chunks`,
        );
        assert.equal(hex(object.chunks.at(-1).subarray(-output.lastChunk.length / 2)), output.lastChunk, `${vector.name}: the last chunk's end`);
        assert.deepEqual({ length: object.meta.length, sha256: hex(sha256(object.meta)) }, output.meta, `${vector.name}: the meta`);
        assert.equal(hex(sha256(object.bytes)), output.object.sha256, `${vector.name}: the whole object`);
    }
});

test('an upload of each pinned object stores exactly that object, and its record keeps its meta', async (t) => {
    const server = await startServer({
        env: { ENABLE_UPLOAD: 'true', UPLOAD_CHUNK_SIZE_BYTES: SMALL_CHUNKS, UPLOAD_PRESERVE_UPLOADS: 'true', RATE_LIMIT_MAX_REQUESTS: '0' },
    });
    t.after(server.stop);
    for (const vector of vectors) {
        assert.equal(String(vector.input.chunkSize), SMALL_CHUNKS, `${vector.name} is in the server's chunk size`);
        const object = build(vector);
        const { id } = await uploadObject(server, object);
        const stored = fs.readFileSync(path.join(server.uploadsDir, 'objects', id));
        assert.equal(sha256(stored).toString('hex'), vector.output.object.sha256, vector.name);
        const [record] = server.records('objects.sqlite').filter((r) => r.id === id);
        assert.equal(record.value.meta, object.meta.toString('base64url'), `${vector.name}: the meta`);
        assert.equal(record.value.size, vector.output.storedSize, `${vector.name}: the size`);
    }
});
