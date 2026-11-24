import { CancelScope } from '../cancel.js';
import type { CryptoProvider } from '../crypto/index.js';
import { DropgateError, directTransferDisabled, withTransport } from '../errors.js';
import { startOperation } from '../operation.js';
import type { OperationContext, OwnPausing } from '../operation.js';
import type { OperationRegistry } from '../operations.js';
import type { Outcome } from '../outcome.js';
import { isDownloadSink } from '../sink.js';
import { toFileSources } from '../source.js';
import type { Transport } from '../transport.js';
import type {
  Base64Adapter, DirectAcceptOptions, DirectCodeState, DirectOffer, DirectOptions, DirectPeerConnectionClass, DirectReceiveHandle,
  DirectReceiveOptions, DirectReceiveSnapshot, DirectResult, DirectSendHandle, DirectSendOptions, DirectSendSnapshot, DirectShare,
  RequestOptions, ServerInfo,
} from '../types.js';
import { base64urlToBytes, bytesToBase64url } from '../utils/base64.js';
import { connectByCode, connectByLink, type HelloOptions, type MessagePipe, type PeerConnection, type ReceiverRendezvous } from '../dgdtp/channel.js';
import { normalizeCode, type LocatorLetters } from '../dgdtp/codes.js';
import type { DirectOutcome as EngineOutcome, DirectState, PausedBy } from '../dgdtp/engine.js';
import { LINK_SECRET_BYTES } from '../dgdtp/keys.js';
import { receiveDirect, type DirectReceiver } from '../dgdtp/receive.js';
import { receiverRendezvous, rendezvousUrl, senderRendezvous, type WebSocketClass } from '../dgdtp/rendezvous.js';
import { sendDirect, type DirectSender } from '../dgdtp/send.js';
import { webRtcPeer, type RtcIceServer, type RtcPeerConnectionClass } from '../dgdtp/webrtc.js';

// `client.direct` on handles: a send's handle, with share() for its link and
// code, and a receive's, with offer(), accept() and decline(). Each runs the
// direct-transfer engine (dgdtp/send.ts, dgdtp/receive.ts) and shows it as
// every operation is shown: one outcome, snapshots, cancel, pause and resume,
// listed in client.operations while it runs. No snapshot, outcome or error
// holds the link, the code, a secret or a file's name: names are given only
// by a receive's offer().

/** A direct transfer's settings, every one set: the client's, or one transfer's over them. */
export interface DirectSettings {
  readonly pauseLimitMs: number | null;
  readonly reconnectWindowMs: number;
  readonly stun: boolean;
}

/** The settings a client has when it's given none: no pause limit, a 2-minute reconnect window, STUN on. */
export const DEFAULT_DIRECT_SETTINGS: DirectSettings = Object.freeze({ pauseLimitMs: null, reconnectWindowMs: 120_000, stun: true });

/** The shortest pause limit, in milliseconds: one minute. */
export const MIN_PAUSE_LIMIT_MS = 60_000;
/** The longest pause limit, in milliseconds: one week. */
export const MAX_PAUSE_LIMIT_MS = 604_800_000;
/** The shortest reconnect window, in milliseconds: 10 seconds. */
export const MIN_RECONNECT_WINDOW_MS = 10_000;
/** The longest reconnect window, in milliseconds: one hour. */
export const MAX_RECONNECT_WINDOW_MS = 3_600_000;

/** A direct link's path on its server: the secret follows the `#`, nothing follows the path. */
export const DIRECT_LINK_PATH = '/p2p';

const SETTINGS = ['pauseLimitMs', 'reconnectWindowMs', 'stun'] as const;

const invalid = (message: string) => new DropgateError({ code: 'INVALID_ARGUMENT', message });
const cantResume = () => new DropgateError({ code: 'PAUSE_UNAVAILABLE', message: "This device hasn't paused the transfer, so there's nothing for it to resume." });
const cantPauseYet = () => new DropgateError({ code: 'PAUSE_UNAVAILABLE', message: 'A direct transfer can be paused once it has been accepted, until all its data has arrived.' });
const hasEnded = () => invalid('This transfer has ended.');

/** Whether `ms` is a whole number of seconds, in milliseconds, from `min` to `max`. */
function wholeSecondsWithin(ms: unknown, min: number, max: number): ms is number {
  return typeof ms === 'number' && Number.isSafeInteger(ms) && ms % 1000 === 0 && ms >= min && ms <= max;
}

