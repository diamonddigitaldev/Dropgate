import { blobSource, fileHandleSource } from './source.js';
import { lifetimeToMs } from './utils/lifetime.js';
import { estimateUploadBytes } from './utils/size.js';
import { validateFilename, sanitizeFilename, uniqueFilename } from './utils/filename.js';
import { generateP2PCode, isP2PCodeLike, isLocalhostHostname, isSecureContextForP2P } from './p2p/utils.js';
import { StreamingZipWriter } from './zip/stream-zip.js';

// Core's standalone helpers, grouped by what they're for, as the client's
// calls are (`client.hosted.upload()`), so each is `group.name()`.

/** File sources: what an upload reads its files from. */
export const sources = Object.freeze({
  /** A FileSource that reads a browser `File` or `Blob`. A Blob with no name is called `file`. */
  blob: blobSource,
  /**
   * A FileSource that reads an open Node.js file handle. Its size is the file's
   * size now; closing the handle once the upload has ended is the caller's job.
   */
  fileHandle: fileHandleSource,
});

/** Upload lifetimes. */
export const lifetime = Object.freeze({
  /** A lifetime in a unit (`minutes`, `hours`, `days`, or `unlimited`) in milliseconds, or 0 for unlimited or anything invalid. */
  toMs: lifetimeToMs,
});

/** Sizes. */
export const sizes = Object.freeze({
  /** How many bytes an upload of a file sends: its size, plus each chunk's encryption overhead if it's encrypted. */
  estimateUpload: estimateUploadBytes,
});

/** File names: one rule, for hosted uploads and direct transfers alike. */
export const filenames = Object.freeze({
  /**
   * Checks a file name before it's sent, encrypted or not; core checks every
   * name it sends and receives this way.
   * @throws {DropgateError} INVALID_FILENAME if it's empty, over 255 UTF-8
   * bytes, or has a control character or path separator in it.
   */
  validate: (name: string): void => validateFilename(name),
  /**
   * The name to save a received file under, the same on every OS: NFC, bidi
   * and zero-width characters shown as `[U+XXXX]`, `< > : " / \ | ? *` and
   * control characters as `_`, no trailing dots or spaces, `_` before a
   * Windows reserved name (`CON.txt`), within 255 UTF-8 bytes, never empty.
   */
  sanitize: sanitizeFilename,
  /**
   * The name itself if it isn't taken, or else `name (1).ext`, `name (2).ext`
   * and so on. `taken` is the names already used (compared without regard to
   * case) or a function that says whether a name is.
   */
  unique: uniqueFilename,
});

/** Direct transfer codes, such as `ABCD-1234`. */
export const codes = Object.freeze({
  /**
   * A new random code, from secure random numbers only.
   * @throws {DropgateError} RUNTIME_UNSUPPORTED if there are none here (no `crypto.getRandomValues()`).
   */
  generate: (): string => generateP2PCode(),
  /** Whether a value is shaped like a code. */
  isLike: isP2PCodeLike,
});

/** Where a page or app is running. */
export const hosts = Object.freeze({
  /** Whether a hostname is this machine (`localhost`, `127.0.0.1` or `::1`, also as `[::1]`). */
  isLocalhost: isLocalhostHostname,
  /** Whether a direct transfer can run here: a secure context, or this machine. */
  isSecureForDirect: isSecureContextForP2P,
});

/** ZIP archives, written as they stream. */
export const zip = Object.freeze({
  /**
   * A ZIP writer that gives the archive's bytes to `onData` as they're
   * written: `startFile(name, size)`, `writeChunk(bytes)`, `endFile()`, then
   * `finalize()`. Each member's name is made safe and unique, and its bytes
   * must come to exactly its size. ZIP64 only where the archive needs it.
   * Await `drained()` to let a slow `onData` keep up.
   */
  writer: (onData: (chunk: Uint8Array) => void | Promise<void>) => new StreamingZipWriter(onData),
});
