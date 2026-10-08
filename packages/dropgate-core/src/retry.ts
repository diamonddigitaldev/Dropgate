import { DropgateError, toDropgateError } from './errors.js';
import { sleep } from './utils/network.js';

// Core retries only what can recover: no answer (the network, or a timeout),
// a 5xx but 507, a 408 or a 429. Everything else the server says fails at once,
// with its code. A retry waits a backoff that doubles, with jitter, up to 30 s,
// or what the server's Retry-After says; and it stops once the server has
// stopped waiting: an upload or a lease with no request for 5 minutes is gone.

/** How long a Dropgate 4 server keeps an upload, or a download's lease, with no request. */
export const QUIET_MS = 5 * 60 * 1000;
/** The longest a retry ever backs off for. */
export const MAX_BACKOFF_MS = 30_000;

/** How an operation retries: `retries` caps how many times (none by default), and the backoff starts at `backoffMs`. */
export interface RetryPolicy {
  retries?: number;
  backoffMs: number;
  maxBackoffMs: number;
}

/** The policy from an operation's `retry` option: until the server's deadline, from 1 s, doubling up to 30 s. */
export function retryPolicy(retry: { retries?: number; backoffMs?: number; maxBackoffMs?: number } = {}): RetryPolicy {
  const whole = (value: number | undefined): value is number => Number.isFinite(value) && value! >= 0;
  return {
    ...(whole(retry.retries) ? { retries: Math.floor(retry.retries) } : {}),
    backoffMs: whole(retry.backoffMs) ? retry.backoffMs : 1000,
    maxBackoffMs: Math.min(whole(retry.maxBackoffMs) ? retry.maxBackoffMs : MAX_BACKOFF_MS, MAX_BACKOFF_MS),
  };
}

/** What a server's Retry-After asked for, by the error its answer became. */
const retryAfter = new WeakMap<DropgateError, number>();

/** Notes the wait a server's answer asked for with Retry-After (in seconds, at most a minute), on the error it became. */
export function withRetryAfter(err: DropgateError, res: Response): DropgateError {
  const header = res.headers.get('Retry-After');
  const seconds = header === null || header.trim() === '' ? NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) retryAfter.set(err, Math.min(seconds, 60) * 1000);
  return err;
}

/**
 * Whether an error could go away if the request were made again: no answer
 * (the server unreachable, the connection lost, a timeout), or an answer of
 * 408, 429 or a 5xx but 507. A cancel never is.
 */
export function isRecoverable(err: unknown): boolean {
  if (!(err instanceof DropgateError) || err.code === 'OPERATION_CANCELLED') return false;
  if (err.status === undefined) return err.code === 'SERVER_UNREACHABLE' || err.code === 'CONNECTION_LOST' || err.code === 'TIMED_OUT';
  return err.status === 408 || err.status === 429 || (err.status >= 500 && err.status !== 507);
}

/**
 * How long the server is still waiting for this operation: until its last
 * `deadline`, or 5 minutes after it last answered, whichever is later, so a
 * clock that's ahead of the server's never cuts the retries short.
 */
export class RetryWindow {
  #end: number;

  constructor() {
    this.#end = Date.now() + QUIET_MS;
  }

  /** The server answered: it waits 5 more minutes, or until the `deadline` it gave, if that's later. */
  heard(deadline?: unknown): void {
    const quiet = Date.now() + QUIET_MS;
    this.#end = typeof deadline === 'number' && Number.isFinite(deadline) ? Math.max(deadline, quiet) : quiet;
  }

  /** When the server stops waiting, in milliseconds since 1970. */
  get end(): number {
    return this.#end;
  }
}

/**
 * The backoff before retry `attempt` (from 1): `backoffMs` doubled for each
 * retry before it, at most `maxBackoffMs`, then a random point in its upper
 * half, so clients that failed together don't all come back together.
 */
export function backoffMs(policy: RetryPolicy, attempt: number, random: (length: number) => Uint8Array): number {
  const full = Math.min(policy.backoffMs * 2 ** Math.min(attempt - 1, 30), policy.maxBackoffMs);
  const [a, b, c, d] = random(4);
  const fraction = (((a << 24) >>> 0) + (b << 16) + (c << 8) + d) / 2 ** 32;
  return Math.round(full / 2 + fraction * (full / 2));
}

export interface RetryRun {
  policy: RetryPolicy;
  window: RetryWindow;
  /** The operation's signal: a cancel is never retried, and ends a wait at once. */
  signal: AbortSignal;
  /** Random bytes, from the crypto provider, for the jitter. */
  random: (length: number) => Uint8Array;
  /** Told how long until the next try, as the wait starts and every 100 ms of it. */
  waiting?: (wait: { attempt: number; remainingMs: number }) => void;
  /** Told as a retry starts. */
  retrying?: (attempt: number) => void;
  /** The error to fail with once the server has stopped waiting, from the last one. */
  expired?: (last: DropgateError) => DropgateError;
}

/**
 * Runs `run` until it succeeds, retrying what can recover (`isRecoverable()`),
 * after each one's backoff or the server's Retry-After, until the server stops
 * waiting (`window`). Anything else fails at once with its own error.
 */
export async function retrying<T>(run: (attempt: number) => Promise<T>, o: RetryRun): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run(attempt);
    } catch (thrown) {
      if (o.signal.aborted) throw o.signal.reason ?? new DropgateError({ code: 'OPERATION_CANCELLED' });
      const err = toDropgateError(thrown);
      if (!isRecoverable(err)) throw err;
      if (o.policy.retries !== undefined && attempt > o.policy.retries) throw err;
      const left = o.window.end - Date.now();
      if (left <= 0) throw o.expired ? o.expired(err) : err;

      // The last wait ends as the server stops waiting, for one try more.
      let remaining = Math.min(retryAfter.get(err) ?? backoffMs(o.policy, attempt, o.random), left);
      while (remaining > 0) {
        o.waiting?.({ attempt, remainingMs: remaining });
        const tick = Math.min(100, remaining);
        await sleep(tick, o.signal);
        remaining -= tick;
      }
      o.retrying?.(attempt);
    }
  }
}
