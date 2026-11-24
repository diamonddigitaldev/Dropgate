import type { CryptoProvider } from '../crypto/index.js';
import { DropgateError, toDropgateError } from '../errors.js';
import { readRange, type FileSource } from '../source.js';
import { openRoom, type HelloOptions, type IncomingAttempt, type PeerConnection, type SecureChannel, type SenderRendezvous, type SenderRoom } from './channel.js';
import type { LocatorLetters } from './codes.js';
import {
  CREDIT_WINDOW_BYTES, GLOBAL_TIMERS, Holds, Link, Listeners, MAX_UNFINISHED_FILE_ENDS, RESULT_ACK_WAIT_MS, SOURCE_BLOCKS_AHEAD, STATUS_STATE,
  StallWatch, closeFor, deferred, invalidMessage, offerTimedOut, outcomeOfClose, pauseLimitReached, readRecord, sameBytes, within,
  type CloseMessage, type CloseWhy, type DirectOutcome, type DirectState, type EngineTimers, type Inbound, type PausedBy, type PeerStatus,
  type StatusAnswer,
} from './engine.js';
import {
  BLOCK_BYTES, blockCount, chainBlock, chainFileEnd, chainStart, dataBytes, encodeManifest, manifestHash, manifestRecords,
  type Message, type ResultBody,
} from './messages.js';
import { CLOSE_ACK_WAIT_MS, LATE_CLOSE_WAIT_MS, OFFER_TIMEOUT_MS } from './timers.js';

// The sender's side of one direct transfer.
//
// `sendDirect()` opens a room on the rendezvous (its link, and a code if one
// was asked for and is free). Every receiver that reaches it runs the secure
// channel's handshake, then is sent the list of files (MANIFEST records the
// size both hellos allow) and sees the offer, for 10 minutes. The first
// ACCEPT whose manifest hash matches wins: the room is locked (no new
// attempt, every other dropped at the rendezvous) and every other receiver
// already offered is told TAKEN with a CLOSE. A receiver that declines, or an
// offer that runs out of time, ends the send.
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
// Pausing: either side may hold the transfer from ACCEPT to FINISH (HOLD), and
// nothing more of the stream goes while either does. A read that takes 30 s
// shows as stalled, and at 120 s ends the send SOURCE_UNAVAILABLE; neither
// counts while held. A cancel once FINISH has gone waits up to 2 s for the
// receiver's answer: if the files were already saved, the send completed.
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
  /** The session moved on (offered, transferring, finalising), or its holds, stall or the receiver's status changed. */
  moved(session: SenderSession): void;
  /** The session ended: how, for the chosen one; for any other, its error, or a decline. */
  ended(session: SenderSession, outcome: DirectOutcome): void;
}

type SessionPhase = 'offered' | 'transferring' | 'finalising' | 'closing' | 'ended';

/** One prepared step of the stream: a block, read, hashed and chained; a file's end; or the finish. */
type Prepared =
  | { kind: 'block'; fileIndex: number; blockIndex: number; bytes: Uint8Array; hash: Uint8Array; sent: number }
  | { kind: 'file-end'; fileIndex: number; size: number; blockCount: number; chain: Uint8Array }
  | { kind: 'finish'; chain: Uint8Array };

const cantPause = () => new DropgateError({ code: 'PAUSE_UNAVAILABLE', message: 'A direct transfer can be paused once it has been accepted, until all its data has been sent.' });
const connectionLost = () => new DropgateError({ code: 'CONNECTION_LOST', message: "The connection was lost, so the transfer couldn't continue." });

/** The sender's side of one receiver's channel: the offer, and the transfer once this receiver is chosen. */
export class SenderSession {
  readonly attempt: IncomingAttempt | undefined;
  readonly #host: SessionHost;
  readonly #link: Link;
  readonly #generation: bigint;
  readonly #maxData: number;
  readonly #holds: Holds;
  readonly #stall: StallWatch;
  readonly #peerPauseLimit: number;
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

