import type { Outcome } from './outcome.js';
import type { OperationHandle } from './operation.js';
import type { UploadSource } from './source.js';
import type { DownloadSinkOption } from './sink.js';
import type { Transport } from './transport.js';
import type { ProtocolName, ProtocolVersion } from './version.js';
import type { CredentialProvider } from './credentials.js';

/**
 * Server upload capabilities returned from the server info endpoint.
 */
export interface UploadCapabilities {
  /** Whether hosted uploads are enabled on the server. */
  enabled: boolean;
  /** Maximum file size in megabytes (0 = unlimited). */
  maxSizeMB?: number;
  /** Maximum file lifetime in hours (0 = unlimited). */
  maxLifetimeHours?: number;
  /** Maximum downloads before file is deleted (0 = unlimited). */
  maxFileDownloads?: number;
  /** Whether end-to-end encryption is supported. */
  e2ee?: boolean;
  /** Expected upload chunk size in bytes (server-configured). */
  chunkSize?: number;
  /**
   * Whether an upload needs a credential, which the client's `auth` provider
   * is asked for. A server that doesn't say needs none, and is sent none.
   */
  credentialRequired?: boolean;
}

/**
 * Server P2P (direct transfer) capabilities.
 */
export interface P2PCapabilities {
  /** Whether P2P transfers are enabled on the server. */
  enabled: boolean;
  /** Path to the PeerJS signaling server. */
  peerjsPath?: string;
  /** ICE servers for WebRTC connectivity. */
  iceServers?: RTCIceServer[];
}

/**
 * Server Web UI capabilities.
 */
export interface WebUICapabilities {
  /** Whether the Web UI is enabled on the server. */
  enabled: boolean;
}

/**
 * Combined server capabilities object.
 */
export interface ServerCapabilities {
  /** Hosted upload capabilities. */
  upload?: UploadCapabilities;
  /** P2P transfer capabilities. */
  p2p?: P2PCapabilities;
  /** Web UI capabilities. */
  webUI?: WebUICapabilities;
}

/**
 * Server information returned from the /api/info endpoint.
 */
export interface ServerInfo {
  /** Display name of the server. */
  name?: string;
  /** The server's own version, for display: compatibility depends on `protocols`, never on this. */
  version: string;
  /**
   * The protocol versions the server speaks. A server without them is older
   * than Dropgate 4, and works with no v4 client.
   */
  protocols?: Partial<Record<ProtocolName, ProtocolVersion>>;
  /** Server capabilities. */
  capabilities?: ServerCapabilities;
}

/**
 * Base progress event with common fields for all transfer operations.
 * Provides a consistent interface for upload, download, and P2P progress tracking.
 */
export interface BaseProgressEvent {
  /** Completion percentage (0-100). */
  percent: number;
  /** Bytes processed so far (sent, received, or uploaded). */
  processedBytes: number;
  /** Total bytes expected (may be 0 if unknown). */
  totalBytes: number;
}

/** The step an upload is on. */
export type UploadPhase =
  | 'server-info' | 'server-compat' | 'crypto' | 'init' | 'file-start' | 'chunk'
  | 'file-complete' | 'complete' | 'retry-wait' | 'retry' | 'done';

/**
 * Where an upload is: what `handle.snapshot` holds and `subscribe()` gives.
 * It never holds a file name or a key; `fileIndex` says which of the files
 * given it's on.
 */
export interface UploadSnapshot {
  /** One of the steps while it runs, then its outcome's status. */
  status: UploadStatus;
  /** The step it's on. `done` once it has completed; a cancelled or failed upload keeps the step it stopped at. */
  phase: UploadPhase;
  /** What it's doing, for people (such as "Uploading chunk 2 of 5..."). Never a file name. */
  text: string;
  /** Completion percentage (0-100). */
  percent: number;
  /** Bytes of the files sent and accepted so far. */
  processedBytes: number;
  /** Bytes of all the files together. */
  totalBytes: number;
  /** Which file it's on (0-based), for an upload of several files. */
  fileIndex?: number;
  /** How many files, for an upload of several files. */
  totalFiles?: number;
  /** Which chunk of the current file it's on (0-based). */
  chunkIndex?: number;
  /** How many chunks the current file has. */
  totalChunks?: number;
  /** How the client reaches its server. */
  transport: Transport;
}

