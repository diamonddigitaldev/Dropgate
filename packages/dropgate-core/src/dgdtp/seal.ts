import type { ContentKey, CryptoProvider } from '../crypto/index.js';
import { DropgateError } from '../errors.js';
import { checkCpaceAbort } from './cpace.js';
import type { AttemptKeys, CloseKeys } from './keys.js';

// Sealed signalling: every message that sets up a direct transfer's connection
// (the receiver's offer, the sender's answer, each ICE candidate as it's found,
// the end of them, the sender asking for an ICE restart) travels through the
// rendezvous as an opaque frame, sealed with AES-256-GCM under that
// direction's key for this attempt (keys.ts), and padded to one of three
// sizes, so the rendezvous sees neither what's in it nor what kind of
// candidate it is.
//
//   frame = kind (1) || direction (1) || attemptId (16) || counter (4, BE)
//           || AES-256-GCM(key, nonce, inside, ad)
//   kind       0x10 signalling, 0x11 an out-of-band close
//   direction  1 receiver to sender, 2 sender to receiver
//   key        sealR2S or sealS2R; for a close, closeR2S or closeS2R
//   nonce      8 zero bytes || counter (4, BE)
//   ad         "dropgate/4 dgdtp signal" || roomNonce || attemptId || direction || counter || kind
//   inside     type (1) || length (2, BE) || body, then zero bytes to the bucket:
//                1 OFFER, 2 ANSWER   the SDP, UTF-8 (the receiver offers, the sender answers)
//                3 CANDIDATE         lv(candidate) || lv(sdpMid) || sdpMLineIndex (2, FFFF none) || lv(usernameFragment)
//                4 END_OF_CANDIDATES nothing
//                5 RESTART           nothing: the sender asking the receiver for an ICE-restart offer
//                6 CLOSE             a close's body (kind 0x11 only)
//              lv(x) = x's UTF-8 length (2, BE) || x's UTF-8; an empty one is null
//   buckets    512 for a candidate, end-of-candidates, restart or close; 2,048 for an
//              offer or answer, 8,192 if it doesn't fit; anything bigger is refused before
//              it's sealed
//
// The rules: each direction's counter starts at 0 for the attempt, and a frame
// is opened only if its counter is the next one expected. Anything that isn't
// that frame (a flipped bit, a frame from another attempt, one reflected back
// from the other direction, a replay, a gap, a reorder, the wrong size, or an
// inside that isn't exactly as above) ends the attempt with
// SECURITY_POLICY_MISMATCH: every later call fails, and nothing is tried again,
// sealed or not. At most 4,096 frames go each way. A receiver in code mode
// takes an empty message where it waits for the sender's first frame as the
// sender's CPace abort: CODE_MISMATCH (cpace.ts' checkCpaceAbort).
//
// An out-of-band close is one frame each way, counter 0, under the close keys,
// which travels through the rendezvous when the data channel is already gone;
// one that doesn't open, or a second, is ignored.
//
// No error carries anything from a frame or a key, and nothing here logs.

/** A signalling frame's kind. */
export const SIGNAL_KIND = 0x10;
/** An out-of-band close's kind. */
export const CLOSE_KIND = 0x11;

/** The plain header: kind, direction, attempt ID, counter. */
export const FRAME_HEADER_BYTES = 22;

/** AES-GCM's tag. */
const TAG_BYTES = 16;

/** The padded insides' three sizes. */
export const SMALL_BUCKET_BYTES = 512;
export const SDP_BUCKET_BYTES = 2048;
export const LARGE_BUCKET_BYTES = 8192;

/** The largest frame: what the rendezvous caps a frame at. */
export const MAX_FRAME_BYTES = FRAME_HEADER_BYTES + LARGE_BUCKET_BYTES + TAG_BYTES;

/** The most frames one direction of an attempt carries. */
export const MAX_FRAMES_EACH_WAY = 4096;

/** What leads an inside's body: its type and length. */
const INSIDE_HEADER_BYTES = 3;

/** The most a close's body holds. */
export const MAX_CLOSE_BODY_BYTES = SMALL_BUCKET_BYTES - INSIDE_HEADER_BYTES;

const AD_LABEL = new TextEncoder().encode('dropgate/4 dgdtp signal');

const ROOM_NONCE_BYTES = 16;
const ATTEMPT_ID_BYTES = 16;

/** Which side of a direct transfer this is. */
export type SignalRole = 'receiver' | 'sender';

const DIRECTION = { receiver: 1, sender: 2 } as const;

