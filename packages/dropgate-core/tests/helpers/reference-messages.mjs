// A second implementation of DGDTP 4's records, manifest, checkpoint chain and
// rendezvous messages, on node:crypto, written from the format below rather
// than from core's src/dgdtp/messages.ts and rendezvous.ts. Core's tests check
// that both make the same bytes: the pinned vectors in
// tests/fixtures/dgdtp-message-vectors.json came from this file
// (`node tests/helpers/reference-messages.mjs` writes them again).
//
// Records: type (1) || fields, big-endian, exact lengths.
//    1 BIND        closeSecret (32) || hello (18)                                        51
//    2 MANIFEST    total (4) || offset (4) || fragment (1 or more)
//    3 ACCEPT      manifestHash (32) || resumeSecret (32) || credit limit (8) || sink (1)  74   sink 1 saved, 2 handed off
//    4 DATA        flags (1, 0) || fileIndex (4) || offset (8) || bytes (1 or more)
//    5 BLOCK_END   fileIndex (4) || blockIndex (8) || length (4) || SHA-256 (32)           49
//    6 FILE_END    fileIndex (4) || size (8) || blockCount (8) || chain (32)               53
//    7 CREDIT      revision (8) || limit (8) || consumed (8) || filesDone (4)
//                  || verified fileIndex (4) || verified offset (8)                      41
//    8 FINISH      fileCount (4) || totalSize (8) || manifestHash (32) || chain (32)       77
//    9 RESULT      commitId (16) || assurance (1) || fileCount (4) || totalSize (8) || chain (32)   62
//   10 RESULT_ACK  commitId (16)                                                           17
//   11 HOLD        held (1: 0, 1) || reason (1: 1 the person, 2 the app; others read as 1)  3
//   12 CLOSE       operationId (16) || reason (1) || detail (1)                            19
//   13 CLOSE_ACK   operationId (16) || finished (1) || RESULT's body (61) when finished     18 or 79
//   14 PING, 15 PONG  id (8)                                                               9
//   16 RESUME, 17 RESUME_OK  reserved: refused
//   18 STATUS      kind (1: 1 ask, 2 answer) || id (8) || for an answer: state (1) || held (1)
//                  || consumed (8) || has result (1) || RESULT's body (61) if so            10, 21 or 82
// The hello: major (1) || minor (1) || features (4) || maxRecord (4: 16,384 to 65,535)
//   || pauseLimit seconds (4) || reconnectWindow seconds (4).
// CLOSE's reasons 1 USER_CANCELLED, 2 USER_DECLINED, 3 APP_CLOSED, 4 PAUSE_LIMIT,
// 5 RECOVERY_EXHAUSTED, 6 FAILED; its detail (with FAILED, else 0) 1 OUTPUT_WRITE_FAILED,
// 2 OUTPUT_STALLED, 3 SOURCE_UNAVAILABLE, 4 INTEGRITY_FAILED, 5 INVALID_MANIFEST,
// 6 INVALID_MESSAGE, 7 TIMED_OUT, 8 CAPABILITY_UNSUPPORTED. A value not listed: FAILED, no detail.
// 64-bit sizes are at most 2^53 - 1.
//
// The manifest: version (1) = 1 || blockSize (4) = 1,048,576 || fileCount (4) || totalSize (8),
// then per file: size (8) || nameLength (2) || name (UTF-8) || typeLength (1) || mediaType (ASCII).
// manifestHash = SHA-256("dropgate/4 dgdtp manifest" || manifest).
// The chain: C0 = SHA-256("dropgate/4 dgdtp checkpoint" || manifestHash); each 1 MiB block
// C = SHA-256(C || 0x01 || fileIndex (4) || blockIndex (8) || length (4) || blockHash (32)); each
// file's end C = SHA-256(C || 0x02 || fileIndex (4) || size (8) || blockCount (8)).
//
// The rendezvous: type (1) || fields.
//   0x01 CREATE   major || minor || roomId (16) || roomNonce (16) || flags (bit 0 a code) || credential length (2) || credential
//   0x02 CODE, 0x03 RENEW, 0x06 LOCK   nothing
//   0x04 SEND     tag (1) || frame (0 to 8,230)        0x05 DROP   tag (1)
//   0x81 CREATED, 0x82 CODE_IS   locator length (1) || locator
//   0x83 ATTEMPT  tag (1) || by (1: 1 link, 2 code)   0x84 FRAME   tag || frame   0x85 GONE   tag   0x86 CODE_GONE
//   0x11 JOIN     major || minor || by (1: 1 room ID, 2 locator) || roomId (16), or locator length (1) || locator
//   0x12 SEND     frame                                0x91 JOINED  roomNonce (16)   0x92 FRAME  frame   0x93 GONE
//   0xFF ERROR    code (1) || for 1 (VERSION_UNSUPPORTED) the server's major (1) and minor (1)

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest();

