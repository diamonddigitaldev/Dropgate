import { DropgateError } from './errors.js';

/**
 * Who paused an operation: this device (`self`), or, for a direct transfer,
 * the other device (`peer`) or both of them. A hosted upload or download is
 * only ever paused by `self`.
 */
export type PausedBy = 'self' | 'peer' | 'both';

/**
 * What pausing asks of an operation's own work, once it has stopped where it
 * can: to tell the server, and later to tell it to go on.
 */
export interface PauseHooks {
  /**
   * Asks the server to hold the operation while it's paused. Gives when the
   * operation ends if it's still paused then (ms since 1970), or null if
   * nothing ends it. Rejects with NOT_FOUND if the server no longer has it.
   */
  pause(): Promise<number | null>;
  /** Asks the server to go on with it. The work goes on once it resolves. */
  resume(): Promise<void>;
  /** The error the operation fails with if it's still paused at its deadline. */
  expired(): DropgateError;
}

/** The fields of a snapshot that pausing changes; `canPause` is given to every snapshot. */
export interface PauseFields {
  status: string;
  text: string;
  pausedBy: PausedBy | null;
  deadline: number | null;
}

type PauseState = 'running' | 'pausing' | 'paused' | 'resuming' | 'ending' | 'ended';

/** Why a step stopped for a pause: never an operation's outcome, since the work catches it. */
const PAUSE_REASON = new DropgateError({ code: 'OPERATION_CANCELLED', message: 'Paused.' });

const unavailable = (message: string) => new DropgateError({ code: 'PAUSE_UNAVAILABLE', message });

/**
 * One operation's pause and resume. The operation's handle calls `pause()` and
 * `resume()`; its work says when it can pause (`allow()`), gives each step
 * that a pause should stop `signal`, and stops at a `checkpoint()` between
 * steps. A pause stops the step under way, waits for the work to reach its
 * checkpoint, then asks the server to hold it; a resume asks the server to go
 * on, then lets the work go on from there. Nothing resumes by itself: at the
 * deadline the server gave, a paused operation fails. What a pause holds is
 * the work's own state, in memory.
 */
export class PauseControl {
  #state: PauseState = 'running';
  #hooks: PauseHooks | null = null;
  #allowed = false;
  #turnedOff = false;
  readonly #operation: AbortSignal;
  readonly #update: (patch: Partial<PauseFields>) => void;
  readonly #snapshot: () => PauseFields;
  #segment = new AbortController();
  #unlink: () => void = () => { };
  /** Told when the work has stopped at its checkpoint. */
  #stopped: (() => void) | null = null;
  /** The work waiting at its checkpoint: lets it go on, or fails it. */
  #waiting: { go(): void; fail(err: unknown): void } | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #deadline: number | null = null;
  /** The status and text the operation goes back to when it goes on. */
  #status = '';
  #text = '';
  /** Pauses and resumes still settling, rejected if the operation ends first. */
  readonly #pending = new Set<(err: unknown) => void>();

  constructor(operation: AbortSignal, update: (patch: Partial<PauseFields>) => void, snapshot: () => PauseFields) {
    this.#operation = operation;
    this.#update = update;
    this.#snapshot = snapshot;
    this.#newSegment();
  }

  /**
   * Whether the operation can pause now, and how: with `hooks` once the server
   * has taken it, and `null` once it's finishing. The next snapshot says so.
   */
  allow(hooks: PauseHooks | null): void {
    if (hooks) this.#hooks = hooks;
    this.#allowed = hooks !== null;
  }

  /** What every snapshot's `canPause` is: whether `pause()` can be called now. Paused, pausing again renews the deadline. */
  get canPause(): boolean {
    return this.#state === 'paused' || (this.#state === 'running' && this.#allowed);
  }

  /** The server has pausing turned off, so a pause is refused with CAPABILITY_UNSUPPORTED. */
  turnedOff(): void {
    this.#turnedOff = true;
    this.allow(null);
  }

  /** Aborts when a pause stops the work, or the operation is cancelled: each step a pause should stop uses it. */
  get signal(): AbortSignal {
    return this.#segment.signal;
  }

  /** Whether `signal` aborted for a pause, and not a cancel: the work then goes to its checkpoint. */
  get interrupted(): boolean {
    return this.#segment.signal.aborted && this.#state !== 'running' && !this.#operation.aborted;
  }