  // Timers, and the end.
  #offerTimer: unknown;
  #lostTimer: unknown;
  /** Completed: the channel waits this long for the receiver to close it. */
  #linger: unknown;
  #peerStatus: PeerStatus | undefined;
  /** The receiver's CLOSE has been heard: another is ignored. */
  #peerClosed = false;
  readonly #settled = deferred<void>();

  constructor(host: SessionHost, channel: SecureChannel, attempt?: IncomingAttempt) {
    if (channel?.role !== 'sender') throw new DropgateError({ code: 'INVALID_ARGUMENT', message: "A send runs over the sender's channel." });
    this.#host = host;
    this.attempt = attempt;
    this.#generation = channel.generation;
    const g = this.#generation;
    const timers = host.timers;
    this.#peerPauseLimit = channel.peerHello.pauseLimitSeconds;
    this.#holds = new Holds(timers, channel.hello?.pauseLimitSeconds ?? 0, this.#peerPauseLimit, () => {
      this.#fail(pauseLimitReached('sender', 'self', channel.hello.pauseLimitSeconds), g);
    });
    this.#stall = new StallWatch(timers, () => host.moved(this), () => {
      this.#fail(new DropgateError({ code: 'SOURCE_UNAVAILABLE', message: 'Reading a file stopped for 2 minutes, so the transfer ended.' }), g);
    });
    this.#link = new Link(channel, {
      record: (inbound) => this.deliver(inbound),
      ended: (err) => this.#lost(err),
      close: (message, generation) => this.#closeHeard(message, generation),
      status: () => this.#status(),
      statusHeard: (answer, generation) => this.#statusHeard(answer, generation),
    }, timers);
    this.#maxData = dataBytes(this.#link.recordBytes);
  }

  get phase(): SessionPhase { return this.#phase; }

  /** Resolves once the session has ended and told its receiver (its CLOSE sent both ways, 2 s at most). */
  get settled(): Promise<void> { return this.#settled.promise; }

  /** Whether `pause()` can be called now: from ACCEPT until FINISH has gone. */
  get canPause(): boolean { return this.#phase === 'transferring'; }

  /** Who holds the transfer: this side, the receiver, both, or no one. */
  get pausedBy(): PausedBy { return this.#holds.pausedBy; }

  /** While held: when the transfer ends unless both sides resume first (ms since the epoch); else null. */
  get deadline(): number | null { return this.#holds.deadline; }

  /** Whether reading a file has taken 30 s or more for the block it's on. */
  get stalled(): boolean { return this.#stall.stalled; }

  /** The receiver's last answer to a STATUS ask, if one has come. */
  get peerStatus(): PeerStatus | undefined { return this.#peerStatus; }

  /** The bytes the receiver has written, as its last CREDIT said. */
  get consumed(): number { return this.#consumed; }

  /** The files the receiver has finished, as its last CREDIT said. */
  get filesDone(): number { return this.#filesDone; }

  /** Sends the list of files, in records the size both hellos allow, and starts reading the receiver's. The offer has 10 minutes. */
  start(): void {
    for (const record of manifestRecords(this.#host.manifest, this.#link.recordBytes)) this.#link.sendRecord(record);
    const g = this.#generation;
    this.#offerTimer = this.#host.timers.setTimeout(() => this.#fail(offerTimedOut(), g), OFFER_TIMEOUT_MS);
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

  /** Holds the transfer (HOLD): no more of it is sent until neither side holds it. PAUSE_UNAVAILABLE unless `canPause`. */
  pause(): void {
    if (!this.canPause) throw cantPause();
    if (!this.#holds.set('self', true)) return;
    this.#link.send({ type: 'hold', held: true, reason: 'person' });
    this.#holdChanged();
  }

  /** Lets this side's hold go (HOLD): the transfer runs again once the receiver holds it no more. Nothing if this side doesn't hold it. */
  resume(): void {
    if (this.#phase !== 'transferring' || !this.#holds.set('self', false)) return;
    this.#link.send({ type: 'hold', held: false, reason: 'person' });
    this.#holdChanged();
  }

  /**
   * Cancels this receiver's transfer: told with CLOSE{USER_CANCELLED} after
   * whatever is already encrypted. Once FINISH has gone, the receiver may
   * already have saved the files: its answer is waited for (2 s at most), and
   * a RESULT, or a CLOSE_ACK that carries one, completes the send instead.
   */
  cancel(): void {
    if (this.#phase === 'finalising') {
      void this.#cancelWhileFinalising();
      return;
    }
    void this.#end({ state: 'cancelled', by: 'self' }, { reason: 'USER_CANCELLED' });
  }

  /** Ends the session with `outcome`, the receiver told with `close`: the send has ended. Resolves once it's told. */
  endWith(outcome: DirectOutcome, close: CloseWhy | undefined): Promise<void> {
    return this.#end(outcome, close);
  }

  #live(g: bigint): boolean {
    return this.#phase !== 'ended' && g === this.#generation;
  }

  async #take(message: Message, g: bigint): Promise<void> {
    switch (message.type) {
      case 'accept': return this.#accept(message, g);
      case 'credit': return this.#credit(message);
      case 'result': return this.#result(message);
      case 'hold': return this.#hold(message);
      default:
        // Every other record is the sender's to send, never the receiver's (BIND comes only in the handshake). (PING, PONG,
        // STATUS, CLOSE and CLOSE_ACK are answered as they arrive, and never come here.)
        throw invalidMessage();
    }
  }

  async #accept(m: Extract<Message, { type: 'accept' }>, g: bigint): Promise<void> {
    if (this.#phase !== 'offered') throw invalidMessage();
    if (!sameBytes(m.manifestHash, this.#host.manifestHash) || m.creditLimit > CREDIT_WINDOW_BYTES) throw invalidMessage();
    this.#clearOfferTimer();
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
    if (this.#phase !== 'transferring' && this.#phase !== 'finalising' && this.#phase !== 'closing') throw invalidMessage();
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
    // What the receiver has written moved: the screens show it.
    this.#host.moved(this);
  }

  /** Whether a receiver's result is what was sent and accepted: the same totals and chain, the files where ACCEPT said they'd go. */
  #resultMatches(m: ResultBody): boolean {
    return m.fileCount === this.#host.files.length && m.totalSize === this.#host.totalSize && sameBytes(m.chain, this.#finalChain as Uint8Array)
      && m.assurance === this.#assurance;
  }

  async #result(m: Extract<Message, { type: 'result' }>): Promise<void> {
    if (this.#phase !== 'finalising' && this.#phase !== 'closing') throw invalidMessage();
    if (!this.#resultMatches(m)) throw invalidMessage();
    this.#link.send({ type: 'result-ack', commitId: m.commitId });
    void this.#end({ state: 'completed', assurance: m.assurance });
  }

  /** The receiver's HOLD: heard from ACCEPT until FINISH has gone, passed over otherwise (nothing is left to hold). */
  #hold(m: Extract<Message, { type: 'hold' }>): void {
    if (this.#phase !== 'transferring') return;
    if (this.#holds.set('peer', m.held)) this.#holdChanged();
  }

  /** A hold began or ended: reads stop counting as stalled while held; when it runs again, the stream goes on. */
  #holdChanged(): void {
    this.#stall.hold(this.#holds.held);
    if (!this.#holds.held) this.#link.wake();
    this.#host.moved(this);
  }

  #status(): Omit<StatusAnswer, 'type' | 'kind' | 'id'> {
    const state = this.#phase === 'offered' ? STATUS_STATE.OFFERED
      : this.#phase === 'transferring' ? STATUS_STATE.TRANSFERRING
        : this.#phase === 'finalising' || this.#phase === 'closing' ? STATUS_STATE.FINALISING : 0;
    return { state, held: this.#holds.self, consumed: this.#consumed };
  }

  #statusHeard(answer: StatusAnswer, g: bigint): void {
    if (!this.#live(g)) return;
    // Kept for the screens: it changes nothing else.
    this.#peerStatus = Object.freeze({ state: answer.state, held: answer.held, consumed: answer.consumed });
    this.#host.moved(this);
  }

  /**
   * The receiver's CLOSE, by either path, as it arrives: answered with
   * CLOSE_ACK, and the session ends as it says. A second is ignored. One that
   * crosses this side's own cancel leaves it cancelled.
   */
  #closeHeard(m: CloseMessage, g: bigint): void {
    if (g !== this.#generation || this.#peerClosed) return;
    this.#peerClosed = true;
    this.#link.send({ type: 'close-ack', operationId: m.operationId, finished: false });
    if (this.#phase === 'closing') {
      void this.#end({ state: 'cancelled', by: 'self' });
      return;
    }
    void this.#end(outcomeOfClose(m, 'sender', this.#peerPauseLimit));
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
          const bytes = await this.#stall.during(readRange(files[fileIndex], start, Math.min(size, start + BLOCK_BYTES)));
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

  /** The stream's next record, if one is ready and may go now: nothing while either side holds the transfer. */
  #next(): Message | undefined {
    if (this.#phase !== 'transferring' || this.#holds.held) return undefined;
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
        this.#stall.stop();
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

  /** A cancel once FINISH has gone: the receiver told, and its answer waited for, since it may have saved the files already. */
  async #cancelWhileFinalising(): Promise<void> {
    this.#phase = 'closing';
    const ack = await this.#link.closeWith({ type: 'close', operationId: this.#host.provider.randomBytes(16), reason: 'USER_CANCELLED' });
    // A RESULT came meanwhile, and completed it (the phase narrowed above isn't what it is now).
    if ((this.#phase as SessionPhase) === 'ended') return;
    if (ack?.finished && this.#resultMatches(ack.result)) {
      this.#link.send({ type: 'result-ack', commitId: ack.result.commitId });
      void this.#end({ state: 'completed', assurance: ack.result.assurance });
      return;
    }
    void this.#end({ state: 'cancelled', by: 'self' });
  }

  /**
   * The channel ended under the session: lost as the channel says, unless the
   * session has already ended (then the link is closed). A lost connection
   * listens 2 s for the receiver's CLOSE through the rendezvous first.
   */
  #lost(err: DropgateError): void {
    if (this.#phase === 'ended') {
      if (this.#linger !== undefined) this.#host.timers.clearTimeout(this.#linger);
      this.#linger = undefined;
      this.#link.close();
      return;
    }
    if (this.#phase === 'closing') {
      void this.#end({ state: 'cancelled', by: 'self' });
      return;
    }
    if (err.code !== 'CONNECTION_LOST') {
      void this.#end({ state: 'failed', error: err });
      return;
    }
    this.#quiet();
    const g = this.#generation;
    this.#lostTimer = this.#host.timers.setTimeout(() => {
      if (this.#live(g)) void this.#end({ state: 'failed', error: connectionLost() });
    }, LATE_CLOSE_WAIT_MS);
  }

  /** This side failed, in generation `g`: the receiver told with a CLOSE. A failure from another generation is dropped. */
  #fail(err: unknown, g: bigint): void {
    if (!this.#live(g)) return;
    const error = toDropgateError(err);
    void this.#end({ state: 'failed', error }, closeFor(error));
  }

  #clearOfferTimer(): void {
    if (this.#offerTimer !== undefined) this.#host.timers.clearTimeout(this.#offerTimer);
    this.#offerTimer = undefined;
  }

  /** Every timer of the transfer stopped: it's ending, or waiting to hear why its connection went. */
  #quiet(): void {
    this.#clearOfferTimer();
    this.#stall.stop();
    this.#holds.clear();
  }

  /**
   * Ends the session, once: fenced at once, the producer woken to stop, the
   * resume secret overwritten. With `close`, the receiver is told first
   * (through the rendezvous at once, then in-band, its CLOSE_ACK waited for
   * 2 s at most); otherwise
   * whatever is queued (a CLOSE_ACK, say) goes first. Completed, the channel
   * is left for the receiver to close (its RESULT_ACK on its way), and closed
   * after 2 s whatever happens.
   */
  async #end(outcome: DirectOutcome, close?: CloseWhy): Promise<void> {
    if (this.#phase === 'ended') return;
    this.#phase = 'ended';
    try {
      await this.#ending(outcome, close);
    } finally {
      this.#settled.resolve();
    }
  }

  async #ending(outcome: DirectOutcome, close?: CloseWhy): Promise<void> {
    // The receiver is told first, before anything else is done: a page that's going has about a millisecond (DGDTP.md).
    // It has ended already if its CLOSE was heard: nothing more to tell it.
    const telling = close && !this.#peerClosed
      ? this.#link.closeWith({ type: 'close', operationId: this.#host.provider.randomBytes(16), ...close })
      : undefined;
    this.#quiet();
    if (this.#lostTimer !== undefined) this.#host.timers.clearTimeout(this.#lostTimer);
    this.#resumeSecret?.fill(0);
    this.#resumeSecret = undefined;
    this.#queue.length = 0;
    this.#wakeProducer();
    this.#link.stream(undefined);
    this.#host.ended(this, outcome);
    if (telling) {
      await telling;
    } else {
      await within(this.#link.flush(), outcome.state === 'completed' ? RESULT_ACK_WAIT_MS : CLOSE_ACK_WAIT_MS, this.#host.timers);
    }
    if (outcome.state === 'completed' && !this.#link.closed) {
      // The receiver closes once RESULT_ACK is in (#lost then clears this).
      this.#linger = this.#host.timers.setTimeout(() => this.#link.close(), RESULT_ACK_WAIT_MS);
      return;
    }
    this.#link.close();
  }
}

/** The CLOSE every receiver still connected is told when the send ends with `outcome`. */
function closeOnFinish(outcome: DirectOutcome): CloseWhy | undefined {
  if (outcome.state === 'completed') return undefined;
  if (outcome.state === 'cancelled') return { reason: 'USER_CANCELLED' };
  return closeFor(outcome.error) ?? { reason: 'FAILED' };
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
  /** Every session that has ended or is ending: the room closes once each has told its receiver. */
  readonly #ending = new Set<SenderSession>();
  #chosen: SenderSession | undefined;
  #state: DirectState = 'waiting';
  #ended = false;
  /** Receivers' attempts still being set up (signalling, the handshake). */
  #connecting = 0;

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

  /** Whether `pause()` can be called now: from the chosen receiver's ACCEPT until FINISH has gone. */
  get canPause(): boolean { return !this.#ended && (this.#chosen?.canPause ?? false); }

  /** Who holds the transfer: this side, the receiver, both, or no one. */
  get pausedBy(): PausedBy { return this.#chosen?.pausedBy ?? null; }

  /** While held: when the transfer ends unless both sides resume first (ms since the epoch); else null. */
  get deadline(): number | null { return this.#chosen?.deadline ?? null; }

  /** Whether reading a file has taken 30 s or more for the block it's on. */
  get stalled(): boolean { return this.#chosen?.stalled ?? false; }

  /** The chosen receiver's last answer to a STATUS ask, if one has come. */
  get peerStatus(): PeerStatus | undefined { return this.#chosen?.peerStatus; }

  /** Whether a receiver has accepted: from then on the room takes no one else. */
  get chosen(): boolean { return this.#chosen !== undefined; }

  /** How far the chosen receiver is: the bytes it has written, and the files it has finished (both 0 until one is chosen). */
  get progress(): { consumed: number; filesDone: number } {
    return { consumed: this.#chosen?.consumed ?? 0, filesDone: this.#chosen?.filesDone ?? 0 };
  }

  /**
   * Calls `listener` whenever `state`, `pausedBy`, `deadline`, `stalled`, `peerStatus` or `progress` changes. Returns a
   * function that stops it.
   */
  onChange(listener: () => void): () => void { return this.#listeners.add(listener); }

  /** Calls `listener` with the error of each receiver's attempt that ends without being chosen (a wrong code, say). */
  onAttemptEnded(listener: (err: DropgateError) => void): () => void {
    this.#attemptListeners.add(listener);
    return () => { this.#attemptListeners.delete(listener); };
  }

  /** Holds the transfer: PAUSE_UNAVAILABLE unless `canPause`. */
  pause(): void {
    if (!this.canPause) throw cantPause();
    (this.#chosen as SenderSession).pause();
  }

  /** Lets this side's hold go. */
  resume(): void {
    if (!this.#ended) this.#chosen?.resume();
  }

  /**
   * Cancels the send: every receiver told (CLOSE, USER_CANCELLED), the room
   * closed. Once FINISH has gone, the receiver's answer decides it: the send
   * may turn out completed.
   */
  cancel(): void {
    if (this.#ended) return;
    if (this.#chosen?.phase === 'finalising') {
      this.#chosen.cancel();
      return;
    }
    this.#finish({ state: 'cancelled', by: 'self' });
  }

  /** The app is closing: every receiver told (CLOSE, APP_CLOSED, both ways, best effort), and the send ends cancelled. */
  appClosed(): void {
    this.#finish({ state: 'cancelled', by: 'self' }, { reason: 'APP_CLOSED' });
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
    const state = session.phase === 'finalising' || session.phase === 'closing' ? 'finalising' : 'transferring';
    if (this.#state !== state) this.#setState(state);
    else this.#listeners.notify();
  }

  /** @internal */
  ended(session: SenderSession, outcome: DirectOutcome): void {
    this.#sessions.delete(session);
    this.#ending.add(session);
    if (this.#ended) return;
    if (session === this.#chosen) {
      this.#finish(outcome);
      return;
    }
    // A receiver that declines, or an offer no one accepted in time, ends the send.
    if ((outcome.state === 'cancelled' && outcome.by === 'peer' && outcome.declined)
      || (outcome.state === 'failed' && outcome.error.code === 'TIMED_OUT')) {
      this.#finish(outcome);
      return;
    }
    if (outcome.state === 'failed') this.#tellAttempt(outcome.error);
    this.#settleWaiting();
  }

  /** With no receiver offered and none chosen: `connecting` while an attempt is being set up, else `waiting`. */
  #settleWaiting(): void {
    if (this.#chosen || this.#sessions.size > 0) return;
    this.#setState(this.#connecting > 0 ? 'connecting' : 'waiting');
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
      if (this.#ended) {
        attempt.pipe.close();
        return;
      }
      void this.#take(attempt);
    }
  }

  async #take(attempt: IncomingAttempt): Promise<void> {
    let channel: SecureChannel;
    this.#connecting += 1;
    this.#settleWaiting();
    try {
      channel = await this.room.accept(attempt, { peer: this.#options.peer(), hello: this.#options.hello, timers: this.timers });
    } catch (err) {
      this.#connecting -= 1;
      if (!this.#ended) {
        this.#tellAttempt(toDropgateError(err));
        this.#settleWaiting();
      }
      return;
    }
    this.#connecting -= 1;
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

  /**
   * Ends the send, once: every receiver still connected told (`close`, or as
   * the outcome says), then the room closed, once those CLOSEs have gone both
   * ways (2 s at most).
   */
  #finish(outcome: DirectOutcome, close?: CloseWhy): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#state = outcome.state;
    const why = close ?? closeOnFinish(outcome);
    for (const session of [...this.#sessions]) {
      if (session !== this.#chosen || outcome.state !== 'completed') void session.endWith({ state: 'cancelled', by: 'self' }, why);
    }
    this.#sessions.clear();
    // Every session's CLOSE, the one that ended the send among them, goes through the room before it closes.
    void Promise.allSettled([...this.#ending].map((session) => session.settled)).then(() => this.room.close());
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