/** Field writers: each takes a value from the vectors' JSON (numbers, hex strings) and gives its bytes. */
const field = {
  u8: (n) => Buffer.from([n]),
  u16: (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; },
  u32: (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; },
  u64: (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; },
  /** An 8-byte id, given as 16 hex digits. */
  id8: (h) => Buffer.from(h, 'hex'),
  hex: (h) => Buffer.from(h, 'hex'),
};

const hello = (h) => Buffer.concat([
  field.u8(h.major), field.u8(h.minor), field.u32(h.features), field.u32(h.maxRecord), field.u32(h.pauseLimitSeconds), field.u32(h.reconnectWindowSeconds),
]);
const assurance = { saved: 1, 'handed-off': 2 };
const resultBody = (r) => Buffer.concat([field.hex(r.commitId), field.u8(assurance[r.assurance]), field.u32(r.fileCount), field.u64(r.totalSize), field.hex(r.chain)]);
const REASONS = ['USER_CANCELLED', 'USER_DECLINED', 'APP_CLOSED', 'PAUSE_LIMIT', 'RECOVERY_EXHAUSTED', 'FAILED'];
const DETAILS = ['OUTPUT_WRITE_FAILED', 'OUTPUT_STALLED', 'SOURCE_UNAVAILABLE', 'INTEGRITY_FAILED', 'INVALID_MANIFEST', 'INVALID_MESSAGE', 'TIMED_OUT', 'CAPABILITY_UNSUPPORTED'];

/** Each record's type number and how its fields are laid out, from the table above. */
const LAYOUT = {
  bind: [1, (m) => [field.hex(m.closeSecret), hello(m.hello)]],
  manifest: [2, (m) => [field.u32(m.total), field.u32(m.offset), field.hex(m.fragment)]],
  accept: [3, (m) => [field.hex(m.manifestHash), field.hex(m.resumeSecret), field.u64(m.creditLimit), field.u8(assurance[m.sink])]],
  data: [4, (m) => [field.u8(0), field.u32(m.fileIndex), field.u64(m.offset), field.hex(m.bytes)]],
  'block-end': [5, (m) => [field.u32(m.fileIndex), field.u64(m.blockIndex), field.u32(m.length), field.hex(m.hash)]],
  'file-end': [6, (m) => [field.u32(m.fileIndex), field.u64(m.size), field.u64(m.blockCount), field.hex(m.chain)]],
  credit: [7, (m) => [field.u64(m.revision), field.u64(m.limit), field.u64(m.consumed), field.u32(m.filesDone), field.u32(m.verifiedFileIndex), field.u64(m.verifiedOffset)]],
  finish: [8, (m) => [field.u32(m.fileCount), field.u64(m.totalSize), field.hex(m.manifestHash), field.hex(m.chain)]],
  result: [9, (m) => [resultBody(m)]],
  'result-ack': [10, (m) => [field.hex(m.commitId)]],
  hold: [11, (m) => [field.u8(m.held ? 1 : 0), field.u8(m.reason === 'app' ? 2 : 1)]],
  close: [12, (m) => [field.hex(m.operationId), field.u8(REASONS.indexOf(m.reason) + 1), field.u8(m.detail ? DETAILS.indexOf(m.detail) + 1 : 0)]],
  'close-ack': [13, (m) => [field.hex(m.operationId), field.u8(m.finished ? 1 : 0), ...(m.finished ? [resultBody(m.result)] : [])]],
  ping: [14, (m) => [field.id8(m.id)]],
  pong: [15, (m) => [field.id8(m.id)]],
  status: [18, (m) => (m.kind === 'ask'
    ? [field.u8(1), field.id8(m.id)]
    : [field.u8(2), field.id8(m.id), field.u8(m.state), field.u8(m.held ? 1 : 0), field.u64(m.consumed), field.u8(m.result ? 1 : 0), ...(m.result ? [resultBody(m.result)] : [])])],
};

/** A record's bytes, from its fields as the vectors write them. */
export function record(message) {
  const [type, fields] = LAYOUT[message.type];
  return Buffer.concat([field.u8(type), ...fields(message)]);
}

/** Bytes of a pattern: `length` bytes, byte i = (i * step + start) mod 256. */
export const pattern = (length, start = 0, step = 1) => Buffer.from(Array.from({ length }, (_, i) => (i * step + start) & 0xff));
const hexOf = (length, start, step) => pattern(length, start, step).toString('hex');
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

