import { DropgateError } from '../errors.js';
import { PROTOCOLS, checkProtocol, type ProtocolVersion } from '../version.js';
import type { IncomingAttempt, MessagePipe, ReceiverRendezvous, RoomNews, SenderRendezvous } from './channel.js';
import { CODE_LETTERS } from './codes.js';
import { CPACE_ROOM_NONCE_BYTES } from './cpace.js';
import { ROOM_ID_BYTES } from './keys.js';
import { MAX_FRAME_BYTES } from './seal.js';

// The client for a Dropgate server's rendezvous: where a direct transfer's
// two devices find each other and pass the sealed frames that set up their
// connection, which the server relays without reading.
//
// One WebSocket at /api/v4/rendezvous per room (the sender's) and per attempt
// (each receiver's), carrying short binary messages: a type byte, then fixed
// fields, big-endian. The DGDTP major goes in plain as a room is created or
// joined, so a server of another major says so before anything else.
//
//   - The sender's socket opens its room (CREATE) under the room ID its link's
//     secret makes, asking for a code when it wants one and the server gives
//     them. Each receiver's attempt reaches it under a one-byte tag (ATTEMPT),
//     which carries that attempt's frames both ways (SEND, FRAME) until either
//     side ends it (DROP, GONE).
//   - Codes: an unused code is renewed every 4 minutes, or the server releases
//     it after 10. After any attempt by code, right or wrong, the sender asks
//     for a new code at once (CODE), so its screen never shows a code someone
//     has tried; while none is free it asks again every 15 seconds, until one
//     comes or a receiver is accepted. Then the room is locked (LOCK): no new
//     attempt by link or code, and every other attempt dropped.
//   - Each receiver's attempt joins by the room ID (a link) or by the locator
//     (a code's first letters, the only part of a code that leaves the
//     device), and gets the room's nonce.
//
// Errors are core's, worded for direct transfers: a server of another major is
// VERSION_UNSUPPORTED saying which side needs updating; no such room or code
// NOT_FOUND; a room already taken REQUEST_REJECTED; anything the server sends
// that isn't one of its messages INVALID_RESPONSE; a socket that never opens
// SERVER_UNREACHABLE, and one that closes before its answer CONNECTION_LOST.
// Nothing here logs, and no error holds a room ID, nonce, locator or frame.

/** The rendezvous's one path on a server. Nothing about a room is ever in its address. */
export const RENDEZVOUS_PATH = '/api/v4/rendezvous';
/** How often the sender renews its unused code: the server releases one after 10 minutes. */
export const RENEW_INTERVAL_MS = 4 * 60_000;
/** How often the sender asks again for a code while none is free. */
export const CODE_RETRY_MS = 15_000;

/** The messages' type bytes. */
export const RENDEZVOUS_TYPE = Object.freeze({
  CREATE: 0x01,
  CODE: 0x02,
  RENEW: 0x03,
  SEND: 0x04,
  DROP: 0x05,
  LOCK: 0x06,
  CREATED: 0x81,
  CODE_IS: 0x82,
  ATTEMPT: 0x83,
  FRAME_TO_SENDER: 0x84,
  GONE_TO_SENDER: 0x85,
  CODE_GONE: 0x86,
  JOIN: 0x11,
  RECEIVER_SEND: 0x12,
  JOINED: 0x91,
  FRAME_TO_RECEIVER: 0x92,
  GONE_TO_RECEIVER: 0x93,
  ERROR: 0xff,
});

/** ERROR's codes. */
export const RENDEZVOUS_ERROR = Object.freeze({
  VERSION_UNSUPPORTED: 1,
  NOT_FOUND: 2,
  BUSY: 3,
  MALFORMED: 4,
  LIMIT: 5,
  AUTH_REQUIRED: 6,
  AUTH_EXPIRED: 7,
  AUTH_DENIED: 8,
});

/** The longest credential CREATE carries, in ASCII bytes. */
const MAX_CREDENTIAL_BYTES = 8192;
/** A credential: RFC 6750's token68. */
const TOKEN68 = /^[A-Za-z0-9\-._~+/]+=*$/;
/** A normal close of the socket. */
const CLOSE_NORMAL = 1000;

