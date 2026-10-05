import { CancelScope } from './cancel.js';
import { cryptoProvider } from './crypto/provider.js';
import { settle } from './outcome.js';
import type { Outcome } from './outcome.js';
import type { Transport } from './transport.js';

/** What kind of operation a handle is for. */
export type OperationKind = 'hosted.upload' | 'hosted.download';

/**
 * What every operation gives back as it starts: a hosted upload or download,
 * and in later versions a direct send and a direct receive.
 */
export interface OperationHandle<T, S> {
  /**
   * The operation's ID, made on this device when it starts. It's never sent to
   * a server; `client.operations.get(id)` gives this handle back while it runs.
   */
  readonly id: string;
  /** What kind of operation it is, such as `hosted.upload`. */
  readonly kind: OperationKind;
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
 * A new operation ID: a random UUID from the crypto provider, which makes one
 * even on a page served over plain HTTP, where there's no `crypto.randomUUID()`.
 */
export function newOperationId(): string {
  return cryptoProvider().randomUUID();
}

/**
 * Starts an operation under `parent`, with its own node of the cancellation
 * tree. A signal passed in feeds into that node: aborting it cancels the
 * operation, `by: 'signal'`, as the operation's own cancel() would.
 * `finalSnapshot` gives the last snapshot, from the outcome. `onEnd` runs as
 * the operation ends, before its outcome or its last snapshot reaches anyone.
 */
export function startOperation<T, S extends { transport: Transport }>(opts: {
  kind: OperationKind;
  parent: CancelScope;
  signal?: AbortSignal;
  /** How the client reaches its server: in every snapshot, and on the outcome. */
  transport: Transport;
  initial: Omit<S, 'transport'>;
  work: (ctx: OperationContext<S>) => Promise<T>;
  finalSnapshot: (outcome: Outcome<T>, last: S) => S;
  onEnd?: (handle: OperationHandle<T, S>) => void;
}): OperationHandle<T, S> {
  const scope = new CancelScope(opts.kind, { parent: opts.parent, signal: opts.signal });
  const listeners = new Set<(snapshot: S) => void>();
  let snapshot: S = Object.freeze({ ...opts.initial, transport: opts.transport } as S);
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
    // A patch can't change the transport.
    update: (patch) => { if (!ended) publish({ ...snapshot, ...patch, transport: opts.transport }); },
  };

  // The work starts on a later turn, so a caller can subscribe first, and not
  // at all if the operation was cancelled by then.
  const run = async (): Promise<T> => {
    await Promise.resolve();
    scope.throwIfCancelled();
    return opts.work(ctx);
  };
  const result = settle(scope, run, opts.transport).then((outcome) => {
    ended = true;
    try { opts.onEnd?.(handle); } catch { /* Ending can't fail the outcome. */ }
    publish({ ...opts.finalSnapshot(outcome, snapshot), transport: opts.transport });
    listeners.clear();
    return outcome;
  });

  const handle: OperationHandle<T, S> = {
    id: newOperationId(),
    kind: opts.kind,
    result,
    get snapshot() { return snapshot; },
    subscribe(listener) {
      if (ended) return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    cancel() { scope.cancel(); },
  };
  return handle;
}
