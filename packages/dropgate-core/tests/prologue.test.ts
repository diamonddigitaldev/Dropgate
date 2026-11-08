import { describe, it, expect, vi, afterEach } from 'vitest';
import vectors from './fixtures/dgdtp-prologue-vectors.json';
import {
  FINGERPRINT_BYTES, MAX_GENERATION, PROLOGUE_BYTES, buildPrologue, prologueFromSdp, sdpFingerprint, type PrologueInput,
} from '../src/dgdtp/prologue.js';
import { fromHex, hex } from './helpers/cpace-vectors.js';
// The second implementation: plain JavaScript, written from the format.
import * as reference from './helpers/reference-prologue.mjs';

// DGDTP 4's DTLS binding (src/dgdtp/prologue.ts): the one SHA-256 fingerprint
// each side's SDP gives, and the 131-byte prologue Noise hashes in first,
// against the pinned vectors from a second implementation (tests/helpers/
// reference-prologue.mjs), written from the format and not from core. Then the
// prologue's rules: both sides build the same one from the OFFER's and the
// ANSWER's fingerprints in the one order, and any difference in either
// fingerprint, or in any other field, changes it. No crypto here: the
// handshake over it is tests/channel.test.ts'.

const v = vectors.inputs;

const base = (): PrologueInput => ({
  mode: 'link', roomNonce: fromHex(v.roomNonce), attemptId: fromHex(v.attemptId), generation: 0n,
  receiverFingerprint: fromHex(v.receiverFingerprint), senderFingerprint: fromHex(v.senderFingerprint),
});

const flipBit = (bytes: Uint8Array, bit: number) => {
  const out = new Uint8Array(bytes);
  out[bit >> 3] ^= 1 << (bit & 7);
  return out;
};

/** The error a call throws: its code and JSON. Fails the test if it doesn't throw. */
function thrown(run: () => unknown): { code?: string; json: string; err: unknown } {
  try {
    run();
  } catch (err) {
    return { code: (err as { code?: string }).code, json: JSON.stringify(err), err };
  }
  throw new Error('expected it to throw');
}

/** What the second implementation reads from `sdp`, so the two agree on the edges too. */
const referencePrologueAgrees = (sdp: string) => reference.fingerprintOf(sdp);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the DTLS binding against the second implementation', () => {
  it('the second implementation makes the vectors as pinned', () => {
    expect(JSON.parse(JSON.stringify(reference.prologueVectors()))).toEqual(vectors);
  });

  it.each(vectors.fingerprints.map((c) => [c.name, c] as const))('the fingerprint rule: %s', (_name, c) => {
    if (c.fingerprint === null) {
      const err = thrown(() => sdpFingerprint(c.sdp));
      expect(err.code).toBe('SECURITY_POLICY_MISMATCH');
      // Nothing from the SDP in the error.
      expect(err.json).toBe(JSON.stringify({ name: 'DropgateError', code: 'SECURITY_POLICY_MISMATCH', message: "The connection couldn't be secured, so it was closed.", origin: 'peer', retryable: false }));
      expect((err.err as { cause?: unknown }).cause).toBeUndefined();
    } else {
      expect(hex(sdpFingerprint(c.sdp))).toBe(c.fingerprint);
    }
  });

  it.each(vectors.prologues.map((p) => [p.name, p] as const))('the prologue: %s', (_name, p) => {
    const prologue = buildPrologue({ ...base(), mode: p.mode as PrologueInput['mode'], generation: BigInt(p.generation) });
    expect(prologue.byteLength).toBe(PROLOGUE_BYTES);
    expect(hex(prologue)).toBe(p.prologue);
  });

  it("the handshake vector's prologue comes from its offer's and answer's fingerprints", () => {
    const hs = vectors.handshake;
    expect(hex(prologueFromSdp({ mode: 'link', roomNonce: fromHex(v.roomNonce), attemptId: fromHex(v.attemptId), generation: 0n, offer: hs.offer, answer: hs.answer }))).toBe(hs.prologue);
  });

  it('the layout is the format\'s, field by field', () => {
    const p = buildPrologue({ ...base(), mode: 'resume', generation: 0x0102030405060708n });
    expect(new TextDecoder().decode(p.subarray(0, 25))).toBe('dropgate/4 dgdtp prologue');
    expect([...p.subarray(25, 27)]).toEqual([4, 3]);
    expect(hex(p.subarray(27, 43))).toBe(v.roomNonce);
    expect(hex(p.subarray(43, 59))).toBe(v.attemptId);
    expect(hex(p.subarray(59, 67))).toBe('0102030405060708');
    expect(hex(p.subarray(67, 99))).toBe(v.receiverFingerprint);
    expect(hex(p.subarray(99, 131))).toBe(v.senderFingerprint);
  });
});

