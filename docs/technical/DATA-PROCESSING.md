# Dropgate Data Processing

**Last Updated:** October 2026

This document describes what data Dropgate collects, where and why it is stored, how it is processed, and when it is deleted. It covers all three components of the monorepo: the Dropgate Server, the Dropgate Client (Electron), and the `dropgate-core` library (which is also used in the Web UI).

---

## 1. Principles

Dropgate follows a data-minimisation approach:

- **No user accounts or authentication.** There is no concept of a registered user. No usernames, passwords, email addresses, or tokens are collected.
- **No tracking or analytics.** Dropgate does not embed analytics scripts, tracking pixels, or third-party telemetry.
- **No cookies.** Neither the server nor the Web UI sets any cookies, and none are ever sent: every request the Web UI, the core library and the Dropgate Client make omits credentials (`credentials: 'omit'`).
- **No persistent client-side web storage.** The Web UI does not use `localStorage`, `sessionStorage`, or `IndexedDB`. The one thing the browser keeps is the service worker that streamed downloads use (StreamSaver): after the first streamed download, it stays registered for the server's site. It stores no data.
- **Encryption by default.** When E2EE is enabled (the default), the server stores only ciphertext and has no mechanism to recover plaintext file content or filenames.

---

## 2. Data Inventory

The following tables enumerate every category of data processed by Dropgate, grouped by component.

### 2.1 Dropgate Server — Upload Protocol (DGUP)

| Data | Stored? | Where | Why | When Created | When Deleted |
|------|---------|-------|-----|--------------|--------------|
| **Stored upload** (a file or several, ciphertext or plaintext) | Yes | Filesystem: `data/uploads/objects/<id>` | Core purpose — the upload must be kept so recipients can download it: one object per upload, several files in one object. Encrypted, it holds a header the server reads only for its format and chunk size, then the chunks, with the files padded inside them. | On finishing (`POST /api/v4/upload/complete`). | On expiry, at its download limit, by its uploader's delete, or server restart (unless `UPLOAD_PRESERVE_UPLOADS=true`). |
| **Upload in progress** | Temporarily | Filesystem: `data/uploads/tmp/<uploadId>`; in memory: its ID, `encrypted`, size, chunk size and count, the file list (below), lifetime, download limit, manage-token hash, each chunk held with its SHA-256, the storage reserved, paused or not, and its deadline | The chunks are written to disk as they arrive. Each chunk's digest is kept, so the same chunk sent again is recognised and different bytes for it refused. The storage is reserved under a lock, so two uploads at once can't both take the last of it. No IP address, account or time it started. | On starting (`POST /api/v4/uploads`). | On finishing (renamed), cancellation, its deadline (5 minutes after its last request, or, paused, when the pause runs out), or server restart, persistent mode included: never written to a database. |
| **Upload ID** (UUID) | Temporarily | In memory, with the upload in progress | Names the upload in the `Dropgate-Upload` header of each request after the start, never in a URL. | On starting. | With the upload in progress; and kept 5 minutes after finishing (below). |
| **Upload's ID** (UUID) | Yes | Database (as key), and the object's file name | Identifies the upload in its link. | On finishing. | When the record is deleted. |
| **Size** (bytes) | Yes | Database | The stored object's size, padding included: for storage counting, `Content-Length` and ranges. | On finishing. | When the record is deleted. |
| **Encryption flag** (`encrypted`) | Yes | Database | How the upload is served: an encrypted one goes only through a client that can decrypt it, and isn't served while E2EE is off. | On finishing. | When the record is deleted. |
| **Expiry timestamp** (`expiresAt`) | Yes | Database | Drives automatic deletion. `null` if no expiry. | On finishing. | When the record is deleted. |
| **Maximum downloads** (`maxDownloads`) | Yes | Database | The upload's download limit, `0` for none. | On finishing. | When the record is deleted. |
| **Sealed file list** (`meta`) | Yes | Database | An encrypted upload's file names and sizes, encrypted by the client and padded to a size from 4 KiB to 1 MiB. The server can't read it, and its size says little about how many files there are. | On starting (in memory); on finishing (record). | When the record is deleted. |
| **File list** (`files`, unencrypted) | Yes | Database | An unencrypted upload's file names and sizes, for its download pages and the name a browser saves a single file under, as Dropgate 3 kept an unencrypted file's name. | On starting (in memory); on finishing (record). | When the record is deleted. |
| **Manage-token hash** | Yes | Database | The SHA-256 of a random token only the uploader's page or app holds, so the uploader can delete their own upload. The token itself is sent only with the delete (`DELETE /api/v4/objects/{id}`), compared with the hash, and never stored or logged. | On starting (in memory); on finishing (record). | When the record is deleted. |
| **Download count** (`downloadCount`) | Yes | Database | Enforces the upload's download limit. Only stored when it has one. One download is one lease that sent any bytes, counted when the lease ends. | On finishing, at 0. | When the record is deleted. |
| **Download lease** | Temporarily | In memory: a random lease ID, the upload's ID, whether it has sent any bytes, paused or not, its deadline, and the answers sending its bytes now | So a download's retries, ranges and files count once, and two downloads can't both take a limit's last place. No IP address, account or time it was taken. | On taking a lease (`POST /api/v4/objects/{id}/leases`). | When it's released, at its deadline (5 minutes after its last request, or, paused, when the pause runs out), when its upload is removed, or server restart. |
| **A finished upload's answer** | Temporarily | In memory: upload ID → the object's ID | So that finishing again gets the same answer. | On finishing. | 5 minutes later, or server restart. |
| **Storage format marker** | Yes | Filesystem: `data/uploads/dropgate-storage.json` | Says which version's layout the uploads folder holds (`{"format": 4}`), so a later version can tell. It holds nothing about any upload. | At every start with uploads on. | With the rest of the uploads folder: at shutdown and the next start in the default mode. |

