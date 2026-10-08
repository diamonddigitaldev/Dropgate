import { DEFAULT_CHUNK_SIZE, ENCRYPTION_OVERHEAD_PER_CHUNK } from '../constants.js';
import { DropgateError, directTransferDisabled, errorFromStatus, isCredentialError, toDropgateError, withTransport } from '../errors.js';
import { guardedFetch, insecureTransportNotAllowed, isSecureServerUrl } from '../transport.js';
import type { Transport } from '../transport.js';
import { CORE_VERSION, PROTOCOLS } from '../version.js';
import type { ProtocolName, ProtocolVersion, Protocols } from '../version.js';
import { startOperation } from '../operation.js';
import type { OperationContext } from '../operation.js';
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
  HostedMetadata,
  HostedFileInfo,
  HostedFile,
  MetadataOptions,
  UploadMetadata,
  BundleMetadata,
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
import { plaintextBytes, mbToBytes, estimateUploadBytes } from '../utils/size.js';
import { bytesToBase64url, base64urlToBytes } from '../utils/base64.js';
import { cryptoProvider, sha256Hex, keyToBase64, keyFromBase64, encryptName, decryptName } from '../crypto/index.js';
import type { ContentKey, CryptoProvider } from '../crypto/index.js';
import { OperationCredentials, credentialExpired } from '../credentials.js';
import type { CredentialProvider } from '../credentials.js';
import { startP2PSend } from '../p2p/send.js';
import { startP2PReceive } from '../p2p/receive.js';
import { resolvePeerConfig } from '../p2p/helpers.js';
import { StreamingZipWriter } from '../zip/stream-zip.js';
import { createObject, openObject, ObjectLayout, isChunkSize, HEADER_BYTES, SECRET_BYTES, MAX_FILES } from '../object/index.js';
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
   * `encrypt` says otherwise. One file is uploaded on its own; several are
   * uploaded as a bundle, under one link. The completed value has the link
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
   * if it was encrypted, into `sink`; or a bundle (`bundleId`, `keyB64`). It
   * takes one lease from the server for the download, which is one download
   * against the upload's limit, and releases it as soon as the download ends,
   * however it ends. Core awaits each write to
   * the sink and its close: the download only completes once the sink has
   * closed, and a write or close that fails fails it, with OUTPUT_WRITE_FAILED.
   * A failed or cancelled download aborts its sink.
   *
   * Gives the download's handle at once, as `upload()` does.
   * @throws {DropgateError} INVALID_ARGUMENT, before a download starts, if there's neither an
   * id nor a bundleId, or the sink isn't one the download can use.
   */
  download(opts: DownloadOptions): DownloadHandle;
  /**
   * Reads what the server holds about an upload (`id`): its files' names and
   * sizes, decrypting them with the `secret` from its link if it was
   * encrypted. It takes no lease and counts nothing. A bundle's (`bundleId`)
   * is read with `keyB64`.
   * @throws {DropgateError} NOT_FOUND if there's no such upload; KEY_REQUIRED if it's encrypted and
   * there's no secret; RUNTIME_UNSUPPORTED if it's encrypted and there's no Web Crypto here;
   * DECRYPT_FAILED if the secret doesn't open it; INTEGRITY_FAILED if what the server holds was
   * changed; VERSION_UNSUPPORTED if it was made in a format this version can't read; or a request's error.
   */
  metadata(opts: MetadataOptions & { id: string }): Promise<UploadMetadata>;
  metadata(opts: MetadataOptions & { bundleId: string }): Promise<BundleMetadata>;
  metadata(opts: MetadataOptions): Promise<HostedMetadata>;
  /**
   * Checks files and upload settings against a server's limits, as `upload()`
   * does before it starts.
   * @throws {DropgateError} CAPABILITY_UNSUPPORTED, INVALID_ARGUMENT, FILE_EMPTY, FILE_TOO_LARGE
   * or LIFETIME_NOT_ALLOWED, for the first check that fails.
   */
  validate(opts: ValidateUploadOptions): true;
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

/**
 * Estimate total upload size including encryption overhead.
 */
