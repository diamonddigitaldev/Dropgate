import type { CryptoProvider } from '../crypto/index.js';
import { DropgateError, toDropgateError } from '../errors.js';
import { CodePassword, newCode, parseCode, type LocatorLetters } from './codes.js';
import { CPACE_ATTEMPT_ID_BYTES, CPACE_ROOM_NONCE_BYTES, cpaceAbort, cpaceInitiator, cpaceResponder } from './cpace.js';
import {
  AttemptKeys, CLOSE_SECRET_BYTES, LINK_SECRET_BYTES, RESUME_SECRET_BYTES, deriveAttemptKeys, deriveCloseKeys, deriveRoomId,
  type AttemptMode,
} from './keys.js';
import {
  NOISE_MAX_HANDSHAKE_PAYLOAD_BYTES, NOISE_MAX_MESSAGE_BYTES, NOISE_TAG_BYTES, noiseInitiator, noiseResponder, type NoiseTransport,
} from './noise.js';
import { MAX_GENERATION, prologueFromSdp } from './prologue.js';
import {
  CLOSE_KIND, FRAME_HEADER_BYTES, closeChannel, signalChannel, type CloseChannel, type SignalChannel, type SignalMessage, type SignalRole,
} from './seal.js';

// A direct transfer's secure channel, end to end, for one attempt: from the
// secret both devices hold to an encrypted, authenticated channel over the
// connection they set up, with nothing on the way that the rendezvous (the
// Dropgate server) can read or change unnoticed.
//
//   1. The secret. By link: the link's 32-byte secret S, whose room ID
//      (keys.ts) is the room's address on the rendezvous. By code: the code's
//      locator finds the room, and CPace (cpace.ts) turns its password into a
//      64-byte ISK, handed straight to the key schedule. On resume: the resume
//      secret R both sides hold. The receiver makes a new attempt ID every
//      time, and the sender's room nonce is the room's; the key schedule makes
//      the attempt's keys from the secret, the nonce and the attempt ID.
//   2. Sealed signalling (seal.ts) through the rendezvous: the receiver's
//      OFFER, the sender's ANSWER, each side's ICE candidates as they're found
//      and the end of them. In code mode the receiver reads the sender's CPace
//      abort where it waits for the sender's first frame.
//   3. Over the data channel, Noise NNpsk0 (noise.ts), the receiver as the
//      initiator, under the attempt's PSK, with the prologue (prologue.ts) made
//      from the two SDPs' fingerprints: message 1 is empty (DGDTP's rule, and a
//      payload there is refused), message 2 carries the sender's hello.
//   4. BIND, the receiver's first record: its capabilities, and closeSecret, 32
//      random bytes from which both sides make the out-of-band close keys, so
//      a CLOSE can also go sealed through the rendezvous once the data channel
//      is gone.
//
// Every failure ends the attempt with its typed error, and every key it made
// let go: CODE_MISMATCH for a code that didn't match (each side told in its
// own words); SECURITY_POLICY_MISMATCH for anything that doesn't open, isn't
// the next message, or breaks the fingerprint rule; CONNECTION_LOST when the
// rendezvous or the data channel goes before the channel is up. Whichever side
// finds a fault in the handshake or after it sends its abort, one zero byte,
// on the data channel before closing it, which the other side's Noise refuses
// in turn, so both end with the same error; nothing after the handshake is
// sent. No error carries anything from the other device, and nothing here logs.

/** The most the sender's hello (Noise message 2's payload) or the receiver's capabilities (in BIND) hold. */
export const MAX_HELLO_BYTES = NOISE_MAX_HANDSHAKE_PAYLOAD_BYTES;

/**
 * The smallest record a data channel must carry: one that can't take 16,384
 * bytes (with Noise's tag) ends the attempt with CAPABILITY_UNSUPPORTED. The
 * largest is Noise's 65,535.
 */
export const MIN_RECORD_BYTES = 16384;

/**
 * The abort on the data channel: one zero byte, too short for any handshake
 * message or record, so the other side's Noise refuses it. Not an empty
 * message, which some WebRTC stacks can't send.
 */
const DATA_ABORT = Uint8Array.of(0);

/** BIND's type, the receiver's first record: then closeSecret (32), then its capabilities. */
const BIND_TYPE = 0x01;
const BIND_HEADER_BYTES = 1 + CLOSE_SECRET_BYTES;

/** What each side is told when a code didn't match. */
const CODE_MISMATCH_WORDING: Readonly<Record<SignalRole, string>> = Object.freeze({
  receiver: "That code didn't match. Ask the sender for the new one.",
  sender: "Someone entered the wrong code. Here's a new one.",
});

const invalid = (message: string) => new DropgateError({ code: 'INVALID_ARGUMENT', message });
const insecure = () => new DropgateError({ code: 'SECURITY_POLICY_MISMATCH' });
const lost = () => new DropgateError({ code: 'CONNECTION_LOST' });

const isBytes = (value: unknown, length: number): value is Uint8Array => value instanceof Uint8Array && value.byteLength === length;

/** An ordered path for whole messages, each way: one attempt's through the rendezvous, or the data channel. */
export interface MessagePipe {
  /** Sends one message, which the pipe copies or sends before it returns. */
  send(message: Uint8Array): void;
  /** The other side's next message, in order; rejects once the pipe is closed and every message sent before is taken. */
  receive(): Promise<Uint8Array>;
  /**
   * Resolves once the pipe can take more without piling up (at once for a
   * path with no buffer to watch); rejects once the pipe is closed.
   */
  writable(): Promise<void>;
  close(): void;
}

/** The data channel's pipe: a message pipe that says the largest message it can send. */
export interface DataChannelPipe extends MessagePipe {
  /** The largest message `send()` can take, in bytes: the data channel's max-message-size. */
  readonly maxMessageBytes: number;
}

