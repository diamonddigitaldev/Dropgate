import { DropgateError, toDropgateError } from '../errors.js';
import type { SecureChannel } from './channel.js';
import {
  MESSAGE_TYPE, decodeMessage, encodeMessage, type Assurance, type CloseDetail, type CloseReason, type Message, type ResultBody,
} from './messages.js';
import { NOISE_TAG_BYTES } from './noise.js';
import {
  CLOSE_ACK_WAIT_MS, Deadline, GLOBAL_TIMERS, MIN_NO_ANSWER_MS, NO_ANSWER_RTTS, PING_INTERVAL_MS, STALL_FAILED_MS, STALL_SHOWN_MS,
  type EngineTimers,
} from './timers.js';
import { LOW_WATER_BYTES } from './webrtc.js';

export { GLOBAL_TIMERS, type EngineTimers };

// What both sides of a direct transfer's engine share, once the secure channel
// (channel.ts) is up: one ordered pump of records each way, the connection's
// liveness, the generation fence, holds, stalls, and how a transfer's end is
// said and heard.
//
// The pump. Each side has one loop that sends its records in order: control
// records (ACCEPT, CREDIT, RESULT, RESULT_ACK, HOLD, CLOSE, CLOSE_ACK, PING,
// PONG, STATUS) go ahead of whatever of the sender's stream (DATA, BLOCK_END,
// FILE_END, FINISH) hasn't gone yet. Records are encrypted in the order
// they're sent, up to 8 at a time, and handed to the data channel strictly in
// that order; nothing encrypted is ever dropped. The pump stops once about
// 1 MiB waits in the data channel's buffer, and goes on once it's down to
// 256 KiB.
//
// Liveness. A side that has sent nothing for 5 s sends a PING; each PING is
// answered with a PONG as it arrives, whatever the side is busy with, and the
// round trip feeds a smoothed RTT. Nothing heard from the other side for
// max(15 s, 6 × the smoothed RTT) ends the connection, CONNECTION_LOST. It
// keeps running while a transfer is held.
//
// The fence. Every effect carries the generation of the connection it came
// from or was started on: a record, a sink's write, a file's read, a timer.
// One from another generation, or that resolves after the transfer has ended,
// is dropped and touches nothing: nothing is written, sent or ended by it. A
// transfer has one generation until recovery makes a resume's.
//
// The end. Every end but completion and a fault in the secure channel itself
// is one CLOSE: sent in-band and through the rendezvous (sealed, so it still
// arrives when the data channel has gone), answered with CLOSE_ACK, waited
// for 2 s at most. A CLOSE is heard as it arrives, by either path, ahead of
// records still waiting their turn; a second is ignored. The side that hears
// one ends as its reason says, in its own words, and never passes on anything
// of the other device's. A connection that's lost waits 2 s for a CLOSE
// through the rendezvous before it ends CONNECTION_LOST; a fault in the
// secure channel ends both sides as the channel says it, with no CLOSE.

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
/** How long the receiver waits for RESULT_ACK before completing anyway. */
export const RESULT_ACK_WAIT_MS = 2000;
/** PINGs a side remembers waiting for their PONG: an older one's answer is passed over. */
const MAX_PINGS_WAITING = 16;

/** Where a direct transfer stands, for one side. */
export type DirectState = 'connecting' | 'waiting' | 'offered' | 'transferring' | 'finalising' | 'completed' | 'cancelled' | 'failed';

/** How a direct transfer ended, for one side. */
export type DirectOutcome =
  | { state: 'completed'; assurance: Assurance }
  | { state: 'cancelled'; by: 'self' | 'peer'; declined?: true }
  | { state: 'failed'; error: DropgateError };

/** Who holds a transfer, as one side sees it: this side, the other, both, or no one. */
export type PausedBy = 'self' | 'peer' | 'both' | null;

/** A record from the other side, with the generation of the connection it came on. */
export interface Inbound {
  generation: bigint;
  record: Uint8Array;
}

/** What a side's stream offers the pump: its next record, if one is ready and may go now. */
export interface StreamSource {
  next(): Message | undefined;
}

export type CloseMessage = Extract<Message, { type: 'close' }>;
export type CloseAck = Extract<Message, { type: 'close-ack' }>;
export type StatusAnswer = Extract<Message, { type: 'status'; kind: 'answer' }>;
/** What a CLOSE says: its reason, and with FAILED what failed. */
export interface CloseWhy { reason: CloseReason; detail?: CloseDetail }

