import type { ContentKey, CryptoProvider } from '../crypto/index.js';
import { DropgateError } from '../errors.js';
import { CPACE_ATTEMPT_ID_BYTES, CPACE_ROOM_NONCE_BYTES } from './cpace.js';

// DGDTP 4's key schedule: from one base secret, every key a direct transfer's
// attempt needs, each HKDF-SHA256 with a label of its own, so no key serves two
// purposes (as DGUP 4's object keys are made, object/keys.ts).
//
//   base secret B   S, the link's 32 bytes; the ISK, CPace's 64 (a typed code);
//                   or R, the resume secret's 32
//   ctx             roomNonce (16) || attemptId (16): public, and new for every
//                   attempt, so every attempt's keys are new
//
//   roomId   16   HKDF(IKM S, no salt, "dropgate/4 dgdtp room")        link mode: the room's address
//   psk      32   HKDF(IKM B, salt ctx, "dropgate/4 dgdtp psk")        Noise's pre-shared key
//   sealR2S  32   HKDF(IKM B, salt ctx, "dropgate/4 dgdtp signal r>s") the receiver's sealed frames
//   sealS2R  32   HKDF(IKM B, salt ctx, "dropgate/4 dgdtp signal s>r") the sender's
//   closeR2S 32   HKDF(IKM closeSecret, salt ctx, "dropgate/4 dgdtp close r>s")  an out-of-band close,
//   closeS2R 32   HKDF(IKM closeSecret, salt ctx, "dropgate/4 dgdtp close s>r")  each way
//
// The sealing and close keys are the provider's AES-256-GCM handles, which
// can't be exported. The two outputs that aren't keys are bytes: the room ID
// goes to the rendezvous, and the PSK into Noise, which copies it; the PSK is
// held privately until it's used once, then overwritten, and the room ID is
// the caller's to overwrite once sent. The base secret is only read: every
// output is made before deriveAttemptKeys() returns, so a caller handing the
// ISK on (cpace.ts' handOn) can overwrite it as soon as this is done. Nothing
// here logs, and no error or printed value carries a secret.

/** The room's address on the rendezvous, in link mode. */
export const ROOM_ID_BYTES = 16;

/** Noise's pre-shared key. */
export const PSK_BYTES = 32;

/** A link's secret S, and the resume secret R. */
export const LINK_SECRET_BYTES = 32;
export const RESUME_SECRET_BYTES = 32;

/** CPace's ISK, SHA-512's output. */
export const ISK_BYTES = 64;

/** BIND's closeSecret, the receiver's 32 random bytes. */
export const CLOSE_SECRET_BYTES = 32;

/** How an attempt was reached: by a link's secret, a typed code's ISK, or a resume secret. */
export type AttemptMode = 'link' | 'code' | 'resume';

const BASE_BYTES: Readonly<Record<AttemptMode, number>> = Object.freeze({
  link: LINK_SECRET_BYTES,
  code: ISK_BYTES,
  resume: RESUME_SECRET_BYTES,
});

const INFO = {
  room: 'dropgate/4 dgdtp room',
  psk: 'dropgate/4 dgdtp psk',
  sealR2S: 'dropgate/4 dgdtp signal r>s',
  sealS2R: 'dropgate/4 dgdtp signal s>r',
  closeR2S: 'dropgate/4 dgdtp close r>s',
  closeS2R: 'dropgate/4 dgdtp close s>r',
} as const;

const info = (label: string) => new TextEncoder().encode(label);

const invalid = (message: string) => new DropgateError({ code: 'INVALID_ARGUMENT', message });

const isBytes = (value: unknown, length: number): value is Uint8Array => value instanceof Uint8Array && value.byteLength === length;

