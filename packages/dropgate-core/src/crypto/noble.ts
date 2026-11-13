// The crypto provider in JavaScript, on @noble (@noble/curves' X25519,
// @noble/ciphers' AES-256-GCM, @noble/hashes' SHA-256, SHA-512, HMAC and HKDF),
// compiled into core's build from exact pins. Core chooses it, for every
// operation, only where WebCrypto can't do X25519: no `crypto.subtle` at all (a
// page served over plain HTTP from another machine), or one without X25519
// (provider.ts chooses). Random numbers still come from
// `crypto.getRandomValues()`, handed in by provider.ts, and no @noble function
// called here draws randomness of its own (tests/provider-choice.test.ts
// counts every call).
//
// It gives exactly what the WebCrypto provider gives, byte for byte, for every
// input: tests/crypto.test.ts runs both on the same known answers and random
// inputs, and DGUP/4's object and CPace's vectors on each.
//
// Keys are held privately, as WebCrypto's are: a key's bytes sit in its handle
// and are never printed, logged or serialised (only its label shows), and a
// derived key can't be exported. JavaScript makes no promise of constant time
// or of erasing memory; that's a stated limit.
import { gcm } from '@noble/ciphers/aes.js';
import { x25519 as curve25519 } from '@noble/curves/ed25519.js';
import { hkdf as nobleHkdf } from '@noble/hashes/hkdf.js';
import { hmac as nobleHmac } from '@noble/hashes/hmac.js';
import { sha256 as nobleSha256, sha512 as nobleSha512 } from '@noble/hashes/sha2.js';
import { AES_GCM_IV_BYTES } from '../constants.js';
import { DropgateError } from '../errors.js';
import {
  CONTENT_KEY_BYTES, ContentKey, MAC_KEY_BYTES, MacKey, X25519Key, X25519_BYTES, allZero, canonicalU, checkContentKey,
  checkHkdfLength, checkHmac, checkNonce, constantTimeEqual, lowOrder, notBytes, own, randomFrom,
  type NamedCryptoProvider, type RandomSource,
} from './common.js';
import { elligator2 } from './elligator.js';

/** A content key's handle: its bytes, and whether `exportKey()` may give them. */
interface HeldContentKey {
  readonly bytes: Uint8Array;
  readonly exportable: boolean;
}

/** X25519's base point, u = 9 (RFC 7748). */
const BASE_U = Uint8Array.of(9, ...new Uint8Array(X25519_BYTES - 1));

/** @noble's results are on ArrayBuffers of their own. */
const asOwn = (bytes: Uint8Array) => bytes as Uint8Array<ArrayBuffer>;

