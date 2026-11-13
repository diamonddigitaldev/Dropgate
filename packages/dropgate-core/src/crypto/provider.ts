import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { AES_GCM_IV_BYTES } from '../constants.js';
import { DropgateError } from '../errors.js';
import {
  ContentKey, MacKey, X25519Key, X25519_BYTES, allZero, canonicalU, checkContentKey, checkHkdfLength, checkHmac, checkNonce,
  constantTimeEqual, lowOrder, notBytes, own, randomFrom,
  type CryptoProvider, type NamedCryptoProvider, type RandomSource,
} from './common.js';
import { elligator2 } from './elligator.js';
import { nobleProvider } from './noble.js';

// Every encrypt, decrypt, key and hash call core makes, and every random
// number it uses, goes through one CryptoProvider. This is the only file in
// core that touches `globalThis.crypto`: a test holds that.
//
// There are two: WebCrypto's (here), and an audited JavaScript one on @noble
// (noble.ts) for where WebCrypto can't do X25519. cryptoProvider() chooses one
// for the runtime, once, and it does every operation: never a mix. The
// Elligator 2 map is @noble's in both (elligator.ts), as WebCrypto has none,
// and random numbers come from `crypto.getRandomValues()` in both.

export { ContentKey, MacKey, X25519Key };
export type { CryptoProvider, CryptoProviderName, HmacHash, NamedCryptoProvider } from './common.js';

/** What WebCrypto's provider needs: `globalThis.crypto`'s shape. */
interface WebCryptoLike extends RandomSource {
  readonly subtle?: SubtleCrypto;
}

/** `bytes` as WebCrypto takes them: as they are on an ArrayBuffer, so a chunk isn't copied, or else a copy. */
const view = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
  bytes.buffer instanceof ArrayBuffer ? bytes as Uint8Array<ArrayBuffer> : own(bytes);

/** An HMAC-SHA256 key is 32 bytes, as HKDF-SHA256's output. */
const HMAC_KEY_BITS = 256;

/**
 * An X25519 private key as PKCS#8 (RFC 8410) is these 16 bytes, then the
 * scalar. It needs no public key, so a test's fixed scalar goes in as it is.
 */
const X25519_PKCS8_PREFIX = Uint8Array.of(0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20);

const noEncryption = () => new DropgateError({
  code: 'RUNTIME_UNSUPPORTED',
  message: 'Web Crypto API not available (crypto.subtle). Encryption needs a secure context (HTTPS or localhost).',
});