/** Where the other side said it stood, in its last answer to a STATUS ask. */
export interface PeerStatus {
  /** `STATUS_STATE`'s: 1 offered, 2 transferring, 3 finalising, 4 finished; 0 anything else. */
  state: number;
  /** Whether the other side holds the transfer. */
  held: boolean;
  /** The bytes written, as the other side knows it. */
  consumed: number;
}

/** STATUS's state byte: where the answering side stands. 0 for anything else. */
export const STATUS_STATE = Object.freeze({ OFFERED: 1, TRANSFERRING: 2, FINALISING: 3, FINISHED: 4 });

export interface LinkHandlers {
  /**
   * Each record as it arrives, before any earlier one is handled: a quick
   * look (the receiver counts DATA against its credit here), never awaited.
   */
  arrived?(record: Uint8Array): void;
  /** Each record from the other side, in order: the next waits until this one's handled. */
  record(inbound: Inbound): Promise<void>;
  /**
   * The channel ended under the link (closed, lost or refused), once every
   * record that came before is handled. The channel is left open for a late
   * CLOSE through the rendezvous until the side closes the link.
   */
  ended(err: DropgateError): void;
  /** The other side's CLOSE, in-band or through the rendezvous, as it arrives: ahead of records still waiting. */
  close(message: CloseMessage, generation: bigint): void;
  /** What this side answers to a STATUS ask. */
  status(): Omit<StatusAnswer, 'type' | 'kind' | 'id'>;
  /** The other side's answer to this side's STATUS ask. */
  statusHeard?(answer: StatusAnswer, generation: bigint): void;
}

/**
 * One generation's secure channel, as the engine uses it: the record size both
 * hellos allow, the records read in order, the one ordered pump, liveness,
 * and the CLOSE both ways.
 */
export class Link {
  readonly generation: bigint;
  /** The largest record either side may send: the smaller of the two hellos'. */
  readonly recordBytes: number;
  readonly #channel: SecureChannel;
  readonly #handlers: LinkHandlers;
  readonly #timers: EngineTimers;
  readonly #control: Uint8Array[] = [];
  #stream: StreamSource | undefined;
  readonly #inFlight: Array<Promise<void>> = [];
  /** Bytes handed to the channel since its buffer was last at the low-water mark. */
  #since = 0;
  #wake: (() => void) | undefined;
  #busy = false;
  readonly #idle: Array<() => void> = [];
  /** Nothing more is sent or read: the link was closed, or its channel ended. */
  #closed = false;
  /** The channel itself closed, by the side. */
  #released = false;
  /** Records read and not yet handled, in order. */
  readonly #inbox: Uint8Array[] = [];
  #handling = false;
  /** Why the channel ended, told once the inbox is empty. */
  #lostWith: DropgateError | undefined;
  /** The other side's CLOSE through the rendezvous, heard while the data channel is still up: it waits (#heldClose()). */
  #heldClose: CloseMessage | undefined;
  #heldTimer: unknown;

  // Liveness.
  #lastSent: number;
  #lastHeard: number;
  #srtt: number | undefined;
  readonly #pings = new Map<bigint, number>();
  #nextId = 1n;
  readonly #pingTimer: Deadline;
  readonly #answerTimer: Deadline;
  readonly #acks = new Map<string, (ack: CloseAck | undefined) => void>();

