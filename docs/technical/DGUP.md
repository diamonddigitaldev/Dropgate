# DGUP — Dropgate Upload Protocol

**Protocol Version:** 4.0, in development. Until it's finished, §4 to §12 and §16 to §18 describe version 3's requests, with `/api/info` giving version 4's fields. Version 4's routes go under `/api/v4/` as they're built: its uploads are in [§19](#19-version-4-uploads)
**Status:** In development
**Last Updated:** October 2026

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
| `version` | `string` | Server version (semver). For display only: compatibility never depends on it. |
| `protocols.dgup` | `{ major, minor }` | The version of DGUP (this protocol) the server speaks. |
| `protocols.dgdtp` | `{ major, minor }` | The version of [DGDTP](./DGDTP.md) the server's direct transfers use. |
| `capabilities.upload.enabled` | `boolean` | Whether DGUP is available. When it's `false`, `upload` has no other field. |
| `capabilities.upload.e2ee` | `boolean` | Whether E2EE is supported. |
| `capabilities.upload.maxSizeMB` | `number` | Maximum upload size in MB, counted in 1024s (× 1024 × 1024 bytes), for the whole upload: a bundle's files count together (0 = unlimited). |
| `capabilities.upload.maxLifetimeHours` | `number` | Maximum permitted file lifetime in hours (0 = unlimited). |
| `capabilities.upload.maxFileDownloads` | `number` | Server-enforced maximum download limit (0 = unlimited). |
| `capabilities.upload.chunkSize` | `number` | Server's expected chunk size in bytes. |
| `capabilities.upload.maxPauseMinutes` | `number` | How long the server keeps a paused upload, in minutes, or `0` when pausing is off ([§19.5](#195-pause-and-resume)). |
| `capabilities.upload.credentialRequired` | `boolean` | Whether an upload needs a credential ([§3.5](#35-credentials)). Absent means none. This server sends `false`: it asks for no credential yet. |
| `capabilities.accounts.enabled` | `boolean` | Whether the server has accounts. This server always sends `false`: accounts come later. |

The answer is never cached (`Cache-Control: no-store`). Version 3's `bundleSizeMode` is gone: the size limit always applies to the whole upload.

### 3.3 Compatibility

Each protocol is versioned on its own, apart from either app's version, and the client checks each before it uses it. This document describes DGUP version **4.0**.

- The client MUST NOT use a server for hosted transfers unless `protocols.dgup.major` is the major it speaks. A different minor works: a minor only adds to its major.
- The same goes for direct transfers and `protocols.dgdtp`. A server can work with a client for one protocol and not the other.
- A server that gives no `protocols` is older than Dropgate 4, and the client MUST treat it as working with neither. There is no backwards compatibility.
- When they don't work together, the client tells its user that an update is required, and on which side: the server, if its major is older (or it gives none), or the client, if the server's is newer. `@dropgate/core` fails the call with `VERSION_UNSUPPORTED`, whose `details` give `component` and `update`.
- The client MUST NOT send its own version, or its app's name or version, to the server.

The client SHOULD respect `chunkSize` and all declared limits.

### 3.4 Transport

The client uses the server's address as it was given.

- It MUST NOT retry an `https://` address over plain `http://`, and MUST NOT follow a redirect, so nothing on the network can move it onto plain HTTP.
- A server on plain `http://` on another machine is insecure: everything sent, the metadata, the web pages and their scripts included, can be read and changed on the way. The client MUST NOT use one unless its user or integrator chose to, explicitly. `@dropgate/core` refuses one with `INSECURE_TRANSPORT_NOT_ALLOWED` unless the client is made with `allowInsecure: true`, and then marks every result `transport.secure: false`.
- `http://localhost`, `http://127.0.0.1` and `http://[::1]` never leave the machine, and are secure. Only these names count.

---


### 3.5 Credentials

A server can ask for a credential before it accepts an upload, for accounts or quotas, with `capabilities.upload.credentialRequired: true`. This server doesn't yet: accounts come later.

- The client MUST NOT send a credential to a server that doesn't ask for one, nor with any request but an upload's: version 4's `POST /api/v4/uploads` and every `/api/v4/upload` request ([§19](#19-version-4-uploads)), the status, pause and resume included; version 3's `/upload/init`, `/upload/init-bundle`, `/upload/chunk`, `/upload/complete`, `/upload/complete-bundle` and `/upload/cancel`. Downloads, metadata and `/api/resolve` never need one: a link is its own permission.
- It sends the credential only in the `Authorization` header, as `Bearer <token>`: never in a URL, a request body, a link or an encrypted manifest, and never to another server (it follows no redirect).
- A server that refuses an upload's credential answers with an error whose JSON `code` is `AUTH_REQUIRED`, `AUTH_EXPIRED`, `AUTH_DENIED` or `QUOTA_EXCEEDED`. After `AUTH_EXPIRED`, the client may get a new credential once and make the request again; it retries none of the others as they are.

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

A whole encrypted link pasted into the Web UI's "enter a sharing code" box, or passed to the core library's `client.links.resolve()`, is read on the device. Only the file or bundle ID in its path is sent to `POST /api/resolve`; the key after the `#` never is, and the download page then opens with the key still on its address. A link to another server is refused without asking this one.

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

Sections 5 to 9 are version 3's uploads, until they go. Version 4's, which replace them, are in [§19](#19-version-4-uploads).

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
4. `totalSize` MUST NOT exceed the server's declared maximum upload size.
5. `totalChunks` MUST NOT exceed 100,000.
6. `totalChunks` MUST be consistent with `totalSize` and the server's chunk size (±1 for rounding).
7. `lifetime` MUST NOT exceed the server's declared maximum lifetime.
8. `maxDownloads` MUST NOT exceed the server's declared maximum download limit.
9. Available storage quota is checked atomically under a mutex.

**Client validation:** before anything is sent, the client checks every file name, encrypted or not, by the one file name rule both protocols share: a name is refused if it's empty, longer than 255 bytes in UTF-8, or has a control character or `/` or `\` in it. A client checks the names it receives the same way, and saves a received file under a name sanitised for every OS ([File Names](../core/quick-start.md#file-names)). The server never sees an encrypted upload's name, so it can't check it.

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

The files' combined size MUST NOT exceed the server's declared maximum upload size: the limit is for the whole bundle, whatever each file's size.

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

The default chunk size is **5,242,880 bytes** (5 MiB). The server MAY advertise a different chunk size via `/api/info`, from **65,536 bytes** (64 KiB) to **67,108,864 bytes** (64 MiB).

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
- For **bundles**, the client calls `POST /api/bundle/<bundleId>/downloaded` after downloading every member file together, as the Web UI's **Download All as ZIP** does. Downloading member files one at a time never counts towards the bundle's limit: the server doesn't count member downloads of unsealed bundles, and the members of sealed bundles have no limit of their own.
- When `downloadCount >= maxDownloads` (and `maxDownloads > 0`), the file or bundle is immediately deleted. For a **sealed** bundle, that means the manifest record only: its member files stay on disk, and can still be downloaded by file ID, until they expire.

---

## 12. Lifecycle Management

### 12.1 Expiry

A file or bundle is gone the moment its `expiresAt` timestamp is reached: from then on every route answers for it as for an ID that never existed (`404`, and the not-found page). Its bytes and record are deleted by a cleanup task that runs every **60 seconds**.

### 12.2 Zombie Upload Cleanup

Incomplete upload sessions (where chunks are no longer arriving) are cleaned every **5 minutes** by default (configurable). Temporary files are deleted and storage reservations are released.

**Known issue in 3.x:** when a bundle upload is cancelled or abandoned part-way, member files that had already finished uploading are not deleted from disk, although their database records are. Expiry can't find them, so they stay until the next restart in non-persistent mode, and indefinitely with `UPLOAD_PRESERVE_UPLOADS=true`.

### 12.3 Server Restart Behaviour

By default, all uploads and temporary files are cleared on server restart. If `UPLOAD_PRESERVE_UPLOADS` is set to `true`, the server uses SQLite-backed persistence and retains both files and metadata across restarts.

---

## 13. Error Model

Errors are JSON. Version 4's give a stable code with a short message for people:

```json
{
  "code": "<CODE>",
  "error": "<human-readable message>"
}
```

A message never holds an ID, a name, a key, a token, or anything from the request. Some add `details`, such as the field that's wrong (`details.field`) or the chunks held (`details.received`). Version 3's routes, described above until version 4's replace them, give their own errors with `error` alone. These are every code the server gives:

| Status | Code | When |
|--------|------|------|
| `400` | `INVALID_REQUEST` | A request body that can't be read, such as malformed JSON; or, starting a version 4 upload, a field missing or wrong ([§19.2](#192-start)). |
| `400` | `E2EE_DISABLED` | An encrypted version 4 upload, with E2EE off. |
| `400` | `UNSUPPORTED_OBJECT` | A version 4 upload whose header isn't version 4's. |
| `400` | `CHUNK_SIZE_MISMATCH` | A version 4 upload whose header's chunk size isn't the server's. |
| `400` | `LIFETIME_NOT_ALLOWED` | A version 4 upload's lifetime over the server's maximum, or none where it has one. |
| `400` | `DOWNLOADS_NOT_ALLOWED` | A version 4 upload's download limit over the server's, or none where it has one. |
| `400` | `INVALID_CHUNK` | A chunk index out of range, or a chunk of the wrong length ([§19.3](#193-chunks)). |
| `400` | `DIGEST_MISMATCH` | A chunk with no SHA-256 `Content-Digest`, or one that doesn't match it. |
| `404` | `NOT_FOUND` | Anything under `/api/v4/` that isn't a route, and a version 4 upload that's unknown, ended or dropped: one answer, so nothing says which. |
| `409` | `CHUNK_CONFLICT` | Different bytes for a chunk the server already holds. |
| `409` | `UPLOAD_INCOMPLETE` | A finish before every chunk is held, with `details.received`. |
| `409` | `PAUSE_DISABLED` | A pause, on a server with pausing off. |
| `413` | `TOO_LARGE` | A JSON request body over its limit (1 MiB, or 2 MiB for a version 4 upload's start), or a version 4 upload over the maximum upload size. |
| `429` | `RATE_LIMITED` | Too many requests ([§14.1](#141-rate-limits)). |
| `500` | `SERVER_ERROR` | Anything unexpected while answering. The server logs the error's kind and the route's pattern, never its message, which can hold a path or part of the request ([PRIVACY.md](../PRIVACY.md)). |
| `507` | `SERVER_FULL` | Not enough storage for a version 4 upload. |

### 13.1 Status Codes

| Code | Context |
|------|---------|
| `200` | Success. |
| `201` | A version 4 upload started, or finished. |
| `204` | A version 4 upload cancelled. |
| `400` | Validation failure (malformed request, invalid parameters). |
| `404` | File, bundle, or upload session not found. |
| `409` | A version 4 chunk conflict, a finish too soon, or pausing off. |
| `410` | Upload session expired. |
| `413` | File or chunk exceeds size limit. |
| `429` | Rate limit exceeded. |
| `500` | Internal server error. |
| `507` | Insufficient storage quota. |

---

## 14. Rate Limiting and Cross-Origin Requests

### 14.1 Rate Limits

The server enforces a request rate limit to protect against abuse. The defaults are:

| Parameter | Default |
|-----------|---------|
| Window | 60,000 ms |
| Maximum requests per window | 25 |

Rate limits are applied per IP address. When triggered, the server responds with HTTP 429, `RATE_LIMITED`, and `Retry-After` gives the seconds until the window resets.

### 14.2 Cross-Origin Requests

Everything under `/api/` answers any origin (`Access-Control-Allow-Origin: *`), because the desktop app and other integrators call it from their own. No cookie is ever set or sent, so another site has nothing to borrow. A request may send `Content-Type`, `Content-Digest`, `Range`, `If-Range`, `Authorization`, `Dropgate-Upload`, `Dropgate-Lease` and `Dropgate-Manage-Token`, and a script may read `ETag`, `Content-Range`, `Accept-Ranges`, `Retry-After` and `Content-Length` from the answer. Version 3's upload routes, under `/upload/`, allow any request header until they go. Pages and the Web UI's files get no CORS headers.

---

## 15. Constraints Summary

| Aspect | Default | Notes |
|--------|---------|-------|
| Chunk size | 5 MiB | 64 KiB to 64 MiB; server-configurable. |
| Maximum upload size | 100 MiB | For the whole upload; 0 = unlimited; server-configurable. |
| Maximum chunk count | 100,000 | Hard limit to prevent abuse. |
| Maximum bundle file count | 1,000 | Hard limit. |
| Maximum filename length | 255 chars | Unencrypted files only. |
| Default lifetime | 24 hours | Server-configurable. |
| Default max downloads | 1 | Server-configurable; 0 = unlimited. |
| Storage quota | 10 GiB | Server-configurable. |
| Encrypted manifest size | 1 MiB max | Sealed bundles only. |
| Upload session timeout | 2 minutes | Per-chunk inactivity. |
| Bundle session timeout | 2 minutes | Per-chunk inactivity (same as upload sessions). |
| Version 4 upload, quiet | 5 minutes | After its last request, unless paused. |
| Version 4 upload, paused | 60 minutes | `UPLOAD_MAX_PAUSE_MINUTES`, 1 to 1,440, or 0 to turn pausing off. |
| Version 4 finish kept | 5 minutes | A repeated finish gets the same answer. |
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

---

## 19. Version 4 Uploads

Version 4's upload routes are under `/api/v4/`, beside version 3's while version 4 is built. They replace §5 to §9: one upload is one **object**, a single file or a bundle alike, started, sent in chunks that can be sent again, then finished. Downloads, and the uploader's own delete, come with the next routes.

- **The upload's ID** is given by the start, and every request after it names the upload in the `Dropgate-Upload` header, never in its URL.
- **Every answer to an upload in progress carries its `deadline`**: when the server ends it unless something renews it, in milliseconds since 1970 ([§19.8](#198-how-long-an-upload-lasts)).
- **Every error is JSON** with a `code` ([§13](#13-error-model)). One that names a field gives it in `details.field`.

### 19.1 The Object

What the server stores is bytes it doesn't need to understand, except an encrypted object's header, which says where each chunk goes.

- **Encrypted:** a 60-byte header, then the chunks. The header begins `DGUP` (`44 47 55 50`), then the version (`04`), the cipher suite (`01`), two reserved zero bytes, and the chunk size, an unsigned 32-bit big-endian number: the plaintext bytes in every chunk but the last. The rest of it is the object's own random salt and a MAC only the link's holder can check. Each chunk is AES-256-GCM ciphertext with its 16-byte tag, so every chunk but the last is the chunk size plus 16 bytes, and the last is 17 bytes up to that. The files are padded inside the chunks (Padmé), so the object's size says little about theirs.
- **The sealed file list** (`meta`) travels apart from the object: a 12-byte nonce, then the encrypted list with its tag, padded to a size from 4 KiB up to 1 MiB, so a single file and a bundle of up to around 50 files look the same.
- **Unencrypted:** the files' bytes one after another, in the list's order, in chunks of the chunk size; the last chunk is the rest. The file list is in plain, with each file's name and size.

The client makes the object; the server checks its header's format and chunk size, and each chunk's length and digest.

### 19.2 Start

```
POST /api/v4/uploads
Content-Type: application/json
```

| Field | Type | Description |
|-------|------|-------------|
| `encrypted` | `boolean` | Whether the object is encrypted. |
| `size` | `number` | The stored object's bytes: for an encrypted one, the header, padding and tags included. |
| `header` | `string` | Encrypted only: the object's 60-byte header, base64url with no padding. |
| `meta` | `string` | Encrypted only: the sealed file list, base64url, at most 1 MiB + 28 bytes. Sent at the start, so the finish takes no body. |
| `files` | `array` | Unencrypted only: 1 to 1,000 `{ name, size }`, in order. Each name by the file name rule ([§5.1](#51-single-file-upload)), each size at least 1, and the sizes add up to `size`. |
| `lifetimeMs` | `number` | How long to keep the upload once it's finished, in milliseconds; `0` for no limit, where the server allows it. |
| `maxDownloads` | `number` | Optional: the download limit, `0` for none, by the same rules as version 3's. |
| `manageTokenHash` | `string` | The SHA-256 of a manage token the client made, base64url (32 bytes). The token itself never reaches the server at the start. |

The body may be up to 2 MiB. The server checks, and the first failure answers:

| Status | Code | When |
|--------|------|------|
| `400` | `INVALID_REQUEST` | A field missing or wrong, named in `details.field`; or a `size` no object can have at the server's chunk size, or one of more than 100,000 chunks (`size`). |
| `400` | `E2EE_DISABLED` | An encrypted upload, on a server with E2EE off. |
| `400` | `UNSUPPORTED_OBJECT` | A header that isn't version 4's: another magic, version, suite, or reserved bytes. |
| `400` | `CHUNK_SIZE_MISMATCH` | A header whose chunk size isn't the server's (`capabilities.upload.chunkSize`). |
| `413` | `TOO_LARGE` | A `size` over the server's maximum upload size, which is for the whole object, padding included. |
| `400` | `LIFETIME_NOT_ALLOWED` | A lifetime over the server's maximum, or none where the server has one. |
| `400` | `DOWNLOADS_NOT_ALLOWED` | A download limit over the server's, or none where the server has one. |
| `507` | `SERVER_FULL` | Not enough storage: what's stored, and what every upload in progress has reserved, counts. |

Then the server reserves `size` bytes of storage, keeps the upload in memory, writes an encrypted object's header to its temporary file, and responds `201`:

```json
{
  "uploadId": "<uuid>",
  "chunks": 20,
  "chunkSize": 5242880,
  "deadline": 1759766700000
}
```

### 19.3 Chunks

```
PUT /api/v4/upload/chunks/{index}
Content-Type: application/octet-stream
Content-Digest: sha-256=:<base64>:
Dropgate-Upload: <uploadId>
```

The body is chunk `index`'s bytes, from 0, exactly its length. `Content-Digest` is the SHA-256 of the body ([RFC 9530](https://www.rfc-editor.org/rfc/rfc9530)); another algorithm may sit beside it. Chunks can come in any order, and each is written where it goes in the object.

- **The same chunk again,** with the same digest, is `200` and isn't written again, so a retry is always safe. With different bytes it's refused: the server compares the digest it kept.
- **A chunk sent while the upload is paused resumes it.**
- The server reads no more than the chunk's length. A request it refuses before reading its body closes the connection.

| Status | Code | When |
|--------|------|------|
| `200` | — | Written, or the same bytes already held. The body is `{ "deadline": … }`. |
| `400` | `INVALID_CHUNK` | No chunk has that index, or the body isn't that chunk's length. |
| `400` | `DIGEST_MISMATCH` | No `Content-Digest` with SHA-256, or one that doesn't match the body. |
| `404` | `NOT_FOUND` | No upload in progress by that ID. |
| `409` | `CHUNK_CONFLICT` | Different bytes for a chunk the server already holds. |

### 19.4 Status

```
GET /api/v4/upload
Dropgate-Upload: <uploadId>
```

```json
{ "chunks": 20, "received": [[0, 11], [13, 13]], "paused": false, "deadline": 1759766700000 }
```

`received` gives the chunks the server holds, as inclusive ranges. A client resuming an upload asks for it, then sends the rest.

### 19.5 Pause and Resume

```
POST /api/v4/upload/pause
POST /api/v4/upload/resume
```

Each names the upload in `Dropgate-Upload`, with no body.

- **Pause** responds `{ "paused": true, "deadline": … }`: the server keeps the upload for `UPLOAD_MAX_PAUSE_MINUTES` (`capabilities.upload.maxPauseMinutes`) from now, and pausing again renews that from then. With pausing off (`0`), it's `409`, `PAUSE_DISABLED`, and the upload goes on unpaused.
- **Resume** responds `{ "paused": false, "deadline": …, "received": [...] }`, with the chunks held, as the status gives them, and a quiet upload's deadline.

### 19.6 Finish

```
POST /api/v4/upload/complete
Dropgate-Upload: <uploadId>
```

No body. Before every chunk is held, it's `409`, `UPLOAD_INCOMPLETE`, with `details.received` as the status gives it. Then the server checks the object is `size` bytes, stores it as `data/uploads/objects/<id>`, writes its record ([§19.10](#1910-the-record)), ends the upload, releases its reservation, and responds `201`:

```json
{ "id": "<uuid>" }
```

The upload's lifetime starts now. **Finishing can be asked again:** for 5 minutes, the same request gets the same answer, and two at once store one object. After that, it's `404`. Nothing else can change a finished upload.

### 19.7 Cancel

```
DELETE /api/v4/upload
Dropgate-Upload: <uploadId>
```

Responds `204`, with no body: the temporary file, the reservation and the upload go. An upload that isn't in progress, finished ones included, is `404`; cancelling never removes a finished upload.

### 19.8 How Long an Upload Lasts

- **5 minutes after its last request,** unless it's paused. Any request renews it, the status included; a chunk still arriving isn't quiet.
- **Paused, until the pause's deadline,** which only pausing again renews. Asking for the status meanwhile doesn't.
- **At its deadline it ends at once:** its temporary file and its reservation go, and from then on it's `404`, `NOT_FOUND`, the same answer as for an upload that never existed.
- **A restart ends every upload,** paused or not, in persistent mode too: nothing about one is ever written to a database, and `data/uploads/tmp/` is cleared at each start.

### 19.9 Rate Limits and Credentials

- **The start is rate-limited** ([§14.1](#141-rate-limits)). Every request after it skips the limit while its upload is in progress, or just finished; one naming an upload the server doesn't have is limited.
- **Every upload route has the place a credential is checked** ([§3.5](#35-credentials)), the status, pause and resume included. This server asks for none yet, so they check nothing, and never write one anywhere.

### 19.10 The Record

A finished upload's record holds only what serving and ending it needs: `encrypted`, `size`, `meta` (encrypted) or `files` (unencrypted), `expiresAt`, `maxDownloads`, `downloadCount` (only with a limit) and `manageTokenHash`. Its ID is the object's file name. There's no creation time, address, account or upload ID. Records are in memory, or with `UPLOAD_PRESERVE_UPLOADS=true` in `data/uploads/db/objects.sqlite`. An expired upload's object and record are deleted at the next check, every 60 seconds.

Storage used is the stored objects (and version 3's files) and what every upload in progress has reserved: not temporary files, the databases or the format marker.