describe('the prologue both sides build', () => {
  it('is the same from either side\'s view: the OFFER\'s fingerprint first, whichever side made it', () => {
    const { offer, answer } = vectors.handshake;
    const common = { mode: 'code' as const, roomNonce: fromHex(v.roomNonce), attemptId: fromHex(v.attemptId), generation: 3n };
    // The receiver's own offer and the answer it opened; the sender's opened offer and its own answer.
    const receiverView = prologueFromSdp({ ...common, offer, answer });
    const senderView = prologueFromSdp({ ...common, answer, offer });
    expect(hex(receiverView)).toBe(hex(senderView));
    // The order is the roles', not the order the SDPs are given in or which is larger.
    const swapped = prologueFromSdp({ ...common, offer: answer, answer: offer });
    expect(hex(swapped)).not.toBe(hex(receiverView));
  });

  it('any difference in either fingerprint changes it: every bit of each', () => {
    const genuine = hex(buildPrologue(base()));
    const seen = new Set([genuine]);
    for (const which of ['receiverFingerprint', 'senderFingerprint'] as const) {
      for (let bit = 0; bit < FINGERPRINT_BYTES * 8; bit++) {
        seen.add(hex(buildPrologue({ ...base(), [which]: flipBit(base()[which], bit) })));
      }
    }
    expect(seen.size).toBe(1 + 2 * FINGERPRINT_BYTES * 8);
  });

  it('every other field is bound: the major, the mode, the room nonce, the attempt ID and the generation', () => {
    const genuine = hex(buildPrologue(base()));
    const changed = [
      buildPrologue({ ...base(), major: 5 }),
      buildPrologue({ ...base(), mode: 'code' }),
      buildPrologue({ ...base(), mode: 'resume' }),
      buildPrologue({ ...base(), roomNonce: flipBit(base().roomNonce, 127) }),
      buildPrologue({ ...base(), attemptId: flipBit(base().attemptId, 0) }),
      buildPrologue({ ...base(), generation: 1n }),
      buildPrologue({ ...base(), generation: 1n << 63n }),
    ].map(hex);
    for (const p of changed) expect(p).not.toBe(genuine);
    expect(new Set(changed).size).toBe(changed.length);
  });

  it('a fingerprint the rule refuses in either SDP is SECURITY_POLICY_MISMATCH, whichever it is', () => {
    const { offer, answer } = vectors.handshake;
    const refused = vectors.fingerprints.filter((c) => c.fingerprint === null);
    const common = { mode: 'link' as const, roomNonce: fromHex(v.roomNonce), attemptId: fromHex(v.attemptId), generation: 0n };
    for (const c of refused) {
      expect(thrown(() => prologueFromSdp({ ...common, offer: c.sdp, answer })).code).toBe('SECURITY_POLICY_MISMATCH');
      expect(thrown(() => prologueFromSdp({ ...common, offer, answer: c.sdp })).code).toBe('SECURITY_POLICY_MISMATCH');
    }
  });

  it('the fingerprint rule reads values by their bytes: case and line endings don\'t matter, a different value does', () => {
    const fp = fromHex(v.receiverFingerprint);
    const upper = reference.colons(v.receiverFingerprint);
    const lower = reference.colons(v.receiverFingerprint, true);
    const sdp = (lines: string[], eol = '\r\n') => reference.sdpWith({ type: 'offer', ufrag: 'tttt', fingerprintLines: lines, eol });
    expect(hex(sdpFingerprint(sdp([`a=fingerprint:sha-256 ${upper}`, `a=fingerprint:Sha-256 ${lower}`])))).toBe(hex(fp));
    expect(hex(sdpFingerprint(sdp([`a=fingerprint:sha-256 ${lower}`], '\n')))).toBe(hex(fp));
    // One byte different, in a second line: two values.
    const other = reference.colons(hex(flipBit(fp, 255)));
    expect(thrown(() => sdpFingerprint(sdp([`a=fingerprint:sha-256 ${upper}`, `a=fingerprint:sha-256 ${other}`]))).code).toBe('SECURITY_POLICY_MISMATCH');
    // A line that only looks like one (another attribute, a different case of the attribute, or one holding the text) isn't read.
    expect(hex(sdpFingerprint(sdp([`a=fingerprint:sha-256 ${upper}`, `a=fingerprint-x:sha-256 ${other}`, `a=Fingerprint:sha-256 ${other}`, `a=x-note:a=fingerprint:sha-256 ${other}`])))).toBe(hex(fp));
    // Space before the hash function's name, and more than one between it and the value, are only spacing.
    expect(hex(sdpFingerprint(sdp([`a=fingerprint: sha-256 ${upper}`])))).toBe(hex(fp));
    expect(hex(sdpFingerprint(sdp([`a=fingerprint:sha-256  \t ${upper}`])))).toBe(hex(fp));
    expect(referencePrologueAgrees(sdp([`a=fingerprint: sha-256  \t ${upper}`, `a=x-note:a=fingerprint:sha-256 ${other}`]))).toBe(hex(fp));
    // Not a string at all.
    expect(thrown(() => sdpFingerprint(undefined as unknown as string)).code).toBe('SECURITY_POLICY_MISMATCH');
  });

  it('refuses inputs that aren\'t a prologue\'s, INVALID_ARGUMENT', () => {
    const bad: Array<Partial<PrologueInput> & Record<string, unknown>> = [
      { mode: 'other' as PrologueInput['mode'] },
      { mode: 'toString' as PrologueInput['mode'] },
      { roomNonce: new Uint8Array(15) },
      { attemptId: new Uint8Array(17) },
      { generation: -1n },
      { generation: MAX_GENERATION + 1n },
      { generation: 1 as unknown as bigint },
      { receiverFingerprint: new Uint8Array(31) },
      { senderFingerprint: new Uint8Array(33) },
      { major: 256 },
      { major: -1 },
      { major: 4.5 },
    ];
    for (const change of bad) expect(thrown(() => buildPrologue({ ...base(), ...change } as PrologueInput)).code).toBe('INVALID_ARGUMENT');
    expect(thrown(() => buildPrologue(undefined as unknown as PrologueInput)).code).toBe('INVALID_ARGUMENT');
    expect(hex(buildPrologue({ ...base(), generation: MAX_GENERATION })).slice(118, 134)).toBe('ffffffffffffffff');
  });

  it('nothing here logs', () => {
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    for (const c of vectors.fingerprints) {
      try {
        sdpFingerprint(c.sdp);
      } catch {
        // Refused, as the vectors say.
      }
    }
    buildPrologue(base());
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