/** One file of a hosted upload: its name and its size in bytes. */
export interface HostedFile {
  /** The file's name, as it was sent (decrypted, for an encrypted upload). */
  name: string;
  /** The file's size in bytes. */
  size: number;
}

/**
 * What a completed upload gives: its link, and the manage token that deletes
 * it. Keep the token where only this upload's sender can use it: it's never in
 * a snapshot, an error, a log or a link.
 */
export interface UploadResult {
  /** The link: `https://<server>/<id>`, and for an encrypted upload `#` and its secret. */
  downloadUrl: string;
  /** The upload's ID on the server: the link's path. */
  id: string;
  /**
   * The manage token, which only this upload's sender has: 32 random bytes,
   * URL-safe base64. The server keeps only its SHA-256.
   */
  manageToken: string;
  /** The files uploaded, in order. */
  files: HostedFile[];
  /** How the client reached its server. */
  transport: Transport;
}

/** How an upload ended: `completed` with its UploadResult, `cancelled`, or `failed`. */
export type UploadOutcome = Outcome<UploadResult>;

/** Where an upload is: one of the steps while it runs, then its outcome's status. */
export type UploadStatus = 'initializing' | 'uploading' | 'completing' | Outcome<unknown>['status'];

/**
 * The handle `client.hosted.upload()` gives: the upload's one outcome as
 * `result`, where it is as `snapshot` and through `subscribe()`, and `cancel()`.
 */
export type UploadHandle = OperationHandle<UploadResult, UploadSnapshot>;

/**
 * Whether this client and the server speak one protocol's versions that work
 * together: the same major. A different minor still works, with only what the
 * older of the two has.
 */
export interface ProtocolCompatibility {
  /** Whether they work together. */
  compatible: boolean;
  /** The version this client speaks. */
  client: ProtocolVersion;
  /** The version the server speaks, or null if it doesn't say (it's older than Dropgate 4). */
  server: ProtocolVersion | null;
  /**
   * Which side needs updating, when they don't work together: `server` if
   * the server is the older, `client` if this client is.
   */
  update?: 'client' | 'server';
  /** What it means, for people: "Update required" worded for the side that needs it, or that it's fine. */
  message: string;
}

/**
 * Result of a client/server compatibility check: each protocol on its own,
 * because a server can work for hosted transfers and not for direct ones.
 */
export interface CompatibilityResult {
  /** Hosted transfers (DGUP): uploads, downloads, metadata and links. */
  dgup: ProtocolCompatibility;
  /** Direct transfers (DGDTP). */
  dgdtp: ProtocolCompatibility;
  /** The server's own version, for display only. */
  serverVersion: string;
}

/**
 * Result of resolving a share target (code or URL).
 */
export interface ShareTargetResult {
  /** Whether the share target is valid. */
  valid: boolean;
  /** Type of share target (e.g., 'p2p', 'file'). */
  type?: string;
  /**
   * Where to open it, as a path on the server (e.g. '/<id>', '/b/<id>', '/p2p/<code>').
   * When a pasted link carried a key after its #, the key is on the end of this
   * path; it was never sent to the server.
   */
  target?: string;
  /** Reason for invalidity if not valid. */
  reason?: string;
  /** How the client reached its server. */
  transport: Transport;
}

/**
 * Fetch function type compatible with the standard fetch API.
 * @param input - The URL or Request object to fetch.
 * @param init - Optional fetch configuration.
 * @returns A Promise that resolves to a Response.
 */
export type FetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

/**
 * Base64 adapter for environment-agnostic encoding/decoding.
 * Allows the library to work in both browser and Node.js environments.
 */
export interface Base64Adapter {
  /** Encode bytes to a base64 string. */
  encode(bytes: Uint8Array): string;
  /** Decode a base64 string to bytes. */
  decode(b64: string): Uint8Array;
}

