import type { ContentKey, CryptoProvider, X25519Key } from '../crypto/index.js';
import { DropgateError } from '../errors.js';

// Noise, for the one protocol DGDTP 4 runs over a direct transfer's data
// channel: Noise_NNpsk0_25519_AESGCM_SHA256 (the Noise Protocol Framework,
// revision 34), on core's crypto provider, so Web Crypto does the work where it
// can. The receiver is the initiator:
//
//   -> psk, e      message 1, the receiver's: its ephemeral key, under the PSK
//   <- e, ee       message 2, the sender's: its ephemeral key and the two keys'
//                  Diffie-Hellman, with the sender's capabilities as payload
//
// then Split() gives one key each way for the transport records. The
// prologue binds both DTLS fingerprints (prologue.ts makes it), and the PSK
// comes from the key schedule, so the handshake only completes between the
// two devices that hold the same secret, over the connection they set up.
//
// Dropgate's rules on top of Noise's:
// - A handshake payload is at most 1,024 bytes; a record at most 65,535 bytes
//   with its 16-byte tag (Noise's maximum message).
// - Each direction rekeys after every 65,536 records (Noise's Rekey(): the key
//   becomes the first 32 bytes of 32 zeros sealed under the reserved nonce
//   2^64 - 1), and its nonce carries on, never reset. A direction stops before
//   that reserved nonce.
// - Any message that doesn't open, or isn't the shape it must be, is
//   SECURITY_POLICY_MISMATCH, and whatever it arrived on is finished: nothing
//   is tried again, with or without encryption.
//
// Secrets stay out of reach: each AES key is a provider handle that can't be
// exported; the chaining key, the PSK's copy, each Diffie-Hellman result and
// each key's bytes before import are overwritten with zeros once used. No
// error carries anything from a message or a key.
//
// Cacophony's vector for this exact name (tests/fixtures/noise-cacophony-
// vector.json) and Dropgate's own rekey vectors from a second implementation
// (tests/helpers/reference-noise.mjs) pin every byte, on both providers.

declare const __DROPGATE_TEST_BUILD__: boolean | undefined;

/**
 * Only a test build (scripts/test-build-define.mjs) may pin an ephemeral key,
 * lower the rekey interval or move a nonce: every one of core's builds says no.
 */
const TEST_BUILD = typeof __DROPGATE_TEST_BUILD__ === 'boolean' && __DROPGATE_TEST_BUILD__;

/** The protocol's full name: exactly 32 bytes, SHA-256's length, so the hash starts as the name itself. */
export const NOISE_PROTOCOL_NAME = 'Noise_NNpsk0_25519_AESGCM_SHA256';

/** AES-GCM's tag, after every ciphertext. */
export const NOISE_TAG_BYTES = 16;

/** Noise's largest message: a record with its tag. */
export const NOISE_MAX_MESSAGE_BYTES = 65535;

/** The most plaintext one record holds. */
export const NOISE_MAX_RECORD_PLAINTEXT_BYTES = NOISE_MAX_MESSAGE_BYTES - NOISE_TAG_BYTES;

/** The most payload a handshake message holds. */
export const NOISE_MAX_HANDSHAKE_PAYLOAD_BYTES = 1024;

/** How many records each direction seals under one key before Rekey(). */
export const NOISE_REKEY_INTERVAL = 65536;

/** X25519's keys, SHA-256's output and AES-256's keys are all 32 bytes. */
const KEY_BYTES = 32;

/** A handshake message is an ephemeral public key, then the sealed payload. */
const MIN_HANDSHAKE_MESSAGE_BYTES = KEY_BYTES + NOISE_TAG_BYTES;
const MAX_HANDSHAKE_MESSAGE_BYTES = MIN_HANDSHAKE_MESSAGE_BYTES + NOISE_MAX_HANDSHAKE_PAYLOAD_BYTES;

/** 2^64 - 1, the nonce Noise keeps for Rekey(): no message is ever sealed under it. */
const MAX_NONCE = (1n << 64n) - 1n;

const EMPTY = new Uint8Array(0);

/** X25519's base point, u = 9. */
const BASE_POINT = Uint8Array.of(9, ...new Uint8Array(KEY_BYTES - 1));

