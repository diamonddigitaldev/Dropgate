import type { CryptoProvider, X25519Key } from '../crypto/index.js';
import { DropgateError } from '../errors.js';

// CPace, CPACE-X25519-SHA512 (draft-irtf-cfrg-cpace-21): the PAKE a typed
// code runs, so two devices that know the same short password end up with the
// same 64-byte ISK while nobody watching, the server included, can test a
// guess offline. The scalar maths is the provider's X25519 (WebCrypto's
// where it can); the generator's map is Elligator 2 (crypto/elligator.ts).
//
// The draft's own Appendix B.1 and B.1.10 vectors pin every value here
// (tests/cpace.test.ts, and in Chromium, Firefox and WebKit through the
// integration suite). What the exchange sends and when, key confirmation and
// aborts come with the codes (the draft's §10.4, and Dropgate's DGDTP spec).
//
// The shared point K never leaves this file: it's hashed into the ISK and
// overwritten. Nothing here logs, and no error carries a secret.

/** The draft's domain separator for G_X25519. */
const DSI = 'CPace255';
/** The domain separator for the ISK: DSI ‖ "_ISK". */
const DSI_ISK = 'CPace255_ISK';
/** What the optional session-ID output hashes in front of the transcript. */
const SID_OUTPUT = 'CPaceSidOutput';
/** SHA-512's input block, `H.s_in_bytes`. */
const SHA512_BLOCK_BYTES = 128;
/** G_X25519's field elements, scalars and shares. */
const FIELD_BYTES = 32;

const ascii = (text: string) => new TextEncoder().encode(text);

const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
};

/** `data`'s length in LEB128, then `data` (the draft's prepend_len). */
export function prependLen(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const length: number[] = [];
  let n = data.byteLength;
  do {
    length.push(n < 128 ? n : (n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  } while (n > 0);
  return concat(Uint8Array.from(length), data);
}

/** Each part with its length in front, one after another (the draft's lv_cat). */
export function lvCat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  return concat(...parts.map(prependLen));
}

/**
 * The string hashed to make the generator: `lv_cat(DSI, PRS, zero padding,
 * CI, sid)`, the padding filling SHA-512's first block so the hash's work
 * doesn't depend on the password's length.
 */
export function generatorString(prs: Uint8Array, ci: Uint8Array, sid: Uint8Array): Uint8Array<ArrayBuffer> {
  const dsi = ascii(DSI);
  const zpad = Math.max(0, SHA512_BLOCK_BYTES - 1 - prependLen(prs).byteLength - prependLen(dsi).byteLength);
  return lvCat(dsi, prs, new Uint8Array(zpad), ci, sid);
}

/**
 * The generator for this password, channel and session: the first 32 bytes of
 * SHA-512 of the generator string, decoded with bit 255 cleared, mapped to
 * the curve with Elligator 2 (the draft's §8.2).
 */
export async function calculateGenerator(
  provider: CryptoProvider, prs: Uint8Array, ci: Uint8Array, sid: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const hash = await provider.sha512(generatorString(prs, ci, sid));
  try {
    return provider.elligator2(hash.subarray(0, FIELD_BYTES));
  } finally {
    hash.fill(0);
  }
}

/** The share a private scalar makes with this generator: X25519(y, g). */
export async function shareOf(provider: CryptoProvider, scalar: X25519Key, generator: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return provider.x25519(scalar, generator);
}

/** One side's start: a fresh random scalar, and its share for this generator. */
export async function newShare(provider: CryptoProvider, generator: Uint8Array): Promise<{ scalar: X25519Key; share: Uint8Array<ArrayBuffer> }> {
  const { privateKey } = await provider.x25519Generate();
  return { scalar: privateKey, share: await shareOf(provider, privateKey, generator) };
}

/** The initiator–responder transcript: `lv_cat(Ya, ADa) ‖ lv_cat(Yb, ADb)`. */
export function transcriptIr(ya: Uint8Array, adA: Uint8Array, yb: Uint8Array, adB: Uint8Array): Uint8Array<ArrayBuffer> {
  return concat(lvCat(ya, adA), lvCat(yb, adB));
}

/** Whether `a` comes after `b`, byte by byte, the longer winning a tie (the draft's lexiographically_larger). */
const larger = (a: Uint8Array, b: Uint8Array) => {
  for (let i = 0; i < Math.min(a.byteLength, b.byteLength); i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return a.byteLength > b.byteLength;
};

/** `"oc"`, then the larger of the two, then the other (the draft's o_cat). */
export function orderedCat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  return larger(a, b) ? concat(ascii('oc'), a, b) : concat(ascii('oc'), b, a);
}

/** The ordered transcript, for when neither side is the initiator: `o_cat(lv_cat(Ya, ADa), lv_cat(Yb, ADb))`. */
export function transcriptOc(ya: Uint8Array, adA: Uint8Array, yb: Uint8Array, adB: Uint8Array): Uint8Array<ArrayBuffer> {
  return orderedCat(lvCat(ya, adA), lvCat(yb, adB));
}

/**
 * The intermediate session key: `SHA-512(lv_cat("CPace255_ISK", sid, K) ‖
 * transcript)`, where K is X25519 of this side's scalar and the other side's
 * share. A share that isn't 32 bytes, or that makes K all zeros (a low-order
 * point), throws, which is the draft's abort. K is overwritten here and never
 * returned.
 */
export async function deriveIsk(
  provider: CryptoProvider,
  input: { scalar: X25519Key; peerShare: Uint8Array; sid: Uint8Array; transcript: Uint8Array },
): Promise<Uint8Array<ArrayBuffer>> {
  if (input.peerShare.byteLength !== FIELD_BYTES) {
    throw new DropgateError({ code: 'INVALID_ARGUMENT', message: `A CPace share is ${FIELD_BYTES} bytes.` });
  }
  const k = await provider.x25519(input.scalar, input.peerShare);
  const hashed = concat(lvCat(ascii(DSI_ISK), input.sid, k), input.transcript);
  k.fill(0);
  try {
    return await provider.sha512(hashed);
  } finally {
    hashed.fill(0);
  }
}

/** The optional session-ID output both sides can agree on: `SHA-512("CPaceSidOutput" ‖ transcript)`. */
export async function sessionIdOutput(provider: CryptoProvider, transcript: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return provider.sha512(concat(ascii(SID_OUTPUT), transcript));
}
