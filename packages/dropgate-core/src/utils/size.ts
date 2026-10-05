import { DEFAULT_CHUNK_SIZE, ENCRYPTION_OVERHEAD_PER_CHUNK } from '../constants.js';

// One size rule: every conversion between bytes and KB, MB or GB is in 1024s
// (a KB is 1024 bytes), as the labels KB, MB and GB are shown.

/** Bytes in a KB, MB and GB. */
export const BYTES_PER = Object.freeze({ KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 });

/** A size in MB, such as a server's `maxSizeMB`, in bytes. */
export function mbToBytes(mb: number): number {
  return mb * BYTES_PER.MB;
}

/**
 * How many bytes an upload of a file sends: its size, plus each chunk's
 * encryption overhead if it's encrypted.
 * @param sizeBytes - The file's size in bytes.
 * @param opts.encrypted - Whether the upload is encrypted.
 * @param opts.chunkSize - The server's chunk size in bytes (default: 5 MB, the server's default).
 */
export function estimateUploadBytes(sizeBytes: number, opts: { encrypted: boolean; chunkSize?: number }): number {
  const base = Number(sizeBytes) || 0;
  if (!opts.encrypted || base <= 0) return base;
  const chunkSize = Number.isFinite(opts.chunkSize) && opts.chunkSize! > 0 ? opts.chunkSize! : DEFAULT_CHUNK_SIZE;
  return base + Math.ceil(base / chunkSize) * ENCRYPTION_OVERHEAD_PER_CHUNK;
}

/**
 * How many bytes of a file its encrypted upload holds on the server, from the
 * number of bytes the server stored: each chunk's overhead taken off.
 */
export function plaintextBytes(storedBytes: number, chunkSize: number): number {
  if (!(storedBytes > 0)) return 0;
  const chunks = Math.ceil(storedBytes / (chunkSize + ENCRYPTION_OVERHEAD_PER_CHUNK));
  return storedBytes - chunks * ENCRYPTION_OVERHEAD_PER_CHUNK;
}
