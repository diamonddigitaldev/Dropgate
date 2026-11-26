import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { nobleProvider, webCryptoProvider, type NamedCryptoProvider } from '../src/crypto/index.js';
import {
  BIND_BYTES, BLOCK_BYTES, DATA_HEADER_BYTES, HELLO_BYTES, MANIFEST_HEADER_BYTES, MAX_MANIFEST_BYTES, MAX_MANIFEST_FILES, ManifestAssembler,
  blockCount, chainBlock, chainFileEnd, chainStart, dataBytes, decodeHello, decodeManifest, decodeMessage, encodeHello, encodeManifest,
  encodeMessage, manifestFragmentBytes, manifestRecords, type Hello, type ManifestFile, type Message,
} from '../src/dgdtp/messages.js';
import { fromHex, hex } from './helpers/cpace-vectors.js';
import { largestManifestFiles, messageVectorChecks } from './helpers/message-checks.js';
// The second implementation: plain JavaScript on node:crypto.
import * as reference from './helpers/reference-messages.mjs';

// DGDTP 4's records (src/dgdtp/messages.ts) and the rendezvous's messages
// (src/dgdtp/rendezvous.ts) as bytes, on each of core's crypto providers: the
// pinned vectors from a second implementation on node:crypto (tests/helpers/
// reference-messages.mjs), written from the format and not from core, for
// every record at its edges, records read leniently, records refused, the
// manifest (one file, several with empty ones, exactly 1 MiB) and its hash,
// the checkpoint chain over files at the block edges, and every rendezvous
// message; then what the vectors can't hold: arguments refused before
// anything is written, the manifest cut into records and put back together,
// and its limits.

const PROVIDERS: Array<[string, NamedCryptoProvider]> = [
  ['WebCrypto', webCryptoProvider(globalThis.crypto)], ['@noble', nobleProvider(globalThis.crypto)],
];

const codeOf = (run: () => unknown) => {
  try {
    run();
    return 'accepted';
  } catch (err) {
    return String((err as { code?: string }).code ?? err);
  }
};

const HELLO: Hello = { major: 4, minor: 0, features: 0, maxRecord: 65535, pauseLimitSeconds: 0, reconnectWindowSeconds: 120 };
const bytes = (n: number, fill = 1) => new Uint8Array(n).fill(fill);

describe.each(PROVIDERS)('the message vectors on %s', (_name, provider) => {
  it('every check gives the second implementation\'s answer', async () => {
    const checks = await messageVectorChecks(provider);
    expect(checks.filter(({ expected, actual }) => expected !== actual)).toEqual([]);
    expect(checks.length).toBeGreaterThan(300);
  });
});

describe('the vectors themselves', () => {
  it('are what the second implementation writes now, byte for byte', () => {
    const pinned = readFileSync(new URL('./fixtures/dgdtp-message-vectors.json', import.meta.url), 'utf8');
    expect(JSON.parse(pinned)).toEqual(JSON.parse(JSON.stringify(reference.vectors())));
  });

  it('cover every record type of this version, and refuse the two kept for a resume', () => {
    const vectors = reference.vectors();
    const types = new Set(vectors.records.map(({ record }: { record: string }) => parseInt(record.slice(0, 2), 16)));
    expect([...types].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 18]);
    for (const type of [16, 17]) expect(codeOf(() => decodeMessage(Uint8Array.of(type)))).toBe('INVALID_MESSAGE');
  });

  it('hold every fixed record\'s length as the format gives it', () => {
    const lengths: Record<string, number> = {};
    for (const { fields, record } of reference.vectors().records) lengths[fields.type] = Math.max(lengths[fields.type] ?? 0, record.length / 2);
    expect(lengths).toMatchObject({
      bind: 51, accept: 74, 'block-end': 49, 'file-end': 53, credit: 41, finish: 77, result: 62, 'result-ack': 17, hold: 3, close: 19,
      'close-ack': 79, ping: 9, pong: 9, status: 82,
    });
    expect(BIND_BYTES).toBe(51);
    expect(HELLO_BYTES).toBe(18);
  });
});