const sampleHello = { major: 4, minor: 0, features: 0, maxRecord: 65535, pauseLimitSeconds: 0, reconnectWindowSeconds: 120 };
const edgeHello = { major: 255, minor: 255, features: 0xffffffff, maxRecord: 16384, pauseLimitSeconds: 0xffffffff, reconnectWindowSeconds: 0xffffffff };
const sampleResult = { commitId: hexOf(16, 0x40), assurance: 'saved', fileCount: 3, totalSize: 2097153, chain: hexOf(32, 0x80) };
const edgeResult = { commitId: hexOf(16, 0xf0), assurance: 'handed-off', fileCount: 0xffffffff, totalSize: MAX_SAFE, chain: hexOf(32, 0xff, 3) };

/** Every record at its edges, as fields: each becomes a vector with its bytes. */
const RECORDS = [
  ['BIND, a 4.0 hello', { type: 'bind', closeSecret: hexOf(32, 1), hello: sampleHello }],
  ['BIND, every hello field at its largest and the smallest record', { type: 'bind', closeSecret: hexOf(32, 0xff, 5), hello: edgeHello }],
  ['MANIFEST, one byte', { type: 'manifest', total: 1, offset: 0, fragment: '01' }],
  ['MANIFEST, a middle fragment', { type: 'manifest', total: 1048576, offset: 65510, fragment: hexOf(100, 7) }],
  ['MANIFEST, the largest fragment at 65,535', { type: 'manifest', total: 1048576, offset: 0, fragment: hexOf(65510, 3, 7) }],
  ['ACCEPT, saved', { type: 'accept', manifestHash: hexOf(32, 2), resumeSecret: hexOf(32, 3), creditLimit: 4194304, sink: 'saved' }],
  ['ACCEPT, handed off, the largest limit', { type: 'accept', manifestHash: hexOf(32, 4), resumeSecret: hexOf(32, 5), creditLimit: MAX_SAFE, sink: 'handed-off' }],
  ['DATA, one byte', { type: 'data', fileIndex: 0, offset: 0, bytes: 'ab' }],
  ['DATA, 65,505 bytes at the largest offset', { type: 'data', fileIndex: 0xffffffff, offset: MAX_SAFE, bytes: hexOf(65505, 9, 11) }],
  ['BLOCK_END, a whole block', { type: 'block-end', fileIndex: 2, blockIndex: 1, length: 1048576, hash: hexOf(32, 6) }],
  ['BLOCK_END, a short last block', { type: 'block-end', fileIndex: 0xffffffff, blockIndex: MAX_SAFE, length: 1, hash: hexOf(32, 7) }],
  ['FILE_END, an empty file', { type: 'file-end', fileIndex: 0, size: 0, blockCount: 0, chain: hexOf(32, 8) }],
  ['FILE_END, the largest', { type: 'file-end', fileIndex: 0xffffffff, size: MAX_SAFE, blockCount: MAX_SAFE, chain: hexOf(32, 9) }],
  ['CREDIT, the first', { type: 'credit', revision: 0, limit: 4194304, consumed: 0, filesDone: 0, verifiedFileIndex: 0, verifiedOffset: 0 }],
  ['CREDIT, every field at its largest', { type: 'credit', revision: MAX_SAFE, limit: MAX_SAFE, consumed: MAX_SAFE, filesDone: 0xffffffff, verifiedFileIndex: 0xffffffff, verifiedOffset: MAX_SAFE }],
  ['FINISH', { type: 'finish', fileCount: 3, totalSize: 2097153, manifestHash: hexOf(32, 10), chain: hexOf(32, 11) }],
  ['FINISH, the largest', { type: 'finish', fileCount: 0xffffffff, totalSize: MAX_SAFE, manifestHash: hexOf(32, 12), chain: hexOf(32, 13) }],
  ['RESULT, saved', { type: 'result', ...sampleResult }],
  ['RESULT, handed off, the largest', { type: 'result', ...edgeResult }],
  ['RESULT_ACK', { type: 'result-ack', commitId: hexOf(16, 14) }],
  ['HOLD, held by the person', { type: 'hold', held: true, reason: 'person' }],
  ['HOLD, let go by the app', { type: 'hold', held: false, reason: 'app' }],
  ...REASONS.map((reason, i) => [`CLOSE, ${reason}`, { type: 'close', operationId: hexOf(16, 0x20 + i), reason }]),
  ...DETAILS.map((detail, i) => [`CLOSE, FAILED with ${detail}`, { type: 'close', operationId: hexOf(16, 0x30 + i), reason: 'FAILED', detail }]),
  ['CLOSE_ACK, not finished', { type: 'close-ack', operationId: hexOf(16, 15), finished: false }],
  ['CLOSE_ACK, finished, with the result', { type: 'close-ack', operationId: hexOf(16, 16), finished: true, result: sampleResult }],
  ['PING, id 0', { type: 'ping', id: '0000000000000000' }],
  ['PONG, id 2^64 - 1', { type: 'pong', id: 'ffffffffffffffff' }],
  ['STATUS, an ask', { type: 'status', kind: 'ask', id: '0102030405060708' }],
  ['STATUS, an answer without a result', { type: 'status', kind: 'answer', id: 'ffffffffffffffff', state: 255, held: true, consumed: MAX_SAFE }],
  ['STATUS, an answer with the result', { type: 'status', kind: 'answer', id: '0000000000000001', state: 0, held: false, consumed: 0, result: edgeResult }],
];

