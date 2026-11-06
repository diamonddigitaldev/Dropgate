import type { CryptoProvider } from '../crypto/index.js';
import { DropgateError } from '../errors.js';
import { headerFields, parseHeader, SALT_BYTES } from './header.js';
import { deriveObjectKeys, SECRET_BYTES, type ObjectKeys } from './keys.js';
import { HEADER_BYTES, ObjectLayout, paddedLength, type Span } from './layout.js';
import { checkFiles, decodeManifest, encodeManifest, openMeta, sealMeta, type ManifestFile } from './manifest.js';
import { ChunkOpener, ChunkSealer, openChunks } from './stream.js';

// A DGUP 4 encrypted object, made for an upload and opened for a download.
// The server stores the header and chunks as the object, and the meta on its
// record, and never needs to understand either.

/** A file in an object, with where its bytes start in the plaintext. */
export interface ObjectFile extends ManifestFile {
  readonly offset: number;
}

const withOffsets = (files: readonly ManifestFile[]): ObjectFile[] => {
  let offset = 0;
  return files.map(({ name, size }) => {
    const file = Object.freeze({ name, size, offset });
    offset += size;
    return file;
  });
};

const hidden = '[DropgateObject]';

/**
 * A new object, ready to upload: its header and meta, sent at the start, and
 * its chunks, each sealed once. It holds the link's secret, which only
 * `secret()` gives; printed, logged or serialised, it shows nothing.
 */
export class ObjectWriter {
  readonly header: Uint8Array;
  readonly meta: Uint8Array;
  readonly layout: ObjectLayout;
  readonly files: readonly ObjectFile[];
  readonly #secret: Uint8Array;
  readonly #sealer: ChunkSealer;

  /** @internal Made by `createObject()`. */
  constructor(parts: { secret: Uint8Array; header: Uint8Array; meta: Uint8Array; layout: ObjectLayout; files: ObjectFile[]; sealer: ChunkSealer }) {
    this.#secret = parts.secret;
    this.#sealer = parts.sealer;
    this.header = parts.header;
    this.meta = parts.meta;
    this.layout = parts.layout;
    this.files = Object.freeze(parts.files);
    Object.freeze(this);
  }

  /** The link's secret: a copy, for the link alone. */
  secret(): Uint8Array {
    return this.#secret.slice();
  }

  /** Where chunk `index`'s plaintext comes from: parts of the files, then zero bytes. */
  chunkParts(index: number) {
    return this.layout.chunkParts(index, this.files.map((file) => file.size));
  }

  /** Seals chunk `index` from its plaintext, once only (see `ChunkSealer`). */
  seal(index: number, plaintext: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    return this.#sealer.seal(index, plaintext);
  }

  /** Chunk `index`'s sealed bytes, kept until `confirm(index)`, to send again unchanged. */
  kept(index: number): Uint8Array | undefined {
    return this.#sealer.kept(index);
  }

  /** The server has chunk `index`. */
  confirm(index: number): void {
    this.#sealer.confirm(index);
  }

  /** Whether chunk `index` has been sealed. */
  isSealed(index: number): boolean {
    return this.#sealer.isSealed(index);
  }

  toJSON(): string { return hidden; }
  toString(): string { return hidden; }
  [Symbol.for('nodejs.util.inspect.custom')](): string { return hidden; }
}

export interface CreateObjectOptions {
  files: readonly ManifestFile[];
  /** The server's chunk size, which the header records. */
  chunkSize: number;
  /** The server's limit on an upload's stored size in bytes, 0 for none: padding is clamped to it. */
  maxBytes?: number;
  /** The link's secret; a new random one if not given. */
  secret?: Uint8Array;
  /** The header's salt; a new random one if not given. */
  salt?: Uint8Array;
}

/**
 * A new encrypted object for `files`: its keys from the secret and a salt, its
 * header and MAC, its meta, and its Padmé length clamped to the limit.
 * @throws {DropgateError} FILE_TOO_LARGE if the files don't fit the limit,
 * before anything is sent; INVALID_FILENAME, FILE_EMPTY or INVALID_ARGUMENT
 * for a list of files that can't be sent.
 */
export async function createObject(provider: CryptoProvider, opts: CreateObjectOptions): Promise<ObjectWriter> {
  checkFiles(opts.files);
  const length = opts.files.reduce((sum, file) => sum + file.size, 0);
  const layout = ObjectLayout.encrypted(paddedLength(length, opts.chunkSize, opts.maxBytes ?? 0), opts.chunkSize);
  const manifest = encodeManifest(opts.files);
  const secret = opts.secret ? opts.secret.slice() : provider.randomBytes(SECRET_BYTES);
  const salt = opts.salt ? opts.salt.slice() : provider.randomBytes(SALT_BYTES);
  const fields = headerFields(opts.chunkSize, salt);
  const keys = await deriveObjectKeys(provider, secret, salt);
  const mac = await provider.hmacSha256(keys.header, fields);
  const header = new Uint8Array(HEADER_BYTES);
  header.set(fields);
  header.set(mac, fields.byteLength);
  return new ObjectWriter({
    secret,
    header,
    meta: await sealMeta(provider, keys.meta, manifest),
    layout,
    files: withOffsets(opts.files),
    sealer: new ChunkSealer(provider, keys.payload, layout),
  });
}