describe('records', () => {
  it('a refused record says nothing of what it held', () => {
    let error: unknown;
    try {
      decodeMessage(Uint8Array.of(9, ...new TextEncoder().encode('zq7secret-name.txt')));
    } catch (err) {
      error = err;
    }
    expect(error).toMatchObject({ code: 'INVALID_MESSAGE', origin: 'peer' });
    expect(JSON.stringify(error)).not.toMatch(/zq7/);
    expect(String((error as Error).message)).toBe("The other device sent something this version of Dropgate doesn't understand.");
  });

  it("the sender's hello alone is exactly 18 bytes, as BIND carries it", () => {
    const hello = encodeHello(HELLO);
    expect(hello.byteLength).toBe(18);
    expect(decodeHello(hello)).toEqual(HELLO);
    const bind = encodeMessage({ type: 'bind', closeSecret: bytes(32), hello: HELLO });
    expect(hex(bind.subarray(33))).toBe(hex(hello));
    expect(codeOf(() => decodeHello(hello.subarray(0, 17)))).toBe('INVALID_MESSAGE');
    expect(codeOf(() => decodeHello(new Uint8Array([...hello, 0])))).toBe('INVALID_MESSAGE');
    expect(codeOf(() => decodeHello('hello' as unknown as Uint8Array))).toBe('INVALID_MESSAGE');
  });

  it('refuses to write a field outside what its type allows, before writing anything', () => {
    const refusals: Array<[string, Message | unknown]> = [
      ['no type', {}],
      ['an unknown type', { type: 'resume' }],
      ['a short close secret', { type: 'bind', closeSecret: bytes(31), hello: HELLO }],
      ['a hello naming 16,383', { type: 'bind', closeSecret: bytes(32), hello: { ...HELLO, maxRecord: 16383 } }],
      ['a hello naming 65,536', { type: 'bind', closeSecret: bytes(32), hello: { ...HELLO, maxRecord: 65536 } }],
      ['a hello major of 256', { type: 'bind', closeSecret: bytes(32), hello: { ...HELLO, major: 256 } }],
      ['a hello with a fractional window', { type: 'bind', closeSecret: bytes(32), hello: { ...HELLO, reconnectWindowSeconds: 1.5 } }],
      ['an empty fragment', { type: 'manifest', total: 1, offset: 0, fragment: new Uint8Array(0) }],
      ['a fragment past the total', { type: 'manifest', total: 2, offset: 1, fragment: bytes(2) }],
      ['a total over 1 MiB', { type: 'manifest', total: MAX_MANIFEST_BYTES + 1, offset: 0, fragment: bytes(1) }],
      ['ACCEPT with no sink', { type: 'accept', manifestHash: bytes(32), resumeSecret: bytes(32), creditLimit: 1, sink: 'disk' }],
      ['ACCEPT with a negative limit', { type: 'accept', manifestHash: bytes(32), resumeSecret: bytes(32), creditLimit: -1, sink: 'saved' }],
      ['empty DATA', { type: 'data', fileIndex: 0, offset: 0, bytes: new Uint8Array(0) }],
      ['DATA at 2^53', { type: 'data', fileIndex: 0, offset: 2 ** 53, bytes: bytes(1) }],
      ['DATA past file 2^32 - 1', { type: 'data', fileIndex: 2 ** 32, offset: 0, bytes: bytes(1) }],
      ['a block over 1 MiB', { type: 'block-end', fileIndex: 0, blockIndex: 0, length: BLOCK_BYTES + 1, hash: bytes(32) }],
      ['a short chain', { type: 'file-end', fileIndex: 0, size: 0, blockCount: 0, chain: bytes(31) }],
      ['a CREDIT revision of 1.5', { type: 'credit', revision: 1.5, limit: 0, consumed: 0, filesDone: 0, verifiedFileIndex: 0, verifiedOffset: 0 }],
      ['a RESULT with no assurance', { type: 'result', commitId: bytes(16), assurance: 'kept', fileCount: 1, totalSize: 1, chain: bytes(32) }],
      ['HOLD held as a number', { type: 'hold', held: 1, reason: 'person' }],
      ['HOLD for no reason', { type: 'hold', held: true, reason: 'nobody' }],
      ['CLOSE for no reason', { type: 'close', operationId: bytes(16), reason: 'BORED' }],
      ['CLOSE with a detail but not FAILED', { type: 'close', operationId: bytes(16), reason: 'USER_CANCELLED', detail: 'TIMED_OUT' }],
      ['CLOSE with a detail that isn\'t one', { type: 'close', operationId: bytes(16), reason: 'FAILED', detail: 'OOPS' }],
      ['CLOSE_ACK finished with no result', { type: 'close-ack', operationId: bytes(16), finished: true }],
      ['PING with a number id', { type: 'ping', id: 1 }],
      ['PONG with an id of 2^64', { type: 'pong', id: 2n ** 64n }],
      ['STATUS of no kind', { type: 'status', kind: 'tell', id: 0n }],
      ['STATUS with a state of 256', { type: 'status', kind: 'answer', id: 0n, state: 256, held: false, consumed: 0 }],
    ];
    for (const [name, message] of refusals) expect(codeOf(() => encodeMessage(message as Message)), name).toBe('INVALID_ARGUMENT');
  });
});

