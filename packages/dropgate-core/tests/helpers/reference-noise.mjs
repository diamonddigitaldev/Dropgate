// A second implementation of DGDTP 4's Noise, Noise_NNpsk0_25519_AESGCM_SHA256,
// on node:crypto, written from the Noise Protocol Framework (revision 34) and
// Dropgate's rules for it, summed up below, rather than from core's
// src/dgdtp/noise.ts. Core's
// tests check that both make the same bytes: cacophony's published vector for
// this name (which this file passes too, tests/noise.test.ts), and the rekey
// vectors in tests/fixtures/noise-rekey-vectors.json, which came from this file
// (`node tests/helpers/reference-noise.mjs` writes them again).
//
//   protocol  "Noise_NNpsk0_25519_AESGCM_SHA256" is 32 bytes, so h = the name, and ck = h
//   start     h = SHA-256(h || prologue)
//   message 1 (initiator: the receiver)  -> psk, e
//               psk:  ck, t, k = HKDF(ck, psk, 3); h = SHA-256(h || t); n = 0
//               e:    h = SHA-256(h || e.pub); ck, k = HKDF(ck, e.pub, 2); n = 0  (psk mode mixes e as a key too)
//               then  c = AEAD(k, n++, h, payload); h = SHA-256(h || c)
//   message 2 (responder: the sender)    <- e, ee
//               e:    as above;  ee: ck, k = HKDF(ck, X25519(e, re), 2); n = 0
//               then  the payload as above
//   split     k1, k2 = HKDF(ck, "", 2): k1 initiator to responder, k2 back; h is the handshake hash
//   HKDF      t = HMAC(ck, ikm); o1 = HMAC(t, 01); o2 = HMAC(t, o1 || 02); o3 = HMAC(t, o2 || 03)
//   AEAD      AES-256-GCM, nonce = 4 zero bytes || n (64 bits, big-endian), 16-byte tag after the ciphertext
//   transport no associated data; after every `rekeyEvery` records in one direction (65,536 in Dropgate),
//             k = first 32 bytes of AEAD(k, 2^64 - 1, "", 32 zero bytes), and n carries on, never reset

import { createCipheriv, createDecipheriv, createHash, createHmac, createPrivateKey, createPublicKey, diffieHellman } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PROTOCOL_NAME = 'Noise_NNpsk0_25519_AESGCM_SHA256';
export const DROPGATE_REKEY_EVERY = 65536n;
const MAX_NONCE = 2n ** 64n - 1n;

const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts)).digest();
const hmac = (key, ...parts) => createHmac('sha256', key).update(Buffer.concat(parts)).digest();

function hkdf(ck, ikm, outputs) {
  const t = hmac(ck, ikm);
  const out = [hmac(t, Buffer.of(1))];
  for (let i = 2; i <= outputs; i++) out.push(hmac(t, out[i - 2], Buffer.of(i)));
  return out;
}

function nonce(n) {
  const iv = Buffer.alloc(12);
  iv.writeBigUInt64BE(n, 4);
  return iv;
}

