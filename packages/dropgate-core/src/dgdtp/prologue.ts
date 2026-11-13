import { DropgateError } from '../errors.js';
import { PROTOCOLS } from '../version.js';
import { CPACE_ATTEMPT_ID_BYTES, CPACE_ROOM_NONCE_BYTES } from './cpace.js';
import type { AttemptMode } from './keys.js';

// What ties a direct transfer's encrypted handshake to the connection it runs
// over: Noise's prologue (noise.ts), which both sides hash in before anything
// else, holds both devices' DTLS certificate fingerprints, as each one's SDP
// gave them. A browser refuses a DTLS peer whose certificate doesn't match the
// SDP it applied, so a prologue built from those fingerprints binds the
// certificates actually in use: anything in the middle that terminates DTLS
// with certificates of its own leaves the two sides with different prologues,
// and the handshake's first message doesn't open.
//
// The fingerprints come from the sealed signalling each side applied: the
// receiver's from the OFFER, the sender's from the ANSWER. Every
// `a=fingerprint:` line is read; there must be exactly one distinct SHA-256
// value among them (other hash functions are ignored), and its colon-separated
// hex becomes 32 bytes. None, two different ones, or a SHA-256 line that isn't
// one is SECURITY_POLICY_MISMATCH.
//
// The prologue, 131 bytes, the same on both sides whichever builds it:
//
//   "dropgate/4 dgdtp prologue" (25) || major (1) || mode (1: 1 link, 2 code, 3 resume)
//   || roomNonce (16) || attemptId (16) || generation (8, BE) || fpReceiver (32) || fpSender (32)
//
// The generation is the connection's: 0 for the first, one more for each
// resume. The server's origin isn't bound: a server reached by two names
// would otherwise break every transfer between them, and the key schedule's
// PSK and the sealed signalling already tie the handshake to the secret.

/** A SHA-256 fingerprint's bytes. */
export const FINGERPRINT_BYTES = 32;

/** The prologue's fixed length. */
export const PROLOGUE_BYTES = 131;

/** The prologue's label, 25 bytes of ASCII. */
const LABEL = new TextEncoder().encode('dropgate/4 dgdtp prologue');

/** Each mode's byte. */
const MODE_BYTE: Readonly<Record<AttemptMode, number>> = Object.freeze({ link: 1, code: 2, resume: 3 });

/** The largest generation 8 bytes hold. */
export const MAX_GENERATION = (1n << 64n) - 1n;

/** A SHA-256 fingerprint as SDP writes it: 32 bytes as hex pairs, colon-separated. */
const SHA256_FINGERPRINT = /^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){31}$/;

const invalid = (message: string) => new DropgateError({ code: 'INVALID_ARGUMENT', message });

/** A fingerprint rule that fails. It says nothing more, and nothing from the SDP. */
const insecure = () => new DropgateError({ code: 'SECURITY_POLICY_MISMATCH' });

const isBytes = (value: unknown, length: number): value is Uint8Array => value instanceof Uint8Array && value.byteLength === length;

/**
 * The one SHA-256 certificate fingerprint `sdp` gives, as 32 bytes. Every
 * `a=fingerprint:` line is read, at session or media level: a SHA-256 one
 * (its hash function's name in either case) must be exactly 32 hex pairs,
 * colon-separated, in either case; the same value more than once counts once;
 * other hash functions are ignored.
 * @throws {DropgateError} SECURITY_POLICY_MISMATCH if there's no SHA-256 fingerprint, two different ones, or one that isn't one.
 */
export function sdpFingerprint(sdp: string): Uint8Array<ArrayBuffer> {
  if (typeof sdp !== 'string') throw insecure();
  let found: Uint8Array<ArrayBuffer> | undefined;
  for (const line of sdp.split(/\r?\n/)) {
    if (!line.startsWith('a=fingerprint:')) continue;
    const value = line.slice('a=fingerprint:'.length).trim();
    const space = value.search(/[ \t]/);
    const hash = space < 0 ? value : value.slice(0, space);
    if (hash.toLowerCase() !== 'sha-256') continue;
    const hex = space < 0 ? '' : value.slice(space).trim();
    if (!SHA256_FINGERPRINT.test(hex)) throw insecure();
    const bytes = Uint8Array.from(hex.split(':'), (pair) => parseInt(pair, 16));
    if (found && !found.every((byte, i) => byte === bytes[i])) throw insecure();
    found = bytes;
  }
  if (!found) throw insecure();
  return found;
}