/**
 * The settings `value` gives over `base`: each one left out is `base`'s.
 * @throws {DropgateError} INVALID_ARGUMENT for anything but the three settings, each in its range.
 */
export function directSettings(value: DirectOptions | undefined, base: DirectSettings): DirectSettings {
  if (value === undefined) return base;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('direct is an object of pauseLimitMs, reconnectWindowMs and stun, each optional.');
  }
  for (const key of Object.keys(value)) {
    if (!(SETTINGS as readonly string[]).includes(key)) throw invalid('direct takes pauseLimitMs, reconnectWindowMs and stun only.');
  }
  const pauseLimitMs = value.pauseLimitMs === undefined ? base.pauseLimitMs : value.pauseLimitMs;
  if (pauseLimitMs !== null && !wholeSecondsWithin(pauseLimitMs, MIN_PAUSE_LIMIT_MS, MAX_PAUSE_LIMIT_MS)) {
    throw invalid('direct.pauseLimitMs is null for no limit, or a whole number of seconds from one minute to one week, in milliseconds (60000 to 604800000).');
  }
  const reconnectWindowMs = value.reconnectWindowMs === undefined ? base.reconnectWindowMs : value.reconnectWindowMs;
  if (!wholeSecondsWithin(reconnectWindowMs, MIN_RECONNECT_WINDOW_MS, MAX_RECONNECT_WINDOW_MS)) {
    throw invalid('direct.reconnectWindowMs is a whole number of seconds from 10 seconds to one hour, in milliseconds (10000 to 3600000).');
  }
  const stun = value.stun === undefined ? base.stun : value.stun;
  if (typeof stun !== 'boolean') throw invalid('direct.stun is true or false.');
  return Object.freeze({ pauseLimitMs, reconnectWindowMs, stun });
}

/** What this side says in its hello: its settings, in whole seconds (a pause limit of 0 for none). */
export function helloOf(settings: DirectSettings): HelloOptions {
  return {
    pauseLimitSeconds: settings.pauseLimitMs === null ? 0 : settings.pauseLimitMs / 1000,
    reconnectWindowSeconds: settings.reconnectWindowMs / 1000,
  };
}

/** A direct link: `<server>/p2p#` and the secret, URL-safe base64 with no `=`. */
export function directLink(baseUrl: string, secret: Uint8Array, base64?: Base64Adapter): string {
  return `${baseUrl}${DIRECT_LINK_PATH}#${bytesToBase64url(secret, base64)}`;
}

/**
 * A direct link's secret, read on this device.
 * @throws {DropgateError} INVALID_ARGUMENT if it isn't a direct link, or is another server's.
 */
function linkSecret(link: unknown, baseUrl: string, base64?: Base64Adapter): Uint8Array {
  // Never quoted in an error: it holds the secret.
  const notALink = () => invalid("That isn't a direct transfer link: it's https://<server>/p2p#, then the secret.");
  if (typeof link !== 'string') throw notALink();
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw notALink();
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw notALink();
  // The scheme may differ behind a TLS proxy, so only the host and port are compared, as links.resolve() does.
  if (url.host !== new URL(baseUrl).host) throw invalid('URL must be from this server.');
  if (url.pathname !== DIRECT_LINK_PATH || url.search !== '' || url.username !== '' || url.password !== '') throw notALink();
  const secret = base64urlToBytes(url.hash.slice(1), LINK_SECRET_BYTES, base64);
  if (!secret) throw notALink();
  return secret;
}

/** What a direct transfer needs of the client that starts it. */
export interface DirectHost {
  readonly provider: CryptoProvider;
  readonly baseUrl: string;
  readonly transport: Transport;
  readonly base64: Base64Adapter;
  readonly registry: OperationRegistry;
  /** The client's settings, which each transfer's override. */
  readonly settings: DirectSettings;
  /** The client's `RTCPeerConnection` option, if it was given one. */
  readonly RTCPeerConnection: DirectPeerConnectionClass | undefined;
  /** The server's info and compatibility, as client.server.connect() gives them. */
  connect(opts: RequestOptions): Promise<{ serverInfo: ServerInfo; dgdtp: { compatible: boolean } }>;
  /** Throws VERSION_UNSUPPORTED if the server's DGDTP major isn't this client's. */
  requireDirect(compat: { serverInfo: ServerInfo; dgdtp: { compatible: boolean } }): void;
  /** The token of a direct send's credential, asked of the client's `auth` provider (AUTH_REQUIRED without one). */
  credential(signal: AbortSignal): Promise<string>;
  /** What each running direct transfer does as the app closes, for `client.direct.appClosing()`: there from its start to its end. */
  readonly appClosers: Set<() => void>;
}

