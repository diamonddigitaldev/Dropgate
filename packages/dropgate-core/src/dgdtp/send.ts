import type { CryptoProvider } from '../crypto/index.js';
import { DropgateError, toDropgateError } from '../errors.js';
import { readRange, type FileSource } from '../source.js';
import { openRoom, type HelloOptions, type IncomingAttempt, type PeerConnection, type SecureChannel, type SenderRendezvous, type SenderRoom } from './channel.js';
import type { LocatorLetters } from './codes.js';
import {
  CREDIT_WINDOW_BYTES, GLOBAL_TIMERS, Link, Listeners, MAX_UNFINISHED_FILE_ENDS, RESULT_ACK_WAIT_MS, SOURCE_BLOCKS_AHEAD, closeFor, deferred,
  invalidMessage, outcomeOfClose, readRecord, sameBytes, within,
  type DirectOutcome, type DirectState, type EngineTimers, type Inbound,
} from './engine.js';
import {
  BLOCK_BYTES, blockCount, chainBlock, chainFileEnd, chainStart, dataBytes, encodeManifest, manifestHash, manifestRecords,
  type CloseDetail, type CloseReason, type Message,
} from './messages.js';

// The sender's side of one direct transfer.
//
// `sendDirect()` opens a room on the rendezvous (its link, and a code if one
// was asked for and is free). Every receiver that reaches it runs the secure
// channel's handshake, then is sent the list of files (MANIFEST records the
// size both hellos allow) and sees the offer. The first ACCEPT whose manifest
// hash matches wins: the room is locked (no new attempt, every other dropped
// at the rendezvous) and every other receiver already offered is told TAKEN
// with a CLOSE. A receiver that declines ends the send.
//
// The chosen receiver's transfer: each file read from its source a 1 MiB
// block at a time, at most 2 blocks ahead of what's sent; each block hashed
// and stepped into the checkpoint chain, then sent as DATA records, each
// exactly the most a record holds or what's left of the block, never past
// the receiver's credit, then its BLOCK_END; each file's FILE_END with the
// chain, at most 8 ahead of the files the receiver has finished; then FINISH.
// RESULT, with the same totals and chain, is answered with RESULT_ACK, and the
// send is completed with the receiver's assurance.
//
// A file that can't be read (SOURCE_UNAVAILABLE) or a record that isn't one
// (INVALID_MESSAGE) is told to the receiver with a CLOSE. Every effect is
// fenced by its generation.

export interface DirectSendOptions {
  /** The files, in order: each read in 1 MiB pieces. */
  files: readonly FileSource[];
  /** The rendezvous the room is opened on. */
  rendezvous: SenderRendezvous;
  /** A new peer connection for each receiver's attempt. */
  peer: () => PeerConnection;
  /** Whether to ask for a code too: the link always works. */
  code?: boolean;
  /** How many letters of a code are its locator: the server's `codeLetters`. */
  letters?: LocatorLetters;
  /** This side's hello: its pause limit and reconnect window. */
  hello?: HelloOptions;
  timers?: EngineTimers;
}

/** What the sender's session needs of the send it's part of. */
export interface SessionHost {
  readonly provider: CryptoProvider;
  readonly files: readonly FileSource[];
  readonly sizes: readonly number[];
  readonly totalSize: number;
  readonly manifest: Uint8Array;
  readonly manifestHash: Uint8Array;
  readonly timers: EngineTimers;
  /** A receiver accepted: true if it's the one chosen, false if another was. */
  accepted(session: SenderSession): boolean;
  /** The session's transfer moved on (offered, transferring, finalising). */
  moved(session: SenderSession): void;
  /** The session ended: how, for the chosen one; for any other, its error, or a decline. */
  ended(session: SenderSession, outcome: DirectOutcome): void;
}

type SessionPhase = 'offered' | 'transferring' | 'finalising' | 'ended';

/** One prepared step of the stream: a block, read, hashed and chained; a file's end; or the finish. */
type Prepared =
  | { kind: 'block'; fileIndex: number; blockIndex: number; bytes: Uint8Array; hash: Uint8Array; sent: number }
  | { kind: 'file-end'; fileIndex: number; size: number; blockCount: number; chain: Uint8Array }
  | { kind: 'finish'; chain: Uint8Array };

