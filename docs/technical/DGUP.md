# DGUP — Dropgate Upload Protocol

**Protocol Version:** 3
**Status:** Stable
**Last Updated:** September 2026

---

## 1. Overview

The Dropgate Upload Protocol (DGUP) defines the client–server mechanism for transferring files to a Dropgate Server instance. DGUP handles single-file and multi-file (bundle) uploads with optional end-to-end encryption (E2EE), chunk-level integrity verification, and automatic lifecycle management.

DGUP is transport-agnostic in principle but is presently implemented over HTTPS. All payloads are JSON unless otherwise stated.

### 1.1 Design Goals

- **Integrity** — every chunk is verified against a SHA-256 digest before it is persisted.
- **Confidentiality** — optional AES-256-GCM encryption ensures the server never sees plaintext file content or filenames.
- **Resilience** — chunk-level retries with exponential back-off tolerate transient network failures.
- **Quota Safety** — storage reservations are acquired under a mutex before any bytes are written, preventing time-of-check/time-of-use races.
- **Simplicity** — the protocol uses standard HTTP methods and headers; no WebSocket or long-polling is required for uploads.

---

## 2. Terminology

| Term | Meaning |
|------|---------|
| **Chunk** | A contiguous byte range of the source file, optionally encrypted. |
| **Upload Session** | A stateful server-side context that tracks chunk reception for a single file. |
| **Bundle** | A logical grouping of two or more files uploaded as a single unit. |
| **Sealed Bundle** | An encrypted bundle whose manifest is an opaque, client-encrypted blob. The server cannot read the member file names, but it does learn how many files the bundle has and each file's size when the upload starts ([§5.2](#52-bundle-upload)). |
| **Unsealed Bundle** | An unencrypted bundle whose file list is stored in plaintext on the server. |
| **File ID** | A UUID v4 assigned on upload completion. Used in download URLs. |
| **Upload ID** | A UUID v4 assigned on upload initialisation. Used only during the upload session and discarded afterwards. |

---

## 3. Capability Discovery

Before initiating an upload, the client MUST query the server's capabilities.

### 3.1 Request

```
GET /api/info
```

No authentication is required.

### 3.2 Response

A JSON object containing (at minimum):

| Field | Type | Description |
|-------|------|-------------|
| `version` | `string` | Server version (semver). |
| `capabilities.upload.enabled` | `boolean` | Whether DGUP is available. |
| `capabilities.upload.e2ee` | `boolean` | Whether E2EE is supported. |
| `capabilities.upload.maxSizeMB` | `number` | Maximum file size in megabytes (0 = unlimited). |
| `capabilities.upload.maxLifetimeHours` | `number` | Maximum permitted file lifetime in hours (0 = unlimited). |
| `capabilities.upload.maxFileDownloads` | `number` | Server-enforced maximum download limit (0 = unlimited). |
| `capabilities.upload.chunkSize` | `number` | Server's expected chunk size in bytes. |
| `capabilities.upload.bundleSizeMode` | `string` | `"total"` or `"per-file"` — how bundle size limits are applied. |

### 3.3 Compatibility

The client SHOULD compare its own version against the server version. Major version mismatches SHOULD be treated as incompatible. The client SHOULD respect `chunkSize` and all declared limits.

---

## 4. Encryption Layer

When E2EE is enabled, DGUP encrypts file content and filenames client-side before any data is transmitted. The server stores only ciphertext and has no mechanism to recover plaintext.

### 4.1 Algorithm

- **Cipher:** AES-GCM (Galois/Counter Mode).
- **Key length:** 256 bits.
- **IV (Initialisation Vector):** 12 bytes, cryptographically random, unique per chunk.
- **Authentication tag:** 16 bytes (appended to ciphertext by AES-GCM).

### 4.2 Key Generation

The client generates a fresh AES-256 key via the Web Crypto API (`crypto.subtle.generateKey`). The key is exported to a URL-safe Base64 string for inclusion in the download link fragment.

### 4.3 Filename Encryption

The original filename is encrypted with the same AES-GCM key and a separate random IV. The resulting ciphertext is Base64-encoded and transmitted in place of the plaintext filename.

### 4.4 Chunk Encryption

For each chunk:

1. A fresh 12-byte IV is generated.
2. The plaintext chunk is encrypted with AES-GCM using the session key and IV.
3. The output blob is: `IV (12 bytes) || ciphertext || authentication tag (16 bytes)`.
4. Encryption overhead per chunk is therefore **28 bytes**.

### 4.5 Key Transmission

The encryption key is appended to the download URL as a fragment identifier (`#<keyBase64>`). URL fragments are not included in HTTP requests and are therefore invisible to the server and any intermediate proxies.

**One exception:** pasting a full encrypted link into the Web UI's "enter a sharing code" box, or passing one to the core library's `resolveShareTarget()`, sends the whole link, including the key, to the server in the body of `POST /api/resolve`. The server only uses the path and does not store or log the value, but it does receive it. To open an encrypted link, paste it into the browser's address bar instead.

### 4.6 Secure Context Requirement

E2EE requires the Web Crypto API, which is only available in secure contexts (HTTPS or `localhost`). If the client cannot obtain a secure context, E2EE MUST be disabled or the upload MUST be rejected.

### 4.7 Integrity Limitations

Each chunk is encrypted and authenticated on its own, and one key is used for the filename, every chunk and, in bundles, every member file and the manifest. A chunk's position in the file, the file it belongs to and whether it is the last chunk are not part of what is authenticated.

So a server, or anyone able to modify stored files, cannot read or change the contents of an individual chunk, but could:

- remove chunks from the end of a file;
- reorder or duplicate chunks;
- swap member files of the same size within a bundle.

The result would still decrypt without an error. Size checks during download catch some of these changes, but not all of them.

### 4.8 Chunk Framing on Download

Encrypted files do not record the chunk size they were uploaded with. Clients split the downloaded stream using the chunk size the server currently advertises (`capabilities.upload.chunkSize` in `/api/info`).

If `UPLOAD_CHUNK_SIZE_BYTES` changes on a server that keeps uploads across restarts (`UPLOAD_PRESERVE_UPLOADS=true`), encrypted files uploaded before the change can no longer be decrypted. Unencrypted files are not affected.

---

## 5. Upload Initialisation

### 5.1 Single-File Upload

```
POST /upload/init
Content-Type: application/json
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `filename` | `string` | Yes | Plaintext or encrypted filename. |
| `totalSize` | `number` | Yes | Total size in bytes (including encryption overhead if applicable). |
| `totalChunks` | `number` | Yes | Number of chunks the file will be split into. |
| `isEncrypted` | `boolean` | Yes | Whether the payload is E2EE-encrypted. |
| `lifetime` | `number` | No | Requested lifetime in milliseconds. 0 or omitted = server default. |
| `maxDownloads` | `number` | No | Requested download limit. 0 = unlimited. |

**Server validation:**

1. `filename` MUST be non-empty and MUST NOT contain null bytes or control characters (unless encrypted).
2. Unencrypted filenames are checked for reserved OS names and path-traversal sequences.
3. Unencrypted filenames MUST NOT exceed 255 characters.
4. `totalSize` MUST NOT exceed the server's declared maximum file size.
5. `totalChunks` MUST NOT exceed 100,000.
6. `totalChunks` MUST be consistent with `totalSize` and the server's chunk size (±1 for rounding).
7. `lifetime` MUST NOT exceed the server's declared maximum lifetime.
8. `maxDownloads` MUST NOT exceed the server's declared maximum download limit.
9. Available storage quota is checked atomically under a mutex.

**Response (200):**

```json
{
  "uploadId": "<uuid>"
}
```

The server creates a temporary file at its configured upload path and reserves the declared bytes against the storage quota.

### 5.2 Bundle Upload

```
POST /upload/init-bundle
Content-Type: application/json
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `fileCount` | `number` | Yes | Number of files (≥ 2, ≤ 1,000). |
| `files` | `array` | Yes | Array of `{ filename, totalSize, totalChunks }` per file. |
| `isEncrypted` | `boolean` | Yes | Whether the bundle is E2EE-encrypted. |
| `lifetime` | `number` | No | Requested lifetime. |
| `maxDownloads` | `number` | No | Download limit applied at the bundle level. |

**Response (200):**

