// Fakes for a direct transfer's secure channel (src/dgdtp/channel.ts): an
// ordered in-memory pipe, a mock rendezvous that routes each attempt's pipe
// between the two sides and records everything sent to it, and a pair of fake
// peer connections with fake SDP whose data channel is another in-memory pipe.
// No WebRTC and no server. Nothing here uses Node, so the browser check runs
// the same code.
import type {
  IceCandidate, IncomingAttempt, MessagePipe, PeerConnection, ReceiverRendezvous, SenderRendezvous, SessionDescription,
} from '../../src/dgdtp/channel.js';
import { hex } from './cpace-vectors.js';

export type Side = 'receiver' | 'sender';

/** What a relay does with one message on its way: the messages to deliver in its place (none drops it). */
export type Relay = (from: Side, message: Uint8Array) => Uint8Array[] | Promise<Uint8Array[]>;

class PipeEnd implements MessagePipe {
  readonly #queue: Uint8Array[] = [];
  readonly #waiting: Array<{ resolve: (m: Uint8Array) => void; reject: (err: Error) => void }> = [];
  #closed = false;
  #remoteClosed = false;
  readonly #send: (message: Uint8Array) => void;
  readonly #closeBoth: () => void;

  constructor(send: (message: Uint8Array) => void, closeBoth: () => void) {
    this.#send = send;
    this.#closeBoth = closeBoth;
  }