const TYPE = { offer: 1, answer: 2, candidate: 3, 'end-of-candidates': 4, restart: 5, close: 6 } as const;

/** sdpMLineIndex's "none". */
const NO_LINE_INDEX = 0xffff;

/** One signalling message, as WebRTC gives and takes them. */
export type SignalMessage =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'candidate'; candidate: string; sdpMid: string | null; sdpMLineIndex: number | null; usernameFragment: string | null }
  | { type: 'end-of-candidates' }
  | { type: 'restart' };

type SignalType = SignalMessage['type'];

/** Who may send each type: the receiver offers, the sender answers and asks for a restart. */
const SENT_BY: Readonly<Record<SignalType, readonly SignalRole[]>> = Object.freeze({
  offer: ['receiver'],
  answer: ['sender'],
  candidate: ['receiver', 'sender'],
  'end-of-candidates': ['receiver', 'sender'],
  restart: ['sender'],
});

const TYPE_NAMES = new Map<number, SignalType>(
  (Object.keys(SENT_BY) as SignalType[]).map((name) => [TYPE[name], name]),
);

const invalid = (message: string) => new DropgateError({ code: 'INVALID_ARGUMENT', message });

/** A frame that isn't the one expected. It says nothing more. */
const insecure = () => new DropgateError({ code: 'SECURITY_POLICY_MISMATCH' });

/** This side has sent every frame an attempt allows. */
const tooMany = () => new DropgateError({
  code: 'SECURITY_POLICY_MISMATCH',
  origin: 'local',
  message: 'Setting up this connection took too many messages, so it was closed.',
});

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** The bucket an inside of `length` bytes and this type is padded to, or none if it's too big. */
function bucketFor(type: number, length: number): number | undefined {
  if (type === TYPE.offer || type === TYPE.answer) {
    if (length <= SDP_BUCKET_BYTES) return SDP_BUCKET_BYTES;
    return length <= LARGE_BUCKET_BYTES ? LARGE_BUCKET_BYTES : undefined;
  }
  return length <= SMALL_BUCKET_BYTES ? SMALL_BUCKET_BYTES : undefined;
}

/** `type || length || body`, zero-padded to its bucket. INVALID_ARGUMENT if it doesn't fit one. */
function inside(type: number, body: Uint8Array): Uint8Array<ArrayBuffer> {
  const bucket = bucketFor(type, INSIDE_HEADER_BYTES + body.byteLength);
  if (bucket === undefined) {
    throw invalid(type === TYPE.offer || type === TYPE.answer
      ? `An offer or answer is at most ${LARGE_BUCKET_BYTES - INSIDE_HEADER_BYTES} bytes.`
      : `That message is at most ${SMALL_BUCKET_BYTES - INSIDE_HEADER_BYTES} bytes.`);
  }
  const out = new Uint8Array(bucket);
  out[0] = type;
  new DataView(out.buffer).setUint16(1, body.byteLength, false);
  out.set(body, INSIDE_HEADER_BYTES);
  return out;
}

/** A string, or null as empty, as lv(): its UTF-8 length in 2 bytes, then its UTF-8. */
function lv(value: string | null): Uint8Array<ArrayBuffer> {
  // Never longer than 0xffff: a candidate's whole body fits 512 bytes, or the bucket refuses it.
  const bytes = encoder.encode(value ?? '');
  const out = new Uint8Array(2 + bytes.byteLength);
  new DataView(out.buffer).setUint16(0, bytes.byteLength, false);
  out.set(bytes, 2);
  return out;
}

const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
};

const isText = (value: unknown): value is string => typeof value === 'string';
const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string';

/** A message's type number and body, checked. INVALID_ARGUMENT if it isn't one `role` sends. */
function encode(message: SignalMessage, role: SignalRole): { type: number; body: Uint8Array<ArrayBuffer> } {
  const name = (message as { type?: unknown } | null)?.type;
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(SENT_BY, name)) throw invalid("That isn't a signalling message.");
  const type = name as SignalType;
  if (!SENT_BY[type].includes(role)) throw invalid(`The ${role} doesn't send that signalling message.`);
  switch (message.type) {
    case 'offer':
    case 'answer':
      if (!isText(message.sdp)) throw invalid('An offer or answer is its SDP.');
      return { type: TYPE[type], body: encoder.encode(message.sdp) };
    case 'candidate': {
      const { candidate, sdpMid, sdpMLineIndex, usernameFragment } = message;
      if (!isText(candidate) || !isTextOrNull(sdpMid) || !isTextOrNull(usernameFragment)) throw invalid('A candidate is its string, sdpMid and usernameFragment.');
      if (sdpMLineIndex !== null && !(Number.isInteger(sdpMLineIndex) && sdpMLineIndex >= 0 && sdpMLineIndex < NO_LINE_INDEX)) {
        throw invalid(`A candidate's sdpMLineIndex is 0 to ${NO_LINE_INDEX - 1}, or null.`);
      }
      const index = new Uint8Array(2);
      new DataView(index.buffer).setUint16(0, sdpMLineIndex ?? NO_LINE_INDEX, false);
      return { type: TYPE.candidate, body: concat(lv(candidate), lv(sdpMid), index, lv(usernameFragment)) };
    }
    default:
      return { type: TYPE[type], body: new Uint8Array(0) };
  }
}

