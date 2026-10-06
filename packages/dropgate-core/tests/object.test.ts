import { describe, it, expect } from 'vitest';
import { createDecipheriv, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import { cryptoProvider, type CryptoProvider } from '../src/crypto/index.js';
import {
  ObjectLayout, padme, paddedLength, encryptedSize, chunkNonce, bucketFor, encodeManifest, sealMeta, deriveObjectKeys,
  createObject, openObject, type ObjectWriter, type OpenedObject,
} from '../src/object/index.js';
import * as reference from './helpers/reference-object.mjs';

// DGUP 4's object format, in core's src/object/: the
// header, the keys, STREAM chunks, Padmé and its clamp, the manifest and its
// buckets, the meta, and the offsets. Nothing calls it yet; hosted uploads and
// downloads move onto it in phase 6's later pieces.

const provider = cryptoProvider();
const KiB = 1024;
const MiB = 1024 * KiB;
const C = 64 * KiB;

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const fromHex = (value: string) => new Uint8Array(Buffer.from(value, 'hex'));
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const concat = (...parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts));

interface TestFile { name: string; bytes: Uint8Array }

const fileOf = (name: string, size: number, index = 0): TestFile => ({ name, bytes: new Uint8Array(reference.vectorFileBytes(index, size)) });

/** A provider whose meta nonce is fixed, so a meta can be pinned. */
const withMetaNonce = (nonce: Uint8Array): CryptoProvider =>
  ({ ...provider, randomBytes: (n: number) => (n === 12 ? nonce.slice() : provider.randomBytes(n)) });

interface Built { writer: ObjectWriter; chunks: Uint8Array[]; object: Uint8Array; files: TestFile[] }

/** An object made by core, every chunk sealed from the files' bytes and padding, as an upload will. */
async function build(
  files: TestFile[],
  opts: { chunkSize?: number; maxBytes?: number; secret?: Uint8Array; salt?: Uint8Array; using?: CryptoProvider } = {},
): Promise<Built> {
  const writer = await createObject(opts.using ?? provider, {
    files: files.map(({ name, bytes }) => ({ name, size: bytes.byteLength })),
    chunkSize: opts.chunkSize ?? C,
    ...(opts.maxBytes ? { maxBytes: opts.maxBytes } : {}),
    ...(opts.secret ? { secret: opts.secret } : {}),
    ...(opts.salt ? { salt: opts.salt } : {}),
  });
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < writer.layout.chunkCount; i++) {
    const plaintext = new Uint8Array(writer.layout.chunkLength(i));
    let at = 0;
    for (const part of writer.chunkParts(i).parts) {
      plaintext.set(files[part.file].bytes.subarray(part.offset, part.offset + part.length), at);
      at += part.length;
    }
    chunks.push(await writer.seal(i, plaintext));
    writer.confirm(i);
  }
  return { writer, chunks, object: concat(writer.header, ...chunks), files };
}

/** Opens a built object as a download would: its metadata first, then its bytes. */
const open = (built: Built, overrides: { header?: Uint8Array; meta?: Uint8Array; size?: number; secret?: Uint8Array } = {}) =>
  openObject(provider, {
    secret: overrides.secret ?? built.writer.secret(),
    header: overrides.header ?? built.writer.header,
    meta: overrides.meta ?? built.writer.meta,
    size: overrides.size ?? built.object.byteLength,
  });

/** Bytes as a download gets them: in pieces of `size`, whatever the chunks. */
function* pieces(bytes: Uint8Array, size = 1000) {
  for (let i = 0; i < bytes.byteLength; i += size) yield bytes.subarray(i, i + size);
}

async function readAll(opened: OpenedObject, bytes: Uint8Array): Promise<Uint8Array> {
  const out: Uint8Array[] = [];
  for await (const { plaintext } of opened.read(pieces(bytes))) out.push(plaintext);
  return concat(...out);
}

/** Opens `bytes` (stored as `size`) and reads it whole. */
async function download(built: Built, bytes: Uint8Array, size = bytes.byteLength) {
  return readAll(await open(built, { size }), bytes);
}

