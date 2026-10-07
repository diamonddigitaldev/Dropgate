// Dropgate 4's uploads, for the server's tests: objects built with node:crypto
// from the format itself, and the upload routes called directly.
//
// The builder is a second implementation of the object, apart from core's
// src/object/ and its tests' reference. object-format.test.mjs checks it makes
// exactly the bytes core's pinned vectors give.
//
//   object = header (60 bytes) || chunk 0 || ... || chunk n-1
//   header = "DGUP" || 04 || 01 || 00 00 || C (u32 BE) || salt (16) || HMAC-SHA256(headerKey, bytes 0-27)
//   keys   = HKDF-SHA256(secret, salt, "dropgate/4 header" | "dropgate/4 payload" | "dropgate/4 meta"), 32 bytes
//   chunk i = AES-256-GCM(payloadKey, i as 11 bytes BE || 01 if last else 00, padded plaintext [iC, (i+1)C))
//   meta   = nonce (12) || AES-256-GCM(metaKey, nonce, u32 BE length || {"files":[...]} || zeros to 4 KiB, 8 KiB, ... 1 MiB)
import { createCipheriv, createHash, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BODY_MARKER } from './fixture.mjs';

export const HOUR_MS = 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;
// An upload with no request for this long ends, unless it's paused.
export const QUIET_MS = 5 * MINUTE_MS;
// The smallest chunk size a server takes, which keeps test objects small.
export const SMALL_CHUNKS = '65536';

const HEADER_BYTES = 60;
const TAG_BYTES = 16;
const FIRST_BUCKET = 4096;
const LAST_BUCKET = 1024 * 1024;

/** The three keys an object's secret and salt give. */
export function objectKeys(secret, salt) {
    const derive = (purpose) => Buffer.from(hkdfSync('sha256', secret, salt, `dropgate/4 ${purpose}`, 32));
    return { header: derive('header'), payload: derive('payload'), meta: derive('meta') };
}

/** Padmé: `length` rounded up so only its top bits vary. */
export function padme(length) {
    if (length < 2) return length;
    let exponent = 0;
    while (2 ** (exponent + 1) <= length) exponent++;
    let bits = 0;
    while (2 ** bits <= exponent) bits++;
    const step = 2 ** (exponent - bits);
    return Math.ceil(length / step) * step;
}

/** The bytes an encrypted object stores for `plaintext` padded bytes in chunks of `chunkSize`. */
export const storedSize = (plaintext, chunkSize) => HEADER_BYTES + plaintext + TAG_BYTES * Math.ceil(plaintext / chunkSize);

/** The files' length padded by Padmé, then cut back so the stored object fits `maxBytes` (0: no limit). */
export function paddedLength(length, chunkSize, maxBytes = 0) {
    const padded = padme(length);
    if (!maxBytes || storedSize(padded, chunkSize) <= maxBytes) return padded;
    if (storedSize(length, chunkSize) > maxBytes) throw new Error('The files are over the limit before padding.');
    let fits = padded;
    while (storedSize(fits, chunkSize) > maxBytes) fits--;
    return fits;
}

