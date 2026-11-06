import { DropgateError } from '../errors.js';

// Where every byte of a DGUP 4 object is. An encrypted object is a 60-byte
// header, then STREAM chunks of C plaintext bytes (the last 1 to C), each
// followed by its 16-byte tag; the plaintext is the files one after another,
// then zero bytes up to its Padmé length. An unencrypted object is the files'
// bytes alone. C is the chunk size the header records.

/** An encrypted object's header. */
export const HEADER_BYTES = 60;
/** AES-GCM's tag, after every chunk. */
export const TAG_BYTES = 16;
/** The smallest chunk size an object may have (64 KiB). */
export const MIN_CHUNK_SIZE = 64 * 1024;
/** The largest (64 MiB): a downloader holds a whole chunk to open it. */
export const MAX_CHUNK_SIZE = 64 * 1024 * 1024;

const invalid = (message: string) => new DropgateError({ code: 'INVALID_ARGUMENT', message });

const isLength = (n: number) => Number.isSafeInteger(n) && n >= 0;

/** Whether `chunkSize` is a whole number of bytes from 64 KiB to 64 MiB. */
export const isChunkSize = (chunkSize: number): boolean =>
  Number.isSafeInteger(chunkSize) && chunkSize >= MIN_CHUNK_SIZE && chunkSize <= MAX_CHUNK_SIZE;

const checkChunkSize = (chunkSize: number) => {
  if (!isChunkSize(chunkSize)) throw invalid('A chunk size is from 64 KiB to 64 MiB.');
};

/** How many bits `n` takes, for a whole number up to 2^53. */
const bitLength = (n: number): number => {
  let bits = 0;
  for (let rest = n; rest >= 1; rest = Math.floor(rest / 2)) bits++;
  return bits;
};

/**
 * Padmé: `length` rounded up so that only its top bits can differ, which
 * leaves at most O(log log L) bits of the size showing. For L < 2, L; else
 * with E = ⌊log2 L⌋ and S = ⌊log2 E⌋ + 1, L rounded up to a multiple of
 * 2^(E − S).
 */
export function padme(length: number): number {
  if (!isLength(length)) throw invalid('A length is a whole number of bytes.');
  if (length < 2) return length;
  const e = bitLength(length) - 1;
  const step = 2 ** (e - bitLength(e));
  return Math.ceil(length / step) * step;
}

/** The stored size of an encrypted object of `length` plaintext bytes (padding included). */
export function encryptedSize(length: number, chunkSize: number): number {
  return HEADER_BYTES + length + TAG_BYTES * Math.ceil(length / chunkSize);
}

/**
 * How many plaintext bytes an encrypted object of `length` file bytes holds:
 * Padmé's length, clamped so the stored object fits `maxBytes` (the server's
 * limit, 0 for none). Padding never makes an upload too large: when Padmé's
 * object wouldn't fit, it's the most plaintext whose object does.
 * @throws {DropgateError} FILE_TOO_LARGE if the files alone don't fit.
 */
export function paddedLength(length: number, chunkSize: number, maxBytes = 0): number {
  checkChunkSize(chunkSize);
  if (!isLength(length) || length < 1) throw invalid('An object holds at least one byte.');
  const padded = padme(length);
  if (!(maxBytes > 0)) return padded;
  if (encryptedSize(length, chunkSize) > maxBytes) throw new DropgateError({ code: 'FILE_TOO_LARGE' });
  if (encryptedSize(padded, chunkSize) <= maxBytes) return padded;
  // Whole chunks that fit, then what's left after one more tag, if anything.
  const room = maxBytes - HEADER_BYTES;
  const whole = Math.floor(room / (chunkSize + TAG_BYTES));
  const rest = room - whole * (chunkSize + TAG_BYTES);
  return whole * chunkSize + Math.max(0, rest - TAG_BYTES);
}

/** A run of bytes, `start` included and `end` not. */
export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

/** What a run of plaintext needs: its chunks, their stored bytes, and how much of the first chunk to skip. */
export interface Span extends ByteRange {
  readonly first: number;
  readonly last: number;
  readonly skip: number;
}

/** A part of a chunk's plaintext that comes from a file. */
export interface ChunkPart {
  readonly file: number;
  readonly offset: number;
  readonly length: number;
}

/** One object's numbers: its chunks, and where each is stored. */
export class ObjectLayout {
  readonly encrypted: boolean;
  readonly chunkSize: number;
  /** The plaintext the chunks hold: for an encrypted object, padding included. */
  readonly length: number;
  readonly chunkCount: number;
  readonly storedSize: number;