const expectCode = async (promise: Promise<unknown>, code: string) => {
  await expect(promise).rejects.toMatchObject({ name: 'DropgateError', code });
};

const vectors: Array<{
  name: string;
  input: { secret: string; salt: string; metaNonce: string; chunkSize: number; maxBytes: number; files: Array<{ name: string; size: number }> };
  output: {
    keys: { header: string; payload: string; meta: string };
    header: string; paddedLength: number; storedSize: number;
    chunks: Array<{ length: number; sha256: string }>; lastChunk: string;
    meta: { length: number; sha256: string }; object: { sha256: string };
  };
}> = JSON.parse(readFileSync(new URL('./fixtures/dgup4-object-vectors.json', import.meta.url), 'utf8')).vectors;

describe('Padmé (09 8.1)', () => {
  it('matches the vector table, and is never smaller than its input', () => {
    expect(padme(1_000_000)).toBe(1_015_808); // 992 KiB
    expect(padme(50_000_000)).toBe(48 * MiB);
    expect(padme(700_000_000)).toBe(672 * MiB);
    expect(padme(4_000_000_000)).toBe(3.75 * 1024 * MiB);
    expect([0, 1, 2, 3].map(padme)).toEqual([0, 1, 2, 3]);
    for (let length = 0; length <= 70_000; length++) {
      const padded = padme(length);
      if (padded < length || padded !== reference.padme(length)) expect({ length, padded }).toBe('never smaller, and as the formula says');
    }
    for (let length = 70_001, step = 1; length < 2 ** 50; length += step, step = step * 3 + 7) {
      expect(padme(length)).toBeGreaterThanOrEqual(length);
      expect(padme(length)).toBe(reference.padme(length));
    }
  });
});

describe("The clamp to the server's limit (09 8.2)", () => {
  it('pads a 99 MiB file against a 100 MiB limit to exactly the limit', () => {
    const length = 99 * MiB;
    const chunkSize = 5 * MiB;
    expect(paddedLength(length, chunkSize)).toBe(104_857_600);
    expect(encryptedSize(104_857_600, chunkSize)).toBe(104_857_980);
    expect(paddedLength(length, chunkSize, 100 * MiB)).toBe(104_857_220);
    expect(encryptedSize(104_857_220, chunkSize)).toBe(100 * MiB);
  });

  it('never makes an upload fail a size check, and reaches the limit exactly wherever an object can', () => {
    for (const length of [1, 17, C - 1, C, C + 1, 150_000, 1_000_000, 2_000_003]) {
      const unclamped = encryptedSize(padme(length), C);
      for (let limit = encryptedSize(length, C); limit <= unclamped + 40; limit += Math.max(1, Math.floor((unclamped - limit) / 7))) {
        const padded = paddedLength(length, C, limit);
        expect(padded).toBeGreaterThanOrEqual(length);
        expect(padded).toBeLessThanOrEqual(padme(length));
        expect(encryptedSize(padded, C)).toBeLessThanOrEqual(limit);
        expect(padded).toBe(reference.paddedLength(length, C, limit));
        // Only a limit 1 to 16 bytes past a whole chunk can't be met exactly: one more byte costs a tag.
        const over = (limit - 60) % (C + 16);
        if (padded < padme(length)) expect(encryptedSize(padded, C)).toBe(over >= 1 && over <= 16 ? limit - over : limit);
      }
    }
  });

  it('is FILE_TOO_LARGE only when the files alone are over the limit; 0 is no limit', () => {
    expect(() => paddedLength(150_000, C, encryptedSize(150_000, C) - 1)).toThrow(expect.objectContaining({ code: 'FILE_TOO_LARGE' }));
    expect(paddedLength(150_000, C, encryptedSize(150_000, C))).toBe(150_000);
    expect(paddedLength(150_000, C, 0)).toBe(padme(150_000));
  });
});

