import { DropgateError } from '../errors.js';
import type { DataChannelPipe, IceCandidate, PeerConnection, SessionDescription } from './channel.js';

// A W3C RTCPeerConnection as the secure channel's peer connection (channel.ts):
// the global one in browsers and Electron, or one passed in for Node (werift's
// or node-datachannel's). It gives SDP as strings, trickles ICE candidates as
// they're found, and opens one data channel as the channel's MessagePipe.
//
//   - The receiver makes the one data channel, `dgdtp/4`, ordered and fully
//     reliable (no partial reliability), before its offer; the sender takes
//     the first channel of that name the receiver opens, and closes any other.
//   - Messages are bytes: binaryType 'arraybuffer', each message copied as it
//     arrives. Anything else (text) is passed on as an empty message, which
//     every reader refuses as a fault: a DGDTP peer only ever sends bytes.
//   - The largest message the channel sends is the peer connection's
//     max-message-size (RTCSctpTransport.maxMessageSize, or RFC 8841's 65,536
//     when it doesn't say); the secure channel cuts its records to it.
//   - writable() resolves once the channel's buffer is at or under 256 KiB:
//     on bufferedamountlow, and by looking every 10 ms while it waits, since
//     some implementations (werift) never fire the event.
//   - ICE failing, the connection failing or closing, or the data channel
//     closing ends the pipe: CONNECTION_LOST. Recovery isn't built yet.
//
// Nothing here logs, and no error carries anything from the SDP or a candidate.

/** The one data channel's label. */
export const DATA_CHANNEL_LABEL = 'dgdtp/4';

/** writable() resolves once the data channel's buffer is at or under this many bytes. */
export const LOW_WATER_BYTES = 256 * 1024;

/** How often writable() looks at the buffer while it waits. */
export const WRITABLE_POLL_MS = 10;

/** RFC 8841's max-message-size for a peer connection that doesn't give one. */
const DEFAULT_MAX_MESSAGE_SIZE = 65536;

const lost = () => new DropgateError({ code: 'CONNECTION_LOST' });

/** An ICE server, as RTCConfiguration takes it. */
export interface RtcIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

