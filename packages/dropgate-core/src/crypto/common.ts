import { AES_GCM_IV_BYTES } from '../constants.js';
import { DropgateError } from '../errors.js';

// What both crypto providers share: the interface, the keys as private
// handles, the checks every operation makes the same way in both, how an
// X25519 u-coordinate is read, and random numbers, which come from
// `crypto.getRandomValues()` whichever provider is chosen. Nothing here
// touches `globalThis.crypto`: provider.ts hands the random source in.

/** Which implementation a provider is. */
export type CryptoProviderName = 'webcrypto' | 'noble';

/** A key held by the provider that made it, which shows as its label alone. */
abstract class ProviderKey {
  readonly #label: string;
  readonly #provider: CryptoProviderName;
  readonly #handle: unknown;

  constructor(label: string, provider: CryptoProviderName, handle: unknown) {
    this.#label = label;
    this.#provider = provider;
    this.#handle = handle;
    Object.freeze(this);
  }

  /** The provider's own handle, for the provider that made it, if the key is of this kind. */
  static handle(key: unknown, provider: CryptoProviderName): unknown {
    if (!(key instanceof this) || key.#provider !== provider) {
      throw new DropgateError({ code: 'INVALID_ARGUMENT', message: "That key wasn't made by this crypto provider, or isn't for this." });
    }
    return key.#handle;
  }