describe('Layout (09 8.3)', () => {
  it('pads with zero bytes after the last file, inside the stream, with the last flag on the final padded chunk', async () => {
    const built = await build([fileOf('report.pdf', 100_000, 0), fileOf('photo.jpg', 50_000, 1)]);
    const { layout } = built.writer;
    expect(layout.length).toBe(151_552);
    expect(layout.chunkCount).toBe(Math.ceil(151_552 / C));
    expect(built.object.byteLength).toBe(60 + 151_552 + 16 * 3);
    expect(built.object.byteLength).toBe(layout.storedSize);

    // Opened with node:crypto, from the reference: every chunk but the last has
    // flag 00, the last 01, and the plaintext's tail is zeros.
    const keys = await referenceKeys(built);
    const plain: Uint8Array[] = [];
    built.chunks.forEach((chunk, i) => {
      const last = i === built.chunks.length - 1;
      expect(() => gcmOpen(keys.payload, reference.chunkNonce(i, !last), chunk)).toThrow();
      plain.push(gcmOpen(keys.payload, reference.chunkNonce(i, last), chunk));
    });
    const all = concat(...plain);
    expect(hex(all.subarray(0, 150_000))).toBe(hex(concat(...built.files.map((f) => f.bytes))));
    expect(all.subarray(150_000).every((b) => b === 0)).toBe(true);
    expect(all.byteLength - 150_000).toBe(1552);
  });

  it('knows where every part of a chunk comes from', async () => {
    const layout = ObjectLayout.encrypted(151_552, C);
    expect(layout.chunkParts(1, [100_000, 50_000])).toEqual({
      parts: [{ file: 0, offset: 65_536, length: 34_464 }, { file: 1, offset: 0, length: 31_072 }], padding: 0,
    });
    expect(layout.chunkParts(2, [100_000, 50_000])).toEqual({ parts: [{ file: 1, offset: 31_072, length: 18_928 }], padding: 1552 });
  });
});

describe('The true size comes only from the meta (09 8.4)', () => {
  const files = [fileOf('report.pdf', 100_000, 0), fileOf('Photo – été.jpg', 50_000, 1)];

  /** A meta sealed under the object's own meta key, from the manifest's raw JSON. */
  async function forgedMeta(built: Built, json: string) {
    const keys = await deriveObjectKeys(provider, built.writer.secret(), built.writer.header.slice(12, 28));
    const body = new TextEncoder().encode(json);
    const padded = new Uint8Array(bucketFor(4 + body.byteLength));
    new DataView(padded.buffer).setUint32(0, body.byteLength, false);
    padded.set(body, 4);
    return sealMeta(provider, keys.meta, padded);
  }

  it('gives the names and sizes, and where each file starts', async () => {
    const opened = await open(await build(files));
    expect(opened.files).toEqual([
      { name: 'report.pdf', size: 100_000, offset: 0 },
      { name: 'Photo – été.jpg', size: 50_000, offset: 100_000 },
    ]);
    expect(opened.totalSize).toBe(150_000);
    expect(opened.layout.length).toBe(151_552);
  });

  it('refuses a meta whose sizes add up to more than the padded length', async () => {
    const built = await build(files);
    await expectCode(open(built, { meta: await forgedMeta(built, '{"files":[{"name":"a","size":151553}]}') }), 'INTEGRITY_FAILED');
    // Exactly the padded length fits.
    expect((await open(built, { meta: await forgedMeta(built, '{"files":[{"name":"a","size":151552}]}') })).totalSize).toBe(151_552);
  });

  it("refuses a name that breaks the rule, and a manifest that doesn't parse; ignores fields it doesn't know", async () => {
    const built = await build(files);
    await expectCode(open(built, { meta: await forgedMeta(built, '{"files":[{"name":"../evil","size":1}]}') }), 'INVALID_FILENAME');
    for (const json of [
      'not json', '{}', '{"files":[]}', '{"files":[{"name":"a"}]}', '{"files":[{"name":"a","size":0}]}',
      '{"files":[{"name":"a","size":1.5}]}', '{"files":[{"name":7,"size":1}]}', '{"files":[null]}',
      JSON.stringify({ files: Array.from({ length: 1001 }, () => ({ name: 'a', size: 1 })) }),
    ]) {
      await expectCode(open(built, { meta: await forgedMeta(built, json) }), 'INTEGRITY_FAILED');
    }
    const later = await open(built, { meta: await forgedMeta(built, '{"files":[{"name":"a","size":5,"mediaType":"x"}],"note":1}') });
    expect(later.files).toEqual([{ name: 'a', size: 5, offset: 0 }]);
  });
});

