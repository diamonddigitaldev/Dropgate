import type { Outcome } from './outcome.js';
import type { OperationHandle } from './operation.js';
import type { UploadSource } from './source.js';

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
  /** Server version string. */
  version: string;
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
}

/** How an upload ended: `completed` with its UploadResult, `cancelled`, or `failed`. */
export type UploadOutcome = Outcome<UploadResult>;

/** Where an upload is: one of the steps while it runs, then its outcome's status. */
export type UploadStatus = 'initializing' | 'uploading' | 'completing' | Outcome<unknown>['status'];

/**
 * The handle `uploadFiles()` gives: the upload's one outcome as `result`,
 * where it is as `snapshot` and through `subscribe()`, and `cancel()`.
 */
export type UploadHandle = OperationHandle<UploadResult, UploadSnapshot>;

/**
 * Result of a client/server compatibility check.
 */
export interface CompatibilityResult {
  /** Whether the client and server versions are compatible. */
  compatible: boolean;
  /** Human-readable compatibility message. */
  message: string;
  /** Client version string. */
  clientVersion: string;
  /** Server version string. */
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
  /** Client version string for compatibility checking with the server. */
  clientVersion: string;
  /** Server URL string (e.g. 'https://dropgate.link') or ServerTarget object. Required. */
  server: string | ServerTarget;
  /** If true, automatically retry with HTTP when HTTPS connection fails in connect(). Default: false. */
  fallbackToHttp?: boolean;
  /** Upload chunk size in bytes (default: 5MB). */
  chunkSize?: number;
  /** Custom fetch implementation (uses global fetch by default). */
  fetchFn?: FetchFn;
  /** Custom crypto implementation (uses global crypto by default). */
  cryptoObj?: CryptoAdapter;
  /** Custom base64 encoder/decoder. */
  base64?: Base64Adapter;
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
 * Options for uploading one or more files to the server.
 * Single files use the standard upload protocol. Multiple files use the bundle protocol.
 * Server connection is configured once in the DropgateClient constructor.
 */
export interface UploadFilesOptions {
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
 * Options for fetching server information.
 */
export interface GetServerInfoOptions {
  /** Server URL string (e.g. 'https://dropgate.link') or ServerTarget object. */
  server: string | ServerTarget;
  /** Request timeout in milliseconds (default: 5000ms). */
  timeoutMs?: number;
  /** AbortSignal to cancel the request. */
  signal?: AbortSignal;
  /** Custom fetch implementation (uses global fetch by default). */
  fetchFn?: FetchFn;
}

/**
 * Options for the connect() method on DropgateClient.
 */
export interface ConnectOptions {
  /** Request timeout in milliseconds (default: 5000ms). */
  timeoutMs?: number;
  /** AbortSignal to cancel the request. */
  signal?: AbortSignal;
}

/**
 * Options for validating upload inputs before starting an upload.
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
 * File metadata returned from the server.
 */
export interface FileMetadata {
  /** Whether the file is encrypted. */
  isEncrypted: boolean;
  /** File size in bytes (encrypted size if encrypted). */
  sizeBytes: number;
  /** Original filename (only for unencrypted files). */
  filename?: string;
  /** Encrypted filename (only for encrypted files). */
  encryptedFilename?: string;
}

/**
 * Download progress event.
 */
export interface DownloadProgressEvent extends BaseProgressEvent {
  /** Current phase of the download. */
  phase: 'server-info' | 'server-compat' | 'metadata' | 'downloading' | 'decrypting' | 'zipping' | 'complete';
  /** Human-readable status text. */
  text?: string;
  /** Index of the current file being downloaded (0-based). Only present for bundle downloads. */
  fileIndex?: number;
  /** Total number of files in the bundle. Only present for bundle downloads. */
  totalFiles?: number;
  /** Name of the current file being downloaded. Only present for bundle downloads. */
  currentFileName?: string;
}

/**
 * Options for downloading one or more files.
 * Use `fileId` for single-file downloads or `bundleId` for multi-file bundle downloads.
 * Server connection is configured once in the DropgateClient constructor.
 */
export interface DownloadFilesOptions {
  /** File ID to download (for single-file downloads). */
  fileId?: string;
  /** Bundle ID to download (for multi-file bundle downloads). */
  bundleId?: string;
  /** Base64-encoded decryption key (required for encrypted files/bundles). */
  keyB64?: string;
  /** If true and bundleId is set, streams all files as a single ZIP via onData. */
  asZip?: boolean;
  /** Filename for the generated ZIP (default: "dropgate-bundle.zip"). Only used with asZip. */
  zipFilename?: string;
  /** Callback for progress updates. */
  onProgress?: (evt: DownloadProgressEvent) => void;
  /** Callback for received data chunks (single-file or ZIP stream). Consumer handles writing. */
  onData?: (chunk: Uint8Array) => Promise<void> | void;
  /** Callback when a file download begins (bundle non-ZIP mode). Consumer opens a new write stream. */
  onFileStart?: (file: { name: string; size: number; index: number }) => void;
  /** Callback for received data chunks per file (bundle non-ZIP mode). */
  onFileData?: (chunk: Uint8Array) => Promise<void> | void;
  /** Callback when a file download ends (bundle non-ZIP mode). Consumer closes the write stream. */
  onFileEnd?: (file: { name: string; index: number }) => void;
  /** AbortSignal to cancel the download. */
  signal?: AbortSignal;
  /** Request timeout in milliseconds (default: 60000ms). */
  timeoutMs?: number;
}

/**
 * Result of a file download.
 */
export interface DownloadResult {
  /** Decrypted filename (for single-file downloads). */
  filename?: string;
  /** Decrypted filenames (for bundle downloads). */
  filenames?: string[];
  /** Total bytes received across all files. */
  receivedBytes: number;
  /** Whether the file(s) were encrypted. */
  wasEncrypted: boolean;
  /** The file data (only for small single files when onData callback was not provided). */
  data?: Uint8Array;
}

/** How a download ended: `completed` with its DownloadResult, `cancelled`, or `failed`. */
export type DownloadOutcome = Outcome<DownloadResult>;

/**
 * Bundle metadata returned from the server.
 */
export interface BundleMetadata {
  /** Whether the bundle files are encrypted. */
  isEncrypted: boolean;
  /** Total size of all files in bytes. */
  totalSizeBytes: number;
  /** Number of files in the bundle. */
  fileCount: number;
  /** Whether the bundle manifest is encrypted (sealed). Only the downloader can read the file list. */
  sealed?: boolean;
  /** Base64-encoded encrypted manifest blob (only present for sealed bundles). */
  encryptedManifest?: string;
  /** Individual file metadata entries. Populated from server for unsealed bundles, or from decrypted manifest for sealed bundles. */
  files: Array<{
    /** File ID for downloading this individual file. */
    fileId: string;
    /** File size in bytes (encrypted size if encrypted). */
    sizeBytes: number;
    /** Original filename (only for unencrypted files). */
    filename?: string;
    /** Encrypted filename (only for encrypted files). */
    encryptedFilename?: string;
  }>;
}
