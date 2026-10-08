import { DEFAULT_CHUNK_SIZE } from '../constants.js';
import { DropgateError, directTransferDisabled, errorFromStatus, toDropgateError, withTransport } from '../errors.js';
import { guardedFetch, insecureTransportNotAllowed, isSecureServerUrl } from '../transport.js';
import type { Transport } from '../transport.js';
import { CORE_VERSION, PROTOCOLS } from '../version.js';
import { RetryWindow, retrying, retryPolicy, withRetryAfter } from '../retry.js';
import type { RetryPolicy } from '../retry.js';
import type { ProtocolName, ProtocolVersion, Protocols } from '../version.js';
import { startOperation } from '../operation.js';
import type { OperationContext } from '../operation.js';
import type { PauseControl, PauseHooks } from '../pause.js';
import { OperationRegistry } from '../operations.js';
import type { Operations } from '../operations.js';
import { SinkWriter, isDownloadSink } from '../sink.js';
import { readRange, toFileSources } from '../source.js';
import type { FileSource } from '../source.js';
import type {
  FetchFn,
  ServerInfo,
  ServerTarget,
  CompatibilityResult,
  ProtocolCompatibility,
  AppInfo,
  ShareTargetResult,
  UploadResult,
  UploadHandle,
  UploadSnapshot,
  DropgateClientOptions,
  UploadOptions,
  RequestOptions,
  ValidateUploadOptions,
  Base64Adapter,
  DownloadOptions,
  DownloadResult,
  DownloadHandle,
  DownloadSnapshot,
  DownloadSinkOptions,
  HostedFile,
  MetadataOptions,
  OpenOptions,
  OpenedUpload,
  UploadMetadata,
  DeleteOptions,
} from '../types.js';
import type {
  P2PSendFileOptions,
  P2PReceiveFileOptions,
  P2PSendSession,
  P2PReceiveSession,
} from '../p2p/types.js';
import { getDefaultFetch, getDefaultBase64 } from '../adapters/defaults.js';
import { makeAbortSignal, makeWaitSignal, fetchJson, sleep, buildBaseUrl, parseServerUrl } from '../utils/network.js';
import type { FetchJsonOptions, FetchJsonResult } from '../utils/network.js';
import { parseShareInput } from '../utils/share-link.js';
import { validateFilename } from '../utils/filename.js';
import { mbToBytes, estimateUploadBytes } from '../utils/size.js';
import { bytesToBase64url, base64urlToBytes } from '../utils/base64.js';
import { cryptoProvider } from '../crypto/index.js';
import type { CryptoProvider } from '../crypto/index.js';
import { OperationCredentials, credentialExpired } from '../credentials.js';
import type { CredentialProvider } from '../credentials.js';
import { startP2PSend } from '../p2p/send.js';
import { startP2PReceive } from '../p2p/receive.js';
import { resolvePeerConfig } from '../p2p/helpers.js';
import { StreamingZipWriter } from '../zip/stream-zip.js';
import { createObject, openObject, checkFiles, ObjectLayout, isChunkSize, HEADER_BYTES, SECRET_BYTES, MAX_FILES } from '../object/index.js';
import type { ObjectWriter, OpenedObject } from '../object/index.js';

/**
 * What `client.server.connect()` gives: whether each protocol works with the
 * server, the server's info, its address, and how it's reached.
 */
export type ServerConnection = CompatibilityResult & { serverInfo: ServerInfo; baseUrl: string; transport: Transport };

/** What `client.server.info()` gives: the server's info, and how it was reached. */
export type ServerInfoResult = ServerInfo & { transport: Transport };

/** What `client.server.on('insecure-transport')` tells its listener. */
export interface InsecureTransportEvent {
  /** The server's address, on plain `http://`. */
  baseUrl: string;
  transport: Transport;
}

/** `client.server`: the server the client was made for. */
export interface ServerApi {
  /** The server's address, such as `https://dropgate.example`. It never changes. */
  readonly baseUrl: string;
  /**
   * How the server is reached: `secure: false` over plain `http://` to
   * another machine, which the client was allowed to use with `allowInsecure`.
   */
  readonly transport: Transport;
  /**
   * Connects to the server: asks for its info and checks, for each protocol,
   * that this client can work with it. The answer is kept, so later calls
   * return it without a request, and calls made together share one request.
   * A server that doesn't work with this client is still connected: each
   * operation then fails with VERSION_UNSUPPORTED.
   * @throws {DropgateError} SERVER_UNREACHABLE, TIMED_OUT or OPERATION_CANCELLED if no answer came;
   * INVALID_RESPONSE if the answer wasn't a Dropgate server's; REDIRECT_NOT_FOLLOWED; RATE_LIMITED
   * or SERVER_ERROR.
   */
  connect(opts?: RequestOptions): Promise<ServerConnection>;
  /**
   * Asks the server for its info now, without keeping it or checking
   * compatibility.
   * @throws {DropgateError} As connect() does.
   */
  info(opts?: RequestOptions): Promise<ServerInfoResult>;
  /**
   * Listens for `insecure-transport`, which fires as the client connects to a
   * server it reaches over plain `http://` on another machine (so only with
   * `allowInsecure`). Returns a function that stops listening.
   * @throws {DropgateError} INVALID_ARGUMENT for any other event.
   */
  on(event: 'insecure-transport', listener: (event: InsecureTransportEvent) => void): () => void;
}

/** `client.hosted`: uploads to the server, and downloads from it. */
export interface HostedApi {
  /**
   * Uploads one or more files, encrypted if the server supports it unless
   * `encrypt` says otherwise: one file or several, each upload is one object
   * on the server, under one link, its list of files sealed with the rest for
   * an encrypted one. The completed value has the link
   * (`downloadUrl`, with the secret after its # for an encrypted upload), the
   * upload's `id`, and its `manageToken`, which only this sender has.
   *
   * Gives the upload's handle at once: `result` is its one outcome
   * (`completed` with the link, `cancelled`, or `failed` with a DropgateError),
   * which never rejects; `snapshot` and `subscribe()` say where it is; and
   * `cancel()` cancels it. A `signal` passed in feeds into its own cancel.
   * @throws {DropgateError} INVALID_ARGUMENT if there are no files, or one isn't a file, before an upload starts.
   */
  upload(opts: UploadOptions): UploadHandle;
  /**
   * Downloads an upload (`id`), decrypting it with the `secret` from its link
   * if it was encrypted, into `sink`: all of it, or the files `files` names,
   * for which only the chunks holding them are asked for. It takes one lease
   * from the server for the download, which is one download against the
   * upload's limit, and releases it as soon as the download ends, however it
   * ends. Core awaits each write to the sink and its close: the download only
   * completes once the sink has closed, and a write or close that fails fails
   * it, with OUTPUT_WRITE_FAILED. A failed or cancelled download aborts its sink.
   *
   * Gives the download's handle at once, as `upload()` does. For several
   * downloads that count as one, as a download page makes, use `open()`.
   * @throws {DropgateError} INVALID_ARGUMENT, before a download starts, if there's no id, or the
   * sink or files list isn't one the download can use.
   */
  download(opts: DownloadOptions): DownloadHandle;
  /**
   * Reads what the server holds about an upload (`id`): its files' names and
   * sizes, decrypting them with the `secret` from its link if it was
   * encrypted. It takes no lease and counts nothing.
   * @throws {DropgateError} NOT_FOUND if there's no such upload; KEY_REQUIRED if it's encrypted and
   * there's no secret; RUNTIME_UNSUPPORTED if it's encrypted and there's no Web Crypto here;
   * DECRYPT_FAILED if the secret doesn't open it; INTEGRITY_FAILED if what the server holds was
   * changed; VERSION_UNSUPPORTED if it was made in a format this version can't read; or a request's error.
   */
  metadata(opts: MetadataOptions): Promise<UploadMetadata>;
  /**
   * Opens an upload (`id`, with its `secret` if it's encrypted) for a page
   * that may download it several times, its files one by one and all of them
   * as a ZIP: its metadata is read now, with no lease, and every download of
   * it shares one lease, taken at the first, renewed every 2 minutes while
   * it's open and released by `close()`. However many downloads it makes, they
   * count as one; opened and closed with none, it counts nothing.
   * @throws {DropgateError} As metadata() does.
   */
  open(opts: OpenOptions): Promise<OpenedUpload>;
  /**
   * Checks files and upload settings against a server's limits, as `upload()`
   * does before it starts.
   * @throws {DropgateError} CAPABILITY_UNSUPPORTED, INVALID_ARGUMENT, FILE_EMPTY, FILE_TOO_LARGE
   * or LIFETIME_NOT_ALLOWED, for the first check that fails.
   */
  validate(opts: ValidateUploadOptions): true;
  /**
   * Deletes an upload (`id`) from the server at once, with the `manageToken`
   * its upload gave: its bytes and its details go, and a download of it under
   * way stops. Only whoever holds the token can: it's sent only in the
   * `Dropgate-Manage-Token` header, to this client's server, never in a URL,
   * and it's never in an error. No credential is needed.
   * @throws {DropgateError} INVALID_ARGUMENT, before any request, without an id or a token that
   * could be one; NOT_FOUND if the upload isn't there (it was deleted, expired, or downloaded as many
   * times as it allowed); REQUEST_REJECTED (403) if the token isn't this upload's; or a request's error.
   */
  delete(opts: DeleteOptions): Promise<void>;
}

/** `client.direct`: direct transfers, from one device to another. */
export interface DirectApi {
  /**
   * Starts sending, and waits for the receiver to connect with the code it gives.
   * @throws {DropgateError} VERSION_UNSUPPORTED; CAPABILITY_UNSUPPORTED if the server has direct
   * transfer turned off; or connect()'s errors.
   */
  send(opts: P2PSendFileOptions): Promise<P2PSendSession>;
  /**
   * Starts receiving from the sender with this code.
   * @throws {DropgateError} As send() does.
   */
  receive(opts: P2PReceiveFileOptions): Promise<P2PReceiveSession>;
}

/** `client.links`: sharing codes and links. */
export interface LinksApi {
  /**
   * Resolves a sharing code or link someone typed or pasted, into where to
   * open it on this server.
   *
   * The input is read on this device, and nothing of it is sent anywhere: the
   * server is only asked for its info (once, as `connect()` does), to check it
   * works with this client and whether it has direct transfer on. A link to
   * another server is refused. Whether an upload is there is for the page it
   * opens to find out. Anything after a # (an encrypted upload's secret) comes
   * back on the end of `target`, ready to open.
   * @throws {DropgateError} VERSION_UNSUPPORTED, or connect()'s errors.
   */
  resolve(value: string, opts?: RequestOptions): Promise<ShareTargetResult>;
}

/**
 * Resolve a server option (URL string or ServerTarget) to a base URL string.
 */
function resolveServerToBaseUrl(server: string | ServerTarget): string {
  if (typeof server === 'string') {
    return buildBaseUrl(parseServerUrl(server));
  }
  return buildBaseUrl(server);
}

