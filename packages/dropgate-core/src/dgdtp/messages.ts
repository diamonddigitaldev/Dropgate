import type { CryptoProvider } from '../crypto/index.js';
import { DropgateError } from '../errors.js';
import { validateFilename } from '../utils/filename.js';
import { MIN_RECORD_BYTES } from './channel.js';
import { CLOSE_SECRET_BYTES, RESUME_SECRET_BYTES } from './keys.js';
import { NOISE_MAX_MESSAGE_BYTES, NOISE_TAG_BYTES } from './noise.js';

// A direct transfer's records: what the two devices say to each other over
// the secure channel once it's up, each record one Noise message. A record's
// plaintext is a type byte, then that type's fields, big-endian, at exact
// lengths: a record whose type is unknown (or not yet used), or whose length
// isn't its type's, is INVALID_MESSAGE, and so is a field outside what its
// type allows. Nothing a record holds is ever shown as the other device's
// words: errors name the fault, never the bytes.
//
// Also here: the manifest, the list of files a sender offers, its hash, and
// how it's cut into MANIFEST records and put back together; and the checkpoint
// chain, a running SHA-256 over every block of every file and every file's
// end, which both devices keep and compare at the end.

/** Each record's type byte. 16 and 17 (a resume's) are kept for a later version and refused today. */
export const MESSAGE_TYPE = Object.freeze({
  BIND: 1,
  MANIFEST: 2,
  ACCEPT: 3,
  DATA: 4,
  BLOCK_END: 5,
  FILE_END: 6,
  CREDIT: 7,
  FINISH: 8,
  RESULT: 9,
  RESULT_ACK: 10,
  HOLD: 11,
  CLOSE: 12,
  CLOSE_ACK: 13,
  PING: 14,
  PONG: 15,
  RESUME: 16,
  RESUME_OK: 17,
  STATUS: 18,
});

/** A hello: the sender's in Noise's second message, the receiver's in BIND. */
export const HELLO_BYTES = 18;
/** BIND: its type, the close secret, the receiver's hello. */
export const BIND_BYTES = 1 + CLOSE_SECRET_BYTES + HELLO_BYTES;
/** A MANIFEST record before its fragment: type, total, offset. */
export const MANIFEST_HEADER_BYTES = 9;
/** A DATA record before its bytes: type, flags, file index, offset. */
export const DATA_HEADER_BYTES = 14;

/** The manifest's version. */
export const MANIFEST_VERSION = 1;
/** An integrity block: 1 MiB of a file, the last one shorter. */
export const BLOCK_BYTES = 1048576;
/** The most files one transfer offers. */
export const MAX_MANIFEST_FILES = 10000;
/** The largest manifest. */
export const MAX_MANIFEST_BYTES = 1048576;
/** The longest media type, in ASCII bytes. */
export const MAX_MEDIA_TYPE_BYTES = 127;
/** The manifest's fixed start: version, block size, file count, total size. */
const MANIFEST_START_BYTES = 1 + 4 + 4 + 8;

const SHA256_BYTES = 32;
const ID_BYTES = 16;
/** RESULT's body (after its type), which CLOSE_ACK and STATUS carry too. */
const RESULT_BODY_BYTES = ID_BYTES + 1 + 4 + 8 + SHA256_BYTES;

const MANIFEST_LABEL = 'dropgate/4 dgdtp manifest';
const CHECKPOINT_LABEL = 'dropgate/4 dgdtp checkpoint';
const CHAIN_BLOCK = 0x01;
const CHAIN_FILE_END = 0x02;

const MAX_U32 = 0xffffffff;
const MAX_U64 = (1n << 64n) - 1n;

/** Why a CLOSE ends a transfer. An unknown reason is read as FAILED. */
export type CloseReason = 'USER_CANCELLED' | 'USER_DECLINED' | 'APP_CLOSED' | 'PAUSE_LIMIT' | 'RECOVERY_EXHAUSTED' | 'FAILED';
/** What failed, with FAILED. An unknown detail is read as none. */
export type CloseDetail =
  | 'OUTPUT_WRITE_FAILED' | 'OUTPUT_STALLED' | 'SOURCE_UNAVAILABLE' | 'INTEGRITY_FAILED' | 'INVALID_MANIFEST' | 'INVALID_MESSAGE'
  | 'TIMED_OUT' | 'CAPABILITY_UNSUPPORTED';

const CLOSE_REASONS: readonly CloseReason[] = ['USER_CANCELLED', 'USER_DECLINED', 'APP_CLOSED', 'PAUSE_LIMIT', 'RECOVERY_EXHAUSTED', 'FAILED'];
const CLOSE_DETAILS: readonly CloseDetail[] = [
  'OUTPUT_WRITE_FAILED', 'OUTPUT_STALLED', 'SOURCE_UNAVAILABLE', 'INTEGRITY_FAILED', 'INVALID_MANIFEST', 'INVALID_MESSAGE',
  'TIMED_OUT', 'CAPABILITY_UNSUPPORTED',
];

