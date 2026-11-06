// The crypto known answers, for a browser: the integration suite's
// core/crypto-vectors.spec.mjs bundles this file with esbuild, loads it on a
// page from 127.0.0.1 (a secure context) in Chromium, Firefox and WebKit, and
// calls runCryptoVectors(). The checks are the ones core's vitest runs in
// Node (tests/cpace.test.ts and tests/crypto.test.ts), on core's own
// WebCrypto provider, so every engine is held to the same bytes.
import { cryptoProvider } from '../../src/crypto/index.js';
import { cpaceVectorChecks } from '../helpers/cpace-vectors.js';
import { providerVectorChecks } from '../helpers/provider-vectors.js';

declare global {
  // eslint-disable-next-line no-var
  var runCryptoVectors: (options: { x25519: boolean }) => Promise<{ cpace: unknown[]; provider: unknown[] }>;
  // eslint-disable-next-line no-var
  var webCryptoHasX25519: () => Promise<string>;
}

globalThis.runCryptoVectors = async ({ x25519 }) => {
  const provider = cryptoProvider();
  return {
    cpace: await cpaceVectorChecks(provider, globalThis.crypto.subtle, { x25519 }),
    provider: await providerVectorChecks(provider, { x25519 }),
  };
};

/** `yes`, or why not: the error making an X25519 key gives. */
globalThis.webCryptoHasX25519 = async () => {
  try {
    await globalThis.crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']);
    return 'yes';
  } catch (err) {
    return `${(err as Error).name}: ${(err as Error).message}`;
  }
};