/** Records read as something else than they say: what a receiver makes of them. */
const LENIENT = [
  ['CLOSE, a reason this version does not know, read as FAILED with no detail', Buffer.concat([field.u8(12), pattern(16, 0x50), field.u8(7), field.u8(4)]), { type: 'close', operationId: hexOf(16, 0x50), reason: 'FAILED' }],
  ['CLOSE, reason 0, read as FAILED', Buffer.concat([field.u8(12), pattern(16, 0x51), field.u8(0), field.u8(0)]), { type: 'close', operationId: hexOf(16, 0x51), reason: 'FAILED' }],
  ['CLOSE, FAILED with a detail this version does not know, read as none', Buffer.concat([field.u8(12), pattern(16, 0x52), field.u8(6), field.u8(9)]), { type: 'close', operationId: hexOf(16, 0x52), reason: 'FAILED' }],
  ['CLOSE, a detail with a reason other than FAILED, ignored', Buffer.concat([field.u8(12), pattern(16, 0x53), field.u8(1), field.u8(4)]), { type: 'close', operationId: hexOf(16, 0x53), reason: 'USER_CANCELLED' }],
  ['HOLD, a reason this version does not know, read as the person', Buffer.concat([field.u8(11), field.u8(1), field.u8(7)]), { type: 'hold', held: true, reason: 'person' }],
  ['BIND, feature bits this version does not know, kept', record({ type: 'bind', closeSecret: hexOf(32, 1), hello: { ...sampleHello, features: 0x80000001 } }), { type: 'bind', closeSecret: hexOf(32, 1), hello: { ...sampleHello, features: 0x80000001 } }],
];

