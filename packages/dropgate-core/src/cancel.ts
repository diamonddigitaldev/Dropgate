import { DropgateError } from './errors.js';

/**
 * Who cancelled an operation, as the operation sees it:
 * - `self`: its own `cancel()`;
 * - `parent`: what it runs under was cancelled, such as the whole
 *   client, by `client.operations.cancelAll()`;
 * - `signal`: an AbortSignal passed in with it was aborted.
 */
export type CancelledBy = 'self' | 'parent' | 'signal';

export interface Cancellation {
  by: CancelledBy;
  /** What was cancelled first: the operation itself, or the one it runs under, such as `client`. */
  source: string;
}

/**
 * One node of the cancellation tree. Each operation has one, under the
 * client's, and the steps it starts can have their own under it. Cancelling a
 * node cancels every node under it, once; nothing above it.
 */
export class CancelScope {
  readonly label: string;
  private readonly controller = new AbortController();
  private readonly children = new Set<CancelScope>();
  private readonly listeners = new Set<(cancellation: Cancellation) => void>();
  private parent: CancelScope | null = null;
  private detachSignal: (() => void) | null = null;
  private _cancellation: Cancellation | null = null;
  private done = false;

  constructor(label: string, opts: { parent?: CancelScope; signal?: AbortSignal } = {}) {
    this.label = label;
    const { parent, signal } = opts;
    if (parent) {
      if (parent._cancellation) {
        this.settle({ by: 'parent', source: parent._cancellation.source });
        return;
      }
      this.parent = parent;
      parent.children.add(this);
    }
    if (signal) {
      if (signal.aborted) {
        this.settle({ by: 'signal', source: label });
        return;
      }
      const onAbort = () => this.settle({ by: 'signal', source: label });
      signal.addEventListener('abort', onAbort, { once: true });
      this.detachSignal = () => signal.removeEventListener('abort', onAbort);
    }
  }

  /** Aborts when this node is cancelled, with an OPERATION_CANCELLED DropgateError as its reason. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** How it was cancelled, or null while it hasn't been. */
  get cancellation(): Cancellation | null {
    return this._cancellation;
  }

  /** A new node under this one. */
  child(label: string): CancelScope {
    return new CancelScope(label, { parent: this });
  }

  /** Cancels this node and everything under it. Returns false if it was already cancelled or done. */
  cancel(): boolean {
    if (this._cancellation || this.done) return false;
    this.settle({ by: 'self', source: this.label });
    return true;
  }

  /** Runs `listener` once, when this node is cancelled. Returns a function that removes it. */
  onCancel(listener: (cancellation: Cancellation) => void): () => void {
    if (this._cancellation) {
      listener(this._cancellation);
      return () => {};
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Throws its OPERATION_CANCELLED error if this node has been cancelled. */
  throwIfCancelled(): void {
    if (this._cancellation) throw this.controller.signal.reason;
  }

  /**
   * Takes this node out of the tree, once its operation has ended: a later
   * cancel above it no longer reaches it, and its own cancel() does nothing.
   */
  finish(): void {
    if (this.done) return;
    this.done = true;
    this.parent?.children.delete(this);
    this.parent = null;
    this.detachSignal?.();
    this.detachSignal = null;
    this.listeners.clear();
  }

  private settle(cancellation: Cancellation): void {
    if (this._cancellation || this.done) return;
    this._cancellation = cancellation;
    this.detachSignal?.();
    this.detachSignal = null;
    this.parent?.children.delete(this);
    this.parent = null;
    this.controller.abort(new DropgateError({ code: 'OPERATION_CANCELLED', details: { cancellation } }));
    const listeners = [...this.listeners];
    this.listeners.clear();
    for (const listener of listeners) {
      try { listener(cancellation); } catch { /* A listener's error is its own. */ }
    }
    const children = [...this.children];
    this.children.clear();
    for (const child of children) child.settle({ by: 'parent', source: cancellation.source });
  }
}
