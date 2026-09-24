# Dropgate Data Processing

**Last Updated:** September 2026

This document describes what data Dropgate collects, where and why it is stored, how it is processed, and when it is deleted. It covers all three components of the monorepo: the Dropgate Server, the Dropgate Client (Electron), and the `dropgate-core` library (which is also used in the Web UI).

---

## 1. Principles

Dropgate follows a data-minimisation approach:

- **No user accounts or authentication.** There is no concept of a registered user. No usernames, passwords, email addresses, or tokens are collected.
- **No tracking or analytics.** Dropgate does not embed analytics scripts, tracking pixels, or third-party telemetry.
- **No cookies.** Neither the server nor the Web UI sets any cookies.
- **No persistent client-side web storage.** The Web UI does not use `localStorage`, `sessionStorage`, or `IndexedDB`. The one thing the browser keeps is the service worker that streamed downloads use (StreamSaver): after the first streamed download, it stays registered for the server's site. It stores no data.
- **Encryption by default.** When E2EE is enabled (the default), the server stores only ciphertext and has no mechanism to recover plaintext file content or filenames.

---

## 2. Data Inventory

The following tables enumerate every category of data processed by Dropgate, grouped by component.

### 2.1 Dropgate Server — Upload Protocol (DGUP)

| Data | Stored? | Where | Why | When Created | When Deleted |
|------|---------|-------|-----|--------------|--------------|
| **File content** (plaintext or ciphertext) | Yes | Filesystem: `/uploads/<fileId>` | Core purpose — the file must be persisted so recipients can download it. | On upload completion (`/upload/complete`). | On expiry, max downloads reached, or server restart (unless `UPLOAD_PRESERVE_UPLOADS=true`). |
| **Temporary file** (partial chunks) | Yes | Filesystem: `/uploads/tmp/<uploadId>` | Chunks must be written to disk as they arrive; holding them in memory would be infeasible for large files. | On upload initialisation (`/upload/init`). | On upload completion (renamed), cancellation, zombie cleanup, or server restart. |
| **Filename** | Yes | Database (in-memory or SQLite) | Required to set `Content-Disposition` on download. For encrypted uploads, the stored value is a Base64-encoded ciphertext blob — the server cannot read it. | On upload completion. | When the file record is deleted. |
| **File size** (bytes) | Yes | Database | Used for storage quota accounting, `Content-Length` headers, and progress reporting to download clients. | On upload completion. | When the file record is deleted. |
| **Encryption flag** (`isEncrypted`) | Yes | Database | Determines how the server serves the file (headers, MIME type, secure-context enforcement). | On upload completion. | When the file record is deleted. |
| **Download count** | Yes | Database | Enforces the maximum-download limit. Only stored when `maxDownloads > 0`. | On first download. Incremented on each subsequent download. | When the file record is deleted. |
| **Maximum downloads** | Yes | Database | Reference value for the download-count check. | On upload completion. | When the file record is deleted. |
| **Expiry timestamp** (`expiresAt`) | Yes | Database | Drives automatic deletion. `null` if no expiry. | On upload completion. | When the file record is deleted. |
| **File ID** (UUID) | Yes | Database (as key) | Unique identifier used in download URLs. | On upload completion. | When the file record is deleted. |
| **Upload ID** (UUID) | Temporarily | In-memory (`ongoingUploads` Map) | Tracks the upload session whilst chunks are being received. | On upload initialisation. | On completion, cancellation, zombie cleanup, or server restart. |
| **Received chunk indices** | Temporarily | In-memory (Set within upload session) | Detects duplicate chunks and validates completeness. | On each chunk upload. | When the upload session ends. |
| **Reserved storage bytes** | Temporarily | In-memory (quota counter) | Prevents TOCTOU race conditions during concurrent uploads. | On upload initialisation (under mutex). | Released on completion, cancellation, or zombie cleanup. |
| **Chunk hash** (SHA-256) | No | — | Verified on receipt and discarded. Not persisted. | — | — |

### 2.2 Dropgate Server — Bundle Data