/**
 * The app is closing: every direct transfer `host` runs ends, each telling
 * its other side so (CLOSE, APP_CLOSED, best effort), and ends cancelled by
 * this side. One still opening its room, or still connecting, has nobody to
 * tell, and is cancelled.
 *
 * The work goes in a microtask, run as soon as the caller's code returns,
 * never later: Firefox drops a WebSocket message a page sends from inside the
 * first `pagehide` listener as it closes, but sends one from the microtask
 * straight after it. Each transfer's close is then sealed and sent before
 * anything else it does (the engine's closeWith()). The transfers are the
 * ones running at the call: one started after it carries on. The call itself
 * only notes how many have started; the list is read in the microtask (read in
 * the listener, Firefox's sending page lost its close every time, measured).
 */
export function appClosing(host: DirectHost): void {
  const upTo = closersAdded;
  queueMicrotask(() => {
    for (const close of [...host.appClosers]) if ((addedAt.get(close) ?? 0) <= upTo) close();
  });
}

/** How many app closers have been added, and when each was: appClosing() ends those added before its call. */
let closersAdded = 0;
const addedAt = new WeakMap<() => void, number>();

/** Adds a running transfer's closer for `client.direct.appClosing()`. */
function addAppCloser(host: DirectHost, close: () => void): void {
  closersAdded += 1;
  addedAt.set(close, closersAdded);
  host.appClosers.add(close);
}

/** What the server says about its direct transfers, checked. */
interface DirectServer {
  codeLetters: 0 | LocatorLetters;
  iceServers: RtcIceServer[];
  credentialRequired: boolean;
}

/** The server's direct transfers: VERSION_UNSUPPORTED, CAPABILITY_UNSUPPORTED if it has them off, INVALID_RESPONSE if they can't be read. */
function directServer(host: DirectHost, compat: { serverInfo: ServerInfo; dgdtp: { compatible: boolean } }): DirectServer {
  host.requireDirect(compat);
  const p2p = compat.serverInfo?.capabilities?.p2p;
  if (!p2p?.enabled) throw directTransferDisabled();
  const letters = p2p.codeLetters;
  if (letters !== 0 && letters !== 2 && letters !== 3) {
    throw new DropgateError({ code: 'INVALID_RESPONSE', message: "The server's direct transfer settings weren't understood." });
  }
  const iceServers = Array.isArray(p2p.iceServers) ? (p2p.iceServers as RtcIceServer[]) : [];
  return { codeLetters: letters, iceServers, credentialRequired: p2p.credentialRequired === true };
}