/** Reads one lv() field at `at`: the string (null if empty) and where the next field starts. SECURITY_POLICY_MISMATCH if it runs past the end. */
function readLv(body: Uint8Array<ArrayBuffer>, at: number): { value: string | null; next: number } {
  if (at + 2 > body.byteLength) throw insecure();
  const length = new DataView(body.buffer, body.byteOffset).getUint16(at, false);
  const next = at + 2 + length;
  if (next > body.byteLength) throw insecure();
  return { value: length === 0 ? null : utf8(body.subarray(at + 2, next)), next };
}

function utf8(bytes: Uint8Array): string {
  try {
    return decoder.decode(bytes);
  } catch {
    throw insecure();
  }
}

/** An opened inside's type and body: SECURITY_POLICY_MISMATCH unless it's exactly an inside of that type, in its own bucket. */
function readInside(padded: Uint8Array<ArrayBuffer>): { type: number; body: Uint8Array<ArrayBuffer> } {
  const type = padded[0];
  const length = new DataView(padded.buffer, padded.byteOffset).getUint16(1, false);
  const end = INSIDE_HEADER_BYTES + length;
  if (bucketFor(type, end) !== padded.byteLength) throw insecure();
  for (let i = end; i < padded.byteLength; i++) if (padded[i] !== 0) throw insecure();
  return { type, body: padded.slice(INSIDE_HEADER_BYTES, end) };
}

/** A signalling message from its type and body, sent by `from`: SECURITY_POLICY_MISMATCH if it isn't exactly one. */
function decode(type: number, body: Uint8Array<ArrayBuffer>, from: SignalRole): SignalMessage {
  const name = TYPE_NAMES.get(type);
  if (!name || !SENT_BY[name].includes(from)) throw insecure();
  switch (name) {
    case 'offer':
    case 'answer':
      return { type: name, sdp: utf8(body) };
    case 'candidate': {
      const candidate = readLv(body, 0);
      const sdpMid = readLv(body, candidate.next);
      if (sdpMid.next + 2 > body.byteLength) throw insecure();
      const index = new DataView(body.buffer, body.byteOffset).getUint16(sdpMid.next, false);
      const usernameFragment = readLv(body, sdpMid.next + 2);
      if (usernameFragment.next !== body.byteLength) throw insecure();
      return {
        type: 'candidate',
        candidate: candidate.value ?? '',
        sdpMid: sdpMid.value,
        sdpMLineIndex: index === NO_LINE_INDEX ? null : index,
        usernameFragment: usernameFragment.value,
      };
    }
    default:
      if (body.byteLength !== 0) throw insecure();
      return { type: name };
  }
}

/** One direction's context: the attempt's public values, its kind and direction. */
interface Way {
  roomNonce: Uint8Array<ArrayBuffer>;
  attemptId: Uint8Array<ArrayBuffer>;
  kind: number;
  direction: number;
}

/** The 22-byte plain header. */
function header(way: Way, counter: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(FRAME_HEADER_BYTES);
  out[0] = way.kind;
  out[1] = way.direction;
  out.set(way.attemptId, 2);
  new DataView(out.buffer).setUint32(18, counter, false);
  return out;
}

/** The associated data: the label, the room's nonce, the attempt, the direction, the counter, the kind. */
function associatedData(way: Way, counter: number): Uint8Array<ArrayBuffer> {
  const tail = new Uint8Array(6);
  tail[0] = way.direction;
  new DataView(tail.buffer).setUint32(1, counter, false);
  tail[5] = way.kind;
  return concat(AD_LABEL, way.roomNonce, way.attemptId, tail);
}