/** An ICE candidate, as WebRTC gives and takes it. */
export interface IceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment: string | null;
}

/** An SDP description. */
export interface SessionDescription {
  type: 'offer' | 'answer';
  sdp: string;
}

/**
 * What the channel needs of a peer connection with one data channel: a
 * WebRTC one, or a test's in memory. The receiver makes the offer, and its
 * peer connection the data channel.
 */
export interface PeerConnection {
  createOffer(): Promise<string>;
  createAnswer(): Promise<string>;
  setLocalDescription(description: SessionDescription): Promise<void>;
  setRemoteDescription(description: SessionDescription): Promise<void>;
  /** The other side's candidate, or null for the end of them. */
  addIceCandidate(candidate: IceCandidate | null): Promise<void>;
  /** Calls `listener` with each local candidate as it's found, then null at the end of them. */
  onIceCandidate(listener: (candidate: IceCandidate | null) => void): void;
  /** The data channel, once it's open. */
  dataChannel(): Promise<DataChannelPipe>;
  close(): void;
}

/** The receiver's side of the rendezvous: joining a room by link mode's room ID, or by a code's locator. */
export interface ReceiverRendezvous {
  /** The room's nonce, and this attempt's pipe to the sender. */
  join(by: { roomId: Uint8Array } | { locator: string }): Promise<{ roomNonce: Uint8Array; pipe: MessagePipe }>;
}

/** What the rendezvous tells a sender's room after it's opened, in the order it comes. */
export interface RoomNews {
  /** An attempt reached the room. */
  attempt(attempt: IncomingAttempt): void;
  /** A new code's locator, or none for now (none free, or the last was released). */
  code(locator: string | undefined): void;
  /** The room's connection to the rendezvous ended: no more attempts or codes. */
  ended?(err: DropgateError): void;
}

/** The sender's side of the rendezvous: opening its room, and what comes to it. */
export interface SenderRendezvous {
  /**
   * Opens the room under link mode's room ID and the sender's nonce: a code's
   * locator, if one was asked for and one is free. Later attempts and codes
   * come through `news`.
   */
  create(room: { roomId: Uint8Array; roomNonce: Uint8Array; code: boolean }, news?: RoomNews): Promise<{ locator?: string }>;
  /** False when the server gives no codes (`/api/info`'s `codeLetters` 0): a room asking for one then has its code off. */
  readonly givesCodes?: boolean;
  /** A receiver was accepted: no new attempts, every other one dropped, no more codes. */
  lock?(keep?: IncomingAttempt): void;
  /** Closes the room on the rendezvous. */
  close?(): void;
}

/** A secure channel, once its handshake is done and BIND is sent or taken. Printed, logged or serialised, it shows as `[SecureChannel]`. */
export interface SecureChannel {
  readonly role: SignalRole;
  readonly mode: AttemptMode;
  /** The connection's generation: 0 for the first, one more for each resume. */
  readonly generation: bigint;
  /** The attempt's public values, copies. */
  readonly roomNonce: Uint8Array<ArrayBuffer>;
  readonly attemptId: Uint8Array<ArrayBuffer>;
  /** Noise's handshake hash, the same on both sides: a transcript, not a secret. */
  readonly handshakeHash: Uint8Array<ArrayBuffer>;
  /** What the other side sent with the handshake: the sender's hello, or the receiver's capabilities. */
  readonly peerHello: Uint8Array<ArrayBuffer>;
  /**
   * The largest record this side can send, with Noise's 16-byte tag:
   * min(65,535, the data channel's max-message-size), at least 16,384.
   */
  readonly maxRecordBytes: number;
  /** One record to the other side, at most `maxRecordBytes` − 16 bytes. */
  send(plaintext: Uint8Array): Promise<void>;
  /** The other side's next record. */
  receive(): Promise<Uint8Array<ArrayBuffer>>;
  /** Resolves once the data channel's buffer has room again (`MessagePipe.writable()`); rejects once the channel has ended. */
  writable(): Promise<void>;
  /** This side's one out-of-band close, sealed, through the rendezvous: `body` at most 509 bytes. */
  sendClose(body: Uint8Array): Promise<void>;
  /** The other side's out-of-band close, when one comes: its body. */
  readonly closeReceived: Promise<Uint8Array<ArrayBuffer>>;
  /** Ends the channel: every key let go, the data channel, the pipe and the peer connection closed. */
  close(): void;
}

interface AttemptOptions {
  /** The receiver's capabilities (in BIND) or the sender's hello (Noise message 2), at most 1,024 bytes. */
  hello?: Uint8Array;
}

function checkHello(hello: unknown): Uint8Array<ArrayBuffer> {
  if (hello === undefined) return new Uint8Array(0);
  if (!(hello instanceof Uint8Array)) throw invalid('A hello is bytes.');
  if (hello.byteLength > MAX_HELLO_BYTES) throw invalid(`A hello is at most ${MAX_HELLO_BYTES} bytes.`);
  return new Uint8Array(hello);
}

function checkPeer(peer: unknown): asserts peer is PeerConnection {
  if (!peer || typeof (peer as PeerConnection).dataChannel !== 'function') throw invalid('A direct transfer needs a peer connection.');
}

function checkPipe(pipe: unknown): asserts pipe is MessagePipe {
  if (!pipe || typeof (pipe as MessagePipe).receive !== 'function' || typeof (pipe as MessagePipe).send !== 'function') {
    throw invalid("An attempt needs the rendezvous's pipe.");
  }
}

/** A room nonce from the rendezvous: 16 bytes, or its answer wasn't one. */
function roomNonceOf(value: unknown): Uint8Array<ArrayBuffer> {
  if (!isBytes(value, CPACE_ROOM_NONCE_BYTES)) throw new DropgateError({ code: 'INVALID_RESPONSE' });
  return new Uint8Array(value);
}