describe('the manifest', () => {
  const files: ManifestFile[] = [{ name: 'a.txt', size: 3, type: 'text/plain' }, { name: 'b', size: 0, type: '' }];

  it('leaves out a media type that isn\'t printable ASCII of at most 127 characters, as it\'s only advice', () => {
    for (const type of ['text/ü', 'x'.repeat(128), 'tab\there', undefined as unknown as string]) {
      const read = decodeManifest(encodeManifest([{ name: 'a', size: 1, type }]));
      expect(read.files[0].type).toBe('');
    }
    expect(decodeManifest(encodeManifest([{ name: 'a', size: 1, type: 'x'.repeat(127) }])).files[0].type).toBe('x'.repeat(127));
  });

  it("refuses on the sender a name core's rule refuses (INVALID_FILENAME), and no files, too many, a bad size or a total over 2^53 - 1", () => {
    expect(codeOf(() => encodeManifest([{ name: '', size: 1, type: '' }]))).toBe('INVALID_FILENAME');
    expect(codeOf(() => encodeManifest([{ name: 'a/b', size: 1, type: '' }]))).toBe('INVALID_FILENAME');
    expect(codeOf(() => encodeManifest([{ name: 'é'.repeat(128), size: 1, type: '' }]))).toBe('INVALID_FILENAME');
    expect(codeOf(() => encodeManifest([]))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => encodeManifest(Array.from({ length: MAX_MANIFEST_FILES + 1 }, (_, i) => ({ name: `f${i}`, size: 0, type: '' }))))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => encodeManifest(Array.from({ length: MAX_MANIFEST_FILES }, (_, i) => ({ name: `f${i}`, size: 0, type: '' }))))).toBe('accepted');
    expect(codeOf(() => encodeManifest([{ name: 'a', size: -1, type: '' }]))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => encodeManifest([{ name: 'a', size: 0.5, type: '' }]))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => encodeManifest([{ name: 'a', size: Number.MAX_SAFE_INTEGER, type: '' }, { name: 'b', size: 1, type: '' }]))).toBe('INVALID_ARGUMENT');
  });

  it('refuses one byte over 1 MiB on the sender, and as received', () => {
    const files = largestManifestFiles();
    expect(encodeManifest(files).byteLength).toBe(MAX_MANIFEST_BYTES);
    const over = [...files.slice(0, -1), { ...files[files.length - 1], name: `${files[files.length - 1].name}x` }];
    expect(codeOf(() => encodeManifest(over))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => decodeManifest(reference.manifest(over)))).toBe('INVALID_MANIFEST');
  });

  it('refuses as received (INVALID_MANIFEST) anything that doesn\'t add up', () => {
    const good = reference.manifest(files);
    const with_ = (at: number, ...values: number[]) => { const b = Buffer.from(good); values.forEach((v, i) => { b[at + i] = v; }); return b; };
    const refusals: Array<[string, Uint8Array]> = [
      ['nothing', new Uint8Array(0)],
      ['version 2', with_(0, 2)],
      ['a block size of 2 MiB', with_(1, 0, 0x20, 0, 0)],
      ['no files', reference.manifest([]).subarray(0, 17)],
      ['10,001 files, each whole', reference.manifest(Array.from({ length: MAX_MANIFEST_FILES + 1 }, (_, i) => ({ name: `f${i}`, size: 0, type: '' })))],
      ['a total one more than the sizes', with_(16, 4)],
      ['a total one less', with_(16, 2)],
      ['a byte after the last file', Buffer.concat([good, Buffer.from([0])])],
      ['the last byte missing', good.subarray(0, good.length - 1)],
      ['an empty name', reference.manifest([{ name: '', size: 1, type: '' }])],
      ['a name with a path', reference.manifest([{ name: '../etc', size: 1, type: '' }])],
      ['a name with a control character', reference.manifest([{ name: 'a\u0007b', size: 1, type: '' }])],
      ['a name of 256 bytes', reference.manifest([{ name: 'n'.repeat(256), size: 1, type: '' }])],
      ['a name that isn\'t UTF-8', Buffer.concat([good.subarray(0, 25), Buffer.from([0xff]), good.subarray(26)])],
      ['a media type of 128', reference.manifest([{ name: 'a', size: 1, type: 'x'.repeat(128) }])],
      ['a media type with a control character', reference.manifest([{ name: 'a', size: 1, type: 'a\tb' }])],
      ['a size of 2^53', Buffer.concat([Buffer.from([1, 0, 0x10, 0, 0, 0, 0, 0, 1]), Buffer.from('0020000000000000', 'hex'), Buffer.from('0020000000000000', 'hex'), Buffer.from([0, 1, 0x61, 0])])],
      ['sizes adding past 2^53 - 1', reference.manifest([{ name: 'a', size: Number.MAX_SAFE_INTEGER, type: '' }, { name: 'b', size: 1, type: '' }])],
    ];
    for (const [name, manifest] of refusals) expect(codeOf(() => decodeManifest(manifest)), name).toBe('INVALID_MANIFEST');
    // 10,000 is the most, and taken.
    const most = reference.manifest(Array.from({ length: MAX_MANIFEST_FILES }, (_, i) => ({ name: `f${i}`, size: 0, type: '' })));
    expect(decodeManifest(most).files).toHaveLength(MAX_MANIFEST_FILES);
    expect(decodeManifest(good)).toEqual({ files, totalSize: 3 });
  });

  it('goes in MANIFEST records, each the most a record holds, and comes back together; anything out of order is refused', () => {
    const manifest = encodeManifest(largestManifestFiles());
    for (const recordBytes of [65535, 16384, 20000]) {
      const records = manifestRecords(manifest, recordBytes);
      const most = manifestFragmentBytes(recordBytes);
      expect(most).toBe(recordBytes - 16 - MANIFEST_HEADER_BYTES);
      expect(records.length).toBe(Math.ceil(manifest.byteLength / most));
      // Every record but the last is as large as a record can be.
      for (const record of records.slice(0, -1)) expect(record.byteLength).toBe(recordBytes - 16);
      const assembler = new ManifestAssembler(recordBytes);
      let whole: Uint8Array | undefined;
      for (const record of records) {
        expect(whole).toBeUndefined();
        const m = decodeMessage(record);
        if (m.type !== 'manifest') throw new Error('not a manifest record');
        whole = assembler.take(m);
      }
      expect(assembler.complete).toBe(true);
      expect(hex(whole as Uint8Array)).toBe(hex(manifest));
    }
    const records = manifestRecords(manifest, 65535).map((r) => decodeMessage(r) as Extract<Message, { type: 'manifest' }>);
    const fresh = () => new ManifestAssembler(65535);
    const refused = (steps: Array<Extract<Message, { type: 'manifest' }>>) => codeOf(() => {
      const a = fresh();
      for (const step of steps) a.take(step);
    });
    expect(refused([records[1]])).toBe('INVALID_MANIFEST');
    expect(refused([records[0], records[0]])).toBe('INVALID_MANIFEST');
    expect(refused([records[0], records[2]])).toBe('INVALID_MANIFEST');
    expect(refused([{ ...records[0], fragment: records[0].fragment.subarray(1) }])).toBe('INVALID_MANIFEST');
    expect(refused([records[0], { ...records[1], total: records[1].total - 1 }])).toBe('INVALID_MANIFEST');
    expect(refused([...records, records[records.length - 1]])).toBe('INVALID_MANIFEST');
    // A small manifest is one record; one too small for its own fragment's size is refused.
    const small = encodeManifest(files);
    expect(manifestRecords(small, 65535)).toHaveLength(1);
    expect(hex(fresh().take(decodeMessage(manifestRecords(small, 65535)[0]) as Extract<Message, { type: 'manifest' }>) as Uint8Array)).toBe(hex(small));
    expect(codeOf(() => new ManifestAssembler(16383))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => manifestRecords(small, 65536))).toBe('INVALID_ARGUMENT');
  });
});