### 2.2 Dropgate Server — What a Dropgate 3 Server Left

Dropgate 4 reads nothing a Dropgate 3 server stored, and no Dropgate 3 link works with it. So it keeps none of it either:

| Data | Stored? | Where | Why | When Created | When Deleted |
|------|---------|-------|-----|--------------|--------------|
| **A persistent Dropgate 3 server's uploads** | Deleted | `data/uploads/`: `db/file-database.sqlite` and `db/bundle-database.sqlite` (with SQLite's `-wal`, `-shm` and `-journal` files), and stored files named by their IDs | Nobody can reach them any more, so keeping them would only keep data. Nothing else in `data/uploads/` is touched. | By Dropgate 3. | At each start in persistent mode, with one `INFO` line giving how many uploads went, and no ID or name ([DGUP §10.4](./DGUP.md#104-a-dropgate-3-servers-leftovers)). In the default mode, the start clears `data/uploads/` whole anyway. |
| **A Dropgate 3 folder the server doesn't use** | Left as it is | `server/uploads/` beside `server/data/` in a copy run from the repository, or a Docker volume still mapped to Dropgate 3's `/usr/src/app/uploads` | Dropgate 4 never looks there. | By Dropgate 3. | When its operator removes it ([Dropgate Server README](../../server/README.md)). |

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

The client's settings are kept by `electron-store` in `config.json` in its user data directory, under one `settings` key. Version 3's settings were top-level keys of the same file; the first launch of version 4 deletes them, once, so the server has to be entered again.

| Data | Stored? | Where | Why | When Created | When Deleted |
|------|---------|-------|-----|--------------|--------------|
| **Server URL** | Yes | `config.json` | Remembers the user's server between sessions. Set in **Settings**, under **Server**. | When it's changed, or when **Test** finds it. | On user change. Uninstalling leaves it in place. |
| **Lifetime preference** (value + unit) | Yes | `config.json` | Remembers the user's preferred file lifetime, which **Share with Dropgate** uses too. | On user input. | On user change. Uninstalling leaves it in place. |
| **Max downloads preference** | Yes | `config.json` | Remembers the user's preferred download limit, which **Share with Dropgate** uses too. | On user input. | On user change. Uninstalling leaves it in place. |
| **Update preferences** (download automatically, update channel) | Yes | `config.json` | **Settings**, under **Update**. The channel starts as the running build's own (Stable, Beta or Alpha) and is then the user's choice. | On the first launch, and on user change. | On user change. Uninstalling leaves them in place. |
| **Whether the navigation rail is collapsed**, and whether to keep the log on disk | Yes | `config.json` | Remembers how the window was left, and **Keep log on disk for troubleshooting** (**Settings**, under **Privacy**; off; see §8.6). | On user change. | On user change. Uninstalling leaves them in place. |
| **Window bounds** (x, y, width, height) | Yes | `config.json` | Restores window position and size between sessions. | On window move/resize. | Never deleted automatically. Uninstalling leaves it in place. |
| **Log** | In memory; on disk only if the user turns it on | The app's memory; `debug.log` in the user data directory | Troubleshooting. The run's last 1,000 lines, redacted before they're kept (see §8.6). | As the app runs; the file when the setting is turned on. | When the app quits; the file as soon as the setting is turned off, and at a launch with it off. A `debug.log` an earlier version wrote is deleted when the app starts. |
| **The download link, on the clipboard** | Until something else is copied | The system clipboard | Every successful upload's link is copied, as is the link when **Copy** is chosen. It holds an encrypted upload's key, so it's copied marked to be left out of Windows' clipboard history and cloud clipboard (and by apps that watch the clipboard), and out of KDE's clipboard history on Linux. | When an upload finishes, or on **Copy**. | When the clipboard is next written to. Other clipboard managers on Linux may still keep it. |
| **Notifications** | By the OS | The OS's notification history | **Share with Dropgate** says what it's doing in notifications, which say how many files ("Uploading 3 files…"), never which. A paused upload's notification, 5 minutes before the server drops it, gives the time and nothing about the files. | During a background upload, and before a paused upload's deadline. | As the OS clears its notifications. |
| **Files chosen, and an upload in progress, paused or not** | In memory only | The app's memory | Each file chosen's path, with its size and modification time then, so a file changed since isn't read; and an upload's state, with, while it's paused, the chunk it stopped and the deadline the server gave. Nothing is written to disk. | When a file is chosen; when the upload starts, or pauses. | When the file leaves the list or its upload ends, and when the app quits. |
| **The installer's choices** (Windows) | Yes | The registry, in the install's own key (`Software\<app's ID>`) | Whether "Share with Dropgate" was added to the right-click menu: one value, so an update keeps the choice. Who it's installed for is the install's location (only for you, or everyone). Nothing about the person. | When the app is installed. | When it's uninstalled, with the right-click entry. |
| **Update-check ID** | **No** | — | The app sends a fixed value, the same for every installation, in place of an ID, and never makes or keeps one (see [§9.3](#93-github-dropgate-client-update-checks)). An `.updaterId` file written by version 3 is deleted when the app starts, and never read or sent. | — | — |
| **Spell-check dictionaries** | **No** | — | The app has no spell checking, so it downloads no dictionaries. (On Linux, Electron would otherwise download them from Google as the app starts.) | — | — |
| **Update downloads** | Yes, until installed | The user's cache folder (`dropgate-client-updater`) | An update the app has downloaded, waiting to be installed when the app closes. | When an update is downloaded. | Replaced by the next update. |

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

- **File content** — encrypted with AES-256-GCM before leaving the client, in chunks, with the files padded inside them.
- **File names and sizes** — in a list sealed with AES-256-GCM, padded to 4 KiB or more.

Each has its own key, made from the link's secret ([DGUP §4](./DGUP.md#4-the-object)). Each chunk's position, and whether it's the last, are authenticated too, so a changed, reordered, shortened or mixed-up upload fails to download ([DGUP §4.4](./DGUP.md#44-the-chunks)).

### 3.2 What Is NOT Encrypted

Even with E2EE active, the following metadata is visible to the server:

- The stored size: the files' sizes together, padded (Padmé, to within about 1%, and never past the maximum upload size), with the header and each chunk's tag.
- Roughly how many files there are, but only above a few dozen: the sealed list's size doubles from 4 KiB.
- Whether the upload is encrypted.
- Expiry timestamp and download limit.
- Upload timing patterns (when chunks arrive), and when downloads happen.

A file name's length isn't visible: names are only in the sealed list.

### 3.3 Key Lifecycle

For an upload of one file or several:

1. **A secret is generated** by the client: 32 bytes from the browser's or the system's secure random numbers.
2. **Keys are made from it**, one for the upload's header, one for its chunks and one for its list of files, each with HKDF-SHA256 and the upload's own random salt. They can't be exported, and are never stored.
3. **The secret is appended** to the download URL as a fragment, in URL-safe Base64 (`#<secret>`, 43 characters).
4. **Not transmitted to the server.** URL fragments are not included in HTTP requests. A whole link pasted into the Web UI's "enter a sharing code" box, or given to the core library's `client.links.resolve()`, is read on the device, and nothing of it is sent: the download page it opens asks about the upload. See [DGUP §9.1](./DGUP.md#91-links).
5. **Not persisted** by the client. The secret exists only in the download link. If the link is lost, the file cannot be decrypted.

The upload's **manage token**, which deletes it ([DGUP §7](./DGUP.md#7-the-uploaders-delete)), is 32 more random bytes, made with the secret. The server is sent only its SHA-256, and the token itself stays in the memory of the page or app that uploaded the file: neither the Web UI nor the desktop app writes it anywhere, and it's gone when the page or the app closes. The Web UI's result screen offers **Delete Upload** while the page holds it; a reload, or **Send More Files**, drops it ([DGUP §9.3](./DGUP.md#93-deleting-from-the-result-screen)). The token itself is sent only to delete the upload, in the `Dropgate-Manage-Token` header: never in a URL, so it's in no address bar, history or proxy log, and never in an error or a log line, on either side.

Several files are one upload: one secret, one manage token and one link for all of them.

### 3.4 Server's Cryptographic Capabilities

The server has no access to encryption keys and therefore **cannot**:

- Decrypt file content.
- Read an encrypted upload's file names or sizes, or its sealed file list.
- Recover keys from stored data.

---

## 4. Data Storage Locations

### 4.1 Server Filesystem

Everything the server keeps is in one folder, `data/` beside `server.js` (`/app/data` in the Docker image). Its uploads are in `data/uploads/`, which the default mode clears; the rest of `data/` is the server's own and is never cleaned, though nothing uses it yet.

```
data/
  └── uploads/                 Main upload directory
      ├── dropgate-storage.json  {"format": 4}: which version's layout this is
      ├── objects/
      │   └── <id>             Stored uploads, a file or several each
      ├── tmp/
      │   └── <uploadId>       Uploads in progress
      └── db/                  Only if UPLOAD_PRESERVE_UPLOADS=true
          └── objects.sqlite   The records
```

### 4.2 Server Memory

| Structure | Contents | Lifetime |
|-----------|----------|----------|
| Uploads in progress | Each upload's session ([§2.1](#21-dropgate-server--upload-protocol-dgup)), with a timer for its deadline. | Until it's finished, cancelled, reaches its deadline, or the server restarts. |
| Finished answers | Upload ID → the stored upload's ID. | 5 minutes. |
| Download leases | Each lease ([§2.1](#21-dropgate-server--upload-protocol-dgup)), with a timer for its deadline, by lease ID and by upload. | Until it's released, reaches its deadline, its upload is removed, or the server restarts. |
| Rate limiter store | IP → request count mappings. | Sliding window (default 60 s). |
| Records (default mode) | Each stored upload's record. | Until it's deleted, or the server restarts. |
| PeerJS state | Peer connections, ICE candidates, SDP. | Until peer disconnection. |

### 4.3 Database Persistence Modes

| `UPLOAD_PRESERVE_UPLOADS` | Database Driver | Behaviour on Restart |
|---------------------------|-----------------|----------------------|
| `false` (default) | In-memory | All metadata lost. All files in `data/uploads/` deleted. |
| `true` | SQLite (`data/uploads/db/`) | Metadata and files preserved. Only `data/uploads/tmp/` is cleaned. |

With SQLite, `objects.sqlite` writes zeros over a record as it deletes it (SQLite's `secure_delete`), so an upload that's gone leaves nothing of itself, such as its ID or an unencrypted file's name, in the file. Dropgate 3's two databases didn't, which is one more reason they're deleted (§2.2).

---

## 5. Data Deletion Triggers

### 5.1 Automatic Deletion

| Trigger | What Is Deleted | Frequency |
|---------|-----------------|-----------|
| **An upload in progress's deadline** | Temporary file + storage reservation + session state. Quiet: 5 minutes after its last request. Paused: when the pause runs out (`UPLOAD_MAX_PAUSE_MINUTES`). | At once, at the deadline. |
| **Expiry** (`expiresAt`) | The object from disk + its record; its open leases end, uncounted. | Gone the moment it expires: from then on every route answers as if it had never existed. Deleted at the next check, every **60 seconds**. |
| **Download limit** | The object from disk + its record + its storage. One file or several alike: several files are one object, so nothing of the upload is left. One download is one lease that sent any bytes, counted when it ends, however many ranges or files it fetched: a download page's files and its ZIP are one lease, released as the page goes. See [DGUP §6.3](./DGUP.md#63-leases-and-counting). | At once, when the last download's lease ends. |
| **Download lease's deadline** | The lease. If it sent any bytes, it counts as one download. | At once: 5 minutes after its last request, or, paused, when the pause runs out. |
| **Server restart** (non-persistent mode) | All stored uploads, uploads in progress, and in-memory data. | On process start, and as the server stops. |
| **Server restart** (persistent mode) | Uploads in progress (`data/uploads/tmp/`), leases and finished answers; and a Dropgate 3 server's uploads, if any (§2.2). | On process start. |

### 5.2 User-Initiated Deletion

| Action | What Is Deleted |
|--------|-----------------|
| **Upload cancellation** (`DELETE /api/v4/upload`) | Temporary file, storage reservation, session state. |
| **The uploader's delete** (`DELETE /api/v4/objects/{id}`, with the manage token) | The object from disk + its record + its storage, at once. Its open leases end, uncounted, and any of its bytes being sent stop. |
| **A download released** (`DELETE /api/v4/lease`) | The lease. If it sent any bytes, it counts as one download, and at the limit the upload goes. |
| **P2P transfer cancellation** (either peer calls `stop()`) | Connection resources. No server data to delete (DGDTP stores nothing on the server). |

### 5.3 What Is NOT Automatically Deleted

- **Electron client settings** (`electron-store`) — persist until the user changes them. Uninstalling the app leaves them in the user data directory.
- **Server operator logs** (stdout/stderr) — Dropgate has no control over log retention once data is written to the process output streams. This is the operator's responsibility.

---

## 6. Data Flow: DGUP Upload

```
Client                          Server                        Filesystem
  │                               │                               │
  │  1. POST /api/v4/uploads      │                               │
  │  { size, header, meta, ... }  │                               │
  │──────────────────────────────►│                               │
  │                               │  2. Reserve quota (mutex)     │
  │                               │  3. Create temp file          │
  │                               │──────────────────────────────►│
  │                               │                               │
  │  4. PUT …/upload/chunks/{i}   │                               │
  │  [×N] <binary>                │                               │
  │──────────────────────────────►│                               │
  │                               │  5. Verify SHA-256            │
  │                               │  6. Write to temp file        │
  │                               │──────────────────────────────►│
  │                               │                               │
  │  7. POST …/upload/complete    │                               │
  │──────────────────────────────►│                               │
  │                               │  8. Rename temp → objects/<id>│
  │                               │──────────────────────────────►│
  │                               │  9. Write the record          │
  │                               │  10. Update quota counter     │
  │                               │                               │

Data at rest: data/uploads/objects/<id> (ciphertext and padding if E2EE)
              Record: size, encrypted, sealed or plain file list, expiry,
                      download limit and count, manage-token hash
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
| `NONE` | -1 | Nothing at all: the server writes nothing to stdout or stderr. |
| `ERROR` | 0 | Startup and configuration errors, file I/O failures, and unexpected errors, by their kind only (see [§8.3](#83-what-does-not-appear-in-logs)). |
| `WARN` | 1 | Configuration warnings (such as the HTTPS requirement or an unlimited limit) and rate limit triggers. |
| `INFO` | 2 | Startup configuration and storage capacity at startup, and how many uploads a Dropgate 3 server left, when a start deletes them. Nothing per upload or download. **Default.** |
| `DEBUG` | 3 | Per-transfer events: an upload's start, each chunk, pause, resume, finish, cancel and deadline, downloads, deletion, expiry and rejections. |

### 8.2 What Appears in Logs

**At `INFO` level (default):**

- Server startup configuration (port, enabled features, limits).
- Storage capacity at startup.
- How many uploads a persistent Dropgate 3 server left, when this start deleted them (§2.2): the count, never an ID or name.
- Rate limit triggers (a `WARN` line, with no client details).

**At `DEBUG` level, in addition:**

- Upload lifecycle events: "Upload started", "Upload paused", "Upload resumed", "Upload finished", "Upload cancelled by client", "Upload ended at its deadline" and "Upload expired", with sizes and storage capacity. No line gives how many files an upload has.
- Downloads: "Download lease taken", "Download lease paused", "Download counted" with the count and limit, "Upload deleted at its download limit" and "Upload deleted by its uploader".
- Chunk-level reception details (index, size).
- An upload refused for want of storage, with the storage used, reserved and asked for.

Every line carries a timestamp, so `DEBUG` output shows when transfers of a given size happened.

### 8.3 What Does NOT Appear in Logs

At any log level, Dropgate's own messages do **not** include:

- File content.
- Encryption keys.
- Filenames, plain or encrypted.
- Upload IDs, download leases or manage tokens, or P2P codes.
- Individual client IP addresses (the rate limiter tracks these in memory, but they are not written to log output by Dropgate).
- Download URLs.
- User-Agent strings.

**Everything the server writes goes through `LOG_LEVEL`,** errors included:

- **Unexpected errors** are logged at `ERROR` by the kind of error and the route's pattern only, such as `GET /api/v4/objects/:id (Error, EISDIR)`. An error's message or stack trace is never written: it could hold the internal path of a stored upload, which contains its ID, or part of a request body. A request body that can't be read is logged at `DEBUG`, without any of it.
- **A misconfigured reverse proxy,** one that passes a client address the rate limiter can't read (for example `IP:port`), is logged at `ERROR` by the rate limiter's error code, never the address.

### 8.4 PeerJS Debug Logging

`PEERJS_DEBUG` currently has no effect. The bundled PeerJS server (`peer` 1.x) has no logging, and the Web UI and Dropgate Client always run PeerJS with its debug output off. The setting is still reported in `GET /api/info` as `peerjsDebugLogging`.

### 8.5 Operator Responsibility

Dropgate writes logs to stdout/stderr. Whether these logs are persisted, rotated, or forwarded to external systems is entirely under the server operator's control. Operators SHOULD:

- Set `LOG_LEVEL` to the minimum necessary for operational needs.
- Implement log rotation to avoid unbounded log growth.
- Consider the sensitivity of `DEBUG`-level output before enabling it.
- Be aware that reverse proxy access logs (e.g., Nginx, Caddy) may capture client IP addresses, request paths, and file IDs even if Dropgate itself does not log them.

### 8.6 Dropgate Client Log

The desktop client keeps its log in memory: the run's last 1,000 lines, which go when it quits. Nothing is written to disk unless the user turns on **Keep log on disk for troubleshooting** (**Settings**, under **Privacy**; off by default):

- **Turned on,** the run so far is written to `debug.log` in the user data directory, and each line after it is added. It holds at most 2,000 lines after the run's first line, the newest kept. At the next launch, still on, it starts again.
- **Turned off,** `debug.log` is deleted straight away. At a launch with it off, one an earlier run kept is deleted too.

The client's own lines never name the files it's given or where they are: it logs how many files it was opened with, how an upload finished, and an error's code, never its message. On top of that, every line is redacted before it's kept:

- A file's path keeps only its file name: `C:\Users\you\Documents\report.pdf` becomes `…\report.pdf`, and a Linux path the same.
- A URL keeps its scheme, host and path, and loses its query, its fragment (where an encrypted upload's key is) and any user name.
- Errors are kept as their stack traces, redacted the same way.

The log never holds file contents or encryption keys. A `debug.log` an earlier version wrote in the user data directory is deleted when the client starts, unless the setting is on.

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

The Dropgate Client checks GitHub for updates about 5 seconds after it starts, when you choose **Check for Updates**, and when you change the update channel. It doesn't check when it's started for a background upload from **Share with Dropgate**, and a copy run from source never checks.

Each check sends requests to GitHub (`github.com`, and GitHub's release-asset host for the update file). GitHub sees:

- The client's IP address and the time.
- The update channel the check is for, from the files it asks for: Stable reads the latest release, and Beta and Alpha read pre-releases too.
- An `x-user-staging-id` header, which the auto-updater library (`electron-updater`) sends for staged rollouts. Dropgate doesn't use them, so it sends `00000000-0000-0000-0000-000000000000`, the same for every installation, and never makes or keeps an ID of its own. Nothing in a check tells one installation from another.
- The user agent `electron-builder` and the system's preferred languages (`Accept-Language`). The check doesn't send the installed Dropgate version or any user details.

When a check finds an update, the client downloads it from GitHub straight away, unless **Download updates automatically** is off in **Settings**, under **Update**, and installs it when you close the app. Those downloads send the same headers.

Dropgate itself receives none of this.

---

## 10. Best Practices for Data Handling

### 10.1 Server Operators

- **Use non-persistent mode (`UPLOAD_PRESERVE_UPLOADS=false`) unless persistence is required.** This ensures all data is cleared on server restart, reducing the window of exposure for data at rest.
- **Set conservative lifetimes and download limits.** Shorter lifetimes (`UPLOAD_MAX_FILE_LIFETIME_HOURS`) and low download counts (`UPLOAD_MAX_FILE_DOWNLOADS=1`) minimise the duration and accessibility of stored data.
- **Restrict storage quota.** A bounded `UPLOAD_MAX_STORAGE_GB` limits the volume of data that can accumulate.
- **Keep `LOG_LEVEL` at `INFO` or lower in production.** `DEBUG` logging includes chunk-level details that, in aggregate, reveal transfer patterns.
- **Audit reverse proxy logs.** The reverse proxy may capture data that Dropgate itself does not log. Apply appropriate retention and access controls.
- **Review the `P2P_STUN_SERVERS` configuration.** If IP privacy is a concern, self-host STUN infrastructure rather than relying on third-party servers.

### 10.2 Users

- **Enable E2EE wherever possible.** When encryption is active, the server cannot access file content or filenames. There is no meaningful performance cost.
- **Share download links through secure channels.** The encryption key is embedded in the URL fragment. Anyone with the full URL can decrypt the file.
- **Use single-download mode (`maxDownloads=1`) for sensitive files.** The file is automatically deleted after one download, minimising exposure. An upload of several files goes whole, as a single file does.
- **Use short lifetimes for sensitive files.** Even if the download limit is not reached, the file will be automatically deleted when the lifetime expires.
- **Consider using a VPN** when connecting to a Dropgate Server. This is particularly relevant for P2P transfers (DGDTP), where ICE candidates can expose real IP addresses. Choose a VPN provider that supports peer-to-peer traffic and research their privacy policies, logging practices, and jurisdiction carefully.
- **Prefer P2P (DGDTP) for the highest privacy.** When both sender and receiver are online simultaneously, DGDTP transfers file data directly between peers without it ever touching the server. The server's role is limited to initial signalling.
