import { allZero, lowOrder } from '../crypto/common.js';
import type { CryptoProvider, X25519Key } from '../crypto/index.js';
import { DropgateError } from '../errors.js';
import { PROTOCOLS, type ProtocolVersion } from '../version.js';
import { CODE_LETTERS, CodePassword } from './codes.js';

// CPace, CPACE-X25519-SHA512 (draft-irtf-cfrg-cpace-21): the PAKE a typed
// code runs, so two devices that know the same short password end up with the
// same 64-byte ISK while nobody watching, the server included, can test a
// guess offline. The scalar maths is the provider's X25519 (WebCrypto's
// where it can); the generator's map is Elligator 2 (crypto/elligator.ts).
//
// The draft's own Appendix B.1 and B.1.10 vectors pin every value here
// (tests/cpace.test.ts, and in Chromium, Firefox and WebKit through the
// integration suite).
//
// The exchange, through the rendezvous, the receiver as initiator A and the
// sender as responder B (so a sender's own message sent back to it can't
// complete), with explicit key confirmation (the draft's §10.4):
//
//   1  A -> B  attemptId (16), Ya (32), ADa (3)
//   2  B -> A  Yb (32), ADb (3), Tb (64)       or an abort (empty)
//   3  A -> B  Ta (64)                         or an abort (empty)
//
// B finds the ISK from message 1 and sends Tb; A checks Tb before it makes
// Ta; B checks Ta before it hands the ISK on, so nothing sealed under keys
// from it can be opened before then. A share that isn't 32 bytes, a share
// that makes K all zeros, a confirmation that doesn't match or an abort is
// CODE_MISMATCH, and whichever side finds it sends the other an abort. B runs
// once per code, right or wrong: its password is spent by the first message 1.
//
// The password's bytes are overwritten as soon as the generator is made, and
// the generator as soon as this side's share is. The shared point K never
// leaves this file: it's hashed into the ISK and overwritten. The ISK is
// handed on to the caller's function, then overwritten too. Nothing here
// logs, and no error carries a secret or anything from a message.

/** The draft's domain separator for G_X25519. */
const DSI = 'CPace255';
/** The domain separator for the ISK: DSI ‖ "_ISK". */
const DSI_ISK = 'CPace255_ISK';
/** What the optional session-ID output hashes in front of the transcript. */
const SID_OUTPUT = 'CPaceSidOutput';
/** SHA-512's input block, `H.s_in_bytes`. */
const SHA512_BLOCK_BYTES = 128;
/** G_X25519's field elements, scalars and shares. */
const FIELD_BYTES = 32;

const ascii = (text: string) => new TextEncoder().encode(text);

const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
};

