import { blobSource, fileHandleSource } from './source.js';
import { lifetimeToMs } from './utils/lifetime.js';
import { estimateUploadBytes } from './utils/size.js';
import { validatePlainFilename } from './utils/filename.js';
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

/** File names. */
export const filenames = Object.freeze({
  /**
   * Checks a file name that will be sent to the server as it is (an
   * unencrypted upload's).
   * @throws {DropgateError} INVALID_FILENAME if it's empty, too long, or has a path in it.
   */
  validate: validatePlainFilename,
});

/** Direct transfer codes, such as `ABCD-1234`. */
export const codes = Object.freeze({
  /** A new random code. */
  generate: generateP2PCode,
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
   * written: `startFile(name)`, `writeChunk(bytes)`, `endFile()`, then
   * `finalize()`. Await `drained()` to let a slow `onData` keep up.
   */
  writer: (onData: (chunk: Uint8Array) => void | Promise<void>) => new StreamingZipWriter(onData),
});