/** An object whose header and meta have been checked: its files, and its chunks to open. */
export class OpenedObject {
  readonly header: Uint8Array;
  readonly layout: ObjectLayout;
  readonly files: readonly ObjectFile[];
  /** The files' bytes added up: the plaintext before the padding. */
  readonly totalSize: number;
  readonly #provider: CryptoProvider;
  readonly #keys: ObjectKeys;

  /** @internal Made by `openObject()`. */
  constructor(provider: CryptoProvider, keys: ObjectKeys, header: Uint8Array, layout: ObjectLayout, files: ObjectFile[]) {
    this.#provider = provider;
    this.#keys = keys;
    this.header = header;
    this.layout = layout;
    this.files = Object.freeze(files);
    this.totalSize = files.reduce((sum, file) => sum + file.size, 0);
    Object.freeze(this);
  }

  /** What file `index` needs: its chunks, one run of stored bytes, and how much of the first chunk to skip. */
  member(index: number): Span {
    const file = this.files[index];
    if (!file) throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'No file has that index.' });
    return this.layout.span(file.offset, file.size);
  }

  /** An opener for chunks `first` to `last` (every chunk by default), in order. */
  opener(first = 0, last = this.layout.chunkCount - 1): ChunkOpener {
    return new ChunkOpener(this.#provider, this.#keys.payload, this.layout, first, last);
  }

  /**
   * Opens the stored bytes of chunks `first` to `last` (a member, or a resume
   * from the next whole chunk), giving each chunk's plaintext as it opens.
   */
  chunks(bytes: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, first = 0, last = this.layout.chunkCount - 1) {
    return openChunks(this.opener(first, last), bytes);
  }

  /**
   * Opens the whole stored object, header first, to the chunk marked last,
   * padding included, so nothing can have been cut off.
   * @throws {DropgateError} INTEGRITY_FAILED if its header isn't the one checked.
   */
  async *read(bytes: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): AsyncGenerator<{ index: number; plaintext: Uint8Array<ArrayBuffer> }> {
    const header = this.header;
    let seen = 0;
    async function* afterHeader() {
      for await (const piece of bytes) {
        const inHeader = Math.min(piece.byteLength, HEADER_BYTES - seen);
        for (let i = 0; i < inHeader; i++) {
          if (piece[i] !== header[seen + i]) {
            throw new DropgateError({ code: 'INTEGRITY_FAILED', message: "The object's header isn't the one its metadata gave." });
          }
        }
        seen += inHeader;
        if (inHeader < piece.byteLength) yield piece.subarray(inHeader);
      }
      if (seen < HEADER_BYTES) throw new DropgateError({ code: 'INTEGRITY_FAILED', message: 'The data ended before its last chunk.' });
    }
    yield* this.chunks(afterHeader());
  }

  toJSON(): string { return hidden; }
  toString(): string { return hidden; }
  [Symbol.for('nodejs.util.inspect.custom')](): string { return hidden; }
}

export interface OpenObjectOptions {
  /** The link's secret. */
  secret: Uint8Array;
  /** The header, from the object's metadata. */
  header: Uint8Array;
  /** The meta, from the object's metadata. */
  meta: Uint8Array;
  /** The stored object's size, from the object's metadata. */
  size: number;
}

/**
 * Checks an object's header and opens its meta, from its metadata, before
 * any content is asked for. The header's fields are checked before any key is
 * made. A header MAC that fails with a meta that doesn't open either is most
 * likely the wrong link; with a meta that opens, the header was changed.
 * @throws {DropgateError} VERSION_UNSUPPORTED for another version or suite;
 * DECRYPT_FAILED for the wrong secret; INTEGRITY_FAILED for a header, meta or
 * size that was changed, or files that don't fit the object; INVALID_FILENAME
 * for a name that breaks the rule.
 */
export async function openObject(provider: CryptoProvider, opts: OpenObjectOptions): Promise<OpenedObject> {
  const parsed = parseHeader(opts.header);
  if (opts.secret.byteLength !== SECRET_BYTES) throw new DropgateError({ code: 'DECRYPT_FAILED' });
  const keys = await deriveObjectKeys(provider, opts.secret, parsed.salt);
  const macMatches = await provider.verifyHmacSha256(keys.header, parsed.mac, parsed.signed);
  const manifest = await openMeta(provider, keys.meta, opts.meta).catch(() => undefined);
  if (!macMatches) {
    if (!manifest) throw new DropgateError({ code: 'DECRYPT_FAILED' });
    throw new DropgateError({ code: 'INTEGRITY_FAILED', message: "The object's header was changed." });
  }
  if (!manifest) throw new DropgateError({ code: 'INTEGRITY_FAILED', message: 'The list of files was changed.' });
  const files = withOffsets(decodeManifest(manifest));
  const layout = ObjectLayout.fromStoredSize(opts.size, parsed.chunkSize);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > layout.length) {
    throw new DropgateError({ code: 'INTEGRITY_FAILED', message: "The list of files doesn't fit the object." });
  }
  return new OpenedObject(provider, keys, opts.header.slice(), layout, files);
}