/** 8 zero bytes, then the counter as 4 bytes, big-endian. */
function nonceOf(counter: number): Uint8Array<ArrayBuffer> {
  const nonce = new Uint8Array(12);
  new DataView(nonce.buffer).setUint32(8, counter, false);
  return nonce;
}

async function sealFrame(provider: CryptoProvider, key: ContentKey, way: Way, counter: number, padded: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return concat(header(way, counter), await provider.encryptWithNonce(key, nonceOf(counter), padded, associatedData(way, counter)));
  } finally {
    padded.fill(0);
  }
}

/** Whether `frame` is one of the three sizes a frame can be. */
const frameSize = (frame: Uint8Array) =>
  [SMALL_BUCKET_BYTES, SDP_BUCKET_BYTES, LARGE_BUCKET_BYTES].some((bucket) => frame.byteLength === FRAME_HEADER_BYTES + bucket + TAG_BYTES);

/**
 * The inside of `frame`, if it's exactly the frame `way` expects at `counter`:
 * the header as it must be, then the ciphertext opened under `key`. Else
 * SECURITY_POLICY_MISMATCH.
 */
async function openFrame(provider: CryptoProvider, key: ContentKey, way: Way, counter: number, frame: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (!frameSize(frame)) throw insecure();
  const expected = header(way, counter);
  for (let i = 0; i < FRAME_HEADER_BYTES; i++) if (frame[i] !== expected[i]) throw insecure();
  try {
    return await provider.decryptWithNonce(key, nonceOf(counter), frame.subarray(FRAME_HEADER_BYTES), associatedData(way, counter));
  } catch {
    throw insecure();
  }
}

