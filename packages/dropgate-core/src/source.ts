import { DropgateError } from './errors.js';

/**
 * A file to upload, read in bounded pieces: core asks for one range of bytes
 * at a time, and never holds more of the file than that. Reads can come in
 * any order and more than once, so a source must be able to seek; a stream
 * that can only be read once isn't a source, and core never spools one to disk.
 *
 * A browser `File` or `Blob` is turned into one by core (`blobSource()`), and a
 * Node.js file handle by `fileHandleSource()`. Anything else implements it.
 */
export interface FileSource {
  /** The file's name. It's encrypted with the upload, or sent as it is to a server without encryption. */
  readonly name: string;
  /** The file's size in bytes. It must not change while the file is read. */
  readonly size: number;
  /** The file's media type, if known. */
  readonly type?: string;
  /** Reads bytes `start` to `end` (not including `end`). It must give exactly `end - start` bytes. */
  read(start: number, end: number): Promise<Uint8Array>;
}

/** A browser `File` or `Blob`, or anything shaped like one. */
export interface BlobLike {
  readonly size: number;
  readonly type?: string;
  readonly name?: string;
  slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

/** What an upload takes as a file: a FileSource, or a browser `File` or `Blob`. */
export type UploadSource = FileSource | BlobLike;

/**
 * A Node.js `FileHandle` (from `fs/promises`' `open()`), or anything with its
 * `stat()` and positional `read()`.
 */
export interface FileHandleLike {
  stat(): Promise<{ size: number; mtimeMs?: number }>;
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
}

/** A FileSource that reads a browser `File` or `Blob`. A Blob with no name is called `file`. */
export function blobSource(blob: BlobLike, name?: string): FileSource {
  return {
    name: name ?? blob.name ?? 'file',
    size: blob.size,
    ...(blob.type ? { type: blob.type } : {}),
    async read(start, end) {
      return new Uint8Array(await blob.slice(start, end).arrayBuffer());
    },
  };
}

/** The error for a file that changed after it was chosen, as a browser's File gives one too. */
const fileChanged = () => new DropgateError({
  code: 'SOURCE_UNAVAILABLE',
  message: "A file changed after the upload started, so the rest of it can't be read as it was.",
});

/**
 * A FileSource that reads an open Node.js file handle. Its size is the file's
 * size now; closing the handle once the upload has ended is the caller's job.
 * Like a browser's File, it can't be read once the file changes: each read
 * checks the file's size and modification time are still what they were when
 * it was opened, and fails SOURCE_UNAVAILABLE if not. So a file edited while
 * its upload is paused is never sent part old, part new.
 */
export async function fileHandleSource(handle: FileHandleLike, opts: { name: string; type?: string }): Promise<FileSource> {
  const { size, mtimeMs } = await handle.stat();
  return {
    name: opts.name,
    size,
    ...(opts.type ? { type: opts.type } : {}),
    async read(start, end) {
      const now = await handle.stat();
      if (now.size !== size || now.mtimeMs !== mtimeMs) throw fileChanged();
      const buffer = new Uint8Array(end - start);
      let filled = 0;
      while (filled < buffer.length) {
        const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, start + filled);
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      return filled === buffer.length ? buffer : buffer.subarray(0, filled);
    },
  };
}

const isFileSource = (value: unknown): value is FileSource =>
  typeof value === 'object' && value !== null
  && typeof (value as FileSource).read === 'function'
  && typeof (value as FileSource).name === 'string'
  && Number.isFinite((value as FileSource).size);

const isBlobLike = (value: unknown): value is BlobLike =>
  typeof value === 'object' && value !== null
  && typeof (value as BlobLike).slice === 'function'
  && Number.isFinite((value as BlobLike).size);

/**
 * Turns what an upload was given into FileSources.
 * @throws {DropgateError} INVALID_ARGUMENT for anything that's neither a FileSource nor a Blob.
 */
export function toFileSources(input: UploadSource | UploadSource[]): FileSource[] {
  const list = Array.isArray(input) ? input : [input];
  return list.map((item, index) => {
    if (isFileSource(item)) return item;
    if (isBlobLike(item)) return blobSource(item);
    throw new DropgateError({ code: 'INVALID_ARGUMENT', message: `File at index ${index} is missing or invalid.`, details: { index } });
  });
}

/**
 * Reads one bounded range of a source.
 * @throws {DropgateError} SOURCE_UNAVAILABLE if the read fails or gives a different number of bytes.
 */
export async function readRange(source: FileSource, start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
  let bytes: Uint8Array;
  try {
    bytes = await source.read(start, end);
  } catch (err) {
    if (DropgateError.is(err, 'SOURCE_UNAVAILABLE')) throw err;
    throw new DropgateError({ code: 'SOURCE_UNAVAILABLE', cause: err });
  }
  if (!ArrayBuffer.isView(bytes) || bytes.byteLength !== end - start) {
    throw new DropgateError({
      code: 'SOURCE_UNAVAILABLE',
      message: "A file gave a different number of bytes than asked for. It may have changed while it was read.",
    });
  }
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // A view of a SharedArrayBuffer, or of another realm's buffer, is copied.
  return view.buffer instanceof ArrayBuffer ? (view as Uint8Array<ArrayBuffer>) : new Uint8Array(view);
}