/** The sender's side of one receiver's channel: the offer, and the transfer once this receiver is chosen. */
export class SenderSession {
  readonly attempt: IncomingAttempt | undefined;
  readonly #host: SessionHost;
  readonly #link: Link;
  readonly #generation: bigint;
  readonly #maxData: number;
  #phase: SessionPhase = 'offered';
  #resumeSecret: Uint8Array | undefined;
  #assurance: 'saved' | 'handed-off' = 'saved';

  // The stream.
  readonly #queue: Prepared[] = [];
  #producerWake: (() => void) | undefined;
  #finalChain: Uint8Array | undefined;
  #submitted = 0;
  #limit = 0;
  #revision = 0;
  #consumed = 0;
  #filesDone = 0;
  #fileEndsSent = 0;
  /** Completed: the channel waits this long for the receiver to close it. */
  #linger: unknown;

  constructor(host: SessionHost, channel: SecureChannel, attempt?: IncomingAttempt) {
    if (channel?.role !== 'sender') throw new DropgateError({ code: 'INVALID_ARGUMENT', message: "A send runs over the sender's channel." });
    this.#host = host;
    this.attempt = attempt;
    this.#generation = channel.generation;
    this.#link = new Link(channel, { record: (inbound) => this.deliver(inbound), ended: (err) => this.#lost(err) });
    this.#maxData = dataBytes(this.#link.recordBytes);
  }

