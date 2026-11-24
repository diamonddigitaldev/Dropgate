import type { CryptoProvider } from '../crypto/index.js';
import { DropgateError, toDropgateError } from '../errors.js';
import { SinkWriter, isDownloadSink, type DownloadSinkOption } from '../sink.js';
import { StreamingZipWriter } from '../zip/stream-zip.js';
import type { SecureChannel } from './channel.js';
import {
  CREDIT_STEP_BYTES, CREDIT_WINDOW_BYTES, GLOBAL_TIMERS, Holds, Link, Listeners, RESULT_ACK_WAIT_MS, STATUS_STATE, StallWatch, closeFor,
  deferred, integrityFailed, invalidMessage, offerTimedOut, outcomeOfClose, pauseLimitReached, readRecord, sameBytes, within,
  type CloseMessage, type CloseWhy, type DirectOutcome, type DirectState, type EngineTimers, type Inbound, type PausedBy, type PeerStatus,
  type StatusAnswer,
} from './engine.js';

export type { PeerStatus };
import { RESUME_SECRET_BYTES } from './keys.js';
import {
  BLOCK_BYTES, DATA_HEADER_BYTES, MESSAGE_TYPE, ManifestAssembler, blockCount, chainBlock, chainFileEnd, chainStart, dataBytes, decodeManifest,
  manifestHash, type Assurance, type ManifestFile, type Message, type ResultBody,
} from './messages.js';
import { CLOSE_ACK_WAIT_MS, Deadline, LATE_CLOSE_WAIT_MS, NO_PROGRESS_MS, OFFER_TIMEOUT_MS } from './timers.js';

// The receiver's side of one direct transfer, once its secure channel is up.
//
//   1. The offer: the sender's MANIFEST records, put back together and
//      checked; `offer()` gives the files. The offer waits 10 minutes for
//      `accept()` or `decline()`, then ends TIMED_OUT, the sender told.
//   2. `accept({ sink })`: no sink, no ACCEPT. The output is opened first (one
//      sink, one per file, or one ZIP), so a sink that can't be had fails the
//      receive before anything is accepted. Then ACCEPT, with the manifest's
//      hash, the resume secret R (32 random bytes, kept in memory for a later
//      resume) and the first credit, 4 MiB.
//   3. The files: DATA in order, each record exactly the size the two hellos
//      allow (or what's left of its 1 MiB block), never past the credit given;
//      each block checked against its BLOCK_END's hash and written to the sink
//      only once it matches; each file's end checked against the list of files
//      and the checkpoint chain, and its sink closed. CREDIT as what's written
//      moves 256 KiB, and at once as a file finishes.
//   4. FINISH: the count, total, manifest hash and chain checked; the last
//      file's sink closed (a ZIP finished first); only then RESULT, saying
//      what was saved. Completed once RESULT_ACK comes, or 2 s after RESULT
//      without it, since everything is saved either way.
//
// Pausing: either side may hold the transfer from ACCEPT to FINISH (HOLD).
// While either holds, no credit is given; what's already on its way is still
// received, checked and saved. A FINISH that comes while held is finalised
// anyway: nothing is left to hold. A write or close that takes 30 s shows as
// stalled, and at 120 s ends the transfer OUTPUT_STALLED; neither counts
// while the transfer is held. With credit given and no data for 30 s, the
// receiver asks the sender where it stands (STATUS), and keeps its answer.
//
// Anything else is INVALID_MESSAGE; a block, file end or finish that doesn't
// match INTEGRITY_FAILED; a sink that fails OUTPUT_WRITE_FAILED. Each is told
// to the sender with a CLOSE, and the sink aborted, so a partial file is never
// finished as if it were whole. Every effect is fenced by its generation.

/** One file of an offer: its name, size and media type (advice only). */
export type OfferedFile = Readonly<ManifestFile>;

/** What a sender offers: its files, in order, and their total size. */
export interface DirectOffer {
  readonly files: readonly OfferedFile[];
  readonly totalSize: number;
}

export interface AcceptOptions {
  /** Where the files go: one sink, or a function giving one for each file. Required. */
  sink: DownloadSinkOption;
  /** Every file into one ZIP, written to the one sink. */
  asZip?: boolean;
  /** The sink hands the files to a browser to save (as StreamSaver does), so the result says "handed off", never "saved". */
  handOff?: boolean;
}

