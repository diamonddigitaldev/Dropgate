import { describe, it, expect } from 'vitest';
import { inspect } from 'node:util';
import { cryptoProvider } from '../src/crypto/index.js';
import { calculateGenerator, deriveIsk, newShare, prependLen, transcriptIr } from '../src/dgdtp/cpace.js';
import { cpaceVectorChecks, fromHex, hex } from './helpers/cpace-vectors.js';

// CPace, CPACE-X25519-SHA512, on core's WebCrypto provider: the draft's own
// vectors (draft-irtf-cfrg-cpace-21, A.1, A.3, B.1 and B.1.10; the fixture says
// where each came from), the same checks the integration suite runs in
// Chromium, Firefox and WebKit (core/crypto-vectors.spec.mjs).

const provider = cryptoProvider();

describe('CPace-X25519-SHA512, the draft\'s known answers', async () => {
  const checks = await cpaceVectorChecks(provider, globalThis.crypto.subtle);

  it('covers every value in B.1 and every point in B.1.10', () => {
    const names = checks.map((c) => c.name).join('\n');
    for (const value of ['generator string', 'hash generator string', 'decoded field element', 'generator g', 'B.1.2 Ya', 'B.1.3 Yb',
      'B.1.4 K = scalar_mult_vfy(ya, Yb)', 'B.1.4 K = scalar_mult_vfy(yb, Ya)', 'ISK_IR, initiator A', 'ISK_IR, responder B',
      'ISK_SY, A', 'ISK_SY, B', 'sid_output_ir', 'sid_output_oc']) {
      expect(names).toContain(value);
    }
    expect(checks.filter((c) => /^B\.1\.10 q. = /.test(c.name))).toHaveLength(12);
    expect(checks.filter((c) => c.expected === 'abort' && /= scalar_mult_vfy/.test(c.name)).map((c) => c.name.slice(-3, -1)))
      .toEqual(['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u7']);
  });

  for (const { name, expected, actual } of checks) {
    it(name, () => {
      expect(actual).toBe(expected);
    });
  }
});

describe('CPace between two sides with random scalars', () => {
  it('agrees on the ISK with the same password, and not with another', async () => {
    const ci = new TextEncoder().encode('ci');
    const sid = provider.randomBytes(32);
    const password = (text: string) => new TextEncoder().encode(text);
    const g = await calculateGenerator(provider, password('CD1234'), ci, sid);
    const a = await newShare(provider, g);
    const b = await newShare(provider, g);
    const ad = [Uint8Array.of(1, 4, 0), Uint8Array.of(2, 4, 0)];
    const transcript = transcriptIr(a.share, ad[0], b.share, ad[1]);
    const iskA = await deriveIsk(provider, { scalar: a.scalar, peerShare: b.share, sid, transcript });
    const iskB = await deriveIsk(provider, { scalar: b.scalar, peerShare: a.share, sid, transcript });
    expect(iskA.byteLength).toBe(64);
    expect(hex(iskA)).toBe(hex(iskB));

    // B with another password: another generator, so another ISK.
    const wrong = await newShare(provider, await calculateGenerator(provider, password('CD1235'), ci, sid));
    const wrongTranscript = transcriptIr(a.share, ad[0], wrong.share, ad[1]);
    const iskA2 = await deriveIsk(provider, { scalar: a.scalar, peerShare: wrong.share, sid, transcript: wrongTranscript });
    const iskWrong = await deriveIsk(provider, { scalar: wrong.scalar, peerShare: a.share, sid, transcript: wrongTranscript });
    expect(hex(iskA2)).not.toBe(hex(iskWrong));
  });

  it('keeps its scalar to itself, and refuses a share that isn\'t 32 bytes', async () => {
    const { scalar } = await newShare(provider, fromHex('09'.padEnd(64, '0')));
    expect(`${JSON.stringify({ scalar })} ${String(scalar)} ${inspect(scalar)}`).toBe('{"scalar":"[X25519Key]"} [X25519Key] [X25519Key]');
    for (const length of [0, 31, 33]) {
      await expect(deriveIsk(provider, { scalar, peerShare: new Uint8Array(length).fill(9), sid: new Uint8Array(32), transcript: new Uint8Array(0) }))
        .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
  });

  it('writes lengths of 16,384 bytes and more in three LEB128 bytes', () => {
    expect(hex(prependLen(new Uint8Array(16_384)).subarray(0, 3))).toBe('808001');
    expect(hex(prependLen(new Uint8Array(300)).subarray(0, 2))).toBe('ac02');
  });
});