/** The chunk size the server's uploads use, which its encrypted downloads come in. */
function serverChunkSize(serverInfo: ServerInfo, fallback: number): number {
  const size = serverInfo?.capabilities?.upload?.chunkSize;
  return Number.isFinite(size) && size! > 0 ? size! : fallback;
}

/** The listeners of a direct transfer whose events are given `transport`. */
const DIRECT_EVENTS = [
  'onStatus', 'onProgress', 'onMeta', 'onComplete', 'onCancel', 'onConnectionHealth',
  'onFileStart', 'onFileEnd', 'onResumeRequest',
] as const;

/** A protocol version the server gave, if it's one: whole numbers, major and minor. */
function protocolVersion(value: unknown): ProtocolVersion | null {
  if (!value || typeof value !== 'object') return null;
  const { major, minor } = value as { major?: unknown; minor?: unknown };
  if (!Number.isInteger(major) || !Number.isInteger(minor) || (major as number) < 0 || (minor as number) < 0) return null;
  return Object.freeze({ major: major as number, minor: minor as number });
}

/**
 * Whether this client's version of a protocol works with the server's: the
 * same major. A server that gives none is older than Dropgate 4.
 */
function checkProtocol(client: ProtocolVersion, given: unknown): ProtocolCompatibility {
  const server = protocolVersion(given);
  if (!server || server.major < client.major) {
    return {
      compatible: false, client, server, update: 'server',
      message: 'Update required: this server runs an older version of Dropgate. Its operator needs to update it.',
    };
  }
  if (server.major > client.major) {
    return {
      compatible: false, client, server, update: 'client',
      message: 'Update required: this server runs a newer version of Dropgate. Update this app to use it.',
    };
  }
  return { compatible: true, client, server, message: 'This server works with this version of Dropgate.' };
}

/** An upload's ID, as a Dropgate server makes them. It's put in a URL's path, so nothing else is. */
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The upload an operation names: by `id`, with its link's `secret`.
 * @throws {DropgateError} INVALID_ARGUMENT without an id.
 */
function hostedTarget(opts: Partial<MetadataOptions> | undefined): { id: string; secret?: string } {
  const { id } = opts ?? {};
  if (typeof id === 'string' && id) return { id, secret: opts?.secret };
  throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'An upload id is required.' });
}

/**
 * An unencrypted upload's list of files, as its metadata gives it, checked as
 * a list received from the server is: each name by the one rule, each size a
 * whole number of bytes from 1, and the sizes adding up to the upload's.
 */
function plainFiles(value: unknown, size: number): HostedFile[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FILES) {
    throw new DropgateError({ code: 'INVALID_RESPONSE', message: "The server's list of files wasn't understood." });
  }
  const files = value.map((file: unknown, index) => {
    const { name, size: fileSize } = (file ?? {}) as { name?: unknown; size?: unknown };
    if (typeof name !== 'string' || typeof fileSize !== 'number' || !Number.isSafeInteger(fileSize) || fileSize < 1) {
      throw new DropgateError({ code: 'INVALID_RESPONSE', message: "The server's list of files wasn't understood." });
    }
    validateFilename(name, { index, origin: 'server' });
    return { name, size: fileSize };
  });
  if (files.reduce((sum, file) => sum + file.size, 0) !== size) {
    throw new DropgateError({ code: 'INTEGRITY_FAILED', message: "The list of files doesn't fit the upload." });
  }
  return files;
}

/**
 * The indexes of the files a download asked for (all of them if it named
 * none), in the list's order.
 * @throws {DropgateError} INVALID_ARGUMENT for an index the list doesn't have.
 */
function chooseFiles(picked: number[] | undefined, count: number): number[] {
  if (!picked) return Array.from({ length: count }, (_, i) => i);
  if (picked.some((i) => i >= count)) {
    throw new DropgateError({ code: 'INVALID_ARGUMENT', message: "files names a file the upload doesn't have." });
  }
  return picked;
}

/** The error for an upload the server says it no longer has. */
function droppedUpload(cause: DropgateError): DropgateError {
  return new DropgateError({ code: 'NOT_FOUND', status: cause.status, message: 'The server dropped this upload.', cause });
}

/** The error for a paused upload the server no longer holds: its pause ran out. */
function droppedPausedUpload(cause?: DropgateError): DropgateError {
  return new DropgateError({ code: 'NOT_FOUND', status: cause?.status, message: 'The server dropped this paused upload.', ...(cause ? { cause } : {}) });
}

/** The error for a download whose lease the server no longer holds, paused or not. */
function droppedDownload(paused: boolean, cause?: DropgateError): DropgateError {
  return new DropgateError({
    code: 'NOT_FOUND',
    status: cause?.status,
    message: paused ? 'The server dropped this paused download.' : 'The server dropped this download.',
    ...(cause ? { cause } : {}),
  });
}

/** How long the server holds a paused upload or download, in ms: 0 when it has pausing turned off. */
function pauseLength(serverInfo: ServerInfo): number {
  const minutes = serverInfo?.capabilities?.upload?.maxPauseMinutes;
  return typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : 0;
}

/**
 * When a pause the server holds until `deadline` ends, in this device's time:
 * that deadline, or the server's pause length from now if that's later, so a
 * clock ahead of the server's never ends a pause the server still holds.
 */
function pausedUntil(deadline: unknown, pauseMs: number): number {
  if (typeof deadline !== 'number' || !Number.isFinite(deadline)) {
    throw new DropgateError({ code: 'INVALID_RESPONSE', message: "The server's answer to the pause wasn't understood." });
  }
  return Math.max(deadline, Date.now() + pauseMs);
}

/**
 * The chunks an upload's server holds, as it gives them: ranges of chunk
 * indexes, first and last included, each within the upload's `count` chunks.
 * @throws {DropgateError} INVALID_RESPONSE for anything else.
 */
function chunkRanges(value: unknown, count: number): Array<[number, number]> {
  const valid = Array.isArray(value) && value.every((range) => Array.isArray(range) && range.length === 2
    && Number.isSafeInteger(range[0]) && Number.isSafeInteger(range[1]) && range[0] >= 0 && range[0] <= range[1] && range[1] < count);
  if (!valid) throw new DropgateError({ code: 'INVALID_RESPONSE', message: "The server's list of the chunks it holds wasn't understood." });
  return value as Array<[number, number]>;
}

/** The error for an upload whose server couldn't be reached for as long as it waits for one. */
function unreachableTooLong(cause: DropgateError): DropgateError {
  if (cause.code === 'NOT_FOUND') return cause;
  return new DropgateError({
    code: 'NOT_FOUND',
    message: "The server dropped this upload: it couldn't be reached for longer than the server waits.",
    cause,
  });
}

/** How often an opened upload renews its lease: well inside the 5 minutes the server holds one with no request. */
const LEASE_RENEW_MS = 2 * 60 * 1000;

/** A download's lease: its ID, the upload's ETag, and how long the server holds it, as it last said. */
interface TakenLease {
  lease: string;
  etag: string;
  deadline: unknown;
}

/** What a lease's pause and resume requests run with: the download's window, signal and snapshot. */
interface LeaseRun {
  policy: RetryPolicy;
  window: RetryWindow;
  signal: AbortSignal;
  progress: (patch: Partial<DownloadSnapshot>) => void;
  /** Told a paused download's new deadline, from the server (null for none), when downloads sharing its lease change it. */
  deadline: (deadline: number | null) => void;
}

/** Where a download gets its upload's metadata, and the lease it's downloaded under. */
interface DownloadSource {
  read(compat: ServerConnection, signal: AbortSignal): Promise<{ meta: UploadMetadata; opened?: OpenedObject }>;
  lease: {
    take(baseUrl: string, opts: { timeoutMs: number; signal: AbortSignal; progress: (patch: Partial<DownloadSnapshot>) => void }): Promise<TakenLease>;
    /**
     * The download has paused: the server holds the lease for its pause length,
     * unless other downloads under it go on. Gives the server's deadline, or
     * null if nothing ends it.
     */
    pause(baseUrl: string, taken: TakenLease, run: LeaseRun): Promise<number | null>;
    /** The download goes on: the lease is renewed, which ends its pause. */
    resume(baseUrl: string, taken: TakenLease, run: LeaseRun): Promise<void>;
    /** The download has ended, however it ended, paused or not. */
    done(baseUrl: string, taken: TakenLease, run: LeaseRun | null, paused: boolean): Promise<void>;
  };
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

/** How long a server's `Retry-After` (in seconds) says to wait, within a minute, or `fallback`. */
function retryAfterMs(res: Response, fallback: number): number {
  const header = res.headers.get('Retry-After');
  const seconds = header === null || header.trim() === '' ? NaN : Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 60) * 1000 : fallback;
}

/**
 * Headless, environment-agnostic client for Dropgate file operations, by
 * feature: `client.hosted` uploads and downloads through the server,
 * `client.direct` transfers from one device to another, `client.links`
 * resolves sharing codes and links, `client.server` is the server, and
 * `client.operations` is what's running.
 *
 * Server connection is configured once in the constructor — every call uses
 * the stored server URL and cached server info automatically.
 */
export class DropgateClient {
  /** Core's own version, such as `4.0.0`. For display and logs: compatibility never depends on it. */
  static readonly version: string = CORE_VERSION;
  /**
   * The protocol versions core speaks, each on its own: `dgup` for hosted
   * transfers and `dgdtp` for direct ones. A server works with this client
   * for a protocol when it speaks the same major.
   */
  static readonly protocols: Protocols = PROTOCOLS;

  /** The app using core, as given to the constructor, for display and local logs. Never sent anywhere. */
  readonly appInfo?: Readonly<AppInfo>;
  /** Chunk size in bytes for upload splitting. */
  readonly chunkSize: number;
  /**
   * Fetch implementation used for HTTP requests. Every request it makes omits
   * credentials (no cookies), and follows no redirect.
   */
  readonly fetchFn: FetchFn;
  /** Base64 encoder/decoder for binary data. */
  readonly base64: Base64Adapter;

  /** Uploads to the server, and downloads from it. */
  readonly hosted: HostedApi;
  /** Direct transfers, from one device to another. */
  readonly direct: DirectApi;
  /** Sharing codes and links. */
  readonly links: LinksApi;
  /** The server the client was made for. */
  readonly server: ServerApi;
  /** What's running on the client, by each operation's ID. */
  readonly operations: Operations;

  /** The server's base URL (e.g. 'https://dropgate.link'). */
  private readonly baseUrl: string;
  /** How the server is reached: on every snapshot, result and error the client gives. */
  private readonly transport: Transport;
  /** Who hears `insecure-transport`. */
  private readonly _insecureListeners = new Set<(event: InsecureTransportEvent) => void>();
  /** Cached compatibility result (null until the first connect). */
  private _compat: ServerConnection | null = null;
  /** In-flight connect promise to deduplicate concurrent calls. */
  private _connectPromise: Promise<ServerConnection> | null = null;
  /** The running operations, and the root of the cancellation tree. */
  private _registry = new OperationRegistry();
  /** Every encrypt, decrypt, key, hash and random number the client uses. */
  private readonly _crypto: CryptoProvider;
  /** Where a credential comes from, for a server that asks for one: private, so it's never listed or serialised. */
  readonly #auth?: CredentialProvider;

