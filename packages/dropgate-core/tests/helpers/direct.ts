// Helpers for the direct-transfer engine's tests (src/dgdtp/engine.ts,
// send.ts, receive.ts): files and sinks in memory, a sender played by hand
// record by record, and the channel's records read back.
import { setImmediate as immediate } from 'node:timers/promises';
import type { CryptoProvider } from '../../src/crypto/index.js';
import type { SecureChannel } from '../../src/dgdtp/channel.js';
import {
  BLOCK_BYTES, blockCount, chainBlock, chainFileEnd, chainStart, dataBytes, decodeMessage, encodeManifest, encodeMessage, manifestHash,
  manifestRecords, type Message,
} from '../../src/dgdtp/messages.js';
import type { EngineTimers } from '../../src/dgdtp/timers.js';
import type { DownloadFileInfo, DownloadSink } from '../../src/sink.js';
import type { FileSource } from '../../src/source.js';

/**
 * A clock for the engine's timers that moves only when a test moves it: each
 * timer runs when the clock reaches its time, in order, with the real work it
 * starts (crypto, the in-memory pipes) let settle before the next.
 */
export class FakeClock implements EngineTimers {
  #now = 0;
  #nextId = 1;
  readonly #timers = new Map<number, { at: number; run: () => void }>();

  now(): number { return this.#now; }

  setTimeout(run: () => void, ms: number): number {
    const id = this.#nextId++;
    this.#timers.set(id, { at: this.#now + Math.max(0, ms), run });
    return id;
  }

  clearTimeout(id: unknown): void {
    this.#timers.delete(id as number);
  }

  /** How far off each waiting timer is, soonest first. */
  get waiting(): number[] {
    return [...this.#timers.values()].map((t) => t.at - this.#now).sort((a, b) => a - b);
  }

  /** Moves the clock on by `ms`, `step` at a time (so the other side's answers come between), running each timer as its time comes. */
  async advance(ms: number, step = ms): Promise<void> {
    const end = this.#now + ms;
    while (this.#now < end) {
      const target = Math.min(end, this.#now + step);
      for (;;) {
        let next: [number, { at: number; run: () => void }] | undefined;
        for (const entry of this.#timers) if (entry[1].at <= target && (!next || entry[1].at < next[1].at)) next = entry;
        if (!next) break;
        this.#timers.delete(next[0]);
        this.#now = Math.max(this.#now, next[1].at);
        next[1].run();
        await settle();
      }
      this.#now = target;
      await settle();
    }
  }
}

/** Calls of a `tracked()` provider still running. */
let cryptoInFlight = 0;

/**
 * `provider`, counting its calls still running: the engine's every step that
 * waits on something real (a record's encryption, a hash) is one of these, so
 * `settle()` can wait for exactly that work, on a fast machine or a slow one.
 */
export function tracked(provider: CryptoProvider): CryptoProvider {
  // A copy, each method wrapped: the provider itself is frozen.
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(provider)) {
    const value = (provider as unknown as Record<string, unknown>)[key];
    copy[key] = typeof value !== 'function' ? value : (...args: unknown[]) => {
      const out = (value as (...a: unknown[]) => unknown).apply(provider, args);
      if (out instanceof Promise) {
        cryptoInFlight += 1;
        out.then(() => { cryptoInFlight -= 1; }, () => { cryptoInFlight -= 1; });
      }
      return out;
    };
  }
  return Object.freeze(copy) as unknown as CryptoProvider;
}

/**
 * Lets the real work a timer started run its course: until no call of a
 * `tracked()` provider is running and the event loop has turned three times
 * with none (the in-memory pipes and the engine's steps between crypto calls
 * are promises, done within a turn), or `capMs` of real time has passed.
 */
export async function settle(capMs = 100): Promise<void> {
  const end = performance.now() + capMs;
  let quiet = 0;
  while (quiet < 3 && performance.now() < end) {
    await immediate();
    quiet = cryptoInFlight === 0 ? quiet + 1 : 0;
  }
}

/** `size` bytes that differ from block to block and file to file: a counter run through a small mix. */
export function patterned(size: number, seed = 1): Uint8Array {
  const out = new Uint8Array(size);
  let x = (seed * 2654435761) >>> 0;
  for (let i = 0; i < size; i++) {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

/** A file held in memory, read as core reads sources; `fail` makes a read throw. */
export function memoryFile(name: string, bytes: Uint8Array, options: { type?: string; fail?: (start: number) => boolean } = {}): FileSource & { reads: Array<[number, number]> } {
  const reads: Array<[number, number]> = [];
  return {
    name,
    size: bytes.byteLength,
    type: options.type ?? 'application/octet-stream',
    reads,
    async read(start: number, end: number) {
      reads.push([start, end]);
      if (options.fail?.(start)) throw new Error('The disk went away.');
      return bytes.slice(start, end);
    },
  };
}

/** A sink in memory: what was written, whether it closed or was aborted, and hooks to hold a write or the close. */
export class MemorySink implements DownloadSink {
  readonly chunks: Uint8Array[] = [];
  closed = false;
  aborted: unknown;
  writes = 0;
  /** Each write waits for this, if set (a promise per write number, from 1). */
  holdWrite?: (n: number) => Promise<void> | undefined;
  /** The close waits for this, if set. */
  holdClose?: Promise<void>;
  /** A write that throws, by its number. */
  failWrite?: number;

  async write(chunk: Uint8Array): Promise<void> {
    this.writes += 1;
    const n = this.writes;
    if (this.failWrite === n) throw new Error('The disk is full.');
    await this.holdWrite?.(n);
    this.chunks.push(new Uint8Array(chunk));
  }

  async close(): Promise<void> {
    await this.holdClose;
    this.closed = true;
  }

  abort(reason?: unknown): void {
    this.aborted = reason ?? true;
  }

  get bytes(): Uint8Array {
    const out = new Uint8Array(this.chunks.reduce((n, c) => n + c.byteLength, 0));
    let at = 0;
    for (const c of this.chunks) { out.set(c, at); at += c.byteLength; }
    return out;
  }
}

/** A function giving a new MemorySink for each file, keeping them by index. */
export function sinksByFile(): { sink: (file: DownloadFileInfo) => MemorySink; files: Map<number, { info: DownloadFileInfo; sink: MemorySink }> } {
  const files = new Map<number, { info: DownloadFileInfo; sink: MemorySink }>();
  return {
    files,
    sink: (info) => {
      const sink = new MemorySink();
      files.set(info.index, { info: { ...info }, sink });
      return sink;
    },
  };
}

/** Whether two byte strings are the same, said as a short string for a test's failure. */
export function sameAs(actual: Uint8Array, expected: Uint8Array): string {
  if (actual.byteLength !== expected.byteLength) return `${actual.byteLength} bytes, not ${expected.byteLength}`;
  for (let i = 0; i < actual.byteLength; i++) if (actual[i] !== expected[i]) return `differs at byte ${i}`;
  return 'the same';
}

/**
 * One reader per channel, taking its records in order into a queue, so a test
 * that stops waiting for one (anythingWithin) never loses it to a receive()
 * still pending.
 */
class Reader {
  readonly #queue: Array<{ record: Uint8Array } | { error: unknown }> = [];
  #wake: (() => void) | undefined;

  constructor(channel: SecureChannel) {
    void (async () => {
      for (;;) {
        try {
          this.#queue.push({ record: await channel.receive() });
        } catch (error) {
          this.#queue.push({ error });
          this.#wake?.();
          return;
        }
        this.#wake?.();
      }
    })();
  }

  /** The next record, or the channel's end; undefined if none comes within `ms`. */
  async next(ms?: number): Promise<{ record: Uint8Array } | { error: unknown } | undefined> {
    const end = ms === undefined ? Infinity : Date.now() + ms;
    for (;;) {
      const item = this.#queue[0];
      if (item) {
        // The channel's end stays, for every later read.
        if ('record' in item) this.#queue.shift();
        return item;
      }
      const left = end - Date.now();
      if (left <= 0) return undefined;
      await new Promise<void>((resolve) => {
        const timer = left === Infinity ? undefined : setTimeout(resolve, left);
        this.#wake = () => { clearTimeout(timer); this.#wake = undefined; resolve(); };
      });
    }
  }
}

const readers = new WeakMap<SecureChannel, Reader>();
const readerOf = (channel: SecureChannel) => {
  let reader = readers.get(channel);
  if (!reader) {
    reader = new Reader(channel);
    readers.set(channel, reader);
  }
  return reader;
};

/** `channel`, counting the records read from it, so a test knows once everything it sent has been read. */
export function countingReads(channel: SecureChannel): { channel: SecureChannel; readonly read: number } {
  let read = 0;
  const counted: SecureChannel = {
    ...channel,
    async receive() {
      const record = await channel.receive();
      read += 1;
      return record;
    },
  };
  return { channel: counted, get read() { return read; } };
}

/** The next record on `channel`, read; or what ended it, thrown. */
export async function nextRecord(channel: SecureChannel): Promise<Message> {
  const item = (await readerOf(channel).next()) as { record: Uint8Array } | { error: unknown };
  if ('error' in item) throw item.error;
  return decodeMessage(item.record);
}

/** Records on `channel` until one of `type` comes (the others kept in `seen`). */
export async function recordOf<T extends Message['type']>(channel: SecureChannel, type: T, seen: Message[] = []): Promise<Extract<Message, { type: T }>> {
  for (;;) {
    const m = await nextRecord(channel);
    seen.push(m);
    if (m.type === type) return m as Extract<Message, { type: T }>;
  }
}

/** Whether `channel` sends anything within `ms`: the record, or undefined. */
export async function anythingWithin(channel: SecureChannel, ms: number): Promise<Message | 'closed' | undefined> {
  const item = await readerOf(channel).next(ms);
  if (!item) return undefined;
  return 'error' in item ? 'closed' : decodeMessage(item.record);
}

/**
 * A sender played by hand over its side of a channel: the list of files, then
 * each file's records as a sender must write them (or not, as a test likes).
 */
export class ScriptedSender {
  readonly channel: SecureChannel;
  readonly provider: CryptoProvider;
  readonly files: Array<{ name: string; bytes: Uint8Array }>;
  readonly manifest: Uint8Array;
  hash!: Uint8Array;
  chain!: Uint8Array;

  constructor(provider: CryptoProvider, channel: SecureChannel, files: Array<{ name: string; bytes: Uint8Array }>) {
    this.provider = provider;
    this.channel = channel;
    this.files = files;
    this.manifest = encodeManifest(files.map((f) => ({ name: f.name, size: f.bytes.byteLength, type: 'text/plain' })));
  }

  get recordBytes(): number {
    return Math.min(this.channel.maxRecordBytes, this.channel.peerHello.maxRecord);
  }

  send(message: Message): Promise<void> {
    return this.channel.send(encodeMessage(message));
  }

  /** The list of files, in records the size both hellos allow. */
  async offer(): Promise<void> {
    this.hash = await manifestHash(this.provider, this.manifest);
    this.chain = await chainStart(this.provider, this.hash);
    for (const record of manifestRecords(this.manifest, this.recordBytes)) await this.channel.send(record);
  }

  /** File `index`'s DATA and BLOCK_ENDs, then its FILE_END, as a sender must; `fileEnd` may change the FILE_END. */
  async sendFile(index: number, fileEnd?: (m: Extract<Message, { type: 'file-end' }>) => Message): Promise<void> {
    const { bytes } = this.files[index];
    const most = dataBytes(this.recordBytes);
    const blocks = blockCount(bytes.byteLength);
    for (let b = 0; b < blocks; b++) {
      const block = bytes.subarray(b * BLOCK_BYTES, Math.min(bytes.byteLength, (b + 1) * BLOCK_BYTES));
      for (let at = 0; at < block.byteLength; at += most) {
        await this.send({ type: 'data', fileIndex: index, offset: b * BLOCK_BYTES + at, bytes: block.subarray(at, Math.min(block.byteLength, at + most)) });
      }
      const hash = await this.provider.sha256(block);
      this.chain = await chainBlock(this.provider, this.chain, { fileIndex: index, blockIndex: b, length: block.byteLength, hash });
      await this.send({ type: 'block-end', fileIndex: index, blockIndex: b, length: block.byteLength, hash });
    }
    this.chain = await chainFileEnd(this.provider, this.chain, { fileIndex: index, size: bytes.byteLength, blockCount: blocks });
    const end: Extract<Message, { type: 'file-end' }> = { type: 'file-end', fileIndex: index, size: bytes.byteLength, blockCount: blocks, chain: this.chain };
    await this.send(fileEnd ? fileEnd(end) : end);
  }

  async finish(): Promise<void> {
    const totalSize = this.files.reduce((n, f) => n + f.bytes.byteLength, 0);
    await this.send({ type: 'finish', fileCount: this.files.length, totalSize, manifestHash: this.hash, chain: this.chain });
  }
}