export interface DirectReceiveOptions {
  timers?: EngineTimers;
}

type Phase = 'offer' | 'offered' | 'accepting' | 'receiving' | 'finalising' | 'result' | 'ended';

const noLongerOffered = () => new DropgateError({ code: 'INVALID_ARGUMENT', message: 'There is no offer waiting to be accepted or declined.' });
const cantPause = () => new DropgateError({ code: 'PAUSE_UNAVAILABLE', message: 'A direct transfer can be paused once it has been accepted, until all its data has arrived.' });
const connectionLost = () => new DropgateError({ code: 'CONNECTION_LOST', message: "The connection was lost, so the transfer couldn't continue." });

/** The receiver's side of one direct transfer over `channel`. */
export class DirectReceiver {
  readonly #provider: CryptoProvider;
  readonly #link: Link;
  readonly #timers: EngineTimers;
  readonly #generation: bigint;
  readonly #listeners = new Listeners();
  readonly #offer = deferred<DirectOffer>();
  readonly #done = deferred<DirectOutcome>();
  readonly #assembler: ManifestAssembler;
  readonly #maxData: number;
  readonly #holds: Holds;
  readonly #stall: StallWatch;
  readonly #peerPauseLimit: number;
  #phase: Phase = 'offer';
  #state: DirectState = 'connecting';
  #outcome: DirectOutcome | undefined;
  #files: ManifestFile[] = [];
  #totalSize = 0;
  #manifestHash: Uint8Array | undefined;
  #chain: Uint8Array | undefined;
  #resumeSecret: Uint8Array | undefined;
  #assurance: Assurance = 'saved';
  #result: ResultBody | undefined;

  // The output.
  #sink: DownloadSinkOption | undefined;
  #zipOut: SinkWriter | undefined;
  #zip: StreamingZipWriter | undefined;
  #current: SinkWriter | undefined;
  #opened = -1;

  // Where the files stand.
  #fileIndex = 0;
  #fileOffset = 0;
  #blockIndex = 0;
  #block: Uint8Array | undefined;
  #blockFill = 0;
  #received = 0;
  #consumed = 0;
  #limit = 0;
  #revision = 0;
  #filesDone = 0;
  #creditedAt = 0;
  /** A CREDIT held back while the transfer was held. */
  #creditOwed = false;

  // Timers, and the end.
  #ackTimer: unknown;
  #offerTimer: unknown;
  #lostTimer: unknown;
  #lastDataAt = 0;
  readonly #noProgress: Deadline;
  #peerStatus: PeerStatus | undefined;
  /** The other side's CLOSE has been heard: another is ignored. */
  #peerClosed = false;
  /** A CLOSE heard while the files were being finished, answered once they are. */
  #pendingClose: CloseMessage | undefined;

