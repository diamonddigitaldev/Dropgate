import { CancelScope } from './cancel.js';
import { cryptoProvider } from './crypto/provider.js';
import { DropgateError, withTransport } from './errors.js';
import { settle } from './outcome.js';
import { PauseControl } from './pause.js';
import type { PausedBy } from './pause.js';
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
  /** Cancels the operation: its outcome is then `cancelled`, `by: 'self'`. Does nothing once it has ended. Paused, it's cancelled too. */
  cancel(): void;
  /**
   * Pauses the operation, where `snapshot.canPause` says it can. Resolves once
   * it's paused: a hosted one once the server has said how long it holds it,
   * which `snapshot.deadline` then gives, with `status: 'paused'`. Paused
   * already, it asks the server again, which renews that deadline from now.
   * Nothing resumes by itself: still paused at its deadline, the operation
   * fails. If the server refuses the pause, nothing changes.
   * @throws {DropgateError} (rejects) PAUSE_UNAVAILABLE if it can't pause now; CAPABILITY_UNSUPPORTED
   * if the server has pausing turned off; NOT_FOUND if the server no longer has it (the operation
   * fails too); or the request's error.
   */
  pause(): Promise<void>;
  /**
   * Resumes a paused operation, from where it stopped. Resolves once the
   * server has said it goes on, and it's running again.
   * @throws {DropgateError} (rejects) PAUSE_UNAVAILABLE if it isn't paused; NOT_FOUND if the server
   * no longer has it (the operation fails too); or the request's error, and it stays paused.
   */
  resume(): Promise<void>;
}

/** What an operation's work is given. */
export interface OperationContext<S> {
  /** The operation's node of the cancellation tree. */
  readonly scope: CancelScope;
  /** Aborts when the operation is cancelled, however it's cancelled. Every request it makes uses this. */
  readonly signal: AbortSignal;
  /** Merges `patch` into the snapshot, and tells the subscribers. */
  update(patch: Partial<S>): void;
  /** The operation's pause and resume: the work says when it can pause, and stops for one at its checkpoints. */
  readonly pausing: PauseControl;
}

/** The fields every operation's snapshot has. */
export interface OperationSnapshot {
  status: string;
  text: string;
  canPause: boolean;
  pausedBy: PausedBy | null;
  deadline: number | null;
  transport: Transport;
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
export function startOperation<T, S extends OperationSnapshot>(opts: {
  kind: OperationKind;
  parent: CancelScope;
  signal?: AbortSignal;
  /** How the client reaches its server: in every snapshot, and on the outcome. */
  transport: Transport;
  initial: Omit<S, 'transport' | 'canPause' | 'pausedBy' | 'deadline'>;
  work: (ctx: OperationContext<S>) => Promise<T>;
  finalSnapshot: (outcome: Outcome<T>, last: S) => S;
  onEnd?: (handle: OperationHandle<T, S>) => void;
}): OperationHandle<T, S> {
  const scope = new CancelScope(opts.kind, { parent: opts.parent, signal: opts.signal });
  const listeners = new Set<(snapshot: S) => void>();
  // Nothing can pause until its work says it can.
  const idle = { canPause: false, pausedBy: null, deadline: null };
  let snapshot: S = Object.freeze({ ...opts.initial, ...idle, transport: opts.transport } as unknown as S);
  let ended = false;

  const publish = (next: S): void => {
    snapshot = Object.freeze(next);
    for (const listener of [...listeners]) {
      try { listener(snapshot); } catch { /* A listener's error is its own. */ }
    }
  };

  // A patch can't change the transport, and every snapshot says whether it can pause now.
  const update = (patch: Partial<S>): void => {
    if (!ended) publish({ ...snapshot, ...patch, canPause: pausing.canPause, transport: opts.transport });
  };
  const pausing: PauseControl = new PauseControl(scope.signal, (patch) => update(patch as Partial<S>), () => snapshot);
  const ctx: OperationContext<S> = { scope, signal: scope.signal, update, pausing };

  // The work starts on a later turn, so a caller can subscribe first, and not
  // at all if the operation was cancelled by then.
  const run = async (): Promise<T> => {
    await Promise.resolve();
    scope.throwIfCancelled();
    return opts.work(ctx);
  };
  const result = settle(scope, run, opts.transport).then((outcome) => {
    ended = true;
    // A pause or resume still settling is refused: the operation has ended.
    pausing.end(withTransport(outcome.status === 'failed'
      ? outcome.error
      : new DropgateError({ code: outcome.status === 'cancelled' ? 'OPERATION_CANCELLED' : 'PAUSE_UNAVAILABLE', message: 'It has ended.' }), opts.transport));
    try { opts.onEnd?.(handle); } catch { /* Ending can't fail the outcome. */ }
    publish({ ...opts.finalSnapshot(outcome, snapshot), ...idle, transport: opts.transport });
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
    pause: () => pausing.pause().catch((err: unknown) => { throw withTransport(err, opts.transport); }),
    resume: () => pausing.resume().catch((err: unknown) => { throw withTransport(err, opts.transport); }),
  };
  return handle;
}