const BY = Object.freeze({ link: 1, code: 2 });

/** What this needs of a WebSocket: the global one in browsers, Electron and Node 22+. */
export interface WebSocketLike {
  binaryType: string;
  readonly readyState: number;
  send(data: Uint8Array): void;
  close(code?: number): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
}

export type WebSocketClass = new (url: string) => WebSocketLike;

/** Timers the sender's renewing and asking run on: the global ones, or a test's. */
export interface RendezvousTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const GLOBAL_TIMERS: RendezvousTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface RendezvousOptions {
  /** The rendezvous's address: `rendezvousUrl()` of the server's. */
  url: string;
  /** `/api/info`'s `capabilities.p2p.codeLetters`: 2 or 3, or 0 when the server gives no codes. */
  codeLetters: number;
  /** The WebSocket class: the global one if not given. */
  WebSocket?: WebSocketClass;
  /** The DGDTP version to say: core's. */
  version?: ProtocolVersion;
  /** The sender's credential, when the server asks for one: an RFC 6750 token68. */
  credential?: string;
  /** For tests. */
  timers?: RendezvousTimers;
}

/** The rendezvous's address on a server: `wss:` on HTTPS, `ws:` on plain HTTP (which `allowInsecure` governs). */
export function rendezvousUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw invalid('A server address is http: or https:.');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${RENDEZVOUS_PATH}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

const invalid = (message: string) => new DropgateError({ code: 'INVALID_ARGUMENT', message });
const invalidResponse = () => new DropgateError({ code: 'INVALID_RESPONSE' });
const lost = () => new DropgateError({ code: 'CONNECTION_LOST' });
const unreachable = () => new DropgateError({ code: 'SERVER_UNREACHABLE' });

// ---------------------------------------------------------------------------
// The messages, as bytes.

const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

function bytesOf(...parts: Array<number | Uint8Array>): Uint8Array<ArrayBuffer> {
  const length = parts.reduce<number>((n, p) => n + (typeof p === 'number' ? 1 : p.byteLength), 0);
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    if (typeof part === 'number') out[at++] = part;
    else {
      out.set(part, at);
      at += part.byteLength;
    }
  }
  return out;
}

function checkVersion(version: ProtocolVersion): void {
  for (const n of [version?.major, version?.minor]) {
    if (!Number.isInteger(n) || (n as number) < 0 || (n as number) > 255) throw invalid('A protocol version is two numbers, 0 to 255.');
  }
}

function checkFrame(frame: unknown): asserts frame is Uint8Array {
  if (!(frame instanceof Uint8Array) || frame.byteLength > MAX_FRAME_BYTES) throw invalid(`A frame is at most ${MAX_FRAME_BYTES} bytes.`);
}

function checkTag(tag: unknown): asserts tag is number {
  if (!Number.isInteger(tag) || (tag as number) < 1 || (tag as number) > 255) throw invalid('A tag is 1 to 255.');
}

function checkCredential(credential: unknown): asserts credential is string {
  if (typeof credential !== 'string' || credential.length > MAX_CREDENTIAL_BYTES || (credential !== '' && !TOKEN68.test(credential))) {
    throw invalid('A credential is an RFC 6750 token68 of at most 8,192 characters.');
  }
}

/** A locator: 2 or 3 of the code's letters. */
const isLocator = (value: unknown): value is string =>
  typeof value === 'string' && (value.length === 2 || value.length === 3) && [...value].every((c) => CODE_LETTERS.includes(c));

