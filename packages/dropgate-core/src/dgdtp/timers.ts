// The direct transfer's clock and its timers: the set-up's, the offer's, the
// connection's liveness, stalls and the end's waits. Every one runs on a
// monotonic clock (`performance.now()`), never the wall clock, and every
// one can be given a test's clock instead.

/** A clock and its timers: the global ones, or a test's. */
export interface EngineTimers {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  /** Milliseconds on a monotonic clock: only differences between two readings mean anything. */
  now(): number;
}

const monotonic = (): number => (typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now());

export const GLOBAL_TIMERS: EngineTimers = Object.freeze({
  setTimeout: (run: () => void, ms: number) => globalThis.setTimeout(run, ms),
  clearTimeout: (id: unknown) => globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>),
  now: monotonic,
});

/** The secure handshake (Noise and BIND, once the data channel is open), each attempt. */
export const HANDSHAKE_TIMEOUT_MS = 15000;
/** ICE: an attempt's data channel open, from the attempt's start. */
export const ICE_TIMEOUT_MS = 30000;
/** The whole set-up: the rendezvous, a code's exchange, ICE and the handshake, each attempt. */
export const SETUP_TIMEOUT_MS = 90000;
/** An offer waiting for its receiver to accept or decline. */
export const OFFER_TIMEOUT_MS = 600000;
/** A side that has sent nothing for this long sends a PING. */
export const PING_INTERVAL_MS = 5000;
/** Nothing heard from the other side for max(this, `NO_ANSWER_RTTS` × the smoothed round trip) ends the connection. */
export const MIN_NO_ANSWER_MS = 15000;
/** Round trips (smoothed, from PING and PONG) without a word from the other side before the connection is lost. */
export const NO_ANSWER_RTTS = 6;
/** No data arriving for this long while credit is given: the receiver sends a STATUS ask. */
export const NO_PROGRESS_MS = 30000;
/** A write, close or read that hasn't finished in this long shows as stalled. */
export const STALL_SHOWN_MS = 30000;
/** A write, close or read that hasn't finished in this long ends the transfer. */
export const STALL_FAILED_MS = 120000;
/** How long a side that sent a CLOSE waits for CLOSE_ACK before closing anyway. */
export const CLOSE_ACK_WAIT_MS = 2000;
/** How long a side whose data channel has gone listens for the other side's CLOSE through the rendezvous. */
export const LATE_CLOSE_WAIT_MS = 2000;

/** A timer that's re-armed rather than restarted: `due()` gives when it should run next, or undefined to stop. */
export class Deadline {
  readonly #timers: EngineTimers;
  readonly #due: () => number | undefined;
  readonly #run: () => void;
  #id: unknown;
  #at: number | undefined;

  constructor(timers: EngineTimers, due: () => number | undefined, run: () => void) {
    this.#timers = timers;
    this.#due = due;
    this.#run = run;
  }

  /** Arms the timer for `due()`, unless it's already armed for then or sooner. */
  arm(): void {
    const at = this.#due();
    if (at === undefined) {
      this.stop();
      return;
    }
    if (this.#at !== undefined && this.#at <= at) return;
    this.stop();
    this.#at = at;
    this.#id = this.#timers.setTimeout(() => this.#fire(), Math.max(0, at - this.#timers.now()));
  }

  stop(): void {
    if (this.#at !== undefined) this.#timers.clearTimeout(this.#id);
    this.#at = undefined;
    this.#id = undefined;
  }

  #fire(): void {
    this.#at = undefined;
    this.#id = undefined;
    const at = this.#due();
    if (at === undefined) return;
    // Moved on since it was armed: armed again for the new time.
    if (at > this.#timers.now()) {
      this.arm();
      return;
    }
    this.#run();
  }
}
