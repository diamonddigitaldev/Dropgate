import { AES_GCM_IV_BYTES } from '../constants.js';
import type { ContentKey, CryptoProvider } from '../crypto/index.js';
import { DropgateError } from '../errors.js';
import { validateFilename } from '../utils/filename.js';

// An object's list of files, the manifest: UTF-8 JSON, {"files":[{"name","size"}]}
// in order. Encrypted, it's sealed apart from the object as the meta, padded
// first to a bucket so its size says as little as possible: a 4-byte
// big-endian length, the JSON, then zero bytes up to the smallest of 4 KiB,
// 8 KiB, ... 1 MiB that holds it. The meta is a random 12-byte nonce, then the
// padded manifest under the meta key with AES-256-GCM.

/** The most files one upload holds. */
export const MAX_FILES = 1000;
/** The smallest bucket a manifest is padded to. */
export const MIN_BUCKET = 4 * 1024;
/** The largest; a manifest that doesn't fit it is refused. */
export const MAX_BUCKET = 1024 * 1024;

/** A file in the manifest. */
export interface ManifestFile {
  readonly name: string;
  readonly size: number;
}

const LENGTH_BYTES = 4;

/**
 * The bucket a padded manifest of `length` bytes (its length prefix included)
 * fills.
 * @throws {DropgateError} INVALID_ARGUMENT if it's over 1 MiB.
 */
export function bucketFor(length: number): number {
  let bucket = MIN_BUCKET;
  while (bucket < length) bucket *= 2;
  if (bucket > MAX_BUCKET) {
    throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'The list of files is over 1 MiB.' });
  }
  return bucket;
}

/** Checks a list of files to send: 1 to 1,000 of them, each name by the one rule, each size a whole number of bytes from 1. */
export function checkFiles(files: readonly ManifestFile[]): void {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) {
    throw new DropgateError({ code: 'INVALID_ARGUMENT', message: `An upload holds 1 to ${MAX_FILES} files.` });
  }
  files.forEach((file, index) => {
    validateFilename(file?.name, { index });
    if (file.size === 0) throw new DropgateError({ code: 'FILE_EMPTY', details: { index } });
    if (!Number.isSafeInteger(file.size) || file.size < 1) {
      throw new DropgateError({ code: 'INVALID_ARGUMENT', message: "A file's size is a whole number of bytes.", details: { index } });
    }
  });
}

/** The manifest of `files`, padded to its bucket. */
export function encodeManifest(files: readonly ManifestFile[]): Uint8Array<ArrayBuffer> {
  checkFiles(files);
  const json = new TextEncoder().encode(JSON.stringify({ files: files.map(({ name, size }) => ({ name, size })) }));
  const padded = new Uint8Array(bucketFor(LENGTH_BYTES + json.byteLength));
  new DataView(padded.buffer).setUint32(0, json.byteLength, false);
  padded.set(json, LENGTH_BYTES);
  return padded;
}

const broken = (message: string) => new DropgateError({ code: 'INTEGRITY_FAILED', message });

/**
 * The files in a padded manifest. Unknown fields are ignored, so a later 4.x
 * can add some.
 * @throws {DropgateError} INTEGRITY_FAILED if it doesn't parse or isn't a list
 * of 1 to 1,000 files with sizes; INVALID_FILENAME for a name that breaks the rule.
 */
export function decodeManifest(padded: Uint8Array): ManifestFile[] {
  if (padded.byteLength < LENGTH_BYTES) throw broken("The list of files didn't parse.");
  const length = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint32(0, false);
  if (length > padded.byteLength - LENGTH_BYTES) throw broken("The list of files didn't parse.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(padded.subarray(LENGTH_BYTES, LENGTH_BYTES + length)));
  } catch {
    throw broken("The list of files didn't parse.");
  }
  const files = (parsed as { files?: unknown } | null)?.files;
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) throw broken("The list of files didn't parse.");
  return files.map((file: unknown, index) => {
    const { name, size } = (file ?? {}) as { name?: unknown; size?: unknown };
    if (typeof name !== 'string' || typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1) {
      throw broken("The list of files didn't parse.");
    }
    validateFilename(name, { index, origin: 'server' });
    return Object.freeze({ name, size });
  });
}

/** Seals a padded manifest as the meta: a random nonce, then the manifest under the meta key. */
export async function sealMeta(provider: CryptoProvider, metaKey: ContentKey, padded: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const nonce = provider.randomBytes(AES_GCM_IV_BYTES);
  const sealed = await provider.encryptWithNonce(metaKey, nonce, padded);
  const meta = new Uint8Array(nonce.byteLength + sealed.byteLength);
  meta.set(nonce);
  meta.set(sealed, nonce.byteLength);
  return meta;
}

/** Opens a meta; rejects if it was changed or the key is wrong. */
export async function openMeta(provider: CryptoProvider, metaKey: ContentKey, meta: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  if (meta.byteLength < AES_GCM_IV_BYTES) throw broken("The list of files didn't parse.");
  return provider.decryptWithNonce(metaKey, meta.subarray(0, AES_GCM_IV_BYTES), meta.subarray(AES_GCM_IV_BYTES));
}