function nextGeneration(previous: unknown): bigint {
  if (typeof previous !== 'bigint' || previous < 0n || previous >= MAX_GENERATION) throw invalid('A previous generation is 0 to 2^64 - 2.');
  return previous + 1n;
}

/**
 * One attempt, for one side: the pipe's frames, the peer connection, Noise and
 * BIND, and what ends it. Made once the attempt's keys exist.
 */
class Attempt {
  readonly #provider: CryptoProvider;
  readonly #role: SignalRole;
  readonly #pipe: MessagePipe;
  readonly #peer: PeerConnection;
  readonly #generation: bigint;
  #keys: AttemptKeys | undefined;
  #signal: SignalChannel | undefined;
  #close: CloseChannel | undefined;
  #transport: NoiseTransport | undefined;
  #data: DataChannelPipe | undefined;
  #maxRecord = 0;
  #error: DropgateError | undefined;
  #ended = false;
  #outgoing: Promise<unknown> = Promise.resolve();
  #offer: string | undefined;
  #answer: string | undefined;
  #fail!: (err: DropgateError) => void;
  readonly #failed: Promise<never>;
  #closeBody!: (body: Uint8Array<ArrayBuffer>) => void;
  readonly closeReceived: Promise<Uint8Array<ArrayBuffer>>;

  constructor(provider: CryptoProvider, role: SignalRole, keys: AttemptKeys, pipe: MessagePipe, peer: PeerConnection, generation: bigint) {
    this.#provider = provider;
    this.#role = role;
    this.#keys = keys;
    this.#pipe = pipe;
    this.#peer = peer;
    this.#generation = generation;
    this.#signal = signalChannel(provider, { keys, role });
    this.#failed = new Promise<never>((_, reject) => { this.#fail = reject; });
    this.#failed.catch(() => undefined);
    this.closeReceived = new Promise((resolve) => { this.#closeBody = resolve; });
  }

  /** `promise`, or the attempt's failure if that comes first. */
  #race<T>(promise: Promise<T>): Promise<T> {
    return Promise.race([promise, this.#failed]);
  }

  /** The next message on `pipe`, or CONNECTION_LOST once it's closed. */
  async #next(pipe: MessagePipe): Promise<Uint8Array> {
    let message: unknown;
    try {
      message = await this.#race(pipe.receive());
    } catch (err) {
      if (this.#error) throw this.#error;
      throw pipeError(err);
    }
    if (!(message instanceof Uint8Array)) throw insecure();
    return message;
  }

  /** Seals `message` now, so its counter is the next, and sends it once every earlier frame has gone. */
  #sendSignal(message: SignalMessage): void {
    const signal = this.#signal;
    if (!signal || this.#ended) return;
    const sealed = signal.seal(message);
    this.#outgoing = this.#outgoing
      .then(() => sealed)
      .then((frame) => {
        if (!this.#ended) this.#pipe.send(frame);
      })
      .catch((err) => this.end(err));
  }

  /** Starts the attempt's signalling: local candidates as they come, and the pipe's frames as they arrive. */
  start(first?: Uint8Array): void {
    this.#peer.onIceCandidate((candidate) => {
      this.#sendSignal(candidate === null ? { type: 'end-of-candidates' } : { type: 'candidate', ...candidateOf(candidate) });
    });
    void this.#readPipe(first);
  }

  /** The receiver's offer, sealed first (counter 0), then applied. */
  async offer(): Promise<void> {
    const sdp = await this.#race(this.#peer.createOffer());
    this.#offer = sdp;
    this.#sendSignal({ type: 'offer', sdp });
    await this.#race(this.#peer.setLocalDescription({ type: 'offer', sdp }));
  }

  async #readPipe(first?: Uint8Array): Promise<void> {
    let frame = first;
    for (;;) {
      if (frame === undefined) {
        try {
          frame = await this.#pipe.receive();
        } catch (err) {
          // The rendezvous going matters only until the data channel is open, which carries on without it.
          if (!this.#data) this.end(pipeError(err));
          return;
        }
      }
      if (this.#ended) return;
      try {
        await this.#take(frame);
      } catch (err) {
        this.end(err);
        return;
      }
      frame = undefined;
    }
  }

  /** One frame from the pipe: an out-of-band close, or the next sealed signalling message, applied. */
  async #take(frame: Uint8Array): Promise<void> {
    if (frame instanceof Uint8Array && frame.byteLength > 0 && frame[0] === CLOSE_KIND) {
      // Anything that doesn't open as the other side's close is ignored: nothing the server injects ends anything.
      const body = this.#close ? await this.#close.open(frame) : undefined;
      if (body) this.#closeBody(body);
      return;
    }
    const signal = this.#signal;
    if (!signal) throw insecure();
    const first = signal.received === 0;
    const message = await signal.open(frame);
    if (this.#role === 'sender') {
      // The receiver's first frame is its offer, and there's one.
      if (first !== (message.type === 'offer')) throw insecure();
    } else if (first !== (message.type === 'answer')) {
      throw insecure();
    }
    switch (message.type) {
      case 'offer':
        await this.#answerOffer(message.sdp);
        break;
      case 'answer':
        this.#answer = message.sdp;
        await this.#peer.setRemoteDescription({ type: 'answer', sdp: message.sdp });
        break;
      case 'candidate':
      case 'end-of-candidates':
        try {
          await this.#peer.addIceCandidate(message.type === 'candidate' ? candidateOf(message) : null);
        } catch {
          // A candidate the peer connection can't use is skipped; ICE carries on with the others.
        }
        break;
      default:
        // An ICE restart's request: recovery isn't built on this channel yet, so it's ignored.
        break;
    }
  }

  /** The sender's answer to the receiver's offer: applied, sealed (counter 0), then set. */
  async #answerOffer(offer: string): Promise<void> {
    this.#offer = offer;
    await this.#peer.setRemoteDescription({ type: 'offer', sdp: offer });
    const sdp = await this.#peer.createAnswer();
    this.#answer = sdp;
    this.#sendSignal({ type: 'answer', sdp });
    await this.#peer.setLocalDescription({ type: 'answer', sdp });
  }

  /**
   * The prologue, once the data channel is open: both SDPs are known by then
   * (one that somehow isn't fails the fingerprint rule, SECURITY_POLICY_MISMATCH).
   */
  #prologue(): Uint8Array<ArrayBuffer> {
    const keys = this.#keys as AttemptKeys;
    return prologueFromSdp({
      mode: keys.mode, roomNonce: keys.roomNonce, attemptId: keys.attemptId, generation: this.#generation,
      offer: this.#offer as string, answer: this.#answer as string,
    });
  }

