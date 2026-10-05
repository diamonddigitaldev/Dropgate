// Client
export { DropgateClient } from './client/DropgateClient.js';
export type { HostedApi, DirectApi, LinksApi, ServerApi, ServerConnection } from './client/DropgateClient.js';

// Standalone helpers, by what they're for
export { sources, lifetime, sizes, filenames, codes, hosts, zip } from './helpers.js';

// Errors
export { DropgateError, ERROR_CODES } from './errors.js';
export type { DropgateErrorOptions, DropgateErrorCode, ErrorOrigin } from './errors.js';

// Outcomes and cancellation
export type { Outcome, CompletedOutcome, CancelledOutcome, FailedOutcome } from './outcome.js';
export type { Cancellation, CancelledBy } from './cancel.js';

// Operation handles, and client.operations
export type { OperationHandle, OperationKind } from './operation.js';
export type { Operations, OperationInfo } from './operations.js';

// File sources, and download sinks
export type { FileSource, BlobLike, UploadSource, FileHandleLike } from './source.js';
export type { DownloadSink, DownloadSinkOption, DownloadFileInfo } from './sink.js';
export type { StreamingZipWriter } from './zip/stream-zip.js';

// Types
export type {
  UploadCapabilities,
  P2PCapabilities,
  WebUICapabilities,
  ServerCapabilities,
  ServerInfo,
  BaseProgressEvent,
  CompatibilityResult,
  ShareTargetResult,
  CryptoAdapter,
  FetchFn,
  Base64Adapter,
  DropgateClientOptions,
  ServerTarget,
  RequestOptions,
  ValidateUploadOptions,
  UploadOptions,
  UploadResult,
  UploadHandle,
  UploadSnapshot,
  UploadPhase,
  UploadStatus,
  UploadOutcome,
  HostedTarget,
  MetadataOptions,
  HostedMetadata,
  FileMetadata,
  BundleMetadata,
  HostedFileInfo,
  DownloadOptions,
  DownloadResult,
  DownloadHandle,
  DownloadSnapshot,
  DownloadPhase,
  DownloadStatus,
  DownloadOutcome,
} from './types.js';

// P2P Types - Consumer-facing types for client.direct
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