/** Records that aren't: each must be refused as INVALID_MESSAGE. */
function refusedRecords() {
  const out = [];
  const add = (name, bytes) => out.push({ name, record: Buffer.from(bytes).toString('hex') });
  // Every record one byte short and one byte long. A variable one's shortest is one byte under its fixed part.
  for (const [name, message] of RECORDS) {
    const bytes = record(message);
    const variable = message.type === 'manifest' || message.type === 'data';
    if (!variable) add(`${name}: one byte long`, Buffer.concat([bytes, Buffer.from([0])]));
    if (!variable || bytes.length === (message.type === 'manifest' ? 10 : 15)) add(`${name}: one byte short`, bytes.subarray(0, bytes.length - 1));
  }
  add('nothing at all', Buffer.alloc(0));
  for (const type of [0, 16, 17, 19, 0x7f, 0xff]) add(`type ${type}`, Buffer.concat([field.u8(type), Buffer.alloc(16)]));
  add('RESUME, as long as RESUME_OK would be', Buffer.concat([field.u8(16), Buffer.alloc(40)]));
  add('a hello naming a record of 16,383 bytes', record({ type: 'bind', closeSecret: hexOf(32, 1), hello: { ...sampleHello, maxRecord: 16383 } }));
  add('a hello naming a record of 65,536 bytes', record({ type: 'bind', closeSecret: hexOf(32, 1), hello: { ...sampleHello, maxRecord: 65536 } }));
  add('MANIFEST with a total of 0', Buffer.concat([field.u8(2), field.u32(0), field.u32(0), Buffer.from([1])]));
  add('MANIFEST with a total over 1 MiB', Buffer.concat([field.u8(2), field.u32(1048577), field.u32(0), Buffer.from([1])]));
  add('MANIFEST running past its total', Buffer.concat([field.u8(2), field.u32(10), field.u32(9), Buffer.from([1, 2])]));
  add('ACCEPT with sink 0', Buffer.concat([record(RECORDS.find(([n]) => n === 'ACCEPT, saved')[1]).subarray(0, 73), field.u8(0)]));
  add('ACCEPT with sink 3', Buffer.concat([record(RECORDS.find(([n]) => n === 'ACCEPT, saved')[1]).subarray(0, 73), field.u8(3)]));
  add('ACCEPT with a credit limit of 2^53', Buffer.concat([field.u8(3), Buffer.alloc(64), field.u64(2n ** 53n), field.u8(1)]));
  add('DATA with a flag set', Buffer.concat([field.u8(4), field.u8(1), field.u32(0), field.u64(0), Buffer.from([1])]));
  add('DATA at an offset of 2^53', Buffer.concat([field.u8(4), field.u8(0), field.u32(0), field.u64(2n ** 53n), Buffer.from([1])]));
  add('BLOCK_END longer than a block', Buffer.concat([field.u8(5), field.u32(0), field.u64(0), field.u32(1048577), Buffer.alloc(32)]));
  add('CREDIT with a revision of 2^64 - 1', Buffer.concat([field.u8(7), field.u64(2n ** 64n - 1n), Buffer.alloc(32)]));
  add('RESULT with assurance 0', Buffer.concat([field.u8(9), Buffer.alloc(16), field.u8(0), Buffer.alloc(44)]));
  add('RESULT with assurance 3', Buffer.concat([field.u8(9), Buffer.alloc(16), field.u8(3), Buffer.alloc(44)]));
  add('HOLD with held 2', Buffer.concat([field.u8(11), field.u8(2), field.u8(1)]));
  add('CLOSE_ACK of 18 bytes saying it finished', Buffer.concat([field.u8(13), Buffer.alloc(16), field.u8(1)]));
  add('CLOSE_ACK of 79 bytes saying it did not', Buffer.concat([field.u8(13), Buffer.alloc(16), field.u8(0), resultBody(sampleResult)]));
  add('CLOSE_ACK with finished 2', Buffer.concat([field.u8(13), Buffer.alloc(16), field.u8(2), resultBody(sampleResult)]));
  add('STATUS of kind 0', Buffer.concat([field.u8(18), field.u8(0), Buffer.alloc(8)]));
  add('STATUS of kind 3', Buffer.concat([field.u8(18), field.u8(3), Buffer.alloc(8)]));
  add('STATUS, an ask as long as an answer', Buffer.concat([field.u8(18), field.u8(1), Buffer.alloc(19)]));
  add('STATUS, an answer as long as an ask', Buffer.concat([field.u8(18), field.u8(2), Buffer.alloc(8)]));
  add('STATUS, an answer of 21 bytes saying it has a result', Buffer.concat([field.u8(18), field.u8(2), Buffer.alloc(8), field.u8(0), field.u8(0), field.u64(0), field.u8(1)]));
  add('STATUS, an answer of 82 bytes saying it has none', Buffer.concat([field.u8(18), field.u8(2), Buffer.alloc(8), field.u8(0), field.u8(0), field.u64(0), field.u8(0), resultBody(sampleResult)]));
  add('STATUS, an answer with held 2', Buffer.concat([field.u8(18), field.u8(2), Buffer.alloc(8), field.u8(0), field.u8(2), field.u64(0), field.u8(0)]));
  add('STATUS, an answer of 82 bytes with has-result 2', Buffer.concat([field.u8(18), field.u8(2), Buffer.alloc(8), field.u8(0), field.u8(0), field.u64(0), field.u8(2), resultBody(sampleResult)]));
  return out;
}

// ---------------------------------------------------------------------------
// The manifest.

/** The manifest's bytes for `files` ({ name, size, type }). */
export function manifest(files) {
  const total = files.reduce((n, f) => n + BigInt(f.size), 0n);
  return Buffer.concat([
    field.u8(1), field.u32(1048576), field.u32(files.length), field.u64(total),
    ...files.flatMap((f) => {
      const name = Buffer.from(f.name, 'utf8');
      const type = Buffer.from(f.type, 'ascii');
      return [field.u64(f.size), field.u16(name.length), name, field.u8(type.length), type];
    }),
  ]);
}

export const manifestHash = (bytes) => sha256(Buffer.from('dropgate/4 dgdtp manifest', 'ascii'), bytes);

/**
 * The files of a manifest of exactly 1 MiB: 2,668 files whose names are 255
 * bytes and media types 127, then one whose name is 24, with nothing else:
 * 17 + 2,668 × 393 + 35 = 1,048,576.
 */
export function largestManifestFiles() {
  const files = [];
  for (let i = 0; i < 2668; i++) {
    const start = `file-${String(i).padStart(5, '0')}-`;
    files.push({ name: start + 'n'.repeat(255 - start.length), size: i * 1000, type: `application/x-${'t'.repeat(127 - 14)}` });
  }
  files.push({ name: 'the-last-file-of-24-b.ex', size: 7, type: '' });
  return files;
}

