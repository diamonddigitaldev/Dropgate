import { afterEach, describe, it, expect, vi } from 'vitest';
import { inspect } from 'node:util';
import vectors from './fixtures/dgdtp-signal-vectors.json';
import { nobleProvider, webCryptoProvider, type CryptoProvider, type NamedCryptoProvider } from '../src/crypto/index.js';
import { parseCode } from '../src/dgdtp/codes.js';
import { cpaceInitiator, cpaceResponder } from '../src/dgdtp/cpace.js';
import { AttemptKeys, deriveAttemptKeys, deriveCloseKeys, deriveRoomId, type AttemptMode } from '../src/dgdtp/keys.js';
import { noiseInitiator, noiseResponder } from '../src/dgdtp/noise.js';
import {
  FRAME_HEADER_BYTES, LARGE_BUCKET_BYTES, MAX_FRAMES_EACH_WAY, MAX_FRAME_BYTES, SDP_BUCKET_BYTES, SMALL_BUCKET_BYTES,
  closeChannel, signalChannel, type SignalChannel, type SignalMessage,
} from '../src/dgdtp/seal.js';
import { fromHex, hex } from './helpers/cpace-vectors.js';
import { MESSAGES, attemptKeys, closeKeys, exporting, signalVectorChecks } from './helpers/signal-checks.js';
// The second implementation: plain JavaScript on node:crypto.
import * as reference from './helpers/reference-signal.mjs';

// DGDTP 4's key schedule (src/dgdtp/keys.ts) and sealed signalling
// (src/dgdtp/seal.ts) on each of core's crypto providers: the pinned vectors
// from a second implementation on node:crypto (tests/helpers/reference-
// signal.mjs), written from the format and not from core, for every output of
// the key schedule in link, code and resume mode, every kind of frame and every
// bucket; then the rules: a flipped bit, a replay, a reorder, a frame from
// another attempt or reflected back from the other direction each end the
// attempt; every frame of a kind the same size; the caps; the CPace abort where
// the receiver waits for the sender's first frame; and nothing secret printed.

const webCrypto = webCryptoProvider(globalThis.crypto);
const noble = nobleProvider(globalThis.crypto);
const PROVIDERS: Array<[string, NamedCryptoProvider]> = [['WebCrypto', webCrypto], ['@noble', noble]];
const MISMATCH = 'SECURITY_POLICY_MISMATCH';
const v = vectors.inputs;
const codeKeys = vectors.schedules.code;

afterEach(() => {
  vi.restoreAllMocks();
});

/** The error a call fails with; fails the test if it doesn't fail. */
async function failure(run: () => Promise<unknown>): Promise<{ code?: string; origin?: string; json: string; err: unknown }> {
  try {
    await run();
  } catch (err) {
    const { code, origin } = err as { code?: string; origin?: string };
    return { code, origin, json: JSON.stringify(err), err };
  }
  throw new Error('expected it to fail');
}

/** A frame the second implementation seals: under `key` (hex), in `direction`, at `counter`, holding `message` or `inside`. */
const crafted = (options: { key: string; direction: number; counter: number; kind?: number; message?: unknown; inside?: Uint8Array; attemptId?: string }) =>
  new Uint8Array(reference.frame({ roomNonce: v.roomNonce, attemptId: v.attemptId, kind: 0x10, ...options, inside: options.inside ? Buffer.from(options.inside) : undefined }));

/** An inside as the second implementation pads one, then changed by `change`. */
const insideChanged = (message: unknown, change: (inside: Buffer) => Buffer = (b) => b) => new Uint8Array(change(Buffer.from(reference.insideOf(message))));

/** A provider, frozen, in a plain object of its own, so a test can spy on one operation. */
const plain = (provider: CryptoProvider): CryptoProvider => ({ ...provider });

/** What the receiver makes of each frame in turn: the message's type, or the error's code. */
async function outcomes(channel: SignalChannel, frames: Uint8Array[]): Promise<string[]> {
  const out: string[] = [];
  for (const frame of frames) {
    try {
      out.push((await channel.open(frame)).type);
    } catch (err) {
      out.push(String((err as { code?: string }).code));
    }
  }
  return out;
}