/** A serial queue: each step after every earlier one; once one fails, `onFail` runs and every later step fails. */
function queue(onFail: () => void) {
  let tail: Promise<unknown> = Promise.resolve();
  let closed = false;
  const close = () => {
    closed = true;
    onFail();
  };
  const next = <T>(step: () => Promise<T>): Promise<T> => {
    const run = tail.then(async () => {
      if (closed) throw insecure();
      try {
        return await step();
      } catch (err) {
        close();
        throw err;
      }
    });
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
  return { next, close, get closed() { return closed; } };
}

const otherSide = (role: SignalRole): SignalRole => (role === 'receiver' ? 'sender' : 'receiver');

function checkRole(role: unknown): asserts role is SignalRole {
  if (role !== 'receiver' && role !== 'sender') throw invalid('A side is the receiver or the sender.');
}

/** One attempt's signalling, both ways, for one side. */
export interface SignalChannel {
  /**
   * The next frame to send, holding `message`. INVALID_ARGUMENT, and nothing
   * changed, if it isn't a message this side sends or is too big for its
   * bucket. The 4,097th is SECURITY_POLICY_MISMATCH (origin `local`), and
   * ends the attempt.
   */
  seal(message: SignalMessage): Promise<Uint8Array<ArrayBuffer>>;
  /**
   * The message in the other side's next frame. SECURITY_POLICY_MISMATCH if
   * it isn't exactly that frame, and then every later call fails. A code-mode
   * receiver's first: an empty message is the sender's abort, CODE_MISMATCH.
   */
  open(frame: Uint8Array): Promise<SignalMessage>;
  /** How many frames this side has sealed, and opened. */
  readonly sent: number;
  readonly received: number;
  /** Ends the attempt's signalling: every later call fails. */
  close(): void;
}

/** A new attempt's signalling for `role`, under `keys`' sealing keys. */
export function signalChannel(provider: CryptoProvider, options: { keys: AttemptKeys; role: SignalRole }): SignalChannel {
  const { keys, role } = options ?? {};
  checkRole(role);
  if (!keys || typeof keys !== 'object' || !('sealR2S' in keys)) throw invalid('Signalling is sealed under an attempt\'s keys.');
  let sendKey: ContentKey | undefined = role === 'receiver' ? keys.sealR2S : keys.sealS2R;
  let receiveKey: ContentKey | undefined = role === 'receiver' ? keys.sealS2R : keys.sealR2S;
  const ctx = { roomNonce: keys.roomNonce, attemptId: keys.attemptId, kind: SIGNAL_KIND };
  const out: Way = { ...ctx, direction: DIRECTION[role] };
  const into: Way = { ...ctx, direction: DIRECTION[otherSide(role)] };
  // Until the sender's first frame opens, a code-mode receiver may get the sender's CPace abort.
  const abortMayCome = keys.mode === 'code' && role === 'receiver';
  let sent = 0;
  let received = 0;
  const letGo = () => {
    sendKey = undefined;
    receiveKey = undefined;
  };
  const sending = queue(letGo);
  const receiving = queue(letGo);
  // Either way failing ends both: the attempt is over.
  const end = () => {
    sending.close();
    receiving.close();
  };
  return Object.freeze({
    seal(message: SignalMessage) {
      if (sending.closed) return Promise.reject(insecure());
      let padded: Uint8Array<ArrayBuffer>;
      try {
        const { type, body } = encode(message, role);
        padded = inside(type, body);
        body.fill(0);
      } catch (err) {
        return Promise.reject(err);
      }
      if (sent >= MAX_FRAMES_EACH_WAY) {
        padded.fill(0);
        end();
        return Promise.reject(tooMany());
      }
      const counter = sent++;
      return sending.next(async () => {
        try {
          return await sealFrame(provider, sendKey as ContentKey, out, counter, padded);
        } catch (err) {
          end();
          throw err;
        }
      });
    },
    open(frame: Uint8Array) {
      const copy = frame instanceof Uint8Array ? new Uint8Array(frame) : undefined;
      return receiving.next(async () => {
        try {
          if (abortMayCome && received === 0) checkCpaceAbort(copy);
          if (!copy || received >= MAX_FRAMES_EACH_WAY) throw insecure();
          const padded = await openFrame(provider, receiveKey as ContentKey, into, received, copy);
          try {
            const { type, body } = readInside(padded);
            const message = decode(type, body, otherSide(role));
            received += 1;
            return message;
          } finally {
            padded.fill(0);
          }
        } catch (err) {
          end();
          throw err;
        }
      });
    },
    get sent() { return sent; },
    get received() { return received; },
    close: end,
  });
}

/** One connection's out-of-band close, both ways, for one side. */
export interface CloseChannel {
  /**
   * The one close frame this side sends, holding `body` (CLOSE's own bytes),
   * at most 509 bytes. INVALID_ARGUMENT if it's too long, or one was sealed
   * already.
   */
  seal(body: Uint8Array): Promise<Uint8Array<ArrayBuffer>>;
  /**
   * The body of the other side's close frame, or undefined if this isn't it:
   * one that doesn't open, isn't exactly a close, or comes after the first is
   * ignored.
   */
  open(frame: Uint8Array): Promise<Uint8Array<ArrayBuffer> | undefined>;
}

/** A connection's out-of-band close for `role`, under `keys` (keys.ts' deriveCloseKeys). */
export function closeChannel(provider: CryptoProvider, options: { keys: CloseKeys; role: SignalRole }): CloseChannel {
  const { keys, role } = options ?? {};
  checkRole(role);
  if (!keys || typeof keys !== 'object' || !('closeR2S' in keys)) throw invalid('A close is sealed under the close keys.');
  const sendKey = role === 'receiver' ? keys.closeR2S : keys.closeS2R;
  const receiveKey = role === 'receiver' ? keys.closeS2R : keys.closeR2S;
  const ctx = { roomNonce: new Uint8Array(keys.roomNonce), attemptId: new Uint8Array(keys.attemptId), kind: CLOSE_KIND };
  if (ctx.roomNonce.byteLength !== ROOM_NONCE_BYTES || ctx.attemptId.byteLength !== ATTEMPT_ID_BYTES) throw invalid('A close is for one attempt.');
  const out: Way = { ...ctx, direction: DIRECTION[role] };
  const into: Way = { ...ctx, direction: DIRECTION[otherSide(role)] };
  let sealed = false;
  let opened = false;
  return Object.freeze({
    async seal(body: Uint8Array) {
      if (!(body instanceof Uint8Array)) throw invalid("A close's body is bytes.");
      if (body.byteLength > MAX_CLOSE_BODY_BYTES) throw invalid(`A close's body is at most ${MAX_CLOSE_BODY_BYTES} bytes.`);
      if (sealed) throw invalid('A connection has one close each way.');
      sealed = true;
      return sealFrame(provider, sendKey, out, 0, inside(TYPE.close, body));
    },
    async open(frame: Uint8Array) {
      if (opened || !(frame instanceof Uint8Array)) return undefined;
      let padded: Uint8Array<ArrayBuffer>;
      try {
        padded = await openFrame(provider, receiveKey, into, 0, new Uint8Array(frame));
      } catch {
        return undefined;
      }
      try {
        const { type, body } = readInside(padded);
        if (type !== TYPE.close || opened) return undefined;
        opened = true;
        return body;
      } catch {
        return undefined;
      } finally {
        padded.fill(0);
      }
    },
  });
}