const MANIFESTS = [
  ['one file', [{ name: 'photo.jpg', size: 1234567, type: 'image/jpeg' }]],
  ['several, with empty ones, a name in several scripts and no media type', [
    { name: 'empty.txt', size: 0, type: 'text/plain' },
    { name: 'Résumé – 履歴書 📄.pdf', size: 1048576, type: 'application/pdf' },
    { name: 'also empty', size: 0, type: '' },
    { name: 'a'.repeat(255), size: 9007199254740991 - 1048576, type: 'x'.repeat(127) },
  ]],
];

// ---------------------------------------------------------------------------
// The chain.

/** File `f`'s content: byte k = (k * 7 + f * 13 + 1) mod 256. */
export const fileContent = (f, size) => pattern(size, f * 13 + 1, 7);

/** The chain over files of these sizes, each step written down. */
export function chain(sizes) {
  const files = sizes.map((size, f) => ({ name: `file-${f}.bin`, size, type: 'application/octet-stream' }));
  const bytes = manifest(files);
  const hash = manifestHash(bytes);
  let c = sha256(Buffer.from('dropgate/4 dgdtp checkpoint', 'ascii'), hash);
  const steps = [{ step: 'start', chain: c.toString('hex') }];
  sizes.forEach((size, f) => {
    const content = fileContent(f, size);
    const blocks = Math.ceil(size / 1048576);
    for (let b = 0; b < blocks; b++) {
      const block = content.subarray(b * 1048576, Math.min(size, (b + 1) * 1048576));
      const blockHash = sha256(block);
      c = sha256(c, field.u8(1), field.u32(f), field.u64(b), field.u32(block.length), blockHash);
      steps.push({ step: 'block', fileIndex: f, blockIndex: b, length: block.length, hash: blockHash.toString('hex'), chain: c.toString('hex') });
    }
    c = sha256(c, field.u8(2), field.u32(f), field.u64(size), field.u64(blocks));
    steps.push({ step: 'file-end', fileIndex: f, size, blockCount: blocks, chain: c.toString('hex') });
  });
  return { files, manifest: bytes.toString('hex'), manifestHash: hash.toString('hex'), steps };
}

// ---------------------------------------------------------------------------
// The rendezvous.

const R = { CREATE: 0x01, CODE: 0x02, RENEW: 0x03, SEND: 0x04, DROP: 0x05, LOCK: 0x06, CREATED: 0x81, CODE_IS: 0x82, ATTEMPT: 0x83, FRAME_TO_SENDER: 0x84, GONE_TO_SENDER: 0x85, CODE_GONE: 0x86, JOIN: 0x11, RECEIVER_SEND: 0x12, JOINED: 0x91, FRAME_TO_RECEIVER: 0x92, GONE_TO_RECEIVER: 0x93, ERROR: 0xff };

const create = ({ major = 4, minor = 0, roomId, roomNonce, code, credential = '' }) => Buffer.concat([
  field.u8(R.CREATE), field.u8(major), field.u8(minor), field.hex(roomId), field.hex(roomNonce), field.u8(code ? 1 : 0),
  field.u16(credential.length), Buffer.from(credential, 'ascii'),
]);
const join = ({ major = 4, minor = 0, roomId, locator }) => Buffer.concat(roomId
  ? [field.u8(R.JOIN), field.u8(major), field.u8(minor), field.u8(1), field.hex(roomId)]
  : [field.u8(R.JOIN), field.u8(major), field.u8(minor), field.u8(2), field.u8(locator.length), Buffer.from(locator, 'ascii')]);
const withLocator = (type, locator) => Buffer.concat([field.u8(type), field.u8(locator ? locator.length : 0), Buffer.from(locator ?? '', 'ascii')]);

/** What a client sends: each with the fields it's made from. */
const CLIENT_MESSAGES = [
  ['CREATE, no code wanted', 'create', { roomId: hexOf(16, 0x61), roomNonce: hexOf(16, 0x71), code: false }],
  ['CREATE, a code wanted', 'create', { roomId: hexOf(16, 0x62), roomNonce: hexOf(16, 0x72), code: true }],
  ['CREATE, with a credential', 'create', { roomId: hexOf(16, 0x63), roomNonce: hexOf(16, 0x73), code: true, credential: 'abc-._~+/XYZ019==' }],
  ['CREATE, the longest credential', 'create', { roomId: hexOf(16, 0x64), roomNonce: hexOf(16, 0x74), code: false, credential: 'Z'.repeat(8192) }],
  ['CREATE, minor 255', 'create', { minor: 255, roomId: hexOf(16, 0x65), roomNonce: hexOf(16, 0x75), code: false }],
  ['JOIN by room ID', 'join', { roomId: hexOf(16, 0x66) }],
  ['JOIN by a 2-letter locator', 'join', { locator: 'AZ' }],
  ['JOIN by a 3-letter locator', 'join', { locator: 'HJN' }],
  ['CODE', 'code', {}],
  ['RENEW', 'renew', {}],
  ['LOCK', 'lock', {}],
  ['the sender\'s SEND, tag 1, an empty frame', 'send', { tag: 1, frame: '' }],
  ['the sender\'s SEND, tag 255, the largest frame', 'send', { tag: 255, frame: hexOf(8230, 0x10, 3) }],
  ['DROP, tag 17', 'drop', { tag: 17 }],
  ['a receiver\'s SEND, an empty frame', 'receiverSend', { frame: '' }],
  ['a receiver\'s SEND, the largest frame', 'receiverSend', { frame: hexOf(8230, 0x20, 5) }],
];

