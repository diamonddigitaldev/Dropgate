import { DropgateError } from '../errors.js';
import { HEADER_BYTES, MAX_CHUNK_SIZE, MIN_CHUNK_SIZE, isChunkSize } from './layout.js';

// An encrypted object's 60-byte header:
//
//   0   4  magic "DGUP"
//   4   1  version 04 (DGUP 4)
//   5   1  suite 01 (HKDF-SHA256, AES-256-GCM STREAM, HMAC-SHA256)
//   6   2  reserved, 00 00
//   8   4  chunk size C, unsigned big-endian
//   12 16  salt, random for each object
//   28 32  HMAC-SHA256(headerKey, bytes 0-27)

const MAGIC = [0x44, 0x47, 0x55, 0x50];
export const DGUP_VERSION = 4;
export const SUITE = 1;
export const SALT_BYTES = 16;
/** The bytes the MAC covers: everything before it. */
export const SIGNED_BYTES = 28;

/** A header read from its bytes, before its MAC is checked. */
export interface ObjectHeader {
  readonly chunkSize: number;
  readonly salt: Uint8Array;
  /** Bytes 0–27, which the MAC covers. */
  readonly signed: Uint8Array;
  readonly mac: Uint8Array;
}

const integrity = (message: string) => new DropgateError({ code: 'INTEGRITY_FAILED', message });

const unreadable = () => new DropgateError({
  code: 'VERSION_UNSUPPORTED',
  message: "This upload was made in a format this version of Dropgate can't read.",
});

/** Bytes 0–27 of a header: everything but its MAC. */
export function headerFields(chunkSize: number, salt: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!isChunkSize(chunkSize)) {
    throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'A chunk size is from 64 KiB to 64 MiB.' });
  }
  if (salt.byteLength !== SALT_BYTES) throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'A salt is 16 bytes.' });
  const fields = new Uint8Array(SIGNED_BYTES);
  fields.set(MAGIC, 0);
  fields[4] = DGUP_VERSION;
  fields[5] = SUITE;
  new DataView(fields.buffer).setUint32(8, chunkSize, false);
  fields.set(salt, 12);
  return fields;
}

/**
 * Reads a header, checking, in this order, its magic, version, suite, reserved
 * bytes and the chunk size's bounds, before any key is made from it. Its MAC
 * is checked once the keys are made.
 * @throws {DropgateError} VERSION_UNSUPPORTED for another version or suite;
 * INTEGRITY_FAILED for anything else that's wrong.
 */
export function parseHeader(bytes: Uint8Array): ObjectHeader {
  if (bytes.byteLength !== HEADER_BYTES) throw integrity("The object's header isn't 60 bytes.");
  if (MAGIC.some((byte, i) => bytes[i] !== byte)) throw integrity("This isn't a Dropgate object.");
  if (bytes[4] !== DGUP_VERSION) throw unreadable();
  if (bytes[5] !== SUITE) throw unreadable();
  if (bytes[6] !== 0 || bytes[7] !== 0) throw integrity("The object's header has reserved bytes set.");
  const chunkSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, false);
  if (chunkSize < MIN_CHUNK_SIZE || chunkSize > MAX_CHUNK_SIZE) throw integrity("The object's chunk size is out of range.");
  return Object.freeze({
    chunkSize,
    salt: bytes.slice(12, 12 + SALT_BYTES),
    signed: bytes.slice(0, SIGNED_BYTES),
    mac: bytes.slice(SIGNED_BYTES, HEADER_BYTES),
  });
}
