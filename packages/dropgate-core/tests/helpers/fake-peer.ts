/**
 * Test doubles for the PeerJS objects the P2P code is given. No network and no
 * PeerJS server: the test plays the remote peer by calling the `simulate*` and
 * `deliver` methods, and reads what the code sent from `sent`.
 */

type Listener = (...args: unknown[]) => unknown;

class Emitter {
  private readonly listeners = new Map<string, Listener[]>();

  on(event: string, callback: Listener): void {
    const list = this.listeners.get(event) ?? [];
    list.push(callback);
    this.listeners.set(event, list);
  }

  protected emit(event: string, ...args: unknown[]): unknown[] {
    return (this.listeners.get(event) ?? []).map((callback) => callback(...args));
  }
}

export class FakeConnection extends Emitter {
  /** Everything the code under test sent, in order. */
  readonly sent: unknown[] = [];
  open = false;

  constructor(readonly peer: string) {
    super();
  }

  send(data: unknown): void {
    if (!this.open) throw new Error('Connection is not open.');
    this.sent.push(data);
  }

  close(): void {
    this.open = false;
  }

  /** The data channel opens, as PeerJS reports once WebRTC connects. */
  simulateOpen(): void {
    this.open = true;
    this.emit('open');
  }

  /** The connection drops with no goodbye message, as when the network goes. */
  simulateClose(): void {
    this.open = false;
    this.emit('close');
  }

  /** The remote peer sends `data`. Resolves once the code's handlers finish. */
  async deliver(data: unknown): Promise<void> {
    await Promise.all(this.emit('data', data));
  }

  /** Control messages the code sent with the given `t`. */
  sentOfType(type: string): Array<Record<string, unknown>> {
    return this.sent.filter(
      (msg): msg is Record<string, unknown> =>
        typeof msg === 'object' && msg !== null && (msg as { t?: unknown }).t === type
    );
  }
}

export class FakePeer extends Emitter {
  /** Every peer created since the last `reset()`, oldest first. */
  static instances: FakePeer[] = [];

  readonly connections: FakeConnection[] = [];
  destroyed = false;

  constructor(readonly id?: string, readonly options?: unknown) {
    super();
    FakePeer.instances.push(this);
  }

  static reset(): void {
    FakePeer.instances = [];
  }

  static latest(): FakePeer {
    const peer = FakePeer.instances[FakePeer.instances.length - 1];
    if (!peer) throw new Error('No FakePeer has been created.');
    return peer;
  }

  connect(peerId: string): FakeConnection {
    const conn = new FakeConnection(peerId);
    this.connections.push(conn);
    return conn;
  }

  destroy(): void {
    this.destroyed = true;
  }

  /** The signalling server accepts the peer. */
  simulateOpen(id = 'fake-peer-id'): void {
    this.emit('open', id);
  }
}
