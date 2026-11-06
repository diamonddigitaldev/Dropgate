import { DEFAULT_CHUNK_SIZE } from '../constants.js';
import { encryptedSize, isChunkSize, paddedLength } from '../object/layout.js';

// One size rule: every conversion between bytes and KB, MB or GB is in 1024s
// (a KB is 1024 bytes), as the labels KB, MB and GB are shown.

/** Bytes in a KB, MB and GB. */
export const BYTES_PER = Object.freeze({ KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 });

/** A size in MB, such as a server's `maxSizeMB`, in bytes. */
export function mbToBytes(mb: number): number {
  return mb * BYTES_PER.MB;
}

/**
 * How many bytes the server stores for an upload, the number its maximum
 * upload size is checked against: the files' size unencrypted; and encrypted,
 * Dropgate 4's object, with its header, its padding and each chunk's tag. An
 * upload of several files is one object, so give their sizes added up. Padding is clamped to `maxBytes`, so it never makes a file too
 * large: the result is over `maxBytes` only when the file itself doesn't fit.
 * @param sizeBytes - The file's size in bytes, or several files' added up.
 * @param opts.encrypted - Whether the upload is encrypted.
 * @param opts.chunkSize - The server's chunk size in bytes (default: 5 MB, the server's default).
 * @param opts.maxBytes - The server's maximum upload size in bytes, 0 or left out for none.
 */
export function estimateUploadBytes(sizeBytes: number, opts: { encrypted: boolean; chunkSize?: number; maxBytes?: number }): number {
  const base = Number(sizeBytes) || 0;
  if (!opts.encrypted || base <= 0 || !Number.isSafeInteger(base)) return base;
  const chunkSize = isChunkSize(Number(opts.chunkSize)) ? Number(opts.chunkSize) : DEFAULT_CHUNK_SIZE;
  const maxBytes = Number(opts.maxBytes) > 0 ? Number(opts.maxBytes) : 0;
  try {
    return encryptedSize(paddedLength(base, chunkSize, maxBytes), chunkSize);
  } catch {
    // Too large even unpadded: that's what it would need.
    return encryptedSize(base, chunkSize);
  }
}
