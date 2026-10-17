# DGUP — Dropgate Upload Protocol

**Protocol Version:** 4.0
**Status:** In development, until Dropgate 4.0.0
**Last Updated:** October 2026

---

## 1. Overview

The Dropgate Upload Protocol (DGUP) is how a client uploads files to a Dropgate Server, and how anyone with the link downloads them. One upload is one **object**, a single file or several alike, with optional end-to-end encryption (E2EE): the client encrypts before anything is sent, and the server stores bytes it can't read.

DGUP runs over HTTP, and over HTTPS anywhere but the machine itself (§3.4). Every route is under `/api/v4/`, apart from `/api/info`, which every version of a client looks for at that path. Request and answer bodies are JSON, apart from an upload's chunks and a download's bytes.

### 1.1 Design Goals

- **Confidentiality.** With E2EE, the server never sees a file's content, its name, its size or how many files an upload has: the files are padded, and their list is sealed and padded too.
- **Integrity.** Every chunk is checked against its SHA-256 digest before it's kept, and an encrypted object can't be cut short, reordered or mixed with another without the download failing.
- **Resilience.** An upload or a download can be paused and resumed, and one cut off part-way carries on from where it got to, within the server's deadlines.
- **The least kept, for the least time.** The server keeps what serving an upload needs, and nothing that says who sent it or who downloaded it. An upload in progress and a download in progress are in memory only.
- **Quota safety.** Storage is reserved under a lock before any byte is written, so two uploads at once can't both take the last of it.
- **Simplicity.** Plain HTTP methods and headers; no WebSocket or long polling.

---

## 2. Terminology

