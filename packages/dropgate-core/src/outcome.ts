import { withTransport } from './errors.js';
import type { DropgateError } from './errors.js';
import type { CancelScope, Cancellation } from './cancel.js';
import type { Transport } from './transport.js';

/** The operation finished, and `value` is what it gave. */
export interface CompletedOutcome<T> {
  status: 'completed';
  value: T;
  /** How the client reached its server. */
  transport: Transport;
}

/** The operation was cancelled before it finished. `cancellation` says who cancelled it. */
export interface CancelledOutcome {
  status: 'cancelled';
  cancellation: Cancellation;
  /** How the client reached its server. */
  transport: Transport;
}

/** The operation stopped on an error. */
export interface FailedOutcome {
  status: 'failed';
  error: DropgateError;
  /** How the client reached its server. */
  transport: Transport;
}

/**
 * How an operation ended. Every operation ends with exactly one, and an
 * operation's promise of it never rejects.
 */
export type Outcome<T> = CompletedOutcome<T> | CancelledOutcome | FailedOutcome;

/**
 * Runs an operation's work under its node of the cancellation tree, and gives
 * its one outcome. Work that ends after a cancel, however it ends, was
 * cancelled; work that returns finished, even if a cancel came too late to
 * stop it. The node leaves the tree once the outcome is known.
 */
export async function settle<T>(scope: CancelScope, work: () => Promise<T>, transport: Transport): Promise<Outcome<T>> {
  try {
    const value = await work();
    return { status: 'completed', value, transport };
  } catch (err) {
    const cancellation: Cancellation | null = scope.cancellation;
    if (cancellation) return { status: 'cancelled', cancellation, transport };
    return { status: 'failed', error: withTransport(err, transport), transport };
  } finally {
    scope.finish();
  }
}