/** The messages a client sends. */
export const rendezvousMessage = Object.freeze({
  /** CREATE: major ‖ minor ‖ roomId (16) ‖ roomNonce (16) ‖ flags (bit 0 a code wanted) ‖ credential length (2) ‖ credential. */
  create(options: { version: ProtocolVersion; roomId: Uint8Array; roomNonce: Uint8Array; code: boolean; credential?: string }): Uint8Array<ArrayBuffer> {
    const { version, roomId, roomNonce, code, credential = '' } = options;
    checkVersion(version);
    if (!(roomId instanceof Uint8Array) || roomId.byteLength !== ROOM_ID_BYTES) throw invalid(`A room ID is ${ROOM_ID_BYTES} bytes.`);
    if (!(roomNonce instanceof Uint8Array) || roomNonce.byteLength !== CPACE_ROOM_NONCE_BYTES) throw invalid(`A room nonce is ${CPACE_ROOM_NONCE_BYTES} bytes.`);
    checkCredential(credential);
    const length = Uint8Array.of(credential.length >> 8, credential.length & 0xff);
    return bytesOf(RENDEZVOUS_TYPE.CREATE, version.major, version.minor, roomId, roomNonce, code ? 1 : 0, length, ascii(credential));
  },
  /** JOIN: major ‖ minor ‖ by (1 room ID, 2 locator) ‖ roomId (16), or locator length (1) ‖ locator. */
  join(options: { version: ProtocolVersion } & ({ roomId: Uint8Array } | { locator: string })): Uint8Array<ArrayBuffer> {
    const { version } = options;
    checkVersion(version);
    if ('roomId' in options) {
      if (!(options.roomId instanceof Uint8Array) || options.roomId.byteLength !== ROOM_ID_BYTES) throw invalid(`A room ID is ${ROOM_ID_BYTES} bytes.`);
      return bytesOf(RENDEZVOUS_TYPE.JOIN, version.major, version.minor, BY.link, options.roomId);
    }
    if (!isLocator(options.locator)) throw invalid("A locator is 2 or 3 of a code's letters.");
    return bytesOf(RENDEZVOUS_TYPE.JOIN, version.major, version.minor, BY.code, options.locator.length, ascii(options.locator));
  },
  code: () => bytesOf(RENDEZVOUS_TYPE.CODE),
  renew: () => bytesOf(RENDEZVOUS_TYPE.RENEW),
  lock: () => bytesOf(RENDEZVOUS_TYPE.LOCK),
  /** The sender's SEND: tag ‖ frame. */
  send(tag: number, frame: Uint8Array): Uint8Array<ArrayBuffer> {
    checkTag(tag);
    checkFrame(frame);
    return bytesOf(RENDEZVOUS_TYPE.SEND, tag, frame);
  },
  drop(tag: number): Uint8Array<ArrayBuffer> {
    checkTag(tag);
    return bytesOf(RENDEZVOUS_TYPE.DROP, tag);
  },
  /** A receiver's SEND: frame. */
  receiverSend(frame: Uint8Array): Uint8Array<ArrayBuffer> {
    checkFrame(frame);
    return bytesOf(RENDEZVOUS_TYPE.RECEIVER_SEND, frame);
  },
});

/** A message from the server, read. */
export type ServerMessage =
  | { type: 'created' | 'code-is'; locator: string | null }
  | { type: 'attempt'; tag: number; by: 'link' | 'code' }
  | { type: 'frame'; tag: number; frame: Uint8Array<ArrayBuffer> }
  | { type: 'gone'; tag: number }
  | { type: 'code-gone' }
  | { type: 'joined'; roomNonce: Uint8Array<ArrayBuffer> }
  | { type: 'frame'; frame: Uint8Array<ArrayBuffer> }
  | { type: 'gone' }
  | { type: 'error'; code: number; server?: ProtocolVersion };

/**
 * A message the server sent to a sender's socket or a receiver's, read:
 * INVALID_RESPONSE if it isn't one of the messages that socket is sent, at
 * its exact length.
 */