| Data | Stored? | Where | Why | When Created | When Deleted |
|------|---------|-------|-----|--------------|--------------|
| **Bundle ID** (UUID) | Yes | Database (as key) | Unique identifier for the bundle download URL. | On bundle completion. | On expiry or max downloads reached. |
| **Encrypted manifest** (sealed bundles) | Yes | Database (Base64 blob, ≤ 1 MiB) | Allows the download client to enumerate files in the bundle. The server stores it as an opaque blob and cannot read it. | On bundle completion. | On expiry or max downloads reached. |
| **Plaintext file list** (unsealed bundles) | Yes | Database (JSON array of `{ fileId, name, sizeBytes }`) | Allows the server to serve the bundle download page and enumerate member files. | On bundle completion. | On expiry or max downloads reached. |
| **Bundle upload ID** (UUID) | Temporarily | In-memory (`ongoingBundles` Map) | Tracks the bundle session whilst individual files are being uploaded. | On bundle initialisation. | On bundle completion or zombie cleanup. |

### 2.3 Dropgate Server — P2P Signalling (DGDTP)

| Data | Stored? | Where | Why | When Created | When Deleted |
|------|---------|-------|-----|--------------|--------------|
| **Peer IDs** (P2P codes) | Transiently | PeerJS in-memory (not Dropgate-managed) | Peer discovery and routing. The code is also in the receiver link's URL path (`/p2p/<code>`), so reverse proxies may log it (see §9.2). | On peer registration. | On peer disconnection. |
| **ICE candidates** | Transiently | PeerJS in-memory (not Dropgate-managed) | NAT traversal — relayed between peers during WebRTC connection setup. Contains IP addresses and ports. | During ICE gathering. | On connection establishment or failure. |
| **SDP offers/answers** | Transiently | PeerJS in-memory (not Dropgate-managed) | WebRTC session negotiation. | During connection setup. | On connection establishment or failure. |
| **File content** | **Never** | — | File data flows directly between peers via the WebRTC data channel. The server is not involved. | — | — |
| **File metadata** (name, size, MIME) | **Never** | — | Exchanged between peers over the encrypted data channel. The server cannot observe it. | — | — |