describe('Truncation (09 8.5)', () => {
  // 8 MiB and a byte pads to 8.25 MiB: the file ends in chunk 128 of 132, and
  // chunks 129 to 131 are only padding.
  const length = 8 * MiB + 1;
  let built: Built;

  it('makes an object whose last chunks are only padding', async () => {
    built = await build([fileOf('big.bin', length)]);
    expect(built.writer.layout.chunkCount).toBe(132);
    expect(built.writer.layout.chunkParts(129, [length]).parts).toEqual([]);
    expect(hex(await download(built, built.object))).toBe(hex(concat(built.files[0].bytes, new Uint8Array(256 * KiB - 1))));
  });

  it('detects cutting any number of padding chunks off the end, as it does cutting content', async () => {
    for (const cut of [1, 2, 3, 4, 10, 131]) {
      const end = built.writer.layout.chunkBytes(132 - cut).start;
      const cutOff = built.object.subarray(0, end);
      // Whether the server says the object is its old size or its new one.
      await expectCode(download(built, cutOff, built.object.byteLength), 'INTEGRITY_FAILED');
      await expectCode(download(built, cutOff), 'INTEGRITY_FAILED');
    }
    for (const bytesOff of [1, 16, 17, 1000]) {
      const cutOff = built.object.subarray(0, built.object.byteLength - bytesOff);
      await expectCode(download(built, cutOff, built.object.byteLength), 'INTEGRITY_FAILED');
      await expectCode(download(built, cutOff), 'INTEGRITY_FAILED');
    }
  });
});

describe('Tampering with the stored object (09 4.6)', () => {
  // 300,000 bytes pad to 303,104: five chunks.
  const file = fileOf('notes.txt', 300_000);
  let built: Built;
  let other: Built;

  const chunked = (chunks: Uint8Array[]) => concat(built.writer.header, ...chunks);

  it('opens the untouched object, however its bytes are split', async () => {
    built = await build([file]);
    // Another object with the same secret and the same file: only the salt differs.
    other = await build([file], { secret: built.writer.secret() });
    expect(built.chunks).toHaveLength(5);
    for (const size of [1, 59, 60, 61, C + 16, 1 << 20]) {
      const out: Uint8Array[] = [];
      for await (const { plaintext } of (await open(built)).read(pieces(built.object, size))) out.push(plaintext);
      expect(sha256(concat(...out).subarray(0, 300_000))).toBe(sha256(file.bytes));
    }
  });

  it('detects a truncation, a dropped middle chunk, a reorder, a duplicate and a chunk from another object', async () => {
    const [c0, c1, c2, c3, c4] = built.chunks;
    const size = built.object.byteLength;
    const cases: Record<string, Uint8Array> = {
      truncated: chunked([c0, c1, c2, c3]),
      'middle chunk dropped': chunked([c0, c1, c3, c4]),
      reordered: chunked([c0, c2, c1, c3, c4]),
      'last two swapped': chunked([c0, c1, c2, c4, c3]),
      'a chunk duplicated in place of another': chunked([c0, c1, c1, c3, c4]),
      'a chunk duplicated as well': chunked([c0, c1, c1, c2, c3, c4]),
      'a chunk from another object': chunked([c0, other.chunks[1], c2, c3, c4]),
      'bytes after the last chunk': concat(built.object, new Uint8Array(1)),
      'a chunk after the last chunk': chunked([c0, c1, c2, c3, c4, c4]),
      'one bit changed': (() => { const b = built.object.slice(); b[70_000] ^= 1; return b; })(),
      'a tag changed': (() => { const b = built.object.slice(); b[60 + C + 15] ^= 0x80; return b; })(),
    };
    expect(other.chunks[1].byteLength).toBe(c1.byteLength);
    for (const [name, bytes] of Object.entries(cases)) {
      // The server may say the object is its first size, or what it holds now.
      for (const reported of new Set([size, bytes.byteLength])) {
        const result = download(built, bytes, reported).then(() => 'opened', (err) => err.code);
        expect({ name, reported, result: await result }).toEqual({ name, reported, result: 'INTEGRITY_FAILED' });
      }
    }
  });

  it("detects an edited header: in the metadata, and in the object's own bytes", async () => {
    const edit = (at: number, value: number) => { const h = built.writer.header.slice(); h[at] = value; return h; };
    // The chunk size (still in range) or the MAC changed: the meta still opens, so the header was changed.
    await expectCode(open(built, { header: edit(10, 2) }), 'INTEGRITY_FAILED');
    await expectCode(open(built, { header: edit(59, built.writer.header[59] ^ 1) }), 'INTEGRITY_FAILED');
    // The salt changed: every key changes with it, so nothing opens, and it can't be told from the wrong link.
    await expectCode(open(built, { header: edit(12, built.writer.header[12] ^ 1) }), 'DECRYPT_FAILED');
    // The content's own header isn't the one the metadata gave.
    const swapped = concat(other.writer.header, ...built.chunks);
    await expectCode(download(built, swapped), 'INTEGRITY_FAILED');
    await expectCode(download(built, built.object.subarray(0, 30), built.object.byteLength), 'INTEGRITY_FAILED');
  });
});