  constructor(channel: SecureChannel, handlers: LinkHandlers, timers: EngineTimers = GLOBAL_TIMERS) {
    this.#channel = channel;
    this.#handlers = handlers;
    this.#timers = timers;
    this.generation = channel.generation;
    this.recordBytes = Math.min(channel.maxRecordBytes, channel.peerHello.maxRecord);
    this.#lastSent = timers.now();
    this.#lastHeard = this.#lastSent;
    this.#pingTimer = new Deadline(timers, () => (this.#closed ? undefined : this.#lastSent + PING_INTERVAL_MS), () => this.#ping());
    this.#answerTimer = new Deadline(timers, () => (this.#closed ? undefined : this.#lastHeard + this.noAnswerMs), () => {
      this.#end(new DropgateError({ code: 'CONNECTION_LOST', message: "The connection was lost, so the transfer couldn't continue." }));
    });
  }

  /** Starts reading the other side's records (both ways), the pump and liveness. */
  start(): void {
    void this.#read();
    void this.#pump();
    this.#pingTimer.arm();
    this.#answerTimer.arm();
    // The other side's CLOSE through the rendezvous: heard until the side closes the link, even once the data channel has gone.
    this.#channel.closeReceived.then((body) => {
      if (this.#released) return;
      let message: Message;
      try {
        message = decodeMessage(body);
      } catch {
        return;
      }
      if (message.type === 'close') this.#outOfBand(message);
    }, () => undefined);
  }

  /**
   * The other side's CLOSE through the rendezvous. That copy is sealed and
   * sent at once, so it can come ahead of the records the other side sent
   * before it (an ACCEPT, say). While the data channel is up it waits for the
   * in-band CLOSE, which follows them, for the channel's end, or for 2 s,
   * whichever is first; once the channel has gone it's heard at once.
   */
  #outOfBand(message: CloseMessage): void {
    if (this.#closed) {
      this.#handlers.close(message, this.generation);
      return;
    }
    if (this.#heldClose) return;
    this.#heldClose = message;
    this.#heldTimer = this.#timers.setTimeout(() => {
      const held = this.#takeHeldClose();
      if (held && !this.#released) this.#handlers.close(held, this.generation);
    }, CLOSE_ACK_WAIT_MS);
  }

  /** The held out-of-band CLOSE, if there is one, no longer held. */
  #takeHeldClose(): CloseMessage | undefined {
    const held = this.#heldClose;
    this.#heldClose = undefined;
    if (held) this.#timers.clearTimeout(this.#heldTimer);
    return held;
  }

  /** The smoothed round trip, once a PONG has come. */
  get srtt(): number | undefined { return this.#srtt; }

  /** How long nothing may be heard before the connection is lost: max(15 s, 6 × the smoothed round trip). */
  get noAnswerMs(): number {
    return Math.max(MIN_NO_ANSWER_MS, NO_ANSWER_RTTS * (this.#srtt ?? 0));
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

  /** Something changed that may let a record go: credit, a block read, a control record, a hold let go. */
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

  /**
   * Sends this side's one CLOSE: first sealed through the rendezvous, before
   * this returns its promise (so a page that's going still gets it out), then
   * in-band, after whatever is already encrypted; then waits up to 2 s for the
   * CLOSE_ACK, which it gives. With the data channel already gone it goes
   * through the rendezvous alone, and nothing is waited for.
   */
  closeWith(message: CloseMessage): Promise<CloseAck | undefined> {
    const record = encodeMessage(message);
    if (!this.#released) {
      try {
        this.#channel.sendClose(record);
      } catch {
        // The channel has ended, or this side's close went already: the in-band one is all there is.
      }
    }
    if (this.#closed) return Promise.resolve(undefined);
    const key = idKey(message.operationId);
    let resolve!: (ack: CloseAck | undefined) => void;
    const acked = new Promise<CloseAck | undefined>((res) => { resolve = res; });
    this.#acks.set(key, resolve);
    this.sendRecord(record);
    const timer = this.#timers.setTimeout(() => resolve(undefined), CLOSE_ACK_WAIT_MS);
    return acked.then((ack) => {
      this.#timers.clearTimeout(timer);
      this.#acks.delete(key);
      return ack;
    });
  }

  /** Closes the link and its channel: nothing more is sent or read, and no late CLOSE is listened for. */
  close(): void {
    this.#takeHeldClose();
    this.#stop();
    if (this.#released) return;
    this.#released = true;
    for (const resolve of this.#acks.values()) resolve(undefined);
    this.#acks.clear();
    try {
      this.#channel.close();
    } catch {
      // Gone already.
    }
  }

  /** Whether nothing more is sent or read. */
  get closed(): boolean { return this.#closed; }

  #stop(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#inbox.length = 0;
    this.#pingTimer.stop();
    this.#answerTimer.stop();
    this.#settleIdle();
    this.wake();
  }

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
      this.#lastHeard = this.#timers.now();
      if (this.#answered(record)) continue;
      this.#handlers.arrived?.(record);
      this.#inbox.push(record);
      if (!this.#handling) void this.#handle();
    }
  }

  /**
   * Records answered as they arrive, never waiting behind the side's work:
   * PING (with a PONG), PONG (the round trip), STATUS, CLOSE and CLOSE_ACK.
   * One that doesn't read is left for the side, in order, to refuse.
   */
  #answered(record: Uint8Array): boolean {
    const type = record[0];
    if (type !== MESSAGE_TYPE.PING && type !== MESSAGE_TYPE.PONG && type !== MESSAGE_TYPE.STATUS && type !== MESSAGE_TYPE.CLOSE
      && type !== MESSAGE_TYPE.CLOSE_ACK) {
      return false;
    }
    let message: Message;
    try {
      message = decodeMessage(record);
    } catch {
      return false;
    }
    switch (message.type) {
      case 'ping':
        this.send({ type: 'pong', id: message.id });
        break;
      case 'pong':
        this.#pong(message.id);
        break;
      case 'status':
        if (message.kind === 'ask') this.send({ type: 'status', kind: 'answer', id: message.id, ...this.#handlers.status() });
        else this.#handlers.statusHeard?.(message, this.generation);
        break;
      case 'close':
        // The in-band CLOSE is the one: a copy held from the rendezvous is let go.
        this.#takeHeldClose();
        this.#handlers.close(message, this.generation);
        break;
      case 'close-ack':
        // An answer to no CLOSE of this side's is passed over.
        this.#acks.get(idKey(message.operationId))?.(message);
        break;
      default:
        return false;
    }
    return true;
  }

  /** Asks the other side where it stands (STATUS): its answer comes to `statusHeard`. */
  askStatus(): void {
    this.send({ type: 'status', kind: 'ask', id: this.#takeId() });
  }

  #takeId(): bigint {
    const id = this.#nextId;
    this.#nextId += 1n;
    return id;
  }

  #ping(): void {
    const id = this.#takeId();
    this.#pings.set(id, this.#timers.now());
    if (this.#pings.size > MAX_PINGS_WAITING) this.#pings.delete(this.#pings.keys().next().value as bigint);
    this.send({ type: 'ping', id });
    // Queued counts as sent for the next PING's time, so one goes every 5 s while nothing else does.
    this.#lastSent = this.#timers.now();
    this.#pingTimer.arm();
  }

  /** A PONG: the round trip into the smoothed RTT (7/8 the old, 1/8 the new). An unknown one is passed over. */
  #pong(id: bigint): void {
    const sentAt = this.#pings.get(id);
    if (sentAt === undefined) return;
    this.#pings.delete(id);
    const rtt = this.#timers.now() - sentAt;
    this.#srtt = this.#srtt === undefined ? rtt : (7 * this.#srtt + rtt) / 8;
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
        this.#lastSent = this.#timers.now();
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

  /** The channel ended under the link, or the other side went quiet: the side is told, and closes the link when it's ready. */
  #end(err: unknown): void {
    if (this.#closed) return;
    const held = this.#takeHeldClose();
    this.#stop();
    // A CLOSE held from the rendezvous is what ended it: heard first, so the side ends as it says.
    if (held) this.#handlers.close(held, this.generation);
    this.#handlers.ended(toDropgateError(err));
  }
}

const idKey = (id: Uint8Array) => Array.from(id, (b) => b.toString(16).padStart(2, '0')).join('');

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

/** No one accepted the offer in time. */
export const offerTimedOut = () => new DropgateError({ code: 'TIMED_OUT', origin: 'local', message: "The offer wasn't accepted within 10 minutes." });

const CLOSE_DETAILS = new Set<string>([
  'OUTPUT_WRITE_FAILED', 'OUTPUT_STALLED', 'SOURCE_UNAVAILABLE', 'INTEGRITY_FAILED', 'INVALID_MANIFEST', 'INVALID_MESSAGE', 'TIMED_OUT',
  'CAPABILITY_UNSUPPORTED',
]);

/**
 * The CLOSE that tells the other side how this side ended: a cancel
 * USER_CANCELLED; this side's own pause limit PAUSE_LIMIT; a failure FAILED,
 * with the failure as its detail when it's one CLOSE names. None when the
 * channel itself has gone or failed, or the end was the other side's (it has
 * its CLOSE_ACK).
 */
export function closeFor(err: DropgateError): CloseWhy | undefined {
  switch (err.code) {
    case 'CONNECTION_LOST':
    case 'SECURITY_POLICY_MISMATCH':
    case 'PEER_FAILED':
    case 'PEER_CLOSED':
      return undefined;
    case 'OPERATION_CANCELLED':
      return { reason: 'USER_CANCELLED' };
    case 'PAUSE_LIMIT':
      return err.details?.by === 'peer' ? undefined : { reason: 'PAUSE_LIMIT' };
    default:
      if (err.origin === 'peer' && err.code === 'REQUEST_REJECTED') return undefined;
      return CLOSE_DETAILS.has(err.code) ? { reason: 'FAILED', detail: err.code as CloseDetail } : { reason: 'FAILED' };
  }
}

type Side = 'sender' | 'receiver';

/** What the other side's failure is called, in this side's words: by what failed, else in general. */
const PEER_FAILED_WORDS: Readonly<Record<Side, Readonly<Record<string, string>>>> = Object.freeze({
  // The receiver hears these from the sender.
  receiver: Object.freeze({
    SOURCE_UNAVAILABLE: "The sender's file couldn't be read.",
    INVALID_MESSAGE: "The sender's device couldn't understand what this device sent.",
    other: "The sender's device reported an error.",
  }),
  // The sender hears these from the receiver.
  sender: Object.freeze({
    OUTPUT_WRITE_FAILED: "The receiver couldn't save the file.",
    OUTPUT_STALLED: "The receiver's device stopped saving the file.",
    INTEGRITY_FAILED: "The file didn't arrive intact.",
    INVALID_MANIFEST: "The receiver couldn't read the list of files.",
    INVALID_MESSAGE: "The receiver's device couldn't understand what this device sent.",
    other: "The receiver's device reported an error.",
  }),
});

const OTHER: Readonly<Record<Side, Side>> = Object.freeze({ sender: 'receiver', receiver: 'sender' });

/** A pause limit as words: "1-hour", "90-minute", "2-day". */
export function pauseLimitWords(seconds: number): string {
  const [n, unit] = seconds % 86400 === 0 ? [seconds / 86400, 'day']
    : seconds % 3600 === 0 ? [seconds / 3600, 'hour']
      : seconds % 60 === 0 ? [seconds / 60, 'minute'] : [seconds, 'second'];
  return `${n}-${unit}`;
}

/** A pause limit that ran out: this side's own (`by` self), or the other side's, told by its CLOSE. */
export function pauseLimitReached(side: Side, by: 'self' | 'peer', limitSeconds: number): DropgateError {
  const after = limitSeconds > 0 ? `after a ${pauseLimitWords(limitSeconds)} pause` : 'after a pause';
  return new DropgateError({
    code: 'PAUSE_LIMIT',
    origin: by === 'self' ? 'local' : 'peer',
    message: by === 'self' ? `Your app ended the transfer ${after}.` : `The ${OTHER[side]}'s app ended the transfer ${after}.`,
    details: { by },
  });
}

/**
 * How this side ends on hearing the other's CLOSE. Its reason and detail are
 * named, never anything the other device wrote: PEER_FAILED carries what
 * failed as `details.reason`. A pause limit is worded by the other side's
 * limit, from its hello.
 */
export function outcomeOfClose(close: CloseWhy, side: Side, peerPauseLimitSeconds = 0): DirectOutcome {
  switch (close.reason) {
    case 'USER_CANCELLED':
      return { state: 'cancelled', by: 'peer' };
    case 'USER_DECLINED':
      return side === 'sender' ? { state: 'cancelled', by: 'peer', declined: true } : { state: 'cancelled', by: 'peer' };
    case 'APP_CLOSED':
      return {
        state: 'failed',
        error: new DropgateError({ code: 'PEER_CLOSED', message: `The ${OTHER[side]} closed Dropgate before the transfer finished.` }),
      };
    case 'PAUSE_LIMIT':
      return { state: 'failed', error: pauseLimitReached(side, 'peer', peerPauseLimitSeconds) };
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

/**
 * A transfer's holds, as one side sees them: its own and the other side's,
 * each its own flag, and the pause limit. A hold by either side counts
 * against both sides' limits from the moment the transfer stopped; the
 * deadline both show is the earlier of the two; this side's own limit,
 * running out, calls `limitReached`. Each new stop counts afresh.
 */
export class Holds {
  self = false;
  peer = false;
  readonly #timers: EngineTimers;
  readonly #ownMs: number;
  readonly #peerMs: number;
  readonly #limitReached: () => void;
  #timer: unknown;
  #deadline: number | null = null;

  /** Limits in seconds, 0 for none: this side's and the other side's, from the two hellos. */
  constructor(timers: EngineTimers, ownLimitSeconds: number, peerLimitSeconds: number, limitReached: () => void) {
    this.#timers = timers;
    this.#ownMs = ownLimitSeconds * 1000;
    this.#peerMs = peerLimitSeconds * 1000;
    this.#limitReached = limitReached;
  }

  get held(): boolean { return this.self || this.peer; }

  get pausedBy(): PausedBy {
    return this.self && this.peer ? 'both' : this.self ? 'self' : this.peer ? 'peer' : null;
  }

  /** When the transfer ends unless both sides resume first, in milliseconds since the epoch; null when not held or no limit is set. */
  get deadline(): number | null { return this.#deadline; }

  /** Sets one side's hold. Whether anything changed. */
  set(who: 'self' | 'peer', held: boolean): boolean {
    if (this[who] === held) return false;
    const was = this.held;
    this[who] = held;
    if (!was && this.held) this.#stopped();
    else if (was && !this.held) this.#running();
    return true;
  }

  /** Every hold let go, and the limit's timer stopped: the transfer has ended, or is past holding. */
  clear(): void {
    this.self = false;
    this.peer = false;
    this.#running();
  }

  #stopped(): void {
    const limits = [this.#ownMs, this.#peerMs].filter((ms) => ms > 0);
    this.#deadline = limits.length > 0 ? Date.now() + Math.min(...limits) : null;
    if (this.#ownMs > 0) this.#timer = this.#timers.setTimeout(() => this.#limitReached(), this.#ownMs);
  }

  #running(): void {
    if (this.#timer !== undefined) this.#timers.clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#deadline = null;
  }
}

/**
 * Watches the writes, closes or reads a side waits on: one that hasn't
 * finished in 30 s shows as stalled (`changed` is called), and in 120 s ends
 * the transfer (`failed`). Stopped while the transfer is held, and counted
 * afresh when it runs again.
 */
export class StallWatch {
  readonly #timers: EngineTimers;
  readonly #changed: () => void;
  readonly #failed: () => void;
  #waiting = 0;
  #held = false;
  #stalled = false;
  #shown: unknown;
  #fail: unknown;
  #stopped = false;

  constructor(timers: EngineTimers, changed: () => void, failed: () => void) {
    this.#timers = timers;
    this.#changed = changed;
    this.#failed = failed;
  }

  /** Whether what the side waits on has taken 30 s or more. */
  get stalled(): boolean { return this.#stalled; }

  /** `work`, watched. */
  async during<T>(work: Promise<T>): Promise<T> {
    this.#waiting += 1;
    if (this.#waiting === 1) this.#start();
    try {
      return await work;
    } finally {
      this.#waiting -= 1;
      if (this.#waiting === 0) this.#clear();
    }
  }

  /** The transfer is held (or runs again): nothing counts as stalled while it's held. */
  hold(held: boolean): void {
    if (this.#held === held) return;
    this.#held = held;
    if (held) this.#clear();
    else if (this.#waiting > 0) this.#start();
  }

  /** The transfer has ended: no timer runs again. */
  stop(): void {
    this.#stopped = true;
    this.#clear();
  }

  #start(): void {
    if (this.#held || this.#stopped) return;
    this.#shown = this.#timers.setTimeout(() => {
      this.#stalled = true;
      this.#changed();
    }, STALL_SHOWN_MS);
    this.#fail = this.#timers.setTimeout(() => this.#failed(), STALL_FAILED_MS);
  }

  #clear(): void {
    if (this.#shown !== undefined) this.#timers.clearTimeout(this.#shown);
    if (this.#fail !== undefined) this.#timers.clearTimeout(this.#fail);
    this.#shown = undefined;
    this.#fail = undefined;
    if (this.#stalled) {
      this.#stalled = false;
      this.#changed();
    }
  }
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

/** RESULT's body, from a RESULT record. */
export function resultBody(m: ResultBody): ResultBody {
  return { commitId: m.commitId, assurance: m.assurance, fileCount: m.fileCount, totalSize: m.totalSize, chain: m.chain };
}