  /** The data channel, once open, and the largest record it carries: CAPABILITY_UNSUPPORTED under 16,384 bytes. */
  async #openData(): Promise<DataChannelPipe> {
    const data = await this.#race(this.#peer.dataChannel());
    this.#data = data;
    this.#maxRecord = recordLimit(data);
    return data;
  }

  /** The receiver's handshake and BIND, over the data channel. */
  async receiverHandshake(capabilities: Uint8Array<ArrayBuffer>): Promise<SecureChannel> {
    const data = await this.#openData();
    const prologue = this.#prologue();
    const keys = this.#keys as AttemptKeys;
    const initiator = await keys.usePsk((psk) => noiseInitiator(this.#provider, { prologue, psk }));
    data.send(await this.#race(initiator.writeMessage1()));
    const { payload, transport } = await this.#race(initiator.readMessage2(await this.#next(data)));
    this.#transport = transport;
    const closeSecret = this.#provider.randomBytes(CLOSE_SECRET_BYTES);
    const bind = new Uint8Array(BIND_HEADER_BYTES + capabilities.byteLength);
    try {
      bind[0] = BIND_TYPE;
      bind.set(closeSecret, 1);
      bind.set(capabilities, BIND_HEADER_BYTES);
      data.send(await this.#race(transport.encrypt(bind)));
      await this.#closeKeys(closeSecret);
    } finally {
      bind.fill(0);
      closeSecret.fill(0);
    }
    return this.#opened(payload);
  }

  /** The sender's handshake, then the receiver's BIND, over the data channel. */
  async senderHandshake(hello: Uint8Array<ArrayBuffer>): Promise<SecureChannel> {
    const data = await this.#openData();
    const prologue = this.#prologue();
    const keys = this.#keys as AttemptKeys;
    const responder = await keys.usePsk((psk) => noiseResponder(this.#provider, { prologue, psk }));
    const payload1 = await this.#race(responder.readMessage1(await this.#next(data)));
    // DGDTP's message 1 carries nothing.
    if (payload1.byteLength !== 0) throw insecure();
    const { message, transport } = await this.#race(responder.writeMessage2(hello));
    this.#transport = transport;
    data.send(message);
    const bind = await this.#race(transport.decrypt(await this.#next(data)));
    try {
      if (bind.byteLength < BIND_HEADER_BYTES || bind.byteLength > BIND_HEADER_BYTES + MAX_HELLO_BYTES || bind[0] !== BIND_TYPE) throw insecure();
      await this.#closeKeys(bind.subarray(1, BIND_HEADER_BYTES));
      return this.#opened(bind.slice(BIND_HEADER_BYTES));
    } finally {
      bind.fill(0);
    }
  }

  async #closeKeys(closeSecret: Uint8Array): Promise<void> {
    const keys = this.#keys as AttemptKeys;
    const closeKeys = await this.#race(deriveCloseKeys(this.#provider, { closeSecret, roomNonce: keys.roomNonce, attemptId: keys.attemptId }));
    this.#close = closeChannel(this.#provider, { keys: closeKeys, role: this.#role });
  }

  /** The channel, up. */
  #opened(peerHello: Uint8Array<ArrayBuffer>): SecureChannel {
    if (this.#ended) throw this.#error ?? insecure();
    const keys = this.#keys as AttemptKeys;
    const transport = this.#transport as NoiseTransport;
    const data = this.#data as DataChannelPipe;
    const handshakeHash = transport.handshakeHash;
    const { roomNonce, attemptId } = keys;
    const generation = this.#generation;
    const maxRecordBytes = this.#maxRecord;
    const maxPlaintext = maxRecordBytes - NOISE_TAG_BYTES;
    const attempt = this;
    const ended = () => attempt.#error ?? insecure();
    return Object.freeze({
      role: this.#role,
      mode: keys.mode,
      generation,
      maxRecordBytes,
      get roomNonce() { return new Uint8Array(roomNonce); },
      get attemptId() { return new Uint8Array(attemptId); },
      get handshakeHash() { return new Uint8Array(handshakeHash); },
      get peerHello() { return new Uint8Array(peerHello); },
      async send(plaintext: Uint8Array) {
        if (attempt.#ended) throw ended();
        // Too long for this data channel: refused, nothing sent, the channel carries on.
        if (plaintext instanceof Uint8Array && plaintext.byteLength > maxPlaintext) {
          throw invalid(`A record here holds at most ${maxPlaintext} bytes.`);
        }
        try {
          data.send(await transport.encrypt(plaintext));
        } catch (err) {
          if (DropgateError.is(err, 'INVALID_ARGUMENT')) throw err;
          throw attempt.end(err);
        }
      },
      async receive() {
        if (attempt.#ended) throw ended();
        try {
          return await transport.decrypt(await attempt.#next(data));
        } catch (err) {
          throw attempt.end(err);
        }
      },
      async writable() {
        try {
          await data.writable();
        } catch {
          // The data channel went, or the attempt ended and closed it: CONNECTION_LOST, or the error the attempt already ended with.
          throw attempt.end(lost());
        }
      },
      async sendClose(body: Uint8Array) {
        const close = attempt.#close;
        // Gone once the attempt has ended.
        if (!close) throw ended();
        attempt.#pipe.send(await close.seal(body));
      },
      closeReceived: this.closeReceived,
      close: () => { attempt.end(); },
      toJSON: () => '[SecureChannel]',
      toString: () => '[SecureChannel]',
      [Symbol.for('nodejs.util.inspect.custom')]: () => '[SecureChannel]',
    });
  }

  /**
   * Ends the attempt, once: every key let go, the data channel told (an empty
   * message) when its handshake or records went wrong, then everything closed.
   * Gives the attempt's error: the first one, as the screens should say it.
   */
  end(err?: unknown): DropgateError {
    if (this.#ended) return this.#error ?? insecure();
    this.#ended = true;
    const error = err === undefined ? new DropgateError({ code: 'OPERATION_CANCELLED' }) : errorFor(err, this.#role);
    this.#error = error;
    if (this.#data && error.code === 'SECURITY_POLICY_MISMATCH') {
      try {
        this.#data.send(DATA_ABORT);
      } catch {
        // Gone already.
      }
    }
    this.#keys?.forget();
    this.#keys = undefined;
    this.#signal?.close();
    this.#signal = undefined;
    this.#close = undefined;
    this.#transport?.close();
    this.#transport = undefined;
    for (const close of [() => this.#data?.close(), () => this.#pipe.close(), () => this.#peer.close()]) {
      try {
        close();
      } catch {
        // Closing what's already gone.
      }
    }
    this.#fail(error);
    return error;
  }
}

/**
 * The largest record `data` carries: min(65,535, its max-message-size), whole
 * bytes. Under 16,384, or no number at all, is CAPABILITY_UNSUPPORTED: the
 * other device's connection says it takes less than a direct transfer needs.
 */
function recordLimit(data: DataChannelPipe): number {
  const max = Math.floor(Math.min(NOISE_MAX_MESSAGE_BYTES, data.maxMessageBytes));
  if (!(max >= MIN_RECORD_BYTES)) {
    throw new DropgateError({
      code: 'CAPABILITY_UNSUPPORTED', origin: 'peer',
      message: "The other device's connection can't take messages as large as a direct transfer needs.",
    });
  }
  return max;
}

/** A candidate's four fields, nothing else. */
const candidateOf = (c: IceCandidate): IceCandidate => ({
  candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null, usernameFragment: c.usernameFragment ?? null,
});

/** The error an attempt ends with: a code that didn't match in this side's words; anything else as core's. */
function errorFor(err: unknown, role: SignalRole): DropgateError {
  if (DropgateError.is(err, 'CODE_MISMATCH')) return new DropgateError({ code: 'CODE_MISMATCH', message: CODE_MISMATCH_WORDING[role] });
  return toDropgateError(err);
}

/**
 * Runs `work`, the steps before an attempt exists and the attempt itself: any
 * failure closes what's open (`open()` says what, as it stands then), and ends
 * with the error as this side should say it.
 */
async function guarded<T>(role: SignalRole, open: () => Array<{ close(): void } | undefined>, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    for (const thing of open()) {
      try {
        thing?.close();
      } catch {
        // Already gone.
      }
    }
    throw errorFor(err, role);
  }
}

/** The receiver's attempt from its keys on: signalling, the handshake and BIND. */
async function receiverAttempt(
  provider: CryptoProvider, keys: AttemptKeys, pipe: MessagePipe, peer: PeerConnection, generation: bigint, capabilities: Uint8Array<ArrayBuffer>,
): Promise<SecureChannel> {
  const attempt = new Attempt(provider, 'receiver', keys, pipe, peer, generation);
  try {
    attempt.start();
    await attempt.offer();
    return await attempt.receiverHandshake(capabilities);
  } catch (err) {
    throw attempt.end(err);
  }
}

/** The sender's attempt from its keys on: the receiver's offer (already read in link mode), the handshake and BIND. */
async function senderAttempt(
  provider: CryptoProvider, keys: AttemptKeys, pipe: MessagePipe, peer: PeerConnection, generation: bigint, hello: Uint8Array<ArrayBuffer>, first?: Uint8Array,
): Promise<SecureChannel> {
  const attempt = new Attempt(provider, 'sender', keys, pipe, peer, generation);
  try {
    attempt.start(first);
    return await attempt.senderHandshake(hello);
  } catch (err) {
    throw attempt.end(err);
  }
}

/** The next message on a pipe before an attempt exists, or CONNECTION_LOST. */
async function firstMessage(pipe: MessagePipe): Promise<Uint8Array> {
  let message: unknown;
  try {
    message = await pipe.receive();
  } catch (err) {
    throw pipeError(err);
  }
  if (!(message instanceof Uint8Array)) throw insecure();
  return message;
}

/**
 * Why a pipe ended: its own error when it gives one of core's (the rendezvous
 * refusing something, say), else CONNECTION_LOST.
 */
function pipeError(err: unknown): DropgateError {
  return DropgateError.is(err) ? err : lost();
}

export interface ConnectOptions extends AttemptOptions {
  rendezvous: ReceiverRendezvous;
  peer: PeerConnection;
}

/**
 * The receiver's attempt by link: the room found by the link's secret's room
 * ID, a new attempt ID, the attempt's keys from the secret.
 */
export async function connectByLink(provider: CryptoProvider, options: ConnectOptions & { secret: Uint8Array }): Promise<SecureChannel> {
  const { rendezvous, peer, secret } = options ?? ({} as never);
  checkPeer(peer);
  if (!isBytes(secret, LINK_SECRET_BYTES)) throw invalid(`A link's secret is ${LINK_SECRET_BYTES} bytes.`);
  const capabilities = checkHello(options.hello);
  let pipe: MessagePipe | undefined;
  return guarded('receiver', () => [pipe, peer], async () => {
    const roomId = await deriveRoomId(provider, secret);
    let joined: { roomNonce: Uint8Array; pipe: MessagePipe };
    try {
      joined = await rendezvous.join({ roomId });
    } finally {
      roomId.fill(0);
    }
    pipe = joined?.pipe;
    checkPipe(pipe);
    const roomNonce = roomNonceOf(joined.roomNonce);
    const attemptId = provider.randomBytes(CPACE_ATTEMPT_ID_BYTES);
    const keys = await deriveAttemptKeys(provider, { mode: 'link', base: secret, roomNonce, attemptId });
    return receiverAttempt(provider, keys, pipe, peer, 0n, capabilities);
  });
}

/**
 * The receiver's attempt by a typed code: INVALID_CODE before anything is
 * sent if it isn't one; the room found by the locator, the only part that
 * leaves the device; CPace on the password, its ISK handed straight to the
 * key schedule; then the attempt as by link.
 */
export async function connectByCode(
  provider: CryptoProvider, options: ConnectOptions & { code: string; letters?: LocatorLetters },
): Promise<SecureChannel> {
  const { rendezvous, peer } = options ?? ({} as never);
  checkPeer(peer);
  const capabilities = checkHello(options.hello);
  const { locator, password } = parseCode(options.code, options.letters);
  let pipe: MessagePipe | undefined;
  let exchange: ReturnType<typeof cpaceInitiator> | undefined;
  try {
    return await guarded('receiver', () => [pipe, peer], async () => {
      const joined = await rendezvous.join({ locator });
      pipe = joined?.pipe;
      checkPipe(pipe);
      const roomNonce = roomNonceOf(joined.roomNonce);
      const attemptId = provider.randomBytes(CPACE_ATTEMPT_ID_BYTES);
      exchange = cpaceInitiator(provider, { password, locator, roomNonce, attemptId });
      pipe.send(await exchange.writeMessage1());
      const message2 = await firstMessage(pipe);
      let keys: AttemptKeys;
      try {
        const { message3, result } = await exchange.readMessage2(message2, (isk) =>
          deriveAttemptKeys(provider, { mode: 'code', base: isk, roomNonce, attemptId }));
        keys = result;
        pipe.send(message3);
      } catch (err) {
        if (DropgateError.is(err, 'CODE_MISMATCH')) pipe.send(cpaceAbort());
        throw err;
      }
      return receiverAttempt(provider, keys, pipe, peer, 0n, capabilities);
    });
  } finally {
    exchange?.close();
    password.forget();
  }
}

/**
 * The receiver's resume of a connection: a new attempt, on a pipe the
 * rendezvous gave for it, its keys from the resume secret R, the generation
 * one past the connection's last.
 */
export async function reconnect(
  provider: CryptoProvider,
  options: AttemptOptions & { pipe: MessagePipe; roomNonce: Uint8Array; resumeSecret: Uint8Array; previousGeneration: bigint; peer: PeerConnection },
): Promise<SecureChannel> {
  const { pipe, peer, resumeSecret } = options ?? ({} as never);
  checkPeer(peer);
  checkPipe(pipe);
  if (!isBytes(resumeSecret, RESUME_SECRET_BYTES)) throw invalid(`A resume secret is ${RESUME_SECRET_BYTES} bytes.`);
  const generation = nextGeneration(options.previousGeneration);
  const capabilities = checkHello(options.hello);
  return guarded('receiver', () => [pipe, peer], async () => {
    const roomNonce = roomNonceOf(options.roomNonce);
    const attemptId = provider.randomBytes(CPACE_ATTEMPT_ID_BYTES);
    const keys = await deriveAttemptKeys(provider, { mode: 'resume', base: resumeSecret, roomNonce, attemptId });
    return receiverAttempt(provider, keys, pipe, peer, generation, capabilities);
  });
}

/** An attempt reaching the sender's room, as the rendezvous says it came: by link, by code, or a resume. */
export type IncomingAttempt =
  | { by: 'link' | 'code'; pipe: MessagePipe }
  | { by: 'resume'; pipe: MessagePipe; resumeSecret: Uint8Array; previousGeneration: bigint };

/** A code as the room holds it: the locator, the password for CPace, and the whole code for the screen. */
interface RoomCode {
  locator: string;
  password: CodePassword;
  code: string;
}

/** Whether the room's code is on the sender's screen: `ready`, `unavailable` (none free, or being replaced), or `off` (not asked for). */
export type RoomCodeState = 'ready' | 'unavailable' | 'off';

/**
 * The rendezvous's news for a room that doesn't exist yet: kept in order until
 * the room takes it, so nothing that comes while it's being made is lost.
 */
class NewsRelay implements RoomNews {
  #target: RoomNews | undefined;
  readonly #early: Array<(target: RoomNews) => void> = [];

  connect(target: RoomNews): void {
    this.#target = target;
    for (const deliver of this.#early.splice(0)) deliver(target);
  }

  #pass(deliver: (target: RoomNews) => void): void {
    if (this.#target) deliver(this.#target);
    else this.#early.push(deliver);
  }

  attempt(attempt: IncomingAttempt): void { this.#pass((t) => t.attempt(attempt)); }
  code(locator: string | undefined): void { this.#pass((t) => t.code(locator)); }
  ended(err: DropgateError): void { this.#pass((t) => t.ended?.(err)); }
}

/**
 * The sender's room: its link's secret, its nonce, its code if it has one,
 * and the attempts that reach it. Printed, logged or serialised, it shows as
 * `[SenderRoom]`.
 *
 * A code is tried once, right or wrong: the code on the screen when an
 * attempt by code reaches the room is that attempt's, and the room is given a
 * new one (a new password, on whatever locator the rendezvous gives next),
 * so a code someone has typed is never shown again. The link keeps working.
 */
export class SenderRoom {
  readonly #provider: CryptoProvider;
  #secret: Uint8Array<ArrayBuffer> | undefined;
  readonly #roomNonce: Uint8Array<ArrayBuffer>;
  readonly #rendezvous: SenderRendezvous | undefined;
  readonly #letters: LocatorLetters | undefined;
  readonly #codeWanted: boolean;
  #code: RoomCode | undefined;
  /** Each attempt by code that came through the rendezvous's news, with the code it was for (none if none was shown). */
  readonly #bound = new Map<IncomingAttempt, RoomCode | undefined>();
  readonly #incoming: IncomingAttempt[] = [];
  readonly #waiting: Array<{ resolve: (attempt: IncomingAttempt) => void; reject: (err: unknown) => void }> = [];
  readonly #listeners = new Set<() => void>();
  #ended: DropgateError | undefined;

  /** @internal openRoom() makes these. */
  constructor(
    provider: CryptoProvider, secret: Uint8Array<ArrayBuffer>, roomNonce: Uint8Array<ArrayBuffer>,
    options: { code?: RoomCode; codeWanted?: boolean; rendezvous?: SenderRendezvous; letters?: LocatorLetters; news?: NewsRelay } = {},
  ) {
    this.#provider = provider;
    this.#secret = secret;
    this.#roomNonce = roomNonce;
    this.#code = options.code;
    this.#codeWanted = options.codeWanted ?? options.code !== undefined;
    this.#rendezvous = options.rendezvous;
    this.#letters = options.letters;
    options.news?.connect({
      attempt: (attempt) => this.#attempt(attempt),
      code: (locator) => this.#newCode(locator),
      ended: (err) => this.#end(err),
    });
    Object.freeze(this);
  }

  /** The link's secret, a copy, for the link the sender shares: undefined once the room is closed. */
  linkSecret(): Uint8Array<ArrayBuffer> | undefined {
    return this.#secret ? new Uint8Array(this.#secret) : undefined;
  }

  /** The room's nonce, a copy: public. */
  get roomNonce(): Uint8Array<ArrayBuffer> { return new Uint8Array(this.#roomNonce); }

  /** The code for the sender's screen, until an attempt uses it and a new one comes. */
  get code(): string | undefined { return this.#code?.code; }

  /** Whether a code is on the screen: `ready`; `unavailable` while none is free or the next is coming; `off` if none was asked for. */
  get codeState(): RoomCodeState {
    if (!this.#codeWanted) return 'off';
    return this.#code ? 'ready' : 'unavailable';
  }

  /** Calls `listener` whenever `code` changes. Returns a function that stops it. */
  onCodeChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  /**
   * The next attempt to reach the room, in the order they came. Rejects once
   * the room's connection to the rendezvous has ended, or the room is closed.
   */
  nextAttempt(): Promise<IncomingAttempt> {
    const ready = this.#incoming.shift();
    if (ready) return Promise.resolve(ready);
    if (this.#ended) return Promise.reject(this.#ended);
    return new Promise((resolve, reject) => this.#waiting.push({ resolve, reject }));
  }

  /**
   * A receiver was accepted: the room takes no new attempt and asks for no
   * more codes, every attempt but `keep` is dropped, and the code, if one is
   * shown, is let go.
   */
  lock(keep?: IncomingAttempt): void {
    this.#rendezvous?.lock?.(keep);
    this.#forgetCode();
    for (const [attempt, code] of this.#bound) {
      if (attempt !== keep) {
        code?.password.forget();
        this.#bound.delete(attempt);
      }
    }
    // The kept attempt, if it's still waiting to be taken, stays.
    for (const attempt of this.#incoming.splice(0)) {
      if (attempt === keep) this.#incoming.push(attempt);
      else attempt.pipe.close();
    }
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch {
        // A listener's error is its own.
      }
    }
  }

  #attempt(attempt: IncomingAttempt): void {
    if (this.#ended) {
      attempt.pipe.close();
      return;
    }
    if (attempt.by === 'code') {
      // The code on the screen now is this attempt's: tried once, then replaced.
      this.#bound.set(attempt, this.#code);
      this.#code = undefined;
      this.#notify();
    }
    const waiter = this.#waiting.shift();
    if (waiter) waiter.resolve(attempt);
    else this.#incoming.push(attempt);
  }

  /** The rendezvous gave a new locator (or none for now): a new password is drawn for it here. */
  #newCode(locator: string | undefined): void {
    if (this.#ended || !this.#codeWanted) return;
    // One change, told once: the old code goes and the new one comes together.
    this.#forgetCode(false);
    if (locator !== undefined) {
      try {
        this.#code = newCode(this.#provider, locator, this.#letters);
      } catch {
        // Not a locator of this room's length: no code is shown.
      }
    }
    this.#notify();
  }

  /** Lets the shown code go, its password overwritten; listeners told unless `tell` is false. */
  #forgetCode(tell = true): void {
    const had = this.#code !== undefined;
    this.#code?.password.forget();
    this.#code = undefined;
    if (had && tell) this.#notify();
  }

  #end(err: DropgateError): void {
    if (this.#ended) return;
    this.#ended = err;
    for (const waiter of this.#waiting.splice(0)) waiter.reject(err);
    this.#forgetCode();
  }

  /**
   * Takes one attempt to its secure channel. By code: CPace as the responder,
   * once per code, right or wrong (the code is gone afterwards; the link still
   * works). By link: the attempt's keys from the attempt ID in the receiver's
   * first frame. A resume: keys from R, the generation one past the last.
   */
  async accept(attempt: IncomingAttempt, options: AttemptOptions & { peer: PeerConnection }): Promise<SecureChannel> {
    const { peer } = options ?? ({} as never);
    checkPeer(peer);
    checkPipe(attempt?.pipe);
    const hello = checkHello(options.hello);
    const provider = this.#provider;
    const { pipe } = attempt;
    const roomNonce = this.#roomNonce;
    const open = () => [pipe, peer];
    if (attempt.by === 'code') {
      let code: RoomCode | undefined;
      if (this.#bound.has(attempt)) {
        code = this.#bound.get(attempt);
        this.#bound.delete(attempt);
      } else {
        // An attempt a test's rendezvous handed over directly: the code on the screen now.
        code = this.#code;
        this.#code = undefined;
        if (code) this.#notify();
      }
      return guarded('sender', open, async () => {
        // A code is used once, right or wrong: an attempt after that is answered with an abort.
        if (!code) {
          pipe.send(cpaceAbort());
          throw new DropgateError({ code: 'CODE_MISMATCH' });
        }
        const exchange = cpaceResponder(provider, { password: code.password, locator: code.locator, roomNonce });
        try {
          let keys: AttemptKeys;
          try {
            // The attempt ID comes in message 1: CPace binds it, and the key schedule uses it.
            const { message2, attemptId } = await exchange.readMessage1(await firstMessage(pipe));
            pipe.send(message2);
            ({ result: keys } = await exchange.readMessage3(await firstMessage(pipe), (isk) =>
              deriveAttemptKeys(provider, { mode: 'code', base: isk, roomNonce, attemptId })));
          } catch (err) {
            if (DropgateError.is(err, 'CODE_MISMATCH')) pipe.send(cpaceAbort());
            throw err;
          }
          return await senderAttempt(provider, keys, pipe, peer, 0n, hello);
        } finally {
          // Closing the exchange lets the password go too, spent or not.
          exchange.close();
        }
      });
    }
    if (attempt.by === 'resume') {
      const { resumeSecret } = attempt;
      if (!isBytes(resumeSecret, RESUME_SECRET_BYTES)) throw invalid(`A resume secret is ${RESUME_SECRET_BYTES} bytes.`);
      const generation = nextGeneration(attempt.previousGeneration);
      return guarded('sender', open, async () => {
        const first = await firstMessage(pipe);
        const keys = await deriveAttemptKeys(provider, { mode: 'resume', base: resumeSecret, roomNonce, attemptId: attemptIdIn(first) });
        return senderAttempt(provider, keys, pipe, peer, generation, hello, first);
      });
    }
    if (attempt.by !== 'link') throw invalid('An attempt comes by link, by code or as a resume.');
    return guarded('sender', open, async () => {
      const secret = this.#secret;
      if (!secret) throw invalid('This room is closed.');
      const first = await firstMessage(pipe);
      const keys = await deriveAttemptKeys(provider, { mode: 'link', base: secret, roomNonce, attemptId: attemptIdIn(first) });
      return senderAttempt(provider, keys, pipe, peer, 0n, hello, first);
    });
  }

  /**
   * Closes the room: the link's secret overwritten, every code's password let
   * go, the attempts not yet taken closed, and the room closed on the
   * rendezvous.
   */
  close(): void {
    this.#secret?.fill(0);
    this.#secret = undefined;
    this.#forgetCode();
    for (const code of this.#bound.values()) code?.password.forget();
    this.#bound.clear();
    for (const attempt of this.#incoming.splice(0)) attempt.pipe.close();
    this.#end(new DropgateError({ code: 'OPERATION_CANCELLED' }));
    this.#rendezvous?.close?.();
  }

  toJSON(): string { return '[SenderRoom]'; }
  toString(): string { return '[SenderRoom]'; }
  [Symbol.for('nodejs.util.inspect.custom')](): string { return '[SenderRoom]'; }
}

/** The attempt ID a receiver's first frame carries in its plain header: SECURITY_POLICY_MISMATCH if it's too short to be one. */
function attemptIdIn(frame: Uint8Array): Uint8Array<ArrayBuffer> {
  if (frame.byteLength < FRAME_HEADER_BYTES) throw insecure();
  return frame.slice(2, 2 + CPACE_ATTEMPT_ID_BYTES);
}

export interface OpenRoomOptions {
  rendezvous: SenderRendezvous;
  /** Whether to ask the rendezvous for a code too: the link always works. */
  code?: boolean;
  /** How many letters of a code are the locator: 2, or 3 on a server set for more rooms. */
  letters?: LocatorLetters;
}

/**
 * The sender's new room: a link's secret S and the room's nonce, both random
 * from the provider; the room opened on the rendezvous under S's room ID; and,
 * if a code was asked for and the rendezvous gave a locator, a code whose
 * password is drawn on this device. Later codes and attempts come to the room
 * from the rendezvous.
 */
export async function openRoom(provider: CryptoProvider, options: OpenRoomOptions): Promise<SenderRoom> {
  const { rendezvous } = options ?? ({} as never);
  if (!rendezvous || typeof rendezvous.create !== 'function') throw invalid('A room is opened on the rendezvous.');
  const secret = provider.randomBytes(LINK_SECRET_BYTES);
  const roomNonce = provider.randomBytes(CPACE_ROOM_NONCE_BYTES);
  const news = new NewsRelay();
  try {
    const roomId = await deriveRoomId(provider, secret);
    let created: { locator?: string };
    try {
      created = await rendezvous.create({ roomId, roomNonce: new Uint8Array(roomNonce), code: options.code === true }, news);
    } finally {
      roomId.fill(0);
    }
    let code: ReturnType<typeof newCode> | undefined;
    if (options.code === true && created?.locator !== undefined) {
      try {
        code = newCode(provider, created.locator, options.letters);
      } catch {
        // The rendezvous gave something that isn't a locator.
        rendezvous.close?.();
        throw new DropgateError({ code: 'INVALID_RESPONSE' });
      }
    }
    return new SenderRoom(provider, secret, roomNonce, {
      code: code && { locator: code.locator, password: code.password, code: code.code },
      codeWanted: options.code === true && rendezvous.givesCodes !== false,
      rendezvous,
      letters: options.letters,
      news,
    });
  } catch (err) {
    secret.fill(0);
    throw toDropgateError(err);
  }
}