function clientMessage(kind, f) {
  switch (kind) {
    case 'create': return create(f);
    case 'join': return join(f);
    case 'code': return field.u8(R.CODE);
    case 'renew': return field.u8(R.RENEW);
    case 'lock': return field.u8(R.LOCK);
    case 'send': return Buffer.concat([field.u8(R.SEND), field.u8(f.tag), field.hex(f.frame)]);
    case 'drop': return Buffer.concat([field.u8(R.DROP), field.u8(f.tag)]);
    case 'receiverSend': return Buffer.concat([field.u8(R.RECEIVER_SEND), field.hex(f.frame)]);
    default: throw new Error(kind);
  }
}

/** What the server sends, to which socket, and what it says. */
const SERVER_MESSAGES = [
  ['CREATED, no code', 'sender', withLocator(R.CREATED, null), { type: 'created', locator: null }],
  ['CREATED, a 2-letter code', 'sender', withLocator(R.CREATED, 'QR'), { type: 'created', locator: 'QR' }],
  ['CREATED, a 3-letter code', 'sender', withLocator(R.CREATED, 'ZYX'), { type: 'created', locator: 'ZYX' }],
  ['CODE_IS, none free', 'sender', withLocator(R.CODE_IS, null), { type: 'code-is', locator: null }],
  ['CODE_IS, a code', 'sender', withLocator(R.CODE_IS, 'BC'), { type: 'code-is', locator: 'BC' }],
  ['ATTEMPT by link, tag 1', 'sender', Buffer.from([R.ATTEMPT, 1, 1]), { type: 'attempt', tag: 1, by: 'link' }],
  ['ATTEMPT by code, tag 255', 'sender', Buffer.from([R.ATTEMPT, 255, 2]), { type: 'attempt', tag: 255, by: 'code' }],
  ['FRAME to the sender, empty', 'sender', Buffer.from([R.FRAME_TO_SENDER, 9]), { type: 'frame', tag: 9, frame: '' }],
  ['FRAME to the sender, the largest', 'sender', Buffer.concat([Buffer.from([R.FRAME_TO_SENDER, 200]), pattern(8230, 0x30, 7)]), { type: 'frame', tag: 200, frame: hexOf(8230, 0x30, 7) }],
  ['GONE to the sender', 'sender', Buffer.from([R.GONE_TO_SENDER, 42]), { type: 'gone', tag: 42 }],
  ['CODE_GONE', 'sender', Buffer.from([R.CODE_GONE]), { type: 'code-gone' }],
  ['JOINED', 'receiver', Buffer.concat([Buffer.from([R.JOINED]), pattern(16, 0x91)]), { type: 'joined', roomNonce: hexOf(16, 0x91) }],
  ['FRAME to a receiver, empty', 'receiver', Buffer.from([R.FRAME_TO_RECEIVER]), { type: 'frame', frame: '' }],
  ['FRAME to a receiver, the largest', 'receiver', Buffer.concat([Buffer.from([R.FRAME_TO_RECEIVER]), pattern(8230, 0x40, 9)]), { type: 'frame', frame: hexOf(8230, 0x40, 9) }],
  ['GONE to a receiver', 'receiver', Buffer.from([R.GONE_TO_RECEIVER]), { type: 'gone' }],
  ['ERROR VERSION_UNSUPPORTED, from a server of 5.2', 'sender', Buffer.from([R.ERROR, 1, 5, 2]), { type: 'error', code: 1, server: { major: 5, minor: 2 } }],
  ...[2, 3, 4, 5, 6, 7, 8].map((code) => [`ERROR ${code}`, 'receiver', Buffer.from([R.ERROR, code]), { type: 'error', code }]),
];

