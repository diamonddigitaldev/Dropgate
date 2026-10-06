import type { Base64Adapter } from '../types.js';
import type { ContentKey, CryptoProvider } from './provider.js';

// DGUP's content encryption, on the crypto provider: one AES-256-GCM key per
// upload, carried in the link's # part as base64.

export { ContentKey, MacKey, cryptoProvider, webCryptoProvider } from './provider.js';
export type { CryptoProvider, CryptoProviderName } from './provider.js';

/** The SHA-256 digest of `data`, as lowercase hex. */
export async function sha256Hex(provider: CryptoProvider, data: Uint8Array): Promise<string> {
  const digest = await provider.sha256(data);
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** A key as the link carries it. */
export async function keyToBase64(provider: CryptoProvider, key: ContentKey, base64: Base64Adapter): Promise<string> {
  return base64.encode(await provider.exportKey(key));
}

/** A key from the link. */
export async function keyFromBase64(provider: CryptoProvider, keyB64: string, base64: Base64Adapter): Promise<ContentKey> {
  return provider.importKey(base64.decode(keyB64));
}

/** A file name sealed under the key, as base64. */
export async function encryptName(provider: CryptoProvider, name: string, key: ContentKey, base64: Base64Adapter): Promise<string> {
  return base64.encode(await provider.encrypt(key, new TextEncoder().encode(String(name))));
}

/** A sealed file name opened. */
export async function decryptName(provider: CryptoProvider, sealedB64: string, key: ContentKey, base64: Base64Adapter): Promise<string> {
  return new TextDecoder().decode(await provider.decrypt(key, base64.decode(sealedB64)));
}
