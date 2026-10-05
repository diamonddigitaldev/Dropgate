import type { Outcome } from './outcome.js';
import type { OperationHandle } from './operation.js';
import type { UploadSource } from './source.js';
import type { DownloadSinkOption } from './sink.js';
import type { Transport } from './transport.js';
import type { ProtocolName, ProtocolVersion } from './version.js';

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

/**
 * Result of a successful file upload.
 */
export interface UploadResult {
  /** Full download URL including encryption key fragment if encrypted. */
  downloadUrl: string;
  /** Unique file identifier on the server (set for single-file uploads). */
  fileId?: string;
  /** Unique bundle identifier on the server (set for multi-file uploads). */
  bundleId?: string;
  /** Upload session identifier (set for single-file uploads). */
  uploadId?: string;
  /** Server base URL used for the upload. */
  baseUrl: string;
  /** Base64-encoded encryption key (only present if encrypted). */
  keyB64?: string;
  /** Per-file results (only present for multi-file uploads). */
  files?: Array<{ fileId: string; name: string; size: number }>;
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
 * Crypto adapter interface compatible with the Web Crypto API.
 * Used for encryption operations and secure random generation.
 */
export interface CryptoAdapter {
  /** SubtleCrypto interface for cryptographic operations. */
  readonly subtle: SubtleCrypto;
  /** Fill an array with cryptographically secure random values. */
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
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
  /** Custom crypto implementation (uses global crypto by default). */
  cryptoObj?: CryptoAdapter;
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
  /** File lifetime in milliseconds (0 = server default). */
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
  /** Retry settings for failed chunk uploads. */
  retry?: {
    /** Maximum number of retries per chunk (default: 5). */
    retries?: number;
    /** Initial backoff delay in milliseconds (default: 1000ms). */
    backoffMs?: number;
    /** Maximum backoff delay in milliseconds (default: 30000ms). */
    maxBackoffMs?: number;
  };
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

/** Which hosted upload: a single file by its ID, or a bundle by its ID. */
export type HostedTarget = { fileId: string; bundleId?: undefined } | { bundleId: string; fileId?: undefined };

/** Options for `client.hosted.metadata()`. */
export type MetadataOptions = HostedTarget & RequestOptions & {
  /** The key from the link, after its #. Needed to read an encrypted upload's file names. */
  keyB64?: string;
};

/** One file of a hosted upload, as its metadata describes it. */
export interface HostedFileInfo {
  /** The file's ID on the server. */
  fileId: string;
  /** The file's name, decrypted if it was encrypted. */
  name: string;
  /** The file's size in bytes, as it will be downloaded (decrypted). */
  sizeBytes: number;
}

/** What `client.hosted.metadata()` gives for a single file. */
export interface FileMetadata extends HostedFileInfo {
  kind: 'file';
  /** Whether the file is end-to-end encrypted. */
  isEncrypted: boolean;
  /** How the client reached its server. */
  transport: Transport;
}

/** What `client.hosted.metadata()` gives for a bundle. */
export interface BundleMetadata {
  kind: 'bundle';
  /** The bundle's ID on the server. */
  bundleId: string;
  /** Whether the bundle's files are end-to-end encrypted. */
  isEncrypted: boolean;
  /** Whether the list of files is encrypted too (sealed), so the server can't read which files belong to it. */
  sealed: boolean;
  /** The bundle's files, in order. */
  files: HostedFileInfo[];
  /** How many files the bundle has. */
  fileCount: number;
  /** The files' sizes added up, in bytes. */
  totalSizeBytes: number;
  /** How the client reached its server. */
  transport: Transport;
}

/** What `client.hosted.metadata()` gives. */
export type HostedMetadata = FileMetadata | BundleMetadata;

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
 * Options for `client.hosted.download()`: a single file by `fileId`, or a
 * bundle by `bundleId`, and the sink its bytes are written to.
 */
export type DownloadOptions = HostedTarget & {
  /**
   * Where the bytes go: a sink, or a function giving one for each file as it
   * starts (it's told the file's name and size). Required. A single file takes
   * either; a bundle as a ZIP (`asZip`) takes a sink, and a bundle as separate
   * files takes a function.
   */
  sink: DownloadSinkOption;
  /** The key from the link, after its #. Required for an encrypted upload. */
  keyB64?: string;
  /** For a bundle: write its files into one ZIP archive, to the one sink. */
  asZip?: boolean;
  /**
   * An AbortSignal that also cancels the download. Aborting it cancels the
   * download as its handle's cancel() would, with the outcome `cancelled`, `by: 'signal'`.
   */
  signal?: AbortSignal;
  /** Timeout for each request, and for each wait for the next bytes, in milliseconds (default: 60000ms; 0 for none). */
  timeoutMs?: number;
};

/**
 * What a completed download gives.
 */
export interface DownloadResult {
  /** The file's name, decrypted if it was encrypted (for a single file). */
  filename?: string;
  /** The files' names, decrypted if they were encrypted (for a bundle). */
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