/**
 * Options for constructing a DropgateClient instance.
 */
export interface DropgateClientOptions {
  /**
   * Server URL string (e.g. 'https://dropgate.link') or ServerTarget object.
   * Required. An address without a scheme is `https://`. A plain `http://`
   * one is only used as it is: it's never tried over HTTPS, and an
   * `https://` one is never retried over HTTP.
   */
  server: string | ServerTarget;
  /**
   * Allows a server on plain `http://` on another machine, which isn't secure:
   * anyone on the network between can read and change what's sent. Without
   * it, such a server is refused with INSECURE_TRANSPORT_NOT_ALLOWED before
   * any request is made. `http://` to this machine (`localhost`, `127.0.0.1`,
   * `[::1]`) is secure, and needs no opt-in. Default: false. With it, every
   * snapshot, result and error says `transport.secure: false`, and
   * `client.server.on('insecure-transport')` fires on connecting: tell the
   * people using it.
   */
  allowInsecure?: boolean;
  /**
   * The app using core, such as `{ name: 'Dropgate Client', version: '4.0.0' }`.
   * For display and local logs only: it's never sent anywhere, and
   * compatibility never depends on it.
   */
  appInfo?: AppInfo;
  /** Upload chunk size in bytes (default: 5MB). */
  chunkSize?: number;
  /** Custom fetch implementation (uses global fetch by default). */
  fetchFn?: FetchFn;
  /**
   * Gives a credential for an operation the server says needs one (an upload,
   * where `/api/info` has `capabilities.upload.credentialRequired`), as
   * `{ token }` or `null`. It's asked once as each such operation starts, and
   * once more if the server says the credential has expired; it's never asked
   * for anything else, and without it nothing is sent. The token goes only to
   * this client's server, only as `Authorization: Bearer <token>`, and never
   * appears in a link, snapshot, result, error or URL.
   */
  auth?: CredentialProvider;
  /** Custom base64 encoder/decoder. */
  base64?: Base64Adapter;
}

/** The app using core, for display and local logs. */
export interface AppInfo {
  /** The app's name. */
  name: string;
  /** The app's version. */
  version?: string;
}

/**
 * Common server target options specifying the server to connect to.
 */
export interface ServerTarget {
  /** Server hostname (e.g., 'dropgate.link'). */
  host: string;
  /** Server port number (omit for default 80/443). */
  port?: number;
  /** Whether to use HTTPS (default: true). */
  secure?: boolean;
}

/**
 * Options for `client.hosted.upload()`: one or more files to upload to the
 * server. One file is uploaded on its own; several are uploaded as a bundle.
 */
export interface UploadOptions {
  /** File(s) to upload: FileSources, or browser `File`s or `Blob`s, one or an array. */
  files: UploadSource | UploadSource[];
  /** File lifetime in milliseconds (0 = unlimited, where the server allows it). */
  lifetimeMs: number;
  /** Whether to encrypt the file(s) with E2EE. Defaults to true if server supports E2EE. */
  encrypt?: boolean;
  /** Override filenames sent to the server, keyed by file index. */
  filenameOverrides?: Record<number, string>;
  /** Max downloads before file/bundle is deleted (0 = unlimited). */
  maxDownloads?: number;
  /**
   * An AbortSignal that also cancels the upload. Aborting it cancels the upload
   * as its handle's cancel() would, with the outcome `cancelled`, `by: 'signal'`.
   */
  signal?: AbortSignal;
  /** Timeout settings for various upload phases. */
  timeouts?: {
    /** Timeout for fetching server info (default: 5000ms). */
    serverInfoMs?: number;
    /** Timeout for upload initialization (default: 15000ms). */
    initMs?: number;
    /** Timeout for each chunk upload (default: 60000ms). */
    chunkMs?: number;
    /** Timeout for upload completion (default: 30000ms). */
    completeMs?: number;
  };
  /**
   * How a chunk, or the finish, is retried when it gets no answer (the
   * network, or a timeout) or a 408, 429 or 5xx other than 507. By default
   * it's retried until the server stops waiting for the upload (5 minutes
   * after its last answer); any other error fails the upload at once.
   */
  retry?: RetryOptions;
}

