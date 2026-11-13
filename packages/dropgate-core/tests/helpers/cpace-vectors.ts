// CPace's known answers, draft-irtf-cfrg-cpace-21's Appendix A.1, A.3, B.1 and
// B.1.10, as one list of checks: each a name, the draft's value and core's.
// tests/cpace.test.ts runs them in Node, and the integration suite's
// core/crypto-vectors.spec.mjs runs the same code (bundled by esbuild from
// tests/browser/vectors-entry.ts) in Chromium, Firefox and WebKit, so every
// engine is held to the same bytes. Nothing here uses Node: no Buffer, no
// node:crypto.
import vectors from '../fixtures/cpace-x25519-sha512-vectors.json';
import type { CryptoProvider } from '../../src/crypto/index.js';
import { decodeUCoordinate } from '../../src/crypto/elligator.js';
import {
  calculateGenerator, deriveIsk, generatorString, lvCat, prependLen, sessionIdOutput, shareOf, transcriptIr, transcriptOc,
} from '../../src/dgdtp/cpace.js';

export interface VectorCheck {
  /** The draft's section and value. */
  name: string;
  /** The draft's value, lower-case hex, or `abort` where the draft says the exchange must abort. */
  expected: string;
  /** Core's, the same way; `abort` when core refused it as the draft says. */
  actual: string;
}

/** What a refusal shows as: `abort` for core's own, else the error's name and message. */
const ABORT = 'abort';

export const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
export const fromHex = (value: string) => Uint8Array.from(value.match(/../g) ?? [], (pair) => parseInt(pair, 16));
const ascii = (text: string) => new TextEncoder().encode(text);
const range = (n: number) => Uint8Array.from({ length: n }, (_, i) => i);

/** `abort` if `run` was refused as an invalid input (core's INVALID_ARGUMENT), else what it gave or threw. */
async function outcome(run: () => Promise<Uint8Array>): Promise<string> {
  try {
    return hex(await run());
  } catch (err) {
    const { code, name, message } = (err ?? {}) as { code?: string; name?: string; message?: string };
    return code === 'INVALID_ARGUMENT' ? ABORT : `threw ${name}: ${message}`;
  }
}

/**
 * Every check, run on `provider`. `subtle`, given with the WebCrypto provider,
 * is the engine's own WebCrypto, to show that it refuses B.1.10's low-order
 * points itself, not only core's check before it; without it (@noble's run)
 * those 7 checks are left out. With `x25519: false`, only the checks that need
 * no X25519.
 */