function seal(k, n, ad, plaintext) {
  const cipher = createCipheriv('aes-256-gcm', k, nonce(n));
  cipher.setAAD(ad);
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

function open(k, n, ad, sealed) {
  const decipher = createDecipheriv('aes-256-gcm', k, nonce(n));
  decipher.setAAD(ad);
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
}

/** Noise's REKEY for AESGCM: the first 32 bytes of 32 zeros sealed under the reserved nonce. */
export const rekey = (k) => seal(k, MAX_NONCE, Buffer.alloc(0), Buffer.alloc(32)).subarray(0, 32);

const PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI = Buffer.from('302a300506032b656e032100', 'hex');
const privateKey = (scalar) => createPrivateKey({ key: Buffer.concat([PKCS8, scalar]), format: 'der', type: 'pkcs8' });
const publicOf = (scalar) => createPublicKey(privateKey(scalar)).export({ format: 'der', type: 'spki' }).subarray(SPKI.length);
const dh = (scalar, u) => diffieHellman({
  privateKey: privateKey(scalar),
  publicKey: createPublicKey({ key: Buffer.concat([SPKI, u]), format: 'der', type: 'spki' }),
});

/**
 * Both handshake messages and the transport keys, from fixed inputs (hex or
 * Buffers): `{ message1, message2, payload1, payload2, handshakeHash, k1, k2 }`.
 * Each side's payload is opened by the other, so a fault shows as a throw.
 */
export function handshake({ prologue, psk, initEphemeral, respEphemeral, payload1 = '', payload2 = '' }) {
  const b = (value) => (Buffer.isBuffer(value) ? value : Buffer.from(value, 'hex'));
  const name = Buffer.from(PROTOCOL_NAME, 'ascii');
  if (name.length !== 32) throw new Error('the name is 32 bytes');

  // Both sides start the same, and stay the same until each message is
  // processed, so one transcript (h, ck, k, n) stands for both, each message
  // written by one side and checked by the other.
  let h = sha256(name, b(prologue));
  let ck = name;
  let k;
  let n;
  const mixHash = (data) => { h = sha256(h, data); };
  const mixKey = (ikm) => { [ck, k] = hkdf(ck, ikm, 2); n = 0n; };

  // -> psk, e
  let t;
  [ck, t, k] = hkdf(ck, b(psk), 3);
  n = 0n;
  mixHash(t);
  const ei = publicOf(b(initEphemeral));
  mixHash(ei);
  mixKey(ei);
  const c1 = seal(k, n, h, b(payload1));
  if (!open(k, n, h, c1).equals(b(payload1))) throw new Error('message 1 opens');
  n += 1n;
  mixHash(c1);
  const message1 = Buffer.concat([ei, c1]);

  // <- e, ee
  const er = publicOf(b(respEphemeral));
  mixHash(er);
  mixKey(er);
  const shared = dh(b(respEphemeral), ei);
  if (!shared.equals(dh(b(initEphemeral), er))) throw new Error('ee agrees');
  mixKey(shared);
  const c2 = seal(k, n, h, b(payload2));
  if (!open(k, n, h, c2).equals(b(payload2))) throw new Error('message 2 opens');
  n += 1n;
  mixHash(c2);
  const message2 = Buffer.concat([er, c2]);

  const [k1, k2] = hkdf(ck, Buffer.alloc(0), 2);
  return { message1, message2, handshakeHash: h, k1, k2 };
}

/**
 * One direction of transport: a sender of records under `k`, rekeying after
 * every `rekeyEvery` records, with the key it holds before each record.
 */
export function transport(k, rekeyEvery = DROPGATE_REKEY_EVERY) {
  let key = Buffer.from(k);
  let n = 0n;
  return {
    get n() { return n; },
    get key() { return key; },
    seal(plaintext) {
      if (n >= MAX_NONCE) throw new Error('nonce exhausted');
      const record = seal(key, n, Buffer.alloc(0), plaintext);
      n += 1n;
      if (n % rekeyEvery === 0n) key = rekey(key);
      return record;
    },
    open(record) {
      if (n >= MAX_NONCE) throw new Error('nonce exhausted');
      const plaintext = open(key, n, Buffer.alloc(0), record);
      n += 1n;
      if (n % rekeyEvery === 0n) key = rekey(key);
      return plaintext;
    },
  };
}

/** Record `i`'s plaintext in direction `d` (1 initiator to responder, 2 back): `d`, then `i` as 8 bytes big-endian. */
export function recordPlaintext(d, i) {
  const out = Buffer.alloc(9);
  out[0] = d;
  out.writeBigUInt64BE(BigInt(i), 1);
  return out;
}

/** The fixed inputs of every rekey run: a 131-byte prologue, as DGDTP's is, a PSK and both ephemerals. */
export const REKEY_INPUTS = Object.freeze({
  prologue: Buffer.concat([Buffer.from('dropgate/4 noise rekey vector', 'ascii'), Buffer.alloc(102, 0xa5)]).toString('hex'),
  psk: sha256(Buffer.from('dropgate/4 noise rekey vector psk', 'ascii')).toString('hex'),
  initEphemeral: sha256(Buffer.from('dropgate/4 noise rekey vector initiator ephemeral', 'ascii')).toString('hex'),
  respEphemeral: sha256(Buffer.from('dropgate/4 noise rekey vector responder ephemeral', 'ascii')).toString('hex'),
});

/**
 * One rekey run: the handshake from REKEY_INPUTS, then `records` records each
 * way, rekeying after every `rekeyEvery`. Each direction has the key before
 * its first record and after each rekey (`afterRecords`: how many records
 * came before it), the SHA-256 of all its records one after another, and the
 * records named in `keep` (all of them if `keep` is 'all').
 */
export function rekeyRun({ name, rekeyEvery, records, keep }) {
  const hs = handshake(REKEY_INPUTS);
  const direction = (d, k) => {
    const sender = transport(k, BigInt(rekeyEvery));
    const receiver = transport(k, BigInt(rekeyEvery));
    const keys = [{ afterRecords: 0, k: sender.key.toString('hex') }];
    const digest = createHash('sha256');
    const kept = {};
    for (let i = 0; i < records; i++) {
      const plaintext = recordPlaintext(d, i);
      const record = sender.seal(plaintext);
      if (!receiver.open(record).equals(plaintext)) throw new Error(`record ${i} opens`);
      digest.update(record);
      if (keep === 'all' || keep.includes(i)) kept[i] = record.toString('hex');
      if ((i + 1) % rekeyEvery === 0) keys.push({ afterRecords: i + 1, k: sender.key.toString('hex') });
    }
    return { keys, sha256OfRecords: digest.digest('hex'), records: kept };
  };
  return {
    name,
    rekeyEvery,
    records,
    handshakeHash: hs.handshakeHash.toString('hex'),
    message1: hs.message1.toString('hex'),
    message2: hs.message2.toString('hex'),
    initiatorToResponder: direction(1, hs.k1),
    responderToInitiator: direction(2, hs.k2),
  };
}

/** The pinned rekey vectors, as tests/fixtures/noise-rekey-vectors.json holds them. */
export function rekeyVectors() {
  return {
    about: 'Rekey vectors for Noise_NNpsk0_25519_AESGCM_SHA256 as DGDTP 4 uses it: Rekey() after every rekeyEvery records in '
      + 'each direction (65,536 in Dropgate; lower only in a test build), the nonce never reset. Made by '
      + 'tests/helpers/reference-noise.mjs, a second implementation on node:crypto written from the Noise Protocol Framework '
      + "(revision 34) and Dropgate's rules for it, not from core. Handshake payloads are empty; record i in direction d (1 initiator "
      + 'to responder, 2 back) is the byte d then i as 8 bytes big-endian. keys[].k is the key a direction holds after '
      + 'afterRecords records (0: the key Split() gives).',
    protocol: PROTOCOL_NAME,
    inputs: { ...REKEY_INPUTS },
    runs: [
      rekeyRun({ name: "Dropgate's own: past 65,536 records each way", rekeyEvery: 65536, records: 65540, keep: [0, 1, 65534, 65535, 65536, 65537, 65539] }),
      rekeyRun({ name: 'lowered: every 4 records', rekeyEvery: 4, records: 18, keep: 'all' }),
      rekeyRun({ name: 'lowered: after every record', rekeyEvery: 1, records: 5, keep: 'all' }),
    ],
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = new URL('../fixtures/noise-rekey-vectors.json', import.meta.url);
  writeFileSync(out, `${JSON.stringify(rekeyVectors(), null, 2)}\n`);
  console.log(`Wrote ${fileURLToPath(out)}`);
}