export interface PrologueInput {
  /** How the attempt was reached. */
  mode: AttemptMode;
  /** The sender's 16 random bytes for the room. */
  roomNonce: Uint8Array;
  /** The receiver's 16 random bytes for this attempt. */
  attemptId: Uint8Array;
  /** The connection's generation: 0 for the first, one more for each resume. */
  generation: bigint;
  /** The receiver's certificate fingerprint, from the OFFER. */
  receiverFingerprint: Uint8Array;
  /** The sender's, from the ANSWER. */
  senderFingerprint: Uint8Array;
  /** The DGDTP major: core's own unless a test says otherwise. */
  major?: number;
}

/** The 131-byte prologue, from its parts: the receiver's fingerprint first, whichever side builds it. */
export function buildPrologue(input: PrologueInput): Uint8Array<ArrayBuffer> {
  const mode = input?.mode;
  if (!Object.prototype.hasOwnProperty.call(MODE_BYTE, mode)) throw invalid('An attempt is by link, by code or a resume.');
  if (!isBytes(input.roomNonce, CPACE_ROOM_NONCE_BYTES)) throw invalid(`A room nonce is ${CPACE_ROOM_NONCE_BYTES} bytes.`);
  if (!isBytes(input.attemptId, CPACE_ATTEMPT_ID_BYTES)) throw invalid(`An attempt ID is ${CPACE_ATTEMPT_ID_BYTES} bytes.`);
  const { generation } = input;
  if (typeof generation !== 'bigint' || generation < 0n || generation > MAX_GENERATION) throw invalid('A generation is 0 to 2^64 - 1.');
  if (!isBytes(input.receiverFingerprint, FINGERPRINT_BYTES) || !isBytes(input.senderFingerprint, FINGERPRINT_BYTES)) {
    throw invalid(`A fingerprint is ${FINGERPRINT_BYTES} bytes.`);
  }
  const major = input.major ?? PROTOCOLS.dgdtp.major;
  if (!Number.isInteger(major) || major < 0 || major > 255) throw invalid('A DGDTP major is 0 to 255.');
  const out = new Uint8Array(PROLOGUE_BYTES);
  let at = 0;
  const put = (bytes: Uint8Array) => {
    out.set(bytes, at);
    at += bytes.byteLength;
  };
  put(LABEL);
  put(Uint8Array.of(major, MODE_BYTE[mode]));
  put(input.roomNonce);
  put(input.attemptId);
  new DataView(out.buffer).setBigUint64(at, generation, false);
  at += 8;
  put(input.receiverFingerprint);
  put(input.senderFingerprint);
  return out;
}

export interface SdpPrologueInput extends Omit<PrologueInput, 'receiverFingerprint' | 'senderFingerprint'> {
  /** The OFFER's SDP, as the receiver sealed it and the sender opened it. */
  offer: string;
  /** The ANSWER's, as the sender sealed it and the receiver opened it. */
  answer: string;
}

/**
 * The prologue from the two SDPs each side applied: the fingerprint of each
 * read as `sdpFingerprint()` does, the OFFER's (the receiver's) first.
 * @throws {DropgateError} SECURITY_POLICY_MISMATCH if either SDP's fingerprints break the rule.
 */
export function prologueFromSdp(input: SdpPrologueInput): Uint8Array<ArrayBuffer> {
  const { offer, answer, ...rest } = input ?? ({} as SdpPrologueInput);
  return buildPrologue({ ...rest, receiverFingerprint: sdpFingerprint(offer), senderFingerprint: sdpFingerprint(answer) });
}