export async function cpaceVectorChecks(
  provider: CryptoProvider, subtle?: SubtleCrypto, { x25519 = true }: { x25519?: boolean } = {},
): Promise<VectorCheck[]> {
  const checks: VectorCheck[] = [];
  // The draft's JSON writes hex in upper case, its text in lower.
  const check = (name: string, expected: string, actual: string) =>
    checks.push({ name, expected: /^[0-9a-f]*$/i.test(expected) ? expected.toLowerCase() : expected, actual });

  // A.1: prepend_len and lv_cat.
  const a12 = vectors['A.1.2.1'].json;
  check("A.1.2 prepend_len(b'')", a12["prepend_len(b'')"], hex(prependLen(new Uint8Array(0))));
  check("A.1.2 prepend_len(b'1234')", a12["prepend_len(b'1234')"], hex(prependLen(ascii('1234'))));
  check('A.1.2 prepend_len(bytes(range(127)))', a12['prepend_len(bytes(range(127)))'], hex(prependLen(range(127))));
  check('A.1.2 prepend_len(bytes(range(128)))', a12['prepend_len(bytes(range(128)))'], hex(prependLen(range(128))));
  const a14 = vectors['A.1.4.1'].json;
  check("A.1.4 lv_cat(b'1234',b'5',b'',b'678')", a14["lv_cat(b'1234',b'5',b'',b'678')"],
    hex(lvCat(ascii('1234'), ascii('5'), new Uint8Array(0), ascii('678'))));

  // A.3: the two transcripts.
  const a35 = vectors['A.3.5.1'].json;
  check("A.3.5 transcript_ir(b'123',b'PartyA',b'234',b'PartyB')", a35["transcript_ir(b'123',b'PartyA',b'234',b'PartyB')"],
    hex(transcriptIr(ascii('123'), ascii('PartyA'), ascii('234'), ascii('PartyB'))));
  check("A.3.5 transcript_ir(b'3456',b'PartyA',b'2345',b'PartyB')", a35["transcript_ir(b'3456',b'PartyA',b'2345',b'PartyB')"],
    hex(transcriptIr(ascii('3456'), ascii('PartyA'), ascii('2345'), ascii('PartyB'))));
  const a37 = vectors['A.3.7.1'].json;
  check("A.3.7 transcript_oc(b'123',b'PartyA',b'234',b'PartyB')", a37["transcript_oc(b'123',b'PartyA',b'234',b'PartyB')"],
    hex(transcriptOc(ascii('123'), ascii('PartyA'), ascii('234'), ascii('PartyB'))));
  check("A.3.7 transcript_oc(b'3456',b'PartyA',b'2345',b'PartyB')", a37["transcript_oc(b'3456',b'PartyA',b'2345',b'PartyB')"],
    hex(transcriptOc(ascii('3456'), ascii('PartyA'), ascii('2345'), ascii('PartyB'))));

  // B.1.1: the generator, step by step.
  const b11 = vectors['B.1.1.1'].json;
  const [prs, ci, sid] = [fromHex(b11.PRS), fromHex(b11.CI), fromHex(b11.sid)];
  check('B.1.1 PRS is b"Password"', b11.PRS, hex(ascii('Password')));
  check('B.1.1 generator string', b11['generator_string(G.DSI,PRS,CI,sid,H.s_in_bytes)'], hex(generatorString(prs, ci, sid)));
  const genHash = (await provider.sha512(generatorString(prs, ci, sid))).subarray(0, 32);
  check('B.1.1 hash generator string', b11['hash generator string'], hex(genHash));
  check('B.1.1 decoded field element of 255 bits', b11['decoded field element of 255 bits'], hex(decodeUCoordinate(genHash)));
  check('B.1.1 generator g', b11['generator g'], hex(await calculateGenerator(provider, prs, ci, sid)));

  // B.1.2–B.1.7, what needs no X25519: the generator from B.1.9's inputs, the
  // associated data, the transcripts' bytes and the session-ID outputs.
  const b19 = vectors['B.1.9'].json;
  const g = await calculateGenerator(provider, fromHex(b19.PRS), fromHex(b19.CI), fromHex(b19.sid));
  check('B.1.9 g', b19.g, hex(g));
  const [adA, adB] = [fromHex(b19.ADa), fromHex(b19.ADb)];
  check('B.1.9 ADa is b"ADa"', b19.ADa, hex(ascii('ADa')));
  check('B.1.9 ADb is b"ADb"', b19.ADb, hex(ascii('ADb')));
  const [Ya, Yb, sidB] = [fromHex(b19.Ya), fromHex(b19.Yb), fromHex(b19.sid)];
  const ir = transcriptIr(Ya, adA, Yb, adB);
  check('B.1.7 sid_output_ir', b19.sid_output_ir, hex(await sessionIdOutput(provider, ir)));
  check('B.1.7 sid_output_oc', b19.sid_output_oc, hex(await sessionIdOutput(provider, transcriptOc(Ya, adA, Yb, adB))));
  const low = vectors['B.1.10'].text;
  const json = vectors['B.1.10.1'].json as Record<string, string>;
  const names = Object.keys(low.u) as (keyof typeof low.u)[];
  for (const [index, name] of names.entries()) {
    check(`B.1.10.1 Invalid Y${index} is the text's ${name}`, json[`Invalid Y${index}`], low.u[name]);
  }
  if (!x25519) return checks;

  // B.1.2–B.1.6: both shares, K both ways, the ISK both ways in both styles.
  const ya = await provider.x25519FromScalar(fromHex(b19.ya));
  const yb = await provider.x25519FromScalar(fromHex(b19.yb));
  check('B.1.2 Ya', b19.Ya, hex(await shareOf(provider, ya, g)));
  check('B.1.3 Yb', b19.Yb, hex(await shareOf(provider, yb, g)));
  check('B.1.4 K = scalar_mult_vfy(ya, Yb)', b19.K, await outcome(() => provider.x25519(ya, Yb)));
  check('B.1.4 K = scalar_mult_vfy(yb, Ya)', b19.K, await outcome(() => provider.x25519(yb, Ya)));
  check('B.1.5 ISK_IR, initiator A', b19.ISK_IR, await outcome(() => deriveIsk(provider, { scalar: ya, peerShare: Yb, sid: sidB, transcript: ir })));
  check('B.1.5 ISK_IR, responder B', b19.ISK_IR, await outcome(() => deriveIsk(provider, { scalar: yb, peerShare: Ya, sid: sidB, transcript: ir })));
  // Ordered concatenation is the same whichever side lists itself first.
  check('B.1.6 ISK_SY, A', b19.ISK_SY,
    await outcome(() => deriveIsk(provider, { scalar: ya, peerShare: Yb, sid: sidB, transcript: transcriptOc(Ya, adA, Yb, adB) })));
  check('B.1.6 ISK_SY, B', b19.ISK_SY,
    await outcome(() => deriveIsk(provider, { scalar: yb, peerShare: Ya, sid: sidB, transcript: transcriptOc(Yb, adB, Ya, adA) })));

  // B.1.10: low-order points, and u-coordinates with bit 255 set.
  const s = await provider.x25519FromScalar(fromHex(low.s));
  const sPkcs8 = new Uint8Array([...fromHex('302e020100300506032b656e04220420'), ...fromHex(low.s)]);
  for (const name of names) {
    const u = fromHex(low.u[name]);
    const aborts = low.abort.includes(name);
    const q = `q${name.slice(1)}` as keyof typeof low.q;
    check(`B.1.10 ${q} = scalar_mult_vfy(s, ${name})`, aborts ? ABORT : low.q[q], await outcome(() => provider.x25519(s, u)));
    if (aborts) {
      // In a message, it aborts the exchange.
      check(`B.1.10 ${name} as the other side's share aborts`, ABORT,
        await outcome(() => deriveIsk(provider, { scalar: s, peerShare: u, sid: sidB, transcript: ir })));
      if (!subtle) continue;
      // And the engine's WebCrypto refuses it itself, never giving a result:
      // Node's and Chromium's as they derive (OperationError), Firefox's as it
      // imports the value (DataError).
      const own: SubtleCrypto = subtle;
      let engine: string;
      try {
        const priv = await own.importKey('pkcs8', sPkcs8, { name: 'X25519' }, false, ['deriveBits']);
        const pub = await own.importKey('raw', u, { name: 'X25519' }, true, []);
        engine = `gave ${hex(new Uint8Array(await own.deriveBits({ name: 'X25519', public: pub }, priv, 256)))}`;
      } catch (err) {
        const errorName = (err as { name?: string }).name;
        engine = errorName === 'OperationError' || errorName === 'DataError' ? 'refused' : `threw ${errorName}`;
      }
      check(`B.1.10 the engine's WebCrypto refuses ${name}`, 'refused', engine);
    }
  }
  return checks;
}