describe.each(PROVIDERS)('the key schedule and sealed signalling against the second implementation, on %s', (_name, provider) => {
  it('every check gives the vectors\' bytes', async () => {
    const checks = await signalVectorChecks(provider);
    expect(checks.filter(({ expected, actual }) => expected !== actual)).toEqual([]);
    expect(checks.length).toBe(28);
  });

  it('the second implementation makes the schedule from the vectors\' inputs as pinned', () => {
    for (const [mode, base] of [['link', v.linkSecret], ['code', v.isk], ['resume', v.resumeSecret]] as const) {
      expect(reference.keySchedule({ mode, base, roomNonce: v.roomNonce, attemptId: v.attemptId, closeSecret: v.closeSecret })).toEqual(vectors.schedules[mode]);
    }
    expect(reference.signalVectors()).toEqual(vectors);
  });

  it('every mode\'s keys are different, and a new attempt ID makes them all new', async () => {
    const all: string[] = [];
    for (const attemptId of [v.attemptId, '00'.repeat(16)]) {
      for (const mode of ['link', 'code', 'resume'] as AttemptMode[]) {
        const keys = await attemptKeys(exporting(provider), mode, attemptId);
        all.push(await keys.usePsk(hex), hex(await provider.exportKey(keys.sealR2S)), hex(await provider.exportKey(keys.sealS2R)));
      }
    }
    expect(new Set(all).size).toBe(all.length);
    // And the second implementation agrees on the new attempt's.
    const fresh = reference.keySchedule({ mode: 'code', base: v.isk, roomNonce: v.roomNonce, attemptId: '00'.repeat(16), closeSecret: v.closeSecret });
    expect(all.slice(12, 15)).toEqual([fresh.psk, fresh.sealR2S, fresh.sealS2R]);
  });

  it('the room ID depends on S alone, with no salt', async () => {
    const roomId = await deriveRoomId(provider, fromHex(v.linkSecret));
    expect(roomId.byteLength).toBe(16);
    expect(hex(roomId)).toBe(hex(await provider.hkdf(fromHex(v.linkSecret), new Uint8Array(0), new TextEncoder().encode('dropgate/4 dgdtp room'), 16)));
  });

  it('a frame each way opens across the two providers', async () => {
    const other = provider === webCrypto ? noble : webCrypto;
    const receiver = signalChannel(provider, { keys: await attemptKeys(provider), role: 'receiver' });
    const sender = signalChannel(other, { keys: await attemptKeys(other), role: 'sender' });
    expect(await sender.open(await receiver.seal(MESSAGES.receiver[0]))).toEqual(MESSAGES.receiver[0]);
    expect(await receiver.open(await sender.seal(MESSAGES.sender[1]))).toEqual(MESSAGES.sender[1]);
  });
});

