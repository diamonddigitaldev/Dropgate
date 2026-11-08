// DGDTP 4's key schedule and sealed signalling against the second
// implementation's pinned vectors (tests/fixtures/dgdtp-signal-vectors.json,
// from tests/helpers/reference-signal.mjs), as one list of checks: each a
// name, what should happen and what did. tests/signal.test.ts runs them in
// Node on each provider, and the integration suite's core/crypto-vectors.spec.mjs
// runs the same code (bundled from tests/browser/vectors-entry.ts) in Chromium,
// Firefox and WebKit, so each engine's HKDF and AES-GCM with associated data
// are held to the same bytes. Nothing here uses Node.
import vectors from '../fixtures/dgdtp-signal-vectors.json';
import type { CryptoProvider } from '../../src/crypto/index.js';
import { deriveAttemptKeys, deriveCloseKeys, deriveRoomId, type AttemptMode } from '../../src/dgdtp/keys.js';
import { closeChannel, signalChannel, type SignalMessage } from '../../src/dgdtp/seal.js';
import { fromHex, hex, type VectorCheck } from './cpace-vectors.js';

const v = vectors.inputs;
const BASES: Record<AttemptMode, string> = { link: v.linkSecret, code: v.isk, resume: v.resumeSecret };
const MODES = Object.keys(BASES) as AttemptMode[];

/**
 * `provider`, but with each derived AES key made as HKDF's bytes imported
 * exportable, so a test can read the key the schedule asked for. Only the
 * schedule's inputs are checked this way; the frames check the real keys.
 */
export const exporting = (provider: CryptoProvider): CryptoProvider => ({
  ...provider,
  deriveContentKey: async (ikm, salt, info) => provider.importKey(await provider.hkdf(ikm, salt, info, 32), true),
});

/** An attempt's keys from the vectors' inputs. */
export const attemptKeys = (provider: CryptoProvider, mode: AttemptMode = 'code', attemptId = v.attemptId) =>
  deriveAttemptKeys(provider, { mode, base: fromHex(BASES[mode]), roomNonce: fromHex(v.roomNonce), attemptId: fromHex(attemptId) });

export const closeKeys = (provider: CryptoProvider) =>
  deriveCloseKeys(provider, { closeSecret: fromHex(v.closeSecret), roomNonce: fromHex(v.roomNonce), attemptId: fromHex(v.attemptId) });

/** The vectors' messages, as core's types. */
export const MESSAGES = vectors.messages as unknown as { receiver: SignalMessage[]; sender: SignalMessage[] };

const codeOf = (err: unknown) => String((err as { code?: string })?.code ?? err);