/** The `RTCPeerConnection` a direct transfer uses: the client's option, or the global one. */
function peerConnectionClass(given: DirectPeerConnectionClass | undefined): RtcPeerConnectionClass {
  const found = given ?? (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection;
  if (typeof found !== 'function') {
    throw new DropgateError({
      code: 'RUNTIME_UNSUPPORTED',
      message: "There's no RTCPeerConnection here for a direct transfer. In Node, pass a library's as the client's RTCPeerConnection option.",
    });
  }
  return found as RtcPeerConnectionClass;
}

/** The global `WebSocket`, which the rendezvous uses (Node 22 and later have one). */
function webSocketClass(): WebSocketClass {
  const found = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (typeof found !== 'function') {
    throw new DropgateError({ code: 'RUNTIME_UNSUPPORTED', message: "There's no WebSocket here for a direct transfer." });
  }
  return found as WebSocketClass;
}

/** `promise`, or the reason `signal` aborts with, whichever comes first. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** The engine's state while it runs, as a handle shows it: `paused` while either side holds it. */
function runningStatus(state: DirectState, pausedBy: PausedBy): DirectState | 'paused' {
  return state === 'transferring' && pausedBy !== null ? 'paused' : state;
}

const ENDED: ReadonlySet<DirectState> = new Set(['completed', 'cancelled', 'failed']);

/** The words for where a transfer is, on `side`. Never a link, a code or a name. */
function runningText(side: 'sender' | 'receiver', status: DirectState | 'paused', pausedBy: PausedBy): string {
  const other = side === 'sender' ? 'receiver' : 'sender';
  switch (status) {
    case 'waiting': return 'Waiting for the receiver to connect.';
    case 'connecting': return `Connecting to the ${other}...`;
    case 'offered': return side === 'sender' ? 'Connected. Waiting for them to accept.' : 'Connected. Waiting for you to accept.';
    case 'transferring': return side === 'sender' ? 'Sending...' : 'Receiving...';
    case 'paused':
      return pausedBy === 'both' ? 'Paused by both of you.' : pausedBy === 'self' ? 'You paused the transfer.' : `The ${other} paused the transfer.`;
    case 'finalising': return side === 'sender' ? 'Waiting for the receiver to finish saving...' : 'Saving the files...';
    default: return '';
  }
}

/** The last words, from the outcome. */
function endText(side: 'sender' | 'receiver', outcome: Outcome<DirectResult>): string {
  const other = side === 'sender' ? 'receiver' : 'sender';
  if (outcome.status === 'completed') {
    if (side === 'sender') return outcome.value.assurance === 'saved' ? 'The receiver has the files.' : "Delivered to the receiver's browser.";
    return outcome.value.assurance === 'saved' ? 'The files are saved.' : 'Handed to your browser. Check your downloads.';
  }
  if (outcome.status === 'cancelled') {
    if (outcome.cancellation.by !== 'peer') return 'Transfer cancelled.';
    return outcome.cancellation.declined ? 'The receiver declined the transfer.' : `The ${other} cancelled the transfer.`;
  }
  return outcome.error.message;
}

/** The percentage of `total` that `done` is, rounded down: 0 while there's nothing to count. */
function percentOf(done: number, total: number): number {
  return total > 0 ? Math.min(100, Math.floor((done * 100) / total)) : 0;
}

/**
 * The engine's outcome as the handle's: completed with its value; cancelled
 * as the handle's node says, which a cancel by the other side (or an end by
 * this side's own app) sets here; failed with its error.
 */
function handleValue(outcome: EngineOutcome, scope: CancelScope, files: number, totalBytes: number, transport: Transport): DirectResult {
  if (outcome.state === 'completed') return { assurance: outcome.assurance, files, totalBytes, transport };
  if (outcome.state === 'cancelled') {
    if (!scope.cancellation) {
      if (outcome.by === 'peer') scope.cancelByPeer(outcome.declined === true);
      else scope.cancel();
    }
    throw scope.signal.reason;
  }
  throw outcome.error;
}

/** The fields every final snapshot shares: nothing is stalled once it has ended, and a completed one is all there. */
function finalFields<S extends DirectSendSnapshot | DirectReceiveSnapshot>(side: 'sender' | 'receiver', outcome: Outcome<DirectResult>, last: S): S {
  const done = outcome.status === 'completed'
    ? { percent: 100, processedBytes: outcome.value.totalBytes, totalBytes: outcome.value.totalBytes, fileIndex: Math.max(0, outcome.value.files - 1) }
    : {};
  return { ...last, ...done, status: outcome.status, text: endText(side, outcome), stalled: false };
}

/** A promise whose rejection, if nobody waits on it, is never reported. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

/** A step of a handle's own, its errors stamped with how the client reaches its server. */
function stamped<A extends unknown[], R>(transport: Transport, step: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args: A) => {
    let running: Promise<R>;
    try {
      running = step(...args);
    } catch (err) {
      running = Promise.reject(err);
    }
    return running.catch((err: unknown) => { throw withTransport(err, transport); });
  };
}

// ---------------------------------------------------------------------------
// Sending.

/**
 * Starts a direct send: the files and options checked, the server asked
 * whether it does direct transfers (and for a credential when it says a send
 * needs one), then the room opened on its rendezvous. Resolves with the handle
 * once the room is open, so `share()` has the link at once.
 */
