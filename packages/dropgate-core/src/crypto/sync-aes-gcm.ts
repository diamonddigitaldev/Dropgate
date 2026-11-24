// AES-256-GCM that answers at once, for the one thing core must seal while a
// page is going: a direct transfer's out-of-band close (dgdtp/seal.ts). A page
// that's closing may never see a WebCrypto promise settle (Firefox and WebKit
// tear it down first), so the close's seal can't wait for one. This is
// @noble/ciphers' AES-GCM, compiled into core's build from an exact pin, in
// every runtime whichever provider is chosen, as the Elligator 2 map
// (elligator.ts) is @noble's in both. It gives exactly WebCrypto's bytes: the
// signal vectors hold every close frame on both providers and in every engine.
//
// The key is the caller's 32 bytes, which it holds and overwrites: nothing
// here keeps a key, a nonce or a plaintext, and nothing draws randomness.
import { gcm } from '@noble/ciphers/aes.js';
import { CONTENT_KEY_BYTES, checkNonce, notBytes } from './common.js';

const checkKey = (key: Uint8Array) => {
  if (!(key instanceof Uint8Array) || key.byteLength !== CONTENT_KEY_BYTES) throw notBytes('An AES-256-GCM key', CONTENT_KEY_BYTES);
};

/** `plaintext` sealed under `key` and `nonce`, authenticating `associatedData`: the ciphertext, then the 16-byte tag. */
export function sealAesGcmNow(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, associatedData: Uint8Array): Uint8Array<ArrayBuffer> {
  checkKey(key);
  checkNonce(nonce);
  return gcm(key, nonce, associatedData).encrypt(plaintext) as Uint8Array<ArrayBuffer>;
}

/** What `sealed` holds, if it opens under `key`, `nonce` and `associatedData`; else it throws. */
export function openAesGcmNow(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array, associatedData: Uint8Array): Uint8Array<ArrayBuffer> {
  checkKey(key);
  checkNonce(nonce);
  return gcm(key, nonce, associatedData).decrypt(sealed) as Uint8Array<ArrayBuffer>;
}

/**
 * Seals and opens a throwaway block under an all-zero key, so the first real
 * seal runs on warm code: cold, a seal takes several times as long, and a
 * closing page has about a millisecond (DGDTP.md says why).
 */
export function warmAesGcm(bytes: number): void {
  const key = new Uint8Array(CONTENT_KEY_BYTES);
  const nonce = new Uint8Array(12);
  const ad = new Uint8Array(16);
  openAesGcmNow(key, nonce, sealAesGcmNow(key, nonce, new Uint8Array(bytes), ad), ad);
}