/** ctx: `roomNonce || attemptId`, each checked. */
function contextOf(roomNonce: unknown, attemptId: unknown): Uint8Array<ArrayBuffer> {
  if (!isBytes(roomNonce, CPACE_ROOM_NONCE_BYTES)) throw invalid(`A room nonce is ${CPACE_ROOM_NONCE_BYTES} bytes.`);
  if (!isBytes(attemptId, CPACE_ATTEMPT_ID_BYTES)) throw invalid(`An attempt ID is ${CPACE_ATTEMPT_ID_BYTES} bytes.`);
  const ctx = new Uint8Array(CPACE_ROOM_NONCE_BYTES + CPACE_ATTEMPT_ID_BYTES);
  ctx.set(roomNonce);
  ctx.set(attemptId, CPACE_ROOM_NONCE_BYTES);
  return ctx;
}

/**
 * Link mode's room ID, from the link's secret S with no salt: what the sender
 * creates the room under and a receiver by link joins with, so the rendezvous
 * never sees S. Bytes, which the caller overwrites once sent.
 */
export async function deriveRoomId(provider: CryptoProvider, secret: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  if (!isBytes(secret, LINK_SECRET_BYTES)) throw invalid(`A link's secret is ${LINK_SECRET_BYTES} bytes.`);
  return provider.hkdf(secret, new Uint8Array(0), info(INFO.room), ROOM_ID_BYTES);
}

export interface AttemptKeyOptions {
  /** How the attempt was reached, which says what the base secret is. */
  mode: AttemptMode;
  /** S (32 bytes), the ISK (64) or R (32). Only read: the caller keeps it, and overwrites it when it's done. */
  base: Uint8Array;
  /** The sender's 16 random bytes for the room, published by the rendezvous. */
  roomNonce: Uint8Array;
  /** The receiver's 16 random bytes for this attempt. */
  attemptId: Uint8Array;
}

/**
 * One attempt's keys: the two sealing keys, one each way, and Noise's PSK,
 * held until it's used. Printed, logged or serialised, it shows as
 * `[AttemptKeys]`.
 */
export class AttemptKeys {
  readonly mode: AttemptMode;
  readonly #roomNonce: Uint8Array<ArrayBuffer>;
  readonly #attemptId: Uint8Array<ArrayBuffer>;
  #sealR2S: ContentKey | undefined;
  #sealS2R: ContentKey | undefined;
  #psk: Uint8Array<ArrayBuffer> | undefined;

  /** @internal deriveAttemptKeys() makes these. */
  constructor(
    mode: AttemptMode, roomNonce: Uint8Array<ArrayBuffer>, attemptId: Uint8Array<ArrayBuffer>,
    keys: { sealR2S: ContentKey; sealS2R: ContentKey; psk: Uint8Array<ArrayBuffer> },
  ) {
    this.mode = mode;
    this.#roomNonce = roomNonce;
    this.#attemptId = attemptId;
    this.#sealR2S = keys.sealR2S;
    this.#sealS2R = keys.sealS2R;
    this.#psk = keys.psk;
    Object.freeze(this);
  }