export async function startDirectSend(host: DirectHost, opts: DirectSendOptions): Promise<DirectSendHandle> {
  if (opts === null || typeof opts !== 'object') throw invalid('A direct send takes its options: { files }.');
  const files = toFileSources(opts.files);
  if (files.length === 0) throw invalid('At least one file is required.');
  if (opts.code !== undefined && typeof opts.code !== 'boolean') throw invalid('code is true or false.');
  const settings = directSettings(opts.direct, host.settings);
  const RTCPeerConnection = peerConnectionClass(host.RTCPeerConnection);
  const WebSocket = webSocketClass();

  const scope = new CancelScope('direct.send', { parent: host.registry.scope, signal: opts.signal });
  let sender: DirectSender | undefined;
  // Still opening its room, there's nobody to tell: the send is cancelled, and the room closed once open.
  const closeForApp = () => (sender ? sender.appClosed() : scope.cancel());
  addAppCloser(host, closeForApp);
  try {
    scope.throwIfCancelled();
    const server = directServer(host, await host.connect({ signal: scope.signal }));
    // Asked only when the server says a send needs one; carried in CREATE and nowhere else.
    const credential = server.credentialRequired ? await host.credential(scope.signal) : undefined;
    scope.throwIfCancelled();
    const opening = sendDirect(host.provider, {
      files,
      code: opts.code !== false,
      letters: server.codeLetters === 0 ? undefined : server.codeLetters,
      hello: helloOf(settings),
      rendezvous: senderRendezvous({
        url: rendezvousUrl(host.baseUrl), codeLetters: server.codeLetters, WebSocket, ...(credential !== undefined ? { credential } : {}),
      }),
      peer: () => webRtcPeer({ RTCPeerConnection, role: 'sender', iceServers: settings.stun ? server.iceServers : [] }),
    });
    // Cancelled while the room was being opened: it's closed as soon as it's open.
    opening.then((opened) => { if (scope.cancellation) opened.cancel(); }, () => undefined);
    sender = await untilAborted(opening, scope.signal);
  } catch (err) {
    host.appClosers.delete(closeForApp);
    const reason = scope.cancellation ? scope.signal.reason : err;
    scope.finish();
    throw reason;
  }
  return sendHandle(host, scope, sender, files.length, closeForApp);
}

/** A send's handle, once its room is open. */
function sendHandle(host: DirectHost, scope: CancelScope, sender: DirectSender, count: number, closeForApp: () => void): DirectSendHandle {
  const { transport } = host;
  const totalBytes = sender.totalSize;
  scope.onCancel(() => sender.cancel());

  const fields = (): Omit<DirectSendSnapshot, 'canPause' | 'transport'> => {
    const { consumed, filesDone } = sender.progress;
    const pausedBy = sender.pausedBy;
    const status = runningStatus(sender.state, pausedBy);
    return {
      status: status as DirectSendSnapshot['status'],
      text: runningText('sender', status, pausedBy),
      code: sender.room.codeState as DirectCodeState,
      percent: percentOf(consumed, totalBytes),
      processedBytes: consumed,
      totalBytes,
      fileIndex: Math.min(filesDone, Math.max(0, count - 1)),
      totalFiles: count,
      stalled: sender.stalled,
      pausedBy,
      deadline: sender.deadline,
    };
  };

  const pausing: OwnPausing = {
    get canPause() { return sender.canPause; },
    pause: async () => sender.pause(),
    resume: async () => {
      if (sender.pausedBy !== 'self' && sender.pausedBy !== 'both') throw cantResume();
      sender.resume();
    },
  };

  const share = (): DirectShare => {
    const closed = Object.freeze({ link: null, code: null });
    if (sender.chosen || ENDED.has(sender.state)) return closed;
    const secret = sender.room.linkSecret();
    if (!secret) return closed;
    try {
      return Object.freeze({ link: directLink(host.baseUrl, secret, host.base64), code: sender.room.code ?? null });
    } finally {
      secret.fill(0);
    }
  };

  return host.registry.add(startOperation<DirectResult, DirectSendSnapshot, { share(): DirectShare }>({
    kind: 'direct.send',
    scope,
    transport,
    initial: fields(),
    ownPausing: pausing,
    work: async (ctx: OperationContext<DirectSendSnapshot>) => {
      const publish = () => {
        // Once the engine has ended, the outcome's own snapshot is the next.
        if (!ENDED.has(sender.state)) ctx.update(fields());
      };
      const stops = [sender.onChange(publish), sender.room.onCodeChange(publish)];
      publish();
      try {
        return handleValue(await sender.done, ctx.scope, count, totalBytes, transport);
      } finally {
        for (const stop of stops) stop();
      }
    },
    finalSnapshot: (outcome, last) => finalFields('sender', outcome, { ...last, code: sender.room.codeState as DirectCodeState }),
    onEnd: (handle) => {
      host.appClosers.delete(closeForApp);
      host.registry.remove(handle);
    },
    extend: () => ({ share }),
  })) as DirectSendHandle;
}