/** How an operation retries what can recover. */
export interface RetryOptions {
  /** At most this many retries of one request (default: no limit, until the server stops waiting). */
  retries?: number;
  /** The first backoff in milliseconds, doubled for each retry after it, with jitter (default: 1000ms). */
  backoffMs?: number;
  /** The longest backoff in milliseconds (default and most: 30000ms). A server's `Retry-After` is waited instead. */
  maxBackoffMs?: number;
}

/**
 * Options for a request that isn't an operation: connecting, asking for the
 * server's info, resolving a link, or reading an upload's metadata.
 */
export interface RequestOptions {
  /** Request timeout in milliseconds (default: 5000ms). */
  timeoutMs?: number;
  /** AbortSignal to cancel the request. */
  signal?: AbortSignal;
}

/**
 * Options for `client.hosted.validate()`: checking an upload against a server's limits before it starts.
 */
export interface ValidateUploadOptions {
  /** File(s) to validate. */
  files: UploadSource | UploadSource[];
  /** Requested file lifetime in milliseconds. */
  lifetimeMs: number;
  /** Whether encryption will be used. Defaults to true if server supports E2EE. */
  encrypt?: boolean;
  /** Server info containing capabilities to validate against. */
  serverInfo: ServerInfo;
}

/**
 * Which hosted upload: one by its `id`, with the `secret` from its link (after
 * the #) if it's encrypted. One file and several are named alike.
 */
export interface HostedTarget {
  /** The upload's ID: its link's path. */
  id: string;
  /** What's after the # in an encrypted upload's link. It never leaves this device. */
  secret?: string;
}

/** Options for `client.hosted.metadata()`. */
export type MetadataOptions = HostedTarget & RequestOptions;

/** Options for `client.hosted.open()`. */
export type OpenOptions = HostedTarget & RequestOptions;

/** What `client.hosted.metadata()` gives: the same shape for one file or several. */
export interface UploadMetadata {
  /** `file` for one file, `bundle` for several. */
  kind: 'file' | 'bundle';
  /** The upload's ID on the server. */
  id: string;
  /** Whether it's end-to-end encrypted. */
  encrypted: boolean;
  /** Its files, in order, with their names decrypted and their sizes as they'll be downloaded. */
  files: HostedFile[];
  /** The files' sizes added up, in bytes. */
  totalSize: number;
  /** How the client reached its server. */
  transport: Transport;
}

/** The step a download is on. */
export type DownloadPhase =
  | 'server-info' | 'server-compat' | 'metadata' | 'file-start' | 'downloading' | 'complete' | 'done';

/** Where a download is: one of the steps while it runs, then its outcome's status. */
export type DownloadStatus = 'initializing' | 'downloading' | 'completing' | Outcome<unknown>['status'];

/**
 * Where a download is: what `handle.snapshot` holds and `subscribe()` gives.
 * Like an upload's, it never holds a file name or a key; `fileIndex` says
 * which of a bundle's files it's on.
 */
export interface DownloadSnapshot {
  /** One of the steps while it runs, then its outcome's status. */
  status: DownloadStatus;
  /** The step it's on. `done` once it has completed; a cancelled or failed download keeps the step it stopped at. */
  phase: DownloadPhase;
  /** What it's doing, for people (such as "Downloading file 2 of 3..."). Never a file name. */
  text: string;
  /** Completion percentage (0-100). */
  percent: number;
  /** Bytes written to the sink so far. */
  processedBytes: number;
  /** Bytes of all the files together, once the metadata is in (0 until then). */
  totalBytes: number;
  /** Which file it's on (0-based), for a bundle. */
  fileIndex?: number;
  /** How many files, for a bundle. */
  totalFiles?: number;
  /** How the client reaches its server. */
  transport: Transport;
}