/** Where received files went: saved by the receiver's app, or handed to a browser to save. */
export type Assurance = 'saved' | 'handed-off';
const ASSURANCES: readonly Assurance[] = ['saved', 'handed-off'];

/** Who held the transfer: the person, or the app itself. An unknown reason is read as the person. */
export type HoldReason = 'person' | 'app';

export interface Hello {
  major: number;
  minor: number;
  /** Feature bits: none in 4.0; bits this version doesn't know are kept and ignored. */
  features: number;
  /** The largest record this side takes, with Noise's tag: 16,384 to 65,535. */
  maxRecord: number;
  /** This side's pause limit in seconds, 0 for none. */
  pauseLimitSeconds: number;
  /** This side's reconnect window in seconds. */
  reconnectWindowSeconds: number;
}

/** RESULT's body: what the receiver saved, as CLOSE_ACK and STATUS repeat it. */
export interface ResultBody {
  commitId: Uint8Array;
  assurance: Assurance;
  fileCount: number;
  totalSize: number;
  chain: Uint8Array;
}

export type Message =
  | { type: 'bind'; closeSecret: Uint8Array; hello: Hello }
  | { type: 'manifest'; total: number; offset: number; fragment: Uint8Array }
  | { type: 'accept'; manifestHash: Uint8Array; resumeSecret: Uint8Array; creditLimit: number; sink: Assurance }
  | { type: 'data'; fileIndex: number; offset: number; bytes: Uint8Array }
  | { type: 'block-end'; fileIndex: number; blockIndex: number; length: number; hash: Uint8Array }
  | { type: 'file-end'; fileIndex: number; size: number; blockCount: number; chain: Uint8Array }
  | {
    type: 'credit'; revision: number; limit: number; consumed: number; filesDone: number; verifiedFileIndex: number; verifiedOffset: number;
  }
  | { type: 'finish'; fileCount: number; totalSize: number; manifestHash: Uint8Array; chain: Uint8Array }
  | ({ type: 'result' } & ResultBody)
  | { type: 'result-ack'; commitId: Uint8Array }
  | { type: 'hold'; held: boolean; reason: HoldReason }
  | { type: 'close'; operationId: Uint8Array; reason: CloseReason; detail?: CloseDetail }
  | { type: 'close-ack'; operationId: Uint8Array; finished: false }
  | { type: 'close-ack'; operationId: Uint8Array; finished: true; result: ResultBody }
  | { type: 'ping' | 'pong'; id: bigint }
  | { type: 'status'; kind: 'ask'; id: bigint }
  | { type: 'status'; kind: 'answer'; id: bigint; state: number; held: boolean; consumed: number; result?: ResultBody };

export type MessageName = Message['type'];

/** What the other device sent wasn't a record of this version. */
const invalidMessage = () => new DropgateError({ code: 'INVALID_MESSAGE' });
const invalidManifest = () => new DropgateError({ code: 'INVALID_MANIFEST' });
const invalidArgument = (message: string) => new DropgateError({ code: 'INVALID_ARGUMENT', message });

const encoder = new TextEncoder();
const strictDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Writes fields big-endian into a record of a known length. */
class Writer {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly #view: DataView;
  #at = 0;

  constructor(length: number) {
    this.bytes = new Uint8Array(length);
    this.#view = new DataView(this.bytes.buffer);
  }