/** `data`'s length in LEB128, then `data` (the draft's prepend_len). */
export function prependLen(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const length: number[] = [];
  let n = data.byteLength;
  do {
    length.push(n < 128 ? n : (n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  } while (n > 0);
  return concat(Uint8Array.from(length), data);
}

/** Each part with its length in front, one after another (the draft's lv_cat). */
export function lvCat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  return concat(...parts.map(prependLen));
}

/**
 * The string hashed to make the generator: `lv_cat(DSI, PRS, zero padding,
 * CI, sid)`, the padding filling SHA-512's first block so the hash's work
 * doesn't depend on the password's length.
 */
export function generatorString(prs: Uint8Array, ci: Uint8Array, sid: Uint8Array): Uint8Array<ArrayBuffer> {
  const dsi = ascii(DSI);
  const zpad = Math.max(0, SHA512_BLOCK_BYTES - 1 - prependLen(prs).byteLength - prependLen(dsi).byteLength);
  return lvCat(dsi, prs, new Uint8Array(zpad), ci, sid);
}

/**
 * The generator for this password, channel and session: the first 32 bytes of
 * SHA-512 of the generator string, decoded with bit 255 cleared, mapped to
 * the curve with Elligator 2 (the draft's §8.2).
 */
export async function calculateGenerator(
  provider: CryptoProvider, prs: Uint8Array, ci: Uint8Array, sid: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  // The generator string holds the password: overwritten once hashed.
  const input = generatorString(prs, ci, sid);
  let hash: Uint8Array<ArrayBuffer>;
  try {
    hash = await provider.sha512(input);
  } finally {
    input.fill(0);
  }
  try {
    return provider.elligator2(hash.subarray(0, FIELD_BYTES));
  } finally {
    hash.fill(0);
  }
}

/** The share a private scalar makes with this generator: X25519(y, g). */
export async function shareOf(provider: CryptoProvider, scalar: X25519Key, generator: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return provider.x25519(scalar, generator);
}

/** One side's start: a fresh random scalar, and its share for this generator. */
export async function newShare(provider: CryptoProvider, generator: Uint8Array): Promise<{ scalar: X25519Key; share: Uint8Array<ArrayBuffer> }> {
  const { privateKey } = await provider.x25519Generate();
  return { scalar: privateKey, share: await shareOf(provider, privateKey, generator) };
}

/** The initiator–responder transcript: `lv_cat(Ya, ADa) ‖ lv_cat(Yb, ADb)`. */
export function transcriptIr(ya: Uint8Array, adA: Uint8Array, yb: Uint8Array, adB: Uint8Array): Uint8Array<ArrayBuffer> {
  return concat(lvCat(ya, adA), lvCat(yb, adB));
}

/** Whether `a` comes after `b`, byte by byte, the longer winning a tie (the draft's lexiographically_larger). */
const larger = (a: Uint8Array, b: Uint8Array) => {
  for (let i = 0; i < Math.min(a.byteLength, b.byteLength); i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return a.byteLength > b.byteLength;
};

/** `"oc"`, then the larger of the two, then the other (the draft's o_cat). */
export function orderedCat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  return larger(a, b) ? concat(ascii('oc'), a, b) : concat(ascii('oc'), b, a);
}

/** The ordered transcript, for when neither side is the initiator: `o_cat(lv_cat(Ya, ADa), lv_cat(Yb, ADb))`. */
export function transcriptOc(ya: Uint8Array, adA: Uint8Array, yb: Uint8Array, adB: Uint8Array): Uint8Array<ArrayBuffer> {
  return orderedCat(lvCat(ya, adA), lvCat(yb, adB));
}

/**
 * The intermediate session key: `SHA-512(lv_cat("CPace255_ISK", sid, K) ‖
 * transcript)`, where K is X25519 of this side's scalar and the other side's
 * share. A share that isn't 32 bytes, or that makes K all zeros (a low-order
 * point), throws, which is the draft's abort. K is overwritten here and never
 * returned.
 */
export async function deriveIsk(
  provider: CryptoProvider,
  input: { scalar: X25519Key; peerShare: Uint8Array; sid: Uint8Array; transcript: Uint8Array },
): Promise<Uint8Array<ArrayBuffer>> {
  if (input.peerShare.byteLength !== FIELD_BYTES) {
    throw new DropgateError({ code: 'INVALID_ARGUMENT', message: `A CPace share is ${FIELD_BYTES} bytes.` });
  }
  const k = await provider.x25519(input.scalar, input.peerShare);
  // Both providers refuse a low-order share themselves; this is a second guard.
  if (allZero(k)) throw lowOrder();
  const hashed = concat(lvCat(ascii(DSI_ISK), input.sid, k), input.transcript);
  k.fill(0);
  try {
    return await provider.sha512(hashed);
  } finally {
    hashed.fill(0);
  }
}

/** The optional session-ID output both sides can agree on: `SHA-512("CPaceSidOutput" ‖ transcript)`. */
export async function sessionIdOutput(provider: CryptoProvider, transcript: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return provider.sha512(concat(ascii(SID_OUTPUT), transcript));
}

// The exchange.

/** The sender's random bytes for the room, which the rendezvous publishes: the first half of sid. */
export const CPACE_ROOM_NONCE_BYTES = 16;

/** The receiver's random bytes for one attempt: the second half of sid. */
export const CPACE_ATTEMPT_ID_BYTES = 16;

/** ADa and ADb: the role, then the DGDTP major and minor. */
const AD_BYTES = 3;

/** Ta and Tb: HMAC-SHA-512. */
const CONFIRMATION_BYTES = 64;

/** Message 1: attemptId, Ya, ADa. */
export const CPACE_MESSAGE1_BYTES = CPACE_ATTEMPT_ID_BYTES + FIELD_BYTES + AD_BYTES;

/** Message 2: Yb, ADb, Tb. */
export const CPACE_MESSAGE2_BYTES = FIELD_BYTES + AD_BYTES + CONFIRMATION_BYTES;

/** Message 3: Ta. */
export const CPACE_MESSAGE3_BYTES = CONFIRMATION_BYTES;

/** The first byte of ADa and of ADb. */
const ROLE_RECEIVER = 0x01;
const ROLE_SENDER = 0x02;

/** CI's first part, the protocol's; the roles and the locator follow. */
const CI_LABEL = 'dropgate/4 dgdtp cpace';

/** What the confirmation key hashes in front of sid and the ISK. */
const MAC_LABEL = 'CPaceMac';

/** The code didn't match, or the other side aborted. It says nothing more. */
const mismatch = () => new DropgateError({ code: 'CODE_MISMATCH' });

const invalid = (message: string) => new DropgateError({ code: 'INVALID_ARGUMENT', message });

/**
 * What a side sends in place of message 2 or 3 when its exchange fails: an
 * empty message, which the other side takes as CODE_MISMATCH.
 */
export const cpaceAbort = (): Uint8Array<ArrayBuffer> => new Uint8Array(0);

const isAbort = (message: unknown) => message instanceof Uint8Array && message.byteLength === 0;

/**
 * For what the receiver gets from the sender after message 3, until the
 * attempt's first sealed frame opens: the sender's abort (its check of Ta
 * failed) is CODE_MISMATCH. Anything else is left to whatever reads it.
 */
export function checkCpaceAbort(message: unknown): void {
  if (isAbort(message)) throw mismatch();
}

/** CI: `lv_cat("dropgate/4 dgdtp cpace", "receiver", "sender", locator)`, never sent. */
export const channelIdentifier = (locator: string): Uint8Array<ArrayBuffer> =>
  lvCat(ascii(CI_LABEL), ascii('receiver'), ascii('sender'), ascii(locator));

/** A side's ADa or ADb: its role, then its DGDTP version. */
const associatedData = (role: number, version: ProtocolVersion) => Uint8Array.of(role, version.major, version.minor);

/** The confirmation key: `SHA-512("CPaceMac" ‖ sid ‖ ISK)`. */
async function confirmationKey(provider: CryptoProvider, sid: Uint8Array, isk: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const input = concat(ascii(MAC_LABEL), sid, isk);
  try {
    return await provider.sha512(input);
  } finally {
    input.fill(0);
  }
}

/** Ta or Tb: `HMAC-SHA-512(mac_key, lv_cat(Y, AD))` of the side that sent Y and AD. */
const confirmation = (provider: CryptoProvider, macKey: Uint8Array, share: Uint8Array, ad: Uint8Array) =>
  provider.hmac('SHA-512', macKey, lvCat(share, ad));

/** Whether `received` is the confirmation `share` and `ad`'s sender should have made, compared in constant time. */
async function confirms(provider: CryptoProvider, macKey: Uint8Array, share: Uint8Array, ad: Uint8Array, received: Uint8Array): Promise<boolean> {
  const expected = await confirmation(provider, macKey, share, ad);
  try {
    return provider.equal(expected, received);
  } finally {
    expected.fill(0);
  }
}

/**
 * This side's start: the password spent on the generator, then a fresh
 * scalar and its share. The password's bytes and the generator are
 * overwritten once used. A password already spent is CODE_MISMATCH: a code
 * is used once.
 */
async function ownShare(provider: CryptoProvider, password: CodePassword, ci: Uint8Array, sid: Uint8Array) {
  const prs = CodePassword.spend(password);
  if (!prs) throw mismatch();
  let generator: Uint8Array<ArrayBuffer>;
  try {
    generator = await calculateGenerator(provider, prs, ci, sid);
  } finally {
    prs.fill(0);
  }
  try {
    return await newShare(provider, generator);
  } finally {
    generator.fill(0);
  }
}

/**
 * The ISK and the confirmation key, from this side's scalar and the other
 * side's share. A low-order share (the provider's INVALID_ARGUMENT) is
 * CODE_MISMATCH. K never leaves deriveIsk().
 */
async function sessionKeys(
  provider: CryptoProvider, scalar: X25519Key, peerShare: Uint8Array, sid: Uint8Array, transcript: Uint8Array,
): Promise<{ isk: Uint8Array<ArrayBuffer>; macKey: Uint8Array<ArrayBuffer> }> {
  let isk: Uint8Array<ArrayBuffer>;
  try {
    isk = await deriveIsk(provider, { scalar, peerShare, sid, transcript });
  } catch (err) {
    if (DropgateError.is(err, 'INVALID_ARGUMENT')) throw mismatch();
    throw err;
  }
  try {
    return { isk, macKey: await confirmationKey(provider, sid, isk) };
  } catch (err) {
    isk.fill(0);
    throw err;
  }
}

const versionOf = (ad: Uint8Array): ProtocolVersion => Object.freeze({ major: ad[1], minor: ad[2] });

/** Hands the ISK to `handOn`, then overwrites it, whatever `handOn` does. */
async function handIskOn<T>(isk: Uint8Array<ArrayBuffer>, handOn: (isk: Uint8Array<ArrayBuffer>) => T | Promise<T>): Promise<T> {
  try {
    return await handOn(isk);
  } finally {
    isk.fill(0);
  }
}

export interface CpaceOptions {
  /** The code's password (`codes.ts`), spent by this exchange. */
  password: CodePassword;
  /** The code's locator, 2 or 3 letters: in CI, never sent by CPace. */
  locator: string;
  /** The sender's 16 random bytes for the room, published by the rendezvous. */
  roomNonce: Uint8Array;
  /** This side's DGDTP version, in its AD: core's own unless a test says otherwise. */
  version?: ProtocolVersion;
}

export interface CpaceInitiatorOptions extends CpaceOptions {
  /** The receiver's 16 random bytes for this attempt, which the key schedule uses too. */
  attemptId: Uint8Array;
}

interface Settings {
  password: CodePassword;
  ci: Uint8Array<ArrayBuffer>;
  roomNonce: Uint8Array<ArrayBuffer>;
  ad: Uint8Array<ArrayBuffer>;
}

const isBytes = (value: unknown, length: number): value is Uint8Array => value instanceof Uint8Array && value.byteLength === length;

const isByte = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 255;

function settingsOf(options: CpaceOptions, role: number): Settings {
  if (!(options?.password instanceof CodePassword)) throw invalid("A CPace exchange takes a code's password.");
  const { locator } = options;
  if (typeof locator !== 'string' || (locator.length !== 2 && locator.length !== 3) || [...locator].some((c) => !CODE_LETTERS.includes(c))) {
    throw invalid("A locator is 2 or 3 of a code's letters.");
  }
  if (!isBytes(options.roomNonce, CPACE_ROOM_NONCE_BYTES)) throw invalid(`A room nonce is ${CPACE_ROOM_NONCE_BYTES} bytes.`);
  const version = options.version ?? PROTOCOLS.dgdtp;
  if (!isByte(version?.major) || !isByte(version?.minor)) throw invalid('A DGDTP version is a major and a minor, each 0 to 255.');
  return {
    password: options.password,
    ci: channelIdentifier(locator),
    roomNonce: new Uint8Array(options.roomNonce),
    ad: associatedData(role, version),
  };
}

function checkHandOn(handOn: unknown): void {
  if (typeof handOn !== 'function') throw invalid('The ISK is handed on to a function.');
}

type Step = 'ready' | 'busy' | 'sent' | 'responded' | 'done' | 'failed';

/**
 * Runs one step of the exchange if it's `expected`'s turn: a step out of turn
 * is `outOfTurn()`, and changes nothing. Any failure finishes the exchange,
 * every secret let go; so does `close()`.
 */
function stepper(cleanUp: () => void, outOfTurn: () => DropgateError) {
  let step: Step = 'ready';
  const run = async <T>(expected: Step, next: Step, work: () => Promise<T>): Promise<T> => {
    if (step === 'failed') throw mismatch();
    if (step !== expected) throw outOfTurn();
    step = 'busy';
    try {
      const result = await work();
      step = next;
      return result;
    } catch (err) {
      step = 'failed';
      cleanUp();
      throw err;
    }
  };
  const close = () => {
    step = 'failed';
    cleanUp();
  };
  return { run, close };
}

/** The receiver's side: CPace's initiator A. */
export interface CpaceInitiator {
  /** Message 1: the attempt ID, Ya and ADa. Spends the password. */
  writeMessage1(): Promise<Uint8Array<ArrayBuffer>>;
  /**
   * Reads message 2 and checks Tb. If it matches: message 3 (Ta) to send,
   * the sender's DGDTP version, and what `handOn` gave for the ISK, which is
   * overwritten once `handOn` is done. If it's an abort, the wrong length, a
   * low-order share or a Tb that doesn't match: CODE_MISMATCH, no Ta made,
   * and the caller sends `cpaceAbort()` as message 3.
   */
  readMessage2<T>(
    message: Uint8Array, handOn: (isk: Uint8Array<ArrayBuffer>) => T | Promise<T>,
  ): Promise<{ message3: Uint8Array<ArrayBuffer>; peerVersion: ProtocolVersion; result: T }>;
  /** Lets go of every secret: every later call fails. */
  close(): void;
}

/** The sender's side: CPace's responder B, once per code. */
export interface CpaceResponder {
  /**
   * Reads message 1, which spends the code, right or wrong: message 2 to send
   * (Yb, ADb and Tb), the attempt ID and the receiver's DGDTP version. The ISK
   * is held until message 3. The wrong length or a low-order share is
   * CODE_MISMATCH, and the caller sends `cpaceAbort()` as message 2. A second
   * message 1 is CODE_MISMATCH too, and changes nothing.
   */
  readMessage1(message: Uint8Array): Promise<{ message2: Uint8Array<ArrayBuffer>; attemptId: Uint8Array<ArrayBuffer>; peerVersion: ProtocolVersion }>;
  /**
   * Reads message 3 and checks Ta. If it matches, what `handOn` gave for the
   * ISK, which is overwritten once `handOn` is done. An abort, the wrong
   * length or a Ta that doesn't match is CODE_MISMATCH, and the ISK is gone.
   */
  readMessage3<T>(message: Uint8Array, handOn: (isk: Uint8Array<ArrayBuffer>) => T | Promise<T>): Promise<{ result: T }>;
  /** Lets go of every secret, the password too if no message 1 came: every later call fails. */
  close(): void;
}

/** A new exchange as the receiver, on `provider`. */
export function cpaceInitiator(provider: CryptoProvider, options: CpaceInitiatorOptions): CpaceInitiator {
  const settings = settingsOf(options, ROLE_RECEIVER);
  if (!isBytes(options.attemptId, CPACE_ATTEMPT_ID_BYTES)) throw invalid(`An attempt ID is ${CPACE_ATTEMPT_ID_BYTES} bytes.`);
  const attemptId = new Uint8Array(options.attemptId);
  const sid = concat(settings.roomNonce, attemptId);
  let own: { scalar: X25519Key; share: Uint8Array<ArrayBuffer> } | undefined;
  const turn = stepper(() => {
    settings.password.forget();
    own = undefined;
  }, () => invalid('That CPace message is out of turn.'));
  return Object.freeze({
    writeMessage1() {
      return turn.run('ready', 'sent', async () => {
        own = await ownShare(provider, settings.password, settings.ci, sid);
        return concat(attemptId, own.share, settings.ad);
      });
    },
    async readMessage2<T>(message: Uint8Array, handOn: (isk: Uint8Array<ArrayBuffer>) => T | Promise<T>) {
      checkHandOn(handOn);
      return turn.run('sent', 'done', async () => {
        const { scalar, share: ya } = own as { scalar: X25519Key; share: Uint8Array<ArrayBuffer> };
        own = undefined;
        if (!isBytes(message, CPACE_MESSAGE2_BYTES)) throw mismatch();
        const yb = message.slice(0, FIELD_BYTES);
        const adB = message.slice(FIELD_BYTES, FIELD_BYTES + AD_BYTES);
        const tb = message.slice(FIELD_BYTES + AD_BYTES);
        if (adB[0] !== ROLE_SENDER) throw mismatch();
        const { isk, macKey } = await sessionKeys(provider, scalar, yb, sid, transcriptIr(ya, settings.ad, yb, adB));
        try {
          // Tb first: Ta is only made for a sender that proved it has the same ISK.
          if (!(await confirms(provider, macKey, yb, adB, tb))) throw mismatch();
          const message3 = await confirmation(provider, macKey, ya, settings.ad);
          macKey.fill(0);
          return { message3, peerVersion: versionOf(adB), result: await handIskOn(isk, handOn) };
        } finally {
          macKey.fill(0);
          isk.fill(0);
        }
      });
    },
    close: turn.close,
  });
}

/** A new exchange as the sender, on `provider`, for one code. */
export function cpaceResponder(provider: CryptoProvider, options: CpaceOptions): CpaceResponder {
  const settings = settingsOf(options, ROLE_SENDER);
  let held: { isk: Uint8Array<ArrayBuffer>; macKey: Uint8Array<ArrayBuffer>; ya: Uint8Array<ArrayBuffer>; adA: Uint8Array<ArrayBuffer> } | undefined;
  const forget = () => {
    held?.isk.fill(0);
    held?.macKey.fill(0);
    held = undefined;
  };
  // A second message 1 is the code being tried again: refused as a wrong code.
  const turn = stepper(() => {
    settings.password.forget();
    forget();
  }, mismatch);
  return Object.freeze({
    readMessage1(message: Uint8Array) {
      return turn.run('ready', 'responded', async () => {
        if (!isBytes(message, CPACE_MESSAGE1_BYTES)) throw mismatch();
        const attemptId = message.slice(0, CPACE_ATTEMPT_ID_BYTES);
        const ya = message.slice(CPACE_ATTEMPT_ID_BYTES, CPACE_ATTEMPT_ID_BYTES + FIELD_BYTES);
        const adA = message.slice(CPACE_ATTEMPT_ID_BYTES + FIELD_BYTES);
        if (adA[0] !== ROLE_RECEIVER) throw mismatch();
        const sid = concat(settings.roomNonce, attemptId);
        const { scalar, share: yb } = await ownShare(provider, settings.password, settings.ci, sid);
        const keys = await sessionKeys(provider, scalar, ya, sid, transcriptIr(ya, adA, yb, settings.ad));
        held = { ...keys, ya, adA };
        const tb = await confirmation(provider, keys.macKey, yb, settings.ad);
        return { message2: concat(yb, settings.ad, tb), attemptId: new Uint8Array(attemptId), peerVersion: versionOf(adA) };
      });
    },
    async readMessage3<T>(message: Uint8Array, handOn: (isk: Uint8Array<ArrayBuffer>) => T | Promise<T>) {
      checkHandOn(handOn);
      return turn.run('responded', 'done', async () => {
        const { isk, macKey, ya, adA } = held as NonNullable<typeof held>;
        try {
          if (!isBytes(message, CPACE_MESSAGE3_BYTES) || !(await confirms(provider, macKey, ya, adA, message))) throw mismatch();
          macKey.fill(0);
          return { result: await handIskOn(isk, handOn) };
        } finally {
          forget();
        }
      });
    },
    close: turn.close,
  });
}