  /** The room's nonce, a copy: public. */
  get roomNonce(): Uint8Array<ArrayBuffer> { return new Uint8Array(this.#roomNonce); }

  /** The attempt's ID, a copy: public. */
  get attemptId(): Uint8Array<ArrayBuffer> { return new Uint8Array(this.#attemptId); }

  /** The key the receiver's sealed frames are under. */
  get sealR2S(): ContentKey { return this.#need(this.#sealR2S); }

  /** The key the sender's sealed frames are under. */
  get sealS2R(): ContentKey { return this.#need(this.#sealS2R); }

  /**
   * Hands Noise's PSK to `use` (which copies it, as noise.ts does), then
   * overwrites it, whatever `use` does. Once only: after that, and after
   * `forget()`, INVALID_ARGUMENT.
   */
  async usePsk<T>(use: (psk: Uint8Array<ArrayBuffer>) => T | Promise<T>): Promise<T> {
    if (typeof use !== 'function') throw invalid('The PSK is handed to a function.');
    const psk = this.#psk;
    if (!psk) throw invalid("This attempt's PSK was already used, or its keys let go.");
    this.#psk = undefined;
    try {
      return await use(psk);
    } finally {
      psk.fill(0);
    }
  }

  /** Lets go of every key, the PSK overwritten if it wasn't used: the attempt is over. */
  forget(): void {
    this.#psk?.fill(0);
    this.#psk = undefined;
    this.#sealR2S = undefined;
    this.#sealS2R = undefined;
  }

  #need(key: ContentKey | undefined): ContentKey {
    if (!key) throw invalid("This attempt's keys were let go.");
    return key;
  }

  toJSON(): string { return '[AttemptKeys]'; }
  toString(): string { return '[AttemptKeys]'; }
  [Symbol.for('nodejs.util.inspect.custom')](): string { return '[AttemptKeys]'; }
}

/**
 * An attempt's keys from its base secret and context. Every output is made
 * before this returns, and the base secret isn't kept.
 */
export async function deriveAttemptKeys(provider: CryptoProvider, options: AttemptKeyOptions): Promise<AttemptKeys> {
  const mode = options?.mode;
  if (!Object.prototype.hasOwnProperty.call(BASE_BYTES, mode)) throw invalid('An attempt is by link, by code or a resume.');
  const baseBytes = BASE_BYTES[mode];
  if (!isBytes(options.base, baseBytes)) throw invalid(`A ${mode} attempt's base secret is ${baseBytes} bytes.`);
  const ctx = contextOf(options.roomNonce, options.attemptId);
  const { base } = options;
  const [psk, sealR2S, sealS2R] = await Promise.allSettled([
    provider.hkdf(base, ctx, info(INFO.psk), PSK_BYTES),
    provider.deriveContentKey(base, ctx, info(INFO.sealR2S)),
    provider.deriveContentKey(base, ctx, info(INFO.sealS2R)),
  ]);
  if (psk.status === 'rejected' || sealR2S.status === 'rejected' || sealS2R.status === 'rejected') {
    // The PSK isn't left behind if a key couldn't be made.
    if (psk.status === 'fulfilled') psk.value.fill(0);
    throw [psk, sealR2S, sealS2R].find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason;
  }
  return new AttemptKeys(mode, ctx.slice(0, CPACE_ROOM_NONCE_BYTES), ctx.slice(CPACE_ROOM_NONCE_BYTES), {
    psk: psk.value, sealR2S: sealR2S.value, sealS2R: sealS2R.value,
  });
}

/** The two keys an out-of-band close is sealed under, one each way, and the attempt they're for. */
export interface CloseKeys {
  /** The receiver's close frame. */
  readonly closeR2S: ContentKey;
  /** The sender's. */
  readonly closeS2R: ContentKey;
  /** The attempt's public values, as a close frame's header and associated data carry them. */
  readonly roomNonce: Uint8Array<ArrayBuffer>;
  readonly attemptId: Uint8Array<ArrayBuffer>;
}

export interface CloseKeyOptions {
  /** BIND's closeSecret, 32 bytes. Only read: the caller overwrites it when it's done. */
  closeSecret: Uint8Array;
  roomNonce: Uint8Array;
  attemptId: Uint8Array;
}

/** The out-of-band close keys, from BIND's closeSecret and the attempt's context. */
export async function deriveCloseKeys(provider: CryptoProvider, options: CloseKeyOptions): Promise<CloseKeys> {
  if (!isBytes(options?.closeSecret, CLOSE_SECRET_BYTES)) throw invalid(`A close secret is ${CLOSE_SECRET_BYTES} bytes.`);
  const ctx = contextOf(options.roomNonce, options.attemptId);
  const [closeR2S, closeS2R] = await Promise.all([
    provider.deriveContentKey(options.closeSecret, ctx, info(INFO.closeR2S)),
    provider.deriveContentKey(options.closeSecret, ctx, info(INFO.closeS2R)),
  ]);
  return Object.freeze({
    closeR2S, closeS2R, roomNonce: ctx.slice(0, CPACE_ROOM_NONCE_BYTES), attemptId: ctx.slice(CPACE_ROOM_NONCE_BYTES),
  });
}
