// The crypto known answers, for a browser: the integration suite's
// core/crypto-vectors.spec.mjs bundles this file with esbuild, loads it on a
// page from 127.0.0.1 (a secure context) in Chromium, Firefox and WebKit, and
// calls runCryptoVectors(). The checks are the ones core's vitest runs in
// Node (tests/cpace.test.ts, tests/cpace-exchange.test.ts, tests/crypto.test.ts,
// tests/noise.test.ts, tests/signal.test.ts, tests/prologue.test.ts and
// tests/channel.test.ts), on
// the provider core chooses in that engine (WebCrypto where it has X25519,
// else @noble), or on @noble whatever the engine, so every engine is held to
// the same bytes. The spec bundles it as a test build
// (scripts/test-build-define.mjs), so Noise's vector can pin its ephemerals.
import { cryptoProvider, nobleProvider } from '../../src/crypto/index.js';
import { channelChecks } from '../helpers/channel-checks.js';
import { cpaceExchangeChecks } from '../helpers/cpace-exchange-checks.js';
import { cpaceVectorChecks } from '../helpers/cpace-vectors.js';
import { noiseVectorChecks } from '../helpers/noise-vectors.js';
import { providerVectorChecks } from '../helpers/provider-vectors.js';
import { signalVectorChecks } from '../helpers/signal-checks.js';

type Which = 'chosen' | 'noble';

declare global {
  // eslint-disable-next-line no-var
  var runCryptoVectors: (options: { x25519: boolean; provider: Which }) => Promise<{ name: string; cpace: unknown[]; exchange: unknown[]; provider: unknown[]; noise: unknown[]; signal: unknown[]; channel: unknown[] }>;
  // eslint-disable-next-line no-var
  var webCryptoHasX25519: () => Promise<string>;
}

globalThis.runCryptoVectors = async ({ x25519, provider: which }) => {
  const provider = which === 'noble' ? nobleProvider(globalThis.crypto) : await cryptoProvider().chosen();
  // The engine's own WebCrypto is checked to refuse CPace's low-order points only where core uses it.
  const subtle = provider.name === 'webcrypto' ? globalThis.crypto.subtle : undefined;
  return {
    name: provider.name,
    cpace: await cpaceVectorChecks(provider, subtle, { x25519 }),
    // The exchange runs X25519 throughout.
    exchange: x25519 ? await cpaceExchangeChecks(provider) : [],
    provider: await providerVectorChecks(provider, { x25519 }),
    // Cacophony's Noise vector needs X25519 throughout.
    noise: x25519 ? await noiseVectorChecks(provider) : [],
    // The key schedule and sealed frames need only HKDF and AES-GCM.
    signal: await signalVectorChecks(provider),
    // The channel end to end runs CPace and Noise, so X25519 throughout.
    channel: x25519 ? await channelChecks(provider) : [],
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
