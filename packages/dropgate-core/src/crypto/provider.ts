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

/**
 * An AES-256-GCM content key, held by the provider that made it. Its bytes
 * are only reachable through that provider's `exportKey()`: printed, logged or
 * serialised, it shows as `[ContentKey]`.
 */
export class ContentKey {
  readonly #provider: CryptoProviderName;
  readonly #handle: unknown;

  constructor(provider: CryptoProviderName, handle: unknown) {
    this.#provider = provider;
    this.#handle = handle;
    Object.freeze(this);
  }

  /** The provider's own handle, for the provider that made it. */
  static handle(key: ContentKey, provider: CryptoProviderName): unknown {
    if (!(key instanceof ContentKey) || key.#provider !== provider) {
      throw new DropgateError({ code: 'INVALID_ARGUMENT', message: "That key wasn't made by this crypto provider." });
    }
    return key.#handle;
  }

  toJSON(): string { return '[ContentKey]'; }
  toString(): string { return '[ContentKey]'; }
  [Symbol.for('nodejs.util.inspect.custom')](): string { return '[ContentKey]'; }
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
      const sealed = new Uint8Array(await needSubtle().encrypt({ name: 'AES-GCM', iv }, cryptoKey(key), own(plaintext)));
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
