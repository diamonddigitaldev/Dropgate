import type { ContentKey, CryptoProvider } from '../crypto/index.js';
import { DropgateError } from '../errors.js';
import type { ObjectLayout } from './layout.js';

// STREAM, as age and Tink use it: chunk i is AES-256-GCM under the object's
// payload key, with no associated data, and its nonce is i as an 11-byte
// big-endian number followed by 01 for the last chunk or 00 for any other.
// So a chunk can't be moved, repeated, dropped or taken from another object,
// and the stream can't be cut short, without a chunk failing to open.

/** Chunk `index`'s nonce. */
export function chunkNonce(index: number, last: boolean): Uint8Array<ArrayBuffer> {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'A chunk index is a whole number from 0.' });
  }
  const nonce = new Uint8Array(12);
  let rest = index;
  for (let i = 10; rest > 0; i--) {
    nonce[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  nonce[11] = last ? 1 : 0;
  return nonce;
}

const integrity = (message: string, cause?: unknown) =>
  new DropgateError({ code: 'INTEGRITY_FAILED', message, ...(cause === undefined ? {} : { cause }) });

/**
 * Seals an object's chunks, and never seals one index twice: with the index
 * as the nonce, sealing chunk i again over changed bytes (a file edited during
 * a pause) would reuse a nonce under one key, which breaks AES-GCM. So each
 * chunk is sealed once, and its sealed bytes are kept until the server has
 * them; a retry or a resume sends those same bytes again.
 */
export class ChunkSealer {
  readonly #provider: CryptoProvider;
  readonly #key: ContentKey;
  readonly #layout: ObjectLayout;
  readonly #sealed: Uint8Array;
  readonly #kept = new Map<number, Uint8Array>();

  constructor(provider: CryptoProvider, payloadKey: ContentKey, layout: ObjectLayout) {
    this.#provider = provider;
    this.#key = payloadKey;
    this.#layout = layout;
    this.#sealed = new Uint8Array(Math.ceil(layout.chunkCount / 8));
  }

  /** Whether chunk `index` has been sealed. */
  isSealed(index: number): boolean {
    return (this.#sealed[index >> 3] & (1 << (index & 7))) !== 0;
  }

  /**
   * Seals chunk `index`, the first and only time, from exactly its plaintext
   * (padding included), and keeps the result until `confirm(index)`.
   * @throws {DropgateError} ENCRYPT_FAILED if it was sealed before, or can't be.
   */
  async seal(index: number, plaintext: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    const length = this.#layout.chunkLength(index);
    if (plaintext.byteLength !== length) {
      throw new DropgateError({ code: 'INVALID_ARGUMENT', message: `Chunk ${index} is ${length} bytes.` });
    }
    if (this.isSealed(index)) {
      throw new DropgateError({ code: 'ENCRYPT_FAILED', message: `Chunk ${index} was sealed already, and a chunk is never sealed twice.` });
    }
    // Marked before the first await, so two calls at once can't both seal it.
    this.#sealed[index >> 3] |= 1 << (index & 7);
    let sealed: Uint8Array<ArrayBuffer>;
    try {
      sealed = await this.#provider.encryptWithNonce(this.#key, chunkNonce(index, this.#layout.isLast(index)), plaintext);
    } catch (err) {
      throw new DropgateError({ code: 'ENCRYPT_FAILED', cause: err });
    }
    this.#kept.set(index, sealed);
    return sealed;
  }

  /** Chunk `index`'s sealed bytes, kept since it was sealed until the server has it, to send again. */
  kept(index: number): Uint8Array | undefined {
    return this.#kept.get(index);
  }

  /** The server has chunk `index`: its sealed bytes needn't be kept. */
  confirm(index: number): void {
    this.#kept.delete(index);
  }
}

/**
 * Opens a run of an object's chunks, in order: the whole object, or the
 * chunks a member or a resume needs. Each chunk's last flag comes from the
 * layout, so a stream cut short, or with bytes after its last chunk, fails.
 */
export class ChunkOpener {
  readonly #provider: CryptoProvider;
  readonly #key: ContentKey;
  readonly #layout: ObjectLayout;
  readonly #last: number;
  #next: number;

  constructor(provider: CryptoProvider, payloadKey: ContentKey, layout: ObjectLayout, first = 0, last = layout.chunkCount - 1) {
    layout.range(first, last);
    this.#provider = provider;
    this.#key = payloadKey;
    this.#layout = layout;
    this.#next = first;
    this.#last = last;
  }

  /** The index of the chunk expected next. */
  get next(): number {
    return this.#next;
  }

  /** The stored length of the chunk expected next, or 0 once every chunk is open. */
  get nextLength(): number {
    if (this.#next > this.#last) return 0;
    const { start, end } = this.#layout.chunkBytes(this.#next);
    return end - start;
  }

  /** Whether every chunk in the run has been opened. */
  get done(): boolean {
    return this.#next > this.#last;
  }

  /**
   * Opens the next chunk.
   * @throws {DropgateError} INTEGRITY_FAILED if it's out of order, after the
   * run's end, the wrong length, or doesn't open (changed, moved, repeated,
   * from another object, or flagged last when it isn't, or not when it is).
   */
  async open(index: number, sealed: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    if (this.done) throw integrity('Data came after the last chunk.');
    if (index !== this.#next) throw integrity('A chunk came out of order.');
    if (sealed.byteLength !== this.nextLength) throw integrity('A chunk is the wrong length.');
    let plaintext: Uint8Array<ArrayBuffer>;
    try {
      plaintext = await this.#provider.decryptWithNonce(this.#key, chunkNonce(index, this.#layout.isLast(index)), sealed);
    } catch (err) {
      throw integrity("A chunk didn't pass its integrity check.", err);
    }
    this.#next++;
    return plaintext;
  }

  /**
   * The run is over: nothing more comes.
   * @throws {DropgateError} INTEGRITY_FAILED if it ended before its last chunk.
   */
  finish(): void {
    if (!this.done) throw integrity('The data ended before its last chunk.');
  }
}

/**
 * Opens the chunks in `bytes`, however they're split, as the opener's run
 * expects them, giving each chunk's plaintext. Nothing is complete until it
 * has ended: a stream cut short or with bytes after its last chunk throws
 * INTEGRITY_FAILED, before the last value.
 */
export async function* openChunks(
  opener: ChunkOpener,
  bytes: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): AsyncGenerator<{ index: number; plaintext: Uint8Array<ArrayBuffer> }> {
  // Pieces not yet used, from `head` on, so taking them stays linear however small they are.
  let pending: Uint8Array[] = [];
  let head = 0;
  let pendingLength = 0;
  const take = (length: number): Uint8Array => {
    const out = new Uint8Array(length);
    let at = 0;
    while (at < length) {
      const piece = pending[head];
      const used = Math.min(piece.byteLength, length - at);
      out.set(piece.subarray(0, used), at);
      at += used;
      if (used === piece.byteLength) head++;
      else pending[head] = piece.subarray(used);
    }
    pending = pending.slice(head);
    head = 0;
    pendingLength -= length;
    return out;
  };

  for await (const piece of bytes) {
    if (piece.byteLength === 0) continue;
    if (opener.done) throw integrity('Data came after the last chunk.');
    pending.push(piece);
    pendingLength += piece.byteLength;
    while (!opener.done && pendingLength >= opener.nextLength) {
      const index = opener.next;
      yield { index, plaintext: await opener.open(index, take(opener.nextLength)) };
    }
    if (opener.done && pendingLength > 0) throw integrity('Data came after the last chunk.');
  }
  opener.finish();
}
