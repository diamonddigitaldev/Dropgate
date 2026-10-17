import { AES_GCM_IV_BYTES } from '../constants.js';
import { DropgateError } from '../errors.js';
import { sha256Fallback } from './sha256-fallback.js';

// Every encrypt, decrypt, key and hash call core makes, and every random
// number it uses, goes through one CryptoProvider. This is the only file in
// core that touches `globalThis.crypto`: a test holds that.
//
// WebCrypto is the one implementation today. Phase 11 adds an audited
// JavaScript one for where `crypto.subtle` is missing (a page served over
// plain HTTP from another machine), chosen here, so nothing that calls the
// provider changes.

/** Which implementation a provider is. */
export type CryptoProviderName = 'webcrypto';

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

export interface CryptoProvider {
  readonly name: CryptoProviderName;
  /**
   * Whether this provider can encrypt and decrypt here. WebCrypto can't on a
   * page served over plain HTTP from another machine, which has no
   * `crypto.subtle`; random bytes and hashing still work there.
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
   * Seals `plaintext` under the 12-byte `nonce` given, with no associated
   * data: `[ciphertext + tag]`. The caller makes sure no nonce is ever used
   * twice under one key.
   */
  encryptWithNonce(key: ContentKey, nonce: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array<ArrayBuffer>>;
  /** Opens `[ciphertext + tag]` sealed under `nonce`; fails if it was changed, or the key or nonce is wrong. */
  decryptWithNonce(key: ContentKey, nonce: Uint8Array, sealed: Uint8Array): Promise<Uint8Array<ArrayBuffer>>;
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
}

/** What WebCrypto's provider needs: `globalThis.crypto`'s shape. */
interface WebCryptoLike {
  readonly subtle?: SubtleCrypto;
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
  randomUUID?: () => string;
}

/** A copy of `bytes` in an ArrayBuffer of its own, as WebCrypto wants. */
const own = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes);

/** `bytes` as WebCrypto takes them: as they are on an ArrayBuffer, so a chunk isn't copied, or else a copy. */
const view = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
  bytes.buffer instanceof ArrayBuffer ? bytes as Uint8Array<ArrayBuffer> : own(bytes);

/** An HMAC-SHA256 key is 32 bytes, as HKDF-SHA256's output. */
const HMAC_KEY_BITS = 256;

const noEncryption = () => new DropgateError({
  code: 'RUNTIME_UNSUPPORTED',
  message: 'Web Crypto API not available (crypto.subtle). Encryption needs a secure context (HTTPS or localhost).',
});

/** The provider over WebCrypto. */
export function webCryptoProvider(webCrypto: WebCryptoLike): CryptoProvider {
  const subtle = webCrypto.subtle;
  const name = 'webcrypto' as const;
  const needSubtle = (): SubtleCrypto => {
    if (!subtle) throw noEncryption();
    return subtle;
  };
  const cryptoKey = (key: ContentKey) => ContentKey.handle(key, name) as CryptoKey;
  const macKey = (key: MacKey) => MacKey.handle(key, name) as CryptoKey;
  const nonceOf = (nonce: Uint8Array) => {
    if (nonce.byteLength !== AES_GCM_IV_BYTES) throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'An AES-GCM nonce is 12 bytes.' });
    return own(nonce);
  };
  const hkdf = async (ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, algorithm: AesKeyGenParams | HmacImportParams, usages: KeyUsage[]) => {
    const base = await needSubtle().importKey('raw', own(ikm), 'HKDF', false, ['deriveKey']);
    return needSubtle().deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: own(salt), info: own(info) }, base, algorithm, false, usages,
    );
  };

  const randomBytes = (length: number) => {
    const out = new Uint8Array(length);
    // getRandomValues fills at most 65,536 bytes a call.
    for (let i = 0; i < length; i += 65536) webCrypto.getRandomValues(out.subarray(i, Math.min(length, i + 65536)));
    return out;
  };

  const provider: CryptoProvider = {
    name,
    canEncrypt: Boolean(subtle),
    randomBytes,
    randomUUID(): string {
      // randomUUID() is only there in a secure context; elsewhere one is made
      // the same way from getRandomValues(), which is there in every context.
      if (typeof webCrypto.randomUUID === 'function') return webCrypto.randomUUID();
      const bytes = randomBytes(16);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
    async generateKey() {
      const key = await needSubtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
      return new ContentKey(name, key);
    },
    async importKey(raw) {
      if (raw.byteLength !== 32) throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'A content key is 32 bytes.' });
      const key = await needSubtle().importKey('raw', own(raw), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
      return new ContentKey(name, key);
    },
    async exportKey(key) {
      return new Uint8Array(await needSubtle().exportKey('raw', cryptoKey(key)));
    },
    async encrypt(key, plaintext) {
      const iv = randomBytes(AES_GCM_IV_BYTES);
      const sealed = await provider.encryptWithNonce(key, iv, own(plaintext));
      const out = new Uint8Array(iv.byteLength + sealed.byteLength);
      out.set(iv);
      out.set(sealed, iv.byteLength);
      return out;
    },
    async decrypt(key, sealed) {
      const iv = sealed.slice(0, AES_GCM_IV_BYTES);
      const ciphertext = sealed.slice(AES_GCM_IV_BYTES);
      return new Uint8Array(await needSubtle().decrypt({ name: 'AES-GCM', iv }, cryptoKey(key), ciphertext));
    },
    async encryptWithNonce(key, nonce, plaintext) {
      return new Uint8Array(await needSubtle().encrypt({ name: 'AES-GCM', iv: nonceOf(nonce) }, cryptoKey(key), view(plaintext)));
    },
    async decryptWithNonce(key, nonce, sealed) {
      return new Uint8Array(await needSubtle().decrypt({ name: 'AES-GCM', iv: nonceOf(nonce) }, cryptoKey(key), view(sealed)));
    },
    async deriveContentKey(ikm, salt, info) {
      return new ContentKey(name, await hkdf(ikm, salt, info, { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']));
    },
    async deriveMacKey(ikm, salt, info) {
      return new MacKey(name, await hkdf(ikm, salt, info, { name: 'HMAC', hash: 'SHA-256', length: HMAC_KEY_BITS }, ['sign', 'verify']));
    },
    async hmacSha256(key, data) {
      return new Uint8Array(await needSubtle().sign('HMAC', macKey(key), view(data)));
    },
    async verifyHmacSha256(key, mac, data) {
      return needSubtle().verify('HMAC', macKey(key), own(mac), view(data));
    },
    async sha256(data) {
      // Chunk hashes are for integrity, not secrecy, so where there's no
      // crypto.subtle they're made in JavaScript.
      if (subtle) return new Uint8Array(await subtle.digest('SHA-256', own(data)));
      return new Uint8Array(sha256Fallback(own(data).buffer));
    },
  };
  return Object.freeze(provider);
}

/**
 * The provider for where core is running: WebCrypto, from `globalThis.crypto`.
 * @throws {DropgateError} RUNTIME_UNSUPPORTED if there's no `crypto.getRandomValues()`.
 */
export function cryptoProvider(): CryptoProvider {
  const webCrypto = globalThis.crypto as WebCryptoLike | undefined;
  if (typeof webCrypto?.getRandomValues !== 'function') {
    throw new DropgateError({
      code: 'RUNTIME_UNSUPPORTED',
      message: 'No secure random numbers here (crypto.getRandomValues()).',
    });
  }
  return webCryptoProvider(webCrypto);
}