These guarantees assume the server relays signalling honestly. The SDP it relays includes the DTLS certificate fingerprints that secure the peer connection, so a malicious or compromised server could put itself between the peers and read the transfer, including file names and contents. See [DGDTP §18.1](./DGDTP.md#181-transport-encryption).

### 2.4 Dropgate Server — HTTP Request Metadata

| Data | Stored? | Where | Why | When Created | When Deleted |
|------|---------|-------|-----|--------------|--------------|
| **Client IP address** | Transiently | In-memory (rate limiter) | Rate limiting. Tracked per sliding window by `express-rate-limit`. Not written to disk or database. | On each HTTP request. | When the rate-limit window expires (default: 60 seconds). |
| **User-Agent header** | **No** | — | Present in HTTP requests but not logged, stored, or processed by Dropgate. | — | — |
| **Request paths and methods** | **No** (unless logging) | stdout/stderr (if `LOG_LEVEL ≥ INFO`) | Operational logging. Not structured or persisted by Dropgate itself. Persistence depends on the server operator's log infrastructure. | On relevant server events. | Determined by operator's log retention policy. |

### 2.5 Dropgate Client (Electron)

| Data | Stored? | Where | Why | When Created | When Deleted |
|------|---------|-------|-----|--------------|--------------|
| **Server URL** | Yes | `electron-store` (`config.json` in user data directory) | Remembers the user's preferred server between sessions. | On user input (settings form). | On user change. Uninstalling leaves it in place. |
| **Lifetime preference** (value + unit) | Yes | `electron-store` | Remembers the user's preferred file lifetime. | On user input. | On user change. Uninstalling leaves it in place. |
| **Max downloads preference** | Yes | `electron-store` | Remembers the user's preferred download limit. | On user input. | On user change. Uninstalling leaves it in place. |
| **Window bounds** (x, y, width, height) | Yes | `electron-store` | Restores window position and size between sessions. | On window move/resize. | Never deleted automatically. Uninstalling leaves it in place. |
| **Debug log** | Yes | `{userData}/debug.log` | Troubleshooting application issues. Contains timestamps, process arguments, app lifecycle events, and upload progress. Process arguments include the full paths of files sent with **Share with Dropgate** or opened with the app, so the log can contain file names and folder paths. Does not contain file content, download links or encryption keys. Always written; there is no setting to turn it off. | On application start. | Overwritten each time the app starts. Not removed on uninstall. |
| **Update-check ID** | Yes | `{userData}/.updaterId` | Created by the auto-updater library (`electron-updater`) for staged rollouts, which Dropgate doesn't use. It's a random UUID, not derived from the device or user. It's sent with every update check (see [§9.3](#93-github-dropgate-client-update-checks)). | On the first update check. | Not removed on uninstall; deleting the file makes a new one. |

### 2.6 Web UI (Browser)

| Data | Stored? | Where | Why | When Created | When Deleted |
|------|---------|-------|-----|--------------|--------------|
| **Server capabilities** | Transiently | JavaScript memory | Cached `/api/info` response for the current page session. | On connection test. | On page unload. |
| **File references** | Transiently | JavaScript memory (`File` objects) | The user's selected files, held in memory for upload. | On file selection. | On page unload or upload completion. |
| **Transfer progress** | Transiently | JavaScript memory | Percentage, bytes transferred, etc. | During upload/P2P transfer. | On page unload or transfer completion. |

---

## 3. Encryption and Key Handling

### 3.1 What Is Encrypted

When E2EE is active:

- **File content** — encrypted with AES-256-GCM before leaving the client.
- **Filenames** — encrypted with the same key and a separate IV.
- **Bundle manifests** (sealed bundles) — encrypted client-side; the server stores an opaque blob.

### 3.2 What Is NOT Encrypted

Even with E2EE active, the following metadata is visible to the server:

- File size (including encryption overhead).
- Number of chunks.
- Whether the file is encrypted (`isEncrypted` flag).
- Expiry timestamp and download limits.
- Upload timing patterns (when chunks arrive).
- The length of each filename. Encrypted names aren't padded, so a stored encrypted name is exactly 28 bytes longer than the original name in UTF-8.
- For sealed bundles: the number of files, and each file's size and name length. The client sends these when the bundle upload starts; only the names themselves are hidden.

Encryption also protects each chunk only on its own. A chunk's position and whether it is the last one are not authenticated, so someone able to modify stored files could remove, reorder or duplicate chunks without the download failing to decrypt. See [DGUP §4.7](./DGUP.md#47-integrity-limitations).

### 3.3 Key Lifecycle

1. **Generated** by the client using `crypto.subtle.generateKey`.
2. **Used** to encrypt all chunks and the filename.
3. **Exported** to URL-safe Base64 and appended to the download URL as a fragment (`#<keyBase64>`).
4. **Not transmitted to the server.** URL fragments are not included in HTTP requests. The one exception: pasting a full encrypted link into the Web UI's "enter a sharing code" box sends the whole link, key included, to `POST /api/resolve`. The server only uses the path and doesn't store or log it. See [DGUP §4.5](./DGUP.md#45-key-transmission).
5. **Not persisted** by the client. The key exists only in the download link. If the link is lost, the file cannot be decrypted.

### 3.4 Server's Cryptographic Capabilities

The server has no access to encryption keys and therefore **cannot**:

- Decrypt file content.
- Read original filenames (when encrypted).
- Read sealed bundle manifests.
- Recover keys from stored data.

---

## 4. Data Storage Locations

### 4.1 Server Filesystem

```
/uploads/                    Main upload directory
  ├── <fileId>               Completed files (UUID names, no extensions)
  ├── tmp/
  │   └── <uploadId>         Temporary files during upload
  └── db/                    Only if UPLOAD_PRESERVE_UPLOADS=true
      ├── file-database.sqlite
      └── bundle-database.sqlite
```

### 4.2 Server Memory

| Structure | Contents | Lifetime |
|-----------|----------|----------|
| `ongoingUploads` (Map) | Active upload sessions. | Until completion, cancellation, or zombie cleanup. |
| `ongoingBundles` (Map) | Active bundle sessions. | Until bundle completion or zombie cleanup. |
| Rate limiter store | IP → request count mappings. | Sliding window (default 60 s). |
| File/bundle database | File/bundle metadata. | Persistent (SQLite) or until restart (in-memory). |
| PeerJS state | Peer connections, ICE candidates, SDP. | Until peer disconnection. |

### 4.3 Database Persistence Modes

| `UPLOAD_PRESERVE_UPLOADS` | Database Driver | Behaviour on Restart |
|---------------------------|-----------------|----------------------|
| `false` (default) | In-memory | All metadata lost. All files in `/uploads/` deleted. |
| `true` | SQLite (`/uploads/db/`) | Metadata and files preserved. Only `/uploads/tmp/` is cleaned. |

---

## 5. Data Deletion Triggers

### 5.1 Automatic Deletion

| Trigger | What Is Deleted | Frequency |
|---------|-----------------|-----------|
| **File expiry** (`expiresAt < now`) | File from disk + database record. | Checked every **60 seconds**. |
| **Bundle expiry** | Sealed: manifest record. Unsealed: all member files + manifest. | Checked every **60 seconds**. |
| **Max downloads reached** | Single file: file + record. Unsealed bundle: all member files + manifest. Sealed bundle: manifest record only; the member files stay on disk, and can still be downloaded by file ID, until they expire. A bundle download only counts when every file is downloaded together (**Download All as ZIP**); downloading files one at a time never counts. See [DGUP §11.3](./DGUP.md#113-download-counting). | Immediately after the triggering download. |
| **Zombie upload cleanup** | Temporary file + storage reservation + session state. **Known issue in 3.x:** when a bundle upload is cancelled or abandoned part-way, files that had already finished uploading stay on disk with no database record, so expiry never removes them. They're deleted at the next restart in the default mode, and kept indefinitely with `UPLOAD_PRESERVE_UPLOADS=true`. | Every **5 minutes** (configurable via `UPLOAD_ZOMBIE_CLEANUP_INTERVAL_MS`). |
| **Server restart** (non-persistent mode) | All files, temporary files, and in-memory data. | On process start. |
| **Server restart** (persistent mode) | Only temporary files in `/uploads/tmp/`. | On process start. |

### 5.2 User-Initiated Deletion

| Action | What Is Deleted |
|--------|-----------------|
| **Upload cancellation** (`POST /upload/cancel`) | Temporary file, storage reservation, session state. |
| **P2P transfer cancellation** (either peer calls `stop()`) | Connection resources. No server data to delete (DGDTP stores nothing on the server). |

### 5.3 What Is NOT Automatically Deleted

- **Electron client settings** (`electron-store`) — persist until the user changes them. Uninstalling the app leaves them, the debug log and the update-check ID in the user data directory.
- **Electron debug log** — persists until the app next starts, which overwrites it.
- **Server operator logs** (stdout/stderr) — Dropgate has no control over log retention once data is written to the process output streams. This is the operator's responsibility.

---

## 6. Data Flow: DGUP Upload

```
Client                          Server                        Filesystem
  │                               │                               │
  │  1. POST /upload/init         │                               │
  │  { filename, size, ... }      │                               │
  │──────────────────────────────►│                               │
  │                               │  2. Create temp file          │
  │                               │──────────────────────────────►│
  │                               │  3. Reserve quota (mutex)     │
  │                               │                               │
  │  4. POST /upload/chunk [×N]   │                               │
  │  <binary>                     │                               │
  │──────────────────────────────►│                               │
  │                               │  5. Verify SHA-256            │
  │                               │  6. Write to temp file        │
  │                               │──────────────────────────────►│
  │                               │                               │
  │  7. POST /upload/complete     │                               │
  │──────────────────────────────►│                               │
  │                               │  8. Rename temp → final       │
  │                               │──────────────────────────────►│
  │                               │  9. Write DB record           │
  │                               │  10. Update quota counter     │
  │                               │                               │

Data at rest: /uploads/<fileId> (ciphertext if E2EE)
              Database record: filename, size, expiry, download count
```

---

## 7. Data Flow: DGDTP P2P Transfer

```
Sender              Signalling Server              Receiver
  │                        │                          │
  │  1. Register peer      │                          │
  │  (P2P code)            │                          │
  │───────────────────────►│                          │
  │                        │                          │
  │                        │  2. Connect to code      │
  │                        │◄─────────────────────────│
  │                        │                          │
  │  3. ICE + SDP relay    │                          │
  │◄══════════════════════►│◄════════════════════════►│
  │                        │                          │
  │  4. Data channel established (DTLS-encrypted)     │
  │◄═════════════════════════════════════════════════►│
  │                        │                          │
  │  5. File data [×N]     │                          │
  │  (direct, not via      │  Server NOT involved     │
  │   server)              │  from this point         │
  │───────────────────────────────────────────────────►│
  │                        │                          │

Data at rest: NONE (server stores nothing)
Data in transit through server: ICE candidates (IP:port), SDP, peer IDs
Data in transit peer-to-peer: File content + metadata (DTLS-encrypted)
```

---

## 8. Logging

### 8.1 Server Log Levels

| Level | Value | What Is Logged |
|-------|-------|----------------|
| `NONE` | -1 | None of Dropgate's own messages (see [§8.3](#83-what-does-not-appear-in-logs) for what can still reach stderr). |
| `ERROR` | 0 | Startup and configuration errors, and file I/O failures. |
| `WARN` | 1 | Configuration warnings (such as the HTTPS requirement or an unlimited limit) and rate limit triggers. |
| `INFO` | 2 | Startup configuration and storage capacity at startup. Nothing per upload or download. **Default.** |
| `DEBUG` | 3 | Per-transfer events: upload init, each chunk, completion, downloads, deletion, expiry, cleanup and rejections. |

### 8.2 What Appears in Logs

**At `INFO` level (default):**

- Server startup configuration (port, enabled features, limits).
- Storage capacity at startup.
- Rate limit triggers (a `WARN` line, with no client details).

**At `DEBUG` level, in addition:**

- Upload lifecycle events: "Initialised upload", "File received", "File expired", with sizes and storage capacity.
- Chunk-level reception details (index, size).
- Bundle creation and deletion, including the number of files and the total size.
- Downloads, with the download count and limit.
- Validation rejection reasons.
- Storage quota calculations.

Every line carries a timestamp, so `DEBUG` output shows when transfers of a given size happened.

### 8.3 What Does NOT Appear in Logs

At any log level, Dropgate's own messages do **not** include:

- File content.
- Encryption keys.
- Filenames, plain or encrypted.
- File, bundle and upload IDs, or P2P codes.
- Individual client IP addresses (the rate limiter tracks these in memory, but they are not written to log output by Dropgate).
- Download URLs.
- User-Agent strings.

**Two exceptions sit outside `LOG_LEVEL`.** They write to stderr at every level, including `NONE`:

- **Unexpected errors.** Express prints the stack trace of any error Dropgate doesn't handle itself. A stack trace can include the internal path of a stored file, which contains its file ID (for example, if a file is deleted by expiry while it's being requested), or a few characters of a malformed request body.
- **Misconfigured reverse proxies.** If a proxy passes an invalid client address (for example `IP:port`), the rate limiter prints a one-time warning that includes it.

### 8.4 PeerJS Debug Logging

`PEERJS_DEBUG` currently has no effect. The bundled PeerJS server (`peer` 1.x) has no logging, and the Web UI and Dropgate Client always run PeerJS with its debug output off. The setting is still reported in `GET /api/info` as `peerjsDebugLogging`.

### 8.5 Operator Responsibility

Dropgate writes logs to stdout/stderr. Whether these logs are persisted, rotated, or forwarded to external systems is entirely under the server operator's control. Operators SHOULD:

- Set `LOG_LEVEL` to the minimum necessary for operational needs.
- Implement log rotation to avoid unbounded log growth.
- Consider the sensitivity of `DEBUG`-level output before enabling it.
- Be aware that reverse proxy access logs (e.g., Nginx, Caddy) may capture client IP addresses, request paths, and file IDs even if Dropgate itself does not log them.

---

## 9. Third-Party Data Exposure

### 9.1 STUN Servers

During DGDTP connection establishment, STUN binding requests are sent to the configured STUN server(s). These requests contain the sender's and receiver's IP addresses. The default STUN server is `stun:stun.cloudflare.com:3478`.

**Mitigation:** Self-host a STUN server to eliminate third-party IP exposure. Alternatively, use a VPN to mask real IP addresses before STUN requests are sent.

### 9.2 Reverse Proxies

A TLS-terminating reverse proxy (Nginx, Caddy, etc.) sits between clients and the Dropgate Server. It sees:

- Client IP addresses.
- Request URLs (including file IDs and P2P codes, but not URL fragments containing encryption keys). A P2P code is all that's needed to connect to a waiting sender.
- Every direct-transfer sender's code, even when the receiver types it in. PeerJS puts the peer ID in the URL of its WebSocket connection (`/peerjs/peerjs?key=peerjs&id=<code>&token=…`).
- Request and response sizes.
- TLS handshake metadata (SNI, client hello).

**Mitigation:** Configure the reverse proxy to minimise access logging. Be aware that file IDs in URLs are sufficient to construct download links (though not to decrypt encrypted files without the key fragment).

### 9.3 GitHub (Dropgate Client Update Checks)

The Dropgate Client checks GitHub for updates about 5 seconds after its window opens, and when you choose **Check for Updates**. It doesn't check during a background upload from **Share with Dropgate**.

Each check sends requests to GitHub (`github.com`, and GitHub's release-asset host for the update file). GitHub sees:

- The client's IP address and the time.
- An `x-user-staging-id` header holding the update-check ID from `{userData}/.updaterId` (see [§2.5](#25-dropgate-client-electron)). The auto-updater library adds it for staged rollouts, which Dropgate doesn't use. Because it stays the same for as long as the file exists, it lets GitHub link one installation's update checks together, even across different IP addresses.
- The user agent `electron-builder` and the system's preferred languages (`Accept-Language`). The check doesn't send the installed Dropgate version or any user details.

Dropgate itself receives none of this.

---

## 10. Best Practices for Data Handling

### 10.1 Server Operators

- **Use non-persistent mode (`UPLOAD_PRESERVE_UPLOADS=false`) unless persistence is required.** This ensures all data is cleared on server restart, reducing the window of exposure for data at rest.
- **Set conservative lifetimes and download limits.** Shorter lifetimes (`UPLOAD_MAX_FILE_LIFETIME_HOURS`) and low download counts (`UPLOAD_MAX_FILE_DOWNLOADS=1`) minimise the duration and accessibility of stored data.
- **Restrict storage quota.** A bounded `UPLOAD_MAX_STORAGE_GB` limits the volume of data that can accumulate.
- **Keep `LOG_LEVEL` at `INFO` or lower in production.** `DEBUG` logging includes chunk-level details that, in aggregate, reveal transfer patterns.
- **Treat stderr as a log.** Stack traces from unexpected errors reach it at every `LOG_LEVEL` (see §8.3), so apply the same retention to it.
- **Audit reverse proxy logs.** The reverse proxy may capture data that Dropgate itself does not log. Apply appropriate retention and access controls.
- **Review the `P2P_STUN_SERVERS` configuration.** If IP privacy is a concern, self-host STUN infrastructure rather than relying on third-party servers.

### 10.2 Users

- **Enable E2EE wherever possible.** When encryption is active, the server cannot access file content or filenames. There is no meaningful performance cost.
- **Share download links through secure channels.** The encryption key is embedded in the URL fragment. Anyone with the full URL can decrypt the file.
- **Use single-download mode (`maxDownloads=1`) for sensitive files.** The file is automatically deleted after one download, minimising exposure. For an encrypted bundle, only its file list is deleted, and the files themselves stay until their lifetime ends (see §5.1), so a short lifetime matters more there.
- **Use short lifetimes for sensitive files.** Even if the download limit is not reached, the file will be automatically deleted when the lifetime expires.
- **Consider using a VPN** when connecting to a Dropgate Server. This is particularly relevant for P2P transfers (DGDTP), where ICE candidates can expose real IP addresses. Choose a VPN provider that supports peer-to-peer traffic and research their privacy policies, logging practices, and jurisdiction carefully.
- **Prefer P2P (DGDTP) for the highest privacy.** When both sender and receiver are online simultaneously, DGDTP transfers file data directly between peers without it ever touching the server. The server's role is limited to initial signalling.
