# API Reference

Core's API is grouped by feature, and called as `client.<feature>.<method>()`: `client.hosted.upload()`, `client.links.resolve()`. The standalone helpers are grouped the same way, as `<group>.<name>()`: `lifetime.toMs()`, `codes.generate()`.

## DropgateClient

The client for one Dropgate server.

### Constructor Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `server` | `string \| ServerTarget` | Yes | Server URL or `{ host, port?, secure? }`. An address with no scheme is `https://` |
| `allowInsecure` | `boolean` | No | Allow a server on plain `http://` on another machine ([below](#insecure-servers)). Default: `false` |
| `appInfo` | `{ name, version? }` | No | Your app's name and version, kept as `client.appInfo` for your own display and logs. Never sent anywhere, and compatibility never depends on it |
| `chunkSize` | `number` | No | Upload chunk size fallback (default: 5MB). The server's configured chunk size (from `/api/info`) takes precedence when available. |
| `fetchFn` | `FetchFn` | No | Custom fetch implementation. Every request is made with `credentials: 'omit'`, so no cookies are sent, and `redirect: 'manual'`: a redirect is never followed, and fails with `REDIRECT_NOT_FOLLOWED`. |
| `auth` | `CredentialProvider` | No | Gives a credential, for a server that asks for one ([below](#credentials)). Without it, nothing is sent |
| `base64` | `Base64Adapter` | No | Custom base64 encoder/decoder |

The constructor throws a [`DropgateError`](errors.md): `INVALID_ARGUMENT` for a missing or invalid `server`, `appInfo` or `auth`, `INSECURE_TRANSPORT_NOT_ALLOWED` for an insecure server without `allowInsecure`, and `RUNTIME_UNSUPPORTED` where there's no `fetch()` or no secure random numbers (`crypto.getRandomValues()`).

Core does its own encryption, with the Web Crypto API: there's no option for it. Where a page has no `crypto.subtle` (one served over plain HTTP from another machine), random numbers and hashing still work, so unencrypted uploads and direct transfer codes do, but encrypting or decrypting fails with `RUNTIME_UNSUPPORTED`.

### Members

| Member | Description |
| --- | --- |
| `hosted`, `direct`, `links`, `server`, `operations` | The client's calls, by feature (below) |
| `appInfo` | The `appInfo` it was given, frozen, or `undefined` |
| `chunkSize` | The upload chunk size it falls back on, in bytes |
| `fetchFn` | The fetch it makes every request with: yours or the global one, always with `credentials: 'omit'` and `redirect: 'manual'` |
| `base64` | Its base64 encoder and decoder |

### Versions

Core knows its own version, and the version of each protocol it speaks; nobody types one in.

| Static | Description |
| --- | --- |
| `DropgateClient.version` | Core's version, such as `4.0.0`. For display and logs: compatibility never depends on it |
| `DropgateClient.protocols` | `{ dgup: { major, minor }, dgdtp: { major, minor } }`: the [hosted transfer](../technical/DGUP.md) and [direct transfer](../technical/DGDTP.md) protocols, each versioned on its own |

A server gives its protocol versions in `/api/info`. Each protocol works with the server when both speak the same major; a different minor still works. Hosted calls (`client.hosted`, `client.links`) need DGUP to work, and `client.direct` needs DGDTP, so a server can work for one and not the other. A server that gives no protocol versions is older than Dropgate 4, and works with neither. A call that needs a protocol that doesn't work with the server fails with `VERSION_UNSUPPORTED`, whose `details` say which (`component: 'dgup'` or `'dgdtp'`) and which side needs updating (`update: 'server'` or `'client'`), and whose message says so for people ("Update required: ..."). The server's own `version` is for display only.

### Insecure Servers

A server on plain `http://` on another machine is **insecure**: anyone on the network between can read and change what's sent, the web pages included. Core never makes a connection insecure by itself:

* an address is used as it's given. An `https://` one is never retried over `http://`, and a redirect is never followed, so nothing can move a client onto plain HTTP;
* an insecure server is refused with `INSECURE_TRANSPORT_NOT_ALLOWED` before any request, unless the client is made with `allowInsecure: true`;
* `http://localhost`, `http://127.0.0.1` and `http://[::1]` never leave the machine, so they're secure, with no opt-in. Only these names count: another name is another machine, even if it resolves to this one or to a private address.

With `allowInsecure`, every snapshot, result, outcome and error says so, with `transport: { secure: false }` (it's `{ secure: true }` otherwise), and `client.server.on('insecure-transport', listener)` fires as the client connects. Tell the people using it that the connection isn't secure.

### Credentials

A server can ask for a credential before it accepts an upload, for accounts or quotas. It says so in `/api/info`, with `capabilities.upload.credentialRequired: true`. Give the client an `auth` function, and core asks it for one:

```javascript
const client = new DropgateClient({
  server: 'https://files.example.com',
  auth: async ({ operation, reason, baseUrl, signal }) => {
    const token = await myAccount.tokenFor(baseUrl, { refresh: reason === 'expired', signal });
    return token ? { token } : null;
  },
});
```

* It's asked once as each upload starts (`operation: 'hosted.upload'`, `reason: 'required'`), and once more if the server says the credential has expired (`reason: 'expired'`). The request is then made again with the new one. Core keeps no credential beyond the upload it was given for.
* It's only asked when the server asks for a credential. A server that doesn't say so is sent none, so it never learns who is uploading. Downloads, metadata, links and codes never need one: whoever holds a link can use it.
* The token is sent only to the client's own server, only as `Authorization: Bearer <token>`, on each of the upload's requests (its cancel included). It must be [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750#section-2.1)'s token68: letters, digits and `-._~+/`, optionally ending in `=`.
* It never appears in a link, a snapshot, a result, an error or a URL, and a redirect is never followed, so it can't be taken anywhere else.

An upload whose server asks for a credential fails with `AUTH_REQUIRED` if there's no `auth`, or it gives `null` or throws. What it threw isn't kept, not even as the `cause`, since it could quote the credential. A credential that isn't `{ token }` fails with `INVALID_ARGUMENT`, before anything is sent. The server can answer `AUTH_REQUIRED`, `AUTH_EXPIRED` (a second time), `AUTH_DENIED` or `QUOTA_EXCEEDED` ([Errors](errors.md#codes)); none is retried as it is. Direct transfers can't carry a credential yet.

### client.hosted

Uploads to the server, and downloads from it.

| Method | Description |
| --- | --- |
| `upload(opts)` | Upload one or more files, encrypted if the server supports it unless `encrypt: false`. Several files are uploaded as a bundle, under one link. Gives the upload's [handle](#operation-handles) at once |
| `download(opts)` | Download a file (`fileId`) or a bundle (`bundleId`) into a [sink](#download-sinks), decrypting it with `keyB64` if it was encrypted. Gives the download's [handle](#operation-handles) at once |
| `metadata(opts)` | What the server holds about a file (`fileId`) or a bundle (`bundleId`): the files' names and sizes, with the names decrypted with `keyB64` if it was encrypted ([below](#metadata)) |
| `validate(opts)` | Check files and settings against a server's limits (`files`, `lifetimeMs`, `encrypt`, and the `serverInfo` from `client.server.connect()`), as `upload()` does before it starts, and give `true`. Left out, `encrypt` is what `upload()` would do: encrypted where the server supports it |

`upload()` takes `files` (a [file source](#file-sources), a browser `File` or `Blob`, or an array of them), `lifetimeMs` (0 for unlimited, where the server allows it), and optionally `encrypt` (default: encrypted where the server supports it), `maxDownloads`, `filenameOverrides` (names to send instead, by file index), `signal`, `timeouts` (`serverInfoMs` 5000, `initMs` 15000, `chunkMs` 60000 for each chunk, `completeMs` 30000) and `retry` (`retries` 5, `backoffMs` 1000, `maxBackoffMs` 30000, for each chunk). Its completed value, an `UploadResult`, holds `downloadUrl` (with the key after its `#` if it was encrypted), `baseUrl`, `keyB64` if it was encrypted, and `transport`; for one file, `fileId` and `uploadId` (the server's upload session); for a bundle, `bundleId` and `files` (each `fileId`, `name` and `size`).

`download()` takes `fileId` or `bundleId`, `sink`, and optionally `keyB64`, `asZip` (a bundle as one ZIP archive), `signal`, and `timeoutMs`: how long each wait may take, for the server's answer and then for each file's next bytes (default 60000, and 0 for none). A big file never times out for taking long, only if it stalls, and time spent writing to the sink never counts. Its completed value, a `DownloadResult`, holds `filename` (a file) or `filenames` (a bundle), `receivedBytes`, `wasEncrypted` and `transport`.

`upload()` and `download()` throw `INVALID_ARGUMENT` at once, before anything starts, for no files, something that isn't a file, neither a `fileId` nor a `bundleId`, or a sink that doesn't fit. After that, they report how they ended in their [outcome](outcomes.md), and never throw. `metadata()` and `validate()` throw a [`DropgateError`](errors.md).

### client.direct

Direct transfers, from one device to another. See [P2P Consumer Responsibilities](p2p.md).

| Method | Description |
| --- | --- |
| `send(opts)` | Start sending, and wait for the receiver to connect with the code it gives |
| `receive(opts)` | Start receiving from the sender with this code |

They throw a [`DropgateError`](errors.md): `CAPABILITY_UNSUPPORTED` if the server has direct transfer turned off, and `VERSION_UNSUPPORTED` if its DGDTP doesn't work with this client's. The session each gives, and every event given to its `on...` listeners, carry `transport`, and so does every error given to `onError`.

Direct transfers keep their Dropgate 3 shape, with listeners rather than a [handle](#operation-handles), until a later 4.x version moves them onto handles and outcomes, as hosted transfers are.

`send()` takes `file` (a browser `File`, or an array of them) and `Peer` (PeerJS's `Peer` class), and optionally:

| Option | Description |
| --- | --- |
| `onCode(code, attempt)` | The code to give the receiver, once the sender is registered |
| `onStatus({ phase, message })`, `onProgress({ processedBytes, totalBytes, percent })` | Where it is |
| `onComplete()`, `onCancel({ cancelledBy })`, `onError(err)`, `onDisconnect()` | How it ended |
| `onConnectionHealth({ iceConnectionState, rtt?, bufferedAmount?, lastActivityMs })` | The connection's health, while it runs |
| `codeGenerator()` | Makes the code instead of `codes.generate()`; `maxAttempts` is how many codes to try if one is taken (4) |
| `chunkSize`, `endAckTimeoutMs`, `bufferHighWaterMark`, `bufferLowWaterMark`, `heartbeatIntervalMs` (5000, 0 for none), `chunkAcknowledgments` (true), `maxUnackedChunks` (64), `iceRestartTimeoutMs` (10000) | Tuning |

Its session has `code`, `sessionId`, `peer`, `stop()`, `getStatus()`, `getBytesSent()` and `getConnectedPeerId()`.

`receive()` takes `code` and `Peer`, and optionally:

| Option | Description |
| --- | --- |
| `onMeta({ name, total, fileCount?, files?, totalSize?, sendReady? })` | What's being sent, before any of it. With `autoReady: false`, call `sendReady()` to start |
| `onData(chunk)` | Each chunk received. Return a promise to hold the sender back until it's written |
| `onFileStart({ fileIndex, name, size })`, `onFileEnd({ fileIndex, receivedBytes })` | Each file of several |
| `onStatus`, `onProgress`, `onComplete({ received, total })`, `onCancel({ cancelledBy })`, `onError(err)`, `onDisconnect()` | As `send()`'s |
| `autoReady` | Start as soon as `onMeta` has run (default `true`) |
| `watchdogTimeoutMs` | Fail if no file data arrives for this long once the transfer has started (default 30000, 0 for none) |

Its session has `peer`, `stop()`, `getStatus()`, `getBytesReceived()`, `getTotalBytes()` and `getSessionId()`. `onCancel` says only who cancelled (`sender` or `receiver`): what the other device said, if anything, isn't passed on. Every name received is checked by the [file name rule](quick-start.md#file-names); save it under `filenames.sanitize(name)`.

### client.links

| Method | Description |
| --- | --- |
| `resolve(value, opts?)` | Resolve a sharing code or link someone typed or pasted. A link is read on the device, and only the ID or code in it is sent: never anything after its `#` (the encryption key), which comes back on the end of `target`. A link to another server is refused without a request |

Its result has `valid`, and `transport`, valid or not. A valid one has `type` (`file`, `bundle` or `p2p`) and `target`, the path to open on the server (such as `/b/<id>#<key>`); one that isn't has `reason`, for people. It throws `VERSION_UNSUPPORTED` if the server's DGUP doesn't work with this client's, or a request's error if the lookup fails.

### client.server

| Member | Description |
| --- | --- |
| `baseUrl` | The server's address, such as `https://dropgate.example`. It never changes |
| `transport` | `{ secure }`: `false` for an [insecure server](#insecure-servers) |
| `connect(opts?)` | Ask for the server's info and check, for each protocol, that this client can work with it. The answer is kept: later calls give it without a request, and calls made together share one. Every other call connects first, so calling it yourself is only needed to check a server, such as for a "Test Connection" button |
| `info(opts?)` | Ask the server for its info now, without keeping it or checking compatibility |
| `on('insecure-transport', listener)` | Calls `listener` with `{ baseUrl, transport }` as the client connects to an [insecure server](#insecure-servers). Returns a function that stops listening |

`connect()` gives `dgup` and `dgdtp` (each `compatible`, `client` and `server` versions, `update` when they don't work together, and a `message`), `serverVersion`, `serverInfo`, `baseUrl` and `transport`. A server that doesn't work with this client still connects: the calls that need it fail with `VERSION_UNSUPPORTED` ([Versions](#versions)). `info()` gives the server's info with `transport`. Both throw a [`DropgateError`](errors.md) when the server can't be reached, redirects, or doesn't answer as a Dropgate server does.

`connect()`, `info()`, `client.links.resolve()` and `client.hosted.metadata()` each take `timeoutMs` (default 5000) and `signal`.

The server's info (`ServerInfo`) is what it gives in `/api/info`:

| Field | Description |
| --- | --- |
| `name`, `version` | The server's name, and its own version, for display |
| `protocols` | `{ dgup, dgdtp }`, each `{ major, minor }` ([Versions](#versions)) |
| `capabilities.upload` | `enabled`, `maxSizeMB` (0 for no limit), `maxLifetimeHours` (0 for unlimited), `maxFileDownloads` (the most an upload's `maxDownloads` may be, and what it is when left out; 0 for no limit), `e2ee`, `chunkSize` in bytes, and `credentialRequired` ([Credentials](#credentials)) |
| `capabilities.p2p` | `enabled`, `peerjsPath` and `iceServers`, for direct transfers |
| `capabilities.webUI` | `enabled` |

### client.operations

What's running on the client: every upload and download, by its handle's `id`.

| Method | Description |
| --- | --- |
| `get(id)` | The handle of the running operation with this ID, or `undefined` if none is running with it |
| `list()` | What's running, in the order it started: each one's `id` and `kind` (`hosted.upload` or `hosted.download`) |
| `cancelAll()` | Cancel everything running on the client. Each ends as `cancelled`, `by: 'parent'`; the client stays usable |

An operation is listed from the moment it starts until the moment it ends, however it ends, and nothing about it is kept after that: keep its outcome from `result`. It has left the registry before its outcome or its last snapshot reaches you. IDs are made on the device, and never sent to a server; they don't survive a restart.

## Operation Handles

`client.hosted.upload()` and `client.hosted.download()` each give a **handle**, the same shape for every operation:

| Member | Description |
| --- | --- |
| `id` | The operation's ID: a random UUID made on the device, never sent to a server. `client.operations.get(id)` gives the handle back while it runs |
| `kind` | `hosted.upload` or `hosted.download` |
| `result` | A promise of the operation's one [outcome](outcomes.md). It never rejects |
| `snapshot` | Where it is now (below). A new, frozen object each time it changes |
| `subscribe(listener)` | Calls `listener` with each new snapshot until it has ended, the last with its outcome's status. Returns a function that unsubscribes. A listener that throws doesn't stop the operation or the others |
| `cancel()` | Cancels it: its outcome is then `cancelled`, `by: 'self'`. Does nothing once it has ended |

A snapshot never holds a file name or a key. An upload's (`UploadSnapshot`):

| Field | Description |
| --- | --- |
| `status` | `initializing`, `uploading` or `completing` while it runs, then its outcome's status: `completed`, `cancelled` or `failed` |
| `phase` | The step it's on: `server-info`, `server-compat`, `crypto`, `init`, `file-start`, `chunk`, `file-complete`, `retry-wait`, `retry`, `complete`, then `done` once it has completed. A cancelled or failed upload keeps the step it stopped at |
| `text` | What it's doing, for people, such as `Uploading chunk 2 of 5...`. A failed upload's is its error's message |
| `percent` | 0 to 100 |
| `processedBytes`, `totalBytes` | Bytes of the files sent so far, and of all the files together |
| `fileIndex`, `totalFiles` | Which of the files given it's on (from 0), and how many, for an upload of several files |
| `chunkIndex`, `totalChunks` | Which chunk of the current file it's on (from 0), and how many it has |
| `transport` | `{ secure }`: `false` for an [insecure server](#insecure-servers) |

A download's (`DownloadSnapshot`):

| Field | Description |
| --- | --- |
| `status` | `initializing`, `downloading` or `completing` (the sink is closing) while it runs, then its outcome's status |
| `phase` | `server-info`, `server-compat`, `metadata`, `file-start` (a bundle's next file), `downloading`, `complete`, then `done` once it has completed |
| `text` | What it's doing, for people, such as `Downloading file 2 of 3...` |
| `percent` | 0 to 100 |
| `processedBytes`, `totalBytes` | Bytes written to the sink so far, and of all the files together (0 until the metadata is in) |
| `fileIndex`, `totalFiles` | Which of a bundle's files it's on (from 0), and how many |
| `transport` | `{ secure }`, as an upload's |

## Download Sinks

A download writes into a **sink**: any object with `write(chunk)` and `close()`, and optionally `abort(reason)`. Each may return a promise. A `WritableStream`'s writer (`stream.getWriter()`) is one, and so is a Node.js `FileHandle` opened for writing.

* Core awaits each `write()` before it reads more from the server, so a slow sink slows the download down instead of filling memory.
* Core calls `close()` once every byte is written, and the download only completes once `close()` has. A `write()` or `close()` that fails fails the download, with `OUTPUT_WRITE_FAILED`.
* A download that fails or is cancelled calls `abort()`, if the sink has one, and never `close()`, so a partial file isn't finished as if it were whole.

`sink` is either a sink, or a function given each file as its download starts (`{ name, size, index }`, the name decrypted) that returns a sink, or a promise of one:

| Download | `sink` |
| --- | --- |
| A file | A sink, or a function (called once, so you can name the file) |
| A bundle as a ZIP (`asZip: true`) | A sink, for the one archive |
| A bundle as separate files | A function, called for each file |

A bundle downloaded as a ZIP is reported to the server as downloaded only once its sink has closed.

## Metadata

`client.hosted.metadata({ fileId })` gives a `FileMetadata`: `kind: 'file'`, `fileId`, `isEncrypted`, `name`, `sizeBytes` and `transport`. `client.hosted.metadata({ bundleId })` gives a `BundleMetadata`: `kind: 'bundle'`, `bundleId`, `isEncrypted`, `sealed`, `files` (each `fileId`, `name` and `sizeBytes`), `fileCount`, `totalSizeBytes` and `transport`.

Names are decrypted, and sizes are the files' as they'll be downloaded, so neither needs any crypto of your own. An encrypted upload needs `keyB64`: without it, `metadata()` throws `KEY_REQUIRED`, and with one that doesn't open it, `DECRYPT_FAILED`. Where there's no Web Crypto (a page served over plain HTTP from another machine), it throws `RUNTIME_UNSUPPORTED`. A sealed bundle's list of files is encrypted too, so only the key's holder can read which files belong to it.

## File Sources

An upload reads each file one chunk at a time through a `FileSource`: `name`, `size`, an optional `type`, and `read(start, end)`, a promise of a `Uint8Array` of exactly `end - start` bytes. `client.hosted.upload()` takes FileSources, browser `File`s and `Blob`s (a `Blob` with no name is called `file`), and throws `INVALID_ARGUMENT` for anything else, before the upload starts.

| Helper | Description |
| --- | --- |
| `sources.fileHandle(handle, { name, type? })` | A promise of a FileSource reading a Node.js `FileHandle` (from `fs/promises`' `open()`). Its size is the file's when called. Closing the handle once the upload has ended is yours to do |
| `sources.blob(blob, name?)` | A FileSource reading a browser `File` or `Blob`. `upload()` does this itself |

## Errors

| Export | Description |
| --- | --- |
| `DropgateError` | The one error core gives, with a stable `code`. `DropgateError.is(err, code?)` tells one apart |
| `ERROR_CODES` | Every code, each with its default `origin`, `retryable` and `message` |

## Helpers

| Helper | Description |
| --- | --- |
| `lifetime.toMs(value, unit)` | A lifetime in `minutes`, `hours` or `days` in milliseconds; 0 for `unlimited` or anything invalid |
| `sizes.estimateUpload(sizeBytes, { encrypted, chunkSize? })` | How many bytes an upload of a file sends: its size, plus each chunk's encryption overhead if it's encrypted. `chunkSize` is the server's (default 5 MB) |
| `filenames.validate(name)` | Throws `INVALID_FILENAME` for a name that's empty, over 255 UTF-8 bytes, or has a control character or path separator in it: the check core makes of every name it sends and receives |
| `filenames.sanitize(name)` | The name to save a received file under, the same on every OS: NFC, bidi and zero-width characters shown as `[U+XXXX]`, control characters and `< > : " / \ \| ? *` as `_`, no trailing dots or spaces, `_` before a Windows reserved name, within 255 UTF-8 bytes, never empty ([File Names](quick-start.md#file-names)) |
| `filenames.unique(name, taken)` | `name` if it isn't taken, or else `name (1).ext`, `name (2).ext` and so on. `taken` is the names already used, compared without regard to case, or a function that says whether a name is |
| `codes.generate()` | A new random direct transfer code, such as `ABCD-1234`, from secure random numbers only: it throws `RUNTIME_UNSUPPORTED` where there are none |
| `codes.isLike(value)` | Whether a value is shaped like a direct transfer code |
| `hosts.isLocalhost(hostname)` | Whether a hostname is this machine (`localhost`, `127.0.0.1` or `::1`, also as `[::1]`) |
| `hosts.isSecureForDirect(hostname, isSecureContext)` | Whether a direct transfer can run here: a secure context, or this machine |
| `zip.writer(onData)` | A streaming ZIP writer (below) |

## zip.writer()

A streaming ZIP writer, for writing several files received in a direct transfer into one archive. It's core's own: it stores without compressing, never holds a whole file in memory, and has no dependencies. A hosted bundle's ZIP needs none of this: `client.hosted.download({ bundleId, asZip: true, sink })` writes it with the same writer.

```javascript
import { zip } from '@dropgate/core';

const archive = zip.writer((zipChunk) => writer.write(zipChunk)); // e.g. a StreamSaver writer

archive.startFile('photo.jpg', 2_500_000); // its size in bytes, before its first byte
archive.writeChunk(chunk1);
await archive.drained(); // waits for onData, so a slow output slows the writer down
archive.writeChunk(chunk2);
await archive.drained();
archive.endFile();

const stored = archive.startFile('photo.jpg', 1200); // 'photo (1).jpg'
archive.writeChunk(chunk3);
archive.endFile();

await archive.finalize(); // writes the central directory and the end records, and waits for onData
```

- **`startFile(name, size)`** begins a member of exactly `size` bytes, and returns the name it's stored under: `name` through [`filenames.sanitize()`](#helpers), then [`filenames.unique()`](#helpers) against the members before it, so two files with the same name get distinct entries. Names are stored in UTF-8, with the flag that says so (bit 11), so accented and CJK names show correctly in every reader.
- **The size is a promise.** `writeChunk()` refuses bytes that would take the member past it, and `endFile()` refuses a member that's short of it, each with `INVALID_ARGUMENT`. After either, the archive is stopped: nothing more goes to `onData`, and every call after, `drained()` and `finalize()` included, throws the same error, so a member that went wrong never ends up in an archive that looks whole.
- **ZIP64 only where it's needed.** A member of 4 GiB or more, a member or the central directory starting at 4 GiB or later, or 65,535 members or more, get ZIP64's fields and end records. Any other archive is the classic format ("version needed" 2.0, no ZIP64 record), which every reader opens. Each member's size is known as it starts, so this is decided before its first byte.
- **Each member has a CRC-32 and a data descriptor** after its bytes, and the time the writer was made as its modified time.
- **`writeChunk()` returns at once** and queues its output for `onData`, one call at a time. The bytes it's given are passed on as they are, not copied, so don't change them until `drained()` has resolved. Await `drained()` after it to wait for `onData`. Once `onData` fails, nothing more is given to it, and `drained()` and `finalize()` throw its error.

**Changed in 4.0:** `startFile()` takes the member's size, refuses more or fewer bytes than it, makes the name safe and unique itself (returning the name it stored), and the archive gets ZIP64 where it needs it. In 3.x, `startFile(name)` stored the name as given, and an archive over 4 GiB or 65,535 files was written corrupt, with no error. The writer no longer wraps fflate, and core no longer depends on it.