// ---------------------------------------------------------------------------
// Receiving.

/**
 * The receiver's rendezvous for one attempt, which a cancel stops at once:
 * the join given up (its socket closed as soon as it opens), the attempt's
 * pipe and peer connection closed. Once the channel is up, `connected()`
 * hands the cancel to the engine, which tells the sender first.
 */
class CancellableJoin implements ReceiverRendezvous {
  readonly #rendezvous: ReceiverRendezvous;
  readonly #signal: AbortSignal;
  readonly #peer: PeerConnection;
  #pipe: MessagePipe | undefined;
  readonly #stop = () => {
    this.#pipe?.close();
    try {
      this.#peer.close();
    } catch {
      // Already closed.
    }
  };

  constructor(rendezvous: ReceiverRendezvous, signal: AbortSignal, peer: PeerConnection) {
    this.#rendezvous = rendezvous;
    this.#signal = signal;
    this.#peer = peer;
    signal.addEventListener('abort', this.#stop, { once: true });
  }

  join(by: { roomId: Uint8Array } | { locator: string }): Promise<{ roomNonce: Uint8Array; pipe: MessagePipe }> {
    const joining = this.#rendezvous.join(by);
    joining.then((joined) => {
      this.#pipe = joined.pipe;
      if (this.#signal.aborted) joined.pipe.close();
    }, () => undefined);
    return untilAborted(joining, this.#signal);
  }

  connected(): void {
    this.#signal.removeEventListener('abort', this.#stop);
  }
}

/**
 * Starts a direct receive by the sender's link or code: both checked on this
 * device first, nothing sent. Resolves with the handle at once, `connecting`;
 * connecting, and anything that stops it (a wrong code, a link whose transfer
 * has gone), is its operation's.
 */
export async function startDirectReceive(host: DirectHost, opts: DirectReceiveOptions): Promise<DirectReceiveHandle> {
  if (opts === null || typeof opts !== 'object') throw invalid("A direct receive takes the sender's link or code: { link } or { code }.");
  const byLink = opts.link !== undefined;
  if (byLink === (opts.code !== undefined)) throw invalid("A direct receive takes the sender's link or its code, one of the two.");
  // INVALID_ARGUMENT or INVALID_CODE before anything is sent.
  const secret = byLink ? linkSecret(opts.link, host.baseUrl, host.base64) : undefined;
  const code = byLink ? undefined : normalizeCode(opts.code as string);
  const settings = directSettings(opts.direct, host.settings);
  const RTCPeerConnection = peerConnectionClass(host.RTCPeerConnection);
  const WebSocket = webSocketClass();
  const { transport, provider } = host;

  let receiver: DirectReceiver | undefined;
  const engine = deferred<DirectReceiver>();
  let ended = false;
  let answered = false;
  let count = 0;
  let totalBytes = 0;

  const fields = (r: DirectReceiver): Partial<DirectReceiveSnapshot> => {
    const { consumed, fileIndex } = r.progress;
    const pausedBy = r.pausedBy;
    const status = runningStatus(r.state, pausedBy);
    return {
      status: status as DirectReceiveSnapshot['status'],
      text: runningText('receiver', status, pausedBy),
      percent: percentOf(consumed, totalBytes),
      processedBytes: consumed,
      totalBytes,
      fileIndex: Math.min(fileIndex, Math.max(0, count - 1)),
      totalFiles: count,
      stalled: r.stalled,
      pausedBy,
      deadline: r.deadline,
    };
  };

  const work = async (ctx: OperationContext<DirectReceiveSnapshot>): Promise<DirectResult> => {
    let channelSecret = secret;
    try {
      const server = directServer(host, await host.connect({ signal: ctx.signal }));
      if (code !== undefined && server.codeLetters === 0) {
        throw new DropgateError({ code: 'CAPABILITY_UNSUPPORTED', message: "This server doesn't use codes. Ask the sender for the link." });
      }
      const peer = webRtcPeer({ RTCPeerConnection, role: 'receiver', iceServers: settings.stun ? server.iceServers : [] });
      const rendezvous = new CancellableJoin(
        receiverRendezvous({ url: rendezvousUrl(host.baseUrl), codeLetters: server.codeLetters, WebSocket }), ctx.signal, peer,
      );
      const hello = helloOf(settings);
      const connecting = channelSecret
        ? connectByLink(provider, { rendezvous, peer, secret: channelSecret, hello })
        : connectByCode(provider, { rendezvous, peer, code: code as string, letters: server.codeLetters as LocatorLetters, hello });
      connecting.then((channel) => { if (ctx.signal.aborted) channel.close(); }, () => undefined);
      const channel = await untilAborted(connecting, ctx.signal);
      rendezvous.connected();
      receiver = receiveDirect(provider, channel);
    } finally {
      channelSecret?.fill(0);
      channelSecret = undefined;
    }
    const r = receiver;
    ctx.scope.onCancel(() => r.cancel());
    const publish = () => {
      if (!ENDED.has(r.state)) ctx.update(fields(r));
    };
    const stop = r.onChange(publish);
    r.offer().then((offer) => {
      count = offer.files.length;
      totalBytes = offer.totalSize;
      publish();
    }, () => undefined);
    engine.resolve(r);
    publish();
    try {
      return handleValue(await r.done, ctx.scope, count, totalBytes, transport);
    } finally {
      stop();
    }
  };

  const pausing: OwnPausing = {
    get canPause() { return receiver?.canPause ?? false; },
    pause: async () => {
      if (!receiver) throw cantPauseYet();
      receiver.pause();
    },
    resume: async () => {
      if (!receiver || (receiver.pausedBy !== 'self' && receiver.pausedBy !== 'both')) throw cantResume();
      receiver.resume();
    },
  };

  /** The first answer to the offer, once: accept() or decline(), even one made before the offer is in. */
  const answering = (): void => {
    if (ended) throw hasEnded();
    if (answered) throw invalid('The offer has already been accepted or declined.');
    answered = true;
  };

  const offer = (): Promise<DirectOffer> => engine.promise.then((r) => r.offer());

  const accept = async (options: DirectAcceptOptions): Promise<void> => {
    const { sink, asZip = false, handOff = false } = options ?? ({} as DirectAcceptOptions);
    if (typeof sink !== 'function' && !isDownloadSink(sink)) {
      throw invalid('A direct transfer is received into a sink, with write() and close(), or a function giving one for each file.');
    }
    if (typeof asZip !== 'boolean' || typeof handOff !== 'boolean') throw invalid('asZip and handOff are true or false.');
    if (asZip && typeof sink === 'function') throw invalid('Files received as a ZIP need one sink, with write() and close().');
    answering();
    const r = await engine.promise;
    try {
      await r.accept({ sink, asZip, handOff });
    } catch (err) {
      // Refused with nothing sent (several files apart into one sink): the offer still waits for an answer.
      if (DropgateError.is(err, 'INVALID_ARGUMENT') && r.state === 'offered') answered = false;
      throw err;
    }
  };

  const decline = async (): Promise<void> => {
    answering();
    (await engine.promise).decline();
  };

  const handle = startOperation<DirectResult, DirectReceiveSnapshot, Pick<DirectReceiveHandle, 'offer' | 'accept' | 'decline'>>({
    kind: 'direct.receive',
    parent: host.registry.scope,
    signal: opts.signal,
    transport,
    initial: {
      status: 'connecting', text: runningText('receiver', 'connecting', null), percent: 0, processedBytes: 0, totalBytes: 0,
      fileIndex: 0, totalFiles: 0, stalled: false,
    },
    ownPausing: pausing,
    work,
    finalSnapshot: (outcome, last) => finalFields('receiver', outcome, last),
    onEnd: (h) => {
      ended = true;
      host.appClosers.delete(closeForApp);
      host.registry.remove(h);
    },
    extend: () => ({
      offer: stamped(transport, offer),
      accept: stamped(transport, accept),
      decline: stamped(transport, decline),
    }),
  });
  // Still connecting, there's nobody to tell: the receive is cancelled, its join given up.
  function closeForApp(): void {
    if (receiver) receiver.appClosed();
    else handle.cancel();
  }
  if (!ended) addAppCloser(host, closeForApp);
  // Ended before the channel was up: an offer, an accept or a decline waiting for it hears how.
  void handle.result.then((outcome) => {
    engine.reject(outcome.status === 'failed' ? outcome.error : new DropgateError({ code: 'OPERATION_CANCELLED', details: { cancellation: outcome.status === 'cancelled' ? outcome.cancellation : undefined } }));
  });
  return host.registry.add(handle) as DirectReceiveHandle;
}