function estimateTotalUploadSizeBytes(
  fileSizeBytes: number,
  totalChunks: number,
  isEncrypted: boolean
): number {
  const base = Number(fileSizeBytes) || 0;
  if (!isEncrypted) return base;
  return base + (Number(totalChunks) || 0) * ENCRYPTION_OVERHEAD_PER_CHUNK;
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
 * The upload an operation names: by `id`, with its link's `secret`, or a
 * bundle by `bundleId`, with its `keyB64`.
 * @throws {DropgateError} INVALID_ARGUMENT for neither, or both.
 */
function hostedTarget(opts: Partial<MetadataOptions> | undefined):
  { id: string; secret?: string } | { bundleId: string; keyB64?: string; id?: undefined } {
  const { id, bundleId } = opts ?? {};
  if (typeof id === 'string' && id && bundleId === undefined) return { id, secret: opts?.secret };
  if (typeof bundleId === 'string' && bundleId && id === undefined) return { bundleId, keyB64: opts?.keyB64 };
  throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'Either id or bundleId is required.' });
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
      metadata: stamped((o: MetadataOptions) => this._metadata(o)) as HostedApi['metadata'],
      validate: stamped((o: ValidateUploadOptions) => this._validate(o)),
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

  private async _metadata(opts: MetadataOptions): Promise<HostedMetadata> {
    const target = hostedTarget(opts);
    const compat = await this._connect(opts);
    this._requireCompatible(compat, 'dgup');
    if (target.id !== undefined) return (await this._readObject(target.id, target.secret, compat, opts)).meta;
    return (await this._readMetadata({ bundleId: target.bundleId, keyB64: target.keyB64, timeoutMs: opts.timeoutMs, signal: opts.signal }, compat)).meta;
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

  /**
   * Reads a bundle's metadata from the server, decrypting its file names, and
   * gives the key too, for its download.
   */
  private async _readMetadata(
    opts: { bundleId: string; keyB64?: string } & RequestOptions,
    compat: ServerConnection,
  ): Promise<{ meta: BundleMetadata; cryptoKey?: ContentKey }> {
    const { bundleId, keyB64, timeoutMs = 5000, signal } = opts;
    const { baseUrl, serverInfo } = compat;
    const chunkSize = serverChunkSize(serverInfo, this.chunkSize);

    const { res, json } = await fetchJson(this.fetchFn, `${baseUrl}/api/bundle/${encodeURIComponent(bundleId)}/meta`, { method: 'GET', timeoutMs, signal });
    if (!res.ok) throw errorFromStatus(res.status, json, 'Failed to fetch bundle metadata.');
    if (!json || typeof json !== 'object') {
      throw new DropgateError({ code: 'INVALID_RESPONSE', message: 'The server sent no metadata.' });
    }

    const raw = json as {
      isEncrypted?: boolean;
      sealed?: boolean;
      encryptedManifest?: string;
      files?: Array<{ fileId: string; sizeBytes: number; filename?: string; encryptedFilename?: string }>;
    };
    const isEncrypted = Boolean(raw.isEncrypted);

    // The key, for an encrypted upload: a missing one, and no Web Crypto, are
    // both found before anything is decrypted.
    let cryptoKey: ContentKey | undefined;
    if (isEncrypted) {
      if (!keyB64) throw new DropgateError({ code: 'KEY_REQUIRED' });
      if (!this._crypto.canEncrypt) {
        throw new DropgateError({
          code: 'RUNTIME_UNSUPPORTED',
          message: 'Web Crypto API not available for decryption. Encrypted uploads need a secure context (HTTPS or localhost).',
        });
      }
    }
    const decrypt = async <T>(run: (key: ContentKey) => Promise<T>): Promise<T> => {
      try {
        cryptoKey ??= await keyFromBase64(this._crypto, keyB64!, this.base64);
        return await run(cryptoKey);
      } catch (err) {
        throw new DropgateError({ code: 'DECRYPT_FAILED', cause: err });
      }
    };
    const openName = (encrypted: string | undefined) =>
      decrypt((key) => decryptName(this._crypto, String(encrypted ?? ''), key, this.base64));

    // A received name is checked as a sent one is: whoever uploaded it, a name
    // that's empty, too long or has a path in it never reaches the caller.
    const received = (name: string, index?: number): string => {
      validateFilename(name, { origin: 'server', ...(index === undefined ? {} : { index }) });
      return name;
    };

    let files: HostedFileInfo[];
    const sealed = Boolean(raw.sealed && raw.encryptedManifest);
    if (sealed) {
      // A sealed bundle's file list is encrypted: only the key holder can read it.
      const manifest = await decrypt(async (key) => {
        const decrypted = await this._crypto.decrypt(key, this.base64.decode(raw.encryptedManifest!));
        const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as { files?: Array<{ fileId: string; sizeBytes: number; name: string }> };
        if (!Array.isArray(parsed?.files)) throw new TypeError('The manifest has no files.');
        return parsed.files;
      });
      files = manifest.map((f, i) => ({ fileId: f.fileId, name: received(f.name || 'file', i), sizeBytes: Number(f.sizeBytes) || 0 }));
    } else if (Array.isArray(raw.files)) {
      files = [];
      for (const f of raw.files) {
        const stored = Number(f.sizeBytes) || 0;
        files.push({
          fileId: f.fileId,
          name: received(isEncrypted ? await openName(f.encryptedFilename) : (f.filename || 'file'), files.length),
          // An unsealed encrypted bundle's sizes are what the server stored, ciphertext.
          sizeBytes: isEncrypted ? plaintextBytes(stored, chunkSize) : stored,
        });
      }
    } else {
      throw new DropgateError({ code: 'INVALID_RESPONSE', message: 'Invalid bundle metadata: missing files or manifest.' });
    }

    return {
      meta: {
        kind: 'bundle',
        transport: this.transport,
        bundleId,
        isEncrypted,
        sealed,
        files,
        fileCount: files.length,
        totalSizeBytes: files.reduce((sum, f) => sum + f.sizeBytes, 0),
      },
      cryptoKey,
    };
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

    // Validate each file and check size limits
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileSize = Number(file?.size);
      if (!file || !Number.isFinite(fileSize) || fileSize < 0) {
        throw new DropgateError({ code: 'INVALID_ARGUMENT', message: `File at index ${i} is missing or invalid.`, details: { index: i } });
      }
      if (fileSize === 0) {
        throw new DropgateError({ code: 'FILE_EMPTY', details: { index: i } });
      }

      // maxSizeMB: 0 means unlimited. One file is stored as one object, with
      // its header, tags and padding (which never makes it too large); a
      // bundle's files are each still stored as Dropgate 3's, and checked so.
      const maxMB = Number(caps.maxSizeMB);
      if (Number.isFinite(maxMB) && maxMB > 0) {
        const limitBytes = mbToBytes(maxMB);
        const validationChunkSize = serverChunkSize(serverInfo, this.chunkSize);
        const estimatedBytes = files.length === 1
          ? estimateUploadBytes(fileSize, { encrypted: encrypt, chunkSize: validationChunkSize, maxBytes: limitBytes })
          : estimateTotalUploadSizeBytes(fileSize, Math.ceil(fileSize / validationChunkSize), encrypt);
        if (estimatedBytes > limitBytes) {
          const msg = encrypt
            ? `File at index ${i} too large once encryption overhead is included. Server limit: ${maxMB} MB.`
            : `File at index ${i} too large. Server limit: ${maxMB} MB.`;
          throw new DropgateError({ code: 'FILE_TOO_LARGE', message: msg, details: { index: i } });
        }
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

    const currentUploadIds: string[] = [];
    // A Dropgate 4 upload in progress, by its ID, until it's finished.
    let currentObjectUpload: string | null = null;
    const totalSizeBytes = files.reduce((sum, f) => sum + f.size, 0);
    // The upload's credential, only if its server asks for one: every request
    // the upload makes, its cancel included, carries it, and nothing else does.
    let credentials = OperationCredentials.none;

    const callCancelEndpoint = async (uploadId: string): Promise<void> => {
      try {
        await fetchJson(this.fetchFn, `${this.baseUrl}/upload/cancel`, {
          method: 'POST', timeoutMs: 5000,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...credentials.headers() },
          body: JSON.stringify({ uploadId }),
        });
      } catch { /* Best effort */ }
    };
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

      const retries = Number.isFinite(retry.retries) ? retry.retries! : 5;
      const baseBackoffMs = Number.isFinite(retry.backoffMs) ? retry.backoffMs! : 1000;
      const maxBackoffMs = Number.isFinite(retry.maxBackoffMs) ? retry.maxBackoffMs! : 30000;

      // ========== ONE FILE: one Dropgate 4 object ==========
      if (files.length === 1) {
        return this._uploadObject({
          file: files[0], name: filenames[0], encrypted: effectiveEncrypt, lifetimeMs, maxDownloads,
          compat, progress, signal: effectiveSignal, send, credentials,
          timeouts, retries, backoffMs: baseBackoffMs, maxBackoffMs,
          started: (uploadId) => { currentObjectUpload = uploadId; },
          finished: () => { currentObjectUpload = null; },
        });
      }

      // ========== SEVERAL FILES: a bundle ==========
      // 2) Encryption prep (single key for all files)
      let cryptoKey: ContentKey | null = null;
      let keyB64: string | null = null;
      const transmittedFilenames: string[] = [];

      if (effectiveEncrypt) {
        if (!this._crypto.canEncrypt) {
          throw new DropgateError({
            code: 'RUNTIME_UNSUPPORTED',
            message: 'Web Crypto API not available. Encryption requires a secure context (HTTPS or localhost).',
          });
        }
        progress({ phase: 'crypto', text: 'Generating encryption key...' });
        try {
          cryptoKey = await this._crypto.generateKey();
          keyB64 = await keyToBase64(this._crypto, cryptoKey, this.base64);
          for (const name of filenames) {
            transmittedFilenames.push(await encryptName(this._crypto, name, cryptoKey, this.base64));
          }
        } catch (err) {
          throw new DropgateError({ code: 'ENCRYPT_FAILED', cause: err });
        }
      } else {
        transmittedFilenames.push(...filenames);
      }

      // 3) Compute chunk sizes
      const serverChunkSize = serverInfo?.capabilities?.upload?.chunkSize;
      const effectiveChunkSize = (Number.isFinite(serverChunkSize) && serverChunkSize! > 0)
        ? serverChunkSize!
        : this.chunkSize;

      // ========== MULTI-FILE (BUNDLE) ==========
      // Prepare per-file metadata
      const fileManifest = files.map((f, i) => {
        const totalChunks = Math.ceil(f.size / effectiveChunkSize);
        const totalUploadSize = estimateTotalUploadSizeBytes(f.size, totalChunks, effectiveEncrypt);
        return { filename: transmittedFilenames[i], totalSize: totalUploadSize, totalChunks };
      });

      // Init bundle
      progress({ phase: 'init', text: `Reserving server storage for ${files.length} files...`, totalFiles: files.length });

      const initBundleRes = await send(`${baseUrl}/upload/init-bundle`, {
        method: 'POST',
        timeoutMs: timeouts.initMs ?? 15000,
        signal: effectiveSignal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          fileCount: files.length,
          files: fileManifest,
          lifetime: lifetimeMs,
          isEncrypted: effectiveEncrypt,
          ...(maxDownloads !== undefined ? { maxDownloads } : {}),
        }),
      });

      if (!initBundleRes.res.ok) {
        throw errorFromStatus(initBundleRes.res.status, initBundleRes.json, 'Bundle initialisation failed.');
      }

      const bundleInitJson = initBundleRes.json as { bundleUploadId?: string; fileUploadIds?: string[] } | null;
      const bundleUploadId = bundleInitJson?.bundleUploadId;
      const fileUploadIds = bundleInitJson?.fileUploadIds;
      if (!bundleUploadId || !fileUploadIds || fileUploadIds.length !== files.length) {
        throw new DropgateError({ code: 'INVALID_RESPONSE', message: 'Server did not return valid bundle upload IDs.' });
      }
      currentUploadIds.push(...fileUploadIds);
      progress({ status: 'uploading' });

      // Upload each file sequentially
      const fileResults: Array<{ fileId: string; name: string; size: number }> = [];
      let cumulativeBytes = 0;

      for (let fi = 0; fi < files.length; fi++) {
        const file = files[fi];
        const uploadId = fileUploadIds[fi];
        const totalChunks = fileManifest[fi].totalChunks;
        const totalUploadSize = fileManifest[fi].totalSize;

        progress({
          phase: 'file-start', text: `Uploading file ${fi + 1} of ${files.length}...`,
          percent: totalSizeBytes > 0 ? (cumulativeBytes / totalSizeBytes) * 100 : 0,
          processedBytes: cumulativeBytes,
          fileIndex: fi, totalFiles: files.length,
        });

        await this._uploadFileChunks({
          file, uploadId, cryptoKey, effectiveChunkSize, totalChunks, totalUploadSize,
          baseOffset: cumulativeBytes, totalBytesAllFiles: totalSizeBytes,
          progress, signal: effectiveSignal, baseUrl,
          retries, backoffMs: baseBackoffMs, maxBackoffMs,
          chunkTimeoutMs: timeouts.chunkMs ?? 60000,
          credentials,
        });

        // Complete individual file
        const completeRes = await send(`${baseUrl}/upload/complete`, {
          method: 'POST',
          timeoutMs: timeouts.completeMs ?? 30000,
          signal: effectiveSignal,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ uploadId }),
        });

        if (!completeRes.res.ok) {
          throw errorFromStatus(completeRes.res.status, completeRes.json, `File ${fi + 1} finalisation failed.`);
        }

        const fileId = (completeRes.json as { id?: string })?.id;
        if (!fileId) throw new DropgateError({ code: 'INVALID_RESPONSE', message: `Server did not return a valid file id for file ${fi + 1}.` });

        fileResults.push({ fileId, name: filenames[fi], size: file.size });
        cumulativeBytes += file.size;

        progress({
          phase: 'file-complete', text: `File ${fi + 1} of ${files.length} uploaded.`,
          percent: totalSizeBytes > 0 ? (cumulativeBytes / totalSizeBytes) * 100 : 0,
          processedBytes: cumulativeBytes,
        });
      }

      // Complete bundle
      progress({ status: 'completing', phase: 'complete', text: 'Finalising bundle...', percent: 100, processedBytes: totalSizeBytes });

      // For encrypted bundles, build and encrypt the manifest client-side.
      // The server stores only the opaque blob and cannot read which files belong to the bundle.
      let encryptedManifestB64: string | undefined;
      if (effectiveEncrypt && cryptoKey) {
        const manifest = JSON.stringify({
          files: fileResults.map(r => ({
            fileId: r.fileId,
            name: r.name,
            sizeBytes: r.size,
          })),
        });
        const manifestBytes = new TextEncoder().encode(manifest);
        encryptedManifestB64 = this.base64.encode(await this._crypto.encrypt(cryptoKey, manifestBytes));
      }

      const completeBundleRes = await send(`${baseUrl}/upload/complete-bundle`, {
        method: 'POST',
        timeoutMs: timeouts.completeMs ?? 30000,
        signal: effectiveSignal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          bundleUploadId,
          ...(encryptedManifestB64 ? { encryptedManifest: encryptedManifestB64 } : {}),
        }),
      });

      if (!completeBundleRes.res.ok) {
        throw errorFromStatus(completeBundleRes.res.status, completeBundleRes.json, 'Bundle finalisation failed.');
      }

      const bundleId = (completeBundleRes.json as { bundleId?: string })?.bundleId;
      if (!bundleId) throw new DropgateError({ code: 'INVALID_RESPONSE', message: 'Server did not return a valid bundle id.' });

      let downloadUrl = `${baseUrl}/b/${bundleId}`;
      if (effectiveEncrypt && keyB64) downloadUrl += `#${keyB64}`;

      return {
        downloadUrl, id: bundleId, files: fileResults.map(({ name, size }) => ({ name, size })), transport: this.transport,
      };
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
          for (const id of currentUploadIds) callCancelEndpoint(id).catch(() => { });
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
   * Uploads one file as a Dropgate 4 object: started with its header, sealed
   * file list and the manage token's SHA-256, sent chunk by chunk (each chunk
   * of an encrypted one sealed once, and those same bytes sent again on a
   * retry), then finished. Gives the link, with the secret after its # for an
   * encrypted one, and the manage token: nothing else ever holds either.
   */
  private async _uploadObject(p: {
    file: FileSource;
    name: string;
    encrypted: boolean;
    lifetimeMs: number;
    maxDownloads?: number;
    compat: ServerConnection;
    progress: (patch: Partial<UploadSnapshot>) => void;
    signal: AbortSignal;
    send: (url: string, init: FetchJsonOptions) => Promise<FetchJsonResult>;
    credentials: OperationCredentials;
    timeouts: NonNullable<UploadOptions['timeouts']>;
    retries: number;
    backoffMs: number;
    maxBackoffMs: number;
    started: (uploadId: string) => void;
    finished: () => void;
  }): Promise<UploadResult> {
    const { file, name, encrypted, compat, progress, signal, send, timeouts } = p;
    const { baseUrl, serverInfo } = compat;
    const chunkSize = serverChunkSize(serverInfo, this.chunkSize);
    if (!isChunkSize(chunkSize)) {
      throw new DropgateError({ code: 'INVALID_RESPONSE', message: "The server's chunk size isn't one this version of Dropgate can use." });
    }
    const maxMB = Number(serverInfo?.capabilities?.upload?.maxSizeMB);
    const maxBytes = Number.isFinite(maxMB) && maxMB > 0 ? mbToBytes(maxMB) : 0;
    const files = [{ name, size: file.size }];

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
      layout = ObjectLayout.plain(file.size, chunkSize);
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
    const { uploadId, chunks } = (start.json ?? {}) as { uploadId?: unknown; chunks?: unknown };
    if (typeof uploadId !== 'string' || !uploadId || chunks !== layout.chunkCount) {
      throw new DropgateError({ code: 'INVALID_RESPONSE', message: "The server's answer to starting the upload wasn't understood." });
    }
    p.started(uploadId);
    progress({ status: 'uploading' });

    const totalChunks = layout.chunkCount;
    for (let i = 0; i < totalChunks; i++) {
      if (signal.aborted) throw signal.reason || new DropgateError({ code: 'OPERATION_CANCELLED' });

      const processedBytes = Math.min(file.size, i * chunkSize);
      progress({
        phase: 'chunk',
        text: `Uploading chunk ${i + 1} of ${totalChunks}...`,
        percent: (processedBytes / file.size) * 100,
        processedBytes,
        chunkIndex: i, totalChunks,
      });

      // One bounded read: the chunk's part of the file, and no more of it.
      let body: Uint8Array<ArrayBuffer>;
      if (writer) {
        // The file's part of the chunk; the rest is padding, which is zero bytes.
        const { parts } = writer.chunkParts(i);
        const plaintext = new Uint8Array(layout.chunkLength(i));
        let at = 0;
        for (const part of parts) {
          plaintext.set(await readRange(file, part.offset, part.offset + part.length), at);
          at += part.length;
        }
        body = await writer.seal(i, plaintext);
      } else {
        const { start: from, end: to } = layout.chunkBytes(i);
        body = await readRange(file, from, to);
      }

      const digest = this.base64.encode(await this._crypto.sha256(body));
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
        {
          retries: p.retries, backoffMs: p.backoffMs, maxBackoffMs: p.maxBackoffMs,
          timeoutMs: timeouts.chunkMs ?? 60000, signal, progress, chunkIndex: i, credentials: p.credentials,
        },
      );
      writer?.confirm(i);
    }

    progress({ status: 'completing', phase: 'complete', text: 'Finalising upload...', percent: 100, processedBytes: file.size });
    const finish = await send(`${baseUrl}/api/v4/upload/complete`, {
      method: 'POST',
      timeoutMs: timeouts.completeMs ?? 30000,
      signal,
      headers: { Accept: 'application/json', 'Dropgate-Upload': uploadId },
    });
    if (!finish.res.ok) throw errorFromStatus(finish.res.status, finish.json, 'Finalisation failed.');
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
    const target = hostedTarget(opts);
    const { asZip, sink, signal, timeoutMs = 60000 } = opts;
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
    const sinkFits = typeof sink === 'function'
      ? !zipped
      : isDownloadSink(sink) && (target.id !== undefined || zipped);
    if (!sinkFits) {
      throw new DropgateError({
        code: 'INVALID_ARGUMENT',
        message: !sink
          ? 'A download needs a sink, with write() and close(), for its bytes.'
          : zipped
            ? 'Files downloaded as a ZIP need one sink, with write() and close().'
            : target.id !== undefined
              ? 'The sink needs write() and close(), or must be a function giving a sink.'
              : 'A bundle downloaded as separate files needs a function giving a sink for each file.',
      });
    }

    const bundleWork = async (ctx: OperationContext<DownloadSnapshot>, bundleId: string, keyB64?: string): Promise<DownloadResult> => {
      const progress = ctx.update;
      const downloadSignal = ctx.signal;
      let open: SinkWriter | null = null;

      try {
        // 0) Connect
        const compat = await this._connect({ timeoutMs, signal: downloadSignal });
        progress({ phase: 'server-compat', text: compat.dgup.message });
        this._requireCompatible(compat, 'dgup');
        const { baseUrl } = compat;

        // 1) Metadata, with the file names decrypted
        progress({ phase: 'metadata', text: 'Fetching bundle info...' });
        const { meta, cryptoKey } = await this._readMetadata({ bundleId, keyB64, timeoutMs, signal: downloadSignal }, compat);
        const indexes = chooseFiles(chosenIndexes, meta.files.length);
        const files = indexes.map((i) => meta.files[i]);
        const totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);
        const several = true;
        progress({ status: 'downloading', totalBytes, ...(several ? { totalFiles: files.length } : {}) });

        const streamOpts = { baseUrl, isEncrypted: meta.isEncrypted, cryptoKey, compat, signal: downloadSignal, timeoutMs };
        let written = 0;
        const counted = (fileIndex: number, done: number) => (fileBytes: number) => {
          const processedBytes = done + fileBytes;
          progress({
            phase: 'downloading',
            percent: totalBytes > 0 ? (processedBytes / totalBytes) * 100 : 0,
            processedBytes,
            ...(several ? { fileIndex } : {}),
          });
        };
        const fileStarts = (fi: number) => {
          progress({
            phase: several ? 'file-start' : 'downloading',
            text: several ? `Downloading file ${fi + 1} of ${files.length}...` : 'Downloading...',
            percent: totalBytes > 0 ? (written / totalBytes) * 100 : 0,
            processedBytes: written,
            ...(several ? { fileIndex: fi } : {}),
          });
        };

        if (zipped) {
          // ===== BUNDLE AS ZIP: one sink, one archive =====
          const out = await SinkWriter.open(sink, { name: '', size: totalBytes, index: 0 });
          open = out;
          const zip = new StreamingZipWriter((chunk) => out.write(chunk));
          const drained = async () => {
            try {
              await zip.drained();
            } catch (err) {
              throw toDropgateError(err, 'OUTPUT_WRITE_FAILED');
            }
          };
          // The writer refuses a member whose bytes don't come to the size the
          // metadata gave: the server sent something other than what it described.
          const sized = (run: () => void) => {
            try {
              run();
            } catch (err) {
              if (err instanceof DropgateError && err.code === 'INVALID_ARGUMENT') {
                throw new DropgateError({ code: 'INTEGRITY_FAILED', message: "A file's bytes didn't match its size.", cause: err });
              }
              throw toDropgateError(err, 'OUTPUT_WRITE_FAILED');
            }
          };
          // The writer saves each member under its safe name, and tells two the same apart.
          for (let fi = 0; fi < files.length; fi++) {
            fileStarts(indexes[fi]);
            zip.startFile(files[fi].name, files[fi].sizeBytes);
            const done = written;
            written += await this._streamFile(files[fi].fileId, streamOpts, async (chunk) => {
              sized(() => zip.writeChunk(chunk));
              await drained();
            }, counted(indexes[fi], done));
            sized(() => zip.endFile());
          }
          progress({ status: 'completing', phase: 'complete', text: 'Finishing the download...' });
          try {
            await zip.finalize();
          } catch (err) {
            throw toDropgateError(err, 'OUTPUT_WRITE_FAILED');
          }
          await out.close();
          open = null;

          // Only once the archive of every file is saved is the server told it was downloaded.
          if (files.length === meta.files.length) {
            try {
              await fetchJson(this.fetchFn, `${baseUrl}/api/bundle/${encodeURIComponent(bundleId)}/downloaded`, {
                method: 'POST', timeoutMs: 5000,
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: '{}',
              });
            } catch { /* Best effort */ }
          }
        } else {
          // ===== A FILE, OR A BUNDLE'S FILES: a sink each =====
          for (let fi = 0; fi < files.length; fi++) {
            const file = files[fi];
            fileStarts(indexes[fi]);
            const out = await SinkWriter.open(sink, { name: file.name, size: file.sizeBytes, index: indexes[fi] });
            open = out;
            const done = written;
            written += await this._streamFile(file.fileId, streamOpts, (chunk) => out.write(chunk), counted(indexes[fi], done));
            if (fi === files.length - 1) progress({ status: 'completing', phase: 'complete', text: 'Finishing the download...' });
            await out.close();
            open = null;
          }
        }

        return {
          filenames: files.map((f) => f.name),
          receivedBytes: written,
          wasEncrypted: meta.isEncrypted,
          transport: this.transport,
        };
      } catch (err) {
        // A failed or cancelled download is never finished as if it were whole.
        await open?.abort(downloadSignal.aborted ? downloadSignal.reason : err);
        throw err;
      }
    };

    const work = (ctx: OperationContext<DownloadSnapshot>): Promise<DownloadResult> => (target.id !== undefined
      ? this._downloadObject(ctx, { id: target.id, secret: target.secret, sink, zipped, files: chosenIndexes, timeoutMs })
      : bundleWork(ctx, target.bundleId, target.keyB64));

    return this._registry.add(startOperation<DownloadResult, DownloadSnapshot>({
      kind: 'hosted.download',
      parent: this._registry.scope,
      transport: this.transport,
      signal,
      initial: { status: 'initializing', phase: 'server-info', text: 'Checking server...', percent: 0, processedBytes: 0, totalBytes: 0 },
      work,
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
   * Downloads an upload under one lease: the whole object, as it's stored,
   * each chunk of an encrypted one opened as it comes, to the one marked last,
   * padding included, so nothing can have been cut off; and its files written
   * out in order. The last file, or the ZIP, is only finished once everything
   * has come and been checked. The lease is released as soon as the download
   * ends, however it ends, so it counts at once.
   */
  private async _downloadObject(
    ctx: OperationContext<DownloadSnapshot>,
    o: { id: string; secret?: string; sink: DownloadOptions['sink']; zipped: boolean; files?: number[]; timeoutMs: number },
  ): Promise<DownloadResult> {
    const progress = ctx.update;
    const downloadSignal = ctx.signal;
    const { id, secret, sink, zipped, timeoutMs } = o;
    // The timeout is on each wait, for an answer and then for the next bytes,
    // so a big file never times out just for taking long, and a slow sink never counts.
    const { signal: waitSignal, waiting, cleanup } = makeWaitSignal(downloadSignal, timeoutMs);
    let baseUrl = this.baseUrl;
    let lease: string | null = null;
    // The sink being written, to abort if the download doesn't complete.
    let open: SinkWriter | null = null;
    let stopWatching = (): void => { };

    try {
      const compat = await this._connect({ timeoutMs, signal: downloadSignal });
      progress({ phase: 'server-compat', text: compat.dgup.message });
      this._requireCompatible(compat, 'dgup');
      baseUrl = compat.baseUrl;

      // The metadata, with the files' names opened: no lease yet.
      progress({ phase: 'metadata', text: 'Fetching file info...' });
      const { meta, opened } = await this._readObject(id, secret, compat, { timeoutMs, signal: downloadSignal });
      const { files } = meta;
      // The files asked for, in the list's order; the others' bytes are passed over.
      const indexes = chooseFiles(o.files, files.length);
      const wanted = new Set(indexes);
      const lastWanted = indexes[indexes.length - 1];
      const totalSize = indexes.reduce((sum, i) => sum + files[i].size, 0);
      const several = indexes.length > 1;
      if (several && !zipped && typeof sink !== 'function') {
        throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'Several files downloaded apart need a function giving a sink for each file.' });
      }
      progress({ status: 'downloading', totalBytes: totalSize, ...(several ? { totalFiles: indexes.length } : {}) });

      lease = await this._takeLease(baseUrl, id, { timeoutMs, signal: downloadSignal, progress });

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

      // The file the bytes are in, how far into it they are, and the one being written.
      let fileIndex = 0;
      let fileWritten = 0;
      let written = 0;
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
      // Gives the files asked for their bytes, in order; any after the last file is padding.
      const deliver = async (bytes: Uint8Array) => {
        let at = 0;
        while (at < bytes.byteLength && fileIndex < files.length) {
          const piece = bytes.subarray(at, at + Math.min(bytes.byteLength - at, files[fileIndex].size - fileWritten));
          if (wanted.has(fileIndex)) {
            if (started !== fileIndex) await startFile(fileIndex);
            try {
              if (zip) {
                await zipStep(() => zip.writeChunk(piece));
                await zipStep(() => zip.drained());
              } else {
                await current!.write(piece);
              }
            } catch (err) {
              if (waitSignal.aborted) throw waitSignal.reason;
              throw err;
            }
            written += piece.byteLength;
            progress({ phase: 'downloading', percent: (written / totalSize) * 100, processedBytes: written, ...(several ? { fileIndex } : {}) });
          }
          at += piece.byteLength;
          fileWritten += piece.byteLength;
          if (fileWritten === files[fileIndex].size) {
            // Each file but the last is finished as it ends; the last waits for the rest to be checked.
            if (wanted.has(fileIndex)) {
              if (zip) await zipStep(() => zip.endFile());
              else if (fileIndex !== lastWanted) {
                await current!.close();
                current = null;
                open = zipOut;
              }
            }
            fileIndex++;
            fileWritten = 0;
          }
        }
      };

      // The first file's sink is open before anything is asked for, so a
      // download that fails before its first byte still aborts it.
      await startFile(indexes[0]);

      // The whole object, under the lease.
      let res: Response;
      try {
        res = await waiting(() => this.fetchFn(`${baseUrl}/api/v4/objects/${id}/content`, {
          method: 'GET', headers: { 'Dropgate-Lease': lease! }, signal: waitSignal,
        }));
      } catch (err) {
        throw toDropgateError(err, 'SERVER_UNREACHABLE');
      }
      if (!res.ok) throw errorFromStatus(res.status, await res.json().catch(() => null), 'Download failed.');
      if (res.status !== 200) throw new DropgateError({ code: 'INVALID_RESPONSE', message: "The server didn't send the whole upload." });
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
            if (waitSignal.aborted) throw waitSignal.reason;
            throw toDropgateError(err, 'CONNECTION_LOST');
          }
          if (waitSignal.aborted) throw waitSignal.reason;
          if (next.done) return;
          yield next.value;
        }
      }

      if (opened) {
        for await (const { plaintext } of opened.read(received())) await deliver(plaintext);
      } else {
        let count = 0;
        for await (const piece of received()) {
          count += piece.byteLength;
          if (count > meta.totalSize) throw new DropgateError({ code: 'INTEGRITY_FAILED', message: 'More data came than the upload holds.' });
          await deliver(piece);
        }
      }
      if (fileIndex !== files.length) throw new DropgateError({ code: 'INTEGRITY_FAILED', message: 'The data ended before the last file did.' });

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
      stopWatching();
      cleanup();
      if (lease) await this._releaseLease(baseUrl, lease);
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
  ): Promise<string> {
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
      const lease = (json as { lease?: unknown } | null)?.lease;
      if (typeof lease !== 'string' || !base64urlToBytes(lease, 32, this.base64)) {
        throw new DropgateError({ code: 'INVALID_RESPONSE', message: "The server's answer to starting the download wasn't understood." });
      }
      return lease;
    }
  }

  /** Releases a download's lease, so it counts now (if it sent anything) and frees its place. Best effort. */
  private async _releaseLease(baseUrl: string, lease: string): Promise<void> {
    try {
      await fetchJson(this.fetchFn, `${baseUrl}/api/v4/lease`, {
        method: 'DELETE', timeoutMs: 5000, headers: { 'Dropgate-Lease': lease },
      });
    } catch { /* The lease runs out by itself. */ }
  }

  /**
   * Streams one file's bytes from the server into `deliver`, decrypting them
   * if it's encrypted, awaiting each delivery before reading on. Returns how
   * many bytes were delivered.
   */
  private async _streamFile(
    fileId: string,
    opts: {
      baseUrl: string;
      isEncrypted: boolean;
      cryptoKey: ContentKey | undefined;
      compat: ServerConnection;
      signal: AbortSignal;
      timeoutMs: number;
    },
    deliverChunk: (chunk: Uint8Array) => Promise<void>,
    onBytesDelivered: (deliveredBytes: number) => void,
  ): Promise<number> {
    const { baseUrl, isEncrypted, cryptoKey, compat, signal, timeoutMs } = opts;
    // The timeout is on each wait, for the answer and then for the next bytes,
    // so a big file never times out just for taking long, and a slow sink never counts.
    const { signal: downloadSignal, waiting, cleanup: downloadCleanup } = makeWaitSignal(signal, timeoutMs);
    let deliveredBytes = 0;
    let stopWatching = (): void => { };

    // Each step's own failure, typed where it happens. A cancel or a timeout
    // keeps its own code, whichever step it interrupts.
    const step = async <T>(code: 'CONNECTION_LOST' | 'INTEGRITY_FAILED' | 'OUTPUT_WRITE_FAILED', run: () => Promise<T> | T): Promise<T> => {
      try {
        return await run();
      } catch (err) {
        if (downloadSignal.aborted) throw downloadSignal.reason;
        throw toDropgateError(err, code);
      }
    };

    try {
      let downloadRes: Response;
      try {
        downloadRes = await waiting(() => this.fetchFn(`${baseUrl}/api/file/${encodeURIComponent(fileId)}`, {
          method: 'GET', signal: downloadSignal,
        }));
      } catch (err) {
        throw toDropgateError(err, 'SERVER_UNREACHABLE');
      }

      if (!downloadRes.ok) throw errorFromStatus(downloadRes.status, null, 'Download failed.');
      if (!downloadRes.body) throw new DropgateError({ code: 'RUNTIME_UNSUPPORTED', message: 'Streaming response not available.' });

      const reader = downloadRes.body.getReader();
      // A cancel or timeout ends a read that's waiting, whether or not fetch() errors the body itself.
      const cancelRead = () => { reader.cancel(downloadSignal.reason).catch(() => { }); };
      downloadSignal.addEventListener('abort', cancelRead, { once: true });
      stopWatching = () => downloadSignal.removeEventListener('abort', cancelRead);
      const read = async () => {
        const next = await step('CONNECTION_LOST', () => waiting(() => reader.read()));
        if (downloadSignal.aborted) throw downloadSignal.reason;
        return next;
      };
      const decrypt = (chunk: Uint8Array) => step('INTEGRITY_FAILED', () => this._crypto.decrypt(cryptoKey!, chunk));
      const deliver = async (chunk: Uint8Array) => {
        await step('OUTPUT_WRITE_FAILED', () => deliverChunk(chunk));
        deliveredBytes += chunk.byteLength;
        onBytesDelivered(deliveredBytes);
      };

      if (isEncrypted && cryptoKey) {
        const ENCRYPTED_CHUNK_SIZE = serverChunkSize(compat.serverInfo, this.chunkSize) + ENCRYPTION_OVERHEAD_PER_CHUNK;
        const pendingChunks: Uint8Array[] = [];
        let pendingLength = 0;

        const flushPending = (): Uint8Array => {
          if (pendingChunks.length === 0) return new Uint8Array(0);
          if (pendingChunks.length === 1) {
            const result = pendingChunks[0];
            pendingChunks.length = 0;
            pendingLength = 0;
            return result;
          }
          const result = new Uint8Array(pendingLength);
          let offset = 0;
          for (const chunk of pendingChunks) { result.set(chunk, offset); offset += chunk.length; }
          pendingChunks.length = 0;
          pendingLength = 0;
          return result;
        };

        while (true) {
          if (downloadSignal.aborted) throw downloadSignal.reason;
          const { done, value } = await read();
          if (done) break;

          pendingChunks.push(value);
          pendingLength += value.length;

          while (pendingLength >= ENCRYPTED_CHUNK_SIZE) {
            const buffer = flushPending();
            const encryptedChunk = buffer.subarray(0, ENCRYPTED_CHUNK_SIZE);
            if (buffer.length > ENCRYPTED_CHUNK_SIZE) {
              pendingChunks.push(buffer.subarray(ENCRYPTED_CHUNK_SIZE));
              pendingLength = buffer.length - ENCRYPTED_CHUNK_SIZE;
            }
            await deliver(new Uint8Array(await decrypt(encryptedChunk)));
          }
        }

        if (pendingLength > 0) {
          await deliver(new Uint8Array(await decrypt(flushPending())));
        }
      } else {
        while (true) {
          if (downloadSignal.aborted) throw downloadSignal.reason;
          const { done, value } = await read();
          if (done) break;
          await deliver(value);
        }
      }
    } catch (err) {
      throw toDropgateError(err, 'CONNECTION_LOST');
    } finally {
      stopWatching();
      downloadCleanup();
    }

    return deliveredBytes;
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
   * Upload a single file's chunks to the server. Used by hosted.upload().
   */
  private async _uploadFileChunks(params: {
    file: FileSource;
    uploadId: string;
    cryptoKey: ContentKey | null;
    effectiveChunkSize: number;
    totalChunks: number;
    totalUploadSize: number;
    baseOffset: number;
    totalBytesAllFiles: number;
    progress: (patch: Partial<UploadSnapshot>) => void;
    signal: AbortSignal;
    baseUrl: string;
    retries: number;
    backoffMs: number;
    maxBackoffMs: number;
    chunkTimeoutMs: number;
    credentials: OperationCredentials;
  }): Promise<void> {
    const {
      file, uploadId, cryptoKey, effectiveChunkSize, totalChunks,
      baseOffset, totalBytesAllFiles, progress, signal, baseUrl,
      retries, backoffMs, maxBackoffMs, chunkTimeoutMs, credentials,
    } = params;

    for (let i = 0; i < totalChunks; i++) {
      if (signal.aborted) {
        throw signal.reason || new DropgateError({ code: 'OPERATION_CANCELLED' });
      }

      const start = i * effectiveChunkSize;
      const end = Math.min(start + effectiveChunkSize, file.size);

      const processedBytes = baseOffset + start;
      const percent = totalBytesAllFiles > 0 ? (processedBytes / totalBytesAllFiles) * 100 : 0;
      progress({
        phase: 'chunk',
        text: `Uploading chunk ${i + 1} of ${totalChunks}...`,
        percent, processedBytes,
        chunkIndex: i, totalChunks,
      });

      // One bounded read: the chunk, and no more of the file.
      const chunkBytes = await readRange(file, start, end);

      let uploadBytes: Uint8Array<ArrayBuffer>;
      if (cryptoKey) {
        try {
          uploadBytes = await this._crypto.encrypt(cryptoKey, chunkBytes);
        } catch (err) {
          throw new DropgateError({ code: 'ENCRYPT_FAILED', cause: err });
        }
      } else {
        uploadBytes = chunkBytes;
      }

      if (uploadBytes.byteLength > effectiveChunkSize + 1024) {
        throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'Chunk too large (client-side). Check chunk size settings.' });
      }

      const hashHex = await sha256Hex(this._crypto, uploadBytes);

      await this._attemptChunkUpload(
        `${baseUrl}/upload/chunk`,
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Upload-ID': uploadId, 'X-Chunk-Index': String(i), 'X-Chunk-Hash': hashHex }, body: new Blob([uploadBytes]) },
        { retries, backoffMs, maxBackoffMs, timeoutMs: chunkTimeoutMs, signal, progress, chunkIndex: i, credentials }
      );
    }
  }

  private async _attemptChunkUpload(
    url: string,
    fetchOptions: RequestInit,
    opts: {
      retries: number;
      backoffMs: number;
      maxBackoffMs: number;
      timeoutMs: number;
      signal: AbortSignal;
      progress: (patch: Partial<UploadSnapshot>) => void;
      chunkIndex: number;
      credentials: OperationCredentials;
    }
  ): Promise<void> {
    const {
      retries,
      backoffMs,
      maxBackoffMs,
      timeoutMs,
      signal,
      progress,
      chunkIndex,
      credentials,
    } = opts;

    let attemptsLeft = retries;
    let currentBackoff = backoffMs;
    const maxRetries = retries;

    while (true) {
      if (signal?.aborted) {
        throw signal.reason || new DropgateError({ code: 'OPERATION_CANCELLED' });
      }

      const { signal: s, cleanup } = makeAbortSignal(signal, timeoutMs);
      try {
        let res: Response;
        try {
          // The credential is added to each attempt, so a renewed one is used.
          const headers = { ...(fetchOptions.headers as Record<string, string>), ...credentials.headers() };
          res = await this.fetchFn(url, { ...fetchOptions, headers, signal: s });
        } catch (err) {
          throw toDropgateError(err, 'SERVER_UNREACHABLE');
        }
        if (res.ok) return;

        const text = await res.text().catch(() => '');
        let said: unknown = { error: text };
        try { said = JSON.parse(text); } catch { /* A plain-text answer. */ }
        throw errorFromStatus(res.status, said, `Chunk ${chunkIndex + 1} failed (HTTP ${res.status}).`);
      } catch (err) {
        cleanup();

        // A cancel is never retried; a timeout is.
        if (signal?.aborted) {
          throw signal.reason || new DropgateError({ code: 'OPERATION_CANCELLED' });
        }
        if (DropgateError.is(err, 'OPERATION_CANCELLED')) throw err;
        // An expired credential is renewed once, and the chunk sent again at
        // once; any other credential error stands.
        if (DropgateError.is(err, 'AUTH_EXPIRED') && await credentials.renew(signal)) continue;
        if (isCredentialError(err)) throw err;

        if (attemptsLeft <= 0) throw toDropgateError(err, 'SERVER_UNREACHABLE');

        const attemptNumber = maxRetries - attemptsLeft + 1;
        let remaining = currentBackoff;
        const tick = 100;
        while (remaining > 0) {
          const secondsLeft = (remaining / 1000).toFixed(1);
          progress({
            phase: 'retry-wait',
            text: `Chunk upload failed. Retrying in ${secondsLeft}s... (${attemptNumber}/${maxRetries})`,
          });
          await sleep(Math.min(tick, remaining), signal);
          remaining -= tick;
        }

        progress({
          phase: 'retry',
          text: `Chunk upload failed. Retrying now... (${attemptNumber}/${maxRetries})`,
        });

        attemptsLeft -= 1;
        currentBackoff = Math.min(currentBackoff * 2, maxBackoffMs);
        continue;
      } finally {
        cleanup();
      }
    }
  }
}
