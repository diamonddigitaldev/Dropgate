import { DropgateError, toDropgateError } from '../errors.js';
import type { SecureChannel } from './channel.js';
import { decodeMessage, encodeMessage, type Assurance, type CloseDetail, type CloseReason, type Message } from './messages.js';
import { NOISE_TAG_BYTES } from './noise.js';
import { LOW_WATER_BYTES } from './webrtc.js';

// What both sides of a direct transfer's engine share, once the secure channel
// (channel.ts) is up: one ordered pump of records each way, the generation
// fence, and how a transfer's end is said and heard.
//
// The pump. Each side has one loop that sends its records in order: control
// records (ACCEPT, CREDIT, RESULT, RESULT_ACK, CLOSE) go ahead of whatever of
// the sender's stream (DATA, BLOCK_END, FILE_END, FINISH) hasn't gone yet.
// Records are encrypted in the order they're sent, up to 8 at a time, and
// handed to the data channel strictly in that order; nothing encrypted is ever
// dropped. The pump stops once about 1 MiB waits in the data channel's buffer,
// and goes on once it's down to 256 KiB.
//
// The fence. Every effect carries the generation of the connection it came
// from or was started on: a record, a sink's write, a file's read, a timer.
// One from another generation, or that resolves after the transfer has ended,
// is dropped and touches nothing: nothing is written, sent or ended by it. A
// transfer has one generation until recovery makes a resume's.
//
// The end. A side that fails tells the other with one CLOSE, in-band, then
// closes: FAILED with what failed, or the receiver's USER_DECLINED, or the
// sender's TAKEN to a receiver it didn't choose. The side that hears a CLOSE
// ends as its reason says, in its own words, and never passes on anything of
// the other device's. A connection that's lost, or a fault in the secure
// channel itself, ends both sides as the channel says it, with no CLOSE.

/** The receiver's credit: at most this many bytes sent and not yet written. */
export const CREDIT_WINDOW_BYTES = 4194304;
/** The receiver sends CREDIT once what it has written has moved this far since the last. */
export const CREDIT_STEP_BYTES = 262144;
/** The pump stops once about this much waits in the data channel's buffer, and goes on at `LOW_WATER_BYTES`. */
export const PUMP_HIGH_WATER_BYTES = 1048576;
/** The sender reads its files a block (1 MiB) at a time, at most this many ahead of what it has sent. */
export const SOURCE_BLOCKS_AHEAD = 2;
/** Records encrypted at once, ahead of the data channel. */
export const ENCRYPT_AHEAD = 8;
/** File ends the sender may send while the receiver hasn't finished their files. */
export const MAX_UNFINISHED_FILE_ENDS = 8;
/** How long the receiver waits for RESULT_ACK before completing anyway; how long a side waits for a CLOSE to go. */
export const RESULT_ACK_WAIT_MS = 2000;

/** A timer source: the global one, or a test's clock. */
export interface EngineTimers {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export const GLOBAL_TIMERS: EngineTimers = Object.freeze({
  setTimeout: (run: () => void, ms: number) => globalThis.setTimeout(run, ms),
  clearTimeout: (id: unknown) => globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>),
});

/** Where a direct transfer stands, for one side. */
export type DirectState = 'connecting' | 'waiting' | 'offered' | 'transferring' | 'finalising' | 'completed' | 'cancelled' | 'failed';

/** How a direct transfer ended, for one side. */
export type DirectOutcome =
  | { state: 'completed'; assurance: Assurance }
  | { state: 'cancelled'; by: 'self' | 'peer'; declined?: true }
  | { state: 'failed'; error: DropgateError };

/** A record from the other side, with the generation of the connection it came on. */
export interface Inbound {
  generation: bigint;
  record: Uint8Array;
}

/** What a side's stream offers the pump: its next record, if one is ready and may go now. */
export interface StreamSource {
  next(): Message | undefined;
}

export interface LinkHandlers {
  /**
   * Each record as it arrives, before any earlier one is handled: a quick
   * look (the receiver counts DATA against its credit here), never awaited.
   */
  arrived?(record: Uint8Array): void;
  /** Each record from the other side, in order: the next waits until this one's handled. */
  record(inbound: Inbound): Promise<void>;
  /** The channel ended under the link (closed, lost or refused), once every record that came before is handled. */
  ended(err: DropgateError): void;
}

/**
 * One generation's secure channel, as the engine uses it: the record size both
 * hellos allow, the records read in order, and the one ordered pump.
 */
export class Link {
  readonly generation: bigint;
  /** The largest record either side may send: the smaller of the two hellos'. */
  readonly recordBytes: number;
  readonly #channel: SecureChannel;
  readonly #handlers: LinkHandlers;
  readonly #control: Uint8Array[] = [];
  #stream: StreamSource | undefined;
  readonly #inFlight: Array<Promise<void>> = [];
  /** Bytes handed to the channel since its buffer was last at the low-water mark. */
  #since = 0;
  #wake: (() => void) | undefined;
  #busy = false;
  readonly #idle: Array<() => void> = [];
  #closed = false;
  /** Records read and not yet handled, in order. */
  readonly #inbox: Uint8Array[] = [];
  #handling = false;
  /** Why the channel ended, told once the inbox is empty. */
  #lostWith: DropgateError | undefined;

