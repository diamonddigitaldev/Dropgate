import type { CryptoProvider } from '../crypto/index.js';
import { DropgateError, toDropgateError } from '../errors.js';
import { SinkWriter, isDownloadSink, type DownloadSinkOption } from '../sink.js';
import { StreamingZipWriter } from '../zip/stream-zip.js';
import type { SecureChannel } from './channel.js';
import {
  CREDIT_STEP_BYTES, CREDIT_WINDOW_BYTES, GLOBAL_TIMERS, Link, Listeners, RESULT_ACK_WAIT_MS, closeFor, deferred,
  integrityFailed, invalidMessage, outcomeOfClose, readRecord, sameBytes, within,
  type DirectOutcome, type DirectState, type EngineTimers, type Inbound,
} from './engine.js';
import { RESUME_SECRET_BYTES } from './keys.js';
import {
  BLOCK_BYTES, DATA_HEADER_BYTES, MESSAGE_TYPE, ManifestAssembler, blockCount, chainBlock, chainFileEnd, chainStart, dataBytes, decodeManifest,
  manifestHash, type Assurance, type ManifestFile, type Message,
} from './messages.js';

// The receiver's side of one direct transfer, once its secure channel is up.
//
//   1. The offer: the sender's MANIFEST records, put back together and
//      checked; `offer()` gives the files.
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
  #phase: Phase = 'offer';
  #state: DirectState = 'connecting';
  #files: ManifestFile[] = [];
  #totalSize = 0;
  #manifestHash: Uint8Array | undefined;
  #chain: Uint8Array | undefined;
  #resumeSecret: Uint8Array | undefined;
  #assurance: Assurance = 'saved';
  #commitId: Uint8Array | undefined;

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
  #ackTimer: unknown;

  constructor(provider: CryptoProvider, channel: SecureChannel, options: DirectReceiveOptions = {}) {
    if (channel?.role !== 'receiver') throw new DropgateError({ code: 'INVALID_ARGUMENT', message: "A receive runs over the receiver's channel." });
    this.#provider = provider;
    this.#timers = options.timers ?? GLOBAL_TIMERS;
    this.#generation = channel.generation;
    this.#link = new Link(channel, {
      arrived: (record) => this.#arrived(record),
      record: (inbound) => this.deliver(inbound),
      ended: (err) => this.#lost(err),
    });
    this.#assembler = new ManifestAssembler(this.#link.recordBytes);
    this.#maxData = dataBytes(this.#link.recordBytes);
    this.#link.start();
  }

  /** Where the transfer stands. */
  get state(): DirectState { return this.#state; }

  /** How it ended, once it has. */
  get done(): Promise<DirectOutcome> { return this.#done.promise; }

  /** Calls `listener` whenever `state` changes. Returns a function that stops it. */
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
    this.#setState('transferring');
  }

  /** Declines the offer: the sender is told (CLOSE, USER_DECLINED), and this side ends cancelled. */
  decline(): void {
    if (this.#phase !== 'offer' && this.#phase !== 'offered') throw noLongerOffered();
    void this.#end({ state: 'cancelled', by: 'self' }, { reason: 'USER_DECLINED' });
  }

  /** Cancels: the channel is closed, the sink aborted. (The sender hears it as the connection closing, for now.) */
  cancel(): void {
    void this.#end({ state: 'cancelled', by: 'self' });
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
      case 'close': return this.#closeHeard(message);
      case 'hold':
      case 'ping':
      case 'pong':
      case 'status':
      case 'close-ack':
        // Pausing, liveness and the close's answer aren't used yet: passed over.
        return undefined;
      default:
        // BIND, ACCEPT, CREDIT and RESULT are the receiver's to send, never the sender's.
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
      await sink.close();
      if (!this.#live(g)) return;
      this.#filesDone += 1;
    }
    this.#fileIndex += 1;
    this.#fileOffset = 0;
    this.#blockIndex = 0;
    // A file finished: the sender may be waiting on it.
    this.#creditMoved(true);
  }

  async #finish(m: Extract<Message, { type: 'finish' }>, g: bigint): Promise<void> {
    if (this.#phase !== 'receiving' || this.#fileIndex !== this.#files.length) throw invalidMessage();
    if (m.fileCount !== this.#files.length || m.totalSize !== this.#totalSize || !sameBytes(m.manifestHash, this.#manifestHash as Uint8Array)
      || !sameBytes(m.chain, this.#chain as Uint8Array)) {
      throw integrityFailed("The transfer's end didn't match what arrived.");
    }
    this.#phase = 'finalising';
    this.#setState('finalising');
    if (this.#zip) {
      await this.#zipAsync(() => (this.#zip as StreamingZipWriter).finalize());
      if (!this.#live(g)) return;
      await (this.#zipOut as SinkWriter).close();
    } else {
      await (this.#current as SinkWriter).close();
    }
    if (!this.#live(g)) return;
    this.#current = undefined;
    this.#zipOut = undefined;
    // Only now, with every file closed, the result.
    const commitId = this.#provider.randomBytes(16);
    this.#commitId = commitId;
    this.#link.send({
      type: 'result', commitId, assurance: this.#assurance, fileCount: this.#files.length, totalSize: this.#totalSize, chain: this.#chain as Uint8Array,
    });
    this.#phase = 'result';
    this.#ackTimer = this.#timers.setTimeout(() => {
      if (this.#live(g)) this.#complete();
    }, RESULT_ACK_WAIT_MS);
  }

  #resultAck(m: Extract<Message, { type: 'result-ack' }>): void {
    if (this.#phase !== 'result') throw invalidMessage();
    // Another commit's is passed over: the files are saved, and the wait ends it anyway.
    if (sameBytes(m.commitId, this.#commitId as Uint8Array)) this.#complete();
  }

  #closeHeard(m: Extract<Message, { type: 'close' }>): void {
    // Once RESULT has gone the files are saved: it stays completed.
    if (this.#phase === 'result') {
      this.#complete();
      return;
    }
    void this.#end(outcomeOfClose(m, 'receiver'));
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
    const sink = await SinkWriter.open(this.#sink as DownloadSinkOption, { name: file.name, size: file.size, index });
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
      await this.#zipAsync(() => zip.drained());
      return;
    }
    if (!this.#live(g)) return;
    await (this.#current as SinkWriter).write(block);
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
   * last): no CREDIT ever waits on a timer.
   */
  #creditMoved(now: boolean): void {
    if (this.#phase !== 'receiving') return;
    if (now || this.#consumed - this.#creditedAt >= CREDIT_STEP_BYTES) this.#sendCredit();
  }

  #sendCredit(): void {
    this.#revision += 1;
    this.#limit = this.#consumed + CREDIT_WINDOW_BYTES;
    this.#creditedAt = this.#consumed;
    this.#link.send({
      type: 'credit', revision: this.#revision, limit: this.#limit, consumed: this.#consumed, filesDone: this.#filesDone,
      verifiedFileIndex: this.#fileIndex, verifiedOffset: this.#blockIndex * BLOCK_BYTES,
    });
  }


  #setState(state: DirectState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.#listeners.notify();
  }

  #complete(): void {
    void this.#end({ state: 'completed', assurance: this.#assurance });
  }

  /** The channel ended under the transfer: completed if RESULT has gone (the files are saved), else lost as the channel says. */
  #lost(err: DropgateError): void {
    if (this.#phase === 'result') this.#complete();
    else void this.#end({ state: 'failed', error: err });
  }

  /** This side failed, in generation `g`: the sender told with a CLOSE. A failure from another generation is dropped. */
  #fail(err: unknown, g: bigint): void {
    if (!this.#live(g)) return;
    const error = toDropgateError(err);
    void this.#end({ state: 'failed', error }, closeFor(error));
  }

  /**
   * Ends the transfer, once: everything after is fenced off at once. The sink
   * aborted unless completed, the sender told with `close` if one is given
   * (sent, then the channel closed), the resume secret overwritten.
   */
  async #end(outcome: DirectOutcome, close?: { reason: Extract<Message, { type: 'close' }>['reason']; detail?: Extract<Message, { type: 'close' }>['detail'] }): Promise<void> {
    if (this.#phase === 'ended') return;
    this.#phase = 'ended';
    if (this.#ackTimer !== undefined) this.#timers.clearTimeout(this.#ackTimer);
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
    if (close) {
      this.#link.stream(undefined);
      this.#link.send({ type: 'close', operationId: this.#provider.randomBytes(16), ...close });
      await within(this.#link.flush(), RESULT_ACK_WAIT_MS, this.#timers);
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