/** The provider over WebCrypto. */
export function webCryptoProvider(webCrypto: WebCryptoLike): NamedCryptoProvider {
  const subtle = webCrypto.subtle;
  const name = 'webcrypto' as const;
  const { randomBytes, randomUUID } = randomFrom(webCrypto);
  const needSubtle = (): SubtleCrypto => {
    if (!subtle) throw noEncryption();
    return subtle;
  };
  const cryptoKey = (key: ContentKey) => ContentKey.handle(key, name) as CryptoKey;
  const macKey = (key: MacKey) => MacKey.handle(key, name) as CryptoKey;
  const x25519Key = (key: X25519Key) => X25519Key.handle(key, name) as CryptoKey;
  /** AES-GCM's parameters, with `additionalData` only when there is some, so a call without any is as it always was. */
  const gcm = (nonce: Uint8Array, associatedData?: Uint8Array): AesGcmParams => {
    checkNonce(nonce);
    return associatedData === undefined
      ? { name: 'AES-GCM', iv: own(nonce) }
      : { name: 'AES-GCM', iv: own(nonce), additionalData: own(associatedData) };
  };
  const hkdf = async (ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, algorithm: AesKeyGenParams | HmacImportParams, usages: KeyUsage[]) => {
    const base = await needSubtle().importKey('raw', own(ikm), 'HKDF', false, ['deriveKey']);
    return needSubtle().deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: own(salt), info: own(info) }, base, algorithm, false, usages,
    );
  };

  const provider: NamedCryptoProvider = {
    name,
    canEncrypt: Boolean(subtle),
    randomBytes,
    randomUUID,
    async generateKey() {
      const key = await needSubtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
      return new ContentKey(name, key);
    },
    async importKey(raw, exportable = true) {
      checkContentKey(raw);
      const key = await needSubtle().importKey('raw', own(raw), { name: 'AES-GCM' }, exportable, ['encrypt', 'decrypt']);
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
    async encryptWithNonce(key, nonce, plaintext, associatedData) {
      return new Uint8Array(await needSubtle().encrypt(gcm(nonce, associatedData), cryptoKey(key), view(plaintext)));
    },
    async decryptWithNonce(key, nonce, sealed, associatedData) {
      return new Uint8Array(await needSubtle().decrypt(gcm(nonce, associatedData), cryptoKey(key), view(sealed)));
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
      // Chunk hashes are for integrity, not secrecy, so this provider makes
      // them even with no crypto.subtle, with @noble/hashes' SHA-256 (core
      // never chooses it there, but it can still be made so: the tests do).
      if (subtle) return new Uint8Array(await subtle.digest('SHA-256', own(data)));
      return nobleSha256(data) as Uint8Array<ArrayBuffer>;
    },
    async sha512(data) {
      return new Uint8Array(await needSubtle().digest('SHA-512', view(data)));
    },
    async hmac(hash, key, data) {
      checkHmac(hash, key);
      const handle = await needSubtle().importKey('raw', own(key), { name: 'HMAC', hash }, false, ['sign']);
      return new Uint8Array(await needSubtle().sign('HMAC', handle, view(data)));
    },
    async hkdf(ikm, salt, info, length) {
      checkHkdfLength(length);
      const base = await needSubtle().importKey('raw', own(ikm), 'HKDF', false, ['deriveBits']);
      return new Uint8Array(await needSubtle().deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: own(salt), info: own(info) }, base, length * 8,
      ));
    },
    equal: constantTimeEqual,
    async x25519Generate() {
      // The private key can't be exported; the public key always can.
      const pair = await needSubtle().generateKey({ name: 'X25519' }, false, ['deriveBits']) as CryptoKeyPair;
      const publicKey = new Uint8Array(await needSubtle().exportKey('raw', pair.publicKey));
      return { privateKey: new X25519Key(name, pair.privateKey), publicKey };
    },
    async x25519(privateKey, u) {
      if (u.byteLength !== X25519_BYTES) throw notBytes('An X25519 u-coordinate', X25519_BYTES);
      const scalar = x25519Key(privateKey);
      const peer = await needSubtle().importKey('raw', canonicalU(u), { name: 'X25519' }, true, []);
      let shared: Uint8Array<ArrayBuffer>;
      try {
        shared = new Uint8Array(await needSubtle().deriveBits({ name: 'X25519', public: peer }, scalar, 256));
      } catch (err) {
        // WebCrypto refuses an all-zero result with an OperationError.
        if ((err as { name?: unknown } | null)?.name === 'OperationError') throw lowOrder();
        throw err;
      }
      // And should an engine not refuse it, it's refused here.
      if (allZero(shared)) throw lowOrder();
      return shared;
    },
    async x25519FromScalar(scalar) {
      if (scalar.byteLength !== X25519_BYTES) throw notBytes('An X25519 scalar', X25519_BYTES);
      const pkcs8 = new Uint8Array(X25519_PKCS8_PREFIX.byteLength + X25519_BYTES);
      pkcs8.set(X25519_PKCS8_PREFIX);
      pkcs8.set(scalar, X25519_PKCS8_PREFIX.byteLength);
      try {
        return new X25519Key(name, await needSubtle().importKey('pkcs8', pkcs8, { name: 'X25519' }, false, ['deriveBits']));
      } finally {
        pkcs8.fill(0);
      }
    },
    elligator2,
  };
  return Object.freeze(provider);
}

/**
 * Whether this WebCrypto can do X25519: it has `crypto.subtle`, and making an
 * X25519 key works. Playwright's WebKit on Windows, for one, has no X25519.
 */
async function hasX25519(subtle: SubtleCrypto | undefined): Promise<boolean> {
  if (!subtle) return false;
  try {
    await subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']);
    return true;
  } catch {
    return false;
  }
}