const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
};

const invalid = (message: string) => new DropgateError({ code: 'INVALID_ARGUMENT', message });

/** A message that didn't open, or wasn't the shape it must be. It says nothing more. */
const insecure = () => new DropgateError({ code: 'SECURITY_POLICY_MISMATCH' });

/** A direction that has sealed every record its nonce allows. */
const exhausted = () => new DropgateError({
  code: 'SECURITY_POLICY_MISMATCH',
  origin: 'local',
  message: 'This connection has sent every record its keys allow, so it was closed.',
});

/** AES-GCM's nonce for Noise's counter: 4 zero bytes, then the counter as 8 bytes, big-endian. */
function nonceOf(n: bigint): Uint8Array<ArrayBuffer> {
  const nonce = new Uint8Array(12);
  new DataView(nonce.buffer).setBigUint64(4, n, false);
  return nonce;
}

/**
 * Noise's HKDF over the chaining key, kept as bytes: two or three 32-byte
 * outputs. Every intermediate is overwritten once used.
 */
async function hkdf(provider: CryptoProvider, ck: Uint8Array, ikm: Uint8Array, outputs: 2 | 3): Promise<Uint8Array<ArrayBuffer>[]> {
  const tempKey = await provider.hmac('SHA-256', ck, ikm);
  const out: Uint8Array<ArrayBuffer>[] = [];
  try {
    out.push(await provider.hmac('SHA-256', tempKey, Uint8Array.of(1)));
    for (let i = 2; i <= outputs; i++) {
      const input = concat(out[i - 2], Uint8Array.of(i));
      try {
        out.push(await provider.hmac('SHA-256', tempKey, input));
      } finally {
        input.fill(0);
      }
    }
    return out;
  } catch (err) {
    for (const part of out) part.fill(0);
    throw err;
  } finally {
    tempKey.fill(0);
  }
}

/** Noise's CipherState: a key (a provider handle) and its nonce. */
class CipherState {
  readonly #provider: CryptoProvider;
  #key: ContentKey | undefined;
  #n = 0n;

  constructor(provider: CryptoProvider) {
    this.#provider = provider;
  }