describe.each(PROVIDERS)('a frame that isn\'t the next one ends the attempt, on %s', (_name, provider) => {
  const sender = vectors.frames.sender.map((f) => fromHex(f.frame));
  const receiverFrames = vectors.frames.receiver.map((f) => fromHex(f.frame));

  it.each([
    ['an offer (2,048)', 'sender', receiverFrames[0], []],
    ['an answer (2,048)', 'receiver', sender[0], []],
    ['a candidate', 'receiver', sender[1], [sender[0]]],
  ] as const)('every bit of %s flipped is refused, then the genuine frame too', async (_what, role, frame, before) => {
    const keys = await attemptKeys(provider);
    for (let bit = 0; bit < frame.byteLength * 8; bit++) {
      const changed = new Uint8Array(frame);
      changed[bit >> 3] ^= 1 << (bit & 7);
      const channel = signalChannel(provider, { keys, role });
      for (const earlier of before) await channel.open(earlier);
      const results = await outcomes(channel, [changed, frame]);
      if (results[0] !== MISMATCH || results[1] !== MISMATCH) throw new Error(`bit ${bit}: ${results.join(' ')}`);
    }
  }, 120_000);

  it('every bit of an 8,192 frame\'s header, and of its last 64 bytes, flipped is refused', async () => {
    const keys = await attemptKeys(provider);
    const frame = receiverFrames[5];
    const bits = [...Array(FRAME_HEADER_BYTES * 8).keys(), ...Array.from({ length: 512 }, (_, i) => (frame.byteLength - 64) * 8 + i)];
    for (const bit of bits) {
      const changed = new Uint8Array(frame);
      changed[bit >> 3] ^= 1 << (bit & 7);
      const channel = signalChannel(provider, { keys, role: 'sender' });
      for (const earlier of receiverFrames.slice(0, 5)) await channel.open(earlier);
      expect(await outcomes(channel, [changed])).toEqual([MISMATCH]);
    }
  }, 60_000);

  it('a replay, a gap and a reorder each end it, and nothing opens after', async () => {
    const keys = await attemptKeys(provider);
    const run = (frames: Uint8Array[]) => outcomes(signalChannel(provider, { keys, role: 'receiver' }), frames);
    expect(await run([sender[0], sender[1], sender[1], sender[2]])).toEqual(['answer', 'candidate', MISMATCH, MISMATCH]);
    expect(await run([sender[0], sender[2], sender[1]])).toEqual(['answer', MISMATCH, MISMATCH]);
    expect(await run([sender[1], sender[0]])).toEqual([MISMATCH, MISMATCH]);
    expect(await run(sender)).toEqual(MESSAGES.sender.map((m) => m.type));
  });

  it('a frame from an earlier attempt is refused in a new one, whatever its header says, and the new one ends', async () => {
    const later = await attemptKeys(provider, 'code', 'ab'.repeat(16));
    const asLater = new Uint8Array(sender[0]);
    asLater.set(fromHex('ab'.repeat(16)), 2);
    for (const frame of [sender[0], asLater]) {
      const channel = signalChannel(provider, { keys: later, role: 'receiver' });
      // The new attempt's own first frame fails too, after.
      const own = await signalChannel(provider, { keys: later, role: 'sender' }).seal(MESSAGES.sender[0]);
      expect(await outcomes(channel, [frame, own])).toEqual([MISMATCH, MISMATCH]);
    }
    // Sealed by the second implementation under the earlier attempt's key, with the new attempt's ID in its header and associated data.
    const mixed = crafted({ key: codeKeys.sealS2R, direction: 2, counter: 0, message: MESSAGES.sender[0], attemptId: 'ab'.repeat(16) });
    expect(await outcomes(signalChannel(provider, { keys: later, role: 'receiver' }), [mixed])).toEqual([MISMATCH]);
  });

  it('a frame reflected back is refused by its direction\'s key, not just its header', async () => {
    const keys = await attemptKeys(provider);
    // The receiver's own frame, as it was.
    expect(await outcomes(signalChannel(provider, { keys, role: 'receiver' }), [receiverFrames[1]])).toEqual([MISMATCH]);
    // The receiver's key, but direction 2 in the header and the associated data: only the key is wrong.
    const underOwnKey = crafted({ key: codeKeys.sealR2S, direction: 2, counter: 0, message: MESSAGES.sender[0] });
    expect(await outcomes(signalChannel(provider, { keys, role: 'receiver' }), [underOwnKey])).toEqual([MISMATCH]);
    // The same, under the sender's key, opens: so it was the key.
    const genuine = crafted({ key: codeKeys.sealS2R, direction: 2, counter: 0, message: MESSAGES.sender[0] });
    expect(await outcomes(signalChannel(provider, { keys, role: 'receiver' }), [genuine])).toEqual(['answer']);
    // The sender's key and direction 2's header, but direction 1 in the associated data: the associated data is bound.
    const wrongAd = new Uint8Array(crafted({ key: codeKeys.sealS2R, direction: 1, counter: 0, message: MESSAGES.sender[0] }));
    wrongAd[1] = 2;
    expect(await outcomes(signalChannel(provider, { keys, role: 'receiver' }), [wrongAd])).toEqual([MISMATCH]);
  });

  it('each value in the associated data is bound: the room nonce, the counter and the kind', async () => {
    const keys = await attemptKeys(provider);
    const open = (frame: Uint8Array) => outcomes(signalChannel(provider, { keys, role: 'receiver' }), [frame]);
    const otherRoom = new Uint8Array(reference.frame({ key: codeKeys.sealS2R, roomNonce: '00'.repeat(16), attemptId: v.attemptId, direction: 2, counter: 0, kind: 0x10, message: MESSAGES.sender[0] }));
    expect(await open(otherRoom)).toEqual([MISMATCH]);
    const counterInAd = crafted({ key: codeKeys.sealS2R, direction: 2, counter: 1, message: MESSAGES.sender[0] });
    counterInAd.set([0, 0, 0, 0], 18);
    expect(await open(counterInAd)).toEqual([MISMATCH]);
    const kindInAd = crafted({ key: codeKeys.sealS2R, direction: 2, counter: 0, kind: 0x11, message: MESSAGES.sender[0] });
    kindInAd[0] = 0x10;
    expect(await open(kindInAd)).toEqual([MISMATCH]);
    // A close frame, as it is, isn't signalling.
    expect(await open(crafted({ key: codeKeys.sealS2R, direction: 2, counter: 0, kind: 0x11, message: MESSAGES.sender[0] }))).toEqual([MISMATCH]);
  });

  it('an inside that isn\'t exactly one, sealed under the right key, is refused', async () => {
    const keys = await attemptKeys(provider);
    const answer = { type: 'answer', sdp: 'v=0\r\n' };
    const candidate = MESSAGES.sender[1];
    const bad: Array<[string, Uint8Array]> = [
      ['a padding byte not zero', insideChanged(answer, (b) => { b[b.length - 1] = 1; return b; })],
      ['a length past the bucket', insideChanged(answer, (b) => { b.writeUInt16BE(2046, 1); return b; })],
      ['an unknown type', insideChanged({ type: 'restart' }, (b) => { b[0] = 7; return b; })],
      ['type 0', insideChanged({ type: 'restart' }, (b) => { b[0] = 0; return b; })],
      ['an offer from the sender', insideChanged({ type: 'offer', sdp: 'v=0\r\n' })],
      ['a close inside signalling', insideChanged({ type: 'close', body: '00' })],
      ['a candidate padded to 2,048', new Uint8Array(Buffer.concat([reference.insideOf(candidate).subarray(0, 512), Buffer.alloc(1536)]))],
      ['an answer that fits 2,048 padded to 8,192', new Uint8Array(Buffer.concat([reference.insideOf(answer), Buffer.alloc(6144)]))],
      ['an answer padded to 512', insideChanged(answer, (b) => b.subarray(0, 512))],
      ['a restart with a body', insideChanged({ type: 'restart' }, (b) => { b.writeUInt16BE(1, 1); b[3] = 9; return b; })],
      ['a candidate with a byte left over', insideChanged(candidate, (b) => { b.writeUInt16BE(b.readUInt16BE(1) + 1, 1); return b; })],
      ['a candidate cut short', insideChanged(candidate, (b) => { const n = b.readUInt16BE(1); b.writeUInt16BE(n - 1, 1); b[3 + n - 1] = 0; return b; })],
      ['a candidate field running past its body', insideChanged(candidate, (b) => { b.writeUInt16BE(400, 3); return b; })],
      // A candidate's body ending after each of its fields in turn: each field after is missing.
      ...[0, 1, 2].map((fields) => [`a candidate's body ending after ${fields + 1} of its fields`, (() => {
        const c = MESSAGES.sender[1] as Extract<SignalMessage, { type: 'candidate' }>;
        const parts = [Buffer.concat([Buffer.of(0, c.candidate.length), Buffer.from(c.candidate)]), Buffer.of(0, 1, 0x30), Buffer.of(0, 0)];
        const body = Buffer.concat(parts.slice(0, fields + 1));
        return new Uint8Array(Buffer.concat([Buffer.of(3), Buffer.of(0, body.length), body, Buffer.alloc(509 - body.length)]));
      })()] as [string, Uint8Array]),
      ['a candidate\'s body ending inside its line index', (() => {
        const body = Buffer.concat([Buffer.of(0, 1, 0x63), Buffer.of(0, 0), Buffer.of(0)]);
        return new Uint8Array(Buffer.concat([Buffer.of(3), Buffer.of(0, body.length), body, Buffer.alloc(509 - body.length)]));
      })()],
      ['an SDP that isn\'t UTF-8', insideChanged(answer, (b) => { b[3] = 0xff; return b; })],
      ['a candidate that isn\'t UTF-8', insideChanged(candidate, (b) => { b[5] = 0xc3; b[6] = 0x28; return b; })],
    ];
    for (const [what, inside] of bad) {
      const frame = crafted({ key: codeKeys.sealS2R, direction: 2, counter: 0, inside });
      expect([what, ...(await outcomes(signalChannel(provider, { keys, role: 'receiver' }), [frame]))]).toEqual([what, MISMATCH]);
    }
    // And the receiver doesn't send an answer, a restart: refused before anything is sealed.
    const receiver = signalChannel(provider, { keys, role: 'receiver' });
    for (const message of [answer, { type: 'restart' }] as SignalMessage[]) expect((await failure(() => receiver.seal(message))).code).toBe('INVALID_ARGUMENT');
    expect((await failure(() => signalChannel(provider, { keys, role: 'sender' }).seal({ type: 'offer', sdp: '' }))).code).toBe('INVALID_ARGUMENT');
    expect(receiver.sent).toBe(0);
  });

  it('anything that isn\'t a frame\'s size is refused before it\'s opened', async () => {
    const keys = await attemptKeys(provider);
    const wrapped = plain(provider);
    const spy = vi.spyOn(wrapped, 'decryptWithNonce');
    for (const length of [0, 1, FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + 16, 549, 551, 2085, 2087, 8229, MAX_FRAME_BYTES + 1]) {
      const channel = signalChannel(wrapped, { keys, role: 'sender' });
      expect(await outcomes(channel, [new Uint8Array(length)])).toEqual([MISMATCH]);
    }
    expect(await outcomes(signalChannel(wrapped, { keys, role: 'sender' }), ['not bytes' as unknown as Uint8Array])).toEqual([MISMATCH]);
    // A genuine frame's header, with a byte more or less after it.
    const genuine = fromHex(vectors.frames.receiver[1].frame);
    for (const frame of [genuine.subarray(0, genuine.byteLength - 1), new Uint8Array([...genuine, 0])]) {
      const channel = signalChannel(wrapped, { keys, role: 'sender' });
      await channel.open(fromHex(vectors.frames.receiver[0].frame));
      spy.mockClear();
      expect(await outcomes(channel, [frame])).toEqual([MISMATCH]);
      expect(spy).not.toHaveBeenCalled();
    }
    // Nor is anything opened once the attempt is over.
    const closed = signalChannel(wrapped, { keys, role: 'sender' });
    closed.close();
    spy.mockClear();
    expect(await outcomes(closed, [fromHex(vectors.frames.receiver[0].frame)])).toEqual([MISMATCH]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe.each(PROVIDERS)('padding and caps, on %s', (_name, provider) => {
  it('every candidate, end-of-candidates, restart and close is 550 bytes on the wire, whatever it holds', async () => {
    const keys = await attemptKeys(provider);
    const receiver = signalChannel(provider, { keys, role: 'receiver' });
    const sender = signalChannel(provider, { keys, role: 'sender' });
    const small: Array<[SignalChannel, SignalMessage]> = [
      ...MESSAGES.receiver.filter((m) => m.type !== 'offer').map((m) => [receiver, m] as [SignalChannel, SignalMessage]),
      ...MESSAGES.sender.filter((m) => m.type !== 'answer').map((m) => [sender, m] as [SignalChannel, SignalMessage]),
      [receiver, { type: 'candidate', candidate: 'x'.repeat(501), sdpMid: null, sdpMLineIndex: 65534, usernameFragment: null }],
      [sender, { type: 'candidate', candidate: '', sdpMid: null, sdpMLineIndex: null, usernameFragment: null }],
    ];
    for (const [channel, message] of small) expect((await channel.seal(message)).byteLength).toBe(FRAME_HEADER_BYTES + SMALL_BUCKET_BYTES + 16);
    const close = await closeKeys(provider);
    for (const body of [new Uint8Array(0), new Uint8Array(509)]) {
      for (const role of ['receiver', 'sender'] as const) expect((await closeChannel(provider, { keys: close, role }).seal(body)).byteLength).toBe(550);
    }
  });

  it('an offer or answer is 2,048 bytes padded, or 8,192 when larger; over 8,192 is refused before it\'s sealed', async () => {
    const keys = await attemptKeys(provider);
    const wrapped = plain(provider);
    const sealing = vi.spyOn(wrapped, 'encryptWithNonce');
    const receiver = signalChannel(wrapped, { keys, role: 'receiver' });
    const sizes: number[] = [];
    for (const length of [0, 1, 2045, 2046, 8189]) sizes.push((await receiver.seal({ type: 'offer', sdp: 'a'.repeat(length) })).byteLength);
    const frame = (bucket: number) => FRAME_HEADER_BYTES + bucket + 16;
    expect(sizes).toEqual([frame(SDP_BUCKET_BYTES), frame(SDP_BUCKET_BYTES), frame(SDP_BUCKET_BYTES), frame(LARGE_BUCKET_BYTES), frame(LARGE_BUCKET_BYTES)]);
    expect(Math.max(...sizes)).toBe(MAX_FRAME_BYTES);
    // An SDP's bytes, not its characters: 2,045 bytes with a two-byte character in it.
    expect((await receiver.seal({ type: 'offer', sdp: `${'a'.repeat(2043)}é` })).byteLength).toBe(frame(SDP_BUCKET_BYTES));
    expect((await receiver.seal({ type: 'offer', sdp: `${'a'.repeat(2044)}é` })).byteLength).toBe(frame(LARGE_BUCKET_BYTES));
    const calls = sealing.mock.calls.length;
    for (const sdp of ['a'.repeat(8190), `${'a'.repeat(8188)}é`]) {
      const refused = await failure(() => receiver.seal({ type: 'offer', sdp }));
      expect(refused.code).toBe('INVALID_ARGUMENT');
    }
    // A candidate too big for 512 is refused too.
    expect((await failure(() => receiver.seal({ type: 'candidate', candidate: 'x'.repeat(502), sdpMid: null, sdpMLineIndex: null, usernameFragment: null }))).code).toBe('INVALID_ARGUMENT');
    expect(sealing.mock.calls.length).toBe(calls);
    // Nothing changed: the next frame is the next counter, and opens.
    const sent = receiver.sent;
    expect(sent).toBe(7);
    const next = await receiver.seal(MESSAGES.receiver[4]);
    expect(new DataView(next.buffer).getUint32(18)).toBe(sent);
  });

  it('the 4,097th frame one way ends the attempt, sealed or opened', async () => {
    const keys = await attemptKeys(provider);
    const sender = signalChannel(provider, { keys, role: 'sender' });
    const receiver = signalChannel(provider, { keys, role: 'receiver' });
    for (let i = 0; i < MAX_FRAMES_EACH_WAY; i++) await receiver.open(await sender.seal({ type: 'end-of-candidates' }));
    expect(sender.sent).toBe(4096);
    expect(receiver.received).toBe(4096);
    const refused = await failure(() => sender.seal({ type: 'end-of-candidates' }));
    expect(refused.code).toBe(MISMATCH);
    expect(refused.origin).toBe('local');
    // The attempt is over on the sending side: its own signalling too.
    expect((await failure(() => sender.open(new Uint8Array(550)))).code).toBe(MISMATCH);
    // The second implementation's 4,097th frame, which would open, is refused.
    const extra = crafted({ key: codeKeys.sealS2R, direction: 2, counter: 4096, message: { type: 'end-of-candidates' } });
    expect(await outcomes(receiver, [extra])).toEqual([MISMATCH]);
    // And then the receiver can't send either.
    expect((await failure(() => receiver.seal(MESSAGES.receiver[4]))).code).toBe(MISMATCH);
  }, 120_000);
});

describe.each(PROVIDERS)('the attempt\'s start, on %s', (_name, provider) => {
  /** A code-mode exchange whose ISKs go straight into the key schedule, as handOn. */
  async function exchange() {
    const roomNonce = fromHex(v.roomNonce);
    const attemptId = fromHex(v.attemptId);
    const sender = cpaceResponder(provider, { password: parseCode('ABCD-1234').password, locator: 'AB', roomNonce });
    const receiver = cpaceInitiator(provider, { password: parseCode('ABCD-1234').password, locator: 'AB', roomNonce, attemptId });
    const isks: Uint8Array[] = [];
    const schedule = (isk: Uint8Array<ArrayBuffer>) => {
      isks.push(isk);
      return deriveAttemptKeys(provider, { mode: 'code', base: isk, roomNonce, attemptId });
    };
    const { message2 } = await sender.readMessage1(await receiver.writeMessage1());
    const { message3, result: receiverKeys } = await receiver.readMessage2(message2, schedule);
    const { result: senderKeys } = await sender.readMessage3(message3, schedule);
    return { receiverKeys, senderKeys, isks };
  }

  it('CPace hands its ISK to the key schedule, which is done with it before the ISK is overwritten', async () => {
    const { receiverKeys, senderKeys, isks } = await exchange();
    expect(isks).toHaveLength(2);
    for (const isk of isks) expect(isk.every((b) => b === 0)).toBe(true);
    // Both sides' keys still work, so nothing reads the ISK after.
    const receiver = signalChannel(provider, { keys: receiverKeys, role: 'receiver' });
    const sender = signalChannel(provider, { keys: senderKeys, role: 'sender' });
    expect(await sender.open(await receiver.seal(MESSAGES.receiver[0]))).toEqual(MESSAGES.receiver[0]);
    expect(await receiver.open(await sender.seal(MESSAGES.sender[0]))).toEqual(MESSAGES.sender[0]);
    // And the PSKs agree, as Noise will need.
    const prologue = new Uint8Array(131);
    const initiator = await receiverKeys.usePsk((psk) => noiseInitiator(provider, { prologue, psk }));
    const responder = await senderKeys.usePsk((psk) => noiseResponder(provider, { prologue, psk }));
    await responder.readMessage1(await initiator.writeMessage1());
    await initiator.readMessage2((await responder.writeMessage2()).message);
  });

  it('in code mode, an empty message where the receiver waits for the sender\'s first frame is the sender\'s CPace abort', async () => {
    const keys = await attemptKeys(provider, 'code');
    const receiver = signalChannel(provider, { keys, role: 'receiver' });
    expect(await outcomes(receiver, [new Uint8Array(0), fromHex(vectors.frames.sender[0].frame)])).toEqual(['CODE_MISMATCH', MISMATCH]);
    expect((await failure(() => receiver.seal(MESSAGES.receiver[0]))).code).toBe(MISMATCH);
  });

  it('an empty message after the sender\'s first frame, in link or resume mode, or to the sender, is a frame that doesn\'t open', async () => {
    const code = await attemptKeys(provider, 'code');
    const first = fromHex(vectors.frames.sender[0].frame);
    expect(await outcomes(signalChannel(provider, { keys: code, role: 'receiver' }), [first, new Uint8Array(0)])).toEqual(['answer', MISMATCH]);
    expect(await outcomes(signalChannel(provider, { keys: code, role: 'sender' }), [new Uint8Array(0)])).toEqual([MISMATCH]);
    for (const mode of ['link', 'resume'] as const) {
      expect(await outcomes(signalChannel(provider, { keys: await attemptKeys(provider, mode), role: 'receiver' }), [new Uint8Array(0)])).toEqual([MISMATCH]);
    }
  });
});

describe.each(PROVIDERS)('the out-of-band close, on %s', (_name, provider) => {
  it('one each way: a second is refused to seal and ignored when opened; anything that doesn\'t open is ignored', async () => {
    const keys = await closeKeys(provider);
    const receiver = closeChannel(provider, { keys, role: 'receiver' });
    const sender = closeChannel(provider, { keys, role: 'sender' });
    const frame = await sender.seal(Uint8Array.of(1, 2, 3));
    expect((await failure(() => sender.seal(Uint8Array.of(4)))).code).toBe('INVALID_ARGUMENT');
    const flipped = new Uint8Array(frame);
    flipped[300] ^= 1;
    const ignored = [
      flipped,
      await closeChannel(provider, { keys, role: 'receiver' }).seal(Uint8Array.of(9)), // reflected: the receiver's own
      fromHex(vectors.frames.sender[1].frame), // signalling, not a close
      crafted({ key: codeKeys.closeS2R, direction: 2, counter: 1, kind: 0x11, message: { type: 'close', body: '01' } }), // counter 1
      crafted({ key: codeKeys.closeS2R, direction: 2, counter: 0, kind: 0x11, message: { type: 'restart' } }), // not a close inside
      crafted({ key: codeKeys.closeS2R, direction: 2, counter: 0, kind: 0x11, inside: insideChanged({ type: 'close', body: '01' }, (b) => { b[400] = 1; return b; }) }),
      new Uint8Array(0),
    ];
    for (const bad of ignored) expect(await receiver.open(bad)).toBeUndefined();
    expect(hex((await receiver.open(frame)) as Uint8Array)).toBe('010203');
    expect(await receiver.open(frame)).toBeUndefined();
    expect((await failure(() => receiver.seal(new Uint8Array(510)))).code).toBe('INVALID_ARGUMENT');
    // That changed nothing: the receiver's one close can still be sealed, and opens.
    const own = await receiver.seal(new Uint8Array(509).fill(7));
    expect(await closeChannel(provider, { keys, role: 'sender' }).open(own)).toEqual(new Uint8Array(509).fill(7));
    // Two opened at once: only one is taken.
    const again = closeChannel(provider, { keys, role: 'receiver' });
    const both = await Promise.all([again.open(frame), again.open(frame)]);
    expect(both.filter((body) => body !== undefined)).toHaveLength(1);
    // Once one is taken, nothing more is even opened.
    const wrapped = plain(provider);
    const spy = vi.spyOn(wrapped, 'decryptWithNonce');
    const taken = closeChannel(wrapped, { keys, role: 'receiver' });
    expect(await taken.open(frame)).toBeDefined();
    spy.mockClear();
    expect(await taken.open(frame)).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('the close keys are bound to the attempt: another attempt\'s close is ignored', async () => {
    const other = await deriveCloseKeys(provider, { closeSecret: fromHex(v.closeSecret), roomNonce: fromHex(v.roomNonce), attemptId: fromHex('cd'.repeat(16)) });
    expect(await closeChannel(provider, { keys: other, role: 'receiver' }).open(fromHex(vectors.close.sender.frame))).toBeUndefined();
  });
});

describe('the key schedule\'s secrets and checks', () => {
  it('the PSK is given once, then overwritten; forget() lets every key go', async () => {
    const keys = await attemptKeys(webCrypto);
    let held: Uint8Array | undefined;
    await keys.usePsk((psk) => { held = psk; });
    expect(held?.every((b) => b === 0)).toBe(true);
    expect((await failure(() => keys.usePsk(() => undefined))).code).toBe('INVALID_ARGUMENT');
    // Overwritten even when the function throws.
    const again = await attemptKeys(webCrypto);
    await expect(again.usePsk((psk) => { held = psk; throw new Error('used'); })).rejects.toThrow('used');
    expect(held?.every((b) => b === 0)).toBe(true);
    // forget() overwrites an unused PSK, and the sealing keys are gone.
    const unused = await attemptKeys(webCrypto);
    const spy = vi.spyOn(Uint8Array.prototype, 'fill');
    unused.forget();
    expect(spy.mock.contexts.some((c) => (c as Uint8Array).byteLength === 32)).toBe(true);
    spy.mockRestore();
    expect((await failure(() => unused.usePsk(() => undefined))).code).toBe('INVALID_ARGUMENT');
    expect(() => unused.sealR2S).toThrow();
    expect(() => unused.sealS2R).toThrow();
    expect(() => signalChannel(webCrypto, { keys: unused, role: 'receiver' })).toThrow();
    // The PSK goes only to a function, and a call that isn't one leaves it there.
    const kept = await attemptKeys(webCrypto);
    expect((await failure(() => kept.usePsk('psk' as never))).code).toBe('INVALID_ARGUMENT');
    expect(await kept.usePsk(hex)).toBe(codeKeys.psk);
  });

  it('a key that can\'t be made leaves no PSK behind', async () => {
    const made: Uint8Array[] = [];
    const failing: CryptoProvider = {
      ...webCrypto,
      hkdf: async (...args) => {
        const out = await webCrypto.hkdf(...args);
        made.push(out);
        return out;
      },
      deriveContentKey: async () => { throw new Error('no key'); },
    };
    await expect(attemptKeys(failing)).rejects.toThrow('no key');
    expect(made).toHaveLength(1);
    expect(made[0].every((b) => b === 0)).toBe(true);
  });

  it('printed, logged or serialised, nothing secret shows', async () => {
    const log = vi.spyOn(console, 'log');
    const keys = await attemptKeys(webCrypto);
    const close = await closeKeys(webCrypto);
    const shown = [inspect(keys), JSON.stringify(keys), String(keys), inspect(close, { depth: 5 }), JSON.stringify(close), JSON.stringify({ keys })];
    expect(inspect(keys)).toBe('[AttemptKeys]');
    for (const secret of [codeKeys.psk, codeKeys.sealR2S, codeKeys.sealS2R, codeKeys.closeR2S, codeKeys.closeS2R, v.isk, v.closeSecret]) {
      for (const text of shown) expect(text).not.toContain(secret);
    }
    // The keys themselves can't be read out.
    await expect(webCrypto.exportKey(keys.sealR2S)).rejects.toBeTruthy();
    await expect(noble.exportKey((await attemptKeys(noble)).sealS2R)).rejects.toBeTruthy();
    await expect(noble.exportKey((await closeKeys(noble)).closeR2S)).rejects.toBeTruthy();
    // No error says anything about a frame or a key.
    const channel = signalChannel(webCrypto, { keys, role: 'receiver' });
    const err = await failure(() => channel.open(fromHex(vectors.frames.receiver[0].frame)));
    expect(err.json).toBe(JSON.stringify({ name: 'DropgateError', code: MISMATCH, message: "The connection couldn't be secured, so it was closed.", origin: 'peer', retryable: false }));
    expect((err.err as { cause?: unknown }).cause).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it('refuses a base secret of the wrong length for its mode, and any other bad input', async () => {
    const roomNonce = fromHex(v.roomNonce);
    const attemptId = fromHex(v.attemptId);
    const bad: Array<[string, () => Promise<unknown>]> = [
      ['link with 64 bytes', () => deriveAttemptKeys(webCrypto, { mode: 'link', base: fromHex(v.isk), roomNonce, attemptId })],
      ['code with 32 bytes', () => deriveAttemptKeys(webCrypto, { mode: 'code', base: fromHex(v.linkSecret), roomNonce, attemptId })],
      ['resume with 31 bytes', () => deriveAttemptKeys(webCrypto, { mode: 'resume', base: new Uint8Array(31), roomNonce, attemptId })],
      ['another mode', () => deriveAttemptKeys(webCrypto, { mode: 'lan' as AttemptMode, base: fromHex(v.linkSecret), roomNonce, attemptId })],
      ['a mode from the prototype', () => deriveAttemptKeys(webCrypto, { mode: 'toString' as AttemptMode, base: fromHex(v.linkSecret), roomNonce, attemptId })],
      ['a 15-byte room nonce', () => deriveAttemptKeys(webCrypto, { mode: 'link', base: fromHex(v.linkSecret), roomNonce: new Uint8Array(15), attemptId })],
      ['a 17-byte attempt ID', () => deriveAttemptKeys(webCrypto, { mode: 'link', base: fromHex(v.linkSecret), roomNonce, attemptId: new Uint8Array(17) })],
      ['no options', () => deriveAttemptKeys(webCrypto, undefined as never)],
      ['a 16-byte link secret for the room ID', () => deriveRoomId(webCrypto, new Uint8Array(16))],
      ['a 31-byte close secret', () => deriveCloseKeys(webCrypto, { closeSecret: new Uint8Array(31), roomNonce, attemptId })],
      ['a close with no attempt ID', () => deriveCloseKeys(webCrypto, { closeSecret: new Uint8Array(32), roomNonce } as never)],
    ];
    for (const [what, run] of bad) expect([what, (await failure(run)).code]).toEqual([what, 'INVALID_ARGUMENT']);
    const keys = await attemptKeys(webCrypto);
    expect(() => signalChannel(webCrypto, { keys, role: 'peer' as never })).toThrow();
    expect(() => signalChannel(webCrypto, { keys: {} as AttemptKeys, role: 'receiver' })).toThrow();
    expect(() => closeChannel(webCrypto, { keys: keys as never, role: 'receiver' })).toThrow();
    const receiver = signalChannel(webCrypto, { keys, role: 'receiver' });
    const badMessages = [
      null, {}, { type: 'hello' }, { type: 'offer' }, { type: 'offer', sdp: 1 },
      { type: 'candidate', candidate: 'c', sdpMid: 0, sdpMLineIndex: null, usernameFragment: null },
      { type: 'candidate', candidate: 'c', sdpMid: null, sdpMLineIndex: 65535, usernameFragment: null },
      { type: 'candidate', candidate: 'c', sdpMid: null, sdpMLineIndex: -1, usernameFragment: null },
      { type: 'candidate', candidate: 'c', sdpMid: null, sdpMLineIndex: 1.5, usernameFragment: null },
      { type: 'candidate', candidate: null, sdpMid: null, sdpMLineIndex: null, usernameFragment: null },
      { type: 'candidate', candidate: 'c', sdpMid: null, sdpMLineIndex: null, usernameFragment: 4 },
    ];
    for (const message of badMessages) expect([message, (await failure(() => receiver.seal(message as SignalMessage))).code]).toEqual([message, 'INVALID_ARGUMENT']);
    expect(receiver.sent).toBe(0);
    const close = closeChannel(webCrypto, { keys: await closeKeys(webCrypto), role: 'sender' });
    expect((await failure(() => close.seal('x' as never))).code).toBe('INVALID_ARGUMENT');
  });

  it('a candidate\'s null fields go as empty and come back as null; its line index as FFFF', async () => {
    const keys = await attemptKeys(noble);
    const message: SignalMessage = { type: 'candidate', candidate: 'candidate:1 1 udp 1 10.0.0.1 1 typ host', sdpMid: null, sdpMLineIndex: null, usernameFragment: null };
    const frame = await signalChannel(noble, { keys, role: 'receiver' }).seal(message);
    const opened = reference.openFrame({ key: codeKeys.sealR2S, roomNonce: v.roomNonce, frame: Buffer.from(frame) });
    expect(opened.inside.equals(reference.insideOf(message))).toBe(true);
    expect(opened.inside.subarray(3 + 2 + 39 + 2, 3 + 2 + 39 + 2 + 2).toString('hex')).toBe('ffff');
    expect(await signalChannel(noble, { keys, role: 'sender' }).open(frame)).toEqual(message);
  });

  it('frames sealed at once go out in counter order, and frames opened at once are taken in order', async () => {
    const keys = await attemptKeys(webCrypto);
    const receiver = signalChannel(webCrypto, { keys, role: 'receiver' });
    const sender = signalChannel(webCrypto, { keys, role: 'sender' });
    const frames = await Promise.all(MESSAGES.receiver.map((m) => receiver.seal(m)));
    expect(frames.map((f) => new DataView(f.buffer).getUint32(18))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(await Promise.all(frames.map((f) => sender.open(f)))).toEqual(MESSAGES.receiver);
    // A frame's bytes changed by the caller after open() is called don't change what's opened.
    const next = await receiver.seal(MESSAGES.receiver[4]);
    const opening = sender.open(next);
    next.fill(0);
    expect(await opening).toEqual(MESSAGES.receiver[4]);
  });

  it('close() ends the signalling both ways', async () => {
    const keys = await attemptKeys(webCrypto);
    const channel = signalChannel(webCrypto, { keys, role: 'receiver' });
    channel.close();
    expect((await failure(() => channel.seal(MESSAGES.receiver[0]))).code).toBe(MISMATCH);
    expect((await failure(() => channel.open(fromHex(vectors.frames.sender[0].frame)))).code).toBe(MISMATCH);
    expect([channel.sent, channel.received]).toEqual([0, 0]);
  });

  it('the attempt\'s public values it gives are copies', async () => {
    const keys = await attemptKeys(webCrypto);
    keys.attemptId.fill(0);
    keys.roomNonce.fill(0);
    expect(hex(keys.attemptId)).toBe(v.attemptId);
    expect(hex(keys.roomNonce)).toBe(v.roomNonce);
    expect(hex(await signalChannel(webCrypto, { keys, role: 'receiver' }).seal(MESSAGES.receiver[0]))).toBe(vectors.frames.receiver[0].frame);
  });
});