  private constructor(encrypted: boolean, length: number, chunkSize: number) {
    this.encrypted = encrypted;
    this.chunkSize = chunkSize;
    this.length = length;
    this.chunkCount = Math.ceil(length / chunkSize);
    this.storedSize = encrypted ? encryptedSize(length, chunkSize) : length;
    Object.freeze(this);
  }

  /** An encrypted object of `length` plaintext bytes, padding included. */
  static encrypted(length: number, chunkSize: number): ObjectLayout {
    checkChunkSize(chunkSize);
    if (!isLength(length) || length < 1) throw invalid('An object holds at least one byte.');
    return new ObjectLayout(true, length, chunkSize);
  }

  /** An unencrypted object: the files' bytes, with no header, tags or padding. */
  static plain(length: number, chunkSize: number): ObjectLayout {
    checkChunkSize(chunkSize);
    if (!isLength(length) || length < 1) throw invalid('An object holds at least one byte.');
    return new ObjectLayout(false, length, chunkSize);
  }

  /**
   * The encrypted object a server says it holds `storedSize` bytes of.
   * @throws {DropgateError} INTEGRITY_FAILED if no object with this chunk size is that size.
   */
  static fromStoredSize(storedSize: number, chunkSize: number): ObjectLayout {
    checkChunkSize(chunkSize);
    const body = storedSize - HEADER_BYTES;
    const count = Math.ceil(body / (chunkSize + TAG_BYTES));
    const lastStored = body - (count - 1) * (chunkSize + TAG_BYTES);
    if (!Number.isSafeInteger(storedSize) || count < 1 || lastStored <= TAG_BYTES) {
      throw new DropgateError({ code: 'INTEGRITY_FAILED', message: "The object's size doesn't fit its chunk size." });
    }
    return new ObjectLayout(true, (count - 1) * chunkSize + lastStored - TAG_BYTES, chunkSize);
  }

  #check(index: number) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.chunkCount) throw invalid('No chunk has that index.');
  }

  /** Whether chunk `index` is the last. */
  isLast(index: number): boolean {
    return index === this.chunkCount - 1;
  }

  /** The plaintext bytes in chunk `index`: C, but for the last. */
  chunkLength(index: number): number {
    this.#check(index);
    return Math.min(this.chunkSize, this.length - index * this.chunkSize);
  }

  /** Chunk `index`'s stored bytes, its tag included. */
  chunkBytes(index: number): ByteRange {
    return this.range(index, index);
  }

  /** The stored bytes of chunks `first` to `last`, both included: a resume asks from the next whole chunk after the last one written. */
  range(first: number, last: number = this.chunkCount - 1): ByteRange {
    this.#check(first);
    this.#check(last);
    if (last < first) throw invalid('A range ends before it starts.');
    const stored = this.encrypted ? this.chunkSize + TAG_BYTES : this.chunkSize;
    const base = this.encrypted ? HEADER_BYTES : 0;
    return Object.freeze({ start: base + first * stored, end: Math.min(this.storedSize, base + (last + 1) * stored) });
  }

  /**
   * What the plaintext `[offset, offset + length)` needs, such as a bundle's
   * member: the chunks it's in, one run of stored bytes, and how many
   * plaintext bytes of the first chunk come before it. It never takes in a
   * chunk that's only padding.
   */
  span(offset: number, length: number): Span {
    if (!isLength(offset) || !isLength(length) || length < 1 || offset + length > this.length) {
      throw invalid("That run of bytes isn't in the object.");
    }
    const first = Math.floor(offset / this.chunkSize);
    const last = Math.floor((offset + length - 1) / this.chunkSize);
    return Object.freeze({ first, last, skip: offset - first * this.chunkSize, ...this.range(first, last) });
  }

  /**
   * Where chunk `index`'s plaintext comes from, given the files' sizes in
   * order: the parts of files it holds, then `padding` zero bytes.
   */
  chunkParts(index: number, fileSizes: readonly number[]): { parts: ChunkPart[]; padding: number } {
    const start = index * this.chunkSize;
    const end = start + this.chunkLength(index);
    const parts: ChunkPart[] = [];
    let fileStart = 0;
    for (let file = 0; file < fileSizes.length && fileStart < end; file++) {
      const fileEnd = fileStart + fileSizes[file];
      const from = Math.max(start, fileStart);
      const to = Math.min(end, fileEnd);
      if (to > from) parts.push(Object.freeze({ file, offset: from - fileStart, length: to - from }));
      fileStart = fileEnd;
    }
    const filled = parts.reduce((sum, part) => sum + part.length, 0);
    return { parts, padding: end - start - filled };
  }
}