  get phase(): SessionPhase { return this.#phase; }

  /** Sends the list of files, in records the size both hellos allow, and starts reading the receiver's. */
  start(): void {
    for (const record of manifestRecords(this.#host.manifest, this.#link.recordBytes)) this.#link.sendRecord(record);
    this.#link.start();
  }

  /**
   * One record from the receiver, with its connection's generation. One from
   * another generation, or after the end, is dropped and touches nothing.
   * @internal
   */
  async deliver(inbound: Inbound): Promise<void> {
    const g = inbound.generation;
    if (!this.#live(g)) return;
    try {
      await this.#take(readRecord(inbound.record), g);
    } catch (err) {
      this.#fail(err, g);
    }
  }

  /** Another receiver was chosen: this one is told TAKEN, and its session ends. */
  taken(): void {
    if (this.#phase === 'ended') return;
    void this.#end({ state: 'failed', error: new DropgateError({ code: 'REQUEST_REJECTED', message: 'Another receiver accepted first.' }) }, { reason: 'TAKEN' });
  }

  /** Closes the channel: the send was cancelled or has ended. (The receiver hears it as the connection closing, for now.) */
  close(): void {
    void this.#end({ state: 'cancelled', by: 'self' });
  }

  #live(g: bigint): boolean {
    return this.#phase !== 'ended' && g === this.#generation;
  }

  async #take(message: Message, g: bigint): Promise<void> {
    switch (message.type) {
      case 'accept': return this.#accept(message, g);
      case 'credit': return this.#credit(message);
      case 'result': return this.#result(message);
      case 'close': return this.#closeHeard(message);
      case 'hold':
      case 'ping':
      case 'pong':
      case 'status':
      case 'close-ack':
        // Pausing, liveness and the close's answer aren't used yet: passed over.
        return undefined;
      default:
        // Every other record is the sender's to send, never the receiver's (BIND comes only in the handshake).
        throw invalidMessage();
    }
  }

  async #accept(m: Extract<Message, { type: 'accept' }>, g: bigint): Promise<void> {
    if (this.#phase !== 'offered') throw invalidMessage();
    if (!sameBytes(m.manifestHash, this.#host.manifestHash) || m.creditLimit > CREDIT_WINDOW_BYTES) throw invalidMessage();
    // Another receiver already has it.
    if (!this.#host.accepted(this)) {
      this.taken();
      return;
    }
    this.#resumeSecret = new Uint8Array(m.resumeSecret);
    this.#assurance = m.sink;
    this.#limit = m.creditLimit;
    this.#phase = 'transferring';
    this.#host.moved(this);
    this.#link.stream({ next: () => this.#next() });
    void this.#produce(g);
  }

  #credit(m: Extract<Message, { type: 'credit' }>): void {
    if (this.#phase !== 'transferring' && this.#phase !== 'finalising') throw invalidMessage();
    // Revisions only rise, nothing goes down, nothing is said to be written that wasn't sent, and no more than 4 MiB is given ahead.
    if (m.revision <= this.#revision || m.limit < this.#limit || m.consumed < this.#consumed || m.filesDone < this.#filesDone
      || m.consumed > this.#submitted || m.limit - m.consumed > CREDIT_WINDOW_BYTES || m.filesDone > this.#fileEndsSent) {
      throw invalidMessage();
    }
    this.#revision = m.revision;
    this.#limit = m.limit;
    this.#consumed = m.consumed;
    this.#filesDone = m.filesDone;
    this.#link.wake();
  }

  async #result(m: Extract<Message, { type: 'result' }>): Promise<void> {
    if (this.#phase !== 'finalising') throw invalidMessage();
    // The same totals and chain as were sent, and the files where ACCEPT said they'd go.
    if (m.fileCount !== this.#host.files.length || m.totalSize !== this.#host.totalSize || !sameBytes(m.chain, this.#finalChain as Uint8Array)
      || m.assurance !== this.#assurance) {
      throw invalidMessage();
    }
    this.#link.send({ type: 'result-ack', commitId: m.commitId });
    void this.#end({ state: 'completed', assurance: m.assurance });
  }

  #closeHeard(m: Extract<Message, { type: 'close' }>): void {
    void this.#end(outcomeOfClose(m, 'sender'));
  }

  /** Reads, hashes and chains the files' blocks in order, at most 2 ahead of what's sent. */
  async #produce(g: bigint): Promise<void> {
    const { provider, files, sizes } = this.#host;
    try {
      let chain = await chainStart(provider, this.#host.manifestHash);
      for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
        const size = sizes[fileIndex];
        const blocks = blockCount(size);
        for (let blockIndex = 0; blockIndex < blocks; blockIndex++) {
          while (this.#queue.filter((p) => p.kind === 'block').length >= SOURCE_BLOCKS_AHEAD) {
            await new Promise<void>((resolve) => { this.#producerWake = resolve; });
            if (!this.#live(g)) return;
          }
          const start = blockIndex * BLOCK_BYTES;
          const bytes = await readRange(files[fileIndex], start, Math.min(size, start + BLOCK_BYTES));
          if (!this.#live(g)) return;
          const hash = await provider.sha256(bytes);
          chain = await chainBlock(provider, chain, { fileIndex, blockIndex, length: bytes.byteLength, hash });
          if (!this.#live(g)) return;
          this.#queue.push({ kind: 'block', fileIndex, blockIndex, bytes, hash, sent: 0 });
          this.#link.wake();
        }
        chain = await chainFileEnd(provider, chain, { fileIndex, size, blockCount: blocks });
        if (!this.#live(g)) return;
        this.#queue.push({ kind: 'file-end', fileIndex, size, blockCount: blocks, chain });
        this.#link.wake();
      }
      this.#queue.push({ kind: 'finish', chain });
      this.#link.wake();
    } catch (err) {
      this.#fail(err, g);
    }
  }

  /** The stream's next record, if one is ready and may go now. */
  #next(): Message | undefined {
    if (this.#phase !== 'transferring') return undefined;
    const step = this.#queue[0];
    if (!step) return undefined;
    switch (step.kind) {
      case 'block': {
        if (step.sent < step.bytes.byteLength) {
          const n = Math.min(this.#maxData, step.bytes.byteLength - step.sent);
          // Never past the receiver's credit.
          if (this.#submitted + n > this.#limit) return undefined;
          const at = step.sent;
          step.sent += n;
          this.#submitted += n;
          return { type: 'data', fileIndex: step.fileIndex, offset: step.blockIndex * BLOCK_BYTES + at, bytes: step.bytes.subarray(at, at + n) };
        }
        this.#queue.shift();
        this.#wakeProducer();
        return { type: 'block-end', fileIndex: step.fileIndex, blockIndex: step.blockIndex, length: step.bytes.byteLength, hash: step.hash };
      }
      case 'file-end':
        // At most 8 file ends ahead of the files the receiver has finished.
        if (this.#fileEndsSent - this.#filesDone >= MAX_UNFINISHED_FILE_ENDS) return undefined;
        this.#queue.shift();
        this.#fileEndsSent += 1;
        return { type: 'file-end', fileIndex: step.fileIndex, size: step.size, blockCount: step.blockCount, chain: step.chain };
      default:
        this.#queue.shift();
        this.#finalChain = step.chain;
        this.#phase = 'finalising';
        this.#host.moved(this);
        return {
          type: 'finish', fileCount: this.#host.files.length, totalSize: this.#host.totalSize, manifestHash: this.#host.manifestHash, chain: step.chain,
        };
    }
  }

  #wakeProducer(): void {
    const wake = this.#producerWake;
    this.#producerWake = undefined;
    wake?.();
  }

  /** The channel ended under the session: lost as the channel says, unless the session has already ended. */
  #lost(err: DropgateError): void {
    if (this.#phase === 'ended') {
      if (this.#linger !== undefined) this.#host.timers.clearTimeout(this.#linger);
      this.#linger = undefined;
      return;
    }
    void this.#end({ state: 'failed', error: err });
  }

  /** This side failed, in generation `g`: the receiver told with a CLOSE. A failure from another generation is dropped. */
  #fail(err: unknown, g: bigint): void {
    if (!this.#live(g)) return;
    const error = toDropgateError(err);
    void this.#end({ state: 'failed', error }, closeFor(error));
  }

  /**
   * Ends the session, once: fenced at once, the producer woken to stop, the
   * receiver told with `close` if one is given, the resume secret
   * overwritten. Completed, the channel is left for the receiver to close (its
   * RESULT_ACK on its way), and closed after 2 s whatever happens.
   */
  async #end(outcome: DirectOutcome, close?: { reason: CloseReason; detail?: CloseDetail }): Promise<void> {
    if (this.#phase === 'ended') return;
    this.#phase = 'ended';
    this.#resumeSecret?.fill(0);
    this.#resumeSecret = undefined;
    this.#queue.length = 0;
    this.#wakeProducer();
    this.#link.stream(undefined);
    this.#host.ended(this, outcome);
    if (close) {
      this.#link.send({ type: 'close', operationId: this.#host.provider.randomBytes(16), ...close });
    }
    if (close || outcome.state === 'completed') await within(this.#link.flush(), RESULT_ACK_WAIT_MS, this.#host.timers);
    if (outcome.state === 'completed' && !this.#link.closed) {
      // The receiver closes once RESULT_ACK is in (#lost then clears this).
      this.#linger = this.#host.timers.setTimeout(() => this.#link.close(), RESULT_ACK_WAIT_MS);
      return;
    }
    this.#link.close();
  }
}

/** The sender's side of a direct transfer: its room, the receivers that reach it, and the one it sends to. */
export class DirectSender implements SessionHost {
  readonly provider: CryptoProvider;
  readonly files: readonly FileSource[];
  readonly sizes: readonly number[];
  readonly totalSize: number;
  readonly manifest: Uint8Array;
  readonly manifestHash: Uint8Array;
  readonly timers: EngineTimers;
  /** The room: its link's secret and its code. */
  readonly room: SenderRoom;
  readonly #options: DirectSendOptions;
  readonly #sessions = new Set<SenderSession>();
  readonly #listeners = new Listeners();
  readonly #attemptListeners = new Set<(err: DropgateError) => void>();
  readonly #done = deferred<DirectOutcome>();
  #chosen: SenderSession | undefined;
  #state: DirectState = 'waiting';
  #ended = false;

  /** @internal sendDirect() makes these. */
  constructor(
    provider: CryptoProvider, options: DirectSendOptions, room: SenderRoom,
    made: { sizes: number[]; totalSize: number; manifest: Uint8Array; manifestHash: Uint8Array },
  ) {
    this.provider = provider;
    this.#options = options;
    this.files = Object.freeze([...options.files]);
    this.sizes = Object.freeze(made.sizes);
    this.totalSize = made.totalSize;
    this.manifest = made.manifest;
    this.manifestHash = made.manifestHash;
    this.timers = options.timers ?? GLOBAL_TIMERS;
    this.room = room;
    void this.#takeAttempts();
  }

  /** Where the send stands. */
  get state(): DirectState { return this.#state; }

  /** How it ended, once it has. */
  get done(): Promise<DirectOutcome> { return this.#done.promise; }

  /** Calls `listener` whenever `state` changes. Returns a function that stops it. */
  onChange(listener: () => void): () => void { return this.#listeners.add(listener); }

  /** Calls `listener` with the error of each receiver's attempt that ends without being chosen (a wrong code, say). */
  onAttemptEnded(listener: (err: DropgateError) => void): () => void {
    this.#attemptListeners.add(listener);
    return () => { this.#attemptListeners.delete(listener); };
  }

  /** Cancels the send: every receiver's channel closed, the room closed. */
  cancel(): void {
    this.#finish({ state: 'cancelled', by: 'self' });
  }

  /** @internal */
  accepted(session: SenderSession): boolean {
    if (this.#ended) return false;
    this.#chosen = session;
    this.room.lock(session.attempt);
    for (const other of this.#sessions) if (other !== session) other.taken();
    return true;
  }

  /** @internal */
  moved(session: SenderSession): void {
    if (session !== this.#chosen || this.#ended) return;
    this.#setState(session.phase === 'finalising' ? 'finalising' : 'transferring');
  }

  /** @internal */
  ended(session: SenderSession, outcome: DirectOutcome): void {
    this.#sessions.delete(session);
    if (this.#ended) return;
    if (session === this.#chosen) {
      this.#finish(outcome);
      return;
    }
    // A receiver that declines ends the send.
    if (outcome.state === 'cancelled' && outcome.by === 'peer' && outcome.declined) {
      this.#finish(outcome);
      return;
    }
    if (outcome.state === 'failed') this.#tellAttempt(outcome.error);
    if (!this.#chosen && this.#sessions.size === 0) this.#setState('waiting');
  }

  async #takeAttempts(): Promise<void> {
    for (;;) {
      let attempt: IncomingAttempt;
      try {
        attempt = await this.room.nextAttempt();
      } catch (err) {
        // The room's connection to the rendezvous ended: before a receiver was chosen, so does the send.
        if (!this.#chosen) this.#finish({ state: 'failed', error: toDropgateError(err) });
        return;
      }
      if (this.#ended) return;
      void this.#take(attempt);
    }
  }

  async #take(attempt: IncomingAttempt): Promise<void> {
    let channel: SecureChannel;
    try {
      channel = await this.room.accept(attempt, { peer: this.#options.peer(), hello: this.#options.hello });
    } catch (err) {
      if (!this.#ended) this.#tellAttempt(toDropgateError(err));
      return;
    }
    if (this.#ended || this.#chosen) {
      channel.close();
      return;
    }
    const session = new SenderSession(this, channel, attempt);
    this.#sessions.add(session);
    session.start();
    this.#setState('offered');
  }

  #tellAttempt(err: DropgateError): void {
    for (const listener of [...this.#attemptListeners]) {
      try {
        listener(err);
      } catch {
        // A listener's error is its own.
      }
    }
  }

  #setState(state: DirectState): void {
    if (this.#state === state || this.#ended) return;
    this.#state = state;
    this.#listeners.notify();
  }

  #finish(outcome: DirectOutcome): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#state = outcome.state;
    for (const session of [...this.#sessions]) {
      if (session !== this.#chosen || outcome.state !== 'completed') session.close();
    }
    this.room.close();
    this.#done.resolve(outcome);
    this.#listeners.notify();
  }
}

/**
 * Starts a direct send of `options.files`: the list of files written and
 * checked (INVALID_FILENAME, INVALID_ARGUMENT) before anything is sent, then
 * the room opened on the rendezvous. The room's link and code are the
 * sender's to share.
 */
export async function sendDirect(provider: CryptoProvider, options: DirectSendOptions): Promise<DirectSender> {
  const { files, rendezvous, peer } = options ?? ({} as DirectSendOptions);
  if (typeof peer !== 'function') throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'A direct send needs a peer connection for each receiver.' });
  if (!Array.isArray(files)) throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'A direct send takes a list of files.' });
  files.forEach((file, index) => {
    if (!file || typeof file.read !== 'function' || typeof file.name !== 'string') {
      throw new DropgateError({ code: 'INVALID_ARGUMENT', message: `File at index ${index} is missing or invalid.`, details: { index } });
    }
  });
  const manifest = encodeManifest(files.map((file) => ({ name: file.name, size: file.size, type: file.type ?? '' })));
  const sizes = files.map((file) => file.size);
  const totalSize = sizes.reduce((sum, size) => sum + size, 0);
  const hash = await manifestHash(provider, manifest);
  const room = await openRoom(provider, { rendezvous, code: options.code === true, letters: options.letters });
  return new DirectSender(provider, options, room, { sizes, totalSize, manifest, manifestHash: hash });
}
