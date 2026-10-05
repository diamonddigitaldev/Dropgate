import { DEFAULT_CHUNK_SIZE, ENCRYPTION_OVERHEAD_PER_CHUNK, MAX_IN_MEMORY_DOWNLOAD_BYTES } from '../constants.js';
import { DropgateError, directTransferDisabled, errorFromStatus, toDropgateError } from '../errors.js';
import { CancelScope } from '../cancel.js';
import { settle } from '../outcome.js';
import { startOperation } from '../operation.js';
import type { OperationContext } from '../operation.js';
import { readRange, toFileSources } from '../source.js';
import type { FileSource } from '../source.js';
import type {
  CryptoAdapter,
  FetchFn,
  ServerInfo,
  ServerTarget,
  CompatibilityResult,
  ShareTargetResult,
  UploadResult,
  UploadHandle,
  UploadSnapshot,
  DropgateClientOptions,
  UploadFilesOptions,
  GetServerInfoOptions,
  ConnectOptions,
  ValidateUploadOptions,
  Base64Adapter,
  DownloadFilesOptions,
  DownloadResult,
  DownloadOutcome,
  DownloadProgressEvent,
  FileMetadata,
  BundleMetadata,
} from '../types.js';
import type {
  P2PSendFileOptions,
  P2PReceiveFileOptions,
  P2PSendSession,
  P2PReceiveSession,
} from '../p2p/types.js';
import { getDefaultCrypto, getDefaultFetch, getDefaultBase64 } from '../adapters/defaults.js';
import { makeAbortSignal, fetchJson, sleep, buildBaseUrl, parseServerUrl, withoutCredentials } from '../utils/network.js';
import { parseShareInput } from '../utils/share-link.js';
import { parseSemverMajorMinor } from '../utils/semver.js';
import { validatePlainFilename } from '../utils/filename.js';
import { sha256Hex, generateAesGcmKey, exportKeyBase64, importKeyFromBase64, decryptChunk, decryptFilenameFromBase64 } from '../crypto/index.js';
import { encryptToBlob, encryptFilenameToBase64 } from '../crypto/encrypt.js';
import { startP2PSend } from '../p2p/send.js';
import { startP2PReceive } from '../p2p/receive.js';
import { resolvePeerConfig } from '../p2p/helpers.js';
import { StreamingZipWriter } from '../zip/stream-zip.js';

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
export function estimateTotalUploadSizeBytes(
  fileSizeBytes: number,
  totalChunks: number,
  isEncrypted: boolean
): number {
  const base = Number(fileSizeBytes) || 0;
  if (!isEncrypted) return base;
  return base + (Number(totalChunks) || 0) * ENCRYPTION_OVERHEAD_PER_CHUNK;
}

/**
 * Fetch server information from the /api/info endpoint.
 * @param opts - Server target and request options.
 * @returns The server base URL and server info object.
 * @throws {DropgateError} SERVER_UNREACHABLE, TIMED_OUT or OPERATION_CANCELLED if no answer came;
 * INVALID_RESPONSE if the answer wasn't a Dropgate server's; RATE_LIMITED or SERVER_ERROR.
 */
export async function getServerInfo(
  opts: GetServerInfoOptions
): Promise<{ baseUrl: string; serverInfo: ServerInfo }> {
  const { server, timeoutMs = 5000, signal, fetchFn: customFetch } = opts;

  const givenFetch = customFetch || getDefaultFetch();
  if (!givenFetch) {
    throw new DropgateError({ code: 'RUNTIME_UNSUPPORTED', message: 'No fetch() implementation found.' });
  }
  const fetchFn = withoutCredentials(givenFetch);

  const baseUrl = resolveServerToBaseUrl(server);

  const { res, json } = await fetchJson(
    fetchFn,
    `${baseUrl}/api/info`,
    {
      method: 'GET',
      timeoutMs,
      signal,
      headers: { Accept: 'application/json' },
    }
  );

  if (res.ok && json && typeof json === 'object' && 'version' in json) {
    return { baseUrl, serverInfo: json as ServerInfo };
  }
  if (res.status === 429 || res.status >= 500) throw errorFromStatus(res.status, json);
  throw new DropgateError({
    code: 'INVALID_RESPONSE',
    status: res.status,
    message: "That server didn't answer as a Dropgate server does.",
  });
}

/**
 * Headless, environment-agnostic client for Dropgate file operations.
 * Handles server communication, encryption, chunked uploads, downloads, and P2P transfers.
 *
 * Server connection is configured once in the constructor — all methods use
 * the stored server URL and cached server info automatically.
 */
export class DropgateClient {
  /** Client version string for compatibility checking. */
  readonly clientVersion: string;
  /** Chunk size in bytes for upload splitting. */
  readonly chunkSize: number;
  /** Fetch implementation used for HTTP requests. Every request it makes omits credentials (no cookies). */
  readonly fetchFn: FetchFn;
  /** Crypto implementation for encryption operations. */
  readonly cryptoObj: CryptoAdapter;
  /** Base64 encoder/decoder for binary data. */
  readonly base64: Base64Adapter;

  /** Resolved base URL (e.g. 'https://dropgate.link'). May change during HTTP fallback. */
  baseUrl: string;

  /** Whether to automatically retry with HTTP when HTTPS fails. */
  private _fallbackToHttp: boolean;
  /** Cached compatibility result (null until first connect()). */
  private _compat: (CompatibilityResult & { serverInfo: ServerInfo; baseUrl: string }) | null = null;
  /** In-flight connect promise to deduplicate concurrent calls. */
  private _connectPromise: Promise<CompatibilityResult & { serverInfo: ServerInfo; baseUrl: string }> | null = null;
  /** The root of the cancellation tree: every operation runs under it. */
  private _scope = new CancelScope('client');