/** What a server's socket must not be sent: each refused as INVALID_RESPONSE. */
function refusedServerMessages() {
  const out = [];
  const add = (name, to, bytes) => out.push({ name, to, message: Buffer.from(bytes).toString('hex') });
  for (const [name, to, bytes, said] of SERVER_MESSAGES) {
    const variable = said.type === 'frame';
    if (!variable) add(`${name}: one byte long`, to, Buffer.concat([bytes, Buffer.from([0x41])]));
    if (bytes.length > 1 && !(variable && bytes.length > (to === 'sender' ? 2 : 1))) add(`${name}: one byte short`, to, bytes.subarray(0, bytes.length - 1));
  }
  add('nothing at all', 'sender', Buffer.alloc(0));
  add('a receiver\'s JOINED, to a sender', 'sender', Buffer.concat([Buffer.from([R.JOINED]), pattern(16)]));
  add('a sender\'s CREATED, to a receiver', 'receiver', withLocator(R.CREATED, 'QR'));
  add('a type no server sends', 'sender', Buffer.from([0x01]));
  add('a locator of one letter', 'sender', withLocator(R.CREATED, 'Q'));
  add('a locator of four letters', 'sender', withLocator(R.CODE_IS, 'QRST'));
  add('a locator with an I', 'sender', withLocator(R.CREATED, 'IA'));
  add('a locator in lower case', 'sender', withLocator(R.CREATED, 'qr'));
  add('ATTEMPT with tag 0', 'sender', Buffer.from([R.ATTEMPT, 0, 1]));
  add('ATTEMPT by 3', 'sender', Buffer.from([R.ATTEMPT, 1, 3]));
  add('ATTEMPT by 0', 'sender', Buffer.from([R.ATTEMPT, 1, 0]));
  add('a FRAME to the sender over 8,230 bytes', 'sender', Buffer.concat([Buffer.from([R.FRAME_TO_SENDER, 1]), Buffer.alloc(8231)]));
  add('a FRAME to the sender with tag 0', 'sender', Buffer.from([R.FRAME_TO_SENDER, 0, 1]));
  add('GONE to the sender with tag 0', 'sender', Buffer.from([R.GONE_TO_SENDER, 0]));
  add('a FRAME to a receiver over 8,230 bytes', 'receiver', Buffer.concat([Buffer.from([R.FRAME_TO_RECEIVER]), Buffer.alloc(8231)]));
  add('ERROR with no code', 'receiver', Buffer.from([R.ERROR]));
  return out;
}

/** The pinned vectors, as tests/fixtures/dgdtp-message-vectors.json holds them. */
export function vectors() {
  const largest = largestManifestFiles();
  const largestBytes = manifest(largest);
  if (largestBytes.length !== 1048576) throw new Error(`The largest manifest is ${largestBytes.length} bytes.`);
  return {
    about: "DGDTP 4's records, manifest, checkpoint chain and rendezvous messages, made by tests/helpers/reference-messages.mjs, a "
      + 'second implementation on node:crypto written from the format (its header comment), not from core. records: each record '
      + 'from its fields (bytes as hex, 8-byte ids as 16 hex digits). lenient: records read as something other than they say. '
      + 'refused: records that must be refused as INVALID_MESSAGE. manifests: from their files, with the hash; the largest (exactly '
      + '1 MiB) by its SHA-256 alone, from largestManifestFiles(). chain: every checkpoint over files of 0, 1, 1 MiB - 1, 1 MiB and '
      + '1 MiB + 1 bytes, file f byte k being (k * 7 + f * 13 + 1) mod 256. rendezvous: what a client sends from its fields, and '
      + 'what the server sends, to which socket, and what it says; refused: server messages that must be refused as INVALID_RESPONSE.',
    records: RECORDS.map(([name, fields]) => ({ name, fields, record: record(fields).toString('hex') })),
    lenient: LENIENT.map(([name, bytes, reads]) => ({ name, record: bytes.toString('hex'), reads })),
    refused: refusedRecords(),
    manifests: MANIFESTS.map(([name, files]) => {
      const bytes = manifest(files);
      return { name, files, manifest: bytes.toString('hex'), hash: manifestHash(bytes).toString('hex') };
    }),
    largestManifest: {
      length: largestBytes.length, sha256: sha256(largestBytes).toString('hex'), hash: manifestHash(largestBytes).toString('hex'),
      fileCount: largest.length,
    },
    chain: chain([0, 1, 1048575, 1048576, 1048577]),
    rendezvous: {
      client: CLIENT_MESSAGES.map(([name, kind, fields]) => ({ name, kind, fields, message: clientMessage(kind, fields).toString('hex') })),
      server: SERVER_MESSAGES.map(([name, to, bytes, says]) => ({ name, to, message: bytes.toString('hex'), says })),
      refused: refusedServerMessages(),
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = new URL('../fixtures/dgdtp-message-vectors.json', import.meta.url);
  writeFileSync(out, `${JSON.stringify(vectors(), null, 2)}\n`);
  console.log(`Wrote ${fileURLToPath(out)}`);
}
