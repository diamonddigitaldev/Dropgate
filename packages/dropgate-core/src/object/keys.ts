import type { ContentKey, CryptoProvider, MacKey } from '../crypto/index.js';
import { DropgateError } from '../errors.js';

// An object's three keys, one per purpose, each HKDF-SHA256 of the link's
// secret with the header's salt, so no key serves two algorithms and nothing
// from one object opens under another's keys. They're the provider's handles,
// which can't be exported: printed or logged, they show no bytes.

/** The link's secret, carried after its #. */
export const SECRET_BYTES = 32;

const INFO = {
  header: 'dropgate/4 header',
  payload: 'dropgate/4 payload',
  meta: 'dropgate/4 meta',
} as const;

export interface ObjectKeys {
  /** The header's HMAC-SHA256. */
  readonly header: MacKey;
  /** Every chunk, AES-256-GCM. */
  readonly payload: ContentKey;
  /** The meta, AES-256-GCM. */
  readonly meta: ContentKey;
}

/** An object's keys, from the link's secret and the header's salt. */
export async function deriveObjectKeys(provider: CryptoProvider, secret: Uint8Array, salt: Uint8Array): Promise<ObjectKeys> {
  if (secret.byteLength !== SECRET_BYTES) {
    throw new DropgateError({ code: 'INVALID_ARGUMENT', message: "A link's secret is 32 bytes." });
  }
  const info = (label: string) => new TextEncoder().encode(label);
  const [header, payload, meta] = await Promise.all([
    provider.deriveMacKey(secret, salt, info(INFO.header)),
    provider.deriveContentKey(secret, salt, info(INFO.payload)),
    provider.deriveContentKey(secret, salt, info(INFO.meta)),
  ]);
  return Object.freeze({ header, payload, meta });
}