/**
 * What a download writes, and how: for `client.hosted.download()`, and for an
 * opened upload's `download()`.
 */
export interface DownloadSinkOptions {
  /**
   * Where the bytes go: a sink, or a function giving one for each file as it
   * starts (it's told the file's name and size). Required. A single file takes
   * either; several files as a ZIP (`asZip`) take a sink, and several files
   * apart take a function.
   */
  sink: DownloadSinkOption;
  /**
   * For an upload of several files: which to download, by their index in its
   * list of files, each once (all of them if left out). They're written in
   * the list's order. Only the chunks holding them are asked for.
   */
  files?: number[];
  /** For several files: write them into one ZIP archive, to the one sink. */
  asZip?: boolean;
  /**
   * An AbortSignal that also cancels the download. Aborting it cancels the
   * download as its handle's cancel() would, with the outcome `cancelled`, `by: 'signal'`.
   */
  signal?: AbortSignal;
  /**
   * How long each wait may take, in milliseconds: for each request's answer,
   * and then for each file's next bytes (default: 60000ms; 0 for none). A big
   * file never times out for taking long, only if it stalls, and time spent
   * writing to the sink never counts.
   */
  timeoutMs?: number;
  /**
   * How a download that's cut off, or stalls past `timeoutMs`, is continued:
   * it asks for the rest under the same lease, from the next whole chunk. By
   * default it keeps trying until the server stops holding the lease (5
   * minutes after its last bytes).
   */
  retry?: RetryOptions;
}

/**
 * Options for `client.hosted.download()`: an upload by `id`, with its
 * `secret` if it's encrypted, and the sink its bytes are written to.
 */
export type DownloadOptions = HostedTarget & DownloadSinkOptions;

/**
 * An upload opened with `client.hosted.open()`, as a download page holds it
 * while it's open: its metadata, read with no lease, and downloads of it, all
 * under one lease, so they count as one download however many there are.
 * The lease is taken at its first download, renewed every 2 minutes while it's
 * open, and released by `close()`. Printed, logged or serialised, it shows
 * nothing of the secret or the lease.
 */
export interface OpenedUpload {
  /** What the server holds about the upload, with its files' names opened. */
  readonly metadata: UploadMetadata;
  /**
   * Downloads the upload, or some of its files, into `sink`, under the opened
   * upload's one lease. Gives the download's handle at once, as
   * `client.hosted.download()` does.
   * @throws {DropgateError} INVALID_ARGUMENT, before a download starts, once it has been closed, or
   * for a sink or files list it can't use.
   */
  download(opts: DownloadSinkOptions): DownloadHandle;
  /**
   * Closes it: cancels its downloads still running, and releases its lease,
   * which then counts as one download if it sent anything. Calling it again
   * does nothing. A page calls it on `pagehide`.
   */
  close(): Promise<void>;
}

/** Options for `client.hosted.delete()`: the upload, and the manage token its upload gave. */
export interface DeleteOptions extends RequestOptions {
  /** The upload's ID, from the completed upload's `id`. */
  id: string;
  /** The completed upload's `manageToken`. It's sent only in the `Dropgate-Manage-Token` header. */
  manageToken: string;
}

/**
 * What a completed download gives.
 */
export interface DownloadResult {
  /** The file's name, decrypted if it was encrypted (for one file). */
  filename?: string;
  /** The files' names, decrypted if they were encrypted (for several). */
  filenames?: string[];
  /** Bytes written to the sink, across all the files. */
  receivedBytes: number;
  /** Whether the file(s) were encrypted. */
  wasEncrypted: boolean;
  /** How the client reached its server. */
  transport: Transport;
}

/** How a download ended: `completed` with its DownloadResult, `cancelled`, or `failed`. */
export type DownloadOutcome = Outcome<DownloadResult>;

/**
 * The handle `client.hosted.download()` gives: the download's one outcome as
 * `result`, where it is as `snapshot` and through `subscribe()`, and `cancel()`.
 */
export type DownloadHandle = OperationHandle<DownloadResult, DownloadSnapshot>;