  constructor(provider: CryptoProvider, channel: SecureChannel, options: DirectReceiveOptions = {}) {
    if (channel?.role !== 'receiver') throw new DropgateError({ code: 'INVALID_ARGUMENT', message: "A receive runs over the receiver's channel." });
    this.#provider = provider;
    this.#timers = options.timers ?? GLOBAL_TIMERS;
    this.#generation = channel.generation;
    const g = this.#generation;
    this.#peerPauseLimit = channel.peerHello.pauseLimitSeconds;
    this.#holds = new Holds(this.#timers, channel.hello?.pauseLimitSeconds ?? 0, this.#peerPauseLimit, () => {
      this.#fail(pauseLimitReached('receiver', 'self', channel.hello.pauseLimitSeconds), g);
    });
    this.#stall = new StallWatch(this.#timers, () => this.#listeners.notify(), () => {
      this.#fail(new DropgateError({ code: 'OUTPUT_STALLED' }), g);
    });
    this.#noProgress = new Deadline(this.#timers, () => this.#noProgressDue(), () => {
      this.#lastDataAt = this.#timers.now();
      this.#link.askStatus();
      this.#noProgress.arm();
    });
    this.#link = new Link(channel, {
      arrived: (record) => this.#arrived(record),
      record: (inbound) => this.deliver(inbound),
      ended: (err) => this.#lost(err),
      close: (message, generation) => this.#closeHeard(message, generation),
      status: () => this.#status(),
      statusHeard: (answer, generation) => this.#statusHeard(answer, generation),
    }, this.#timers);
    this.#assembler = new ManifestAssembler(this.#link.recordBytes);
    this.#maxData = dataBytes(this.#link.recordBytes);
    this.#link.start();
  }

  /** Where the transfer stands. */
  get state(): DirectState { return this.#state; }

  /** How it ended, once it has. */
  get done(): Promise<DirectOutcome> { return this.#done.promise; }

  /** Whether `pause()` can be called now: from ACCEPT until all the data has arrived (FINISH). */
  get canPause(): boolean { return this.#phase === 'receiving'; }

  /** Who holds the transfer: this side, the sender, both, or no one. */
  get pausedBy(): PausedBy { return this.#holds.pausedBy; }

  /** While held: when the transfer ends unless both sides resume first (ms since the epoch, the earlier of both limits); else null. */
  get deadline(): number | null { return this.#holds.deadline; }

  /** Whether writing the files has taken 30 s or more for the step it's on. */
  get stalled(): boolean { return this.#stall.stalled; }

  /** The sender's last answer to a STATUS ask, if one has come. */
  get peerStatus(): PeerStatus | undefined { return this.#peerStatus; }

  /** How far it is: the bytes written to the sink, and the file being received (0-based; the count once all are in). */
  get progress(): { consumed: number; fileIndex: number } {
    return { consumed: this.#consumed, fileIndex: this.#fileIndex };
  }

  /**
   * Calls `listener` whenever `state`, `pausedBy`, `deadline`, `stalled`, `peerStatus` or `progress` changes. Returns a
   * function that stops it.
   */
  onChange(listener: () => void): () => void { return this.#listeners.add(listener); }

  /** The sender's files, once the whole list has come and been checked. Rejects if the transfer ends first. */
  offer(): Promise<DirectOffer> { return this.#offer.promise; }

  /**
   * Accepts the offer into `options.sink`. INVALID_ARGUMENT, with nothing sent
   * and the offer still waiting, for no sink, one without `write()` and
   * `close()`, or several files apart into one sink. A sink that can't be had
   * fails the receive OUTPUT_WRITE_FAILED before anything is accepted.
   */
  async accept(options: AcceptOptions): Promise<void> {
    await this.offer();
    if (this.#phase !== 'offered') throw noLongerOffered();
    const { sink, asZip = false, handOff = false } = options ?? ({} as AcceptOptions);
    if (typeof sink !== 'function' && !isDownloadSink(sink)) {
      throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'A direct transfer is received into a sink: one, or a function giving one for each file.' });
    }
    if (this.#files.length > 1 && !asZip && typeof sink !== 'function') {
      throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'Several files received apart need a function giving a sink for each file.' });
    }
    this.#phase = 'accepting';
    this.#clearOfferTimer();
    this.#sink = sink;
    this.#assurance = handOff ? 'handed-off' : 'saved';
    const g = this.#generation;
    try {
      if (asZip) {
        const zipOut = await SinkWriter.open(sink, { name: '', size: this.#totalSize, index: 0 });
        this.#zipOut = zipOut;
        this.#zip = new StreamingZipWriter((chunk) => zipOut.write(chunk));
      }
      // The first file's own sink, so one that can't be had fails before anything is accepted.
      await this.#openFile(0, g);
    } catch (err) {
      this.#fail(err, g);
      throw toDropgateError(err);
    }
    if (!this.#live(g)) throw new DropgateError({ code: 'OPERATION_CANCELLED' });
    const resumeSecret = this.#provider.randomBytes(RESUME_SECRET_BYTES);
    this.#resumeSecret = resumeSecret;
    this.#limit = CREDIT_WINDOW_BYTES;
    this.#chain = await chainStart(this.#provider, this.#manifestHash as Uint8Array);
    if (!this.#live(g)) throw new DropgateError({ code: 'OPERATION_CANCELLED' });
    this.#link.send({
      type: 'accept', manifestHash: this.#manifestHash as Uint8Array, resumeSecret, creditLimit: this.#limit, sink: this.#assurance,
    });
    this.#phase = 'receiving';
    this.#lastDataAt = this.#timers.now();
    this.#noProgress.arm();
    this.#setState('transferring');
  }

  /** Declines the offer: the sender is told (CLOSE, USER_DECLINED), and this side ends cancelled. */
  decline(): void {
    if (this.#phase !== 'offer' && this.#phase !== 'offered') throw noLongerOffered();
    void this.#end({ state: 'cancelled', by: 'self' }, { reason: 'USER_DECLINED' });
  }

  /**
   * Cancels: the sender told (CLOSE, USER_CANCELLED), the sink aborted. Once
   * RESULT has gone the files are saved, and a cancel can't undo that: the
   * transfer completes.
   */
  cancel(): void {
    if (this.#phase === 'result') {
      this.#complete();
      return;
    }
    void this.#end({ state: 'cancelled', by: 'self' }, { reason: 'USER_CANCELLED' });
  }

  /**
   * The app is closing (a page hidden for good, the desktop quitting): the
   * sender told (CLOSE, APP_CLOSED, both ways, best effort), and this side
   * ends cancelled.
   */
  appClosed(): void {
    if (this.#phase === 'result') {
      this.#complete();
      return;
    }
    void this.#end({ state: 'cancelled', by: 'self' }, { reason: 'APP_CLOSED' });
  }

  /** Holds the transfer (HOLD): no more credit is given; what's on its way is still saved. PAUSE_UNAVAILABLE unless `canPause`. */
  pause(): void {
    if (!this.canPause) throw cantPause();
    if (!this.#holds.set('self', true)) return;
    this.#link.send({ type: 'hold', held: true, reason: 'person' });
    this.#holdChanged();
  }

  /** Lets this side's hold go (HOLD): the transfer runs again once the sender holds it no more. Nothing if this side doesn't hold it. */
  resume(): void {
    if (this.#phase !== 'receiving' || !this.#holds.set('self', false)) return;
    this.#link.send({ type: 'hold', held: false, reason: 'person' });
    this.#holdChanged();
  }

  /**
   * One record from the other side, with its connection's generation. The
   * channel's own records come here; so can a test's. One from another
   * generation, or after the end, is dropped and touches nothing.
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

  /**
   * Each record as it arrives, while earlier ones may still be waiting on the
   * sink: DATA is counted against the credit given, so a sender that sends
   * past it is refused at once, never held in memory unread.
   */
  #arrived(record: Uint8Array): void {
    if (record[0] !== MESSAGE_TYPE.DATA || record.byteLength <= DATA_HEADER_BYTES) return;
    this.#received += record.byteLength - DATA_HEADER_BYTES;
    this.#lastDataAt = this.#timers.now();
    if (this.#received > this.#limit) this.#fail(invalidMessage(), this.#generation);
  }

  /** Whether an effect of generation `g` may still touch anything. */
  #live(g: bigint): boolean {
    return this.#phase !== 'ended' && g === this.#generation;
  }

  async #take(message: Message, g: bigint): Promise<void> {
    switch (message.type) {
      case 'manifest': return this.#manifest(message, g);
      case 'data': return this.#data(message, g);
      case 'block-end': return this.#blockEnd(message, g);
      case 'file-end': return this.#fileEnd(message, g);
      case 'finish': return this.#finish(message, g);
      case 'result-ack': return this.#resultAck(message);
      case 'hold': return this.#hold(message);
      default:
        // BIND, ACCEPT, CREDIT and RESULT are the receiver's to send, never the sender's. (PING, PONG, STATUS, CLOSE and
        // CLOSE_ACK are answered as they arrive, and never come here.)
        throw invalidMessage();
    }
  }

  async #manifest(m: Extract<Message, { type: 'manifest' }>, g: bigint): Promise<void> {
    // Once the list is whole, the assembler refuses any more of it: INVALID_MANIFEST.
    const bytes = this.#assembler.take(m);
    if (!bytes) return;
    const manifest = decodeManifest(bytes);
    const hash = await manifestHash(this.#provider, bytes);
    if (!this.#live(g)) return;
    this.#files = manifest.files;
    this.#totalSize = manifest.totalSize;
    this.#manifestHash = hash;
    this.#phase = 'offered';
    this.#offerTimer = this.#timers.setTimeout(() => this.#fail(offerTimedOut(), g), OFFER_TIMEOUT_MS);
    this.#setState('offered');
    this.#offer.resolve(Object.freeze({
      files: Object.freeze(manifest.files.map((file) => Object.freeze({ ...file }))),
      totalSize: manifest.totalSize,
    }));
  }

  #data(m: Extract<Message, { type: 'data' }>, g: bigint): Promise<void> | undefined {
    // Before ACCEPT no credit is given, so DATA was refused as it arrived; after the last file there's no file for it.
    const file = this.#files[this.#fileIndex];
    if (!file || m.fileIndex !== this.#fileIndex || m.offset !== this.#fileOffset) throw invalidMessage();
    const blockLength = this.#blockLength(file);
    const left = blockLength - this.#blockFill;
    // Every record is exactly the most it can hold, or what's left of its block.
    if (left <= 0 || m.bytes.byteLength !== Math.min(this.#maxData, left)) throw invalidMessage();
    this.#block ??= new Uint8Array(blockLength);
    this.#block.set(m.bytes, this.#blockFill);
    this.#blockFill += m.bytes.byteLength;
    this.#fileOffset += m.bytes.byteLength;
    return this.#openFile(this.#fileIndex, g);
  }

  async #blockEnd(m: Extract<Message, { type: 'block-end' }>, g: bigint): Promise<void> {
    if (this.#phase !== 'receiving') throw invalidMessage();
    const file = this.#files[this.#fileIndex];
    if (!file || m.fileIndex !== this.#fileIndex || m.blockIndex !== this.#blockIndex) throw invalidMessage();
    const blockLength = this.#blockLength(file);
    if (blockLength <= 0 || this.#blockFill !== blockLength || m.length !== blockLength) throw invalidMessage();
    const block = this.#block as Uint8Array;
    const hash = await this.#provider.sha256(block);
    if (!this.#live(g)) return;
    if (!sameBytes(hash, m.hash)) throw integrityFailed("A block of a file didn't match its hash.");
    const chain = await chainBlock(this.#provider, this.#chain as Uint8Array, { fileIndex: m.fileIndex, blockIndex: m.blockIndex, length: blockLength, hash });
    if (!this.#live(g)) return;
    this.#chain = chain;
    this.#block = undefined;
    this.#blockFill = 0;
    this.#blockIndex += 1;
    // Only a block that matched is written.
    await this.#write(block, g);
    if (!this.#live(g)) return;
    this.#consumed += blockLength;
    this.#creditMoved(false);
    this.#listeners.notify();
  }

  async #fileEnd(m: Extract<Message, { type: 'file-end' }>, g: bigint): Promise<void> {
    if (this.#phase !== 'receiving') throw invalidMessage();
    const file = this.#files[this.#fileIndex];
    if (!file || m.fileIndex !== this.#fileIndex) throw invalidMessage();
    const blocks = blockCount(file.size);
    if (m.size !== file.size || m.blockCount !== blocks) throw integrityFailed("A file's end didn't match the list of files.");
    // Its end before all its bytes.
    if (this.#blockIndex !== blocks || this.#blockFill !== 0) throw invalidMessage();
    const chain = await chainFileEnd(this.#provider, this.#chain as Uint8Array, { fileIndex: m.fileIndex, size: file.size, blockCount: blocks });
    if (!this.#live(g)) return;
    if (!sameBytes(chain, m.chain)) throw integrityFailed("A file's checkpoint didn't match.");
    this.#chain = chain;
    // An empty file's sink is had here.
    await this.#openFile(this.#fileIndex, g);
    if (!this.#live(g)) return;
    const last = this.#fileIndex === this.#files.length - 1;
    if (this.#zip) {
      this.#zipStep(() => (this.#zip as StreamingZipWriter).endFile());
      this.#filesDone += 1;
    } else if (!last) {
      const sink = this.#current as SinkWriter;
      this.#current = undefined;
      await this.#stall.during(sink.close());
      if (!this.#live(g)) return;
      this.#filesDone += 1;
    }
    this.#fileIndex += 1;
    this.#fileOffset = 0;
    this.#blockIndex = 0;
    // A file finished: the sender may be waiting on it.
    this.#creditMoved(true);
    this.#listeners.notify();
  }

  async #finish(m: Extract<Message, { type: 'finish' }>, g: bigint): Promise<void> {
    if (this.#phase !== 'receiving' || this.#fileIndex !== this.#files.length) throw invalidMessage();
    if (m.fileCount !== this.#files.length || m.totalSize !== this.#totalSize || !sameBytes(m.manifestHash, this.#manifestHash as Uint8Array)
      || !sameBytes(m.chain, this.#chain as Uint8Array)) {
      throw integrityFailed("The transfer's end didn't match what arrived.");
    }
    this.#phase = 'finalising';
    // Everything has arrived: a hold has nothing left to hold, so the files are finished whatever either side holds.
    this.#holds.clear();
    this.#stall.hold(false);
    this.#noProgress.stop();
    this.#setState('finalising');
    this.#listeners.notify();
    if (this.#zip) {
      await this.#stall.during(this.#zipAsync(() => (this.#zip as StreamingZipWriter).finalize()));
      if (!this.#live(g)) return;
      await this.#stall.during((this.#zipOut as SinkWriter).close());
    } else {
      await this.#stall.during((this.#current as SinkWriter).close());
    }
    if (!this.#live(g)) return;
    this.#current = undefined;
    this.#zipOut = undefined;
    // Only now, with every file closed, the result.
    const result: ResultBody = {
      commitId: this.#provider.randomBytes(16), assurance: this.#assurance, fileCount: this.#files.length, totalSize: this.#totalSize,
      chain: this.#chain as Uint8Array,
    };
    this.#result = result;
    this.#link.send({ type: 'result', ...result });
    this.#phase = 'result';
    // A CLOSE that came while the files were being finished is answered now: they're saved.
    if (this.#pendingClose) {
      this.#answerClose(this.#pendingClose);
      return;
    }
    this.#ackTimer = this.#timers.setTimeout(() => {
      if (this.#live(g)) this.#complete();
    }, RESULT_ACK_WAIT_MS);
  }

  #resultAck(m: Extract<Message, { type: 'result-ack' }>): void {
    if (this.#phase !== 'result') throw invalidMessage();
    // Another commit's is passed over: the files are saved, and the wait ends it anyway.
    if (sameBytes(m.commitId, (this.#result as ResultBody).commitId)) this.#complete();
  }

  /** The sender's HOLD: heard from ACCEPT until FINISH, passed over otherwise (once all the data is in, nothing is left to hold). */
  #hold(m: Extract<Message, { type: 'hold' }>): void {
    if (this.#phase !== 'receiving') return;
    if (this.#holds.set('peer', m.held)) this.#holdChanged();
  }

  /** A hold began or ended: stalls stop counting while held; when it runs again, any CREDIT held back goes. */
  #holdChanged(): void {
    const held = this.#holds.held;
    this.#stall.hold(held);
    if (!held) {
      this.#lastDataAt = this.#timers.now();
      if (this.#creditOwed) this.#sendCredit();
      this.#noProgress.arm();
    }
    this.#listeners.notify();
  }

  /** When to ask the sender where it stands: credit given, nothing held, and no data for 30 s. */
  #noProgressDue(): number | undefined {
    if (this.#phase !== 'receiving' || this.#holds.held || this.#received >= this.#limit) return undefined;
    return this.#lastDataAt + NO_PROGRESS_MS;
  }

  #status(): Omit<StatusAnswer, 'type' | 'kind' | 'id'> {
    const state = this.#phase === 'offered' ? STATUS_STATE.OFFERED
      : this.#phase === 'receiving' ? STATUS_STATE.TRANSFERRING
        : this.#phase === 'finalising' ? STATUS_STATE.FINALISING
          : this.#result && (this.#phase === 'result' || this.#outcome?.state === 'completed') ? STATUS_STATE.FINISHED : 0;
    const result = state === STATUS_STATE.FINISHED ? { result: this.#result as ResultBody } : {};
    return { state, held: this.#holds.self, consumed: this.#consumed, ...result };
  }

  #statusHeard(answer: StatusAnswer, g: bigint): void {
    if (!this.#live(g)) return;
    // Kept for the screens: it changes nothing else.
    this.#peerStatus = Object.freeze({ state: answer.state, held: answer.held, consumed: answer.consumed });
    this.#listeners.notify();
  }

  /**
   * The sender's CLOSE, by either path, as it arrives. A second is ignored.
   * One that comes while the files are being finished is answered once they
   * are: CLOSE_ACK{finished} with the RESULT, and the receive completes.
   */
  #closeHeard(m: CloseMessage, g: bigint): void {
    if (g !== this.#generation || this.#peerClosed) return;
    this.#peerClosed = true;
    if (this.#phase === 'finalising') {
      this.#pendingClose = m;
      return;
    }
    this.#answerClose(m);
  }

  /** CLOSE_ACK, then this side ends as the CLOSE says, unless the files are already saved: then it's completed. */
  #answerClose(m: CloseMessage): void {
    this.#pendingClose = undefined;
    const result = this.#phase === 'result' || this.#outcome?.state === 'completed' ? this.#result : undefined;
    if (result) {
      this.#link.send({ type: 'close-ack', operationId: m.operationId, finished: true, result });
      this.#complete();
      return;
    }
    this.#link.send({ type: 'close-ack', operationId: m.operationId, finished: false });
    void this.#end(outcomeOfClose(m, 'receiver', this.#peerPauseLimit));
  }

  /** The length of the block being received. */
  #blockLength(file: ManifestFile): number {
    return Math.min(BLOCK_BYTES, file.size - this.#blockIndex * BLOCK_BYTES);
  }

  /** The output for file `index`, once: its place in the ZIP, or its own sink. */
  async #openFile(index: number, g: bigint): Promise<void> {
    if (this.#opened >= index) return;
    this.#opened = index;
    const file = this.#files[index];
    if (this.#zip) {
      this.#zipStep(() => (this.#zip as StreamingZipWriter).startFile(file.name, file.size));
      return;
    }
    const opening = SinkWriter.open(this.#sink as DownloadSinkOption, { name: file.name, size: file.size, index });
    // The first is opened before ACCEPT, at the person's pace; every later one is watched for a stall.
    const sink = index === 0 ? await opening : await this.#stall.during(opening);
    if (!this.#live(g)) {
      await sink.abort(new DropgateError({ code: 'OPERATION_CANCELLED' }));
      return;
    }
    this.#current = sink;
  }

  async #write(block: Uint8Array, g: bigint): Promise<void> {
    if (this.#zip) {
      const zip = this.#zip;
      this.#zipStep(() => zip.writeChunk(block));
      await this.#stall.during(this.#zipAsync(() => zip.drained()));
      return;
    }
    if (!this.#live(g)) return;
    await this.#stall.during((this.#current as SinkWriter).write(block));
  }

  /** A ZIP writer's step: its refusal of a size is the sender's bytes not matching; anything else the output's. */
  #zipStep(run: () => unknown): void {
    try {
      run();
    } catch (err) {
      throw zipError(err);
    }
  }

  async #zipAsync(run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (err) {
      throw zipError(err);
    }
  }

  /**
   * What's written moved: CREDIT once it has moved 256 KiB since the last, or
   * at once (`now`) as a file finishes. Writes are whole blocks, so every one
   * either moves 1 MiB or ends a file (a shorter block is always a file's
   * last): no CREDIT ever waits on a timer. While the transfer is held none
   * goes; it's sent once it runs again.
   */
  #creditMoved(now: boolean): void {
    if (this.#phase !== 'receiving') return;
    if (!now && this.#consumed - this.#creditedAt < CREDIT_STEP_BYTES) return;
    if (this.#holds.held) {
      this.#creditOwed = true;
      return;
    }
    this.#sendCredit();
  }

  #sendCredit(): void {
    this.#creditOwed = false;
    this.#revision += 1;
    this.#limit = this.#consumed + CREDIT_WINDOW_BYTES;
    this.#creditedAt = this.#consumed;
    this.#link.send({
      type: 'credit', revision: this.#revision, limit: this.#limit, consumed: this.#consumed, filesDone: this.#filesDone,
      verifiedFileIndex: this.#fileIndex, verifiedOffset: this.#blockIndex * BLOCK_BYTES,
    });
    this.#noProgress.arm();
  }

  #setState(state: DirectState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.#listeners.notify();
  }

  #complete(): void {
    void this.#end({ state: 'completed', assurance: this.#assurance });
  }

  /**
   * The channel ended under the transfer: completed if RESULT has gone (the
   * files are saved). A lost connection listens 2 s for the sender's CLOSE
   * through the rendezvous, which ends it as that says; else it ends
   * CONNECTION_LOST. Any other end is as the channel says.
   */
  #lost(err: DropgateError): void {
    if (this.#phase === 'result') {
      this.#complete();
      return;
    }
    if (this.#phase === 'ended') return;
    if (err.code !== 'CONNECTION_LOST') {
      void this.#end({ state: 'failed', error: err });
      return;
    }
    this.#quiet();
    const g = this.#generation;
    this.#lostTimer = this.#timers.setTimeout(() => {
      if (this.#live(g)) void this.#end({ state: 'failed', error: connectionLost() });
    }, LATE_CLOSE_WAIT_MS);
  }

  /** This side failed, in generation `g`: the sender told with a CLOSE. A failure from another generation is dropped. */
  #fail(err: unknown, g: bigint): void {
    if (!this.#live(g)) return;
    const error = toDropgateError(err);
    void this.#end({ state: 'failed', error }, closeFor(error));
  }

  #clearOfferTimer(): void {
    if (this.#offerTimer !== undefined) this.#timers.clearTimeout(this.#offerTimer);
    this.#offerTimer = undefined;
  }

  /** Every timer of the transfer stopped: it's ending, or waiting to hear why its connection went. */
  #quiet(): void {
    this.#clearOfferTimer();
    if (this.#ackTimer !== undefined) this.#timers.clearTimeout(this.#ackTimer);
    this.#ackTimer = undefined;
    this.#noProgress.stop();
    this.#stall.stop();
    this.#holds.clear();
  }

  /**
   * Ends the transfer, once: everything after is fenced off at once. The sink
   * aborted unless completed, the resume secret overwritten. With `close`,
   * the sender is told first (through the rendezvous at once, then in-band,
   * its CLOSE_ACK waited for 2 s at most); otherwise whatever is queued (a CLOSE_ACK, say)
   * goes first. Then the channel is closed.
   */
  async #end(outcome: DirectOutcome, close?: CloseWhy): Promise<void> {
    if (this.#phase === 'ended') return;
    this.#phase = 'ended';
    // The sender is told first, before anything else is done: a page that's going has about a millisecond (DGDTP.md).
    // It has ended already if its CLOSE was heard: nothing more to tell it.
    const telling = close && !this.#peerClosed
      ? this.#link.closeWith({ type: 'close', operationId: this.#provider.randomBytes(16), ...close })
      : undefined;
    this.#outcome = outcome;
    this.#quiet();
    if (this.#lostTimer !== undefined) this.#timers.clearTimeout(this.#lostTimer);
    this.#resumeSecret?.fill(0);
    this.#resumeSecret = undefined;
    this.#block = undefined;
    if (outcome.state !== 'completed') {
      const reason = outcome.state === 'failed' ? outcome.error : new DropgateError({ code: 'OPERATION_CANCELLED' });
      for (const sink of [this.#current, this.#zipOut]) void sink?.abort(reason);
    }
    this.#current = undefined;
    this.#zipOut = undefined;
    this.#zip = undefined;
    const ended = outcome.state === 'failed' ? outcome.error : new DropgateError({ code: 'OPERATION_CANCELLED' });
    this.#offer.reject(ended);
    this.#state = outcome.state;
    this.#done.resolve(outcome);
    this.#listeners.notify();
    this.#link.stream(undefined);
    if (this.#pendingClose) {
      // The sender's CLOSE came while the files were being finished, and they weren't: it's answered, unfinished.
      this.#link.send({ type: 'close-ack', operationId: this.#pendingClose.operationId, finished: false });
      this.#pendingClose = undefined;
    }
    if (telling) {
      await telling;
    } else {
      await within(this.#link.flush(), CLOSE_ACK_WAIT_MS, this.#timers);
    }
    this.#link.close();
  }
}

/** A ZIP writer's error, as the receive says it. */
function zipError(err: unknown): DropgateError {
  if (DropgateError.is(err, 'INVALID_ARGUMENT')) return integrityFailed("A file's bytes didn't match its size.");
  return toDropgateError(err, 'OUTPUT_WRITE_FAILED');
}

/** The receiver's side of a direct transfer over `channel`, whose handshake is done. */
export function receiveDirect(provider: CryptoProvider, channel: SecureChannel, options?: DirectReceiveOptions): DirectReceiver {
  return new DirectReceiver(provider, channel, options);
}