export function readServerMessage(bytes: Uint8Array, to: 'sender' | 'receiver'): ServerMessage {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) throw invalidResponse();
  const type = bytes[0];
  const length = bytes.byteLength;
  const fixed = (n: number) => {
    if (length !== n) throw invalidResponse();
  };
  if (type === RENDEZVOUS_TYPE.ERROR) {
    if (length < 2) throw invalidResponse();
    const code = bytes[1];
    if (code === RENDEZVOUS_ERROR.VERSION_UNSUPPORTED) {
      fixed(4);
      return { type: 'error', code, server: Object.freeze({ major: bytes[2], minor: bytes[3] }) };
    }
    fixed(2);
    return { type: 'error', code };
  }
  if (to === 'sender') {
    switch (type) {
      case RENDEZVOUS_TYPE.CREATED:
      case RENDEZVOUS_TYPE.CODE_IS: {
        if (length < 2) throw invalidResponse();
        fixed(2 + bytes[1]);
        const locator = String.fromCharCode(...bytes.subarray(2));
        if (locator !== '' && !isLocator(locator)) throw invalidResponse();
        return { type: type === RENDEZVOUS_TYPE.CREATED ? 'created' : 'code-is', locator: locator || null };
      }
      case RENDEZVOUS_TYPE.ATTEMPT: {
        fixed(3);
        if (bytes[1] === 0) throw invalidResponse();
        const by = bytes[2] === BY.link ? 'link' : bytes[2] === BY.code ? 'code' : undefined;
        if (!by) throw invalidResponse();
        return { type: 'attempt', tag: bytes[1], by };
      }
      case RENDEZVOUS_TYPE.FRAME_TO_SENDER:
        if (length < 2 || length > 2 + MAX_FRAME_BYTES || bytes[1] === 0) throw invalidResponse();
        return { type: 'frame', tag: bytes[1], frame: bytes.slice(2) };
      case RENDEZVOUS_TYPE.GONE_TO_SENDER:
        fixed(2);
        if (bytes[1] === 0) throw invalidResponse();
        return { type: 'gone', tag: bytes[1] };
      case RENDEZVOUS_TYPE.CODE_GONE:
        fixed(1);
        return { type: 'code-gone' };
      default:
        throw invalidResponse();
    }
  }
  switch (type) {
    case RENDEZVOUS_TYPE.JOINED:
      fixed(1 + CPACE_ROOM_NONCE_BYTES);
      return { type: 'joined', roomNonce: bytes.slice(1) };
    case RENDEZVOUS_TYPE.FRAME_TO_RECEIVER:
      if (length > 1 + MAX_FRAME_BYTES) throw invalidResponse();
      return { type: 'frame', frame: bytes.slice(1) };
    case RENDEZVOUS_TYPE.GONE_TO_RECEIVER:
      fixed(1);
      return { type: 'gone' };
    default:
      throw invalidResponse();
  }
}

/** The error a server's ERROR means, worded for a direct transfer. */
export function rendezvousError(code: number, server?: ProtocolVersion, version: ProtocolVersion = PROTOCOLS.dgdtp): DropgateError {
  switch (code) {
    case RENDEZVOUS_ERROR.VERSION_UNSUPPORTED: {
      const check = checkProtocol(version, server);
      // A server that refuses its own major isn't saying anything that makes sense.
      if (check.compatible) return invalidResponse();
      return new DropgateError({
        code: 'VERSION_UNSUPPORTED',
        message: check.message,
        details: { component: 'dgdtp', update: check.update, client: check.client, server: check.server },
      });
    }
    case RENDEZVOUS_ERROR.NOT_FOUND:
      return new DropgateError({ code: 'NOT_FOUND', message: 'No transfer has that code or link. It may have ended, or the code was used.' });
    case RENDEZVOUS_ERROR.BUSY:
      return new DropgateError({ code: 'REQUEST_REJECTED', message: 'This transfer is already going to someone else.' });
    case RENDEZVOUS_ERROR.AUTH_REQUIRED:
      return new DropgateError({ code: 'AUTH_REQUIRED' });
    case RENDEZVOUS_ERROR.AUTH_EXPIRED:
      return new DropgateError({ code: 'AUTH_EXPIRED' });
    case RENDEZVOUS_ERROR.AUTH_DENIED:
      return new DropgateError({ code: 'AUTH_DENIED' });
    default:
      // MALFORMED and LIMIT: the server found this client's messages wrong; or a code this version doesn't know.
      return invalidResponse();
  }
}

// ---------------------------------------------------------------------------
// A socket, and a pipe over it.

/** A WebSocket to the rendezvous: opened, its messages handed on as bytes in order, and how it ended. */
class Socket {
  readonly #ws: WebSocketLike;
  #open = false;
  #ended = false;
  readonly opened: Promise<void>;
  #onOpenFailed!: (err: DropgateError) => void;

