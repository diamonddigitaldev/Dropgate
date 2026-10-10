import { CancelScope } from './cancel.js';
import type { OperationHandle, OperationKind } from './operation.js';

/** One running operation, as `client.operations.list()` gives it. */
export interface OperationInfo {
  /** The operation's ID, as its handle has it. */
  id: string;
  /** What kind of operation it is, such as `hosted.upload`. */
  kind: OperationKind;
}

/**
 * `client.operations`: what's running on a client, by each operation's ID.
 * An operation is here from the moment it starts until the moment it ends,
 * and nothing about it is kept afterwards: keep its outcome from `result`.
 */
export interface Operations {
  /** The handle of the running operation with this ID, or undefined if none is running with it. */
  get(id: string): OperationHandle<unknown, unknown> | undefined;
  /** What's running now, in the order it started. */
  list(): OperationInfo[];
  /**
   * Cancels every operation running on the client. Each ends with a
   * `cancelled` outcome, `by: 'parent'`, `source: 'client'`. The client stays
   * usable: operations started afterwards run as normal.
   */
  cancelAll(): void;
}

/** The client's side of `client.operations`: the running handles, and the root of the cancellation tree. */
export class OperationRegistry {
  private readonly running = new Map<string, OperationHandle<unknown, unknown>>();
  private root = new CancelScope('client');

  /** What `client.operations` is. */
  readonly api: Operations = Object.freeze({
    get: (id: string) => this.running.get(id),
    list: () => [...this.running.values()].map(({ id, kind }) => ({ id, kind })),
    cancelAll: () => {
      const root = this.root;
      this.root = new CancelScope('client');
      root.cancel();
    },
  });

  /** The node the client's next operation runs under. */
  get scope(): CancelScope {
    return this.root;
  }

  /** Adds a handle as its operation starts. */
  add<T, S>(handle: OperationHandle<T, S>): OperationHandle<T, S> {
    this.running.set(handle.id, handle as OperationHandle<unknown, unknown>);
    return handle;
  }

  /** Takes a handle out as its operation ends. */
  remove(handle: { id: string }): void {
    this.running.delete(handle.id);
  }
}
