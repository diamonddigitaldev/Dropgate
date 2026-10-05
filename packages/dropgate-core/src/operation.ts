import { CancelScope } from './cancel.js';
import { settle } from './outcome.js';
import type { Outcome } from './outcome.js';

/**
 * What every operation gives back as it starts: an upload, and in later
 * versions a download, a direct send and a direct receive.
 */
export interface OperationHandle<T, S> {
  /** The operation's one outcome. It never rejects. */
  readonly result: Promise<Outcome<T>>;
  /** Where the operation is now. A new object each time it changes, never changed in place. */
  readonly snapshot: S;
  /**
   * Runs `listener` with each new snapshot, until the operation has ended:
   * the last call is the snapshot with its outcome's status. Read `snapshot`
   * for where it is when you subscribe. Returns a function that unsubscribes.
   */
  subscribe(listener: (snapshot: S) => void): () => void;
  /** Cancels the operation: its outcome is then `cancelled`, `by: 'self'`. Does nothing once it has ended. */
  cancel(): void;
}

/** What an operation's work is given. */
export interface OperationContext<S> {
  /** The operation's node of the cancellation tree. */
  readonly scope: CancelScope;
  /** Aborts when the operation is cancelled, however it's cancelled. Every request it makes uses this. */
  readonly signal: AbortSignal;
  /** Merges `patch` into the snapshot, and tells the subscribers. */
  update(patch: Partial<S>): void;
}

/**
 * Starts an operation under `parent`, with its own node of the cancellation
 * tree. A signal passed in feeds into that node: aborting it cancels the
 * operation, `by: 'signal'`, as the operation's own cancel() would.
 * `finalSnapshot` gives the last snapshot, from the outcome.
 */
export function startOperation<T, S extends object>(opts: {
  label: string;
  parent: CancelScope;
  signal?: AbortSignal;
  initial: S;
  work: (ctx: OperationContext<S>) => Promise<T>;
  finalSnapshot: (outcome: Outcome<T>, last: S) => S;
}): OperationHandle<T, S> {
  const scope = new CancelScope(opts.label, { parent: opts.parent, signal: opts.signal });
  const listeners = new Set<(snapshot: S) => void>();
  let snapshot: S = Object.freeze({ ...opts.initial });
  let ended = false;

  const publish = (next: S): void => {
    snapshot = Object.freeze(next);
    for (const listener of [...listeners]) {
      try { listener(snapshot); } catch { /* A listener's error is its own. */ }
    }
  };

  const ctx: OperationContext<S> = {
    scope,
    signal: scope.signal,
    update: (patch) => { if (!ended) publish({ ...snapshot, ...patch }); },
  };

  // The work starts on a later turn, so a caller can subscribe first, and not
  // at all if the operation was cancelled by then.
  const run = async (): Promise<T> => {
    await Promise.resolve();
    scope.throwIfCancelled();
    return opts.work(ctx);
  };
  const result = settle(scope, run).then((outcome) => {
    ended = true;
    publish(opts.finalSnapshot(outcome, snapshot));
    listeners.clear();
    return outcome;
  });

  return {
    result,
    get snapshot() { return snapshot; },
    subscribe(listener) {
      if (ended) return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    cancel() { scope.cancel(); },
  };
}
