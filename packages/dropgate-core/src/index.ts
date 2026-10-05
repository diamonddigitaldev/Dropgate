// Constants
export {
  DEFAULT_CHUNK_SIZE,
  AES_GCM_IV_BYTES,
  AES_GCM_TAG_BYTES,
  ENCRYPTION_OVERHEAD_PER_CHUNK,
} from './constants.js';

// Errors
export { DropgateError, ERROR_CODES } from './errors.js';
export type { DropgateErrorOptions, DropgateErrorCode, ErrorOrigin } from './errors.js';

// Outcomes and cancellation
export type { Outcome, CompletedOutcome, CancelledOutcome, FailedOutcome } from './outcome.js';
export type { Cancellation, CancelledBy } from './cancel.js';

// Operation handles
export type { OperationHandle } from './operation.js';

// File sources
export { blobSource, fileHandleSource } from './source.js';
export type { FileSource, BlobLike, UploadSource, FileHandleLike } from './source.js';

// Types
export type {
  UploadCapabilities,
  P2PCapabilities,
  WebUICapabilities,
  ServerCapabilities,
  ServerInfo,
  BaseProgressEvent,
  UploadResult,
  CompatibilityResult,
  ShareTargetResult,
  CryptoAdapter,
  FetchFn,
  Base64Adapter,
  DropgateClientOptions,
  ServerTarget,
  UploadFilesOptions,
  GetServerInfoOptions,
  ConnectOptions,
  ValidateUploadOptions,
  FileMetadata,
  DownloadProgressEvent,
  DownloadFilesOptions,
  DownloadResult,
  BundleMetadata,
} from './types.js';

// Upload handle and outcome types
export type { UploadHandle, UploadSnapshot, UploadPhase, UploadStatus, UploadOutcome, DownloadOutcome } from './types.js';

// Utils - Base64
export { bytesToBase64, arrayBufferToBase64, base64ToBytes } from './utils/base64.js';

// Utils - Lifetime
export { lifetimeToMs } from './utils/lifetime.js';

// Utils - Semver
export { parseSemverMajorMinor } from './utils/semver.js';
export type { SemverParts } from './utils/semver.js';

// Utils - Filename
export { validatePlainFilename } from './utils/filename.js';

// Utils - Network (internal helpers, but exported for advanced use)
export { sleep, makeAbortSignal, fetchJson, buildBaseUrl, parseServerUrl } from './utils/network.js';
export type { AbortSignalWithCleanup, FetchJsonResult, FetchJsonOptions } from './utils/network.js';

// Crypto
export {
  sha256Hex,
  generateAesGcmKey,
  exportKeyBase64,
  importKeyFromBase64,
  decryptChunk,
  decryptFilenameFromBase64,
} from './crypto/index.js';
export { encryptToBlob, encryptFilenameToBase64 } from './crypto/encrypt.js';

// ZIP
export { StreamingZipWriter } from './zip/stream-zip.js';

// Client
export { DropgateClient, estimateTotalUploadSizeBytes, getServerInfo } from './client/DropgateClient.js';

// Adapters
export { getDefaultBase64, getDefaultCrypto, getDefaultFetch } from './adapters/defaults.js';

// P2P - Utility functions still useful for consumers
export {
  generateP2PCode,
  isP2PCodeLike,
  isLocalhostHostname,
  isSecureContextForP2P,
} from './p2p/index.js';

// P2P Types - Consumer-facing types for client methods and sessions
export type {
  // State machine types
  P2PSendState,
  P2PReceiveState,
  // PeerJS types (needed by consumers who provide Peer constructor)
  PeerConstructor,
  PeerInstance,
  PeerInstanceEvents,
  PeerOptions,
  DataConnection,
  DataConnectionEvents,
  // P2P event types
  P2PStatusEvent,
  P2PSendProgressEvent,
  P2PReceiveProgressEvent,
  P2PMetadataEvent,
  P2PReceiveCompleteEvent,
  P2PConnectionHealthEvent,
  P2PResumeInfo,
  P2PCancellationEvent,
  // Client P2P options and sessions
  P2PFile,
  P2PSendFileOptions,
  P2PReceiveFileOptions,
  P2PSendSession,
  P2PReceiveSession,
} from './p2p/index.js';
