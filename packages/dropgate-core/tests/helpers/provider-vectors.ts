// Known answers for the crypto provider's operations that CPace and Noise
// stand on, from their standards, as one list of checks like
// cpace-vectors.ts': tests/crypto.test.ts runs them in Node, and the
// integration suite's core/crypto-vectors.spec.mjs in Chromium, Firefox and
// WebKit. Nothing here uses Node.
import type { CryptoProvider } from '../../src/crypto/index.js';
import { fromHex, hex, type VectorCheck } from './cpace-vectors.js';

const ascii = (text: string) => new TextEncoder().encode(text);

/** Every check, run on `provider`; with `x25519: false`, all but X25519's. */
export async function providerVectorChecks(provider: CryptoProvider, { x25519 = true }: { x25519?: boolean } = {}): Promise<VectorCheck[]> {
  const checks: VectorCheck[] = [];
  const check = (name: string, expected: string, actual: Uint8Array) => checks.push({ name, expected, actual: hex(actual) });

  // FIPS 180-4's examples (as NIST's "SHA512.pdf" works them).
  check('SHA-512 "abc"', 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    await provider.sha512(ascii('abc')));

  // RFC 4231 §4.3, test case 2.
  const jefe = ascii('Jefe');
  const nothing = ascii('what do ya want for nothing?');
  check('HMAC-SHA-256, RFC 4231 test case 2', '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    await provider.hmac('SHA-256', jefe, nothing));
  check('HMAC-SHA-512, RFC 4231 test case 2',
    '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737',
    await provider.hmac('SHA-512', jefe, nothing));

  // RFC 5869, test cases 1 and 3 (no salt, no info).
  check('HKDF-SHA256, RFC 5869 test case 1', '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    await provider.hkdf(fromHex('0b'.repeat(22)), fromHex('000102030405060708090a0b0c'), fromHex('f0f1f2f3f4f5f6f7f8f9'), 42));
  check('HKDF-SHA256, RFC 5869 test case 3', '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8',
    await provider.hkdf(fromHex('0b'.repeat(22)), new Uint8Array(0), new Uint8Array(0), 42));

  // RFC 7748 §5.2, X25519 of a scalar and a u-coordinate, then §6.1's exchange.
  if (x25519) {
    const x = async (scalar: string, u: string) => provider.x25519(await provider.x25519FromScalar(fromHex(scalar)), fromHex(u));
    check('X25519, RFC 7748 §5.2 first', 'c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552',
      await x('a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4', 'e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c'));
    check('X25519, RFC 7748 §5.2 second', '95cbde9476e8907d7aade45cb4b873f88b595a68799fa152e6f8f7647aac7957',
      await x('4b66e9d4d1b4673c5ad22691957d6af5c11b6421e0ea01d42ca4169e7918ba0d', 'e5210f12786811d3f4b7959d0538ae2c31dbe7106fc03c3efc4cd549c715a493'));
    const alice = '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a';
    const bob = '5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb';
    const base = '09'.padEnd(64, '0');
    const alicePublic = '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a';
    const bobPublic = 'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f';
    check("X25519, RFC 7748 §6.1 Alice's public key", alicePublic, await x(alice, base));
    check("X25519, RFC 7748 §6.1 Bob's public key", bobPublic, await x(bob, base));
    const shared = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742';
    check('X25519, RFC 7748 §6.1 K, Alice', shared, await x(alice, bobPublic));
    check('X25519, RFC 7748 §6.1 K, Bob', shared, await x(bob, alicePublic));
  }

  // AES-256-GCM with associated data: the GCM specification's test case 16
  // (McGrew and Viega; NIST's own GCM vectors repeat it).
  const key = await provider.importKey(fromHex('feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308'));
  const nonce = fromHex('cafebabefacedbaddecaf888');
  const plaintext = fromHex('d9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39');
  const ad = fromHex('feedfacedeadbeeffeedfacedeadbeefabaddad2');
  const sealed = '522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662'
    + '76fc6ece0f4e1768cddf8853bb2d551b';
  check('AES-256-GCM with associated data, GCM test case 16, sealed', sealed, await provider.encryptWithNonce(key, nonce, plaintext, ad));
  check('AES-256-GCM with associated data, GCM test case 16, opened', hex(plaintext), await provider.decryptWithNonce(key, nonce, fromHex(sealed), ad));
  let refused = 'opened';
  try {
    await provider.decryptWithNonce(key, nonce, fromHex(sealed), ad.subarray(1));
  } catch {
    refused = 'refused';
  }
  checks.push({ name: 'AES-256-GCM with other associated data, refused', expected: 'refused', actual: refused });

  return checks;
}