  /**
   * Create a new DropgateClient instance.
   * @param opts - Client configuration options including server URL.
   * @throws {DropgateError} INVALID_ARGUMENT if clientVersion or server is missing or invalid;
   * RUNTIME_UNSUPPORTED if there's no fetch() or crypto.
   */
  constructor(opts: DropgateClientOptions) {
    if (!opts || typeof opts.clientVersion !== 'string') {
      throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'DropgateClient requires clientVersion (string).' });
    }

    if (!opts.server) {
      throw new DropgateError({
        code: 'INVALID_ARGUMENT',
        message: 'DropgateClient requires server (URL string or ServerTarget object).',
      });
    }

    this.clientVersion = opts.clientVersion;
    this.chunkSize = Number.isFinite(opts.chunkSize)
      ? opts.chunkSize!
      : DEFAULT_CHUNK_SIZE;

    const fetchFn = opts.fetchFn || getDefaultFetch();
    if (!fetchFn) {
      throw new DropgateError({ code: 'RUNTIME_UNSUPPORTED', message: 'No fetch() implementation found.' });
    }
    this.fetchFn = withoutCredentials(fetchFn);

    const cryptoObj = opts.cryptoObj || getDefaultCrypto();
    if (!cryptoObj) {
      throw new DropgateError({ code: 'RUNTIME_UNSUPPORTED', message: 'No crypto implementation found.' });
    }
    this.cryptoObj = cryptoObj;

    this.base64 = opts.base64 || getDefaultBase64();
    this._fallbackToHttp = Boolean(opts.fallbackToHttp);

    // Resolve server to baseUrl
    this.baseUrl = resolveServerToBaseUrl(opts.server);
  }

  /**
   * Get the server target (host, port, secure) derived from the current baseUrl.
   * Useful for passing to standalone functions that still need a ServerTarget.
   */
  get serverTarget(): ServerTarget {
    const url = new URL(this.baseUrl);
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      secure: url.protocol === 'https:',
    };
  }

  /**
   * Cancel every upload and download running on this client. Each ends with a
   * `cancelled` outcome, `by: 'parent'`, `source: 'client'`. The client stays
   * usable: operations started afterwards run as normal.
   */
  cancelAll(): void {
    const scope = this._scope;
    this._scope = new CancelScope('client');
    scope.cancel();
  }

  /**
   * Connect to the server: fetch server info and check version compatibility.
   * Results are cached — subsequent calls return instantly without network requests.
   * Concurrent calls are deduplicated.
   *
   * @param opts - Optional timeout and abort signal.
   * @returns Compatibility result with server info.
   * @throws {DropgateError} As getServerInfo() does.
   */
  async connect(
    opts?: ConnectOptions
  ): Promise<CompatibilityResult & { serverInfo: ServerInfo; baseUrl: string }> {
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

  private async _fetchAndCheckCompat(
    opts?: ConnectOptions
  ): Promise<CompatibilityResult & { serverInfo: ServerInfo; baseUrl: string }> {
    const { timeoutMs = 5000, signal } = opts ?? {};

    let baseUrl = this.baseUrl;
    let serverInfo: ServerInfo;

    try {
      const result = await getServerInfo({
        server: baseUrl,
        timeoutMs,
        signal,
        fetchFn: this.fetchFn,
      });
      baseUrl = result.baseUrl;
      serverInfo = result.serverInfo;
    } catch (err) {
      // HTTP fallback: if HTTPS failed and fallback is enabled, retry with HTTP
      if (this._fallbackToHttp && this.baseUrl.startsWith('https://')) {
        const httpBaseUrl = this.baseUrl.replace('https://', 'http://');
        try {
          const result = await getServerInfo({
            server: httpBaseUrl,
            timeoutMs,
            signal,
            fetchFn: this.fetchFn,
          });
          // HTTP worked — update stored baseUrl
          this.baseUrl = httpBaseUrl;
          baseUrl = result.baseUrl;
          serverInfo = result.serverInfo;
        } catch {
          // Both failed — throw the original HTTPS error
          throw toDropgateError(err, 'SERVER_UNREACHABLE');
        }
      } else {
        throw toDropgateError(err, 'SERVER_UNREACHABLE');
      }
    }

    const compat = this._checkVersionCompat(serverInfo!);
    this._compat = { ...compat, serverInfo: serverInfo!, baseUrl };
    return this._compat;
  }

  /** Throws VERSION_UNSUPPORTED if the server's and this client's versions don't work together. */
  private _requireCompatible(compat: CompatibilityResult): void {
    if (compat.compatible) return;
    throw new DropgateError({
      code: 'VERSION_UNSUPPORTED',
      message: compat.message,
      details: { clientVersion: compat.clientVersion, serverVersion: compat.serverVersion },
    });
  }

  /**
   * Pure version compatibility check (no network calls).
   */
  private _checkVersionCompat(serverInfo: ServerInfo): CompatibilityResult {
    const serverVersion = String(serverInfo?.version || '0.0.0');
    const clientVersion = String(this.clientVersion || '0.0.0');

    const c = parseSemverMajorMinor(clientVersion);
    const s = parseSemverMajorMinor(serverVersion);

    if (c.major !== s.major) {
      return {
        compatible: false,
        clientVersion,
        serverVersion,
        message: `Incompatible versions. Client v${clientVersion}, Server v${serverVersion}${serverInfo?.name ? ` (${serverInfo.name})` : ''}.`,
      };
    }

    if (c.minor > s.minor) {
      return {
        compatible: true,
        clientVersion,
        serverVersion,
        message: `Client (v${clientVersion}) is newer than Server (v${serverVersion})${serverInfo?.name ? ` (${serverInfo.name})` : ''}. Some features may not work.`,
      };
    }

    return {
      compatible: true,
      clientVersion,
      serverVersion,
      message: `Server: v${serverVersion}, Client: v${clientVersion}${serverInfo?.name ? ` (${serverInfo.name})` : ''}.`,
    };
  }

  /**
   * Resolve a user-entered sharing code or link.
   *
   * The input is read locally first. A link is reduced to the ID or code in
   * its path, and only that is sent to the server, so nothing after a # (an
   * encrypted upload's key) ever leaves the device. A link to another server
   * is refused without asking this one. The key comes back on the end of
   * `target`, ready to open.
   *
   * @param value - The sharing code or link to resolve.
   * @param opts - Optional timeout and abort signal.
   * @returns The resolved share target information.
   * @throws {DropgateError} VERSION_UNSUPPORTED, or a request's error if the lookup fails.
   */
  async resolveShareTarget(
    value: string,
    opts?: ConnectOptions
  ): Promise<ShareTargetResult> {
    const { timeoutMs = 5000, signal } = opts ?? {};

    const input = parseShareInput(value);
    if (!input) {
      return { valid: false, reason: 'Unrecognised sharing link.' };
    }

    // Check server compatibility (uses cache)
    const compat = await this.connect(opts);
    this._requireCompatible(compat);

    const { baseUrl } = compat;

    // The scheme may differ behind a TLS proxy, so only the host and port are compared.
    if (input.linkHost !== undefined && input.linkHost !== new URL(baseUrl).host) {
      return { valid: false, reason: 'URL must be from this server.' };
    }

    const { res, json } = await fetchJson(
      this.fetchFn,
      `${baseUrl}/api/resolve`,
      {
        method: 'POST',
        timeoutMs,
        signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ value: input.locator }),
      }
    );

    if (!res.ok) throw errorFromStatus(res.status, json, 'Share lookup failed.');

    const result = (json as ShareTargetResult) || { valid: false, reason: 'Unknown response.' };
    if (result.valid && result.target && input.secret && (result.type === 'file' || result.type === 'bundle')) {
      return { ...result, target: `${result.target}#${input.secret}` };
    }
    return result;
  }

  /**
   * Fetch metadata for a single file from the server.
   * @param fileId - The file ID to fetch metadata for.
   * @param opts - Optional connection options (timeout, signal).
   * @returns File metadata including size, filename, and encryption status.
   * @throws {DropgateError} NOT_FOUND if there's no such file, or a request's error.
   */
  async getFileMetadata(
    fileId: string,
    opts?: ConnectOptions
  ): Promise<FileMetadata> {
    if (!fileId || typeof fileId !== 'string') {
      throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'File ID is required.' });
    }

    const { timeoutMs = 5000, signal } = opts ?? {};

    const url = `${this.baseUrl}/api/file/${encodeURIComponent(fileId)}/meta`;
    const { res, json } = await fetchJson(this.fetchFn, url, {
      method: 'GET',
      timeoutMs,
      signal,
    });

    if (!res.ok) throw errorFromStatus(res.status, json, 'Failed to fetch file metadata.');
    if (!json || typeof json !== 'object') {
      throw new DropgateError({ code: 'INVALID_RESPONSE', message: 'The server sent no file metadata.' });
    }

    return json as FileMetadata;
  }

  /**
   * Fetch metadata for a bundle from the server and derive computed fields.
   * For sealed bundles, decrypts the manifest to extract file list.
   * Automatically derives totalSizeBytes and fileCount from the files array.
   * @param bundleId - The bundle ID to fetch metadata for.
   * @param keyB64 - Base64-encoded decryption key (required for encrypted bundles).
   * @param opts - Optional connection options (timeout, signal).
   * @returns Complete bundle metadata with all files and computed fields.
   * @throws {DropgateError} NOT_FOUND if there's no such bundle; KEY_REQUIRED if it's sealed and
   * there's no key; DECRYPT_FAILED if its manifest can't be read with the key; or a request's error.
   */
  async getBundleMetadata(
    bundleId: string,
    keyB64?: string,
    opts?: ConnectOptions
  ): Promise<BundleMetadata> {
    if (!bundleId || typeof bundleId !== 'string') {
      throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'Bundle ID is required.' });
    }

    const { timeoutMs = 5000, signal } = opts ?? {};

    const url = `${this.baseUrl}/api/bundle/${encodeURIComponent(bundleId)}/meta`;
    const { res, json } = await fetchJson(this.fetchFn, url, {
      method: 'GET',
      timeoutMs,
      signal,
    });

    if (!res.ok) throw errorFromStatus(res.status, json, 'Failed to fetch bundle metadata.');
    if (!json || typeof json !== 'object') {
      throw new DropgateError({ code: 'INVALID_RESPONSE', message: 'The server sent no bundle metadata.' });
    }

    const serverMeta = json as {
      isEncrypted: boolean;
      sealed?: boolean;
      encryptedManifest?: string;
      files?: Array<{
        fileId: string;
        sizeBytes: number;
        filename?: string;
        encryptedFilename?: string;
      }>;
    };

    let files: Array<{
      fileId: string;
      sizeBytes: number;
      filename?: string;
      encryptedFilename?: string;
    }> = [];

    // Handle sealed bundles: decrypt manifest to get file list
    if (serverMeta.sealed && serverMeta.encryptedManifest) {
      if (!keyB64) throw new DropgateError({ code: 'KEY_REQUIRED' });

      let manifest: { files: Array<{ fileId: string; sizeBytes: number; name: string }> };
      try {
        const key = await importKeyFromBase64(this.cryptoObj, keyB64);
        const encryptedBytes = this.base64.decode(serverMeta.encryptedManifest);
        const decryptedBuffer = await decryptChunk(this.cryptoObj, encryptedBytes, key);
        manifest = JSON.parse(new TextDecoder().decode(decryptedBuffer));
        if (!Array.isArray(manifest?.files)) throw new TypeError('The manifest has no files.');
      } catch (err) {
        throw new DropgateError({ code: 'DECRYPT_FAILED', cause: err });
      }

      // Map manifest files to consistent format (name -> filename for consistency)
      files = manifest.files.map(f => ({
        fileId: f.fileId,
        sizeBytes: f.sizeBytes,
        filename: f.name,
      }));
    } else if (serverMeta.files) {
      // Unsealed bundle: use files from server response
      files = serverMeta.files;

      // For unsealed encrypted bundles, the server stores ciphertext sizes.
      // Convert per-file sizeBytes to plaintext sizes by subtracting encryption overhead.
      if (serverMeta.isEncrypted) {
        const encryptedChunkSize = this.chunkSize + ENCRYPTION_OVERHEAD_PER_CHUNK;
        for (const f of files) {
          if (f.sizeBytes > 0) {
            const numChunks = Math.ceil(f.sizeBytes / encryptedChunkSize);
            f.sizeBytes = f.sizeBytes - numChunks * ENCRYPTION_OVERHEAD_PER_CHUNK;
          }
        }
      }
    } else {
      throw new DropgateError({ code: 'INVALID_RESPONSE', message: 'Invalid bundle metadata: missing files or manifest.' });
    }

    // Derive totalSizeBytes and fileCount from files array
    const totalSizeBytes = files.reduce((sum, f) => sum + (f.sizeBytes || 0), 0);
    const fileCount = files.length;

    return {
      isEncrypted: serverMeta.isEncrypted,
      sealed: serverMeta.sealed,
      encryptedManifest: serverMeta.encryptedManifest,
      files,
      totalSizeBytes,
      fileCount,
    };
  }

  /**
   * Validate file and upload settings against server capabilities.
   * @param opts - Validation options containing file, settings, and server info.
   * @returns True if validation passes.
   * @throws {DropgateError} CAPABILITY_UNSUPPORTED, INVALID_ARGUMENT, FILE_EMPTY, FILE_TOO_LARGE
   * or LIFETIME_NOT_ALLOWED, for the first check that fails.
   */
  validateUploadInputs(opts: ValidateUploadOptions): boolean {
    const { files: rawFiles, lifetimeMs, encrypt, serverInfo } = opts;
    const caps = serverInfo?.capabilities?.upload;

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

      // maxSizeMB: 0 means unlimited (per-file check)
      const maxMB = Number(caps.maxSizeMB);
      if (Number.isFinite(maxMB) && maxMB > 0) {
        const limitBytes = maxMB * 1000 * 1000;
        const validationChunkSize = (Number.isFinite(caps.chunkSize) && caps.chunkSize! > 0)
          ? caps.chunkSize!
          : this.chunkSize;
        const totalChunks = Math.ceil(fileSize / validationChunkSize);
        const estimatedBytes = estimateTotalUploadSizeBytes(
          fileSize,
          totalChunks,
          Boolean(encrypt)
        );
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

  /**
   * Upload one or more files to the server with optional encryption.
   * Single files use the standard upload protocol.
   * Multiple files use the bundle protocol, grouping files under a single download link.
   *
   * Gives the upload's handle at once. Its `result` is the upload's one
   * outcome: `completed` with the link, `cancelled` with who cancelled it, or
   * `failed` with a DropgateError. It never rejects. `snapshot` and
   * `subscribe()` say where it is, and `cancel()` cancels it. The upload runs
   * under the client's node of the cancellation tree, and `signal`, if given,
   * feeds into the upload's own node.
   *
   * @param opts - Upload options including file(s) and settings.
   * @returns The upload's handle.
   * @throws {DropgateError} INVALID_ARGUMENT if there are no files, or one isn't a file, before an upload starts.
   */
  uploadFiles(opts: UploadFilesOptions): UploadHandle {
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
    const totalSizeBytes = files.reduce((sum, f) => sum + f.size, 0);

    const callCancelEndpoint = async (uploadId: string): Promise<void> => {
      try {
        await fetchJson(this.fetchFn, `${this.baseUrl}/upload/cancel`, {
          method: 'POST', timeoutMs: 5000,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ uploadId }),
        });
      } catch { /* Best effort */ }
    };

    const work = async (ctx: OperationContext<UploadSnapshot>): Promise<UploadResult> => {
      // Every request uses the upload's own node's signal, so its cancel(),
      // the client's cancelAll() and a signal passed in all stop it.
      const effectiveSignal = ctx.signal;
      const progress = ctx.update;

      // 0) Get server info + compat (uses cache)
      const compat = await this.connect({
        timeoutMs: timeouts.serverInfoMs ?? 5000,
        signal: effectiveSignal,
      });

      const { baseUrl, serverInfo } = compat;
      progress({ phase: 'server-compat', text: compat.message });
      this._requireCompatible(compat);

      // 1) Resolve filenames
      const filenames = files.map((f, i) => filenameOverrides?.[i] ?? f.name ?? 'file');

      // Resolve encrypt option: default to true if server supports E2EE
      const serverSupportsE2EE = Boolean(serverInfo?.capabilities?.upload?.e2ee);
      const effectiveEncrypt = encrypt ?? serverSupportsE2EE;

      if (!effectiveEncrypt) {
        for (const name of filenames) validatePlainFilename(name);
      }

      this.validateUploadInputs({ files, lifetimeMs, encrypt: effectiveEncrypt, serverInfo });

      // 2) Encryption prep (single key for all files)
      let cryptoKey: CryptoKey | null = null;
      let keyB64: string | null = null;
      const transmittedFilenames: string[] = [];

      if (effectiveEncrypt) {
        if (!this.cryptoObj?.subtle) {
          throw new DropgateError({
            code: 'RUNTIME_UNSUPPORTED',
            message: 'Web Crypto API not available (crypto.subtle). Encryption requires a secure context (HTTPS or localhost).',
          });
        }
        progress({ phase: 'crypto', text: 'Generating encryption key...' });
        try {
          cryptoKey = await generateAesGcmKey(this.cryptoObj);
          keyB64 = await exportKeyBase64(this.cryptoObj, cryptoKey);
          for (const name of filenames) {
            transmittedFilenames.push(
              await encryptFilenameToBase64(this.cryptoObj, name, cryptoKey)
            );
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

      const retries = Number.isFinite(retry.retries) ? retry.retries! : 5;
      const baseBackoffMs = Number.isFinite(retry.backoffMs) ? retry.backoffMs! : 1000;
      const maxBackoffMs = Number.isFinite(retry.maxBackoffMs) ? retry.maxBackoffMs! : 30000;

      // ========== SINGLE FILE ==========
      if (files.length === 1) {
        const file = files[0];
        const totalChunks = Math.ceil(file.size / effectiveChunkSize);
        const totalUploadSize = estimateTotalUploadSizeBytes(file.size, totalChunks, effectiveEncrypt);

        // Init
        progress({ phase: 'init', text: 'Reserving server storage...' });

        const initRes = await fetchJson(this.fetchFn, `${baseUrl}/upload/init`, {
          method: 'POST',
          timeoutMs: timeouts.initMs ?? 15000,
          signal: effectiveSignal,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            filename: transmittedFilenames[0],
            lifetime: lifetimeMs,
            isEncrypted: effectiveEncrypt,
            totalSize: totalUploadSize,
            totalChunks,
            ...(maxDownloads !== undefined ? { maxDownloads } : {}),
          }),
        });

        if (!initRes.res.ok) {
          throw errorFromStatus(initRes.res.status, initRes.json, 'Server initialisation failed.');
        }

        const uploadId = (initRes.json as { uploadId?: string })?.uploadId;
        if (!uploadId) throw new DropgateError({ code: 'INVALID_RESPONSE', message: 'Server did not return a valid uploadId.' });
        currentUploadIds.push(uploadId);
        progress({ status: 'uploading' });

        // Chunks
        await this._uploadFileChunks({
          file, uploadId, cryptoKey, effectiveChunkSize, totalChunks, totalUploadSize,
          baseOffset: 0, totalBytesAllFiles: file.size,
          progress, signal: effectiveSignal, baseUrl,
          retries, backoffMs: baseBackoffMs, maxBackoffMs,
          chunkTimeoutMs: timeouts.chunkMs ?? 60000,
        });

        // Complete
        progress({ status: 'completing', phase: 'complete', text: 'Finalising upload...', percent: 100, processedBytes: file.size });

        const completeRes = await fetchJson(this.fetchFn, `${baseUrl}/upload/complete`, {
          method: 'POST',
          timeoutMs: timeouts.completeMs ?? 30000,
          signal: effectiveSignal,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ uploadId }),
        });

        if (!completeRes.res.ok) {
          throw errorFromStatus(completeRes.res.status, completeRes.json, 'Finalisation failed.');
        }

        const fileId = (completeRes.json as { id?: string })?.id;
        if (!fileId) throw new DropgateError({ code: 'INVALID_RESPONSE', message: 'Server did not return a valid file id.' });

        let downloadUrl = `${baseUrl}/${fileId}`;
        if (effectiveEncrypt && keyB64) downloadUrl += `#${keyB64}`;

        return {
          downloadUrl, fileId, uploadId, baseUrl,
          ...(effectiveEncrypt && keyB64 ? { keyB64 } : {}),
        };
      }

      // ========== MULTI-FILE (BUNDLE) ==========
      // Prepare per-file metadata
      const fileManifest = files.map((f, i) => {
        const totalChunks = Math.ceil(f.size / effectiveChunkSize);
        const totalUploadSize = estimateTotalUploadSizeBytes(f.size, totalChunks, effectiveEncrypt);
        return { filename: transmittedFilenames[i], totalSize: totalUploadSize, totalChunks };
      });

      // Init bundle
      progress({ phase: 'init', text: `Reserving server storage for ${files.length} files...`, totalFiles: files.length });

      const initBundleRes = await fetchJson(this.fetchFn, `${baseUrl}/upload/init-bundle`, {
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
        });

        // Complete individual file
        const completeRes = await fetchJson(this.fetchFn, `${baseUrl}/upload/complete`, {
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
        const encryptedBlob = await encryptToBlob(this.cryptoObj, manifestBytes.buffer, cryptoKey);
        const encryptedBuffer = new Uint8Array(await encryptedBlob.arrayBuffer());
        encryptedManifestB64 = this.base64.encode(encryptedBuffer);
      }

      const completeBundleRes = await fetchJson(this.fetchFn, `${baseUrl}/upload/complete-bundle`, {
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
        downloadUrl, bundleId, baseUrl, files: fileResults,
        ...(effectiveEncrypt && keyB64 ? { keyB64 } : {}),
      };
    };

    return startOperation<UploadResult, UploadSnapshot>({
      label: 'upload',
      parent: this._scope,
      signal,
      initial: {
        status: 'initializing', phase: 'server-info', text: 'Checking server...',
        percent: 0, processedBytes: 0, totalBytes: totalSizeBytes,
      },
      work: (ctx) => {
        // However it's cancelled, the server is told to discard what it has.
        ctx.scope.onCancel(() => {
          for (const id of currentUploadIds) callCancelEndpoint(id).catch(() => { });
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
    });
  }

  /**
   * Upload a single file's chunks to the server. Used internally by uploadFiles().
   */
  private async _uploadFileChunks(params: {
    file: FileSource;
    uploadId: string;
    cryptoKey: CryptoKey | null;
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
  }): Promise<void> {
    const {
      file, uploadId, cryptoKey, effectiveChunkSize, totalChunks,
      baseOffset, totalBytesAllFiles, progress, signal, baseUrl,
      retries, backoffMs, maxBackoffMs, chunkTimeoutMs,
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

      let uploadBlob: Blob;
      if (cryptoKey) {
        try {
          uploadBlob = await encryptToBlob(this.cryptoObj, chunkBytes, cryptoKey);
        } catch (err) {
          throw new DropgateError({ code: 'ENCRYPT_FAILED', cause: err });
        }
      } else {
        uploadBlob = new Blob([chunkBytes]);
      }

      if (uploadBlob.size > effectiveChunkSize + 1024) {
        throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'Chunk too large (client-side). Check chunk size settings.' });
      }

      const toHash = await uploadBlob.arrayBuffer();
      const hashHex = await sha256Hex(this.cryptoObj, toHash);

      await this._attemptChunkUpload(
        `${baseUrl}/upload/chunk`,
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Upload-ID': uploadId, 'X-Chunk-Index': String(i), 'X-Chunk-Hash': hashHex }, body: uploadBlob },
        { retries, backoffMs, maxBackoffMs, timeoutMs: chunkTimeoutMs, signal, progress, chunkIndex: i }
      );
    }
  }

  /**
   * Download one or more files from the server with optional decryption.
   *
   * For single files, use `fileId`. For bundles, use `bundleId`.
   * With `asZip: true` on bundles, streams a ZIP archive via `onData`.
   * Without `asZip`, delivers files individually via `onFileStart`/`onFileData`/`onFileEnd`.
   *
   * The promise is the download's one outcome: `completed` with the result,
   * `cancelled` (by `signal`, or by the client's `cancelAll()`), or `failed`
   * with a DropgateError. It never rejects.
   *
   * @param opts - Download options including file/bundle ID and optional key.
   * @returns The download's outcome.
   * @throws {DropgateError} INVALID_ARGUMENT if there's neither a fileId nor a bundleId, before a download starts.
   */
  async downloadFiles(opts: DownloadFilesOptions): Promise<DownloadOutcome> {
    if (!opts?.fileId && !opts?.bundleId) {
      throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'Either fileId or bundleId is required.' });
    }
    const scope = new CancelScope('download', { parent: this._scope, signal: opts.signal });
    return settle(scope, () => this._download(opts, scope.signal));
  }

  private async _download(opts: DownloadFilesOptions, signal: AbortSignal): Promise<DownloadResult> {
    const {
      fileId,
      bundleId,
      keyB64,
      asZip,
      zipFilename: _zipFilename,
      onProgress,
      onData,
      onFileStart,
      onFileData,
      onFileEnd,
      timeoutMs = 60000,
    } = opts;

    const progress = (evt: DownloadProgressEvent): void => {
      try { if (onProgress) onProgress(evt); } catch { /* Ignore */ }
    };

    // 0) Connect
    progress({ phase: 'server-info', text: 'Checking server...', processedBytes: 0, totalBytes: 0, percent: 0 });
    const compat = await this.connect({ timeoutMs, signal });
    const { baseUrl } = compat;
    progress({ phase: 'server-compat', text: compat.message, processedBytes: 0, totalBytes: 0, percent: 0 });
    this._requireCompatible(compat);

    // ========== SINGLE FILE ==========
    if (fileId) {
      return this._downloadSingleFile({ fileId, keyB64, onProgress, onData, signal, timeoutMs, baseUrl, compat });
    }

    // ========== BUNDLE ==========
    progress({ phase: 'metadata', text: 'Fetching bundle info...', processedBytes: 0, totalBytes: 0, percent: 0 });

    // Use getBundleMetadata to fetch metadata with proper derivation
    const bundleMeta: BundleMetadata = await this.getBundleMetadata(bundleId!, keyB64, { timeoutMs, signal });

    const isEncrypted = Boolean(bundleMeta.isEncrypted);
    // getBundleMetadata() already converts ciphertext sizes to plaintext sizes
    // for unsealed encrypted bundles, so totalBytes matches decrypted byte counts.
    const totalBytes = bundleMeta.totalSizeBytes || 0;

    // Decrypt filenames (and manifest for sealed bundles)
    let cryptoKey: CryptoKey | undefined;
    const filenames: string[] = [];

    if (isEncrypted) {
      if (!keyB64) throw new DropgateError({ code: 'KEY_REQUIRED' });
      if (!this.cryptoObj?.subtle) {
        throw new DropgateError({ code: 'RUNTIME_UNSUPPORTED', message: 'Web Crypto API not available for decryption.' });
      }

      try {
        cryptoKey = await importKeyFromBase64(this.cryptoObj, keyB64, this.base64);

        if (bundleMeta.sealed && bundleMeta.encryptedManifest) {
          // Sealed bundle: decrypt the manifest to get the file list
          const encryptedBytes = this.base64.decode(bundleMeta.encryptedManifest);
          const decryptedBuffer = await decryptChunk(this.cryptoObj, encryptedBytes, cryptoKey);
          const manifestJson = new TextDecoder().decode(decryptedBuffer);
          const manifest = JSON.parse(manifestJson) as { files: Array<{ fileId: string; name: string; sizeBytes: number }> };

          // Populate bundleMeta.files from the decrypted manifest
          bundleMeta.files = manifest.files.map(f => ({
            fileId: f.fileId,
            sizeBytes: f.sizeBytes,
            filename: f.name,
          }));
          bundleMeta.fileCount = bundleMeta.files.length;

          for (const f of bundleMeta.files) {
            filenames.push(f.filename || 'file');
          }
        } else {
          // Non-sealed encrypted bundle: decrypt individual filenames
          for (const f of bundleMeta.files) {
            filenames.push(await decryptFilenameFromBase64(this.cryptoObj, f.encryptedFilename!, cryptoKey, this.base64));
          }
        }
      } catch (err) {
        throw new DropgateError({ code: 'DECRYPT_FAILED', cause: err });
      }
    } else {
      for (const f of bundleMeta.files) {
        filenames.push(f.filename || 'file');
      }
    }

    let totalReceivedBytes = 0;

    if (asZip && onData) {
      // ===== BUNDLE AS ZIP =====
      const zipWriter = new StreamingZipWriter(onData);

      for (let fi = 0; fi < bundleMeta.files.length; fi++) {
        const fileMeta = bundleMeta.files[fi];
        const name = filenames[fi];

        progress({
          phase: 'zipping', text: `Downloading ${name}...`,
          percent: totalBytes > 0 ? (totalReceivedBytes / totalBytes) * 100 : 0,
          processedBytes: totalReceivedBytes, totalBytes,
          fileIndex: fi, totalFiles: bundleMeta.files.length, currentFileName: name,
        });

        zipWriter.startFile(name);

        // Download and stream this file into the ZIP
        const baseReceivedBytes = totalReceivedBytes;
        const bytesReceived = await this._streamFileIntoCallback(
          baseUrl, fileMeta.fileId, isEncrypted, cryptoKey, compat,
          signal, timeoutMs,
          (chunk) => { zipWriter.writeChunk(chunk); },
          (fileBytes) => {
            const current = baseReceivedBytes + fileBytes;
            progress({
              phase: 'zipping', text: `Downloading ${name}...`,
              percent: totalBytes > 0 ? (current / totalBytes) * 100 : 0,
              processedBytes: current, totalBytes,
              fileIndex: fi, totalFiles: bundleMeta.files.length, currentFileName: name,
            });
          },
        );

        zipWriter.endFile();
        totalReceivedBytes += bytesReceived;
      }

      try {
        await zipWriter.finalize();
      } catch (err) {
        throw toDropgateError(err, 'OUTPUT_WRITE_FAILED');
      }

      // Notify server of bundle download
      try {
        await fetchJson(this.fetchFn, `${baseUrl}/api/bundle/${bundleId}/downloaded`, {
          method: 'POST', timeoutMs: 5000,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: '{}',
        });
      } catch { /* Best effort */ }

      progress({ phase: 'complete', text: 'Download complete!', percent: 100, processedBytes: totalReceivedBytes, totalBytes });

      return { filenames, receivedBytes: totalReceivedBytes, wasEncrypted: isEncrypted };

    } else {
      // ===== BUNDLE AS INDIVIDUAL FILES =====
      const dataCallback = onFileData || onData;

      for (let fi = 0; fi < bundleMeta.files.length; fi++) {
        const fileMeta = bundleMeta.files[fi];
        const name = filenames[fi];

        progress({
          phase: 'downloading', text: `Downloading ${name}...`,
          percent: totalBytes > 0 ? (totalReceivedBytes / totalBytes) * 100 : 0,
          processedBytes: totalReceivedBytes, totalBytes,
          fileIndex: fi, totalFiles: bundleMeta.files.length, currentFileName: name,
        });

        onFileStart?.({ name, size: fileMeta.sizeBytes, index: fi });

        const baseReceivedBytes = totalReceivedBytes;
        const bytesReceived = await this._streamFileIntoCallback(
          baseUrl, fileMeta.fileId, isEncrypted, cryptoKey, compat,
          signal, timeoutMs,
          dataCallback ? (chunk) => dataCallback(chunk) : undefined,
          (fileBytes) => {
            const current = baseReceivedBytes + fileBytes;
            progress({
              phase: 'downloading', text: `Downloading ${name}...`,
              percent: totalBytes > 0 ? (current / totalBytes) * 100 : 0,
              processedBytes: current, totalBytes,
              fileIndex: fi, totalFiles: bundleMeta.files.length, currentFileName: name,
            });
          },
        );

        onFileEnd?.({ name, index: fi });
        totalReceivedBytes += bytesReceived;
      }

      progress({ phase: 'complete', text: 'Download complete!', percent: 100, processedBytes: totalReceivedBytes, totalBytes });

      return { filenames, receivedBytes: totalReceivedBytes, wasEncrypted: isEncrypted };
    }
  }

  /**
   * Download a single file, handling encryption/decryption internally.
   * Preserves the original downloadFile() behavior.
   */
  private async _downloadSingleFile(params: {
    fileId: string;
    keyB64?: string;
    onProgress?: (evt: DownloadProgressEvent) => void;
    onData?: (chunk: Uint8Array) => Promise<void> | void;
    signal?: AbortSignal;
    timeoutMs: number;
    baseUrl: string;
    compat: CompatibilityResult & { serverInfo: ServerInfo; baseUrl: string };
  }): Promise<DownloadResult> {
    const { fileId, keyB64, onProgress, onData, signal, timeoutMs, baseUrl, compat } = params;

    const progress = (evt: DownloadProgressEvent): void => {
      try { if (onProgress) onProgress(evt); } catch { /* Ignore */ }
    };

    // Fetch metadata
    progress({ phase: 'metadata', text: 'Fetching file info...', processedBytes: 0, totalBytes: 0, percent: 0 });

    // Use getFileMetadata for consistent metadata fetching
    const metadata: FileMetadata = await this.getFileMetadata(fileId, { timeoutMs, signal });

    const isEncrypted = Boolean(metadata.isEncrypted);
    const encryptedTotalBytes = metadata.sizeBytes || 0;

    // For encrypted files, metadata.sizeBytes is the ciphertext size on disk.
    // Progress tracks decrypted bytes, so compute the plaintext total by subtracting
    // the per-chunk encryption overhead (12-byte IV + 16-byte GCM tag = 28 bytes).
    let totalBytes = encryptedTotalBytes;
    if (isEncrypted && encryptedTotalBytes > 0) {
      const downloadChunkSize = (Number.isFinite(compat.serverInfo?.capabilities?.upload?.chunkSize) && compat.serverInfo.capabilities!.upload!.chunkSize! > 0)
        ? compat.serverInfo.capabilities!.upload!.chunkSize!
        : this.chunkSize;
      const encryptedChunkSize = downloadChunkSize + ENCRYPTION_OVERHEAD_PER_CHUNK;
      const numChunks = Math.ceil(encryptedTotalBytes / encryptedChunkSize);
      totalBytes = encryptedTotalBytes - numChunks * ENCRYPTION_OVERHEAD_PER_CHUNK;
    }

    if (!onData && totalBytes > MAX_IN_MEMORY_DOWNLOAD_BYTES) {
      const sizeMB = Math.round(totalBytes / (1024 * 1024));
      const limitMB = Math.round(MAX_IN_MEMORY_DOWNLOAD_BYTES / (1024 * 1024));
      throw new DropgateError({
        code: 'INVALID_ARGUMENT',
        message: `File is too large (${sizeMB}MB) to download without streaming. Provide an onData callback to stream files larger than ${limitMB}MB.`,
      });
    }

    // Decrypt filename
    let filename: string;
    let cryptoKey: CryptoKey | undefined;

    if (isEncrypted) {
      if (!keyB64) throw new DropgateError({ code: 'KEY_REQUIRED' });
      if (!this.cryptoObj?.subtle) {
        throw new DropgateError({ code: 'RUNTIME_UNSUPPORTED', message: 'Web Crypto API not available for decryption.' });
      }

      progress({ phase: 'decrypting', text: 'Preparing decryption...', processedBytes: 0, totalBytes: 0, percent: 0 });

      try {
        cryptoKey = await importKeyFromBase64(this.cryptoObj, keyB64, this.base64);
        filename = await decryptFilenameFromBase64(this.cryptoObj, metadata.encryptedFilename!, cryptoKey, this.base64);
      } catch (err) {
        throw new DropgateError({ code: 'DECRYPT_FAILED', cause: err });
      }
    } else {
      filename = metadata.filename || 'file';
    }

    // Download
    progress({ phase: 'downloading', text: 'Starting download...', percent: 0, processedBytes: 0, totalBytes });

    const dataChunks: Uint8Array[] = [];
    const collectData = !onData;

    const receivedBytes = await this._streamFileIntoCallback(
      baseUrl, fileId, isEncrypted, cryptoKey, compat, signal, timeoutMs,
      async (chunk) => {
        if (collectData) {
          dataChunks.push(chunk);
        } else {
          await onData!(chunk);
        }
      },
      (bytes) => {
        progress({
          phase: 'downloading', text: 'Downloading...',
          percent: totalBytes > 0 ? (bytes / totalBytes) * 100 : 0,
          processedBytes: bytes, totalBytes,
        });
      },
    );

    progress({ phase: 'complete', text: 'Download complete!', percent: 100, processedBytes: receivedBytes, totalBytes });

    let data: Uint8Array | undefined;
    if (collectData && dataChunks.length > 0) {
      const totalLength = dataChunks.reduce((sum, c) => sum + c.length, 0);
      data = new Uint8Array(totalLength);
      let offset = 0;
      for (const c of dataChunks) { data.set(c, offset); offset += c.length; }
    }

    return {
      filename, receivedBytes, wasEncrypted: isEncrypted,
      ...(data ? { data } : {}),
    };
  }

  /**
   * Stream a single file's content into a callback, handling decryption if needed.
   * Returns total bytes received from the network (encrypted size).
   */
  private async _streamFileIntoCallback(
    baseUrl: string,
    fileId: string,
    isEncrypted: boolean,
    cryptoKey: CryptoKey | undefined,
    compat: CompatibilityResult & { serverInfo: ServerInfo; baseUrl: string },
    signal: AbortSignal | undefined,
    timeoutMs: number,
    onChunk?: (chunk: Uint8Array) => void | Promise<void>,
    onBytesReceived?: (receivedBytes: number) => void,
  ): Promise<number> {
    const { signal: downloadSignal, cleanup: downloadCleanup } = makeAbortSignal(signal, timeoutMs);
    let receivedBytes = 0;
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
        downloadRes = await this.fetchFn(`${baseUrl}/api/file/${fileId}`, {
          method: 'GET', signal: downloadSignal,
        });
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
        const next = await step('CONNECTION_LOST', () => reader.read());
        if (downloadSignal.aborted) throw downloadSignal.reason;
        return next;
      };
      const decrypt = (chunk: Uint8Array) => step('INTEGRITY_FAILED', () => decryptChunk(this.cryptoObj, chunk, cryptoKey!));
      const deliver = (chunk: Uint8Array) => step('OUTPUT_WRITE_FAILED', () => onChunk?.(chunk));

      if (isEncrypted && cryptoKey) {
        const downloadChunkSize = (Number.isFinite(compat.serverInfo?.capabilities?.upload?.chunkSize) && compat.serverInfo.capabilities!.upload!.chunkSize! > 0)
          ? compat.serverInfo.capabilities!.upload!.chunkSize!
          : this.chunkSize;
        const ENCRYPTED_CHUNK_SIZE = downloadChunkSize + ENCRYPTION_OVERHEAD_PER_CHUNK;
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

            const decryptedBuffer = await decrypt(encryptedChunk);
            receivedBytes += decryptedBuffer.byteLength;
            if (onBytesReceived) onBytesReceived(receivedBytes);
            await deliver(new Uint8Array(decryptedBuffer));
          }
        }

        if (pendingLength > 0) {
          const buffer = flushPending();
          const decryptedBuffer = await decrypt(buffer);
          receivedBytes += decryptedBuffer.byteLength;
          if (onBytesReceived) onBytesReceived(receivedBytes);
          await deliver(new Uint8Array(decryptedBuffer));
        }
      } else {
        while (true) {
          if (downloadSignal.aborted) throw downloadSignal.reason;
          const { done, value } = await read();
          if (done) break;
          receivedBytes += value.length;
          if (onBytesReceived) onBytesReceived(receivedBytes);
          await deliver(value);
        }
      }
    } catch (err) {
      throw toDropgateError(err, 'CONNECTION_LOST');
    } finally {
      stopWatching();
      downloadCleanup();
    }

    return receivedBytes;
  }

  /**
   * Start a P2P send session. Connects to the signalling server and waits for a receiver.
   *
   * Server info, peerjsPath, iceServers, and cryptoObj are provided automatically
   * from the client's cached server info and configuration.
   *
   * @param opts - P2P send options (file, Peer constructor, callbacks, tuning).
   * @returns P2P send session with control methods.
   * @throws {DropgateError} VERSION_UNSUPPORTED; CAPABILITY_UNSUPPORTED if P2P is not enabled on the server;
   * or connect()'s errors.
   */
  async p2pSend(opts: P2PSendFileOptions): Promise<P2PSendSession> {
    const compat = await this.connect();
    this._requireCompatible(compat);

    const { serverInfo } = compat;
    const p2pCaps = serverInfo?.capabilities?.p2p;
    if (!p2pCaps?.enabled) throw directTransferDisabled();

    const { host, port, secure } = this.serverTarget;
    const { path: peerjsPath, iceServers } = resolvePeerConfig({}, p2pCaps);

    return startP2PSend({
      ...opts,
      host,
      port,
      secure,
      peerjsPath,
      iceServers,
      serverInfo,
      cryptoObj: this.cryptoObj,
    });
  }

  /**
   * Start a P2P receive session. Connects to a sender via their sharing code.
   *
   * Server info, peerjsPath, and iceServers are provided automatically
   * from the client's cached server info.
   *
   * @param opts - P2P receive options (code, Peer constructor, callbacks, tuning).
   * @returns P2P receive session with control methods.
   * @throws {DropgateError} VERSION_UNSUPPORTED; CAPABILITY_UNSUPPORTED if P2P is not enabled on the server;
   * or connect()'s errors.
   */
  async p2pReceive(opts: P2PReceiveFileOptions): Promise<P2PReceiveSession> {
    const compat = await this.connect();
    this._requireCompatible(compat);

    const { serverInfo } = compat;
    const p2pCaps = serverInfo?.capabilities?.p2p;
    if (!p2pCaps?.enabled) throw directTransferDisabled();

    const { host, port, secure } = this.serverTarget;
    const { path: peerjsPath, iceServers } = resolvePeerConfig({}, p2pCaps);

    return startP2PReceive({
      ...opts,
      host,
      port,
      secure,
      peerjsPath,
      iceServers,
      serverInfo,
    });
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
          res = await this.fetchFn(url, { ...fetchOptions, signal: s });
        } catch (err) {
          throw toDropgateError(err, 'SERVER_UNREACHABLE');
        }
        if (res.ok) return;

        const text = await res.text().catch(() => '');
        throw errorFromStatus(res.status, { error: text }, `Chunk ${chunkIndex + 1} failed (HTTP ${res.status}).`);
      } catch (err) {
        cleanup();

        // A cancel is never retried; a timeout is.
        if (signal?.aborted) {
          throw signal.reason || new DropgateError({ code: 'OPERATION_CANCELLED' });
        }
        if (DropgateError.is(err, 'OPERATION_CANCELLED')) throw err;

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