  u8(value: number): this { this.#view.setUint8(this.#at, value); this.#at += 1; return this; }
  u16(value: number): this { this.#view.setUint16(this.#at, value); this.#at += 2; return this; }
  u32(value: number): this { this.#view.setUint32(this.#at, value); this.#at += 4; return this; }
  u64(value: number | bigint): this { this.#view.setBigUint64(this.#at, BigInt(value)); this.#at += 8; return this; }
  raw(bytes: Uint8Array): this { this.bytes.set(bytes, this.#at); this.#at += bytes.byteLength; return this; }

  /** The record, checked to be exactly the length it was made for. */
  done(): Uint8Array<ArrayBuffer> {
    if (this.#at !== this.bytes.byteLength) throw new DropgateError({ code: 'UNEXPECTED_ERROR', message: 'A record was written short.' });
    return this.bytes;
  }
}

/** Reads fields big-endian; past the end, `fail()`. */
class Reader {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;
  readonly #fail: () => DropgateError;
  #at: number;

  constructor(bytes: Uint8Array, at: number, fail: () => DropgateError) {
    this.#bytes = bytes;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.#fail = fail;
    this.#at = at;
  }

  #need(n: number): number {
    if (this.#at + n > this.#bytes.byteLength) throw this.#fail();
    const at = this.#at;
    this.#at += n;
    return at;
  }

  get left(): number { return this.#bytes.byteLength - this.#at; }
  u8(): number { return this.#view.getUint8(this.#need(1)); }
  u16(): number { return this.#view.getUint16(this.#need(2)); }
  u32(): number { return this.#view.getUint32(this.#need(4)); }
  u64(): bigint { return this.#view.getBigUint64(this.#need(8)); }
  /** A 64-bit size or count, which must be at most 2^53 − 1. */
  size(): number {
    const value = this.u64();
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw this.#fail();
    return Number(value);
  }
  raw(n: number): Uint8Array<ArrayBuffer> {
    const at = this.#need(n);
    return this.#bytes.slice(at, at + n);
  }
  rest(): Uint8Array<ArrayBuffer> { return this.raw(this.left); }
}

const isBytes = (value: unknown, length: number): value is Uint8Array => value instanceof Uint8Array && value.byteLength === length;

function checkUint(value: unknown, max: number, what: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) throw invalidArgument(`${what} is a whole number from 0 to ${max}.`);
}
const checkU8 = (value: unknown, what: string) => checkUint(value, 0xff, what);
const checkU32 = (value: unknown, what: string) => checkUint(value, MAX_U32, what);
const checkSize = (value: unknown, what: string) => checkUint(value, Number.MAX_SAFE_INTEGER, what);
function checkId(value: unknown, what: string): asserts value is bigint {
  if (typeof value !== 'bigint' || value < 0n || value > MAX_U64) throw invalidArgument(`${what} is 0 to 2^64 - 1.`);
}
function checkFixed(value: unknown, length: number, what: string): asserts value is Uint8Array {
  if (!isBytes(value, length)) throw invalidArgument(`${what} is ${length} bytes.`);
}

function checkHello(hello: Hello): void {
  if (!hello || typeof hello !== 'object') throw invalidArgument('A hello is required.');
  checkU8(hello.major, "A hello's major");
  checkU8(hello.minor, "A hello's minor");
  checkU32(hello.features, "A hello's features");
  checkUint(hello.maxRecord, NOISE_MAX_MESSAGE_BYTES, "A hello's largest record");
  if (hello.maxRecord < MIN_RECORD_BYTES) throw invalidArgument(`A hello's largest record is at least ${MIN_RECORD_BYTES}.`);
  checkU32(hello.pauseLimitSeconds, "A hello's pause limit");
  checkU32(hello.reconnectWindowSeconds, "A hello's reconnect window");
}

const writeHello = (w: Writer, hello: Hello) => w
  .u8(hello.major).u8(hello.minor).u32(hello.features).u32(hello.maxRecord).u32(hello.pauseLimitSeconds).u32(hello.reconnectWindowSeconds);

function readHello(r: Reader): Hello {
  const hello = { major: r.u8(), minor: r.u8(), features: r.u32(), maxRecord: r.u32(), pauseLimitSeconds: r.u32(), reconnectWindowSeconds: r.u32() };
  if (hello.maxRecord < MIN_RECORD_BYTES || hello.maxRecord > NOISE_MAX_MESSAGE_BYTES) throw invalidMessage();
  return hello;
}

/** The sender's hello, alone: Noise's second message's payload. */
export function encodeHello(hello: Hello): Uint8Array<ArrayBuffer> {
  checkHello(hello);
  return writeHello(new Writer(HELLO_BYTES), hello).done();
}

/** The sender's hello, as the receiver reads it: exactly 18 bytes, else INVALID_MESSAGE. */
export function decodeHello(bytes: Uint8Array): Hello {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== HELLO_BYTES) throw invalidMessage();
  return readHello(new Reader(bytes, 0, invalidMessage));
}

function checkResult(result: ResultBody): void {
  if (!result || typeof result !== 'object') throw invalidArgument('A result is required.');
  checkFixed(result.commitId, ID_BYTES, "A result's commit ID");
  if (!ASSURANCES.includes(result.assurance)) throw invalidArgument("A result's assurance is saved or handed-off.");
  checkU32(result.fileCount, "A result's file count");
  checkSize(result.totalSize, "A result's total size");
  checkFixed(result.chain, SHA256_BYTES, "A result's chain");
}

const writeResult = (w: Writer, result: ResultBody) => w
  .raw(result.commitId).u8(ASSURANCES.indexOf(result.assurance) + 1).u32(result.fileCount).u64(result.totalSize).raw(result.chain);

function readResult(r: Reader): ResultBody {
  const commitId = r.raw(ID_BYTES);
  const assurance = ASSURANCES[r.u8() - 1];
  if (!assurance) throw invalidMessage();
  return { commitId, assurance, fileCount: r.u32(), totalSize: r.size(), chain: r.raw(SHA256_BYTES) };
}

function checkFlag(value: unknown, what: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw invalidArgument(`${what} is true or false.`);
}

/** A record's plaintext. INVALID_ARGUMENT for a field outside what its type allows. */
export function encodeMessage(message: Message): Uint8Array<ArrayBuffer> {
  const m = message as Message;
  switch (m?.type) {
    case 'bind':
      checkFixed(m.closeSecret, CLOSE_SECRET_BYTES, "BIND's close secret");
      checkHello(m.hello);
      return writeHello(new Writer(BIND_BYTES).u8(MESSAGE_TYPE.BIND).raw(m.closeSecret), m.hello).done();
    case 'manifest': {
      checkUint(m.total, MAX_MANIFEST_BYTES, "A manifest's total");
      checkUint(m.offset, MAX_MANIFEST_BYTES, "A manifest fragment's offset");
      if (!(m.fragment instanceof Uint8Array) || m.fragment.byteLength < 1 || m.offset + m.fragment.byteLength > m.total) {
        throw invalidArgument("A manifest fragment is 1 byte or more, within the manifest's total.");
      }
      return new Writer(MANIFEST_HEADER_BYTES + m.fragment.byteLength).u8(MESSAGE_TYPE.MANIFEST).u32(m.total).u32(m.offset).raw(m.fragment).done();
    }
    case 'accept':
      checkFixed(m.manifestHash, SHA256_BYTES, "ACCEPT's manifest hash");
      checkFixed(m.resumeSecret, RESUME_SECRET_BYTES, "ACCEPT's resume secret");
      checkSize(m.creditLimit, "ACCEPT's credit limit");
      if (!ASSURANCES.includes(m.sink)) throw invalidArgument("ACCEPT's sink is saved or handed-off.");
      return new Writer(74).u8(MESSAGE_TYPE.ACCEPT).raw(m.manifestHash).raw(m.resumeSecret).u64(m.creditLimit).u8(ASSURANCES.indexOf(m.sink) + 1).done();
    case 'data':
      checkU32(m.fileIndex, "DATA's file index");
      checkSize(m.offset, "DATA's offset");
      if (!(m.bytes instanceof Uint8Array) || m.bytes.byteLength < 1) throw invalidArgument('DATA carries 1 byte or more.');
      return new Writer(DATA_HEADER_BYTES + m.bytes.byteLength).u8(MESSAGE_TYPE.DATA).u8(0).u32(m.fileIndex).u64(m.offset).raw(m.bytes).done();
    case 'block-end':
      checkU32(m.fileIndex, "BLOCK_END's file index");
      checkSize(m.blockIndex, "BLOCK_END's block index");
      checkUint(m.length, BLOCK_BYTES, "BLOCK_END's length");
      checkFixed(m.hash, SHA256_BYTES, "BLOCK_END's hash");
      return new Writer(49).u8(MESSAGE_TYPE.BLOCK_END).u32(m.fileIndex).u64(m.blockIndex).u32(m.length).raw(m.hash).done();
    case 'file-end':
      checkU32(m.fileIndex, "FILE_END's file index");
      checkSize(m.size, "FILE_END's size");
      checkSize(m.blockCount, "FILE_END's block count");
      checkFixed(m.chain, SHA256_BYTES, "FILE_END's chain");
      return new Writer(53).u8(MESSAGE_TYPE.FILE_END).u32(m.fileIndex).u64(m.size).u64(m.blockCount).raw(m.chain).done();
    case 'credit':
      checkSize(m.revision, "CREDIT's revision");
      checkSize(m.limit, "CREDIT's limit");
      checkSize(m.consumed, "CREDIT's consumed");
      checkU32(m.filesDone, "CREDIT's files done");
      checkU32(m.verifiedFileIndex, "CREDIT's verified file index");
      checkSize(m.verifiedOffset, "CREDIT's verified offset");
      return new Writer(41).u8(MESSAGE_TYPE.CREDIT).u64(m.revision).u64(m.limit).u64(m.consumed).u32(m.filesDone)
        .u32(m.verifiedFileIndex).u64(m.verifiedOffset).done();
    case 'finish':
      checkU32(m.fileCount, "FINISH's file count");
      checkSize(m.totalSize, "FINISH's total size");
      checkFixed(m.manifestHash, SHA256_BYTES, "FINISH's manifest hash");
      checkFixed(m.chain, SHA256_BYTES, "FINISH's chain");
      return new Writer(77).u8(MESSAGE_TYPE.FINISH).u32(m.fileCount).u64(m.totalSize).raw(m.manifestHash).raw(m.chain).done();
    case 'result':
      checkResult(m);
      return writeResult(new Writer(1 + RESULT_BODY_BYTES).u8(MESSAGE_TYPE.RESULT), m).done();
    case 'result-ack':
      checkFixed(m.commitId, ID_BYTES, "RESULT_ACK's commit ID");
      return new Writer(17).u8(MESSAGE_TYPE.RESULT_ACK).raw(m.commitId).done();
    case 'hold':
      checkFlag(m.held, "HOLD's held");
      if (m.reason !== 'person' && m.reason !== 'app') throw invalidArgument("HOLD's reason is person or app.");
      return new Writer(3).u8(MESSAGE_TYPE.HOLD).u8(m.held ? 1 : 0).u8(m.reason === 'app' ? 2 : 1).done();
    case 'close': {
      checkFixed(m.operationId, ID_BYTES, "CLOSE's operation ID");
      const reason = CLOSE_REASONS.indexOf(m.reason) + 1;
      if (reason === 0) throw invalidArgument("CLOSE's reason isn't one.");
      let detail = 0;
      if (m.detail !== undefined) {
        detail = CLOSE_DETAILS.indexOf(m.detail) + 1;
        if (detail === 0 || m.reason !== 'FAILED') throw invalidArgument("CLOSE's detail is one of FAILED's.");
      }
      return new Writer(19).u8(MESSAGE_TYPE.CLOSE).raw(m.operationId).u8(reason).u8(detail).done();
    }
    case 'close-ack': {
      checkFixed(m.operationId, ID_BYTES, "CLOSE_ACK's operation ID");
      checkFlag(m.finished, "CLOSE_ACK's finished");
      if (!m.finished) return new Writer(18).u8(MESSAGE_TYPE.CLOSE_ACK).raw(m.operationId).u8(0).done();
      checkResult(m.result);
      return writeResult(new Writer(18 + RESULT_BODY_BYTES).u8(MESSAGE_TYPE.CLOSE_ACK).raw(m.operationId).u8(1), m.result).done();
    }
    case 'ping':
    case 'pong':
      checkId(m.id, `${m.type.toUpperCase()}'s id`);
      return new Writer(9).u8(m.type === 'ping' ? MESSAGE_TYPE.PING : MESSAGE_TYPE.PONG).u64(m.id).done();
    case 'status': {
      checkId(m.id, "STATUS's id");
      if (m.kind === 'ask') return new Writer(10).u8(MESSAGE_TYPE.STATUS).u8(1).u64(m.id).done();
      if (m.kind !== 'answer') throw invalidArgument("STATUS is an ask or an answer.");
      checkU8(m.state, "STATUS's state");
      checkFlag(m.held, "STATUS's held");
      checkSize(m.consumed, "STATUS's consumed");
      if (m.result !== undefined) checkResult(m.result);
      const w = new Writer(m.result ? 21 + RESULT_BODY_BYTES : 21).u8(MESSAGE_TYPE.STATUS).u8(2).u64(m.id).u8(m.state).u8(m.held ? 1 : 0)
        .u64(m.consumed).u8(m.result ? 1 : 0);
      return (m.result ? writeResult(w, m.result) : w).done();
    }
    default:
      throw invalidArgument("That isn't a record.");
  }
}

/** A boolean byte: 0 or 1, anything else INVALID_MESSAGE. */
function flag(value: number): boolean {
  if (value > 1) throw invalidMessage();
  return value === 1;
}

/**
 * A record from the other device, read: INVALID_MESSAGE if its type isn't
 * one this version uses, its length isn't its type's, or a field is outside
 * what its type allows. Each field is read in turn, a record too short for
 * them refused as it runs out, and one with anything after its last refused
 * at the end: so every type's length is exact.
 */
export function decodeMessage(record: Uint8Array): Message {
  if (!(record instanceof Uint8Array) || record.byteLength < 1) throw invalidMessage();
  const r = new Reader(record, 1, invalidMessage);
  const message = read(record[0], r);
  // Every byte is a field's: nothing after the last.
  if (r.left !== 0) throw invalidMessage();
  return message;
}

function read(type: number, r: Reader): Message {
  switch (type) {
    case MESSAGE_TYPE.BIND:
      return { type: 'bind', closeSecret: r.raw(CLOSE_SECRET_BYTES), hello: readHello(r) };
    case MESSAGE_TYPE.MANIFEST: {
      const total = r.u32();
      const offset = r.u32();
      const fragment = r.rest();
      // A fragment of at least a byte, within the total, so the total is at least 1.
      if (total > MAX_MANIFEST_BYTES || fragment.byteLength < 1 || offset + fragment.byteLength > total) throw invalidMessage();
      return { type: 'manifest', total, offset, fragment };
    }
    case MESSAGE_TYPE.ACCEPT: {
      const manifestHash = r.raw(SHA256_BYTES);
      const resumeSecret = r.raw(RESUME_SECRET_BYTES);
      const creditLimit = r.size();
      const sink = ASSURANCES[r.u8() - 1];
      if (!sink) throw invalidMessage();
      return { type: 'accept', manifestHash, resumeSecret, creditLimit, sink };
    }
    case MESSAGE_TYPE.DATA: {
      // No flags are defined: a record that sets one isn't this version's.
      if (r.u8() !== 0) throw invalidMessage();
      const fileIndex = r.u32();
      const offset = r.size();
      if (r.left < 1) throw invalidMessage();
      return { type: 'data', fileIndex, offset, bytes: r.rest() };
    }
    case MESSAGE_TYPE.BLOCK_END: {
      const fileIndex = r.u32();
      const blockIndex = r.size();
      const blockLength = r.u32();
      if (blockLength > BLOCK_BYTES) throw invalidMessage();
      return { type: 'block-end', fileIndex, blockIndex, length: blockLength, hash: r.raw(SHA256_BYTES) };
    }
    case MESSAGE_TYPE.FILE_END:
      return { type: 'file-end', fileIndex: r.u32(), size: r.size(), blockCount: r.size(), chain: r.raw(SHA256_BYTES) };
    case MESSAGE_TYPE.CREDIT:
      return {
        type: 'credit', revision: r.size(), limit: r.size(), consumed: r.size(), filesDone: r.u32(), verifiedFileIndex: r.u32(),
        verifiedOffset: r.size(),
      };
    case MESSAGE_TYPE.FINISH:
      return { type: 'finish', fileCount: r.u32(), totalSize: r.size(), manifestHash: r.raw(SHA256_BYTES), chain: r.raw(SHA256_BYTES) };
    case MESSAGE_TYPE.RESULT:
      return { type: 'result', ...readResult(r) };
    case MESSAGE_TYPE.RESULT_ACK:
      return { type: 'result-ack', commitId: r.raw(ID_BYTES) };
    case MESSAGE_TYPE.HOLD:
      // A reason this version doesn't know is read as the person's.
      return { type: 'hold', held: flag(r.u8()), reason: r.u8() === 2 ? 'app' : 'person' };
    case MESSAGE_TYPE.CLOSE: {
      const operationId = r.raw(ID_BYTES);
      // A reason this version doesn't know is read as FAILED, with no detail.
      const reason = CLOSE_REASONS[r.u8() - 1];
      const detail = CLOSE_DETAILS[r.u8() - 1];
      if (!reason) return { type: 'close', operationId, reason: 'FAILED' };
      return reason === 'FAILED' && detail ? { type: 'close', operationId, reason, detail } : { type: 'close', operationId, reason };
    }
    case MESSAGE_TYPE.CLOSE_ACK: {
      const operationId = r.raw(ID_BYTES);
      // Finished, it carries the result; else nothing more.
      const finished = flag(r.u8());
      return finished ? { type: 'close-ack', operationId, finished, result: readResult(r) } : { type: 'close-ack', operationId, finished };
    }
    case MESSAGE_TYPE.PING:
      return { type: 'ping', id: r.u64() };
    case MESSAGE_TYPE.PONG:
      return { type: 'pong', id: r.u64() };
    case MESSAGE_TYPE.STATUS: {
      const kind = r.u8();
      if (kind === 1) return { type: 'status', kind: 'ask', id: r.u64() };
      if (kind !== 2) throw invalidMessage();
      const id = r.u64();
      const state = r.u8();
      const held = flag(r.u8());
      const consumed = r.size();
      const hasResult = flag(r.u8());
      return hasResult
        ? { type: 'status', kind: 'answer', id, state, held, consumed, result: readResult(r) }
        : { type: 'status', kind: 'answer', id, state, held, consumed };
    }
    default:
      // Unknown, or kept for a later version (a resume's RESUME and RESUME_OK).
      throw invalidMessage();
  }
}

/** One file in a manifest. */
export interface ManifestFile {
  /** Its name: 1 to 255 UTF-8 bytes, under core's file name rule. */
  name: string;
  /** Its size in bytes, 0 or more. */
  size: number;
  /** Its media type, advisory: 0 to 127 printable ASCII characters. */
  type: string;
}

export interface Manifest {
  files: ManifestFile[];
  totalSize: number;
}

/** A media type as the manifest carries it: printable ASCII, at most 127 characters, or nothing. */
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/**
 * The manifest's bytes for `files`, as the sender offers them. A media type
 * that isn't printable ASCII of at most 127 characters is left empty: it's
 * only advice.
 * @throws {DropgateError} INVALID_FILENAME for a name the rule refuses;
 * INVALID_ARGUMENT for no files, more than 10,000, a size that isn't a whole
 * number of bytes, a total over 2^53 − 1, or a manifest over 1 MiB.
 */
export function encodeManifest(files: readonly ManifestFile[]): Uint8Array<ArrayBuffer> {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_MANIFEST_FILES) {
    throw invalidArgument(`A transfer offers 1 to ${MAX_MANIFEST_FILES} files.`);
  }
  let total = 0;
  let length = MANIFEST_START_BYTES;
  const parts = files.map((file, index) => {
    const { name, size, type } = file ?? ({} as ManifestFile);
    validateFilename(name, { index });
    checkSize(size, "A file's size");
    total += size;
    if (!Number.isSafeInteger(total)) throw invalidArgument('The files add up to more than 2^53 - 1 bytes.');
    const nameBytes = encoder.encode(name);
    const typeText = typeof type === 'string' && type.length <= MAX_MEDIA_TYPE_BYTES && PRINTABLE_ASCII.test(type) ? type : '';
    length += 8 + 2 + nameBytes.byteLength + 1 + typeText.length;
    return { size, nameBytes, typeBytes: encoder.encode(typeText) };
  });
  if (length > MAX_MANIFEST_BYTES) throw invalidArgument('The list of files is over 1 MiB.');
  const w = new Writer(length).u8(MANIFEST_VERSION).u32(BLOCK_BYTES).u32(files.length).u64(total);
  for (const { size, nameBytes, typeBytes } of parts) {
    w.u64(size).u16(nameBytes.byteLength).raw(nameBytes).u8(typeBytes.byteLength).raw(typeBytes);
  }
  return w.done();
}

/**
 * A manifest from the other device, read and checked: INVALID_MANIFEST for
 * anything that doesn't add up (a version or block size this version doesn't
 * use, 0 or over 10,000 files, a name the rule refuses, a media type that isn't
 * printable ASCII, sizes whose sum isn't the total, or anything after the last
 * file).
 */
export function decodeManifest(bytes: Uint8Array): Manifest {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_MANIFEST_BYTES) throw invalidManifest();
  const r = new Reader(bytes, 0, invalidManifest);
  if (r.u8() !== MANIFEST_VERSION || r.u32() !== BLOCK_BYTES) throw invalidManifest();
  const count = r.u32();
  if (count < 1 || count > MAX_MANIFEST_FILES) throw invalidManifest();
  const totalSize = r.size();
  const files: ManifestFile[] = [];
  let sum = 0;
  for (let index = 0; index < count; index++) {
    const size = r.size();
    const nameLength = r.u16();
    let name: string;
    try {
      // The name rule refuses an empty one, and one over 255 UTF-8 bytes.
      name = strictDecoder.decode(r.raw(nameLength));
      validateFilename(name, { index, origin: 'peer' });
    } catch {
      throw invalidManifest();
    }
    const typeLength = r.u8();
    if (typeLength > MAX_MEDIA_TYPE_BYTES) throw invalidManifest();
    const type = String.fromCharCode(...r.raw(typeLength));
    if (!PRINTABLE_ASCII.test(type)) throw invalidManifest();
    // Past 2^53 - 1 the sum can't equal the total, which is at most that.
    sum += size;
    files.push({ name, size, type });
  }
  if (r.left !== 0 || sum !== totalSize) throw invalidManifest();
  return { files, totalSize };
}

/** The manifest's hash: SHA-256("dropgate/4 dgdtp manifest" ‖ manifest). */
export function manifestHash(provider: CryptoProvider, manifest: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const label = encoder.encode(MANIFEST_LABEL);
  const input = new Uint8Array(label.byteLength + manifest.byteLength);
  input.set(label);
  input.set(manifest, label.byteLength);
  return provider.sha256(input);
}

/** The most bytes of the manifest one MANIFEST record holds, for records of `recordBytes` (with Noise's tag). */
export function manifestFragmentBytes(recordBytes: number): number {
  return recordBytes - NOISE_TAG_BYTES - MANIFEST_HEADER_BYTES;
}

/** The most bytes of a file one DATA record holds, for records of `recordBytes` (with Noise's tag): 65,505 at 65,535. */
export function dataBytes(recordBytes: number): number {
  return recordBytes - NOISE_TAG_BYTES - DATA_HEADER_BYTES;
}

function checkRecordBytes(recordBytes: unknown): asserts recordBytes is number {
  if (!Number.isInteger(recordBytes) || (recordBytes as number) < MIN_RECORD_BYTES || (recordBytes as number) > NOISE_MAX_MESSAGE_BYTES) {
    throw invalidArgument(`A record is ${MIN_RECORD_BYTES} to ${NOISE_MAX_MESSAGE_BYTES} bytes.`);
  }
}

/** The manifest as MANIFEST records, in order: each fragment the most a record of `recordBytes` holds. */
export function manifestRecords(manifest: Uint8Array, recordBytes: number): Array<Uint8Array<ArrayBuffer>> {
  checkRecordBytes(recordBytes);
  const most = manifestFragmentBytes(recordBytes);
  const records: Array<Uint8Array<ArrayBuffer>> = [];
  for (let offset = 0; offset < manifest.byteLength; offset += most) {
    records.push(encodeMessage({
      type: 'manifest', total: manifest.byteLength, offset, fragment: manifest.subarray(offset, Math.min(manifest.byteLength, offset + most)),
    }));
  }
  return records;
}

/**
 * The receiver's side of MANIFEST: the fragments put back together, each
 * checked to come in order from offset 0, each the most a record holds (the
 * last what's left), every one with the same total. INVALID_MANIFEST for a
 * gap, an overlap, a short fragment or a total that changes.
 */
export class ManifestAssembler {
  readonly #most: number;
  #bytes: Uint8Array<ArrayBuffer> | undefined;
  #received = 0;

  /** For records of `recordBytes`, with Noise's tag: the size both sides agreed. */
  constructor(recordBytes: number) {
    checkRecordBytes(recordBytes);
    this.#most = manifestFragmentBytes(recordBytes);
  }

  /** Whether the whole manifest has come. */
  get complete(): boolean { return this.#bytes !== undefined && this.#received === this.#bytes.byteLength; }

  /** Takes one MANIFEST record's fields: the whole manifest once its last fragment is in, else undefined. */
  take(fragment: { total: number; offset: number; fragment: Uint8Array }): Uint8Array<ArrayBuffer> | undefined {
    const { total, offset } = fragment;
    const bytes = fragment.fragment;
    // Once complete, the next fragment expected is 0 bytes, which none is.
    this.#bytes ??= new Uint8Array(total);
    const expected = Math.min(this.#most, total - this.#received);
    if (total !== this.#bytes.byteLength || offset !== this.#received || bytes.byteLength !== expected) throw invalidManifest();
    this.#bytes.set(bytes, offset);
    this.#received += bytes.byteLength;
    return this.complete ? this.#bytes : undefined;
  }
}

const u32Bytes = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
const u64Bytes = (n: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n)); return b; };

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

function checkChain(chain: unknown): asserts chain is Uint8Array {
  checkFixed(chain, SHA256_BYTES, 'A checkpoint');
}

/** The chain's first checkpoint: C0 = SHA-256("dropgate/4 dgdtp checkpoint" ‖ manifestHash). */
export function chainStart(provider: CryptoProvider, hashOfManifest: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  checkFixed(hashOfManifest, SHA256_BYTES, "The manifest's hash");
  return provider.sha256(concat(encoder.encode(CHECKPOINT_LABEL), hashOfManifest));
}

/** The chain after one block: SHA-256(C ‖ 0x01 ‖ fileIndex (4) ‖ blockIndex (8) ‖ length (4) ‖ blockHash (32)). */
export function chainBlock(
  provider: CryptoProvider, chain: Uint8Array, block: { fileIndex: number; blockIndex: number; length: number; hash: Uint8Array },
): Promise<Uint8Array<ArrayBuffer>> {
  checkChain(chain);
  checkU32(block.fileIndex, "A block's file index");
  checkSize(block.blockIndex, "A block's index");
  checkUint(block.length, BLOCK_BYTES, "A block's length");
  checkFixed(block.hash, SHA256_BYTES, "A block's hash");
  return provider.sha256(concat(chain, Uint8Array.of(CHAIN_BLOCK), u32Bytes(block.fileIndex), u64Bytes(block.blockIndex), u32Bytes(block.length), block.hash));
}

/** The chain after a file's end: SHA-256(C ‖ 0x02 ‖ fileIndex (4) ‖ size (8) ‖ blockCount (8)). */
export function chainFileEnd(
  provider: CryptoProvider, chain: Uint8Array, end: { fileIndex: number; size: number; blockCount: number },
): Promise<Uint8Array<ArrayBuffer>> {
  checkChain(chain);
  checkU32(end.fileIndex, "A file's index");
  checkSize(end.size, "A file's size");
  checkSize(end.blockCount, "A file's block count");
  return provider.sha256(concat(chain, Uint8Array.of(CHAIN_FILE_END), u32Bytes(end.fileIndex), u64Bytes(end.size), u64Bytes(end.blockCount)));
}

/** How many integrity blocks a file of `size` bytes has: 0 for an empty one. */
export function blockCount(size: number): number {
  checkSize(size, "A file's size");
  return Math.ceil(size / BLOCK_BYTES);
}