  constructor(options: { url: string; WebSocket?: WebSocketClass }, onMessage: (bytes: Uint8Array) => void, onEnd: () => void) {
    const WebSocketImpl = options.WebSocket ?? (globalThis as { WebSocket?: WebSocketClass }).WebSocket;
    if (typeof WebSocketImpl !== 'function') {
      throw new DropgateError({ code: 'RUNTIME_UNSUPPORTED', message: 'A direct transfer needs WebSocket.' });
    }
    let ws: WebSocketLike;
    try {
      ws = new WebSocketImpl(options.url);
    } catch {
      throw unreachable();
    }
    this.#ws = ws;
    ws.binaryType = 'arraybuffer';
    this.opened = new Promise<void>((resolve, reject) => {
      this.#onOpenFailed = reject;
      ws.addEventListener('open', () => {
        if (this.#ended) return;
        this.#open = true;
        resolve();
      });
    });
    this.opened.catch(() => undefined);
    ws.addEventListener('message', (event) => {
      if (this.#ended) return;
      const data = (event as { data?: unknown } | undefined)?.data;
      // A text message isn't one of the rendezvous's: an empty one is refused as not a message.
      onMessage(data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data)
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(0));
    });
    ws.addEventListener('close', () => {
      if (this.#ended) return;
      this.#ended = true;
      // A socket that never opened: the server couldn't be reached.
      this.#onOpenFailed(unreachable());
      onEnd();
    });
    // An error is followed by close.
    ws.addEventListener('error', () => undefined);
  }

  /** Whether it opened and hasn't ended. */
  get live(): boolean { return this.#open && !this.#ended; }

  send(bytes: Uint8Array): void {
    if (!this.live) return;
    try {
      this.#ws.send(bytes);
    } catch {
      this.close();
    }
  }

  /** Closes it, once; what it was sent afterwards is ignored. */
  close(): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#onOpenFailed(lost());
    try {
      this.#ws.close(CLOSE_NORMAL);
    } catch {
      // Closed already.
    }
  }
}

/** One attempt's frames, both ways, as the secure channel's MessagePipe. */
class FramePipe implements MessagePipe {
  readonly #send: (frame: Uint8Array) => void;
  readonly #onClose: () => void;
  readonly #queue: Uint8Array[] = [];
  readonly #readers: Array<{ resolve: (frame: Uint8Array) => void; reject: (err: unknown) => void }> = [];
  #closed = false;
  #ended: DropgateError | undefined;

  constructor(send: (frame: Uint8Array) => void, onClose: () => void) {
    this.#send = send;
    this.#onClose = onClose;
  }

  send(message: Uint8Array): void {
    checkFrame(message);
    if (this.#closed || this.#ended) return;
    this.#send(message);
  }

  receive(): Promise<Uint8Array> {
    if (this.#queue.length > 0) return Promise.resolve(this.#queue.shift() as Uint8Array);
    if (this.#closed) return Promise.reject(lost());
    if (this.#ended) return Promise.reject(this.#ended);
    return new Promise((resolve, reject) => this.#readers.push({ resolve, reject }));
  }

  /** Nothing to watch: the socket's buffer is the server's to bound. */
  writable(): Promise<void> {
    if (this.#closed) return Promise.reject(lost());
    if (this.#ended) return Promise.reject(this.#ended);
    return Promise.resolve();
  }

  /** Ended by this side: nothing more is taken. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#queue.length = 0;
    for (const reader of this.#readers.splice(0)) reader.reject(lost());
    this.#onClose();
  }

  /** @internal The other side's next frame. */
  deliver(frame: Uint8Array): void {
    if (this.#closed || this.#ended) return;
    const reader = this.#readers.shift();
    if (reader) reader.resolve(frame);
    else this.#queue.push(frame);
  }

  /** @internal Ended underneath: what came first is still taken, then receive() rejects with `err`. */
  end(err: DropgateError): void {
    if (this.#closed || this.#ended) return;
    this.#ended = err;
    for (const reader of this.#readers.splice(0)) reader.reject(err);
  }

  get ended(): boolean { return this.#closed || this.#ended !== undefined; }
}

function checkCodeLetters(codeLetters: unknown): asserts codeLetters is 0 | 2 | 3 {
  if (codeLetters !== 0 && codeLetters !== 2 && codeLetters !== 3) throw invalid("A server's code letters are 0, 2 or 3.");
}

// ---------------------------------------------------------------------------
// The sender.

/** One attempt reaching the sender's room: its tag, its pipe, and for one by code whether it has claimed the code yet. */
interface SenderAttempt {
  tag: number;
  by: 'link' | 'code';
  pipe: FramePipe;
  incoming: IncomingAttempt;
  /** By code: the code has been used (its first frame came) or the attempt ended, and a new one was asked for. */
  codeSettled: boolean;
}

/**
 * The sender's side of the rendezvous: one socket for its room. `create()`
 * opens it; its attempts and codes come to the room through `news`.
 */
export class SenderRendezvousClient implements SenderRendezvous {
  readonly #options: RendezvousOptions;
  readonly #version: ProtocolVersion;
  readonly #codeLetters: 0 | 2 | 3;
  readonly #timers: RendezvousTimers;
  #socket: Socket | undefined;
  #news: RoomNews | undefined;
  #created: { resolve: (locator: string | undefined) => void; reject: (err: unknown) => void } | undefined;
  readonly #attempts = new Map<number, SenderAttempt>();
  #wantCode = false;
  #locked = false;
  #ended: DropgateError | undefined;
  #renewTimer: unknown;
  #askTimer: unknown;

  /** Whether the server gives codes: its code letters aren't 0. */
  readonly givesCodes: boolean;

  constructor(options: RendezvousOptions) {
    if (!options || typeof options.url !== 'string') throw invalid('The rendezvous needs its address.');
    checkCodeLetters(options.codeLetters);
    this.#options = options;
    this.#version = options.version ?? PROTOCOLS.dgdtp;
    checkVersion(this.#version);
    this.#codeLetters = options.codeLetters;
    this.givesCodes = options.codeLetters !== 0;
    this.#timers = options.timers ?? GLOBAL_TIMERS;
    if (options.credential !== undefined) checkCredential(options.credential);
  }

  /**
   * Opens the room: a code asked for only when one is wanted and the server
   * gives them. Resolves with the code's locator, if one was free.
   */
  async create(room: { roomId: Uint8Array; roomNonce: Uint8Array; code: boolean }, news?: RoomNews): Promise<{ locator?: string }> {
    if (this.#socket) throw invalid('A rendezvous opens one room.');
    const wantCode = room?.code === true && this.#codeLetters !== 0;
    const create = rendezvousMessage.create({ version: this.#version, roomId: room.roomId, roomNonce: room.roomNonce, code: wantCode, credential: this.#options.credential });
    this.#news = news;
    this.#wantCode = wantCode;
    const socket = new Socket(this.#options, (bytes) => this.#message(bytes), () => this.#end(lost()));
    this.#socket = socket;
    const created = new Promise<string | undefined>((resolve, reject) => { this.#created = { resolve, reject }; });
    created.catch(() => undefined);
    try {
      await socket.opened;
    } catch (err) {
      this.#end(err as DropgateError);
      throw err;
    }
    socket.send(create);
    const locator = await created;
    return locator === undefined ? {} : { locator };
  }

  /**
   * A receiver was accepted: the room is locked (no new attempt by link or
   * code, its unused code released), every attempt but `keep` dropped, and
   * no more codes asked for.
   */
  lock(keep?: IncomingAttempt): void {
    if (this.#locked || this.#ended) return;
    this.#locked = true;
    this.#stopTimers();
    this.#socket?.send(rendezvousMessage.lock());
    for (const attempt of [...this.#attempts.values()]) {
      if (attempt.incoming !== keep) attempt.pipe.close();
    }
  }

  /** Closes the room's socket: every attempt's pipe ends. */
  close(): void {
    this.#end(new DropgateError({ code: 'OPERATION_CANCELLED' }));
  }

  #message(bytes: Uint8Array): void {
    let message: ServerMessage;
    try {
      message = readServerMessage(bytes, 'sender');
    } catch (err) {
      this.#end(err as DropgateError);
      return;
    }
    if (message.type === 'error') {
      this.#end(rendezvousError(message.code, message.server, this.#version));
      return;
    }
    if (this.#created) {
      // The first answer is CREATED: with a locator only when a code was asked for.
      if (message.type !== 'created' || (message.locator !== null && !this.#takeLocator(message.locator))) {
        this.#end(invalidResponse());
        return;
      }
      const { resolve } = this.#created;
      this.#created = undefined;
      if (message.locator === null) this.#noCode();
      resolve(message.locator ?? undefined);
      return;
    }
    switch (message.type) {
      case 'code-is':
        // Asked for just before the room was locked: no code is shown once a receiver is accepted.
        if (this.#locked) return;
        if (message.locator === null) {
          this.#noCode();
          this.#news?.code(undefined);
        } else if (this.#takeLocator(message.locator)) {
          this.#news?.code(message.locator);
        } else {
          this.#end(invalidResponse());
        }
        return;
      case 'code-gone':
        // Released (the sender couldn't renew it in time, asleep perhaps): asked for again at once.
        this.#stopTimers();
        this.#news?.code(undefined);
        this.#askForCode();
        return;
      case 'attempt':
        this.#attempt(message.tag, message.by);
        return;
      case 'frame':
        if ('tag' in message) this.#frame(message.tag, message.frame);
        return;
      case 'gone':
        if ('tag' in message) this.#gone(message.tag);
        return;
      default:
        // CREATED a second time.
        this.#end(invalidResponse());
    }
  }

  /** A locator the server gave: the server's length, when a code is wanted; renewed from now on. */
  #takeLocator(locator: string): boolean {
    if (!this.#wantCode || locator.length !== this.#codeLetters) return false;
    this.#stopTimers();
    const renew = () => {
      this.#renewTimer = this.#timers.setTimeout(() => {
        this.#socket?.send(rendezvousMessage.renew());
        renew();
      }, RENEW_INTERVAL_MS);
    };
    renew();
    return true;
  }

  /** No code free: asked for again every 15 seconds, while one is wanted. (Nothing comes here once locked.) */
  #noCode(): void {
    this.#stopTimers();
    if (!this.#wantCode) return;
    this.#askTimer = this.#timers.setTimeout(() => this.#askForCode(), CODE_RETRY_MS);
  }

  /** Asks for a code now, unless a receiver has been accepted. Only a room that wants codes is given one, or attempts by one. */
  #askForCode(): void {
    this.#stopTimers();
    if (this.#locked || this.#ended) return;
    this.#socket?.send(rendezvousMessage.code());
  }

  #stopTimers(): void {
    if (this.#renewTimer !== undefined) this.#timers.clearTimeout(this.#renewTimer);
    if (this.#askTimer !== undefined) this.#timers.clearTimeout(this.#askTimer);
    this.#renewTimer = undefined;
    this.#askTimer = undefined;
  }

  #attempt(tag: number, by: 'link' | 'code'): void {
    // A tag already in use, or a code attempt where no code was asked for, isn't something the server does.
    if (this.#attempts.has(tag) || (by === 'code' && !this.#wantCode)) {
      this.#end(invalidResponse());
      return;
    }
    // Joined just as the room was locked: dropped at once, and never offered.
    if (this.#locked) {
      this.#socket?.send(rendezvousMessage.drop(tag));
      return;
    }
    const pipe = new FramePipe(
      (frame) => this.#socket?.send(rendezvousMessage.send(tag, frame)),
      () => this.#dropped(tag),
    );
    const incoming: IncomingAttempt = { by, pipe };
    const attempt: SenderAttempt = { tag, by, pipe, incoming, codeSettled: false };
    this.#attempts.set(tag, attempt);
    this.#news?.attempt(incoming);
  }

  #frame(tag: number, frame: Uint8Array): void {
    const attempt = this.#attempts.get(tag);
    // A frame for an attempt this side has just ended: it's on its way to GONE.
    if (!attempt) return;
    attempt.pipe.deliver(frame);
    // Its first frame used the code up: a new one, at once, right or wrong.
    this.#settleCode(attempt);
  }

  #gone(tag: number): void {
    const attempt = this.#attempts.get(tag);
    if (!attempt) return;
    this.#attempts.delete(tag);
    attempt.pipe.end(lost());
    this.#settleCode(attempt);
  }

  /** This side ended an attempt: the server is told, unless it's gone already. */
  #dropped(tag: number): void {
    const attempt = this.#attempts.get(tag);
    if (!attempt) return;
    this.#attempts.delete(tag);
    this.#socket?.send(rendezvousMessage.drop(tag));
    this.#settleCode(attempt);
  }

  /** After an attempt by code, its code is never shown again: a new one is asked for, once. */
  #settleCode(attempt: SenderAttempt): void {
    if (attempt.by !== 'code' || attempt.codeSettled) return;
    attempt.codeSettled = true;
    this.#askForCode();
  }

  /** The room ends: its socket closed, every attempt's pipe ended with `err`, the room told. */
  #end(err: DropgateError): void {
    if (this.#ended) return;
    this.#ended = err;
    this.#stopTimers();
    this.#socket?.close();
    for (const attempt of this.#attempts.values()) attempt.pipe.end(err.code === 'OPERATION_CANCELLED' ? lost() : err);
    this.#attempts.clear();
    if (this.#created) {
      this.#created.reject(err);
      this.#created = undefined;
    } else {
      this.#news?.ended?.(err);
    }
  }

  toJSON(): string { return '[SenderRendezvous]'; }
  toString(): string { return '[SenderRendezvous]'; }
  [Symbol.for('nodejs.util.inspect.custom')](): string { return '[SenderRendezvous]'; }
}

/** The sender's side of the rendezvous at `options.url`. */
export function senderRendezvous(options: RendezvousOptions): SenderRendezvousClient {
  return new SenderRendezvousClient(options);
}

// ---------------------------------------------------------------------------
// The receiver.

/**
 * The receiver's side of the rendezvous: a socket for each attempt, joining
 * by the room ID (a link) or the locator (a code).
 */
export function receiverRendezvous(options: RendezvousOptions): ReceiverRendezvous {
  if (!options || typeof options.url !== 'string') throw invalid('The rendezvous needs its address.');
  checkCodeLetters(options.codeLetters);
  const version = options.version ?? PROTOCOLS.dgdtp;
  checkVersion(version);
  const { codeLetters } = options;
  return Object.freeze({
    async join(by: { roomId: Uint8Array } | { locator: string }) {
      if (by && 'locator' in by) {
        if (codeLetters === 0) {
          throw new DropgateError({ code: 'CAPABILITY_UNSUPPORTED', message: "This server doesn't use codes. Ask the sender for the link." });
        }
        if (typeof by.locator !== 'string' || by.locator.length !== codeLetters) throw invalid(`This server's codes have ${codeLetters} locator letters.`);
      }
      const join = rendezvousMessage.join({ version, ...by } as Parameters<typeof rendezvousMessage.join>[0]);
      let joined: { resolve: (nonce: Uint8Array<ArrayBuffer>) => void; reject: (err: unknown) => void } | undefined;
      const answer = new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => { joined = { resolve, reject }; });
      answer.catch(() => undefined);
      // eslint-disable-next-line prefer-const
      let socket: Socket;
      const pipe = new FramePipe((frame) => socket.send(rendezvousMessage.receiverSend(frame)), () => socket.close());
      const end = (err: DropgateError) => {
        socket.close();
        if (joined) {
          joined.reject(err);
          joined = undefined;
        } else {
          pipe.end(err);
        }
      };
      socket = new Socket(options, (bytes) => {
        let message: ServerMessage;
        try {
          message = readServerMessage(bytes, 'receiver');
        } catch (err) {
          end(err as DropgateError);
          return;
        }
        if (message.type === 'error') {
          end(rendezvousError(message.code, message.server, version));
        } else if (joined) {
          // The first answer is JOINED.
          if (message.type !== 'joined') {
            end(invalidResponse());
            return;
          }
          joined.resolve(message.roomNonce);
          joined = undefined;
        } else if (message.type === 'frame') {
          pipe.deliver(message.frame);
        } else if (message.type === 'gone') {
          // The sender left, or dropped this attempt.
          end(lost());
        } else {
          end(invalidResponse());
        }
      }, () => end(lost()));
      await socket.opened;
      socket.send(join);
      const roomNonce = await answer;
      return { roomNonce, pipe };
    },
    toJSON: () => '[ReceiverRendezvous]',
    toString: () => '[ReceiverRendezvous]',
  });
}