describe('blocks and the chain', () => {
  const provider = PROVIDERS[0][1];

  it('a DATA record holds 65,505 bytes at 65,535, so a block is 16 of them and one of 496', () => {
    expect(dataBytes(65535)).toBe(65505);
    expect(DATA_HEADER_BYTES + 16).toBe(30);
    expect(16 * 65505 + 496).toBe(BLOCK_BYTES);
    expect(dataBytes(16384)).toBe(16354);
  });

  it('counts blocks: none for an empty file, one up to 1 MiB, two at 1 MiB + 1', () => {
    expect([0, 1, BLOCK_BYTES - 1, BLOCK_BYTES, BLOCK_BYTES + 1, Number.MAX_SAFE_INTEGER].map(blockCount))
      .toEqual([0, 1, 1, 1, 2, Math.ceil(Number.MAX_SAFE_INTEGER / BLOCK_BYTES)]);
    expect(codeOf(() => blockCount(-1))).toBe('INVALID_ARGUMENT');
  });

  it('refuses a checkpoint, hash or field that isn\'t one', async () => {
    const c = await chainStart(provider, bytes(32));
    const refused = async (run: () => Promise<unknown>) => {
      try {
        await run();
        return 'accepted';
      } catch (err) {
        return (err as { code?: string }).code;
      }
    };
    expect(await refused(() => chainStart(provider, bytes(31)))).toBe('INVALID_ARGUMENT');
    expect(await refused(() => chainBlock(provider, bytes(31), { fileIndex: 0, blockIndex: 0, length: 1, hash: bytes(32) }))).toBe('INVALID_ARGUMENT');
    expect(await refused(() => chainBlock(provider, c, { fileIndex: 0, blockIndex: 0, length: BLOCK_BYTES + 1, hash: bytes(32) }))).toBe('INVALID_ARGUMENT');
    expect(await refused(() => chainBlock(provider, c, { fileIndex: 0, blockIndex: 0, length: 1, hash: bytes(16) }))).toBe('INVALID_ARGUMENT');
    expect(await refused(() => chainFileEnd(provider, c, { fileIndex: -1, size: 0, blockCount: 0 }))).toBe('INVALID_ARGUMENT');
    // Each step changes the chain, and depends on every field.
    const step = { fileIndex: 0, blockIndex: 0, length: 1, hash: bytes(32) };
    const base = hex(await chainBlock(provider, c, step));
    for (const changed of [{ fileIndex: 1 }, { blockIndex: 1 }, { length: 2 }, { hash: bytes(32, 2) }]) {
      expect(hex(await chainBlock(provider, c, { ...step, ...changed }))).not.toBe(base);
    }
    const end = hex(await chainFileEnd(provider, c, { fileIndex: 0, size: 1, blockCount: 1 }));
    expect(end).not.toBe(base);
    expect(hex(fromHex(end))).toBe(end);
  });
});