  get n(): bigint { return this.#n; }

  set n(n: bigint) { this.#n = n; }

  /** A new key from `raw`, which is overwritten, and the nonce back to 0. */
  async initializeKey(raw: Uint8Array): Promise<void> {
    try {
      this.#key = await this.#provider.importKey(raw, false);
      this.#n = 0n;
    } finally {
      raw.fill(0);
    }
  }

  /**
   * `plaintext` sealed under the next nonce, with `ad` (Noise's
   * EncryptWithAd). Every use of this state has a key by then.
   */
  async encryptWithAd(ad: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    const key = this.#needKey();
    if (this.#n >= MAX_NONCE) throw exhausted();
    const sealed = await this.#provider.encryptWithNonce(key, nonceOf(this.#n), plaintext, ad);
    this.#n += 1n;
    return sealed;
  }

  /** `sealed` opened under the next nonce, with `ad` (Noise's DecryptWithAd); SECURITY_POLICY_MISMATCH if it doesn't open. */
  async decryptWithAd(ad: Uint8Array, sealed: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    const key = this.#needKey();
    if (this.#n >= MAX_NONCE) throw insecure();
    let plaintext: Uint8Array<ArrayBuffer>;
    try {
      plaintext = await this.#provider.decryptWithNonce(key, nonceOf(this.#n), sealed, ad);
    } catch {
      throw insecure();
    }
    this.#n += 1n;
    return plaintext;
  }

  /** Noise's Rekey(): the key becomes the first 32 bytes of 32 zeros sealed under nonce 2^64 - 1. The nonce isn't reset. */
  async rekey(): Promise<void> {
    const sealed = await this.#provider.encryptWithNonce(this.#needKey(), nonceOf(MAX_NONCE), new Uint8Array(KEY_BYTES));
    const n = this.#n;
    try {
      await this.initializeKey(sealed.subarray(0, KEY_BYTES));
    } finally {
      sealed.fill(0);
      this.#n = n;
    }
  }

  /** Lets go of the key. */
  forget(): void {
    this.#key = undefined;
  }

  #needKey(): ContentKey {
    if (!this.#key) throw insecure();
    return this.#key;
  }
}

/** Noise's SymmetricState for this protocol: the chaining key and hash, as bytes, and the handshake's CipherState. */
class SymmetricState {
  readonly #provider: CryptoProvider;
  readonly cipher: CipherState;
  #ck: Uint8Array<ArrayBuffer>;
  #h: Uint8Array<ArrayBuffer>;

  private constructor(provider: CryptoProvider) {
    this.#provider = provider;
    this.cipher = new CipherState(provider);
    // The name is exactly 32 bytes, so h is the name, and ck starts as h.
    this.#h = new TextEncoder().encode(NOISE_PROTOCOL_NAME);
    this.#ck = new Uint8Array(this.#h);
  }

  /** InitializeSymmetric(name), then MixHash(prologue). */
  static async start(provider: CryptoProvider, prologue: Uint8Array): Promise<SymmetricState> {
    const state = new SymmetricState(provider);
    await state.mixHash(prologue);
    return state;
  }

  async mixHash(data: Uint8Array): Promise<void> {
    this.#h = await this.#provider.sha256(concat(this.#h, data));
  }

  async mixKey(ikm: Uint8Array): Promise<void> {
    const [ck, key] = await hkdf(this.#provider, this.#ck, ikm, 2);
    this.#replaceCk(ck);
    await this.cipher.initializeKey(key);
  }

  async mixKeyAndHash(ikm: Uint8Array): Promise<void> {
    const [ck, hash, key] = await hkdf(this.#provider, this.#ck, ikm, 3);
    this.#replaceCk(ck);
    try {
      await this.mixHash(hash);
    } finally {
      hash.fill(0);
    }
    await this.cipher.initializeKey(key);
  }

  async encryptAndHash(plaintext: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    const sealed = await this.cipher.encryptWithAd(this.#h, plaintext);
    await this.mixHash(sealed);
    return sealed;
  }

  async decryptAndHash(sealed: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    const plaintext = await this.cipher.decryptWithAd(this.#h, sealed);
    await this.mixHash(sealed);
    return plaintext;
  }

  /** Split(): the initiator's sending key, then the responder's, each a CipherState; the hash, a copy. The chaining key is gone after. */
  async split(): Promise<{ first: CipherState; second: CipherState; handshakeHash: Uint8Array<ArrayBuffer> }> {
    const [k1, k2] = await hkdf(this.#provider, this.#ck, EMPTY, 2);
    const first = new CipherState(this.#provider);
    const second = new CipherState(this.#provider);
    try {
      await first.initializeKey(k1);
      await second.initializeKey(k2);
    } finally {
      k1.fill(0);
      k2.fill(0);
    }
    const handshakeHash = new Uint8Array(this.#h);
    this.forget();
    return { first, second, handshakeHash };
  }

  /** Overwrites the chaining key and lets go of the handshake's key. */
  forget(): void {
    this.#ck.fill(0);
    this.cipher.forget();
  }

  #replaceCk(ck: Uint8Array<ArrayBuffer>): void {
    this.#ck.fill(0);
    this.#ck = ck;
  }
}

/** One direction of the transport: its CipherState, its records in call order, and Dropgate's limits. */
class Direction {
  readonly #cipher: CipherState;
  readonly #rekeyEvery: bigint;
  #closed = false;
  #tail: Promise<unknown> = Promise.resolve();

  constructor(cipher: CipherState, rekeyEvery: bigint) {
    this.#cipher = cipher;
    this.#rekeyEvery = rekeyEvery;
  }

  seal(plaintext: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    if (plaintext.byteLength > NOISE_MAX_RECORD_PLAINTEXT_BYTES) {
      return Promise.reject(invalid(`A record holds at most ${NOISE_MAX_RECORD_PLAINTEXT_BYTES} bytes.`));
    }
    // Copied now, as it's sealed after every earlier record: the caller may reuse its buffer.
    const copy = new Uint8Array(plaintext);
    return this.#next(async () => {
      const record = await this.#cipher.encryptWithAd(EMPTY, copy);
      await this.#afterRecord();
      return record;
    });
  }

  open(record: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    const copy = record instanceof Uint8Array ? new Uint8Array(record) : undefined;
    return this.#next(async () => {
      if (!copy || copy.byteLength < NOISE_TAG_BYTES || copy.byteLength > NOISE_MAX_MESSAGE_BYTES) throw insecure();
      const plaintext = await this.#cipher.decryptWithAd(EMPTY, copy);
      await this.#afterRecord();
      return plaintext;
    });
  }

  close(): void {
    this.#closed = true;
    this.#cipher.forget();
  }

  /** For tests only: where the nonce stands. */
  set nonce(n: bigint) {
    this.#cipher.n = n;
  }

  /** Runs `step` after every earlier one; once one fails, the direction is closed, and every later one fails. */
  #next<T>(step: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(async () => {
      if (this.#closed) throw insecure();
      try {
        return await step();
      } catch (err) {
        this.close();
        throw err;
      }
    });
    this.#tail = run.then(() => undefined, () => undefined);
    return run;
  }

  async #afterRecord(): Promise<void> {
    if (this.#cipher.n % this.#rekeyEvery === 0n) await this.#cipher.rekey();
  }
}

/**
 * The secure channel after the handshake: records sealed and opened strictly
 * in the order they're asked for, each direction under its own key.
 */
export interface NoiseTransport {
  /**
   * One record holding `plaintext`, at most 65,519 bytes (INVALID_ARGUMENT if
   * longer). After any failure, every later call fails.
   */
  encrypt(plaintext: Uint8Array): Promise<Uint8Array<ArrayBuffer>>;
  /**
   * The plaintext of the other side's next record. SECURITY_POLICY_MISMATCH if
   * it doesn't open, is shorter than a tag or longer than 65,535 bytes; then
   * every later call fails.
   */
  decrypt(record: Uint8Array): Promise<Uint8Array<ArrayBuffer>>;
  /** The handshake's hash, the same on both sides: a transcript, not a secret. */
  readonly handshakeHash: Uint8Array<ArrayBuffer>;
  /** Lets go of both keys: every later call fails. */
  close(): void;
}

const directions = new WeakMap<NoiseTransport, { send: Direction; receive: Direction }>();

function transportOf(send: Direction, receive: Direction, handshakeHash: Uint8Array<ArrayBuffer>): NoiseTransport {
  const transport: NoiseTransport = Object.freeze({
    encrypt: (plaintext: Uint8Array) => send.seal(plaintext),
    decrypt: (record: Uint8Array) => receive.open(record),
    get handshakeHash() { return new Uint8Array(handshakeHash); },
    close() {
      send.close();
      receive.close();
    },
  });
  directions.set(transport, { send, receive });
  return transport;
}

/**
 * For tests only, refused outside a test build: sets where one direction's
 * nonce stands, so a test can reach the end of the nonces.
 */
export function setNonceForTests(transport: NoiseTransport, direction: 'send' | 'receive', n: bigint): void {
  if (!TEST_BUILD) throw invalid('Moving a nonce is for tests only.');
  const held = directions.get(transport);
  if (!held) throw invalid("That isn't a Noise transport.");
  held[direction].nonce = n;
}

export interface NoiseOptions {
  /** What both sides bind into the handshake: DGDTP's 131-byte prologue, with both DTLS fingerprints. */
  prologue: Uint8Array;
  /** The 32-byte pre-shared key, from the key schedule. A copy is used, and overwritten once mixed in. */
  psk: Uint8Array;
  /**
   * For known-answer tests only, refused outside a test build: this side's
   * ephemeral private key (a 32-byte scalar), and how many records each
   * direction seals before it rekeys.
   */
  testing?: { ephemeral?: Uint8Array; rekeyEvery?: number };
}

interface Settings {
  prologue: Uint8Array<ArrayBuffer>;
  psk: Uint8Array<ArrayBuffer>;
  ephemeral?: Uint8Array<ArrayBuffer>;
  rekeyEvery: bigint;
}

function settingsOf(options: NoiseOptions): Settings {
  if (!(options?.prologue instanceof Uint8Array)) throw invalid('A Noise prologue is bytes.');
  if (!(options.psk instanceof Uint8Array) || options.psk.byteLength !== KEY_BYTES) throw invalid('A Noise PSK is 32 bytes.');
  let rekeyEvery = BigInt(NOISE_REKEY_INTERVAL);
  let ephemeral: Uint8Array<ArrayBuffer> | undefined;
  if (options.testing !== undefined) {
    if (!TEST_BUILD) throw invalid('A fixed ephemeral key and a lowered rekey interval are for tests only.');
    const { ephemeral: scalar, rekeyEvery: every } = options.testing;
    if (scalar !== undefined) {
      if (!(scalar instanceof Uint8Array) || scalar.byteLength !== KEY_BYTES) throw invalid('An X25519 scalar is 32 bytes.');
      ephemeral = new Uint8Array(scalar);
    }
    if (every !== undefined) {
      if (!Number.isInteger(every) || every < 1 || every > NOISE_REKEY_INTERVAL) throw invalid('A rekey interval is 1 to 65,536 records.');
      rekeyEvery = BigInt(every);
    }
  }
  return { prologue: new Uint8Array(options.prologue), psk: new Uint8Array(options.psk), ephemeral, rekeyEvery };
}

function checkPayload(payload: Uint8Array): void {
  if (!(payload instanceof Uint8Array)) throw invalid('A handshake payload is bytes.');
  if (payload.byteLength > NOISE_MAX_HANDSHAKE_PAYLOAD_BYTES) {
    throw invalid(`A handshake payload is at most ${NOISE_MAX_HANDSHAKE_PAYLOAD_BYTES} bytes.`);
  }
}

/** This side's ephemeral key pair: random, or in a test, from the fixed scalar, its public key the ladder's X25519 of the base point. */
async function ephemeralKey(provider: CryptoProvider, settings: Settings): Promise<{ privateKey: X25519Key; publicKey: Uint8Array<ArrayBuffer> }> {
  if (!settings.ephemeral) return provider.x25519Generate();
  try {
    const privateKey = await provider.x25519FromScalar(settings.ephemeral);
    return { privateKey, publicKey: await provider.x25519(privateKey, BASE_POINT) };
  } finally {
    settings.ephemeral.fill(0);
  }
}

/** Noise's DH: a low-order public key from the other side (the provider's INVALID_ARGUMENT) is SECURITY_POLICY_MISMATCH. */
async function dh(provider: CryptoProvider, privateKey: X25519Key, publicKey: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return await provider.x25519(privateKey, publicKey);
  } catch (err) {
    if (DropgateError.is(err, 'INVALID_ARGUMENT')) throw insecure();
    throw err;
  }
}

/** Whether a received handshake message is a length one can be. */
const handshakeLength = (message: Uint8Array) =>
  message instanceof Uint8Array && message.byteLength >= MIN_HANDSHAKE_MESSAGE_BYTES && message.byteLength <= MAX_HANDSHAKE_MESSAGE_BYTES;

type Step = 'ready' | 'busy' | 'sent' | 'read' | 'done' | 'failed';

/** Runs one handshake step if it's `expected`'s turn; any failure finishes the handshake, every key let go. */
function stepper(cleanUp: () => void) {
  let step: Step = 'ready';
  return async <T>(expected: Step, next: Step, run: () => Promise<T>): Promise<T> => {
    if (step === 'failed') throw insecure();
    if (step !== expected) throw invalid('That Noise handshake message is out of turn.');
    step = 'busy';
    try {
      const result = await run();
      step = next;
      return result;
    } catch (err) {
      step = 'failed';
      cleanUp();
      throw err;
    }
  };
}

/** The initiator's side of the handshake: in DGDTP, the receiver's. */
export interface NoiseInitiator {
  /** Message 1 (`psk, e`), with `payload` (none in DGDTP), at most 1,024 bytes. */
  writeMessage1(payload?: Uint8Array): Promise<Uint8Array<ArrayBuffer>>;
  /** Opens message 2 (`e, ee`): its payload, and the transport. SECURITY_POLICY_MISMATCH if it doesn't open. */
  readMessage2(message: Uint8Array): Promise<{ payload: Uint8Array<ArrayBuffer>; transport: NoiseTransport }>;
}

/** The responder's side of the handshake: in DGDTP, the sender's. */
export interface NoiseResponder {
  /** Opens message 1 (`psk, e`): its payload. SECURITY_POLICY_MISMATCH if it doesn't open. */
  readMessage1(message: Uint8Array): Promise<Uint8Array<ArrayBuffer>>;
  /** Message 2 (`e, ee`), with `payload` (the sender's capabilities), at most 1,024 bytes; and the transport. */
  writeMessage2(payload?: Uint8Array): Promise<{ message: Uint8Array<ArrayBuffer>; transport: NoiseTransport }>;
}

/** A new handshake as the initiator, on `provider`. */
export function noiseInitiator(provider: CryptoProvider, options: NoiseOptions): NoiseInitiator {
  const settings = settingsOf(options);
  let state: SymmetricState | undefined;
  let ephemeral: X25519Key | undefined;
  const turn = stepper(() => {
    settings.psk.fill(0);
    state?.forget();
    ephemeral = undefined;
  });
  return Object.freeze({
    async writeMessage1(payload: Uint8Array = EMPTY) {
      checkPayload(payload);
      return turn('ready', 'sent', async () => {
        state = await SymmetricState.start(provider, settings.prologue);
        await state.mixKeyAndHash(settings.psk);
        settings.psk.fill(0);
        const e = await ephemeralKey(provider, settings);
        ephemeral = e.privateKey;
        await state.mixHash(e.publicKey);
        await state.mixKey(e.publicKey);
        return concat(e.publicKey, await state.encryptAndHash(payload));
      });
    },
    readMessage2(message: Uint8Array) {
      return turn('sent', 'done', async () => {
        const ss = state as SymmetricState;
        if (!handshakeLength(message)) throw insecure();
        const re = message.slice(0, KEY_BYTES);
        await ss.mixHash(re);
        await ss.mixKey(re);
        const shared = await dh(provider, ephemeral as X25519Key, re);
        ephemeral = undefined;
        try {
          await ss.mixKey(shared);
        } finally {
          shared.fill(0);
        }
        const payload = await ss.decryptAndHash(message.subarray(KEY_BYTES));
        const { first, second, handshakeHash } = await ss.split();
        state = undefined;
        return { payload, transport: transportOf(new Direction(first, settings.rekeyEvery), new Direction(second, settings.rekeyEvery), handshakeHash) };
      });
    },
  });
}

/** A new handshake as the responder, on `provider`. */
export function noiseResponder(provider: CryptoProvider, options: NoiseOptions): NoiseResponder {
  const settings = settingsOf(options);
  let state: SymmetricState | undefined;
  let re: Uint8Array<ArrayBuffer> | undefined;
  const turn = stepper(() => {
    settings.psk.fill(0);
    settings.ephemeral?.fill(0);
    state?.forget();
  });
  return Object.freeze({
    readMessage1(message: Uint8Array) {
      return turn('ready', 'read', async () => {
        if (!handshakeLength(message)) throw insecure();
        state = await SymmetricState.start(provider, settings.prologue);
        await state.mixKeyAndHash(settings.psk);
        settings.psk.fill(0);
        re = message.slice(0, KEY_BYTES);
        await state.mixHash(re);
        await state.mixKey(re);
        return state.decryptAndHash(message.subarray(KEY_BYTES));
      });
    },
    async writeMessage2(payload: Uint8Array = EMPTY) {
      checkPayload(payload);
      return turn('read', 'done', async () => {
        const ss = state as SymmetricState;
        const e = await ephemeralKey(provider, settings);
        await ss.mixHash(e.publicKey);
        await ss.mixKey(e.publicKey);
        // A low-order key in message 1 is only found here, at the first DH.
        const shared = await dh(provider, e.privateKey, re as Uint8Array);
        try {
          await ss.mixKey(shared);
        } finally {
          shared.fill(0);
        }
        const message = concat(e.publicKey, await ss.encryptAndHash(payload));
        const { first, second, handshakeHash } = await ss.split();
        state = undefined;
        return { message, transport: transportOf(new Direction(second, settings.rekeyEvery), new Direction(first, settings.rekeyEvery), handshakeHash) };
      });
    },
  });
}
