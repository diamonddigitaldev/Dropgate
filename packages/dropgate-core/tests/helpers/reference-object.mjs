// A second implementation of DGUP 4's encrypted object, on node:crypto, written
// from the format below rather than from core's src/object/. Core's tests check
// that both make the same bytes, and the pinned vectors in
// tests/fixtures/dgup4-object-vectors.json came from this file. The server's
// tests build their test objects the same way.
//
//   object = header (60 bytes) || chunk 0 || ... || chunk n-1
//   header = "DGUP" || 04 || 01 || 00 00 || C (u32 BE) || salt (16) || HMAC-SHA256(headerKey, bytes 0-27)
//   keys   = HKDF-SHA256(IKM = secret, salt, info "dropgate/4 header" | "dropgate/4 payload" | "dropgate/4 meta"), 32 bytes each
//   chunk  = AES-256-GCM(payloadKey, nonce = index (11 bytes BE) || last flag, padded plaintext[i*C, (i+1)*C))
//   meta   = nonce (12) || AES-256-GCM(metaKey, nonce, u32 BE length || {"files":[{"name","size"}]} || zeros to a bucket)

import { createCipheriv, createHmac, hkdfSync } from 'node:crypto';

const HEADER = 60;
const TAG = 16;

/** Padmé: L rounded up to a multiple of 2^(E - S), E = floor(log2 L), S = floor(log2 E) + 1. */
export function padme(length) {
  if (length < 2) return length;
  const e = Math.floor(Math.log2(length));
  const s = Math.floor(Math.log2(e)) + 1;
  const step = 2 ** (e - s);
  return Math.ceil(length / step) * step;
}

/** The stored size of an encrypted object holding `padded` plaintext bytes. */
export const storedSize = (padded, chunkSize) => HEADER + padded + TAG * Math.ceil(padded / chunkSize);

/** Padmé, clamped so the stored object fits `maxBytes` (0: no limit): the largest P >= L whose stored size fits. */
export function paddedLength(length, chunkSize, maxBytes) {
  let padded = padme(length);
  if (!maxBytes) return padded;
  if (storedSize(length, chunkSize) > maxBytes) throw new Error('too large');
  while (storedSize(padded, chunkSize) > maxBytes) padded -= 1;
  return padded;
}

export const keyInfo = { header: 'dropgate/4 header', payload: 'dropgate/4 payload', meta: 'dropgate/4 meta' };

export function deriveKeys(secret, salt) {
  const key = (info) => Buffer.from(hkdfSync('sha256', secret, salt, Buffer.from(info, 'utf8'), 32));
  return { header: key(keyInfo.header), payload: key(keyInfo.payload), meta: key(keyInfo.meta) };
}

export function chunkNonce(index, last) {
  const nonce = Buffer.alloc(12);
  nonce.writeUIntBE(index, 5, 6); // indices fit 48 bits; bytes 0-4 stay zero
  nonce[11] = last ? 1 : 0;
  return nonce;
}

export function gcm(key, nonce, plaintext) {
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

/** The manifest padded to its bucket: 4 KiB, doubling to 1 MiB. */
export function paddedManifest(files) {
  const json = Buffer.from(JSON.stringify({ files: files.map(({ name, size }) => ({ name, size })) }), 'utf8');
  let bucket = 4096;
  while (bucket < 4 + json.length) bucket *= 2;
  if (bucket > 1024 * 1024) throw new Error('manifest over 1 MiB');
  const out = Buffer.alloc(bucket);
  out.writeUInt32BE(json.length, 0);
  json.copy(out, 4);
  return out;
}

/**
 * The whole object. `files` are `{ name, bytes }`; `secret` (32 bytes), `salt`
 * (16) and `metaNonce` (12) are given, so the result is fixed.
 */
export function buildObject({ secret, salt, chunkSize, files, maxBytes = 0, metaNonce }) {
  const keys = deriveKeys(secret, salt);
  const fields = Buffer.alloc(28);
  Buffer.from('DGUP', 'ascii').copy(fields, 0);
  fields[4] = 4;
  fields[5] = 1;
  fields.writeUInt32BE(chunkSize, 8);
  Buffer.from(salt).copy(fields, 12);
  const header = Buffer.concat([fields, createHmac('sha256', keys.header).update(fields).digest()]);

  const length = files.reduce((sum, file) => sum + file.bytes.length, 0);
  const padded = paddedLength(length, chunkSize, maxBytes);
  const plaintext = Buffer.alloc(padded);
  let at = 0;
  for (const file of files) { Buffer.from(file.bytes).copy(plaintext, at); at += file.bytes.length; }

  const count = Math.ceil(padded / chunkSize);
  const chunks = [];
  for (let i = 0; i < count; i++) {
    chunks.push(gcm(keys.payload, chunkNonce(i, i === count - 1), plaintext.subarray(i * chunkSize, Math.min(padded, (i + 1) * chunkSize))));
  }
  const manifest = paddedManifest(files.map((file) => ({ name: file.name, size: file.bytes.length })));
  const meta = Buffer.concat([Buffer.from(metaNonce), gcm(keys.meta, Buffer.from(metaNonce), manifest)]);
  const object = Buffer.concat([header, ...chunks]);
  return { keys, header, chunks, meta, object, padded };
}

/** Byte j of vector file k: (7j + 13k + 1) mod 256. */
export function vectorFileBytes(index, size) {
  const bytes = Buffer.alloc(size);
  for (let j = 0; j < size; j++) bytes[j] = (7 * j + 13 * index + 1) & 0xff;
  return bytes;
}