  toJSON(): string { return this.#label; }
  toString(): string { return this.#label; }
  [Symbol.for('nodejs.util.inspect.custom')](): string { return this.#label; }
}

/**
 * An AES-256-GCM content key, held by the provider that made it. Its bytes
 * are only reachable through that provider's `exportKey()`, and not at all
 * for a derived key: printed, logged or serialised, it shows as `[ContentKey]`.
 */
export class ContentKey extends ProviderKey {
  constructor(provider: CryptoProviderName, handle: unknown) {
    super('[ContentKey]', provider, handle);
  }
}

/**
 * An HMAC-SHA256 key, derived by the provider that holds it. Its bytes can't
 * be reached at all: printed, logged or serialised, it shows as `[MacKey]`.
 */
export class MacKey extends ProviderKey {
  constructor(provider: CryptoProviderName, handle: unknown) {
    super('[MacKey]', provider, handle);
  }
}

/**
 * An X25519 private key (a scalar), held by the provider that made it. Its
 * bytes can't be reached at all: printed, logged or serialised, it shows as
 * `[X25519Key]`.
 */
export class X25519Key extends ProviderKey {
  constructor(provider: CryptoProviderName, handle: unknown) {
    super('[X25519Key]', provider, handle);
  }
}

/** The hashes `hmac()` takes. */
export type HmacHash = 'SHA-256' | 'SHA-512';

/** Every operation core's crypto offers, whichever implementation does it. */
export interface CryptoProvider {
  /**
   * Whether this provider can encrypt and decrypt here. The WebCrypto
   * provider can't where there's no `crypto.subtle` (a page served over plain
   * HTTP from another machine), but core never chooses it there: `@noble`
   * can. Random bytes and hashing work everywhere.
   */
  readonly canEncrypt: boolean;
  /** `length` cryptographically secure random bytes. */
  randomBytes(length: number): Uint8Array<ArrayBuffer>;
  /** A random version 4 UUID. */
  randomUUID(): string;
  /** A new random AES-256-GCM key. */
  generateKey(): Promise<ContentKey>;
  /** A key from its 32 raw bytes. */
  importKey(raw: Uint8Array): Promise<ContentKey>;
  /** A key's 32 raw bytes. */
  exportKey(key: ContentKey): Promise<Uint8Array<ArrayBuffer>>;
  /** Seals `plaintext` under a fresh random IV: `[IV (12 bytes)][ciphertext + tag]`. */
  encrypt(key: ContentKey, plaintext: Uint8Array): Promise<Uint8Array<ArrayBuffer>>;
  /** Opens `[IV (12 bytes)][ciphertext + tag]`; fails if it was changed or the key is wrong. */
  decrypt(key: ContentKey, sealed: Uint8Array): Promise<Uint8Array<ArrayBuffer>>;
  /**
   * Seals `plaintext` under the 12-byte `nonce` given, authenticating
   * `associatedData` too if there is any: `[ciphertext + tag]`. The caller
   * makes sure no nonce is ever used twice under one key. With none, it's
   * exactly what it was before associated data was added (DGUP/4's calls).
   */
  encryptWithNonce(key: ContentKey, nonce: Uint8Array, plaintext: Uint8Array, associatedData?: Uint8Array): Promise<Uint8Array<ArrayBuffer>>;
  /**
   * Opens `[ciphertext + tag]` sealed under `nonce` with `associatedData`, if
   * any; fails if either was changed, or the key, nonce or associated data is
   * wrong.
   */
  decryptWithNonce(key: ContentKey, nonce: Uint8Array, sealed: Uint8Array, associatedData?: Uint8Array): Promise<Uint8Array<ArrayBuffer>>;
  /** HKDF-SHA256 of `ikm` with `salt` and `info`: a new AES-256-GCM key, which can't be exported. */
  deriveContentKey(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array): Promise<ContentKey>;
  /** HKDF-SHA256 of `ikm` with `salt` and `info`: a new 32-byte HMAC-SHA256 key, which can't be exported. */
  deriveMacKey(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array): Promise<MacKey>;
  /** The HMAC-SHA256 of `data`. */
  hmacSha256(key: MacKey, data: Uint8Array): Promise<Uint8Array<ArrayBuffer>>;
  /** Whether `mac` is the HMAC-SHA256 of `data`, compared in constant time. */
  verifyHmacSha256(key: MacKey, mac: Uint8Array, data: Uint8Array): Promise<boolean>;
  /** The SHA-256 digest of `data`. */
  sha256(data: Uint8Array): Promise<Uint8Array<ArrayBuffer>>;
  /** The SHA-512 digest of `data`. */
  sha512(data: Uint8Array): Promise<Uint8Array<ArrayBuffer>>;
  /**
   * The HMAC of `data` under `key`, raw bytes kept by the caller (Noise's
   * chaining key, CPace's confirmation key), with SHA-256 or SHA-512. The key
   * isn't empty.
   */
  hmac(hash: HmacHash, key: Uint8Array, data: Uint8Array): Promise<Uint8Array<ArrayBuffer>>;
  /** HKDF-SHA256 (RFC 5869) of `ikm` with `salt` and `info`: `length` bytes, at most 8,160. */
  hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array<ArrayBuffer>>;
  /** Whether `a` and `b` are the same bytes, compared in time that depends only on their lengths. */
  equal(a: Uint8Array, b: Uint8Array): boolean;
  /** A new random X25519 private key, and its public key: X25519 of it and the base point. */
  x25519Generate(): Promise<{ privateKey: X25519Key; publicKey: Uint8Array<ArrayBuffer> }>;
  /**
   * X25519 (RFC 7748) of `privateKey` and the 32-byte u-coordinate `u`, which
   * needn't be the base point.
   * @throws {DropgateError} INVALID_ARGUMENT if `u` isn't 32 bytes, or the
   * result is all zeros (`u` is a low-order point), which callers treat as
   * the other side failing the exchange.
   */
  x25519(privateKey: X25519Key, u: Uint8Array): Promise<Uint8Array<ArrayBuffer>>;
  /**
   * For known-answer tests only: an X25519 private key from a given 32-byte
   * scalar, so a test can pin what's otherwise random. Nothing outside the
   * tests calls it.
   */
  x25519FromScalar(scalar: Uint8Array): Promise<X25519Key>;
  /**
   * RFC 9380's Elligator 2 map to Curve25519 of the 32-byte field element `u`
   * (RFC 7748's decoding, bit 255 ignored): the point's u-coordinate, 32 bytes.
   */
  elligator2(u: Uint8Array): Uint8Array<ArrayBuffer>;
}

/** One implementation of the provider: WebCrypto's, or `@noble`'s. */
export interface NamedCryptoProvider extends CryptoProvider {
  readonly name: CryptoProviderName;
}

/** Where random numbers come from: `globalThis.crypto`'s shape, as far as it goes. */
export interface RandomSource {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  randomUUID?: () => string;
}

/** Random bytes and UUIDs from `source`, the same for both providers. */
export function randomFrom(source: RandomSource): Pick<CryptoProvider, 'randomBytes' | 'randomUUID'> {
  const randomBytes = (length: number) => {
    const out = new Uint8Array(length);
    // getRandomValues fills at most 65,536 bytes a call.
    for (let i = 0; i < length; i += 65536) source.getRandomValues(out.subarray(i, Math.min(length, i + 65536)));
    return out;
  };
  return {
    randomBytes,
    randomUUID(): string {
      // randomUUID() is only there in a secure context; elsewhere one is made
      // the same way from getRandomValues(), which is there in every context.
      if (typeof source.randomUUID === 'function') return source.randomUUID();
      const bytes = randomBytes(16);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  };
}

/** A copy of `bytes` in an ArrayBuffer of its own. */
export const own = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes);

/** A content key is 32 bytes (AES-256). */
export const CONTENT_KEY_BYTES = 32;

/** An HMAC-SHA256 key is 32 bytes, as HKDF-SHA256's output. */
export const MAC_KEY_BYTES = 32;

/** X25519's keys, u-coordinates and results are 32 bytes. */
export const X25519_BYTES = 32;

/** HKDF-SHA256 gives at most 255 blocks of 32 bytes (RFC 5869). */
const HKDF_MAX_BYTES = 255 * 32;

const invalid = (message: string) => new DropgateError({ code: 'INVALID_ARGUMENT', message });

export const notBytes = (what: string, length: number) => invalid(`${what} is ${length} bytes.`);

export const lowOrder = () => invalid('That X25519 public value is a low-order point: the shared secret would be all zeros.');

/** A content key's raw bytes, checked: 32 of them. */
export function checkContentKey(raw: Uint8Array): void {
  if (raw.byteLength !== CONTENT_KEY_BYTES) throw invalid('A content key is 32 bytes.');
}

/** An AES-GCM nonce, checked: 12 bytes. */
export function checkNonce(nonce: Uint8Array): void {
  if (nonce.byteLength !== AES_GCM_IV_BYTES) throw invalid('An AES-GCM nonce is 12 bytes.');
}

/** `hmac()`'s hash and key, checked: SHA-256 or SHA-512, and a key that isn't empty. */
export function checkHmac(hash: HmacHash, key: Uint8Array): void {
  if (hash !== 'SHA-256' && hash !== 'SHA-512') throw invalid('HMAC is SHA-256 or SHA-512 here.');
  if (key.byteLength === 0) throw invalid('An HMAC key here is never empty.');
}

/** `hkdf()`'s length, checked: 1 to 8,160 bytes. */
export function checkHkdfLength(length: number): void {
  if (!Number.isInteger(length) || length < 1 || length > HKDF_MAX_BYTES) {
    throw invalid(`HKDF-SHA256 gives 1 to ${HKDF_MAX_BYTES} bytes.`);
  }
}

/** 2²⁵⁵ − 19. */
const P = (1n << 255n) - 19n;

const littleEndian = (bytes: Uint8Array) => {
  let n = 0n;
  for (let i = bytes.byteLength - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
  return n;
};

/**
 * The u-coordinates, reduced, of the points X25519 turns into all zeros (those
 * whose order divides the cofactor, on the curve or its twist): 0, 1, p − 1 and
 * the two of order 8. With their unreduced forms (p, p + 1) and bit 255 set,
 * they're CPace's B.1.10 abort cases.
 */
const LOW_ORDER = new Set([
  0n, 1n, P - 1n,
  littleEndian(Uint8Array.from([
    0xe0, 0xeb, 0x7a, 0x7c, 0x3b, 0x41, 0xb8, 0xae, 0x16, 0x56, 0xe3, 0xfa, 0xf1, 0x9f, 0xc4, 0x6a,
    0xda, 0x09, 0x8d, 0xeb, 0x9c, 0x32, 0xb1, 0xfd, 0x86, 0x62, 0x05, 0x16, 0x5f, 0x49, 0xb8, 0x00])),
  littleEndian(Uint8Array.from([
    0x5f, 0x9c, 0x95, 0xbc, 0xa3, 0x50, 0x8c, 0x24, 0xb1, 0xd0, 0xb1, 0x55, 0x9c, 0x83, 0xef, 0x5b,
    0x04, 0x44, 0x5c, 0xc4, 0x58, 0x1c, 0x8e, 0x86, 0xd8, 0x22, 0x4e, 0xdd, 0xd0, 0x9f, 0x11, 0x57])),
]);

/**
 * A 32-byte u-coordinate as RFC 7748 reads one, written back in its one
 * canonical form: bit 255 cleared, then reduced mod p, as X25519 "MUST" treat
 * it. Both providers read every u through this, so they agree on every input,
 * and an engine's WebCrypto never sees a form it might refuse (Firefox refuses
 * some with bit 255 set, which X25519 accepts). Throws for a low-order point,
 * which every engine refuses in its own way (Firefox as it imports the value,
 * the others as they derive).
 */
export function canonicalU(u: Uint8Array): Uint8Array<ArrayBuffer> {
  if (u.byteLength !== X25519_BYTES) throw notBytes('An X25519 u-coordinate', X25519_BYTES);
  let n = littleEndian(u) & ((1n << 255n) - 1n);
  if (n >= P) n -= P;
  if (LOW_ORDER.has(n)) throw lowOrder();
  const out = new Uint8Array(X25519_BYTES);
  for (let i = 0; i < X25519_BYTES; i++, n >>= 8n) out[i] = Number(n & 0xffn);
  return out;
}

/** Whether `a` and `b` are the same bytes, in time that depends only on their lengths. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Whether every byte is zero, looking at every byte. */
export const allZero = (bytes: Uint8Array): boolean => {
  let any = 0;
  for (let i = 0; i < bytes.byteLength; i++) any |= bytes[i];
  return any === 0;
};