  /**
   * Where the work can stop, between steps. While running, it goes on at once
   * and gives false. Paused, it waits until the operation goes on, then gives
   * true; it rejects if the operation is cancelled, or a pause ends it.
   */
  async checkpoint(): Promise<boolean> {
    if (this.#state === 'running' || this.#state === 'ended') return false;
    const operation = this.#operation;
    if (operation.aborted) throw operation.reason;
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(operation.reason);
      operation.addEventListener('abort', onAbort, { once: true });
      this.#waiting = {
        go: () => { operation.removeEventListener('abort', onAbort); resolve(); },
        fail: (err) => { operation.removeEventListener('abort', onAbort); reject(err); },
      };
      this.#stopped?.();
    }).finally(() => { this.#waiting = null; });
    return true;
  }

  /**
   * Pauses: stops the step under way, waits for the work to stop, and asks the
   * server to hold it. Paused already, it asks again, which renews the
   * server's deadline from now. If the server refuses, nothing changes; if it
   * no longer has the operation, the operation fails.
   */
  async pause(): Promise<void> {
    if (this.#state === 'paused') return this.#pauseAgain();
    if (this.#state !== 'running' || !this.#allowed || !this.#hooks) {
      if (this.#turnedOff && this.#state === 'running') {
        throw new DropgateError({ code: 'CAPABILITY_UNSUPPORTED', message: 'Pausing is turned off on this server.', details: { capability: 'pause' } });
      }
      throw unavailable(this.#state === 'ended' ? 'It has ended, so it can\'t be paused.' : 'It can\'t be paused now.');
    }
    const hooks = this.#hooks;
    this.#state = 'pausing';
    ({ status: this.#status, text: this.#text } = this.#snapshot());
    this.#update({ text: 'Pausing...' });
    const stopped = new Promise<void>((resolve) => { this.#stopped = resolve; });
    this.#segment.abort(PAUSE_REASON);
    try {
      await this.#untilEnded(stopped);
      this.#stopped = null;
      this.#paused(await this.#untilEnded(hooks.pause()));
    } catch (err) {
      this.#stopped = null;
      if (this.#ending(err)) throw err;
      this.#run();
      throw err;
    }
  }

  /**
   * Resumes: asks the server to go on, then lets the work go on. If the server
   * no longer has it, the operation fails; if it can't be asked, it stays paused.
   */
  async resume(): Promise<void> {
    if (this.#state !== 'paused' || !this.#hooks) {
      throw unavailable(this.#state === 'ended' ? 'It has ended, so it can\'t be resumed.' : 'It isn\'t paused.');
    }
    const hooks = this.#hooks;
    const deadline = this.#deadline;
    this.#state = 'resuming';
    this.#disarm();
    this.#update({ text: 'Resuming...' });
    try {
      await this.#untilEnded(hooks.resume());
    } catch (err) {
      if (this.#ending(err)) throw err;
      this.#paused(deadline);
      throw err;
    }
    this.#run();
  }

  /**
   * A new deadline for a pause already made, as the server said (null for
   * none): for a lease shared with downloads that go on, or stop.
   */
  extend(deadline: number | null): void {
    if (this.#state !== 'paused') return;
    this.#deadline = deadline;
    this.#update({ deadline });
    this.#arm();
  }

  /** The operation has ended: nothing more pauses, and a pause or resume still settling rejects with `reason`. */
  end(reason: unknown): void {
    this.#state = 'ended';
    this.#disarm();
    this.#unlink();
    for (const reject of [...this.#pending]) reject(reason);
    this.#pending.clear();
  }

  async #pauseAgain(): Promise<void> {
    const hooks = this.#hooks!;
    const deadline = this.#deadline;
    this.#state = 'pausing';
    this.#disarm();
    this.#update({});
    try {
      this.#paused(await this.#untilEnded(hooks.pause()));
    } catch (err) {
      if (this.#ending(err)) throw err;
      this.#paused(deadline);
      throw err;
    }
  }

  /**
   * Whether an error from the server, or a cancel, ends the operation: a
   * cancel, or the server no longer having it (NOT_FOUND), which the
   * operation then fails with.
   */
  #ending(err: unknown): boolean {
    if (this.#state === 'ended' || this.#operation.aborted) return true;
    if (!DropgateError.is(err, 'NOT_FOUND')) return false;
    this.#state = 'ending';
    this.#disarm();
    this.#waiting?.fail(err);
    return true;
  }

  #paused(deadline: number | null): void {
    this.#state = 'paused';
    this.#deadline = deadline;
    this.#update({ status: 'paused', pausedBy: 'self', deadline, text: 'Paused.' });
    this.#arm();
  }

  /** Back to running: a new segment for the steps from here, and the work goes on. */
  #run(): void {
    this.#state = 'running';
    this.#deadline = null;
    this.#newSegment();
    this.#update({ status: this.#status, text: this.#text, pausedBy: null, deadline: null });
    this.#waiting?.go();
  }

  /** At the deadline, a paused operation fails: the server no longer holds it, and nothing resumes by itself. */
  #arm(): void {
    this.#disarm();
    const deadline = this.#deadline;
    if (deadline === null) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (this.#state !== 'paused') return;
      this.#state = 'ending';
      this.#waiting?.fail(this.#hooks!.expired());
    }, Math.max(0, deadline - Date.now()));
  }

  #disarm(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #newSegment(): void {
    this.#unlink();
    const segment = new AbortController();
    const operation = this.#operation;
    const onAbort = () => segment.abort(operation.reason);
    if (operation.aborted) segment.abort(operation.reason);
    else operation.addEventListener('abort', onAbort, { once: true });
    this.#segment = segment;
    this.#unlink = () => operation.removeEventListener('abort', onAbort);
  }

  /** `promise`, or a rejection if the operation ends first. */
  #untilEnded<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.#pending.add(reject);
      promise.then(resolve, reject).finally(() => this.#pending.delete(reject));
    });
  }
}