| Term | Meaning |
|------|---------|
| **Object** | What the server stores for one upload: one file, or several one after another. Encrypted, it's a header and chunks of ciphertext ([§4](#4-the-object)). |
| **Chunk** | A run of an object's bytes, sent in one request. Every chunk but the last is the same size. |
| **Upload** | The process of sending an object, from its start to its finish, named by an **upload ID** (a UUID) that's used only until then. |
| **ID** | A stored upload's UUID, given when it's finished. It's the only thing in a link's path. |
| **Secret** | 32 random bytes in an encrypted upload's link, after the `#`, which the upload's keys are made from. It's never sent to the server. |
| **File list** | Each file's name and size, in order. Encrypted, it's sealed and padded as the **meta**; unencrypted, it's in plain. |
| **Lease** | A download's hold on an upload, named by 32 random bytes. One lease is one download, however many requests it makes ([§6.2](#62-leases)). |
| **Manage token** | 32 random bytes the uploader keeps, which delete the upload ([§7](#7-the-uploaders-delete)). The server keeps only its SHA-256. |

---

## 3. Capability Discovery

Before an upload or a download, the client MUST ask the server what it supports.

### 3.1 Request

```
GET /api/info
```

No authentication is required. It's rate-limited ([§12.1](#121-rate-limits)).

### 3.2 Response

A JSON object containing (at minimum):

| Field | Type | Description |
|-------|------|-------------|
| `version` | `string` | Server version (semver). For display only: compatibility never depends on it. |
| `protocols.dgup` | `{ major, minor }` | The version of DGUP (this protocol) the server speaks. |
| `protocols.dgdtp` | `{ major, minor }` | The version of [DGDTP](./DGDTP.md) the server's direct transfers use. |
| `capabilities.upload.enabled` | `boolean` | Whether uploads are on. When it's `false`, `upload` has no other field. |
| `capabilities.upload.e2ee` | `boolean` | Whether encrypted uploads are taken. |
| `capabilities.upload.maxSizeMB` | `number` | Maximum upload size in MB, counted in 1024s (× 1024 × 1024 bytes), for the whole object: a bundle's files count together, and an encrypted object's header, padding and tags count too (0 = unlimited). |
| `capabilities.upload.maxLifetimeHours` | `number` | Maximum lifetime of an upload, in hours (0 = unlimited). |
| `capabilities.upload.maxFileDownloads` | `number` | Maximum download limit (0 = unlimited). |
| `capabilities.upload.chunkSize` | `number` | The chunk size the server takes, in bytes: an encrypted object's header must give the same ([§4.2](#42-the-header)). |
| `capabilities.upload.maxPauseMinutes` | `number` | How long the server keeps a paused upload or download, in minutes, or `0` when pausing is off ([§5.4](#54-pause-and-resume)). |
| `capabilities.upload.credentialRequired` | `boolean` | Whether an upload needs a credential ([§3.5](#35-credentials)). Absent means none. This server sends `false`: it asks for no credential yet. |
| `capabilities.accounts.enabled` | `boolean` | Whether the server has accounts. This server always sends `false`: accounts come later. |

The answer is never cached (`Cache-Control: no-store`). It never holds a count of anything. Dropgate 3's `bundleSizeMode` is gone: the size limit always applies to the whole upload.

### 3.3 Compatibility

Each protocol is versioned on its own, apart from either app's version, and the client checks each before it uses it. This document describes DGUP version **4.0**.

- The client MUST NOT use a server for hosted transfers unless `protocols.dgup.major` is the major it speaks. A different minor works: a minor only adds to its major.
- The same goes for direct transfers and `protocols.dgdtp`. A server can work with a client for one protocol and not the other.
- A server that gives no `protocols` is older than Dropgate 4, and the client MUST treat it as working with neither. There is no backwards compatibility.
- When they don't work together, the client tells its user that an update is required, and on which side: the server, if its major is older (or it gives none), or the client, if the server's is newer. `@dropgate/core` fails the call with `VERSION_UNSUPPORTED`, whose `details` give `component` and `update`.
- The client MUST NOT send its own version, or its app's name or version, to the server.
- A Dropgate 3 client meets a Dropgate 4 server the other way round: it reads `/api/info`, sees version 4 and says it's incompatible. Anything that asks a Dropgate 3 route anyway is told to update ([§13](#13-dropgate-3-clients-and-links)).

The client SHOULD respect `chunkSize` and all declared limits.

### 3.4 Transport

The client uses the server's address as it was given.

- It MUST NOT retry an `https://` address over plain `http://`, and MUST NOT follow a redirect, so nothing on the network can move it onto plain HTTP.
- A server on plain `http://` on another machine is insecure: everything sent, the metadata, the web pages and their scripts included, can be read and changed on the way. The client MUST NOT use one unless its user or integrator chose to, explicitly. `@dropgate/core` refuses one with `INSECURE_TRANSPORT_NOT_ALLOWED` unless the client is made with `allowInsecure: true`, and then marks every result `transport.secure: false`.
- `http://localhost`, `http://127.0.0.1` and `http://[::1]` never leave the machine, and are secure. Only these names count.

### 3.5 Credentials

A server can ask for a credential before it accepts an upload, for accounts or quotas, with `capabilities.upload.credentialRequired: true`. This server doesn't yet: accounts come later.

- The client MUST NOT send a credential to a server that doesn't ask for one, nor with any request but an upload's: `POST /api/v4/uploads` and every `/api/v4/upload` request ([§5](#5-uploads)), the status, pause and resume included. Downloads, metadata and the uploader's delete never need one: a link is its own permission, and so is a manage token.
- It sends the credential only in the `Authorization` header, as `Bearer <token>`: never in a URL, a request body, a link or an encrypted file list, and never to another server (it follows no redirect).
- A server that refuses an upload's credential answers with an error whose JSON `code` is `AUTH_REQUIRED`, `AUTH_EXPIRED`, `AUTH_DENIED` or `QUOTA_EXCEEDED`. After `AUTH_EXPIRED`, the client may get a new credential once and make the request again; it retries none of the others as they are.

---

## 4. The Object

What the server stores is bytes it doesn't need to understand, except an encrypted object's header, which says where each chunk goes. The client makes the object; the server checks its header's format and chunk size, and each chunk's length and digest.

### 4.1 An Encrypted Object

```
object = header (60 bytes) || chunk 0 || chunk 1 || … || chunk n−1
meta   = nonce (12 bytes) || AES-256-GCM(meta key, nonce, padded file list)     (sent apart, kept on the record)
```

Only the secret's holder can open either.

### 4.2 The Header

| Offset | Bytes | Field | Value |
|--------|-------|-------|-------|
| 0 | 4 | Magic | `44 47 55 50` (`DGUP`) |
| 4 | 1 | Version | `04` |
| 5 | 1 | Cipher suite | `01`: HKDF-SHA256, AES-256-GCM in chunks, HMAC-SHA256 |
| 6 | 2 | Reserved | `00 00` |
| 8 | 4 | Chunk size `C` | Unsigned 32-bit, big-endian: the plaintext bytes in every chunk but the last |
| 12 | 16 | Salt | Random, made for this object |
| 28 | 32 | MAC | HMAC-SHA256 of bytes 0 to 27, under the header key |

- **`C` is from 64 KiB to 64 MiB,** and must be the server's `chunkSize` when the upload starts. The object records its own chunk size, so a server whose chunk size changed later still serves every object it holds, and a client reads each one as it was written.
- **A client checks the fields before it makes any key from the header,** in this order: magic, version, suite, reserved bytes, `C`'s bounds; then the MAC, once it has the header key. A MAC that fails, with a file list that doesn't open either, is most likely the wrong link (`DECRYPT_FAILED`); with one that opens, the header was changed (`INTEGRITY_FAILED`).

### 4.3 The Keys

Three keys, one per purpose, each HKDF-SHA256 of the secret, with the header's salt as the salt:

| Key | HKDF `info` | Used for |
|-----|-------------|----------|
| Header key | `dropgate/4 header` | The header's MAC |
| Payload key | `dropgate/4 payload` | Every chunk, AES-256-GCM |
| Meta key | `dropgate/4 meta` | The file list, AES-256-GCM |

No key is used by two algorithms, and nothing from one upload opens under another's keys.

### 4.4 The Chunks

- **Chunk `i`** holds plaintext bytes `i × C` up to `(i + 1) × C` of the padded files ([§4.5](#45-padding)), sealed with AES-256-GCM under the payload key, with no associated data: the ciphertext, then its 16-byte tag. So every chunk but the last is `C + 16` bytes, and the last is 17 bytes up to that.
- **Chunk `i`'s 12-byte nonce** is `i` as an 11-byte big-endian number, then `01` for the last chunk and `00` for any other. So a chunk moved, repeated, dropped, taken from another upload, or a stream cut short (with no chunk marked last) fails to open, before any output is marked complete.
- **A client seals each chunk once,** and sends a chunk again as the same bytes. Sealing one index twice over different bytes, such as a file edited during a pause, would reuse a nonce. A chunk the server holds is never read again, and nothing of a sealed chunk is written to disk.

### 4.5 Padding

Every encrypted object is padded, so its size says little about the files'. The plaintext is the files, one after another in the list's order, then zero bytes up to a length that shows only the top bits of their size together (Padmé):

- With `L` the files' sizes added up: for `L` under 2, `L`; otherwise, with `E = ⌊log2 L⌋` and `S = ⌊log2 E⌋ + 1`, `L` rounded up to a multiple of `2^(E − S)`. That's about 1% more on average.
- **The stored object** for `P` padded bytes is `60 + P + 16 × ⌈P / C⌉` bytes.
- **The padding stops at the server's maximum upload size** (`maxSizeMB` × 1024²): where the padded object would be larger, it's padded only as far as fits, so the object is then exactly the limit. Files whose object is over the limit unpadded are refused before the upload starts.
- An unencrypted upload isn't padded.

### 4.6 The File List

- **The list** is UTF-8 JSON, `{"files":[{"name":"report.pdf","size":104857600}]}`: 1 to 1,000 files, in order. Each `size` is at least 1. Unknown fields are ignored, so a later 4.x can add one.
- **Names follow the file name rule:** not empty, at most 255 bytes in UTF-8, and no control character, `/` or `\`. A client checks every name before anything is sent, and the names it receives the same way; it saves a received file under a name sanitised for every OS ([File Names](../core/quick-start.md#file-names)). The server checks an unencrypted upload's names; an encrypted one's it never sees.
- **Encrypted,** the list goes after its length (4 bytes, big-endian), then zero bytes up to a bucket: 4 KiB, 8 KiB and so on, doubling, up to 1 MiB. A list that doesn't fit 1 MiB is refused before the upload starts. A single file and a bundle of up to around 50 files look the same to the server; above that, the bucket says roughly how many files there are, to within a factor of two. It's then sealed under the meta key with a random 12-byte nonce before it. A client that opens a list whose sizes add up to more than the padded length, or which doesn't parse, fails as `INTEGRITY_FAILED`, and a name that breaks the rule as `INVALID_FILENAME`.

### 4.7 Where the Bytes Are

Plaintext byte `p` is in chunk `⌊p / C⌋`, which starts at `60 + ⌊p / C⌋ × (C + 16)` in the object.

- **A file of several** at plaintext `[a, a + s)` needs chunks `⌊a / C⌋` to `⌊(a + s − 1) / C⌋`: one `Range` request, which never asks for a chunk that's only padding. The client opens them as a run whose last chunk is checked against the object's last. Files next to each other are one run.
- **A whole download** reads to the chunk marked last, padding included, so a client can tell nothing was cut off.
- **A paused or dropped download** asks from the next whole chunk after the last one it wrote ([§8.4](#84-reconnecting-downloads)).

### 4.8 An Unencrypted Object

Where the server has E2EE off, or an upload chose not to encrypt, the object is the files' bytes, one after another, in the list's order: no header, no tags and no padding. Its chunks are `C` bytes each but the last, which is the rest, and a file of several is a plain byte range. The file list, with each file's name and size, is sent in plain at the start and kept on the record.

### 4.9 The Manage Token

The client makes 32 more random bytes for each upload. Only their SHA-256 goes with the start (`manageTokenHash`); the client keeps the token for the uploader's delete ([§7](#7-the-uploaders-delete)), and gives it nowhere else.

### 4.10 Secure Context Requirement

Encrypting and decrypting need the Web Crypto API, which a browser only gives a secure context (HTTPS, or `localhost`). A client that can't get one can't encrypt: the Web UI then says "This connection is not secure. Your upload will not be encrypted.", and asks before it sends anything (the Upload Security Warning); its download page says an encrypted upload can't be downloaded there ([§9.2](#92-the-download-page)).

---

## 5. Uploads

One upload is one object, a single file or several alike: started, sent in chunks that can be sent again, then finished.

- **The upload's ID** is given by the start, and every request after it names the upload in the `Dropgate-Upload` header, never in its URL.
- **Every answer to an upload in progress carries its `deadline`**: when the server ends it unless something renews it, in milliseconds since 1970 ([§5.7](#57-how-long-an-upload-lasts)).
- **Every error is JSON** with a `code` ([§11](#11-errors)). One that names a field gives it in `details.field`.

### 5.1 Start

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
| `files` | `array` | Unencrypted only: 1 to 1,000 `{ name, size }`, in order. Each name by the file name rule ([§4.6](#46-the-file-list)), each size at least 1, and the sizes add up to `size`. |
| `lifetimeMs` | `number` | How long to keep the upload once it's finished, in milliseconds; `0` for no limit, where the server allows it. |
| `maxDownloads` | `number` | Optional: the download limit, `0` for none. With no value, the server's own limit. A server whose limit is `1` makes every upload `1`. |
| `manageTokenHash` | `string` | The SHA-256 of the manage token, base64url (32 bytes). The token itself never reaches the server at the start. |

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

**What the server keeps of an upload in progress,** in memory only: whether it's encrypted, its size, chunk size and number of chunks, the meta or the plain file list, its lifetime and download limit, the manage token's hash, each chunk it holds with that chunk's SHA-256, the storage reserved, whether it's paused, and its deadline. Nothing about who sent it: no address and no account. Its bytes are in `data/uploads/tmp/<uploadId>` until it's finished.

### 5.2 Chunks

```
PUT /api/v4/upload/chunks/{index}
Content-Type: application/octet-stream
Content-Digest: sha-256=:<base64>:
Dropgate-Upload: <uploadId>
```

The body is chunk `index`'s bytes, from 0, exactly its length. `Content-Digest` is the SHA-256 of the body ([RFC 9530](https://www.rfc-editor.org/rfc/rfc9530)); another algorithm may sit beside it. Chunks can come in any order, and each is written where it goes in the object: at `60 + index × (C + 16)` encrypted, and `index × C` not.

- **The same chunk again,** with the same digest, is `200` and isn't written again, so a retry is always safe. With different bytes it's refused: the server compares the digest it kept.
- **A chunk sent while the upload is paused resumes it.** One already on its way when the pause came doesn't: it's kept if it all arrives, and the upload stays paused.
- The server reads no more than the chunk's length. A request it refuses before reading its body closes the connection.
- The core library sends one chunk at a time, in order.

| Status | Code | When |
|--------|------|------|
| `200` | — | Written, or the same bytes already held. The body is `{ "deadline": … }`. |
| `400` | `INVALID_CHUNK` | No chunk has that index, or the body isn't that chunk's length. |
| `400` | `DIGEST_MISMATCH` | No `Content-Digest` with SHA-256, or one that doesn't match the body. |
| `404` | `NOT_FOUND` | No upload in progress by that ID. |
| `409` | `CHUNK_CONFLICT` | Different bytes for a chunk the server already holds. |

### 5.3 Status

```
GET /api/v4/upload
Dropgate-Upload: <uploadId>
```

```json
{ "chunks": 20, "received": [[0, 11], [13, 13]], "paused": false, "deadline": 1759766700000 }
```

`received` gives the chunks the server holds, as inclusive ranges. A client resuming an upload needs it, then sends the rest; the resume's own answer gives it too ([§5.4](#54-pause-and-resume)). Asking doesn't renew a pause.

### 5.4 Pause and Resume

```
POST /api/v4/upload/pause
POST /api/v4/upload/resume
```

Each names the upload in `Dropgate-Upload`, with no body.

- **Pause** responds `{ "paused": true, "deadline": … }`: the server keeps the upload for `UPLOAD_MAX_PAUSE_MINUTES` (`capabilities.upload.maxPauseMinutes`) from now, and pausing again renews that from then. With pausing off (`0`), it's `409`, `PAUSE_DISABLED`, and the upload goes on unpaused.
- **Resume** responds `{ "paused": false, "deadline": …, "received": [...] }`, with the chunks held, as the status gives them, and a quiet upload's deadline.

**The core library's pause** (`pause()` on an upload's handle, [Core API](../core/api-reference.md#pausing)) stops the chunk it's sending, then asks for the pause; its `resume()` asks for the resume, and sends only the chunks the answer's `received` lacks. The chunk the pause stopped goes again exactly as it was sealed ([§4.4](#44-the-chunks)). A file that changed while the upload was paused fails it (`SOURCE_UNAVAILABLE`) rather than be sent part old, part new. The client shows the server's `deadline`, or the pause length from its answer if that's later, so a server clock behind the client's never ends it early; still paused then, the upload has gone, and the client says "The server dropped this paused upload.", as it does when the resume is `404`. Nothing resumes by itself.

**What a pause holds:** on the server, what it already holds for the upload in progress, its temporary file, its session in memory and its reservation, for at most `UPLOAD_MAX_PAUSE_MINUTES` ([§5.7](#57-how-long-an-upload-lasts)); on the client, in memory, the upload's own state and the sealed chunk the pause stopped. Nothing of it is written to disk.

### 5.5 Finish

```
POST /api/v4/upload/complete
Dropgate-Upload: <uploadId>
```

No body. Before every chunk is held, it's `409`, `UPLOAD_INCOMPLETE`, with `details.received` as the status gives it. Then the server checks the object is `size` bytes, stores it as `data/uploads/objects/<id>`, writes its record ([§10.2](#102-the-record)), ends the upload, releases its reservation, and responds `201`:

```json
{ "id": "<uuid>" }
```

The upload's lifetime starts now. **Finishing can be asked again:** for 5 minutes, the same request gets the same answer, and two at once store one object. After that, it's `404`. Nothing else can change a finished upload.

### 5.6 Cancel

```
DELETE /api/v4/upload
Dropgate-Upload: <uploadId>
```

Responds `204`, with no body: the temporary file, the reservation and the upload go. An upload that isn't in progress, finished ones included, is `404`; cancelling never removes a finished upload.

### 5.7 How Long an Upload Lasts

- **5 minutes after its last request,** unless it's paused. Any request renews it, the status included; a chunk still arriving isn't quiet.
- **Paused, until the pause's deadline,** which only pausing again renews. Asking for the status meanwhile doesn't.
- **At its deadline it ends at once:** its temporary file and its reservation go, and from then on it's `404`, `NOT_FOUND`, the same answer as for an upload that never existed.
- **A restart ends every upload,** paused or not, in persistent mode too: nothing about one is ever written to a database, and `data/uploads/tmp/` is cleared at each start.

### 5.8 Rate Limits and Credentials

- **The start is rate-limited** ([§12.1](#121-rate-limits)). Every request after it skips the limit while its upload is in progress, or just finished; one naming an upload the server doesn't have is limited.
- **Every upload route has the place a credential is checked** ([§3.5](#35-credentials)), the status, pause and resume included. This server asks for none yet, so they check nothing, and never write one anywhere.

---

## 6. Downloads

An upload's metadata takes and counts nothing. Its bytes are sent under a **lease**: a client takes one for each download, names it in the `Dropgate-Lease` header of every request for the bytes, and releases it when the download ends. One lease is one download, however many requests it makes.

- **Every answer about a lease carries its `deadline`,** in milliseconds since 1970, as an upload's does.
- **Every error is JSON** with a `code` ([§11](#11-errors)). An upload that's unknown, expired, deleted or at its limit, and a lease that's unknown or ended, are all `404`, `NOT_FOUND`: one answer, so nothing says which.
- **An encrypted upload is only served while the server has E2EE on.** With it off, every download route answers for one as for an upload that isn't there.

### 6.1 Metadata

```
GET /api/v4/objects/{id}
```

Encrypted:

```json
{ "encrypted": true, "size": 104857980, "header": "<base64url>", "meta": "<base64url>" }
```

Unencrypted:

```json
{ "encrypted": false, "size": 104857600, "files": [{ "name": "report.pdf", "size": 104857600 }] }
```

`size` is the stored object's bytes. An encrypted upload's `header` is its object's first 60 bytes ([§4.2](#42-the-header)), so a client can check it and learn the chunk size before asking for anything else, and `meta` is its sealed file list. It never gives when the upload expires, how many times it has been downloaded, or its limit. **Asking takes no lease and counts nothing,** so a link preview or a download page can look before anyone downloads.

### 6.2 Leases

| Route | Does |
|-------|------|
| `POST /api/v4/objects/{id}/leases` | Takes a lease. `201`: `{ "lease": "<base64url>", "deadline": …, "etag": "\"<id>\"" }`. |
| `POST /api/v4/lease/renew` | Keeps it 5 more minutes. `200`: `{ "deadline": … }`. |
| `POST /api/v4/lease/pause` | Keeps it for `UPLOAD_MAX_PAUSE_MINUTES` (`capabilities.upload.maxPauseMinutes`) from now. `200`: `{ "paused": true, "deadline": … }`. With pausing off (`0`), `409`, `PAUSE_DISABLED`, and the lease goes on. |
| `DELETE /api/v4/lease` | Releases it. `204`, with no body. |

The lease is 32 random bytes, base64url with no padding (43 characters). The last three routes name it in `Dropgate-Lease`, with no body. `etag` is the upload's `ETag` ([§6.4](#64-the-bytes)).

- **A lease ends 5 minutes after its last request,** unless it's paused: any request under it renews it, and while its bytes are being sent it isn't quiet. **Paused, it ends when the pause runs out.** A request for its bytes, or a renew, ends a pause.
- **Leases are in the server's memory only:** each holds the upload's ID, its own, whether it has sent any bytes, whether it's paused, and its deadline. Nothing about who took it. **None survives a restart.**
- **The core library's pause** (`pause()` on a download's handle, [Core API](../core/api-reference.md#pausing)) closes the request for the bytes and holds what it has written, then pauses the lease; its `resume()` renews the lease, which ends the pause, and asks for the rest under it from the next whole chunk ([§8.4](#84-reconnecting-downloads)), so it's still one download. A lease the server no longer has, or one still paused at its deadline, fails the download: "The server dropped this paused download." A page's one lease ([§9.2](#92-the-download-page)) is paused only once none of its downloads runs, and isn't renewed meanwhile, since a renew ends a pause.

### 6.3 Leases and Counting

- **A lease counts as one download once, when it ends, if it sent any byte:** released, or run out. So a finished download counts, and so does one cancelled or abandoned part-way, when its lease ends; a lease that sent nothing counts nothing.
- **Under one lease, everything is one download:** retries, ranges, a download resumed after a pause, and every file of a bundle. The download page holds one lease while it's open, for a bundle's files one by one and its ZIP ([§9.2](#92-the-download-page)).
- **At the limit, the upload goes at once:** when a lease's count reaches `maxDownloads`, the object, its record and its storage are removed. A bundle is one object, so nothing of it is left.
- **A new download waits while others hold the limit's places:** when the open leases and the downloads counted already make `maxDownloads`, taking a lease is `423`, `DOWNLOADS_BUSY`, with `Retry-After` (5 seconds). The client asks again then; once a lease ends having sent nothing, its place is free again.
- **An upload with no limit** (`maxDownloads` `0`) keeps no count, and downloads never remove it.
- A lease that had sent bytes when the server stopped never counts, since no lease survives a restart.

### 6.4 The Bytes

```
GET /api/v4/objects/{id}/content
Dropgate-Lease: <lease>
Range: bytes=<first>-<last>
If-Range: "<id>"
```

`Range` and `If-Range` are optional. The whole object comes as stored: for an encrypted upload, the header, then every chunk to the one marked last, padding included.

| Status | Code | When |
|--------|------|------|
| `200` | — | The whole object: no `Range`, or an `If-Range` that isn't the upload's `ETag`. |
| `206` | — | The one range asked for, with `Content-Range: bytes <first>-<last>/<size>`. |
| `400` | `LEASE_REQUIRED` | No `Dropgate-Lease`. |
| `404` | `NOT_FOUND` | A lease that's unknown, ended, or another upload's; or the upload's gone. |
| `416` | `RANGE_NOT_SATISFIABLE` | A range starting past the end, more than one range, or anything that isn't one byte range. `Content-Range: bytes */<size>` gives the size. |

- **Every answer with bytes has** `Accept-Ranges: bytes`, `ETag: "<id>"`, `Content-Length`, `Content-Type: application/octet-stream`, `Cache-Control: no-store`, and `Content-Disposition: attachment`, which names the file ([RFC 6266](https://www.rfc-editor.org/rfc/rfc6266)) only for an unencrypted single file.
- **A range** is `bytes=<first>-<last>`, `bytes=<first>-` (to the end) or `bytes=-<n>` (the last `n` bytes); a last byte past the end means the end.
- **The `ETag` is the upload's ID:** an object never changes and an ID is never used twice. With `If-Range` naming any other value, the answer is the whole object, `200` ([RFC 9110](https://www.rfc-editor.org/rfc/rfc9110#section-13.1.5)), which a client resuming a download must not add to what it has.
- **`HEAD`** gives the same headers and no bytes, and sends nothing that counts.
- **A client continuing a dropped download** sends `Range` from where it got to, with `If-Range`, under the same lease, and refuses a `200` ([§8.4](#84-reconnecting-downloads)).

### 6.5 A Browser's Own Downloads

```
GET /api/v4/leases/{lease}
GET /api/v4/leases/{lease}/files/{index}
```

A page with no secure context (plain HTTP to a LAN address) hands an unencrypted download to the browser itself, which can't send a header. It takes the lease with `fetch()`, then sends the browser here, with the lease in the URL, so the browser's own resume asks again under the same lease and doesn't count again.

- **The first** gives the whole upload, named for a single file, and only `attachment` for a bundle. **The second** gives file `index` (from 0) of the file list, named, with ranges counted from the file's own first byte.
- **Ranges, `If-Range` and the headers are as [§6.4](#64-the-bytes).**
- **Only unencrypted uploads:** an encrypted one, a file index that isn't in the list, or a lease that's unknown or ended, is `404`, `NOT_FOUND`. An encrypted upload's bytes are always asked for with the lease in its header.
- On HTTPS a lease is never in a URL. These are for the pages where the page, the request and the file already cross the network unencrypted, and a proxy's log may then hold the lease.

### 6.6 Rate Limits

- **Metadata and taking a lease skip the rate limit for an upload that's there** ([§12.1](#121-rate-limits)); asking about one that isn't is limited.
- **Every request under a lease skips it while the lease is open,** its bytes and the browser's own downloads included; one naming a lease the server doesn't have is limited.
- **The delete is always rate-limited.**

---

## 7. The Uploader's Delete

```
DELETE /api/v4/objects/{id}
Dropgate-Manage-Token: <base64url>
```

The manage token is the 32 random bytes whose SHA-256 the upload's start sent as `manageTokenHash` ([§5.1](#51-start)), base64url. No account is needed. The server compares the token's SHA-256 with the record's in constant time.

| Status | Code | When |
|--------|------|------|
| `204` | — | Deleted, with no body: the object, its record and its storage go at once. Its open leases end, uncounted, any of its bytes being sent stop, and each lease is `404` at its next request. |
| `403` | `MANAGE_DENIED` | The token is wrong, empty, malformed, missing, or another upload's. Nothing changes. |
| `404` | `NOT_FOUND` | No upload by that ID, or an expired one. |

An encrypted upload can be deleted while the server has E2EE off.

The core library's call is `client.hosted.delete({ id, manageToken })`, with the `manageToken` its upload gave ([Core API](../core/api-reference.md#clienthosteddeleteopts)). The token goes only in this header, to the upload's own server: never in a URL, a log or an error. The delete isn't retried.

---

## 8. Retries

A client retries only what can recover, and only while the server is still waiting for it. This is what the core library does.

### 8.1 Defaults

| Parameter | Default |
|-----------|---------|
| Retries per request | No limit: until the server stops waiting ([§8.3](#83-how-long-a-client-retries)) |
| First back-off | 1,000 ms |
| Back-off multiplier | 2× |
| Most back-off | 30,000 ms |
| Jitter | A random point in the back-off's upper half, from the client's cryptographic random source |
| Per-chunk timeout | 60,000 ms |

- **`Retry-After` is waited instead of the back-off,** up to a minute, wherever the server sends it.
- **What's retried:** a chunk, and the finish, which gives the same answer when it's asked again ([§5.5](#55-finish)); and a download's bytes, which continue where they stopped ([§8.4](#84-reconnecting-downloads)). A chunk is sent again as the same bytes: an encrypted one is sealed once ([§4.4](#44-the-chunks)). A pause or resume, of an upload or a lease, is retried the same way ([§5.4](#54-pause-and-resume), [§6.2](#62-leases)). The start, metadata, taking a lease and the delete aren't retried.

### 8.2 What's Retried, and What Isn't

- **Retried:** no answer (a network error, or a connection dropped), a timeout, and the statuses `408`, `429` and every `5xx` but `507`.
- **Never retried; the operation fails at once, with its code:** every other `4xx` (`400`, `403`, `404`, `409`, `410`, `413`, `416` and so on) and `507`. Sending the same request again won't change the answer, so a bad request fails in a second instead of after a minute of retries. An expired credential is renewed once and the request made again ([§3.5](#35-credentials)).
- **A cancel** stops a wait at once, and is never retried.

### 8.3 How Long a Client Retries

Until the server stops waiting: an upload is dropped 5 minutes after its last request ([§5.7](#57-how-long-an-upload-lasts)), and a lease ends 5 minutes after its last request or byte ([§6.2](#62-leases)). Every answer carries a `deadline`; the client retries until the later of the last `deadline` and 5 minutes after the server last answered, so a clock that's ahead of the server's never cuts it short. Its last wait ends then, for one try more. Meanwhile the core library gives that time as its snapshots' `deadline`. If that fails too, the upload has gone: the core library fails it as `NOT_FOUND`, "The server dropped this upload", as it does when the server answers `404`. A download fails with its last error.

### 8.4 Reconnecting Downloads

A download whose connection drops, or stalls past its timeout, is continued under the same lease, so it counts once ([§6.3](#63-leases-and-counting)):

- **It asks for the rest,** with `Range: bytes=<from>-` and `If-Range` set to the upload's `ETag` from the lease ([§6.4](#64-the-bytes)). An encrypted upload's rest starts at the next whole chunk after the last one opened and written; an unencrypted one's at the next byte. Until something has been written, it asks for the whole upload again.
- **It must get `206`, for exactly that range,** with `Content-Range: bytes <from>-<size − 1>/<size>`. A `200` in answer to a range means the `If-Range` didn't match, so the upload isn't the one the download started: the client adds none of it to what it has, and fails as `INTEGRITY_FAILED`. Any other range is `INVALID_RESPONSE`.
- **Nothing is written twice:** an encrypted chunk is written only once it has opened whole, so a chunk cut off part-way is asked for again from its start.
- **A paused download continues the same way** once it's resumed ([§6.2](#62-leases)).

---

## 9. Links and Pages

The Web UI, the desktop app and the core library upload one file or several the same way: one start, one object and one link, whatever the number of files. This section is what a client does with the routes of §5 to §7: the link it gives, and the Web UI's pages.

### 9.1 Links

| Upload | Link |
|--------|------|
| Encrypted, one file or several | `https://<host>/<id>#<secret>` |
| Unencrypted, one file or several | `https://<host>/<id>` |

- **`id`** is the upload's ID, as the finish gives it ([§5.5](#55-finish)): the only thing in the path.
- **The secret** is 32 random bytes, in URL-safe base64 with no `=`: 43 characters of `A–Z a–z 0–9 - _`. It isn't a key: the upload's keys are made from it ([§4.3](#43-the-keys)). Browsers never send what's after the `#`, and the clients never send it either: not in a request, a log or an error.
- **Reading a link:** a whole link pasted into the Web UI's "enter a sharing code" box, or passed to the core library's `client.links.resolve()`, is read on the device, and nothing of it is sent: the download page opens with the secret still on its address, and that page asks the server about the upload. A link to another server is refused without asking this one.
- **A Dropgate 3 link** says it was made with an older version ([§13](#13-dropgate-3-clients-and-links)). Any other link to an upload that isn't there says it isn't there.

### 9.2 The Download Page

```
GET /{id}
```

- **One page for one file and several, served over HTTP and HTTPS alike.** The server sends it for an upload that's there, with no check of how the request came in: the page itself decides whether it can decrypt, from whether the browser gives it a secure context (HTTPS, or `localhost`), which the server can't tell from the request, and, from the metadata (once its list is opened, for an encrypted one), whether it shows one file or several. An unknown, expired or deleted upload, or an encrypted one on a server with E2EE off, gets the not-found page (`404`).
- **No Pause of its own.** Core reconnects a dropped download underneath ([§8.4](#84-reconnecting-downloads)), and only the home page's upload pauses ([§9.4](#94-pausing-an-upload-from-the-home-page)). A browser's own Pause, in its list of downloads, was checked by hand on Windows with Chrome 155 and Firefox 155 (Safari isn't yet):
  - **Chrome, with the page open:** Pause holds the file where it is, and the page waits. The server sends no faster than the browser reads, so the download's lease stays open however long the pause. Resume carries on, and the file saves whole, after a pause of 7 minutes as after one of a minute.
  - **Chrome, with the page closed while paused:** nothing is left to send the rest. Resume leaves the download "in progress" with nothing arriving, and it never completes: only Cancel ends it. The lease runs out 5 minutes after its last request, and counts as one download, since it sent bytes.
  - **Firefox, with the page open or closed:** Pause stops the download, which ends the page's stream: the page says the download failed, and the lease, which sent bytes, counts as one download. Resume asks the server for the download's address (below), which drops the connection, so Firefox marks the download failed.

  None of them ever shows a file as saved that isn't the whole file. To finish one, download it again from its link, while the upload's download limit allows.
- **Saving a file.** In a secure context the page streams each file to disk through StreamSaver, whose service worker answers the download's address inside the browser. The address is random, and holds no file name: the name reaches the browser only in the download's `Content-Disposition` header. A browser can still send that address to the server, as Firefox's own Resume does, so any other request under `/vendor/streamsaver/` is answered by dropping the connection, and the browser marks that download failed: a page in its place would be saved as the file, marked complete.
- **Loading the page takes no lease and counts nothing.** The page holds no file name or size: a link preview, which fetches the page without the `#` part, sees only the server's name and Dropgate's description. The page reads the upload's metadata ([§6.1](#61-metadata)) and opens its file list with the secret, in the browser.
- **Downloading one file** is core's: one lease ([§6.2](#62-leases)), released as soon as the download ends, so at its limit the upload is gone once the file is saved. A download that finds every allowed place held waits as `Retry-After` says, and starts when one frees.
- **Several files** are opened with core's `client.hosted.open()`: the page's downloads, each file on its own and **Download All as ZIP**, share one lease, taken at the first, renewed every 2 minutes (`POST /api/v4/lease/renew`) and released as the page goes (`pagehide`), so they count as one download. Each file asks only for its own part of the upload ([§4.7](#47-where-the-bytes-are)).
- **A dropped connection** is continued under the same lease, from where it got to ([§8.4](#84-reconnecting-downloads)).
- **Without a secure context,** an unencrypted upload is handed to the browser: the page takes the lease with `fetch()` and sends the browser to `/api/v4/leases/{lease}` ([§6.5](#65-a-browsers-own-downloads)), or, for several files, `/api/v4/leases/{lease}/files/{index}` in a hidden frame for each, one by one or all of them, under one lease the page renews while it's open. That lease isn't released as the page goes, since the browser's downloads go on after it: it runs out 5 minutes after their last bytes. An encrypted upload can't be downloaded there, and the page says why.

### 9.3 Deleting From the Result Screen

The Web UI's result screen, after an upload of one file or several, has **Delete Upload**. Once confirmed, it deletes the upload ([§7](#7-the-uploaders-delete)) with the manage token its upload gave, and the link stops working.

- **The token is in the page's memory only:** never in storage, the page itself or a URL. A reload, or **Send More Files**, drops it, and the button with it; the upload then stays until it expires or reaches its download limit.
- **An upload that's already gone** (expired, or downloaded as many times as it allows) is reported as already gone.

### 9.4 Pausing an Upload From the Home Page

The Web UI's upload, of one file or several, has **Pause Upload** beside **Cancel Upload** while it runs, through the core library's `pause()` and `resume()` ([§5.4](#54-pause-and-resume)).

- **Pause is there only where the server allows it,** and can only be pressed once the server has taken the upload (the snapshot's `canPause`). With pausing off (`UPLOAD_MAX_PAUSE_MINUTES=0`, `maxPauseMinutes` `0`), there's no Pause at all.
- **Paused,** the card says "Paused. The server keeps this upload until 14:32.", the server's deadline as a local time (and "tomorrow" if it is), with **Resume Upload** and **Cancel Upload**. Resumed, the upload carries on from what the server holds.
- **Nothing resumes by itself.** Still paused at the deadline, the upload ends, and the card says "The server dropped this paused upload."
- **What a pause holds is in the page's memory only,** as an upload's state always is: nothing in storage or a URL. Closing or reloading the page ends the upload; the server drops it at its deadline.

---

## 10. Storage and Lifecycle

### 10.1 On Disk

Everything the server keeps is in one folder, `data/` (`/app/data` in the Docker image):

```
data/
  uploads/
    dropgate-storage.json   {"format": 4}, written at each start
    objects/<id>            stored uploads
    tmp/<uploadId>          uploads in progress; cleared at each start
    db/objects.sqlite       persistent mode only: the records
```

The rest of `data/` is the server's own, never cleaned (nothing uses it yet).

- **Default mode** (`UPLOAD_PRESERVE_UPLOADS=false`) clears `data/uploads/` at each start and as the server stops (`SIGINT` or `SIGTERM`), and keeps records in memory.
- **Persistent mode** (`UPLOAD_PRESERVE_UPLOADS=true`) keeps `objects/` and `db/objects.sqlite` across restarts. Uploads in progress never survive one ([§5.7](#57-how-long-an-upload-lasts)).
- **Storage used** is the stored objects and what every upload in progress has reserved: not temporary files, the database or the format marker. It's counted again every 5 minutes.

### 10.2 The Record

A finished upload's record holds only what serving and ending it needs: `encrypted`, `size`, `meta` (encrypted) or `files` (unencrypted), `expiresAt`, `maxDownloads`, `downloadCount` (only with a limit, [§6.3](#63-leases-and-counting)) and `manageTokenHash`. Its ID is the object's file name. There's no creation time, address, account or upload ID. Records are in memory, or with `UPLOAD_PRESERVE_UPLOADS=true` in `data/uploads/db/objects.sqlite`, which writes zeros over a record as it deletes it, so an upload that's gone leaves nothing of itself behind.

### 10.3 Expiry

An upload is gone the moment its `expiresAt` is reached: from then on every route answers for it as for an ID that never existed (`404`, and the not-found page), its open leases included. Its object and record are deleted at the next check, every **60 seconds**, and its open leases end, uncounted.

### 10.4 A Dropgate 3 Server's Leftovers

Dropgate 4 reads nothing a Dropgate 3 server stored, and no Dropgate 3 link works with it. A Dropgate 3 server in persistent mode left its uploads in its uploads folder: two databases, `db/file-database.sqlite` and `db/bundle-database.sqlite`, and its stored files, each named by its ID, directly in the folder.

- **At each start in persistent mode,** the server deletes exactly that layout in `data/uploads/`: the two databases, with SQLite's own `-wal`, `-shm` and `-journal` files beside them, and the files there named by a lowercase version 4 UUID. Nothing else in `data/uploads/` is touched, and nothing it has deleted is ever served.
- **It logs one `INFO` line** among its startup lines, with the count and nothing else: "Removed 3 uploads left by Dropgate 3. Dropgate 4 can't serve them, and their links stopped working when it started." No ID or name is logged, and at `LOG_LEVEL=NONE`, nothing is. A start that finds none logs nothing.
- **In default mode** the start clears `data/uploads/` whole, Dropgate 3's layout with the rest, as it always has.
- **Only `data/uploads/`.** A Dropgate 3 folder the server doesn't use, such as `server/uploads/` beside `server/data/` in a copy run from the repository, or a Docker volume still mapped to Dropgate 3's `/usr/src/app/uploads`, is left as it is: its operator removes it ([Dropgate Server README](../../server/README.md)).

---

## 11. Errors

Every API error is JSON, with a stable code and a short message for people:

```json
{
  "code": "<CODE>",
  "error": "<human-readable message>"
}
```

A message never holds an ID, a name, a key, a token, or anything from the request. Some add `details`, such as the field that's wrong (`details.field`) or the chunks held (`details.received`). These are every code the server gives:

| Status | Code | When |
|--------|------|------|
| `400` | `INVALID_REQUEST` | A request body that can't be read, such as malformed JSON; or, starting an upload, a field missing or wrong ([§5.1](#51-start)). |
| `400` | `E2EE_DISABLED` | An encrypted upload, with E2EE off. |
| `400` | `UNSUPPORTED_OBJECT` | An upload whose header isn't version 4's. |
| `400` | `CHUNK_SIZE_MISMATCH` | An upload whose header's chunk size isn't the server's. |
| `400` | `LIFETIME_NOT_ALLOWED` | An upload's lifetime over the server's maximum, or none where it has one. |
| `400` | `DOWNLOADS_NOT_ALLOWED` | An upload's download limit over the server's, or none where it has one. |
| `400` | `INVALID_CHUNK` | A chunk index out of range, or a chunk of the wrong length ([§5.2](#52-chunks)). |
| `400` | `DIGEST_MISMATCH` | A chunk with no SHA-256 `Content-Digest`, or one that doesn't match it. |
| `400` | `LEASE_REQUIRED` | An upload's bytes asked for with no `Dropgate-Lease` ([§6.4](#64-the-bytes)). |
| `403` | `MANAGE_DENIED` | The uploader's delete with a manage token that isn't the upload's ([§7](#7-the-uploaders-delete)). |
| `404` | `NOT_FOUND` | Anything under `/api/` that isn't a route; an upload that's unknown, ended, dropped, expired, deleted or at its limit; and a download lease that's unknown or ended: one answer, so nothing says which. |
| `409` | `CHUNK_CONFLICT` | Different bytes for a chunk the server already holds. |
| `409` | `UPLOAD_INCOMPLETE` | A finish before every chunk is held, with `details.received`. |
| `409` | `PAUSE_DISABLED` | A pause of an upload or a download, on a server with pausing off. |
| `410` | `VERSION_UNSUPPORTED` | A Dropgate 3 API path ([§13](#13-dropgate-3-clients-and-links)): "This server runs Dropgate 4. Update the app to use it." |
| `413` | `TOO_LARGE` | A JSON request body over its limit (1 MiB, or 2 MiB for an upload's start), or an upload over the maximum upload size. |
| `416` | `RANGE_NOT_SATISFIABLE` | A `Range` the server can't send, with `Content-Range: bytes */<size>` ([§6.4](#64-the-bytes)). |
| `423` | `DOWNLOADS_BUSY` | A new download while open leases and counted downloads make the upload's limit, with `Retry-After` ([§6.3](#63-leases-and-counting)). |
| `429` | `RATE_LIMITED` | Too many requests ([§12.1](#121-rate-limits)). |
| `500` | `SERVER_ERROR` | Anything unexpected while answering. The server logs the error's kind and the route's pattern, never its message, which can hold a path or part of the request ([PRIVACY.md](../PRIVACY.md)). |
| `507` | `SERVER_FULL` | Not enough storage for an upload. |

### 11.1 Status Codes

| Code | Context |
|------|---------|
| `200` | Success. |
| `201` | An upload started, or finished; a download lease taken. |
| `204` | An upload cancelled, or deleted by its uploader; a download lease released. |
| `206` | One range of an upload's bytes. |
| `400` | A malformed request or invalid field, or a download with no lease. |
| `403` | The uploader's delete with the wrong manage token. |
| `404` | An upload, upload in progress or download lease not found, or no such route under `/api/`. |
| `409` | A chunk conflict, a finish too soon, or pausing off. |
| `410` | A Dropgate 3 API path, or a Dropgate 3 bundle's link ([§13](#13-dropgate-3-clients-and-links)). |
| `413` | A request body, or an upload, over its size limit. |
| `416` | A range the server can't send. |
| `423` | A download waiting for others to end. |
| `429` | Rate limit exceeded. |
| `500` | Internal server error. |
| `507` | Insufficient storage quota. |

---

## 12. Rate Limiting and Cross-Origin Requests

### 12.1 Rate Limits

The server enforces a request rate limit to protect against abuse. The defaults are:

| Parameter | Default |
|-----------|---------|
| Window | 60,000 ms |
| Maximum requests per window | 25 |

Rate limits are applied per IP address, in memory. When triggered, the server responds with HTTP 429, `RATE_LIMITED`, and `Retry-After` gives the seconds until the window resets. Uploads and downloads skip the limit for an upload in progress, a stored upload that's there, and an open download lease ([§5.8](#58-rate-limits-and-credentials), [§6.6](#66-rate-limits)).

### 12.2 Cross-Origin Requests

Everything under `/api/` answers any origin (`Access-Control-Allow-Origin: *`), because the desktop app and other integrators call it from their own. No cookie is ever set or sent, so another site has nothing to borrow. A request may send `Content-Type`, `Content-Digest`, `Range`, `If-Range`, `Authorization`, `Dropgate-Upload`, `Dropgate-Lease` and `Dropgate-Manage-Token`, and a script may read `ETag`, `Content-Range`, `Accept-Ranges`, `Retry-After` and `Content-Length` from the answer. Dropgate 3's `/upload/` paths answer the same way, so a Dropgate 3 app can read that it needs to update. Pages and the Web UI's files get no CORS headers. Every API answer is `Cache-Control: no-store`.

---

## 13. Dropgate 3 Clients and Links

Dropgate 4 works with no Dropgate 3 client, link or upload. Each gets a clear "update required", never a working path.

| Dropgate 3 | Dropgate 4 |
|------------|------------|
| `POST /upload/init`, `/upload/init-bundle` | `POST /api/v4/uploads`, one route for both |
| `POST /upload/chunk` (`X-Upload-ID`, `X-Chunk-Index`, `X-Chunk-Hash`) | `PUT /api/v4/upload/chunks/{index}` (`Dropgate-Upload`, `Content-Digest`) |
| `POST /upload/complete`, `/upload/complete-bundle` | `POST /api/v4/upload/complete` |
| `POST /upload/cancel` | `DELETE /api/v4/upload` |
| `GET /api/file/<fileId>/meta`, `GET /api/bundle/<bundleId>/meta` | `GET /api/v4/objects/{id}` |
| `GET /api/file/<fileId>` | `POST /api/v4/objects/{id}/leases`, then `GET /api/v4/objects/{id}/content` |
| `POST /api/bundle/<bundleId>/downloaded` | Nothing: a lease counts ([§6.3](#63-leases-and-counting)) |
| Resolving a sharing code on the server | Nothing: `client.links.resolve()` reads the input on the device ([§9.1](#91-links)) |
| `GET /b/<bundleId>` | The older-version page, below |
| `GET /<fileId>` | `GET /{id}`, one file or several, over HTTP or HTTPS ([§9.2](#92-the-download-page)) |
| `GET /api/info` | The same path, with `protocols` ([§3.2](#32-response)) |

- **Dropgate 3's API paths,** everything under `/upload/`, `/api/file/` and `/api/bundle/`, answer `410`, `VERSION_UNSUPPORTED`, "This server runs Dropgate 4. Update the app to use it.", whatever the request sent; its body isn't read. A Dropgate 3 client stops before them anyway, at `/api/info` ([§3.3](#33-compatibility)). The path Dropgate 3 resolved sharing codes at is gone: like any other path under `/api/` that isn't a route, it's `404`, `NOT_FOUND`.
- **A Dropgate 3 bundle's link,** `https://<host>/b/<bundleId>`, is always `410`, with a page saying the link was made with an older version and the sender needs to update.
- **A Dropgate 3 single file's link,** `https://<host>/<fileId>#` and 44 characters of standard base64 ending in `=`, names an upload a Dropgate 4 server never has, so the server answers with its not-found page (`404`). That page reads the `#` part in the browser, sees a Dropgate 3 key, and says the same as the bundle's page; the key is never sent.
- **A Dropgate 3 server's stored uploads** are deleted as Dropgate 4 starts ([§10.4](#104-a-dropgate-3-servers-leftovers)).

---

## 14. Constraints Summary

| Aspect | Default | Notes |
|--------|---------|-------|
| Chunk size | 5 MiB | 64 KiB to 64 MiB; server-configurable. Each object records its own. |
| Maximum upload size | 100 MiB | For the whole object; 0 = unlimited; server-configurable. |
| Maximum chunk count | 100,000 | Per upload. |
| Files per upload | 1,000 | |
| File name | 255 bytes | In UTF-8; no control character, `/` or `\`. |
| Default lifetime | 24 hours | Server-configurable. |
| Default max downloads | 1 | Server-configurable; 0 = unlimited. |
| Storage quota | 10 GiB | Server-configurable. |
| Sealed file list | 4 KiB to 1 MiB | Padded to a power of two. |
| Upload start body | 2 MiB | Every other JSON body: 1 MiB. |
| Upload, quiet | 5 minutes | After its last request, unless paused. |
| Upload, paused | 60 minutes | `UPLOAD_MAX_PAUSE_MINUTES`, 1 to 1,440, or 0 to turn pausing off. |
| Finish kept | 5 minutes | A repeated finish gets the same answer. |
| Download lease, quiet | 5 minutes | After its last request, unless paused; paused, `UPLOAD_MAX_PAUSE_MINUTES`. |
| Download waiting | 5 seconds | `Retry-After` on `423`, `DOWNLOADS_BUSY`. |
| Expiry check | 60 seconds | An expired upload is gone at once; its bytes go at the next check. |
| Header | 60 bytes | Encrypted objects. |
| Authentication tag | 16 bytes | Per chunk; AES-GCM. |
| Nonce | 12 bytes | AES-GCM. |
| Keys | 256 bits | AES-256-GCM and HMAC-SHA256, from HKDF-SHA256. |
| Secret, lease, manage token | 32 bytes each | Random. |

---

## 15. Best Practices

### 15.1 Server Deployment

- **Always deploy behind a reverse proxy that terminates TLS.** A browser only encrypts and decrypts in a secure context. Self-signed certificates are acceptable for private deployments but reduce trust for external users.
- **Set `UPLOAD_MAX_FILE_SIZE_MB` and `UPLOAD_MAX_STORAGE_GB` to sensible values.** Unbounded storage invites abuse.
- **Set `UPLOAD_MAX_FILE_LIFETIME_HOURS` conservatively.** Shorter lifetimes reduce exposure if a server is compromised.
- **Keep `UPLOAD_PRESERVE_UPLOADS=false` unless persistence is specifically required.** Default mode starts clean at each restart, minimising the time uploaded data is at rest.
- **Enable rate limiting.** The defaults (25 requests per 60 seconds) are a reasonable starting point. Adjust based on expected traffic.
- **Avoid `LOG_LEVEL=DEBUG` in production.** Its lines carry only sizes, counts and times, but together they show when uploads and downloads happen.

### 15.2 Client Behaviour

- **Always encrypt when the server allows it.** It costs little, and the server operator can't read the files.
- **Use the server's chunk size,** from `/api/info`. A header with another is refused.
- **Retry only what can recover,** with back-off and jitter, while the server is still waiting ([§8](#8-retries)).
- **Keep the secret and the manage token on the device.** The secret belongs only in the link's `#` part; the manage token only in the uploader's delete.
- **Validate server certificates when connecting over HTTPS.** Disabling certificate verification defeats the purpose of TLS.

### 15.3 Network Privacy

- **Consider using a VPN when connecting to a Dropgate Server**, particularly for sensitive transfers. A VPN prevents the server operator and network intermediaries from observing the client's real IP address. If the VPN provider supports peer-to-peer traffic, the same VPN connection can protect both DGUP uploads and DGDTP transfers. Research VPN providers carefully — the privacy properties of a VPN are only as strong as the provider's logging and jurisdiction policies.

---

## 16. Request Flow Summary

```
Client                                              Server
  │                                                   │
  │  GET /api/info                                    │
  │──────────────────────────────────────────────────►│
  │◄──────────────────────────────────────────────────│
  │  { protocols, capabilities... }                   │
  │                                                   │
  │  POST /api/v4/uploads                             │
  │  { encrypted, size, header, meta, ... }           │
  │──────────────────────────────────────────────────►│
  │◄──────────────────────────────────────────────────│
  │  201 { uploadId, chunks, chunkSize, deadline }    │
  │                                                   │
  │  PUT /api/v4/upload/chunks/{index}  [×chunks]     │
  │  Dropgate-Upload | Content-Digest                 │
  │  <binary body>                                    │
  │──────────────────────────────────────────────────►│
  │◄──────────────────────────────────────────────────│
  │  200 { deadline }                                 │
  │                                                   │
  │  POST /api/v4/upload/complete                     │
  │  Dropgate-Upload                                  │
  │──────────────────────────────────────────────────►│
  │◄──────────────────────────────────────────────────│
  │  201 { id }                                       │

Link: https://<host>/<id>#<secret>

Downloader                                          Server
  │                                                   │
  │  GET /api/v4/objects/{id}                         │
  │──────────────────────────────────────────────────►│
  │◄──────────────────────────────────────────────────│
  │  { encrypted, size, header, meta }                │
  │                                                   │
  │  POST /api/v4/objects/{id}/leases                 │
  │──────────────────────────────────────────────────►│
  │◄──────────────────────────────────────────────────│
  │  201 { lease, deadline, etag }                    │
  │                                                   │
  │  GET /api/v4/objects/{id}/content                 │
  │  Dropgate-Lease [ | Range | If-Range ]            │
  │──────────────────────────────────────────────────►│
  │◄──────────────────────────────────────────────────│
  │  200 or 206 <bytes>                               │
  │                                                   │
  │  DELETE /api/v4/lease                             │
  │  Dropgate-Lease                                   │
  │──────────────────────────────────────────────────►│
  │◄──────────────────────────────────────────────────│
  │  204 (counted once)                               │
```