  constructor(channel: SecureChannel, handlers: LinkHandlers) {
    this.#channel = channel;
    this.#handlers = handlers;
    this.generation = channel.generation;
    this.recordBytes = Math.min(channel.maxRecordBytes, channel.peerHello.maxRecord);
  }

  /** Starts reading the other side's records, and the pump. */
  start(): void {
    void this.#read();
    void this.#pump();
  }

  /** Sends a control record, ahead of anything of the stream not yet sent. */
  send(message: Message): void {
    this.sendRecord(encodeMessage(message));
  }

  /** A record already written: the manifest's. */
  sendRecord(record: Uint8Array): void {
    if (this.#closed) return;
    this.#control.push(record);
    this.wake();
  }

  /** Sets (or, with undefined, stops) the stream the pump draws from once no control record waits. */
  stream(source: StreamSource | undefined): void {
    this.#stream = source;
    this.wake();
  }

  /** Something changed that may let a record go: credit, a block read, a control record. */
  wake(): void {
    const wake = this.#wake;
    this.#wake = undefined;
    wake?.();
  }

  /** Resolves once every record queued so far has been handed to the data channel (or the link has closed). */
  async flush(): Promise<void> {
    while (!this.#closed && (this.#busy || this.#control.length > 0)) {
      await new Promise<void>((resolve) => this.#idle.push(resolve));
    }
    await Promise.allSettled([...this.#inFlight]);
  }

  /** Closes the channel: nothing more is sent or read. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#inbox.length = 0;
    this.#channel.close();
    this.#settleIdle();
    this.wake();
  }

  get closed(): boolean { return this.#closed; }

  /** Reads every record as it comes, whatever is still being handled, so each is looked at on arrival. */
  async #read(): Promise<void> {
    for (;;) {
      let record: Uint8Array;
      try {
        record = await this.#channel.receive();
      } catch (err) {
        // Whatever came before the end is handled first: a CLOSE just before it is still heard.
        this.#lostWith = toDropgateError(err);
        if (!this.#handling) this.#end(this.#lostWith);
        return;
      }
      if (this.#closed) return;
      this.#handlers.arrived?.(record);
      this.#inbox.push(record);
      if (!this.#handling) void this.#handle();
    }
  }

  /** Hands the records to the side, one at a time, in order. */
  async #handle(): Promise<void> {
    this.#handling = true;
    while (this.#inbox.length > 0 && !this.#closed) {
      await this.#handlers.record({ generation: this.generation, record: this.#inbox.shift() as Uint8Array });
    }
    this.#handling = false;
    if (this.#lostWith) this.#end(this.#lostWith);
  }

  async #pump(): Promise<void> {
    while (!this.#closed) {
      const record = this.#control.shift() ?? this.#fromStream();
      if (!record) {
        this.#busy = false;
        this.#settleIdle();
        await new Promise<void>((resolve) => { this.#wake = resolve; });
        continue;
      }
      this.#busy = true;
      try {
        if (this.#since >= PUMP_HIGH_WATER_BYTES - LOW_WATER_BYTES) {
          // Everything counted is in the buffer first, then it drains to the low-water mark.
          await Promise.all(this.#inFlight.splice(0));
          await this.#channel.writable();
          this.#since = 0;
        }
        if (this.#closed) return;
        const sending = this.#channel.send(record);
        sending.catch(() => undefined);
        this.#inFlight.push(sending);
        this.#since += record.byteLength + NOISE_TAG_BYTES;
        if (this.#inFlight.length >= ENCRYPT_AHEAD) await this.#inFlight.shift();
      } catch (err) {
        this.#end(err);
        return;
      }
    }
  }

  #fromStream(): Uint8Array | undefined {
    const message = this.#stream?.next();
    return message && encodeMessage(message);
  }

  #settleIdle(): void {
    for (const resolve of this.#idle.splice(0)) resolve();
  }

  /** The channel ended under the link. */
  #end(err: unknown): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#inbox.length = 0;
    this.#settleIdle();
    try {
      this.#channel.close();
    } catch {
      // Gone already.
    }
    this.#handlers.ended(toDropgateError(err));
  }
}

/** A record from the other side, read: INVALID_MESSAGE if it isn't one of this version's. */
export function readRecord(record: Uint8Array): Message {
  return decodeMessage(record);
}

/** Whether two byte strings are the same. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** A record that isn't one this side takes now: from the wrong side, out of order, or the wrong size. */
export const invalidMessage = () => new DropgateError({ code: 'INVALID_MESSAGE' });

/** What the other device sent didn't match its own hashes or the list of files. */
export const integrityFailed = (message: string) => new DropgateError({ code: 'INTEGRITY_FAILED', origin: 'peer', message });

const CLOSE_DETAILS = new Set<string>([
  'OUTPUT_WRITE_FAILED', 'OUTPUT_STALLED', 'SOURCE_UNAVAILABLE', 'INTEGRITY_FAILED', 'INVALID_MANIFEST', 'INVALID_MESSAGE', 'TIMED_OUT',
  'CAPABILITY_UNSUPPORTED',
]);

/**
 * The CLOSE that tells the other side this side's failure: FAILED, with the
 * failure as its detail when it's one CLOSE names. None when the channel
 * itself has gone or failed, or this side cancelled (a cancel closes, for now).
 */
export function closeFor(err: DropgateError): { reason: CloseReason; detail?: CloseDetail } | undefined {
  switch (err.code) {
    case 'CONNECTION_LOST':
    case 'SECURITY_POLICY_MISMATCH':
    case 'OPERATION_CANCELLED':
      return undefined;
    default:
      return CLOSE_DETAILS.has(err.code) ? { reason: 'FAILED', detail: err.code as CloseDetail } : { reason: 'FAILED' };
  }
}

type Side = 'sender' | 'receiver';

/** What the other side's failure is called, in this side's words: by what failed, else by the reason. */
const PEER_FAILED_WORDS: Readonly<Record<Side, Readonly<Record<string, string>>>> = Object.freeze({
  // The receiver hears these from the sender.
  receiver: Object.freeze({
    SOURCE_UNAVAILABLE: "The sender's file couldn't be read.",
    INVALID_MESSAGE: "The sender's device couldn't understand what this device sent.",
    APP_CLOSED: 'The sender closed Dropgate before the transfer finished.',
    PAUSE_LIMIT: "The sender's app ended the transfer after a pause.",
    other: "The sender's device reported an error.",
  }),
  // The sender hears these from the receiver.
  sender: Object.freeze({
    OUTPUT_WRITE_FAILED: "The receiver couldn't save the file.",
    OUTPUT_STALLED: "The receiver's device stopped saving the file.",
    INTEGRITY_FAILED: "The file didn't arrive intact.",
    INVALID_MANIFEST: "The receiver couldn't read the list of files.",
    INVALID_MESSAGE: "The receiver's device couldn't understand what this device sent.",
    APP_CLOSED: 'The receiver closed Dropgate before the transfer finished.',
    PAUSE_LIMIT: "The receiver's app ended the transfer after a pause.",
    other: "The receiver's device reported an error.",
  }),
});

/**
 * How this side ends on hearing the other's CLOSE. Its reason and detail are
 * named, never anything the other device wrote: PEER_FAILED carries what
 * failed as `details.reason`.
 */
export function outcomeOfClose(close: { reason: CloseReason; detail?: CloseDetail }, side: Side): DirectOutcome {
  switch (close.reason) {
    case 'USER_CANCELLED':
      return { state: 'cancelled', by: 'peer' };
    case 'USER_DECLINED':
      return side === 'sender' ? { state: 'cancelled', by: 'peer', declined: true } : { state: 'cancelled', by: 'peer' };
    case 'TAKEN':
      if (side === 'receiver') {
        return {
          state: 'failed',
          error: new DropgateError({ code: 'REQUEST_REJECTED', origin: 'peer', message: 'This transfer is already going to someone else.' }),
        };
      }
      break;
    case 'FAILED':
      if (close.detail === 'TIMED_OUT') {
        return { state: 'failed', error: new DropgateError({ code: 'TIMED_OUT', origin: 'peer', message: "The offer wasn't accepted within 10 minutes." }) };
      }
      break;
    default:
      break;
  }
  const reason = close.reason === 'FAILED' ? close.detail : close.reason === 'TAKEN' ? undefined : close.reason;
  const words = PEER_FAILED_WORDS[side];
  return {
    state: 'failed',
    error: new DropgateError({
      code: 'PEER_FAILED',
      message: (reason && words[reason]) ?? words.other,
      ...(reason ? { details: { reason } } : {}),
    }),
  };
}

/** A deferred promise, its handlers outside. */
export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

/** `work`, or after `ms` on `timers` if it hasn't settled by then. Never rejects. */
export async function within(work: Promise<unknown>, ms: number, timers: EngineTimers): Promise<void> {
  let timer: unknown;
  await Promise.race([
    work.catch(() => undefined),
    new Promise<void>((resolve) => { timer = timers.setTimeout(resolve, ms); }),
  ]);
  timers.clearTimeout(timer);
}

/** Listeners told whenever a side's state changes. */
export class Listeners {
  readonly #listeners = new Set<() => void>();

  add(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  notify(): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch {
        // A listener's error is its own.
      }
    }
  }
}