  send(message: Uint8Array): void {
    if (this.#closed) return;
    this.#send(new Uint8Array(message));
  }

  receive(): Promise<Uint8Array> {
    if (this.#queue.length > 0) return Promise.resolve(this.#queue.shift() as Uint8Array);
    if (this.#closed || this.#remoteClosed) return Promise.reject(new Error('The pipe is closed.'));
    return new Promise((resolve, reject) => this.#waiting.push({ resolve, reject }));
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#queue.length = 0;
    for (const w of this.#waiting.splice(0)) w.reject(new Error('The pipe is closed.'));
    this.#closeBoth();
  }

  get closed(): boolean { return this.#closed; }

  /** @internal */ deliver(message: Uint8Array): void {
    if (this.#closed) return;
    const waiter = this.#waiting.shift();
    if (waiter) waiter.resolve(message);
    else this.#queue.push(message);
  }

  /** @internal The other end closed: what it sent first is still taken, then receive() rejects. */ remoteClose(): void {
    this.#remoteClosed = true;
    for (const w of this.#waiting.splice(0)) w.reject(new Error('The pipe is closed.'));
  }
}

/** One pipe between the two sides: each side's end, and what each side sent (copies), in order. */
export interface PipePair {
  receiver: MessagePipe;
  sender: MessagePipe;
  /** Every message each side sent, as it sent it, before any relay. */
  sent: Record<Side, Uint8Array[]>;
}

/** An ordered pipe; `relay`, if given, sees each message on its way, in order each way. */
export function pipePair(relay?: Relay): PipePair {
  const sent: Record<Side, Uint8Array[]> = { receiver: [], sender: [] };
  const chain: Record<Side, Promise<unknown>> = { receiver: Promise.resolve(), sender: Promise.resolve() };
  // eslint-disable-next-line prefer-const
  let ends: Record<Side, PipeEnd>;
  const other = (side: Side): Side => (side === 'receiver' ? 'sender' : 'receiver');
  const sendFrom = (side: Side) => (message: Uint8Array) => {
    sent[side].push(new Uint8Array(message));
    chain[side] = chain[side].then(async () => {
      const out = relay ? await relay(side, new Uint8Array(message)) : [message];
      for (const m of out) ends[other(side)].deliver(new Uint8Array(m));
    }).catch(() => undefined);
  };
  // A close reaches the other end after everything the closing side sent first.
  const closeFrom = (side: Side) => () => {
    chain[side] = chain[side].then(() => ends[other(side)].remoteClose());
  };
  ends = {
    receiver: new PipeEnd(sendFrom('receiver'), closeFrom('receiver')),
    sender: new PipeEnd(sendFrom('sender'), closeFrom('sender')),
  };
  return { receiver: ends.receiver, sender: ends.sender, sent };
}

/** One request a side made of the rendezvous, as bytes, for checking what left each device. */
export interface RendezvousRecord {
  from: Side;
  what: 'create' | 'join' | 'message';
  bytes: Uint8Array;
}

/**
 * A rendezvous in memory: rooms by room ID and by locator, one pipe for each
 * join, and a record of every byte either side sent it.
 */
export class MockRendezvous {
  readonly records: RendezvousRecord[] = [];
  readonly pipes: PipePair[] = [];
  readonly #rooms = new Map<string, { roomNonce: Uint8Array; incoming: IncomingAttempt[]; waiting: Array<(a: IncomingAttempt) => void> }>();
  /** The locator the next room with a code gets. */
  locator = 'AB';
  /** A relay on every attempt's pipe, given which pipe it is (0 for the first join). */
  relay?: (pipe: number) => Relay | undefined;

  readonly sender: SenderRendezvous = {
    create: async ({ roomId, roomNonce, code }) => {
      this.records.push({ from: 'sender', what: 'create', bytes: concat(roomId, roomNonce, Uint8Array.of(code ? 1 : 0)) });
      const room = { roomNonce: new Uint8Array(roomNonce), incoming: [], waiting: [] };
      this.#rooms.set(`id:${hex(roomId)}`, room);
      if (!code) return {};
      this.#rooms.set(`code:${this.locator}`, room);
      return { locator: this.locator };
    },
  };

  readonly receiver: ReceiverRendezvous = {
    join: async (by) => {
      const key = 'roomId' in by ? `id:${hex(by.roomId)}` : `code:${by.locator}`;
      const bytes = 'roomId' in by ? new Uint8Array(by.roomId) : new TextEncoder().encode(by.locator);
      this.records.push({ from: 'receiver', what: 'join', bytes });
      const room = this.#rooms.get(key);
      if (!room) throw new Error('No such room.');
      const n = this.pipes.length;
      const pair = this.#recorded(pipePair(this.relay?.(n)));
      this.pipes.push(pair);
      const attempt: IncomingAttempt = { by: 'roomId' in by ? 'link' : 'code', pipe: pair.sender };
      const waiter = room.waiting.shift();
      if (waiter) waiter(attempt);
      else room.incoming.push(attempt);
      return { roomNonce: new Uint8Array(room.roomNonce), pipe: pair.receiver };
    },
  };

  /** The next attempt to reach the room whose code or room ID is `key` (`id:<hex>` or `code:<locator>`), or the only room's. */
  nextAttempt(key?: string): Promise<IncomingAttempt> {
    const room = key ? this.#rooms.get(key) : [...this.#rooms.values()][0];
    if (!room) return Promise.reject(new Error('No such room.'));
    const ready = room.incoming.shift();
    if (ready) return Promise.resolve(ready);
    return new Promise((resolve) => room.waiting.push(resolve));
  }

  /** A pipe pair whose every send is recorded as a message to the rendezvous. */
  #recorded(pair: PipePair): PipePair {
    const wrap = (side: Side, end: MessagePipe): MessagePipe => ({
      send: (message) => {
        this.records.push({ from: side, what: 'message', bytes: new Uint8Array(message) });
        end.send(message);
      },
      receive: () => end.receive(),
      close: () => end.close(),
    });
    return { receiver: wrap('receiver', pair.receiver), sender: wrap('sender', pair.sender), sent: pair.sent };
  }
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
};

const randomHex = (bytes: number) => hex(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));

/** `fingerprint` as SDP writes it: upper-case hex pairs, colon-separated. */
export const fingerprintText = (fingerprint: Uint8Array) => hex(fingerprint).toUpperCase().match(/../g)?.join(':') ?? '';

/** A fake SDP for one data channel, with one SHA-256 fingerprint line. */
export function fakeSdp(type: 'offer' | 'answer', fingerprint: Uint8Array, ufrag: string): string {
  return [
    'v=0', `o=- ${Date.now()} 2 IN IP4 127.0.0.1`, 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
    `a=ice-ufrag:${ufrag}`, `a=ice-pwd:${randomHex(12)}`, 'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${fingerprintText(fingerprint)}`,
    `a=setup:${type === 'offer' ? 'actpass' : 'active'}`, 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144', '',
  ].join('\r\n');
}

/** A fake peer connection: fake SDP with its own certificate's fingerprint, two host candidates, then the end of them. */
export class FakePeer implements PeerConnection {
  readonly role: Side;
  readonly fingerprint = globalThis.crypto.getRandomValues(new Uint8Array(32));
  readonly ufrag = randomHex(4);
  local: SessionDescription | undefined;
  remote: SessionDescription | undefined;
  readonly remoteCandidates: Array<IceCandidate | null> = [];
  closed = false;
  /** The SDP this peer makes, if a test fixes it. */
  sdp: string | undefined;
  /** Whether to refuse the first candidate it's given, as a peer connection does one it can't use. */
  refuseFirstCandidate = false;
  #listener: ((candidate: IceCandidate | null) => void) | undefined;
  readonly #pair: PeerPair;

  constructor(role: Side, pair: PeerPair) {
    this.role = role;
    this.#pair = pair;
  }

  async createOffer(): Promise<string> {
    if (this.role !== 'receiver') throw new Error('Only the receiver offers.');
    return this.sdp ?? fakeSdp('offer', this.fingerprint, this.ufrag);
  }

  async createAnswer(): Promise<string> {
    if (this.role !== 'sender' || !this.remote) throw new Error('An answer follows an offer.');
    return this.sdp ?? fakeSdp('answer', this.fingerprint, this.ufrag);
  }

  async setLocalDescription(description: SessionDescription): Promise<void> {
    this.local = { ...description };
    // Candidates come as ICE finds them: the first as soon as it can (before
    // this call's caller carries on), the rest later.
    const n = this.role === 'receiver' ? 1 : 2;
    queueMicrotask(() => {
      this.#listener?.({ candidate: `candidate:1 1 udp 2122260223 192.0.2.${n} 5000${n} typ host generation 0 ufrag ${this.ufrag}`, sdpMid: '0', sdpMLineIndex: 0, usernameFragment: this.ufrag });
    });
    setTimeout(() => {
      this.#listener?.({ candidate: `candidate:2 1 udp 2122194687 2001:db8::${n} 5100${n} typ host generation 0 ufrag ${this.ufrag}`, sdpMid: '0', sdpMLineIndex: 0, usernameFragment: this.ufrag });
      this.#listener?.(null);
    }, 0);
    this.#pair.check();
  }

  async setRemoteDescription(description: SessionDescription): Promise<void> {
    this.remote = { ...description };
    this.#pair.check();
  }

  async addIceCandidate(candidate: IceCandidate | null): Promise<void> {
    // As WebRTC: a candidate before the remote description is an error.
    if (!this.remote) throw new Error('No remote description yet.');
    if (candidate !== null && this.refuseFirstCandidate) {
      this.refuseFirstCandidate = false;
      throw new Error("That candidate can't be used.");
    }
    this.remoteCandidates.push(candidate);
    this.#pair.check();
  }

  onIceCandidate(listener: (candidate: IceCandidate | null) => void): void {
    this.#listener = listener;
  }

  dataChannel(): Promise<MessagePipe> {
    return this.#pair.dataChannel(this.role);
  }

  close(): void {
    this.closed = true;
    this.#pair.closed(this.role);
  }

  /** Whether ICE could connect from this side: both descriptions, and a candidate from the other side. */
  get ready(): boolean {
    return !!this.local && !!this.remote && this.remoteCandidates.some((c) => c !== null);
  }
}

/** Two fake peer connections whose data channel opens once each side has both descriptions and a candidate. */
export class PeerPair {
  readonly receiver: FakePeer;
  readonly sender: FakePeer;
  /** The data channel's pipe, once open: what each side sent on it. */
  data: PipePair | undefined;
  readonly #relay: Relay | undefined;
  readonly #opened: Record<Side, { promise: Promise<MessagePipe>; resolve: (pipe: MessagePipe) => void; reject: (err: Error) => void }>;

  constructor(options: { dataRelay?: Relay } = {}) {
    this.#relay = options.dataRelay;
    const deferred = () => {
      let resolve!: (pipe: MessagePipe) => void;
      let reject!: (err: Error) => void;
      const promise = new Promise<MessagePipe>((res, rej) => { resolve = res; reject = rej; });
      promise.catch(() => undefined);
      return { promise, resolve, reject };
    };
    this.#opened = { receiver: deferred(), sender: deferred() };
    this.receiver = new FakePeer('receiver', this);
    this.sender = new FakePeer('sender', this);
  }

  /** @internal */ check(): void {
    if (this.data || !this.receiver.ready || !this.sender.ready || this.receiver.closed || this.sender.closed) return;
    this.data = pipePair(this.#relay);
    this.#opened.receiver.resolve(this.data.receiver);
    this.#opened.sender.resolve(this.data.sender);
  }

  /** @internal */ dataChannel(side: Side): Promise<MessagePipe> {
    return this.#opened[side].promise;
  }

  /** @internal */ closed(side: Side): void {
    this.#opened[side].reject(new Error('The peer connection is closed.'));
    if (side === 'receiver') this.data?.receiver.close();
    else this.data?.sender.close();
  }
}