/** Every check, run on `provider`. */
export async function signalVectorChecks(provider: CryptoProvider): Promise<VectorCheck[]> {
  const checks: VectorCheck[] = [];
  const check = async (name: string, expected: string, run: () => Promise<string>) => {
    let actual: string;
    try {
      actual = await run();
    } catch (err) {
      actual = `threw ${codeOf(err)}: ${(err as Error)?.message}`;
    }
    checks.push({ name, expected, actual });
  };

  // The key schedule: every output, in every mode.
  for (const mode of MODES) {
    const want = vectors.schedules[mode] as Record<string, string>;
    if (mode === 'link') {
      await check('link mode: roomId', want.roomId, async () => hex(await deriveRoomId(provider, fromHex(v.linkSecret))));
    }
    await check(`${mode} mode: psk`, want.psk, async () => (await attemptKeys(provider, mode)).usePsk(hex));
    const exported = exporting(provider);
    await check(`${mode} mode: sealR2S and sealS2R`, `${want.sealR2S} ${want.sealS2R}`, async () => {
      const keys = await attemptKeys(exported, mode);
      return `${hex(await provider.exportKey(keys.sealR2S))} ${hex(await provider.exportKey(keys.sealS2R))}`;
    });
  }
  await check('closeR2S and closeS2R', `${vectors.schedules.code.closeR2S} ${vectors.schedules.code.closeS2R}`, async () => {
    const keys = await closeKeys(exporting(provider));
    return `${hex(await provider.exportKey(keys.closeR2S))} ${hex(await provider.exportKey(keys.closeS2R))}`;
  });

  // Each side's frames, sealed as the vectors have them, and opened by the other side.
  const keys = await attemptKeys(provider);
  for (const [role, peer] of [['receiver', 'sender'], ['sender', 'receiver']] as const) {
    const want = vectors.frames[role];
    await check(`the ${role}'s frames, sealed`, want.map((f) => f.frame).join(' '), async () => {
      const channel = signalChannel(provider, { keys, role });
      const frames: string[] = [];
      for (const message of MESSAGES[role]) frames.push(hex(await channel.seal(message)));
      return frames.join(' ');
    });
    await check(`the ${role}'s frames, opened by the ${peer}`, JSON.stringify(MESSAGES[role]), async () => {
      const channel = signalChannel(provider, { keys, role: peer });
      const opened: SignalMessage[] = [];
      for (const f of want) opened.push(await channel.open(fromHex(f.frame)));
      return JSON.stringify(opened);
    });
  }
  const close = await closeKeys(provider);
  for (const [role, peer] of [['receiver', 'sender'], ['sender', 'receiver']] as const) {
    const want = vectors.close[role];
    await check(`the ${role}'s close, sealed`, want.frame, async () => hex(await closeChannel(provider, { keys: close, role }).seal(fromHex(want.body))));
    await check(`the ${role}'s close, opened by the ${peer}`, want.body, async () => {
      const body = await closeChannel(provider, { keys: close, role: peer }).open(fromHex(want.frame));
      return body ? hex(body) : 'ignored';
    });
  }

  // What ends an attempt: each frame the receiver gets that isn't the next one.
  const fromSender = vectors.frames.sender.map((f) => fromHex(f.frame));
  const ending = async (frames: Uint8Array[]) => {
    const channel = signalChannel(provider, { keys, role: 'receiver' });
    const outcomes: string[] = [];
    for (const frame of frames) {
      try {
        outcomes.push((await channel.open(frame)).type);
      } catch (err) {
        outcomes.push(codeOf(err));
      }
    }
    return outcomes.join(' ');
  };
  const flipped = (frame: Uint8Array, at: number) => {
    const copy = new Uint8Array(frame);
    copy[at] ^= 0x01;
    return copy;
  };
  const MISMATCH = 'SECURITY_POLICY_MISMATCH';
  for (const [what, at] of [['its header', 20], ['its ciphertext', 100], ['its tag', -1]] as const) {
    const answer = fromSender[0];
    await check(`an answer with a bit flipped in ${what}, then the genuine one`, `${MISMATCH} ${MISMATCH}`,
      () => ending([flipped(answer, at < 0 ? answer.byteLength - 1 : at), answer]));
  }
  await check('a candidate with a bit flipped, after the answer', `answer ${MISMATCH} ${MISMATCH}`,
    () => ending([fromSender[0], flipped(fromSender[1], 300), fromSender[1]]));
  await check('a frame replayed', `answer ${MISMATCH}`, () => ending([fromSender[0], fromSender[0]]));
  await check('two frames reordered', `${MISMATCH} ${MISMATCH}`, () => ending([fromSender[1], fromSender[0]]));
  await check('a frame skipped', `answer ${MISMATCH}`, () => ending([fromSender[0], fromSender[2]]));
  await check("the receiver's own frame reflected back to it", MISMATCH, () => ending([fromHex(vectors.frames.receiver[0].frame)]));
  await check("the receiver's own frame reflected back, its direction byte changed", MISMATCH, () => {
    const reflected = fromHex(vectors.frames.receiver[1].frame);
    reflected[1] = 2;
    return ending([reflected]);
  });
  await check('a frame from an earlier attempt, in a new one', MISMATCH, async () => {
    const later = await attemptKeys(provider, 'code', 'ff'.repeat(16));
    const channel = signalChannel(provider, { keys: later, role: 'receiver' });
    try {
      return (await channel.open(fromSender[0])).type;
    } catch (err) {
      return codeOf(err);
    }
  });
  await check('a frame from an earlier attempt, its attempt ID changed to the new one', MISMATCH, async () => {
    const id = 'ff'.repeat(16);
    const later = await attemptKeys(provider, 'code', id);
    const replayed = new Uint8Array(fromSender[0]);
    replayed.set(fromHex(id), 2);
    try {
      return (await signalChannel(provider, { keys: later, role: 'receiver' }).open(replayed)).type;
    } catch (err) {
      return codeOf(err);
    }
  });
  // The same message, under another mode's base secret, doesn't open.
  await check('a frame sealed in link mode, opened in code mode', MISMATCH, async () => {
    const link = signalChannel(provider, { keys: await attemptKeys(provider, 'link'), role: 'sender' });
    return ending([await link.seal(MESSAGES.sender[0])]);
  });
  return checks;
}