  /**
   * Create a new DropgateClient instance.
   * @param opts - Client configuration options including server URL.
   * @throws {DropgateError} INVALID_ARGUMENT if server is missing or invalid, or appInfo isn't
   * `{ name, version? }` strings; INSECURE_TRANSPORT_NOT_ALLOWED for a server on plain `http://`
   * on another machine without `allowInsecure`; RUNTIME_UNSUPPORTED if there's no fetch() or crypto.
   */
  constructor(opts: DropgateClientOptions) {
    if (!opts?.server) {
      throw new DropgateError({
        code: 'INVALID_ARGUMENT',
        message: 'DropgateClient requires server (URL string or ServerTarget object).',
      });
    }

    const { appInfo } = opts;
    if (appInfo !== undefined) {
      const valid = appInfo !== null && typeof appInfo === 'object'
        && typeof appInfo.name === 'string' && appInfo.name.trim() !== ''
        && (appInfo.version === undefined || typeof appInfo.version === 'string');
      if (!valid) {
        throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'appInfo must be { name, version? }, as strings.' });
      }
      this.appInfo = Object.freeze({ name: appInfo.name, ...(appInfo.version !== undefined ? { version: appInfo.version } : {}) });
    }

    // The server, and whether it's reached securely, are settled here, before
    // anything can make a request: an insecure server is refused unless allowed.
    this.baseUrl = resolveServerToBaseUrl(opts.server);
    this.transport = Object.freeze({ secure: isSecureServerUrl(this.baseUrl) });
    if (!this.transport.secure && opts.allowInsecure !== true) throw insecureTransportNotAllowed();

    this.chunkSize = Number.isFinite(opts.chunkSize)
      ? opts.chunkSize!
      : DEFAULT_CHUNK_SIZE;

    const fetchFn = opts.fetchFn || getDefaultFetch();
    if (!fetchFn) {
      throw new DropgateError({ code: 'RUNTIME_UNSUPPORTED', message: 'No fetch() implementation found.', transport: this.transport });
    }
    this.fetchFn = guardedFetch(fetchFn);

    try {
      this._crypto = cryptoProvider();
    } catch (err) {
      throw withTransport(err, this.transport);
    }

    if (opts.auth !== undefined && typeof opts.auth !== 'function') {
      throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'auth must be a function giving { token } or null.', transport: this.transport });
    }
    this.#auth = opts.auth;

    this.base64 = opts.base64 || getDefaultBase64();

    // Every error a method gives, thrown or rejected, says how the server is reached.
    const transport = this.transport;
    const stamped = <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A): R => {
      let out: R;
      try {
        out = fn(...args);
      } catch (err) {
        throw withTransport(err, transport);
      }
      if (out instanceof Promise) return out.catch((err: unknown) => { throw withTransport(err, transport); }) as R;
      return out;
    };

    const client = this;
    this.server = Object.freeze({
      get baseUrl() { return client.baseUrl; },
      transport,
      connect: stamped((o?: RequestOptions) => this._connect(o)),
      info: stamped((o?: RequestOptions) => this._fetchInfo(o).then((serverInfo) => ({ ...serverInfo, transport }))),
      on: stamped((event: 'insecure-transport', listener: (e: InsecureTransportEvent) => void) => this._on(event, listener)),
    });
    this.hosted = Object.freeze({
      upload: stamped((o: UploadOptions) => this._upload(o)),
      download: stamped((o: DownloadOptions) => this._download(o)),
      metadata: stamped((o: MetadataOptions) => this._metadata(o)),
      open: stamped((o: OpenOptions) => this._open(o)),
      validate: stamped((o: ValidateUploadOptions) => this._validate(o)),
      delete: stamped((o: DeleteOptions) => this._delete(o)),
    });
    this.direct = Object.freeze({
      send: stamped((o: P2PSendFileOptions) => this._directSend(o)),
      receive: stamped((o: P2PReceiveFileOptions) => this._directReceive(o)),
    });
    this.links = Object.freeze({
      resolve: stamped((value: string, o?: RequestOptions) => this._resolve(value, o)),
    });
    this.operations = this._registry.api;
  }

  private _on(event: 'insecure-transport', listener: (e: InsecureTransportEvent) => void): () => void {
    if (event !== 'insecure-transport' || typeof listener !== 'function') {
      throw new DropgateError({ code: 'INVALID_ARGUMENT', message: "client.server.on() takes 'insecure-transport' and a listener." });
    }
    this._insecureListeners.add(listener);
    return () => { this._insecureListeners.delete(listener); };
  }

  /** Asks the server for its info. */
  private async _fetchInfo(opts?: RequestOptions): Promise<ServerInfo> {
    const { timeoutMs = 5000, signal } = opts ?? {};
    const { res, json } = await fetchJson(this.fetchFn, `${this.baseUrl}/api/info`, {
      method: 'GET',
      timeoutMs,
      signal,
      headers: { Accept: 'application/json' },
    });

    if (res.ok && json && typeof json === 'object' && 'version' in json) {
      return json as ServerInfo;
    }
    if (res.status === 429 || res.status >= 500) throw errorFromStatus(res.status, json);
    throw new DropgateError({
      code: 'INVALID_RESPONSE',
      status: res.status,
      message: "That server didn't answer as a Dropgate server does.",
    });
  }

  private async _connect(opts?: RequestOptions): Promise<ServerConnection> {
    // Return cached result if available
    if (this._compat) return this._compat;

    // Deduplicate concurrent connect calls
    if (!this._connectPromise) {
      this._connectPromise = this._fetchAndCheckCompat(opts).finally(() => {
        this._connectPromise = null;
      });
    }

    return this._connectPromise;
  }

  private async _fetchAndCheckCompat(opts?: RequestOptions): Promise<ServerConnection> {
    // One address, as given: never retried another way.
    let serverInfo: ServerInfo;
    try {
      serverInfo = await this._fetchInfo(opts);
    } catch (err) {
      throw toDropgateError(err, 'SERVER_UNREACHABLE');
    }

    const compat = this._checkVersionCompat(serverInfo);
    this._compat = Object.freeze({ ...compat, serverInfo, baseUrl: this.baseUrl, transport: this.transport });

    if (!this.transport.secure) {
      const event: InsecureTransportEvent = Object.freeze({ baseUrl: this.baseUrl, transport: this.transport });
      for (const listener of [...this._insecureListeners]) {
        try { listener(event); } catch { /* A listener's error is its own. */ }
      }
    }
    return this._compat;
  }

  /** Throws VERSION_UNSUPPORTED if this client and the server can't work together over `protocol`. */
  private _requireCompatible(compat: ServerConnection, protocol: ProtocolName): void {
    const check = compat[protocol];
    if (check.compatible) return;
    throw new DropgateError({
      code: 'VERSION_UNSUPPORTED',
      message: check.message,
      details: { component: protocol, update: check.update, client: check.client, server: check.server },
    });
  }

  /**
   * Whether this client works with the server, for each protocol on its own
   * (no network calls). The server's own version is for display only.
   */
  private _checkVersionCompat(serverInfo: ServerInfo): CompatibilityResult {
    const serverVersion = typeof serverInfo?.version === 'string' ? serverInfo.version : '';
    return {
      dgup: checkProtocol(PROTOCOLS.dgup, serverInfo?.protocols?.dgup),
      dgdtp: checkProtocol(PROTOCOLS.dgdtp, serverInfo?.protocols?.dgdtp),
      serverVersion,
    };
  }

  private async _resolve(value: string, opts?: RequestOptions): Promise<ShareTargetResult> {
    const transport = this.transport;
    const refused = (reason: string): ShareTargetResult => ({ valid: false, reason, transport });
    const input = parseShareInput(value);
    if (!input) return refused(/^\s*https?:\/\//i.test(String(value ?? '')) ? 'Unrecognised sharing link.' : 'Unrecognised sharing code.');

    // The scheme may differ behind a TLS proxy, so only the host and port are compared.
    if (input.linkHost !== undefined && input.linkHost !== new URL(this.baseUrl).host) {
      return refused('URL must be from this server.');
    }

    // Only the server's info is asked for (and kept): whether it works with
    // this client, and whether it has direct transfer on.
    const compat = await this._connect(opts);
    this._requireCompatible(compat, 'dgup');
    if (input.kind === 'direct') {
      if (!compat.serverInfo?.capabilities?.p2p?.enabled) return refused('Direct transfer is disabled on this server.');
      return { valid: true, type: 'p2p', target: `/p2p/${encodeURIComponent(input.locator)}`, transport };
    }
    // An upload's page says whether it's there. The secret stays on the end, for that page.
    const path = input.kind === 'bundle' ? `/b/${input.locator}` : `/${input.locator}`;
    return { valid: true, type: input.kind, target: input.secret ? `${path}#${input.secret}` : path, transport };
  }

  private async _metadata(opts: MetadataOptions): Promise<UploadMetadata> {
    const target = hostedTarget(opts);
    const compat = await this._connect(opts);
    this._requireCompatible(compat, 'dgup');
    return (await this._readObject(target.id, target.secret, compat, opts)).meta;
  }

  /**
   * Reads an upload's metadata, which takes no lease and counts nothing. An
   * encrypted one's header is checked and its list of files opened with the
   * link's secret, before any of its content is asked for; the opened object
   * is given too, for its download.
   */
  private async _readObject(
    id: string,
    secret: string | undefined,
    compat: ServerConnection,
    { timeoutMs = 5000, signal }: RequestOptions,
  ): Promise<{ meta: UploadMetadata; opened?: OpenedObject }> {
    if (!UPLOAD_ID.test(id)) throw new DropgateError({ code: 'NOT_FOUND' });
    const { res, json } = await fetchJson(this.fetchFn, `${compat.baseUrl}/api/v4/objects/${id}`, {
      method: 'GET', timeoutMs, signal, headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw errorFromStatus(res.status, json, "Failed to fetch the upload's details.");
    const raw = (json ?? {}) as { encrypted?: unknown; size?: unknown; header?: unknown; meta?: unknown; files?: unknown };
    const size = raw.size;
    if (typeof raw.encrypted !== 'boolean' || typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1) {
      throw new DropgateError({ code: 'INVALID_RESPONSE', message: "The server's details of the upload weren't understood." });
    }

    let files: HostedFile[];
    let opened: OpenedObject | undefined;
    if (raw.encrypted) {
      // A missing secret, and no Web Crypto, are both found before anything is decrypted.
      if (!secret) throw new DropgateError({ code: 'KEY_REQUIRED' });
      if (!this._crypto.canEncrypt) {
        throw new DropgateError({
          code: 'RUNTIME_UNSUPPORTED',
          message: 'Web Crypto API not available for decryption. Encrypted uploads need a secure context (HTTPS or localhost).',
        });
      }
      const header = base64urlToBytes(raw.header, HEADER_BYTES, this.base64);
      const meta = base64urlToBytes(raw.meta, undefined, this.base64);
      if (!header || !meta) {
        throw new DropgateError({ code: 'INVALID_RESPONSE', message: "The server's details of the upload weren't understood." });
      }
      const secretBytes = base64urlToBytes(secret, SECRET_BYTES, this.base64);
      if (!secretBytes) throw new DropgateError({ code: 'DECRYPT_FAILED' });
      opened = await openObject(this._crypto, { secret: secretBytes, header, meta, size });
      files = opened.files.map(({ name, size: fileSize }) => ({ name, size: fileSize }));
    } else {
      files = plainFiles(raw.files, size);
    }

    return {
      meta: {
        kind: files.length === 1 ? 'file' : 'bundle',
        id,
        encrypted: raw.encrypted,
        files,
        totalSize: files.reduce((sum, file) => sum + file.size, 0),
        transport: this.transport,
      },
      opened,
    };
  }

  private async _delete(opts: DeleteOptions): Promise<void> {
    const { id, manageToken, timeoutMs = 5000, signal } = opts ?? ({} as DeleteOptions);
    // The token is 32 bytes as URL-safe base64; anything else is never sent. Neither is ever repeated.
    if (typeof id !== 'string' || !id || typeof manageToken !== 'string' || !base64urlToBytes(manageToken, 32, this.base64)) {
      throw new DropgateError({ code: 'INVALID_ARGUMENT', message: "Deleting an upload needs its id, and the manageToken its upload gave." });
    }
    if (!UPLOAD_ID.test(id)) throw new DropgateError({ code: 'NOT_FOUND' });
    const compat = await this._connect({ timeoutMs, signal });
    this._requireCompatible(compat, 'dgup');
    const { res, json } = await fetchJson(this.fetchFn, `${compat.baseUrl}/api/v4/objects/${id}`, {
      method: 'DELETE', timeoutMs, signal,
      headers: { Accept: 'application/json', 'Dropgate-Manage-Token': manageToken },
    });
    if (!res.ok) throw errorFromStatus(res.status, json, "The upload couldn't be deleted.");
  }

  private _validate(opts: ValidateUploadOptions): true {
    const { files: rawFiles, lifetimeMs, serverInfo } = opts;
    const caps = serverInfo?.capabilities?.upload;
    // As upload() does: encrypted unless told otherwise, where the server supports it.
    const encrypt = opts.encrypt ?? Boolean(caps?.e2ee);

    if (!caps || !caps.enabled) {
      throw new DropgateError({
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'Server does not support file uploads.',
        details: { capability: 'upload' },
      });
    }

    const files = toFileSources(rawFiles);
    if (files.length === 0) {
      throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'At least one file is required.' });
    }
    if (files.length > MAX_FILES) {
      throw new DropgateError({ code: 'INVALID_ARGUMENT', message: `An upload holds 1 to ${MAX_FILES} files.` });
    }

    // Validate each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileSize = Number(file?.size);
      if (!file || !Number.isFinite(fileSize) || fileSize < 0) {
        throw new DropgateError({ code: 'INVALID_ARGUMENT', message: `File at index ${i} is missing or invalid.`, details: { index: i } });
      }
      if (fileSize === 0) {
        throw new DropgateError({ code: 'FILE_EMPTY', details: { index: i } });
      }
    }

    // maxSizeMB: 0 means unlimited. One file or several, an upload is stored
    // as one object, with its header, tags and padding (which never makes it
    // too large), and the limit is on the whole of it.
    const maxMB = Number(caps.maxSizeMB);
    if (Number.isFinite(maxMB) && maxMB > 0) {
      const limitBytes = mbToBytes(maxMB);
      const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
      const estimatedBytes = estimateUploadBytes(totalBytes, {
        encrypted: encrypt, chunkSize: serverChunkSize(serverInfo, this.chunkSize), maxBytes: limitBytes,
      });
      if (estimatedBytes > limitBytes) {
        const what = files.length === 1 ? 'File at index 0 too large' : 'These files are too large together';
        const msg = encrypt
          ? `${what} once encryption overhead is included. Server limit: ${maxMB} MB.`
          : `${what}. Server limit: ${maxMB} MB.`;
        throw new DropgateError({ code: 'FILE_TOO_LARGE', message: msg, ...(files.length === 1 ? { details: { index: 0 } } : {}) });
      }
    }

    // maxLifetimeHours: 0 means unlimited is allowed
    const maxHours = Number(caps.maxLifetimeHours);
    const lt = Number(lifetimeMs);
    if (!Number.isFinite(lt) || lt < 0 || !Number.isInteger(lt)) {
      throw new DropgateError({
        code: 'INVALID_ARGUMENT',
        message: 'Invalid lifetime. Must be a non-negative integer (milliseconds).',
      });
    }

    if (Number.isFinite(maxHours) && maxHours > 0) {
      const limitMs = Math.round(maxHours * 60 * 60 * 1000);
      if (lt === 0) {
        throw new DropgateError({
          code: 'LIFETIME_NOT_ALLOWED',
          message: `Server does not allow unlimited file lifetime. Max: ${maxHours} hours.`,
        });
      }
      if (lt > limitMs) {
        throw new DropgateError({
          code: 'LIFETIME_NOT_ALLOWED',
          message: `File lifetime too long. Server limit: ${maxHours} hours.`,
        });
      }
    }

    // Encryption support
    if (encrypt && !caps.e2ee) {
      throw new DropgateError({
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'End-to-end encryption is not supported on this server.',
        details: { capability: 'e2ee' },
      });
    }

    return true;
  }

  private _upload(opts: UploadOptions): UploadHandle {
    const {
      files: rawFiles,
      lifetimeMs,
      encrypt,
      maxDownloads,
      filenameOverrides,
      signal,
      timeouts = {},
      retry = {},
    } = opts;

    const files = toFileSources(rawFiles);
    if (files.length === 0) {
      throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'At least one file is required.' });
    }

    // The upload in progress, by its ID, until it's finished.
    let currentObjectUpload: string | null = null;
    const totalSizeBytes = files.reduce((sum, f) => sum + f.size, 0);
    // The upload's credential, only if its server asks for one: every request
    // the upload makes, its cancel included, carries it, and nothing else does.
    let credentials = OperationCredentials.none;

    const cancelObjectUpload = async (uploadId: string): Promise<void> => {
      try {
        await fetchJson(this.fetchFn, `${this.baseUrl}/api/v4/upload`, {
          method: 'DELETE', timeoutMs: 5000,
          headers: { Accept: 'application/json', 'Dropgate-Upload': uploadId, ...credentials.headers() },
        });
      } catch { /* Best effort */ }
    };

    const work = async (ctx: OperationContext<UploadSnapshot>): Promise<UploadResult> => {
      // Every request uses the upload's own node's signal, so its cancel(),
      // client.operations.cancelAll() and a signal passed in all stop it.
      const effectiveSignal = ctx.signal;
      const progress = ctx.update;
      // A request with the credential, made once more with a renewed one if
      // the server says it has expired.
      const send = async (url: string, init: FetchJsonOptions): Promise<FetchJsonResult> => {
        const attempt = () => fetchJson(this.fetchFn, url, { ...init, headers: { ...(init.headers as Record<string, string>), ...credentials.headers() } });
        const out = await attempt();
        if (credentialExpired(out.res.status, out.json) && await credentials.renew(effectiveSignal)) return attempt();
        return out;
      };

      // 1) Resolve filenames, and check every one, encrypted or not, before
      // anything is sent: the one file name rule.
      const filenames = files.map((f, i) => filenameOverrides?.[i] ?? f.name ?? 'file');
      filenames.forEach((name, index) => validateFilename(name, { index }));

      // 0) Get server info + compat (uses cache)
      const compat = await this._connect({
        timeoutMs: timeouts.serverInfoMs ?? 5000,
        signal: effectiveSignal,
      });

      const { baseUrl, serverInfo } = compat;
      progress({ phase: 'server-compat', text: compat.dgup.message });
      this._requireCompatible(compat, 'dgup');

      // Resolve encrypt option: default to true if server supports E2EE
      const serverSupportsE2EE = Boolean(serverInfo?.capabilities?.upload?.e2ee);
      const effectiveEncrypt = encrypt ?? serverSupportsE2EE;

      this._validate({ files, lifetimeMs, encrypt: effectiveEncrypt, serverInfo });

      // The credential, asked for only if the server says an upload needs one.
      if (serverInfo?.capabilities?.upload?.credentialRequired === true) {
        credentials = await OperationCredentials.required(this.#auth, 'hosted.upload', baseUrl, effectiveSignal);
      }

      // What can recover is retried until the server stops waiting, or `retries` times if that's set.
      const policy = retryPolicy(retry);

      // One file or several: one Dropgate 4 object.
      return this._uploadObject({
        files, names: filenames, encrypted: effectiveEncrypt, lifetimeMs, maxDownloads,
        compat, progress, signal: effectiveSignal, pausing: ctx.pausing, send, credentials, timeouts, policy,
        started: (uploadId) => { currentObjectUpload = uploadId; },
        finished: () => { currentObjectUpload = null; },
      });
    };

    return this._registry.add(startOperation<UploadResult, UploadSnapshot>({
      kind: 'hosted.upload',
      parent: this._registry.scope,
      transport: this.transport,
      signal,
      initial: {
        status: 'initializing', phase: 'server-info', text: 'Checking server...',
        percent: 0, processedBytes: 0, totalBytes: totalSizeBytes,
      },
      work: (ctx) => {
        // However it's cancelled, the server is told to discard what it has.
        ctx.scope.onCancel(() => {
          if (currentObjectUpload) cancelObjectUpload(currentObjectUpload).catch(() => { });
        });
        return work(ctx);
      },
      finalSnapshot: (outcome, last) => {
        if (outcome.status === 'completed') {
          return { ...last, status: 'completed', phase: 'done', text: 'Upload successful!', percent: 100, processedBytes: totalSizeBytes };
        }
        if (outcome.status === 'cancelled') return { ...last, status: 'cancelled', text: 'Upload cancelled.' };
        return { ...last, status: 'failed', text: outcome.error.message };
      },
      onEnd: (handle) => this._registry.remove(handle),
    }));
  }

  /**
   * Uploads one file or several as one Dropgate 4 object, the files' bytes one
   * after another: started with its header, sealed list of files and the
   * manage token's SHA-256, sent chunk by chunk (each chunk
   * of an encrypted one sealed once, and those same bytes sent again on a
   * retry), then finished. Gives the link, with the secret after its # for an
   * encrypted one, and the manage token: nothing else ever holds either.
   */
  private async _uploadObject(p: {
    files: FileSource[];
    names: string[];
    encrypted: boolean;
    lifetimeMs: number;
    maxDownloads?: number;
    compat: ServerConnection;
    progress: (patch: Partial<UploadSnapshot>) => void;
    signal: AbortSignal;
    pausing: PauseControl;
    send: (url: string, init: FetchJsonOptions) => Promise<FetchJsonResult>;
    credentials: OperationCredentials;
    timeouts: NonNullable<UploadOptions['timeouts']>;
    policy: RetryPolicy;
    started: (uploadId: string) => void;
    finished: () => void;
  }): Promise<UploadResult> {
    const { encrypted, compat, progress, signal, send, timeouts } = p;
    const { baseUrl, serverInfo } = compat;
    const chunkSize = serverChunkSize(serverInfo, this.chunkSize);
    if (!isChunkSize(chunkSize)) {
      throw new DropgateError({ code: 'INVALID_RESPONSE', message: "The server's chunk size isn't one this version of Dropgate can use." });
    }
    const maxMB = Number(serverInfo?.capabilities?.upload?.maxSizeMB);
    const maxBytes = Number.isFinite(maxMB) && maxMB > 0 ? mbToBytes(maxMB) : 0;
    const sources = p.files;
    const files = sources.map((source, i) => ({ name: p.names[i], size: source.size }));
    // 1 to 1,000 files, each name by the one rule: checked for every upload, before anything is sent.
    checkFiles(files);
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const several = files.length > 1;

    // The manage token deletes the upload: only its SHA-256 is sent, and the
    // token itself is given in the result alone.
    const manageToken = this._crypto.randomBytes(32);
    const manageTokenHash = bytesToBase64url(await this._crypto.sha256(manageToken), this.base64);

    // Encrypted, the object is sealed from a new secret, padded within the
    // server's limit; unencrypted, it's the file's bytes as they are.
    let writer: ObjectWriter | null = null;
    let layout: ObjectLayout;
    if (encrypted) {
      if (!this._crypto.canEncrypt) {
        throw new DropgateError({
          code: 'RUNTIME_UNSUPPORTED',
          message: 'Web Crypto API not available. Encryption requires a secure context (HTTPS or localhost).',
        });
      }
      progress({ phase: 'crypto', text: 'Preparing encryption...' });
      try {
        writer = await createObject(this._crypto, { files, chunkSize, maxBytes });
      } catch (err) {
        throw DropgateError.is(err) ? err : new DropgateError({ code: 'ENCRYPT_FAILED', cause: err });
      }
      layout = writer.layout;
    } else {
      layout = ObjectLayout.plain(totalSize, chunkSize);
    }

    progress({ phase: 'init', text: 'Reserving server storage...' });
    const start = await send(`${baseUrl}/api/v4/uploads`, {
      method: 'POST',
      timeoutMs: timeouts.initMs ?? 15000,
      signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        encrypted,
        size: layout.storedSize,
        ...(writer
          ? { header: bytesToBase64url(writer.header, this.base64), meta: bytesToBase64url(writer.meta, this.base64) }
          : { files }),
        lifetimeMs: p.lifetimeMs,
        ...(p.maxDownloads !== undefined ? { maxDownloads: p.maxDownloads } : {}),
        manageTokenHash,
      }),
    });
    if (!start.res.ok) throw errorFromStatus(start.res.status, start.json, 'The server refused to start the upload.');
    const { uploadId, chunks, deadline } = (start.json ?? {}) as { uploadId?: unknown; chunks?: unknown; deadline?: unknown };
    if (typeof uploadId !== 'string' || !uploadId || chunks !== layout.chunkCount) {
      throw new DropgateError({ code: 'INVALID_RESPONSE', message: "The server's answer to starting the upload wasn't understood." });
    }
    p.started(uploadId);
    // How long the server waits for the next request: every answer moves it on.
    const window = new RetryWindow();
    window.heard(deadline);

    const sizes = files.map((f) => f.size);
    const totalChunks = layout.chunkCount;
    // The chunks the server holds, as it last said, and every chunk it has ever
    // said it holds: those are never read or sealed again.
    let held = new Uint8Array(totalChunks);
    const taken = new Uint8Array(totalChunks);
    // The chunk being sent, with its bytes and their digest, until the server
    // has it: a retry, or a resume after a pause, sends exactly these again.
    let sending = null as { index: number; body: Uint8Array<ArrayBuffer>; digest: string } | null;

    // A pause stops the chunk being sent and asks the server to hold the
    // upload; a resume asks it to go on, and which chunks it holds.
    const pauseMs = pauseLength(serverInfo);
    const pauseRequest = (route: 'pause' | 'resume', dropped: (err: DropgateError) => DropgateError) => retrying(async () => {
      const out = await send(`${baseUrl}/api/v4/upload/${route}`, {
        method: 'POST', timeoutMs: timeouts.initMs ?? 15000, signal,
        headers: { Accept: 'application/json', 'Dropgate-Upload': uploadId },
      });
      if (out.res.ok) return (out.json ?? {}) as { deadline?: unknown; received?: unknown };
      const err = errorFromStatus(out.res.status, out.json, `The upload couldn't be ${route === 'pause' ? 'paused' : 'resumed'}.`);
      throw err.code === 'NOT_FOUND' ? dropped(err) : withRetryAfter(err, out.res);
    }, {
      policy: p.policy, window, signal,
      random: (length) => this._crypto.randomBytes(length),
      waiting: ({ remainingMs }) => progress({
        text: `${route === 'pause' ? 'Pausing' : 'Resuming'} failed. Retrying in ${(remainingMs / 1000).toFixed(1)}s...`,
        deadline: window.end,
      }),
      expired: unreachableTooLong,
    });
    const hooks: PauseHooks = {
      pause: async () => {
        const said = await pauseRequest('pause', droppedUpload);
        const until = pausedUntil(said.deadline, pauseMs);
        window.heard(until);
        return until;
      },
      resume: async () => {
        const said = await pauseRequest('resume', droppedPausedUpload);
        const received = chunkRanges(said.received, totalChunks);
        // What the server holds now is what it said: the rest is sent from where the upload stopped.
        held = new Uint8Array(totalChunks);
        for (const [first, last] of received) held.fill(1, first, last + 1);
        for (let i = 0; i < totalChunks; i++) {
          if (held[i]) {
            taken[i] = 1;
            writer?.confirm(i);
          }
        }
        window.heard(said.deadline);
      },
      expired: () => droppedPausedUpload(),
    };
    if (pauseMs > 0) p.pausing.allow(hooks);
    else p.pausing.turnedOff();
    progress({ status: 'uploading', ...(several ? { totalFiles: files.length } : {}) });

    for (let next = 0; ;) {
      // Paused here, it goes on once resumed, from the first chunk the server lacks.
      if (await p.pausing.checkpoint()) next = 0;
      while (next < totalChunks && held[next]) next++;
      if (next === totalChunks) {
        // Every chunk is there: nothing can pause the finish, but a pause that came just before it holds.
        p.pausing.allow(null);
        if (!(await p.pausing.checkpoint())) break;
        if (pauseMs > 0) p.pausing.allow(hooks);
        next = 0;
        continue;
      }
      const i = next;

      // The parts of the files the chunk holds, in order; an encrypted one's last may end in padding.
      const { parts } = layout.chunkParts(i, sizes);
      const processedBytes = Math.min(totalSize, i * chunkSize);
      progress({
        phase: 'chunk',
        text: `Uploading chunk ${i + 1} of ${totalChunks}...`,
        percent: (processedBytes / totalSize) * 100,
        processedBytes,
        chunkIndex: i, totalChunks,
        deadline: null,
        // The file the chunk starts in; a chunk of padding alone is still the last file's.
        ...(several ? { fileIndex: parts[0]?.file ?? files.length - 1 } : {}),
      });

      if (sending?.index !== i) {
        // A chunk the server said it held, and no longer does: its bytes were
        // let go, and an encrypted chunk is never sealed twice.
        if (taken[i]) {
          throw new DropgateError({ code: 'INVALID_RESPONSE', message: 'The server no longer holds part of this upload that it had taken.' });
        }
        // Bounded reads: each file's part of the chunk, and no more of it.
        let body: Uint8Array<ArrayBuffer>;
        if (parts.length === 1 && !writer) {
          body = await readRange(sources[parts[0].file], parts[0].offset, parts[0].offset + parts[0].length);
        } else {
          // The rest of an encrypted chunk is padding, which is zero bytes.
          const plaintext = new Uint8Array(layout.chunkLength(i));
          let at = 0;
          for (const part of parts) {
            plaintext.set(await readRange(sources[part.file], part.offset, part.offset + part.length), at);
            at += part.length;
          }
          body = writer ? await writer.seal(i, plaintext) : plaintext;
        }
        sending = { index: i, body, digest: this.base64.encode(await this._crypto.sha256(body)) };
      }

      const { body, digest } = sending;
      try {
        await this._attemptChunkUpload(
          `${baseUrl}/api/v4/upload/chunks/${i}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Digest': `sha-256=:${digest}:`,
              'Dropgate-Upload': uploadId,
            },
            body: new Blob([body]),
          },
          { policy: p.policy, window, timeoutMs: timeouts.chunkMs ?? 60000, signal: p.pausing.signal, progress, chunkIndex: i, credentials: p.credentials },
        );
      } catch (err) {
        // Stopped for a pause: the same bytes go once it's resumed, if the server hasn't got them.
        if (p.pausing.interrupted) continue;
        throw err;
      }
      held[i] = 1;
      taken[i] = 1;
      writer?.confirm(i);
      sending = null;
      next = i + 1;
    }

    progress({ status: 'completing', phase: 'complete', text: 'Finalising upload...', percent: 100, processedBytes: totalSize });
    // The finish gives the same answer if it's asked again, so it's retried as a chunk is.
    const finish = await retrying(async () => {
      const out = await send(`${baseUrl}/api/v4/upload/complete`, {
        method: 'POST',
        timeoutMs: timeouts.completeMs ?? 30000,
        signal,
        headers: { Accept: 'application/json', 'Dropgate-Upload': uploadId },
      });
      if (out.res.ok) return out;
      const err = errorFromStatus(out.res.status, out.json, 'Finalisation failed.');
      throw err.code === 'NOT_FOUND' ? droppedUpload(err) : withRetryAfter(err, out.res);
    }, {
      policy: p.policy, window, signal,
      random: (length) => this._crypto.randomBytes(length),
      waiting: ({ remainingMs }) => progress({ text: `Finalising failed. Retrying in ${(remainingMs / 1000).toFixed(1)}s...`, deadline: window.end }),
      retrying: () => progress({ text: 'Finalising upload...' }),
      expired: unreachableTooLong,
    });
    const id = (finish.json as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !UPLOAD_ID.test(id)) {
      throw new DropgateError({ code: 'INVALID_RESPONSE', message: 'Server did not return a valid upload id.' });
    }
    p.finished();

    return {
      downloadUrl: writer ? `${baseUrl}/${id}#${bytesToBase64url(writer.secret(), this.base64)}` : `${baseUrl}/${id}`,
      id,
      manageToken: bytesToBase64url(manageToken, this.base64),
      files,
      transport: this.transport,
    };
  }

  private _download(opts: DownloadOptions): DownloadHandle {
    const { id, secret } = hostedTarget(opts);
    return this._startDownload(opts, {
      read: async (compat, signal) => this._readObject(id, secret, compat, { timeoutMs: opts.timeoutMs ?? 60000, signal }),
      // One lease for this download alone, paused with it, and released as it ends.
      lease: {
        take: (baseUrl, waitOpts) => this._takeLease(baseUrl, id, waitOpts),
        pause: (baseUrl, taken, run) => this._pauseLease(baseUrl, taken, run),
        resume: (baseUrl, taken, run) => this._renewLease(baseUrl, taken, run),
        done: (baseUrl, taken) => this._releaseLease(baseUrl, taken.lease),
      },
    });
  }

  /**
   * Checks a download's sink and files list, then starts it as an operation:
   * `read` gives the upload's metadata and opened object, and `lease` the
   * lease it's downloaded under.
   */
  private _startDownload(opts: DownloadSinkOptions, how: DownloadSource): DownloadHandle {
    const { asZip, sink, signal, timeoutMs = 60000 } = opts;
    // A download cut off is continued until the server stops holding its lease, or `retries` times if that's set.
    const policy = retryPolicy(opts.retry);
    const picked = opts.files;
    if (picked !== undefined && (!Array.isArray(picked) || picked.length === 0
      || picked.some((i) => !Number.isSafeInteger(i) || i < 0) || new Set(picked).size !== picked.length)) {
      throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'files lists which files to download, by index, each once.' });
    }
    // In the list's order.
    const chosenIndexes = picked ? [...picked].sort((a, b) => a - b) : undefined;
    // The sink is checked before anything starts: one sink for a single file
    // or a ZIP, and a function giving one per file for several files apart.
    const zipped = Boolean(asZip);
    const sinkFits = typeof sink === 'function' ? !zipped : isDownloadSink(sink);
    if (!sinkFits) {
      throw new DropgateError({
        code: 'INVALID_ARGUMENT',
        message: !sink
          ? 'A download needs a sink, with write() and close(), for its bytes.'
          : zipped
            ? 'Files downloaded as a ZIP need one sink, with write() and close().'
            : 'The sink needs write() and close(), or must be a function giving a sink.',
      });
    }

    return this._registry.add(startOperation<DownloadResult, DownloadSnapshot>({
      kind: 'hosted.download',
      parent: this._registry.scope,
      transport: this.transport,
      signal,
      initial: { status: 'initializing', phase: 'server-info', text: 'Checking server...', percent: 0, processedBytes: 0, totalBytes: 0 },
      work: (ctx) => this._downloadObject(ctx, { sink, zipped, files: chosenIndexes, timeoutMs, policy, how }),
      finalSnapshot: (outcome, last) => {
        if (outcome.status === 'completed') {
          return { ...last, status: 'completed', phase: 'done', text: 'Download complete!', percent: 100, processedBytes: outcome.value.receivedBytes };
        }
        if (outcome.status === 'cancelled') return { ...last, status: 'cancelled', text: 'Download cancelled.' };
        return { ...last, status: 'failed', text: outcome.error.message };
      },
      onEnd: (handle) => this._registry.remove(handle),
    }));
  }

  /**
   * Opens an upload for a page that may download it several times: its
   * metadata now, with no lease; then one lease, taken at the first download,
   * renewed every 2 minutes, shared by every download, and released at close().
   */
  private async _open(opts: OpenOptions): Promise<OpenedUpload> {
    const { id, secret } = hostedTarget(opts);
    const compat = await this._connect(opts);
    this._requireCompatible(compat, 'dgup');
    const { baseUrl } = compat;
    const read = await this._readObject(id, secret, compat, opts);

    // The lease, once a download has taken it; and the take under way, which downloads started together share.
    let lease: TakenLease | null = null;
    let taking: Promise<TakenLease> | null = null;
    let renewTimer: ReturnType<typeof setInterval> | null = null;
    let closed = false;
    // Ends a take that's waiting for a place, when the upload is closed.
    const closing = new AbortController();
    const running = new Set<DownloadHandle>();

    // The downloads under the lease that are running, and the ones paused, told
    // their deadline as it changes; and whether the server holds it paused.
    let active = 0;
    const paused = new Set<LeaseRun>();
    let leasePaused = false;

    const stopRenewing = () => {
      if (renewTimer !== null) clearInterval(renewTimer);
      renewTimer = null;
    };
    const startRenewing = () => {
      if (renewTimer !== null || !lease) return;
      renewTimer = setInterval(() => { renew().catch(() => { }); }, LEASE_RENEW_MS);
      // A page or app that never closes it doesn't keep Node.js running for it.
      (renewTimer as { unref?: () => void }).unref?.();
    };
    // Nothing under the lease runs, and a download is paused: it's no longer
    // renewed, and the server holds it for its pause length, which each paused
    // download is told. Without `run`, best effort: if the server can't be
    // asked, it's renewed as before.
    const pauseLease = async (held: TakenLease, run: LeaseRun | null): Promise<number | null> => {
      stopRenewing();
      leasePaused = true;
      let deadline: number | null;
      if (run) {
        deadline = await this._pauseLease(baseUrl, held, run);
      } else {
        try {
          const { res, json } = await fetchJson(this.fetchFn, `${baseUrl}/api/v4/lease/pause`, {
            method: 'POST', timeoutMs: 5000, headers: { Accept: 'application/json', 'Dropgate-Lease': held.lease },
          });
          const said = (json as { deadline?: unknown } | null)?.deadline;
          if (!res.ok || typeof said !== 'number') throw new DropgateError({ code: 'INVALID_RESPONSE' });
          deadline = said;
        } catch {
          leasePaused = false;
          startRenewing();
          return null;
        }
      }
      for (const other of paused) if (other !== run) other.deadline(deadline);
      return deadline;
    };
    // A download under the lease runs again: it's renewed again, and nothing ends the paused ones.
    const unpauseLease = () => {
      if (!leasePaused) return;
      leasePaused = false;
      startRenewing();
      for (const other of paused) other.deadline(null);
    };
    const renew = async () => {
      const held = lease;
      if (!held) return;
      try {
        const { res, json } = await fetchJson(this.fetchFn, `${baseUrl}/api/v4/lease/renew`, {
          method: 'POST', timeoutMs: 5000, headers: { Accept: 'application/json', 'Dropgate-Lease': held.lease },
        });
        if (res.ok) {
          held.deadline = (json as { deadline?: unknown } | null)?.deadline;
        } else if (res.status === 404 && lease === held) {
          // It ended (it was deleted, or ran out while nothing could renew it): the next download takes another.
          lease = null;
          stopRenewing();
        }
      } catch { /* Tried again in 2 minutes; the server holds it for 5. */ }
    };

    const shared: DownloadSource['lease'] = {
      take: async (leaseUrl, waitOpts) => {
        if (closed) throw new DropgateError({ code: 'OPERATION_CANCELLED' });
        let taken = lease;
        if (!taken) {
          taking ??= this._takeLease(leaseUrl, id, { ...waitOpts, signal: closing.signal })
            .then((got) => {
              lease = got;
              startRenewing();
              return got;
            })
            .finally(() => { taking = null; });
          // A download cancelled while the take waits stops waiting; the take goes on for the others.
          taken = await untilAborted(taking, waitOpts.signal);
        }
        // Its bytes end the server's pause of the lease, if it was paused.
        active++;
        unpauseLease();
        return taken;
      },
      // One download paused holds the lease paused only once none under it runs.
      pause: async (_leaseUrl, taken, run) => {
        active--;
        paused.add(run);
        if (active > 0) return null;
        try {
          return await pauseLease(taken, run);
        } catch (err) {
          active++;
          paused.delete(run);
          leasePaused = false;
          startRenewing();
          throw err;
        }
      },
      resume: async (_leaseUrl, taken, run) => {
        await this._renewLease(baseUrl, taken, run);
        paused.delete(run);
        active++;
        unpauseLease();
      },
      // Downloads share the lease: only close() releases it. The last one
      // running to end, with another paused, leaves the lease paused.
      done: async (_leaseUrl, taken, run, wasPaused) => {
        if (wasPaused) {
          if (run) paused.delete(run);
          return;
        }
        active--;
        if (active === 0 && paused.size > 0 && lease === taken && !closed) await pauseLease(taken, null);
      },
    };

    const hidden = '[DropgateOpenedUpload]';
    return Object.freeze({
      metadata: read.meta,
      download: (o: DownloadSinkOptions): DownloadHandle => {
        try {
          if (closed) throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'This upload has been closed.' });
          const handle = this._startDownload(o ?? ({} as DownloadSinkOptions), { read: async () => read, lease: shared });
          running.add(handle);
          handle.result.finally(() => running.delete(handle));
          return handle;
        } catch (err) {
          throw withTransport(err, this.transport);
        }
      },
      close: async (): Promise<void> => {
        if (closed) return;
        closed = true;
        stopRenewing();
        closing.abort(new DropgateError({ code: 'OPERATION_CANCELLED' }));
        const ending = [...running];
        for (const handle of ending) handle.cancel();
        // Released before anything is awaited, so the request is made even
        // from a page's pagehide, as the page goes.
        const held = lease;
        lease = null;
        const released = held ? this._releaseLease(baseUrl, held.lease) : Promise.resolve();
        await Promise.all(ending.map((handle) => handle.result));
        await released;
      },
      toJSON: () => hidden,
      toString: () => hidden,
      [Symbol.for('nodejs.util.inspect.custom')]: () => hidden,
    }) as OpenedUpload;
  }

  /**
   * Downloads an upload under one lease, into its sink: the whole object, as
   * it's stored, each chunk of an encrypted one opened as it comes, to the one
   * marked last, padding included, so nothing can have been cut off; or, for
   * some of its files, only the chunks they're in, one run of chunks for each
   * run of files next to each other, and never a chunk that's only padding.
   * The last file, or the ZIP, is only finished once everything has come and
   * been checked. A connection that drops, or stalls, is asked again under the
   * same lease for the rest, from the next whole chunk; and if the server sends
   * anything but the rest of the same upload, none of it is written. A lease of
   * its own is released as soon as the download ends, however it ends, so it
   * counts at once.
   */
  private async _downloadObject(
    ctx: OperationContext<DownloadSnapshot>,
    o: { sink: DownloadOptions['sink']; zipped: boolean; files?: number[]; timeoutMs: number; policy: RetryPolicy; how: DownloadSource },
  ): Promise<DownloadResult> {
    const progress = ctx.update;
    const downloadSignal = ctx.signal;
    const { sink, zipped, timeoutMs } = o;
    let baseUrl = this.baseUrl;
    let taken: TakenLease | null = null;
    // What the lease's pause and resume run with, and whether this download is paused.
    let leaseRun: LeaseRun | null = null;
    let paused = false;
    // The sink being written, to abort if the download doesn't complete.
    let open: SinkWriter | null = null;

    try {
      const compat = await this._connect({ timeoutMs, signal: downloadSignal });
      progress({ phase: 'server-compat', text: compat.dgup.message });
      this._requireCompatible(compat, 'dgup');
      baseUrl = compat.baseUrl;

      // The metadata, with the files' names opened: no lease yet.
      progress({ phase: 'metadata', text: 'Fetching file info...' });
      const { meta, opened } = await o.how.read(compat, downloadSignal);
      const { files } = meta;
      const id = meta.id;
      // Where each file's bytes start in the upload's plaintext.
      const offsets: number[] = [];
      files.reduce((at, file) => { offsets.push(at); return at + file.size; }, 0);
      // The files asked for, in the list's order; the others' bytes are passed over, or never asked for.
      const indexes = chooseFiles(o.files, files.length);
      const wanted = new Set(indexes);
      const lastWanted = indexes[indexes.length - 1];
      const totalSize = indexes.reduce((sum, i) => sum + files[i].size, 0);
      const several = indexes.length > 1;
      if (several && !zipped && typeof sink !== 'function') {
        throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'Several files downloaded apart need a function giving a sink for each file.' });
      }
      progress({ status: 'downloading', totalBytes: totalSize, ...(several ? { totalFiles: indexes.length } : {}) });

      taken = await o.how.lease.take(baseUrl, { timeoutMs, signal: downloadSignal, progress });
      const lease = taken;
      // How long the server holds the lease for a download that has stopped: every answer, and every byte, moves it on.
      const window = new RetryWindow();
      window.heard(lease.deadline);

      // A pause closes the request and holds the sink as it is, written to the
      // last whole chunk; the server holds the lease for its pause length. A
      // resume renews the lease, and asks for the rest from there.
      const pausing = ctx.pausing;
      const pauseMs = pauseLength(compat.serverInfo);
      const run: LeaseRun = {
        policy: o.policy, window, signal: downloadSignal, progress,
        deadline: (deadline) => pausing.extend(deadline === null ? null : pausedUntil(deadline, pauseMs)),
      };
      leaseRun = run;
      const hooks: PauseHooks = {
        pause: async () => {
          const deadline = await o.how.lease.pause(baseUrl, lease, run);
          paused = true;
          return deadline === null ? null : pausedUntil(deadline, pauseMs);
        },
        resume: async () => {
          await o.how.lease.resume(baseUrl, lease, run);
          paused = false;
        },
        expired: () => droppedDownload(true),
      };
      if (pauseMs > 0) pausing.allow(hooks);
      else pausing.turnedOff();

      // Where each file goes: a sink of its own, or its place in one ZIP.
      const zipOut = zipped ? await SinkWriter.open(sink, { name: '', size: totalSize, index: 0 }) : null;
      open = zipOut;
      const zip = zipOut ? new StreamingZipWriter((chunk) => zipOut.write(chunk)) : null;
      // The writer refuses a member whose bytes don't come to the size the
      // metadata gave: the server sent something other than what it described.
      const zipStep = async (run: () => unknown) => {
        try {
          await run();
        } catch (err) {
          if (err instanceof DropgateError && err.code === 'INVALID_ARGUMENT') {
            throw new DropgateError({ code: 'INTEGRITY_FAILED', message: "A file's bytes didn't match its size.", cause: err });
          }
          throw toDropgateError(err, 'OUTPUT_WRITE_FAILED');
        }
      };

      // The file the bytes are in, how many bytes have been written, the files
      // finished, and the one being written.
      let fileIndex = 0;
      let written = 0;
      let finished = 0;
      let current: SinkWriter | null = null;
      let started = -1;
      const startFile = async (index: number) => {
        started = index;
        const file = files[index];
        progress({
          phase: several ? 'file-start' : 'downloading',
          text: several ? `Downloading file ${indexes.indexOf(index) + 1} of ${indexes.length}...` : 'Downloading...',
          percent: (written / totalSize) * 100,
          processedBytes: written,
          ...(several ? { fileIndex: index } : {}),
        });
        if (zip) {
          // The writer saves each member under its safe name, and tells two the same apart.
          await zipStep(() => zip.startFile(file.name, file.size));
        } else {
          current = await SinkWriter.open(sink, { name: file.name, size: file.size, index });
          open = current;
        }
      };
      // Gives the files asked for their bytes, `bytes` starting at `position`
      // in the plaintext, in order. Bytes of other files, and the padding
      // after the last file, are passed over.
      const deliver = async (position: number, bytes: Uint8Array) => {
        let at = 0;
        while (at < bytes.byteLength) {
          const here = position + at;
          while (fileIndex < files.length && here >= offsets[fileIndex] + files[fileIndex].size) fileIndex++;
          if (fileIndex === files.length) return;
          const fileEnd = offsets[fileIndex] + files[fileIndex].size;
          const length = Math.min(bytes.byteLength - at, fileEnd - here);
          if (wanted.has(fileIndex)) {
            const piece = bytes.subarray(at, at + length);
            if (started !== fileIndex) await startFile(fileIndex);
            if (zip) {
              await zipStep(() => zip.writeChunk(piece));
              await zipStep(() => zip.drained());
            } else {
              await current!.write(piece);
            }
            written += length;
            progress({ phase: 'downloading', percent: (written / totalSize) * 100, processedBytes: written, ...(several ? { fileIndex } : {}) });
            if (here + length === fileEnd) {
              finished++;
              // Each file but the last is finished as it ends; the last waits for the rest to be checked.
              if (zip) await zipStep(() => zip.endFile());
              else if (fileIndex !== lastWanted) {
                await current!.close();
                current = null;
                open = zipOut;
              }
            }
          }
          at += length;
        }
      };

      // The first file's sink is open before anything is asked for, so a
      // download that fails before its first byte still aborts it.
      await startFile(indexes[0]);

      // What's asked for: the whole upload when every file is wanted, read to
      // its last chunk; otherwise each run of files next to each other, alone.
      const size = opened ? opened.layout.storedSize : meta.totalSize;
      const whole = indexes.length === files.length;
      const runs: Array<{ start: number; end: number }> = [];
      if (whole) {
        runs.push({ start: 0, end: opened ? opened.layout.length : meta.totalSize });
      } else {
        for (const index of indexes) {
          const last = runs[runs.length - 1];
          if (last && last.end === offsets[index]) last.end = offsets[index] + files[index].size;
          else runs.push({ start: offsets[index], end: offsets[index] + files[index].size });
        }
      }

      for (const run of runs) {
        // How far the run has got: an encrypted upload's next chunk to open,
        // or an unencrypted one's next byte. A try that drops is followed by
        // one for the rest, from there.
        const span = opened && !whole ? opened.layout.span(run.start, run.end - run.start) : null;
        const lastChunk = opened ? (span ? span.last : opened.layout.chunkCount - 1) : 0;
        let nextChunk = span ? span.first : 0;
        let plainAt = run.start;
        // Whether the snapshot gives the deadline of a reconnect.
        let reconnecting = false;

        // One try for the rest of the run, from where it has got.
        const fetchRest = async (): Promise<void> => {
          // The stored bytes asked for, `from` to `to` included; and whether that's a range, or the whole upload.
          const from = opened ? (whole && nextChunk === 0 ? 0 : opened.layout.range(nextChunk, lastChunk).start) : plainAt;
          const to = opened ? opened.layout.range(nextChunk, lastChunk).end - 1 : run.end - 1;
          const ranged = from > 0 || to < size - 1;
          // The timeout is on each wait, for an answer and then for the next bytes,
          // so a big file never times out just for taking long, and a slow sink never counts.
          // A pause ends the wait too, closing the request; nothing times out while paused.
          const { signal: waitSignal, waiting, cleanup } = makeWaitSignal(pausing.signal, timeoutMs);
          let stopWatching = (): void => { };
          // Only what the server sends goes wrong in a way that may recover; what's written stays as it went.
          const failed = (err: unknown, code: 'SERVER_UNREACHABLE' | 'CONNECTION_LOST') => (waitSignal.aborted ? waitSignal.reason : toDropgateError(err, code));
          try {
            let res: Response;
            try {
              res = await waiting(() => this.fetchFn(`${baseUrl}/api/v4/objects/${id}/content`, {
                method: 'GET',
                // Only these bytes, and only if it's still the same upload: anything else is sent whole, and refused.
                headers: {
                  'Dropgate-Lease': lease.lease,
                  ...(ranged ? { Range: to === size - 1 ? `bytes=${from}-` : `bytes=${from}-${to}`, 'If-Range': lease.etag } : {}),
                },
                signal: waitSignal,
              }));
            } catch (err) {
              throw failed(err, 'SERVER_UNREACHABLE');
            }
            if (!res.ok) throw withRetryAfter(errorFromStatus(res.status, await res.json().catch(() => null), 'Download failed.'), res);
            window.heard();
            if (reconnecting) {
              reconnecting = false;
              progress({ deadline: null });
            }
            if (ranged) {
              if (res.status === 200) {
                throw new DropgateError({
                  code: 'INTEGRITY_FAILED',
                  message: written > 0
                    ? 'The server sent the whole upload again, not the rest of it, so it may have changed. Nothing more of it was written.'
                    : "The server sent the whole upload, not the part of it asked for, so it may have changed. None of it was written.",
                });
              }
              const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get('Content-Range') ?? '');
              if (res.status !== 206 || !range || Number(range[1]) !== from || Number(range[2]) !== to || Number(range[3]) !== size) {
                throw new DropgateError({ code: 'INVALID_RESPONSE', message: "The server didn't send the part of the upload asked for." });
              }
            } else if (res.status !== 200) {
              throw new DropgateError({ code: 'INVALID_RESPONSE', message: "The server didn't send the whole upload." });
            }
            if (!res.body) throw new DropgateError({ code: 'RUNTIME_UNSUPPORTED', message: 'Streaming response not available.' });

            const reader = res.body.getReader();
            // A cancel or timeout ends a read that's waiting, whether or not fetch() errors the body itself.
            const cancelRead = () => { reader.cancel(waitSignal.reason).catch(() => { }); };
            waitSignal.addEventListener('abort', cancelRead, { once: true });
            stopWatching = () => waitSignal.removeEventListener('abort', cancelRead);
            async function* received(): AsyncGenerator<Uint8Array> {
              for (;;) {
                let next: ReadableStreamReadResult<Uint8Array>;
                try {
                  next = await waiting(() => reader.read());
                } catch (err) {
                  throw failed(err, 'CONNECTION_LOST');
                }
                if (waitSignal.aborted) throw waitSignal.reason;
                if (next.done) return;
                window.heard();
                yield next.value;
              }
            }

            if (opened) {
              // From the start, the header is checked against the metadata's; otherwise the chunks go on from the next.
              const chunks = from === 0 ? opened.read(received()) : opened.chunks(received(), nextChunk, lastChunk);
              for await (const { index, plaintext } of chunks) {
                await deliver(index * opened.layout.chunkSize, plaintext);
                nextChunk = index + 1;
              }
            } else {
              for await (const piece of received()) {
                if (plainAt + piece.byteLength > run.end) {
                  throw new DropgateError({ code: 'INTEGRITY_FAILED', message: 'More data came than the upload holds.' });
                }
                await deliver(plainAt, piece);
                plainAt += piece.byteLength;
              }
              if (plainAt !== run.end) throw new DropgateError({ code: 'INTEGRITY_FAILED', message: 'The data ended before the last file did.' });
            }
          } finally {
            stopWatching();
            cleanup();
          }
        };

        for (;;) {
          // Paused here, it goes on once resumed, from where it stopped.
          if (await pausing.checkpoint()) {
            progress({ text: several ? `Downloading file ${indexes.indexOf(started) + 1} of ${indexes.length}...` : 'Downloading...' });
          }
          try {
            await retrying(fetchRest, {
              policy: o.policy, window, signal: pausing.signal,
              random: (length) => this._crypto.randomBytes(length),
              // While it waits, the snapshot gives when the server stops holding the lease.
              waiting: ({ remainingMs }) => {
                reconnecting = true;
                progress({ text: `The connection was lost. Reconnecting in ${(remainingMs / 1000).toFixed(1)}s...`, deadline: window.end });
              },
              retrying: () => progress({ text: 'Reconnecting...' }),
            });
            break;
          } catch (err) {
            // Stopped for a pause: once resumed, it asks for the rest.
            if (pausing.interrupted) continue;
            throw err;
          }
        }
      }
      if (finished !== indexes.length) throw new DropgateError({ code: 'INTEGRITY_FAILED', message: 'The data ended before the last file did.' });
      // Everything has come: nothing can pause the finish, but a pause that came just before it holds.
      pausing.allow(null);
      await pausing.checkpoint();

      // Everything has come, and been checked: the last file, or the ZIP, is finished.
      progress({ status: 'completing', phase: 'complete', text: 'Finishing the download...' });
      if (zip) {
        await zipStep(() => zip.finalize());
        await zipOut!.close();
      } else {
        await current!.close();
      }
      open = null;

      return {
        ...(several ? { filenames: indexes.map((i) => files[i].name) } : { filename: files[indexes[0]].name }),
        receivedBytes: written,
        wasEncrypted: meta.encrypted,
        transport: this.transport,
      };
    } catch (err) {
      // A failed or cancelled download is never finished as if it were whole.
      await open?.abort(downloadSignal.aborted ? downloadSignal.reason : err);
      throw toDropgateError(err, 'CONNECTION_LOST');
    } finally {
      if (taken) await o.how.lease.done(baseUrl, taken, leaseRun, paused);
    }
  }

  /**
   * Takes a lease for one download of an upload. While other downloads hold
   * every place its download limit allows, the server says to wait: it asks
   * again when the server says to, until a place frees, the upload goes, or
   * the download is cancelled.
   */
  private async _takeLease(
    baseUrl: string,
    id: string,
    { timeoutMs, signal, progress }: { timeoutMs: number; signal: AbortSignal; progress: (patch: Partial<DownloadSnapshot>) => void },
  ): Promise<TakenLease> {
    for (;;) {
      const { res, json } = await fetchJson(this.fetchFn, `${baseUrl}/api/v4/objects/${id}/leases`, {
        method: 'POST', timeoutMs, signal, headers: { Accept: 'application/json' },
      });
      if (res.status === 423) {
        progress({ text: 'Someone is downloading this right now.' });
        await sleep(retryAfterMs(res, 5000), signal);
        continue;
      }
      if (!res.ok) throw errorFromStatus(res.status, json, 'The download could not start.');
      // The lease, and the upload's ETag, which a resumed download asks for the rest of.
      const { lease, etag, deadline } = (json ?? {}) as { lease?: unknown; etag?: unknown; deadline?: unknown };
      if (typeof lease !== 'string' || !base64urlToBytes(lease, 32, this.base64) || typeof etag !== 'string' || !/^"[^"]+"$/.test(etag)) {
        throw new DropgateError({ code: 'INVALID_RESPONSE', message: "The server's answer to starting the download wasn't understood." });
      }
      return { lease, etag, deadline };
    }
  }

  /**
   * Releases a download's lease, so it counts now (if it sent anything) and
   * frees its place. Best effort. Its request is made before this first
   * awaits anything, and kept alive, so it's sent even as a page closes.
   */
  private async _releaseLease(baseUrl: string, lease: string): Promise<void> {
    try {
      await fetchJson(this.fetchFn, `${baseUrl}/api/v4/lease`, {
        method: 'DELETE', timeoutMs: 5000, keepalive: true, headers: { 'Dropgate-Lease': lease },
      });
    } catch { /* The lease runs out by itself. */ }
  }

  /**
   * Asks the server to hold a paused download's lease for its pause length,
   * not its 5 minutes. Gives the server's deadline.
   */
  private async _pauseLease(baseUrl: string, taken: TakenLease, run: LeaseRun): Promise<number> {
    const said = await this._leaseRequest(baseUrl, taken, 'pause', run);
    if (typeof said.deadline !== 'number' || !Number.isFinite(said.deadline)) {
      throw new DropgateError({ code: 'INVALID_RESPONSE', message: "The server's answer to the pause wasn't understood." });
    }
    taken.deadline = said.deadline;
    run.window.heard(said.deadline);
    return said.deadline;
  }

  /** Renews a download's lease, which ends a pause: the server holds it 5 more minutes. */
  private async _renewLease(baseUrl: string, taken: TakenLease, run: LeaseRun): Promise<void> {
    const said = await this._leaseRequest(baseUrl, taken, 'renew', run);
    taken.deadline = said.deadline;
    run.window.heard(said.deadline);
  }

  /**
   * A pause or a renew of a download's lease, retried as its bytes are, until
   * the server stops holding the lease. A lease the server no longer has is
   * NOT_FOUND: the download was dropped.
   */
  private _leaseRequest(baseUrl: string, taken: TakenLease, route: 'pause' | 'renew', run: LeaseRun): Promise<{ deadline?: unknown }> {
    const pausing = route === 'pause';
    return retrying(async () => {
      const { res, json } = await fetchJson(this.fetchFn, `${baseUrl}/api/v4/lease/${route}`, {
        method: 'POST', timeoutMs: 15000, signal: run.signal, headers: { Accept: 'application/json', 'Dropgate-Lease': taken.lease },
      });
      if (res.ok) return (json ?? {}) as { deadline?: unknown };
      const err = errorFromStatus(res.status, json, pausing ? "The download couldn't be paused." : "The download couldn't be resumed.");
      throw err.code === 'NOT_FOUND' ? droppedDownload(!pausing, err) : withRetryAfter(err, res);
    }, {
      policy: run.policy, window: run.window, signal: run.signal,
      random: (length) => this._crypto.randomBytes(length),
      waiting: ({ remainingMs }) => run.progress({
        text: `${pausing ? 'Pausing' : 'Resuming'} failed. Retrying in ${(remainingMs / 1000).toFixed(1)}s...`,
        deadline: run.window.end,
      }),
    });
  }

  private async _directSend(opts: P2PSendFileOptions): Promise<P2PSendSession> {
    const compat = await this._connect();
    this._requireCompatible(compat, 'dgdtp');

    const { serverInfo } = compat;
    const p2pCaps = serverInfo?.capabilities?.p2p;
    if (!p2pCaps?.enabled) throw directTransferDisabled();

    const { host, port, secure } = parseServerUrl(this.baseUrl);
    const { path: peerjsPath, iceServers } = resolvePeerConfig({}, p2pCaps);

    const session = await startP2PSend({
      ...this._directEvents(opts),
      host,
      port,
      secure,
      peerjsPath,
      iceServers,
      serverInfo,
    });
    return Object.assign(session, { transport: this.transport });
  }

  private async _directReceive(opts: P2PReceiveFileOptions): Promise<P2PReceiveSession> {
    const compat = await this._connect();
    this._requireCompatible(compat, 'dgdtp');

    const { serverInfo } = compat;
    const p2pCaps = serverInfo?.capabilities?.p2p;
    if (!p2pCaps?.enabled) throw directTransferDisabled();

    const { host, port, secure } = parseServerUrl(this.baseUrl);
    const { path: peerjsPath, iceServers } = resolvePeerConfig({}, p2pCaps);

    const session = await startP2PReceive({
      ...this._directEvents(opts),
      host,
      port,
      secure,
      peerjsPath,
      iceServers,
      serverInfo,
    });
    return Object.assign(session, { transport: this.transport });
  }

  /**
   * A direct transfer's options, with each event its listeners are given
   * carrying `transport`, and each error carrying it too, as every snapshot,
   * result and error a client gives does.
   */
  private _directEvents<O extends object>(opts: O): O {
    const transport = this.transport;
    const out = { ...opts } as Record<string, unknown>;
    for (const name of DIRECT_EVENTS) {
      const listener = out[name];
      if (typeof listener !== 'function') continue;
      out[name] = (evt: unknown) => listener(evt && typeof evt === 'object' ? { ...evt, transport } : evt);
    }
    const onError = out.onError;
    if (typeof onError === 'function') out.onError = (err: unknown) => onError(withTransport(err, transport));
    return out as O;
  }

  /**
   * Sends one chunk, the same bytes on every try. A try that can recover is
   * made again, after its backoff or the server's Retry-After, until the server
   * stops waiting for the upload; anything else the server says fails at once.
   */
  private async _attemptChunkUpload(
    url: string,
    fetchOptions: RequestInit,
    opts: {
      policy: RetryPolicy;
      window: RetryWindow;
      timeoutMs: number;
      signal: AbortSignal;
      progress: (patch: Partial<UploadSnapshot>) => void;
      chunkIndex: number;
      credentials: OperationCredentials;
    }
  ): Promise<void> {
    const { policy, window, timeoutMs, signal, progress, chunkIndex, credentials } = opts;
    const counted = (attempt: number) => (policy.retries !== undefined ? `(${attempt}/${policy.retries})` : `(retry ${attempt})`);

    await retrying(async () => {
      for (;;) {
        // A pause or a cancel that came before the try sends nothing.
        if (signal.aborted) throw signal.reason;
        const { signal: s, cleanup } = makeAbortSignal(signal, timeoutMs);
        try {
          let res: Response;
          try {
            // The credential is added to each try, so a renewed one is used.
            const headers = { ...(fetchOptions.headers as Record<string, string>), ...credentials.headers() };
            res = await this.fetchFn(url, { ...fetchOptions, headers, signal: s });
          } catch (err) {
            throw toDropgateError(err, 'SERVER_UNREACHABLE');
          }
          const text = await res.text().catch(() => '');
          let said: unknown = { error: text };
          try { said = JSON.parse(text); } catch { /* A plain-text answer. */ }
          if (res.ok) {
            window.heard((said as { deadline?: unknown } | null)?.deadline);
            return;
          }
          const err = errorFromStatus(res.status, said, `Chunk ${chunkIndex + 1} failed (HTTP ${res.status}).`);
          // An expired credential is renewed once, and the chunk sent again at
          // once; any other credential error stands.
          if (DropgateError.is(err, 'AUTH_EXPIRED') && await credentials.renew(signal)) continue;
          if (err.code === 'NOT_FOUND') throw droppedUpload(err);
          throw withRetryAfter(err, res);
        } finally {
          cleanup();
        }
      }
    }, {
      policy, window, signal,
      random: (length) => this._crypto.randomBytes(length),
      // While it waits, the snapshot gives when the server stops waiting for the upload.
      waiting: ({ attempt, remainingMs }) => progress({
        phase: 'retry-wait',
        text: `Chunk upload failed. Retrying in ${(remainingMs / 1000).toFixed(1)}s... ${counted(attempt)}`,
        deadline: window.end,
      }),
      retrying: (attempt) => progress({ phase: 'retry', text: `Chunk upload failed. Retrying now... ${counted(attempt)}` }),
      expired: unreachableTooLong,
    });
  }
}