/**
 * The provider for this runtime, chosen once: WebCrypto's when `crypto.subtle`
 * exists and a probe X25519 key can be made with it, else @noble's, for every
 * operation.
 */
async function choose(webCrypto: WebCryptoLike): Promise<NamedCryptoProvider> {
  return (await hasX25519(webCrypto.subtle)) ? webCryptoProvider(webCrypto) : nobleProvider(webCrypto);
}

/**
 * The runtime's provider, as `cryptoProvider()` gives it: every operation,
 * done by the provider chosen for this runtime, and `chosen()`, which gives
 * that provider once it's chosen.
 */
export interface RuntimeCryptoProvider extends CryptoProvider {
  /** The provider doing this runtime's operations, chosen at the first call. */
  chosen(): Promise<NamedCryptoProvider>;
}

/** The provider's operations that answer with a promise, which wait for the choice. */
type AsyncOperation = {
  [K in keyof CryptoProvider]: CryptoProvider[K] extends (...args: never[]) => Promise<unknown> ? K : never
}[keyof CryptoProvider];

const ASYNC_OPERATIONS = [
  'generateKey', 'importKey', 'exportKey', 'encrypt', 'decrypt', 'encryptWithNonce', 'decryptWithNonce', 'deriveContentKey',
  'deriveMacKey', 'hmacSha256', 'verifyHmacSha256', 'sha256', 'sha512', 'hmac', 'hkdf', 'x25519Generate', 'x25519', 'x25519FromScalar',
] as const satisfies readonly AsyncOperation[];

/** Fails to compile if an operation answering with a promise is missing from the list above. */
const everyAsyncOperation: [Exclude<AsyncOperation, (typeof ASYNC_OPERATIONS)[number]>] extends [never] ? true : never = true;
void everyAsyncOperation;

/**
 * The choice is asynchronous (the probe makes a key) and `cryptoProvider()`
 * isn't, so the runtime's provider resolves lazily: the first operation that
 * answers with a promise starts the choice, every later one waits for the same
 * one, and each is then done by the chosen provider. What answers at once
 * needs no choice, being the same in both: random numbers (from
 * `getRandomValues()`), `equal()` and the Elligator 2 map. Both providers can
 * encrypt, so `canEncrypt` is true whichever is chosen.
 */
function runtimeProvider(webCrypto: WebCryptoLike): RuntimeCryptoProvider {
  let choice: Promise<NamedCryptoProvider> | undefined;
  const chosen = () => (choice ??= choose(webCrypto));
  const operations = Object.fromEntries(ASYNC_OPERATIONS.map((operation) => [
    operation,
    async (...args: unknown[]) => ((await chosen())[operation] as (...a: unknown[]) => Promise<unknown>)(...args),
  ])) as Pick<CryptoProvider, AsyncOperation>;
  return Object.freeze({
    ...operations,
    ...randomFrom(webCrypto),
    canEncrypt: true,
    equal: constantTimeEqual,
    elligator2,
    chosen,
  });
}

/** Each runtime's provider, by the `globalThis.crypto` it was made from. */
const runtimes = new WeakMap<object, RuntimeCryptoProvider>();

/**
 * The provider for where core is running, from `globalThis.crypto`: the same
 * one every time, whose first asynchronous operation chooses WebCrypto or
 * @noble for this runtime, once.
 * @throws {DropgateError} RUNTIME_UNSUPPORTED if there's no `crypto.getRandomValues()`.
 */
export function cryptoProvider(): RuntimeCryptoProvider {
  const webCrypto = globalThis.crypto as WebCryptoLike | undefined;
  if (typeof webCrypto?.getRandomValues !== 'function') {
    throw new DropgateError({
      code: 'RUNTIME_UNSUPPORTED',
      message: 'No secure random numbers here (crypto.getRandomValues()).',
    });
  }
  let runtime = runtimes.get(webCrypto);
  if (!runtime) {
    runtime = runtimeProvider(webCrypto);
    runtimes.set(webCrypto, runtime);
  }
  return runtime;
}