```json
{
  "bundleUploadId": "<uuid>",
  "fileUploadIds": ["<uuid>", "<uuid>", "..."]
}
```

Each file in the bundle receives its own upload ID and is uploaded independently using the chunk mechanism described below.

### 5.3 Session Expiry

- **Single-file sessions** expire after **2 minutes** of inactivity.
- **Bundle sessions** expire after **2 minutes** of inactivity.
- Each successful chunk upload resets the inactivity timer for the upload session, the parent bundle session (if applicable), and all sibling upload sessions within the same bundle.

---

## 6. Chunk Upload

### 6.1 Request

```
POST /upload/chunk
Content-Type: application/octet-stream
X-Upload-ID: <uploadId>
X-Chunk-Index: <0-based integer>
X-Chunk-Hash: <sha-256 hex digest>
```

The request body is the raw chunk bytes (encrypted or plaintext).

### 6.2 Chunk Sizing

The default chunk size is **5,242,880 bytes** (5 MiB). The server MAY advertise a different chunk size via `/api/info`. The minimum permitted chunk size is **65,536 bytes** (64 KiB).

For encrypted uploads, each chunk's on-wire size includes the 28-byte encryption overhead.

### 6.3 Server-Side Processing

1. The upload ID is validated against active sessions.
2. The chunk index is validated (0 ≤ index < totalChunks).
3. The SHA-256 digest of the received bytes is computed and compared to `X-Chunk-Hash`.
4. The chunk is checked for duplication. If that chunk index has already been received, the server responds `200` (`Chunk already received.`) and does not write it again. This makes retries safe.
5. The chunk is written to the temporary file at the calculated byte offset.
6. The session's inactivity timer is reset.

### 6.4 Integrity Verification

The SHA-256 hash in `X-Chunk-Hash` MUST be a 64-character lowercase hexadecimal string. The server independently hashes the received chunk and rejects it if the digests do not match. This guards against data corruption in transit.

### 6.5 Responses

| Status | Meaning |
|--------|---------|
| `200` | Chunk accepted, or already received (not written again). |
| `400` | Invalid chunk index, hash format, or hash mismatch. |
| `410` | Upload session expired or not found. |
| `413` | Chunk exceeds expected size. |
| `500` | File I/O error. |

---

## 7. Retry Strategy

Clients SHOULD implement automatic retries for transient failures.

### 7.1 Recommended Defaults

| Parameter | Default |
|-----------|---------|
| Maximum retries per chunk | 5 |
| Initial back-off | 1,000 ms |
| Back-off multiplier | 2× |
| Maximum back-off | 30,000 ms |
| Per-chunk timeout | 60,000 ms |

### 7.2 Non-Retryable Errors

- **Abort errors** (user cancellation) — fail immediately.
- **Validation errors** (4xx) — retrying will not help; fail immediately.
- **Storage quota exceeded** (507) — fail immediately.

---

## 8. Upload Completion

### 8.1 Single File

```
POST /upload/complete
Content-Type: application/json
```

```json
{
  "uploadId": "<uuid>"
}
```

**Server validation:**

1. All chunks MUST have been received (exact count match).
2. The temporary file's byte size MUST match the declared `totalSize`.
3. Zero-byte files are rejected.

**On success:**

1. The temporary file is renamed to a permanent path identified by a new UUID (the **File ID**).
2. A database record is created with: filename, path, encryption flag, download limit, download count (0), and expiry timestamp.
3. The storage quota counter is updated.

**Response (200):**

```json
{
  "id": "<fileId>"
}
```

### 8.2 Bundle

```
POST /upload/complete-bundle
Content-Type: application/json
```

```json
{
  "bundleUploadId": "<uuid>",
  "encryptedManifest": "<base64>"  // Only for sealed (encrypted) bundles
}
```

For **sealed bundles**, the `encryptedManifest` is an opaque Base64-encoded blob encrypted by the client. The server stores it verbatim. Only the holder of the encryption key can read the manifest.

For **unsealed bundles**, the server assembles the file list from the completed uploads.

**Response (200):**

```json
{
  "bundleId": "<uuid>"
}
```

---

## 9. Upload Cancellation

```
POST /upload/cancel
Content-Type: application/json
```