interface RtcEventTarget {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

/** What this needs of an RTCDataChannel. */
export interface RtcDataChannelLike extends RtcEventTarget {
  readonly label: string;
  readonly ordered?: boolean;
  readonly readyState: string;
  readonly bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  binaryType?: string;
  send(data: Uint8Array): void;
  close(): void;
}

/** What this needs of an RTCPeerConnection. */
export interface RtcPeerConnectionLike extends RtcEventTarget {
  readonly iceConnectionState: string;
  readonly connectionState?: string;
  readonly sctp?: { readonly maxMessageSize: number } | null;
  createDataChannel(label: string, options: { ordered: boolean }): RtcDataChannelLike;
  createOffer(): Promise<{ sdp?: string | null }>;
  createAnswer(): Promise<{ sdp?: string | null }>;
  setLocalDescription(description: SessionDescription): Promise<unknown>;
  setRemoteDescription(description: SessionDescription): Promise<unknown>;
  addIceCandidate(candidate?: IceCandidate): Promise<unknown>;
  close(): unknown;
}

/** An RTCPeerConnection class: the global one, or a Node library's. */
export type RtcPeerConnectionClass = new (configuration: { iceServers: RtcIceServer[] }) => RtcPeerConnectionLike;

export interface WebRtcPeerOptions {
  RTCPeerConnection: RtcPeerConnectionClass;
  /** The receiver makes the offer and the data channel; the sender answers. */
  role: 'receiver' | 'sender';
  /** The ICE servers to use (STUN): none if not given. */
  iceServers?: readonly RtcIceServer[];
}

/** A deferred value: its promise, and how to settle it. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

/** A message from the data channel as bytes of its own: text, or anything else, as an empty message. */
function bytesOf(data: unknown): Uint8Array<ArrayBuffer> {
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  if (ArrayBuffer.isView(data)) return new Uint8Array(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  return new Uint8Array(0);
}

/** The data channel, open, as a pipe of whole messages in order. */
class DataPipe implements DataChannelPipe {
  readonly maxMessageBytes: number;
  readonly #channel: RtcDataChannelLike;
  readonly #queue: Uint8Array[] = [];
  readonly #readers: Array<{ resolve: (message: Uint8Array) => void; reject: (err: unknown) => void }> = [];
  readonly #writers: Array<{ resolve: () => void; reject: (err: unknown) => void }> = [];
  #poll: ReturnType<typeof setInterval> | undefined;
  /** Closed by this side: nothing more is taken. */
  #closed = false;
  /** Gone underneath: what came first is still taken. */
  #gone = false;
  readonly #onMessage = (event: unknown) => this.#deliver((event as { data?: unknown } | undefined)?.data);
  readonly #onLow = () => this.#checkWritable();

  constructor(channel: RtcDataChannelLike, maxMessageBytes: number) {
    this.#channel = channel;
    this.maxMessageBytes = maxMessageBytes;
    channel.addEventListener('message', this.#onMessage);
  }

  send(message: Uint8Array): void {
    if (this.#closed || this.#gone || this.#channel.readyState !== 'open') throw lost();
    if (message.byteLength > this.maxMessageBytes) {
      throw new DropgateError({ code: 'INVALID_ARGUMENT', message: `The data channel takes at most ${this.maxMessageBytes} bytes a message.` });
    }
    try {
      this.#channel.send(message);
    } catch {
      this.gone();
      throw lost();
    }
  }

  receive(): Promise<Uint8Array> {
    if (this.#queue.length > 0) return Promise.resolve(this.#queue.shift() as Uint8Array);
    if (this.#closed || this.#gone) return Promise.reject(lost());
    return new Promise((resolve, reject) => this.#readers.push({ resolve, reject }));
  }

  writable(): Promise<void> {
    if (this.#closed || this.#gone) return Promise.reject(lost());
    if (this.#channel.bufferedAmount <= LOW_WATER_BYTES) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.#writers.push({ resolve, reject });
      if (this.#writers.length === 1) {
        this.#channel.addEventListener('bufferedamountlow', this.#onLow);
        this.#poll = setInterval(this.#onLow, WRITABLE_POLL_MS);
      }
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#queue.length = 0;
    this.#stop();
    try {
      this.#channel.close();
    } catch {
      // Closed already.
    }
  }

  /** The channel or the connection went: what came first is still taken, then receive() and writable() reject. */
  gone(): void {
    if (this.#gone) return;
    this.#gone = true;
    this.#stop();
  }

  #deliver(data: unknown): void {
    const message = bytesOf(data);
    const reader = this.#readers.shift();
    if (reader) reader.resolve(message);
    else this.#queue.push(message);
  }

  #checkWritable(): void {
    if (this.#channel.bufferedAmount > LOW_WATER_BYTES) return;
    this.#stopWaiting();
    for (const writer of this.#writers.splice(0)) writer.resolve();
  }

  #stopWaiting(): void {
    if (this.#poll !== undefined) clearInterval(this.#poll);
    this.#poll = undefined;
    this.#channel.removeEventListener('bufferedamountlow', this.#onLow);
  }

  /** Every waiter told the pipe has ended, and the channel's listeners removed. */
  #stop(): void {
    this.#stopWaiting();
    for (const reader of this.#readers.splice(0)) reader.reject(lost());
    for (const writer of this.#writers.splice(0)) writer.reject(lost());
    this.#channel.removeEventListener('message', this.#onMessage);
  }
}

/** An RTCPeerConnection with one data channel, as channel.ts' PeerConnection. */
class WebRtcPeer implements PeerConnection {
  readonly #pc: RtcPeerConnectionLike;
  readonly #opened = deferred<DataChannelPipe>();
  #channel: RtcDataChannelLike | undefined;
  #pipe: DataPipe | undefined;
  #listener: ((candidate: IceCandidate | null) => void) | undefined;
  readonly #early: Array<IceCandidate | null> = [];
  #ended = false;

  constructor(options: WebRtcPeerOptions) {
    const { RTCPeerConnection: PeerConnectionClass, role } = options;
    const iceServers = (options.iceServers ?? []).map((server) => ({ ...server }));
    const pc = new PeerConnectionClass({ iceServers });
    this.#pc = pc;
    pc.addEventListener('icecandidate', (event) => this.#candidate((event as { candidate?: unknown } | undefined)?.candidate));
    pc.addEventListener('iceconnectionstatechange', () => this.#state());
    pc.addEventListener('connectionstatechange', () => this.#state());
    if (role === 'receiver') {
      this.#take(pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true }));
    } else {
      pc.addEventListener('datachannel', (event) => {
        const channel = (event as { channel?: RtcDataChannelLike } | undefined)?.channel;
        if (!channel) return;
        if (this.#channel || channel.label !== DATA_CHANNEL_LABEL || channel.ordered === false) {
          // Only the one ordered dgdtp/4 channel is used.
          try {
            channel.close();
          } catch {
            // Gone already.
          }
          return;
        }
        this.#take(channel);
      });
    }
  }

  async createOffer(): Promise<string> {
    return sdpOf(await this.#pc.createOffer());
  }

  async createAnswer(): Promise<string> {
    return sdpOf(await this.#pc.createAnswer());
  }

  async setLocalDescription(description: SessionDescription): Promise<void> {
    await this.#pc.setLocalDescription(description);
  }

  async setRemoteDescription(description: SessionDescription): Promise<void> {
    await this.#pc.setRemoteDescription(description);
  }

  async addIceCandidate(candidate: IceCandidate | null): Promise<void> {
    if (candidate === null) {
      // The end of the other side's candidates.
      await this.#pc.addIceCandidate();
      return;
    }
    const { candidate: line, sdpMid, sdpMLineIndex, usernameFragment } = candidate;
    await this.#pc.addIceCandidate({ candidate: line, sdpMid, sdpMLineIndex, usernameFragment });
  }

  onIceCandidate(listener: (candidate: IceCandidate | null) => void): void {
    this.#listener = listener;
    for (const candidate of this.#early.splice(0)) listener(candidate);
  }

  dataChannel(): Promise<DataChannelPipe> {
    return this.#opened.promise;
  }

  close(): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#opened.reject(lost());
    if (this.#pipe) {
      // The pipe closes its channel.
      this.#pipe.close();
    } else {
      try {
        this.#channel?.close();
      } catch {
        // Closed already.
      }
    }
    try {
      Promise.resolve(this.#pc.close()).catch(() => undefined);
    } catch {
      // Closed already.
    }
  }

  /** A local candidate as ICE finds it: the end of them is null (or undefined); an empty one, a section's end, is skipped. */
  #candidate(value: unknown): void {
    if (this.#ended) return;
    let candidate: IceCandidate | null = null;
    if (value) {
      const c = value as Partial<IceCandidate>;
      if (typeof c.candidate !== 'string' || c.candidate === '') return;
      candidate = {
        candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null, usernameFragment: c.usernameFragment ?? null,
      };
    }
    if (this.#listener) this.#listener(candidate);
    else this.#early.push(candidate);
  }

  /** The one data channel: bytes, the low-water mark set, and the pipe made once it opens. */
  #take(channel: RtcDataChannelLike): void {
    this.#channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = LOW_WATER_BYTES;
    const open = () => {
      if (this.#ended || this.#pipe) return;
      this.#pipe = new DataPipe(channel, this.#maxMessageBytes());
      this.#opened.resolve(this.#pipe);
    };
    channel.addEventListener('open', open);
    channel.addEventListener('close', () => this.#lost());
    if (channel.readyState === 'open') open();
  }

  /** The largest message the data channel sends: the SCTP transport's max-message-size, or RFC 8841's default. */
  #maxMessageBytes(): number {
    const size = this.#pc.sctp?.maxMessageSize;
    return typeof size === 'number' ? size : DEFAULT_MAX_MESSAGE_SIZE;
  }

  /** ICE or the connection failed or closed: the data channel, open or not, is lost. */
  #state(): void {
    const ice = this.#pc.iceConnectionState;
    const connection = this.#pc.connectionState;
    if (ice === 'failed' || ice === 'closed' || connection === 'failed' || connection === 'closed') this.#lost();
  }

  #lost(): void {
    this.#opened.reject(lost());
    this.#pipe?.gone();
  }
}

/** A description's SDP. */
function sdpOf(description: { sdp?: string | null } | undefined): string {
  const sdp = description?.sdp;
  if (typeof sdp !== 'string') throw new DropgateError({ code: 'UNEXPECTED_ERROR', message: 'The peer connection made no SDP.' });
  return sdp;
}

/**
 * A W3C RTCPeerConnection, made from `options.RTCPeerConnection` with the ICE
 * servers given (none by default), as the secure channel's peer connection.
 * RUNTIME_UNSUPPORTED if there's no RTCPeerConnection to make.
 */
export function webRtcPeer(options: WebRtcPeerOptions): PeerConnection {
  if (typeof options?.RTCPeerConnection !== 'function') {
    throw new DropgateError({ code: 'RUNTIME_UNSUPPORTED', message: 'A direct transfer needs WebRTC (RTCPeerConnection).' });
  }
  if (options.role !== 'receiver' && options.role !== 'sender') {
    throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'A peer connection is the receiver\'s or the sender\'s.' });
  }
  return new WebRtcPeer(options);
}