/** The provider in JavaScript, on @noble, with random numbers from `source`. */
export function nobleProvider(source: RandomSource): NamedCryptoProvider {
  const name = 'noble' as const;
  const { randomBytes, randomUUID } = randomFrom(source);
  const contentKey = (bytes: Uint8Array, exportable: boolean) =>
    new ContentKey(name, Object.freeze({ bytes, exportable } satisfies HeldContentKey));
  const keyBytes = (key: ContentKey) => (ContentKey.handle(key, name) as HeldContentKey).bytes;
  const macBytes = (key: MacKey) => MacKey.handle(key, name) as Uint8Array;
  const scalarOf = (key: X25519Key) => X25519Key.handle(key, name) as Uint8Array;
  const hkdf = (ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number) =>
    asOwn(nobleHkdf(nobleSha256, ikm, salt, info, length));
  /** AES-256-GCM under `key` and `nonce`, authenticating `associatedData` if there is any (none and empty are the same). */
  const aead = (key: ContentKey, nonce: Uint8Array, associatedData?: Uint8Array) => {
    const bytes = keyBytes(key);
    checkNonce(nonce);
    return gcm(bytes, nonce, associatedData);
  };

  const provider: NamedCryptoProvider = {
    name,
    canEncrypt: true,
    randomBytes,
    randomUUID,
    async generateKey() {
      return contentKey(randomBytes(CONTENT_KEY_BYTES), true);
    },
    async importKey(raw, exportable = true) {
      checkContentKey(raw);
      return contentKey(own(raw), exportable);
    },
    async exportKey(key) {
      const held = ContentKey.handle(key, name) as HeldContentKey;
      if (!held.exportable) throw new DropgateError({ code: 'INVALID_ARGUMENT', message: "That key can't be exported." });
      return own(held.bytes);
    },
    async encrypt(key, plaintext) {
      const iv = randomBytes(AES_GCM_IV_BYTES);
      const sealed = await provider.encryptWithNonce(key, iv, plaintext);
      const out = new Uint8Array(iv.byteLength + sealed.byteLength);
      out.set(iv);
      out.set(sealed, iv.byteLength);
      return out;
    },
    async decrypt(key, sealed) {
      return provider.decryptWithNonce(key, sealed.subarray(0, AES_GCM_IV_BYTES), sealed.subarray(AES_GCM_IV_BYTES));
    },
    async encryptWithNonce(key, nonce, plaintext, associatedData) {
      return asOwn(aead(key, nonce, associatedData).encrypt(plaintext));
    },
    async decryptWithNonce(key, nonce, sealed, associatedData) {
      // A changed ciphertext, tag, nonce or associated data, or the wrong key, throws here.
      return asOwn(aead(key, nonce, associatedData).decrypt(sealed));
    },
    async deriveContentKey(ikm, salt, info) {
      return contentKey(hkdf(ikm, salt, info, CONTENT_KEY_BYTES), false);
    },
    async deriveMacKey(ikm, salt, info) {
      return new MacKey(name, hkdf(ikm, salt, info, MAC_KEY_BYTES));
    },
    async hmacSha256(key, data) {
      return asOwn(nobleHmac(nobleSha256, macBytes(key), data));
    },
    async verifyHmacSha256(key, mac, data) {
      return constantTimeEqual(nobleHmac(nobleSha256, macBytes(key), data), mac);
    },
    async sha256(data) {
      return asOwn(nobleSha256(data));
    },
    async sha512(data) {
      return asOwn(nobleSha512(data));
    },
    async hmac(hash, key, data) {
      checkHmac(hash, key);
      return asOwn(nobleHmac(hash === 'SHA-256' ? nobleSha256 : nobleSha512, key, data));
    },
    async hkdf(ikm, salt, info, length) {
      checkHkdfLength(length);
      return hkdf(ikm, salt, info, length);
    },
    equal: constantTimeEqual,
    async x25519Generate() {
      // @noble/curves clamps the scalar as RFC 7748 says, as WebCrypto does.
      // The public key is the ladder's X25519 of the base point, as a shared
      // secret is made: getPublicKey() would take the Edwards fixed-base path,
      // which blinds the scalar with random bytes @noble draws from
      // globalThis.crypto itself, so core's randomness would have two sources.
      const scalar = randomBytes(X25519_BYTES);
      return { privateKey: new X25519Key(name, scalar), publicKey: asOwn(curve25519.scalarMult(scalar, BASE_U)) };
    },
    async x25519(privateKey, u) {
      if (u.byteLength !== X25519_BYTES) throw notBytes('An X25519 u-coordinate', X25519_BYTES);
      const scalar = scalarOf(privateKey);
      // u read exactly as the WebCrypto provider reads it, low-order points refused first.
      const peer = canonicalU(u);
      let shared: Uint8Array<ArrayBuffer>;
      try {
        shared = asOwn(curve25519.getSharedSecret(scalar, peer));
      } catch {
        // @noble/curves refuses the same low-order points, and an all-zero
        // result, with an Error of its own: a valid 32-byte input has no other.
        throw lowOrder();
      }
      if (allZero(shared)) throw lowOrder();
      return shared;
    },
    async x25519FromScalar(scalar) {
      if (scalar.byteLength !== X25519_BYTES) throw notBytes('An X25519 scalar', X25519_BYTES);
      return new X25519Key(name, own(scalar));
    },
    elligator2,
  };
  return Object.freeze(provider);
}