```json
{
  "uploadId": "<uuid>"
}
```

The server deletes the temporary file, releases the storage reservation, and removes the session.

---

## 10. Download Link Format

| Upload Type | URL Format |
|-------------|------------|
| Single file (unencrypted) | `https://<host>/<fileId>` |
| Single file (encrypted) | `https://<host>/<fileId>#<keyBase64>` |
| Bundle (unencrypted) | `https://<host>/b/<bundleId>` |
| Bundle (encrypted) | `https://<host>/b/<bundleId>#<keyBase64>` |

The fragment identifier (`#<keyBase64>`) is processed exclusively by the client. Browsers never include it in requests. The one case where it does reach the server is described in [§4.5](#45-key-transmission).

---

## 11. File Retrieval

### 11.1 Metadata

```
GET /api/file/<fileId>/meta
```

Returns file size, encryption flag, and either the plaintext filename or the encrypted filename blob.

```
GET /api/bundle/<bundleId>/meta
```

Returns bundle metadata. For sealed bundles, this includes only the encrypted manifest. For unsealed bundles, this includes the full file list.

### 11.2 Download

```
GET /api/file/<fileId>
```

Streams the raw file bytes. For encrypted files, the client decrypts the stream by reading each chunk's 12-byte IV prefix, decrypting the ciphertext with AES-GCM, and stripping the authentication tag.

### 11.3 Download Counting

- For **single files**, the download count is incremented after the stream completes.
- For **bundles**, the client calls `POST /api/bundle/<bundleId>/downloaded` once all member files have been retrieved.
- When `downloadCount >= maxDownloads` (and `maxDownloads > 0`), the file or bundle is immediately deleted.

---

## 12. Lifecycle Management

### 12.1 Expiry

Files and bundles are automatically deleted once their `expiresAt` timestamp is reached. The server runs a cleanup task every **60 seconds**.

### 12.2 Zombie Upload Cleanup

Incomplete upload sessions (where chunks are no longer arriving) are cleaned every **5 minutes** by default (configurable). Temporary files are deleted and storage reservations are released.

### 12.3 Server Restart Behaviour

By default, all uploads and temporary files are cleared on server restart. If `UPLOAD_PRESERVE_UPLOADS` is set to `true`, the server uses SQLite-backed persistence and retains both files and metadata across restarts.

---

## 13. Error Model

All error responses follow a consistent JSON structure:

```json
{
  "error": "<human-readable message>"
}
```

### 13.1 Status Codes

| Code | Context |
|------|---------|
| `200` | Success. |
| `400` | Validation failure (malformed request, invalid parameters). |
| `404` | File, bundle, or upload session not found. |
| `410` | Upload session expired. |
| `413` | File or chunk exceeds size limit. |
| `429` | Rate limit exceeded. |
| `500` | Internal server error. |
| `507` | Insufficient storage quota. |

---

## 14. Rate Limiting

The server enforces a request rate limit to protect against abuse. The defaults are:

| Parameter | Default |
|-----------|---------|
| Window | 60,000 ms |
| Maximum requests per window | 25 |

Rate limits are applied per IP address. When triggered, the server responds with HTTP 429.

---

## 15. Constraints Summary

| Aspect | Default | Notes |
|--------|---------|-------|
| Chunk size | 5 MiB | Minimum 64 KiB; server-configurable. |
| Maximum file size | 100 MiB | 0 = unlimited; server-configurable. |
| Maximum chunk count | 100,000 | Hard limit to prevent abuse. |
| Maximum bundle file count | 1,000 | Hard limit. |
| Maximum filename length | 255 chars | Unencrypted files only. |
| Default lifetime | 24 hours | Server-configurable. |
| Default max downloads | 1 | Server-configurable; 0 = unlimited. |
| Storage quota | 10 GiB | Server-configurable. |
| Encrypted manifest size | 1 MiB max | Sealed bundles only. |
| Upload session timeout | 2 minutes | Per-chunk inactivity. |
| Bundle session timeout | 2 minutes | Per-chunk inactivity (same as upload sessions). |
| IV size | 12 bytes | AES-GCM standard. |
| Authentication tag size | 16 bytes | AES-GCM standard. |
| Key size | 256 bits | AES-256. |

---

## 16. Best Practices

### 16.1 Server Deployment

- **Always deploy behind a reverse proxy that terminates TLS.** DGUP's E2EE features require HTTPS. Self-signed certificates are acceptable for private deployments but reduce trust for external users.
- **Set `UPLOAD_MAX_FILE_SIZE_MB` and `UPLOAD_MAX_STORAGE_GB` to sensible values.** Unbounded storage invites abuse.
- **Set `UPLOAD_MAX_FILE_LIFETIME_HOURS` conservatively.** Shorter lifetimes reduce exposure if a server is compromised.
- **Keep `UPLOAD_PRESERVE_UPLOADS=false` unless persistence is specifically required.** Non-persistent mode ensures a clean slate on each server restart, minimising the window during which uploaded data is at rest.
- **Enable rate limiting.** The defaults (25 requests per 60 seconds) are a reasonable starting point. Adjust based on expected traffic.
- **Avoid enabling `LOG_LEVEL=DEBUG` in production.** Debug logging may include chunk-level metadata that, in aggregate, reveals transfer patterns.

### 16.2 Client Behaviour

- **Always enable E2EE when the server supports it.** There is no meaningful performance penalty and it ensures the server operator cannot access file content.
- **Respect the server's advertised chunk size.** Mismatched chunk sizes will cause upload failures.
- **Implement retry logic.** Transient network failures are common; the recommended exponential back-off strategy prevents overwhelming the server.
- **Do not store encryption keys on the server or in server-accessible storage.** The key belongs exclusively in the download URL fragment.
- **Validate server certificates when connecting over HTTPS.** Disabling certificate verification defeats the purpose of TLS.

### 16.3 Network Privacy

- **Consider using a VPN when connecting to a Dropgate Server**, particularly for sensitive transfers. A VPN prevents the server operator and network intermediaries from observing the client's real IP address. If the VPN provider supports peer-to-peer traffic, the same VPN connection can protect both DGUP uploads and DGDTP transfers. Research VPN providers carefully — the privacy properties of a VPN are only as strong as the provider's logging and jurisdiction policies.

---

## 17. Request Flow Summary

```
Client                                          Server
  │                                               │
  │  GET /api/info                                │
  │──────────────────────────────────────────────►│
  │◄──────────────────────────────────────────────│
  │  { capabilities... }                          │
  │                                               │
  │  POST /upload/init                            │
  │  { filename, totalSize, totalChunks, ... }    │
  │──────────────────────────────────────────────►│
  │◄──────────────────────────────────────────────│
  │  { uploadId }                                 │
  │                                               │
  │  POST /upload/chunk  [×N]                     │
  │  X-Upload-ID | X-Chunk-Index | X-Chunk-Hash   │
  │  <binary body>                                │
  │──────────────────────────────────────────────►│
  │◄──────────────────────────────────────────────│
  │  200 OK                                       │
  │                                               │
  │  POST /upload/complete                        │
  │  { uploadId }                                 │
  │──────────────────────────────────────────────►│
  │◄──────────────────────────────────────────────│
  │  { id: <fileId> }                             │
  │                                               │

Download URL: https://<host>/<fileId>#<keyBase64>
```

---

## 18. Bundle Upload Flow Summary

```
Client                                          Server
  │                                               │
  │  POST /upload/init-bundle                     │
  │  { fileCount, files[], ... }                  │
  │──────────────────────────────────────────────►│
  │◄──────────────────────────────────────────────│
  │  { bundleUploadId, fileUploadIds[] }          │
  │                                               │
  │  ┌── For each file ──────────────────────┐    │
  │  │  POST /upload/chunk  [×N per file]    │    │
  │  │  ...                                  │    │
  │  │  POST /upload/complete                │    │
  │  │  { uploadId }                         │    │
  │  └──────────────────────────────────────-┘    │
  │                                               │
  │  POST /upload/complete-bundle                 │
  │  { bundleUploadId, encryptedManifest? }       │
  │──────────────────────────────────────────────►│
  │◄──────────────────────────────────────────────│
  │  { bundleId }                                 │
  │                                               │

Download URL: https://<host>/b/<bundleId>#<keyBase64>
```