describe('No padding option (09 8.9)', () => {
  it("has no padding option in the public API, and doesn't pad an unencrypted object", () => {
    for (const file of ['../src/types.ts', '../src/index.ts', '../src/helpers.ts']) {
      expect(readFileSync(new URL(file, import.meta.url), 'utf8')).not.toMatch(/pad/i);
    }
    const plain = ObjectLayout.plain(150_000, C);
    expect([plain.length, plain.storedSize, plain.chunkCount]).toEqual([150_000, 150_000, 3]);
    expect(plain.span(100_000, 50_000)).toEqual({ first: 1, last: 2, skip: 34_464, start: 65_536, end: 150_000 });
  });
});

describe('The meta, padded to buckets from 4 KiB (09 8.10)', () => {
  const metaLength = async (names: string[]) =>
    (await createObject(provider, { files: names.map((name) => ({ name, size: 1 })), chunkSize: C })).meta.byteLength;

  it('gives a 1-byte name, a 255-byte name and 50 everyday names the same 4 KiB bucket', async () => {
    const everyday = Array.from({ length: 50 }, (_, i) => `IMG_2026${String(1000 + i)}_holiday (${i}).jpg`);
    expect(await metaLength(['a'])).toBe(12 + 4096 + 16);
    expect(await metaLength(['x'.repeat(251) + '.txt'])).toBe(12 + 4096 + 16);
    expect(await metaLength(everyday)).toBe(12 + 4096 + 16);
  });

  it('doubles at each boundary up to 1 MiB, and refuses a list over it before any request', async () => {
    expect([bucketFor(1), bucketFor(4096), bucketFor(4097), bucketFor(8193), bucketFor(MiB)]).toEqual([4096, 4096, 8192, 16384, MiB]);
    expect(() => bucketFor(MiB + 1)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    // The largest list there can be, 1,000 names of 255 bytes that JSON escapes to 510, still fits.
    expect(encodeManifest(Array.from({ length: 1000 }, () => ({ name: '"'.repeat(255), size: 1 }))).byteLength).toBe(MiB);
    // A 1,001st file is refused, before any key is made.
    let derived = 0;
    const counting = { ...provider, deriveMacKey: (...args: Parameters<CryptoProvider['deriveMacKey']>) => { derived++; return provider.deriveMacKey(...args); } };
    await expectCode(createObject(counting, { files: Array.from({ length: 1001 }, () => ({ name: 'a', size: 1 })), chunkSize: C }), 'INVALID_ARGUMENT');
    expect(derived).toBe(0);
  });
});

describe('Members and resume points', () => {
  it('reads a member from its own run of chunks, never one that is only padding', async () => {
    const files = [fileOf('report.pdf', 100_000, 0), fileOf('photo.jpg', 50_000, 1)];
    const built = await build(files);
    const opened = await open(built);
    expect(opened.member(0)).toEqual({ first: 0, last: 1, skip: 0, start: 60, end: 60 + 2 * (C + 16) });
    expect(opened.member(1)).toEqual({ first: 1, last: 2, skip: 34_464, start: 60 + C + 16, end: 151_660 });
    for (const index of [0, 1]) {
      const span = opened.member(index);
      const out: Uint8Array[] = [];
      for await (const { plaintext } of opened.chunks(pieces(built.object.subarray(span.start, span.end)), span.first, span.last)) out.push(plaintext);
      const member = concat(...out).subarray(span.skip, span.skip + files[index].bytes.byteLength);
      expect(sha256(member)).toBe(sha256(files[index].bytes));
    }
    // Asking for the member's chunks with a byte missing, or another chunk's bytes, fails.
    const span = opened.member(0);
    await expectCode(collect(opened.chunks([built.object.subarray(span.start, span.end - 1)], span.first, span.last)), 'INTEGRITY_FAILED');
    await expectCode(collect(opened.chunks([built.object.subarray(span.start, span.end)], 1, 2)), 'INTEGRITY_FAILED');
  });

  it("stops a big file's member at its last chunk with any of the file in it", async () => {
    const layout = ObjectLayout.encrypted(padme(8 * MiB + 1), C);
    expect(layout.span(0, 8 * MiB + 1)).toMatchObject({ first: 0, last: 128 });
    expect(layout.chunkCount).toBe(132);
  });

  it('resumes from the next whole chunk after the last one written', async () => {
    const built = await build([fileOf('notes.txt', 300_000)]);
    const opened = await open(built);
    const all = await readAll(opened, built.object);
    for (const next of [1, 3, 4]) {
      const { start, end } = opened.layout.range(next);
      expect(start).toBe(60 + next * (C + 16));
      expect(end).toBe(built.object.byteLength);
      const rest = await collect(opened.chunks(pieces(built.object.subarray(start, end)), next));
      expect(sha256(concat(...rest))).toBe(sha256(all.subarray(next * C)));
    }
  });
});

describe("The object's exact bytes (09 8.11, core's half)", () => {
  for (const vector of vectors) {
    it(`makes the pinned bytes: ${vector.name}`, async () => {
      const { input, output } = vector;
      const files = input.files.map((file, k) => fileOf(file.name, file.size, k));
      const secret = fromHex(input.secret);
      const salt = fromHex(input.salt);
      const built = await build(files, {
        chunkSize: input.chunkSize, maxBytes: input.maxBytes, secret, salt, using: withMetaNonce(fromHex(input.metaNonce)),
      });

      // The keys can't leave the provider, so they're checked by what they make:
      // the pinned keys are HKDF's, and core's header, chunks and meta are those keys' bytes.
      const keys = reference.deriveKeys(Buffer.from(secret), Buffer.from(salt));
      expect({ header: hex(keys.header), payload: hex(keys.payload), meta: hex(keys.meta) }).toEqual(output.keys);
      expect(hex(built.writer.header)).toBe(output.header);
      expect(built.writer.layout.length).toBe(output.paddedLength);
      expect(built.object.byteLength).toBe(output.storedSize);
      expect(built.chunks.map((chunk) => ({ length: chunk.byteLength, sha256: sha256(chunk) }))).toEqual(output.chunks);
      expect(hex(built.chunks[built.chunks.length - 1].subarray(-32))).toBe(output.lastChunk);
      expect({ length: built.writer.meta.byteLength, sha256: sha256(built.writer.meta) }).toEqual(output.meta);
      expect(sha256(built.object)).toBe(output.object.sha256);

      // The second implementation, node:crypto from the format itself, makes the same bytes.
      const second = reference.buildObject({
        secret, salt, chunkSize: input.chunkSize, maxBytes: input.maxBytes, metaNonce: fromHex(input.metaNonce),
        files: files.map((file) => ({ name: file.name, bytes: file.bytes })),
      });
      expect(sha256(second.object)).toBe(output.object.sha256);
      expect(sha256(second.meta)).toBe(output.meta.sha256);

      // And it opens again to its files.
      const opened = await open(built);
      expect(opened.files.map(({ name, size }) => ({ name, size }))).toEqual(input.files);
      const plaintext = await readAll(opened, built.object);
      expect(sha256(plaintext.subarray(0, opened.totalSize))).toBe(sha256(concat(...files.map((f) => f.bytes))));
    });
  }

  it("refuses a changed magic, version, suite, reserved byte or out-of-range chunk size before any key is made", async () => {
    const built = await build([fileOf('a.txt', 1)]);
    let derived = 0;
    const counting: CryptoProvider = {
      ...provider,
      deriveMacKey: (...args) => { derived++; return provider.deriveMacKey(...args); },
      deriveContentKey: (...args) => { derived++; return provider.deriveContentKey(...args); },
    };
    const edited = (at: number, value: number) => { const h = built.writer.header.slice(); h[at] = value; return h; };
    const chunkSized = (size: number) => { const h = built.writer.header.slice(); new DataView(h.buffer).setUint32(8, size); return h; };
    const cases: Array<[string, Uint8Array, string]> = [
      ['magic', edited(0, 0x45), 'INTEGRITY_FAILED'],
      ['version 3', edited(4, 3), 'VERSION_UNSUPPORTED'],
      ['version 5', edited(4, 5), 'VERSION_UNSUPPORTED'],
      ['suite 2', edited(5, 2), 'VERSION_UNSUPPORTED'],
      ['reserved byte 6', edited(6, 1), 'INTEGRITY_FAILED'],
      ['reserved byte 7', edited(7, 1), 'INTEGRITY_FAILED'],
      ['chunk size below 64 KiB', chunkSized(C - 1), 'INTEGRITY_FAILED'],
      ['chunk size above 64 MiB', chunkSized(64 * MiB + 1), 'INTEGRITY_FAILED'],
      ['59 bytes', built.writer.header.subarray(0, 59), 'INTEGRITY_FAILED'],
    ];
    for (const [name, header, code] of cases) {
      const result = await openObject(counting, { secret: built.writer.secret(), header, meta: built.writer.meta, size: 77 })
        .then(() => 'opened', (err) => err.code);
      expect({ name, result }).toEqual({ name, result: code });
    }
    expect(derived).toBe(0);
    // The bounds themselves are fine (a different MAC, so the header was changed).
    await expectCode(openObject(counting, { secret: built.writer.secret(), header: chunkSized(64 * MiB), meta: built.writer.meta, size: 77 }), 'INTEGRITY_FAILED');
    expect(derived).toBe(3);
  });

  it('is DECRYPT_FAILED for the wrong secret, and INTEGRITY_FAILED for a changed header or meta with the right one', async () => {
    const built = await build([fileOf('a.txt', 1)]);
    const wrong = built.writer.secret();
    wrong[0] ^= 1;
    await expectCode(open(built, { secret: wrong }), 'DECRYPT_FAILED');
    await expectCode(open(built, { secret: new Uint8Array(16) }), 'DECRYPT_FAILED');
    const mac = built.writer.header.slice();
    mac[40] ^= 1;
    await expectCode(open(built, { header: mac }), 'INTEGRITY_FAILED');
    const meta = built.writer.meta.slice();
    meta[100] ^= 1;
    await expectCode(open(built, { meta }), 'INTEGRITY_FAILED');
    await expectCode(open(built, { size: 76 }), 'INTEGRITY_FAILED');
    // The wrong secret's error says nothing of either secret.
    const err = await open(built, { secret: wrong }).catch((e) => e);
    for (const text of [JSON.stringify(err), String(err), inspect(err)]) {
      expect(text).not.toContain(hex(wrong));
      expect(text).not.toContain(hex(built.writer.secret()));
    }
  });

  it('never seals one chunk index twice; a chunk in flight is kept, to be sent again byte for byte', async () => {
    const writer = await createObject(provider, { files: [{ name: 'a.bin', size: 2 * C }], chunkSize: C });
    const first = new Uint8Array(C).fill(1);
    const sealed = await writer.seal(0, first);
    // A pause with chunk 0 in flight: its bytes are the ones sent after it.
    expect(writer.kept(0)).toBe(sealed);
    expect(hex(writer.kept(0)!)).toBe(hex(sealed));
    // The source changed during the pause: chunk 0 is never sealed again, over the same bytes or new ones.
    await expectCode(writer.seal(0, new Uint8Array(C).fill(2)), 'ENCRYPT_FAILED');
    await expectCode(writer.seal(0, first), 'ENCRYPT_FAILED');
    expect(writer.isSealed(0)).toBe(true);
    // The server has it: it's no longer kept.
    writer.confirm(0);
    expect(writer.kept(0)).toBeUndefined();
    // A wrong length is refused without using up the index; two seals at once, only one.
    await expectCode(writer.seal(1, new Uint8Array(C - 1)), 'INVALID_ARGUMENT');
    expect(writer.isSealed(1)).toBe(false);
    const both = await Promise.allSettled([writer.seal(1, new Uint8Array(C)), writer.seal(1, new Uint8Array(C).fill(3))]);
    expect(both.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    await expectCode(writer.seal(2, new Uint8Array(1)), 'INVALID_ARGUMENT');
  });

  it("makes a new salt, so new keys, for every object, and shows nothing of its secret or keys", async () => {
    const a = await createObject(provider, { files: [{ name: 'a', size: 1 }], chunkSize: C });
    const b = await createObject(provider, { files: [{ name: 'a', size: 1 }], chunkSize: C, secret: a.secret() });
    expect(hex(a.header.subarray(12, 28))).not.toBe(hex(b.header.subarray(12, 28)));
    expect(hex(await a.seal(0, new Uint8Array([7])))).not.toBe(hex(await b.seal(0, new Uint8Array([7]))));
    expect(a.secret()).toHaveLength(32);
    for (const text of [JSON.stringify({ a }), String(a), inspect(a), JSON.stringify(await openObject(provider, { secret: a.secret(), header: a.header, meta: a.meta, size: 77 }))]) {
      expect(text).not.toContain(hex(a.secret()));
      expect(text).toContain('[DropgateObject]');
    }
  });

  it('puts the index, 11 bytes big-endian, and the last flag in each nonce', () => {
    expect(hex(chunkNonce(0, false))).toBe('000000000000000000000000');
    expect(hex(chunkNonce(0, true))).toBe('000000000000000000000001');
    expect(hex(chunkNonce(258, false))).toBe('000000000000000000010200');
    expect(hex(chunkNonce(2 ** 40 + 1, true))).toBe('000000000001000000000101');
    for (const index of [0, 1, 255, 256, 99_999, 2 ** 47 - 1]) {
      for (const last of [false, true]) expect(hex(chunkNonce(index, last))).toBe(hex(reference.chunkNonce(index, last)));
    }
  });
});

// node:crypto, for opening chunks independently of core.
async function referenceKeys(built: Built) {
  return reference.deriveKeys(Buffer.from(built.writer.secret()), Buffer.from(built.writer.header.subarray(12, 28)));
}

function gcmOpen(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array): Uint8Array {
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(sealed.subarray(sealed.byteLength - 16));
  return new Uint8Array(Buffer.concat([decipher.update(sealed.subarray(0, sealed.byteLength - 16)), decipher.final()]));
}

async function collect<T>(iterable: AsyncIterable<{ plaintext: T }>): Promise<T[]> {
  const out: T[] = [];
  for await (const { plaintext } of iterable) out.push(plaintext);
  return out;
}