function seal(key, nonce, plaintext) {
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

function chunkNonce(index, last) {
    const nonce = Buffer.alloc(12);
    let rest = index;
    for (let at = 10; rest > 0; at--) {
        nonce[at] = rest % 256;
        rest = Math.floor(rest / 256);
    }
    nonce[11] = last ? 1 : 0;
    return nonce;
}

function sealedManifest(key, nonce, files) {
    const json = Buffer.from(JSON.stringify({ files: files.map((f) => ({ name: f.name, size: f.bytes.length })) }));
    let bucket = FIRST_BUCKET;
    while (bucket < json.length + 4) bucket *= 2;
    if (bucket > LAST_BUCKET) throw new Error('The file list is over 1 MiB.');
    const padded = Buffer.alloc(bucket);
    padded.writeUInt32BE(json.length);
    json.copy(padded, 4);
    return Buffer.concat([nonce, seal(key, nonce, padded)]);
}

/**
 * An encrypted object: `files` as `{ name, bytes }`. The secret, the salt and
 * the meta's nonce are random unless given.
 */
export function encryptedObject({
    files, chunkSize = Number(SMALL_CHUNKS), maxBytes = 0,
    secret = randomBytes(32), salt = randomBytes(16), metaNonce = randomBytes(12),
}) {
    const keys = objectKeys(secret, salt);
    const fields = Buffer.concat([Buffer.from('DGUP'), Buffer.from([4, 1, 0, 0]), Buffer.alloc(4), Buffer.from(salt)]);
    fields.writeUInt32BE(chunkSize, 8);
    const header = Buffer.concat([fields, createHmac('sha256', keys.header).update(fields).digest()]);

    const padded = paddedLength(files.reduce((n, f) => n + f.bytes.length, 0), chunkSize, maxBytes);
    // The files, then zeros to the padded length.
    const plaintext = Buffer.alloc(padded);
    Buffer.concat(files.map((f) => Buffer.from(f.bytes))).copy(plaintext);
    const count = Math.ceil(padded / chunkSize);
    const chunks = Array.from({ length: count }, (_, i) => seal(
        keys.payload, chunkNonce(i, i === count - 1), plaintext.subarray(i * chunkSize, Math.min(padded, (i + 1) * chunkSize)),
    ));
    const meta = sealedManifest(keys.meta, Buffer.from(metaNonce), files);
    const bytes = Buffer.concat([header, ...chunks]);
    return { encrypted: true, keys, header, chunks, meta, bytes, padded, size: bytes.length };
}

/** An unencrypted object: the files' bytes one after another, in chunks of `chunkSize`. */
export function plainObject({ files, chunkSize = Number(SMALL_CHUNKS) }) {
    const bytes = Buffer.concat(files.map((f) => Buffer.from(f.bytes)));
    const chunks = [];
    for (let at = 0; at < bytes.length; at += chunkSize) chunks.push(bytes.subarray(at, at + chunkSize));
    return { encrypted: false, files: files.map((f) => ({ name: f.name, size: f.bytes.length })), chunks, bytes, size: bytes.length };
}

/** `size` bytes that differ from file to file. */
export const fileBytes = (size, seed = 1) => Buffer.from(Array.from({ length: size }, (_, j) => (seed * 31 + j * 7) & 0xff));

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest();
export const contentDigest = (bytes) => `sha-256=:${sha256(bytes).toString('base64')}:`;

/** A manage token, and what an upload's start sends of it: its SHA-256. */
export function manageToken() {
    const token = randomBytes(32);
    return { token: token.toString('base64url'), hash: sha256(token).toString('base64url') };
}

/** What an upload of `object` starts with. */
export function startBody(object, { lifetimeMs = HOUR_MS, maxDownloads, manageTokenHash = manageToken().hash } = {}) {
    return {
        encrypted: object.encrypted,
        size: object.size,
        ...(object.encrypted
            ? { header: object.header.toString('base64url'), meta: object.meta.toString('base64url') }
            : { files: object.files }),
        lifetimeMs,
        ...(maxDownloads === undefined ? {} : { maxDownloads }),
        manageTokenHash,
    };
}

const json = { 'Content-Type': 'application/json' };
const naming = (uploadId) => (uploadId === undefined ? {} : { 'Dropgate-Upload': uploadId });

/** The upload routes, called as a client would. Each gives the fetch Response. */
export const uploads = {
    start: (server, body) => fetch(`${server.baseUrl}/api/v4/uploads`, { method: 'POST', headers: json, body: JSON.stringify(body) }),
    /** Chunk `index`'s bytes, with their digest unless `digest` gives another (null: none). */
    chunk: (server, uploadId, index, bytes, { digest = contentDigest(bytes) } = {}) => fetch(`${server.baseUrl}/api/v4/upload/chunks/${index}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', ...naming(uploadId), ...(digest === null ? {} : { 'Content-Digest': digest }) },
        body: bytes,
    }),
    status: (server, uploadId) => fetch(`${server.baseUrl}/api/v4/upload`, { headers: naming(uploadId) }),
    pause: (server, uploadId) => fetch(`${server.baseUrl}/api/v4/upload/pause`, { method: 'POST', headers: naming(uploadId) }),
    resume: (server, uploadId) => fetch(`${server.baseUrl}/api/v4/upload/resume`, { method: 'POST', headers: naming(uploadId) }),
    complete: (server, uploadId) => fetch(`${server.baseUrl}/api/v4/upload/complete`, { method: 'POST', headers: naming(uploadId) }),
    cancel: (server, uploadId) => fetch(`${server.baseUrl}/api/v4/upload`, { method: 'DELETE', headers: naming(uploadId) }),
};

/** An answer's status and its JSON body, or null when it has none. */
export async function answer(res) {
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Starts an upload of `object`, and gives its upload ID. Fails the test if the server refuses. */
export async function startUpload(server, object, options) {
    const { status, body } = await answer(await uploads.start(server, startBody(object, options)));
    if (status !== 201) throw new Error(`The start answered ${status}: ${JSON.stringify(body)}`);
    return body.uploadId;
}

/** Sends chunks `from` to `to` (exclusive) of `object`. Fails the test if one is refused. */
export async function sendChunks(server, uploadId, object, from = 0, to = object.chunks.length) {
    for (let i = from; i < to; i++) {
        const { status, body } = await answer(await uploads.chunk(server, uploadId, i, object.chunks[i]));
        if (status !== 200) throw new Error(`Chunk ${i} answered ${status}: ${JSON.stringify(body)}`);
    }
}

/** A whole upload of `object`: its upload ID, the stored object's ID, and the manage token. */
export async function uploadObject(server, object, options = {}) {
    const token = manageToken();
    const uploadId = await startUpload(server, object, { manageTokenHash: token.hash, ...options });
    await sendChunks(server, uploadId, object);
    const { status, body } = await answer(await uploads.complete(server, uploadId));
    if (status !== 201) throw new Error(`The finish answered ${status}: ${JSON.stringify(body)}`);
    return { uploadId, id: body.id, manageToken: token.token };
}

/**
 * A run of Dropgate 4 uploads, for the privacy tests: an encrypted bundle
 * paused, resumed and finished twice; an unencrypted file with a chunk sent
 * again with other bytes; and a cancelled upload. With `faults`, also a start
 * whose body can't be read, and a chunk whose temp file has gone. Gives every
 * ID, token and name it used, none of which may reach the server's output.
 * Needs the server's chunk size to be SMALL_CHUNKS.
 */
export async function runUploads(server, { faults = false } = {}) {
    const secrets = new Set();
    const note = (value) => { if (typeof value === 'string' && value.length >= 4) secrets.add(value); };

    const bundle = encryptedObject({
        files: [{ name: 'Holiday plans – été.pdf', bytes: fileBytes(70_000, 3) }, { name: 'budget 2026.xlsx', bytes: fileBytes(40_000, 4) }],
    });
    const token = manageToken();
    for (const value of [token.token, token.hash, 'Holiday plans – été.pdf', 'budget 2026.xlsx']) note(value);
    const bundleUpload = await startUpload(server, bundle, { manageTokenHash: token.hash });
    note(bundleUpload);
    await sendChunks(server, bundleUpload, bundle, 0, 1);
    await uploads.pause(server, bundleUpload);
    await uploads.status(server, bundleUpload);
    await uploads.resume(server, bundleUpload);
    await uploads.complete(server, bundleUpload);
    await sendChunks(server, bundleUpload, bundle, 1);
    const finished = await answer(await uploads.complete(server, bundleUpload));
    note(finished.body?.id);
    await uploads.complete(server, bundleUpload);

    const plain = plainObject({ files: [{ name: 'plain-v4-name-visible.txt', bytes: fileBytes(70_000, 5) }] });
    note('plain-v4-name-visible.txt');
    const plainUpload = await startUpload(server, plain, { maxDownloads: 1 });
    note(plainUpload);
    await sendChunks(server, plainUpload, plain, 0, 1);
    const other = Buffer.from(plain.chunks[0]);
    other[0] ^= 1;
    await uploads.chunk(server, plainUpload, 0, other);
    await sendChunks(server, plainUpload, plain, 1);
    note((await answer(await uploads.complete(server, plainUpload))).body?.id);

    const cancelled = await startUpload(server, plain);
    note(cancelled);
    await sendChunks(server, cancelled, plain, 0, 1);
    await uploads.cancel(server, cancelled);

    if (faults) {
        await fetch(`${server.baseUrl}/api/v4/uploads`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: `{"encrypted": ${BODY_MARKER}`,
        });
        note(BODY_MARKER);
        // A temp file gone from disk while its upload is in progress.
        const broken = await startUpload(server, plain);
        note(broken);
        fs.rmSync(path.join(server.tmpDir, broken));
        await uploads.chunk(server, broken, 0, plain.chunks[0]);
    }
    return { secrets };
}
