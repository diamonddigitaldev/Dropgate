# API Reference

Core's API is grouped by feature, and called as `client.<feature>.<method>()`: `client.hosted.upload()`, `client.links.resolve()`. The standalone helpers are grouped the same way, as `<group>.<name>()`: `lifetime.toMs()`, `codes.generate()`.

## DropgateClient

The client for one Dropgate server.

### Constructor Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `clientVersion` | `string` | Yes | Client version for compatibility checking |
| `server` | `string \| ServerTarget` | Yes | Server URL or `{ host, port?, secure? }` |
| `fallbackToHttp` | `boolean` | No | Auto-retry with HTTP if HTTPS fails in `client.server.connect()` |
| `chunkSize` | `number` | No | Upload chunk size fallback (default: 5MB). The server's configured chunk size (from `/api/info`) takes precedence when available. |
| `fetchFn` | `FetchFn` | No | Custom fetch implementation. Every request is made with `credentials: 'omit'`, so no cookies are sent. |
| `cryptoObj` | `CryptoAdapter` | No | Custom crypto implementation |
| `base64` | `Base64Adapter` | No | Custom base64 encoder/decoder |

> **`fallbackToHttp` and security:** when enabled, *any* failure to reach the `https://` URL makes the client retry over plain `http://` and keep using it, including a failure caused by someone on the network blocking HTTPS. Only enable it for servers you knowingly run without TLS (for example on a private LAN), and check `client.server.baseUrl` after `client.server.connect()` so you can tell the user the connection is not secure.

### client.hosted

Uploads to the server, and downloads from it.

| Method | Description |
| --- | --- |
| `upload(opts)` | Upload one or more files, encrypted if the server supports it unless `encrypt: false`. Several files are uploaded as a bundle, under one link. Gives the upload's [handle](#operation-handles) at once |
| `download(opts)` | Download a file (`fileId`) or a bundle (`bundleId`) into a [sink](#download-sinks), decrypting it with `keyB64` if it was encrypted. Gives the download's [handle](#operation-handles) at once |
| `metadata(opts)` | What the server holds about a file (`fileId`) or a bundle (`bundleId`): the files' names and sizes, with the names decrypted with `keyB64` if it was encrypted ([below](#metadata)) |
| `validate(opts)` | Check files and settings against a server's limits (`files`, `lifetimeMs`, `encrypt`, and the `serverInfo` from `client.server.connect()`), as `upload()` does before it starts |

`upload()` takes `files` (a [file source](#file-sources), a browser `File` or `Blob`, or an array of them), `lifetimeMs` (0 for the server's unlimited, where allowed), and optionally `encrypt`, `maxDownloads`, `filenameOverrides` (names to send instead, by file index), `signal`, `timeouts` (`serverInfoMs`, `initMs`, `chunkMs`, `completeMs`) and `retry` (`retries`, `backoffMs`, `maxBackoffMs`, for each chunk). Its completed value, an `UploadResult`, holds `downloadUrl` (with the key after its `#` if it was encrypted), `fileId` or `bundleId`, `baseUrl`, `keyB64` if it was encrypted, and, for a bundle, `files`.

`download()` takes `fileId` or `bundleId`, `sink`, and optionally `keyB64`, `asZip` (a bundle as one ZIP archive), `signal`, and `timeoutMs` (for each request, each file's download included; default 60000, and 0 for none). Its completed value, a `DownloadResult`, holds `filename` (a file) or `filenames` (a bundle), `receivedBytes`, and `wasEncrypted`.

`upload()` and `download()` throw `INVALID_ARGUMENT` at once, before anything starts, for no files, something that isn't a file, neither a `fileId` nor a `bundleId`, or a sink that doesn't fit. After that, they report how they ended in their [outcome](outcomes.md), and never throw. `metadata()` and `validate()` throw a [`DropgateError`](errors.md).

### client.direct

Direct transfers, from one device to another. See [P2P Consumer Responsibilities](p2p.md).

| Method | Description |
| --- | --- |
| `send(opts)` | Start sending, and wait for the receiver to connect with the code it gives |
| `receive(opts)` | Start receiving from the sender with this code |

They throw a [`DropgateError`](errors.md): `CAPABILITY_UNSUPPORTED` if the server has direct transfer turned off.

### client.links

| Method | Description |
| --- | --- |
| `resolve(value, opts?)` | Resolve a sharing code or link someone typed or pasted. A link is read on the device, and only the ID or code in it is sent: never anything after its `#` (the encryption key), which comes back on the end of `target`. A link to another server is refused without a request |

### client.server

| Member | Description |
| --- | --- |
| `baseUrl` | The server's address, such as `https://dropgate.example`. It can change once, on the first connect, if `fallbackToHttp` is on and only HTTP answers |
| `connect(opts?)` | Ask for the server's info and check this client can work with it. The answer is kept: later calls give it without a request, and calls made together share one. Every other call connects first, so calling it yourself is only needed to check a server, such as for a "Test Connection" button |
| `info(opts?)` | Ask the server for its info now, without keeping it or checking compatibility |

`connect()` gives `compatible`, `message`, `clientVersion`, `serverVersion`, `serverInfo` and `baseUrl`. Both throw a [`DropgateError`](errors.md) when the server can't be reached or doesn't answer as a Dropgate server does.

The calls that make a request take `opts`: `timeoutMs` (default 5000) and `signal`.

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

A download's (`DownloadSnapshot`):

| Field | Description |
| --- | --- |
| `status` | `initializing`, `downloading` or `completing` (the sink is closing) while it runs, then its outcome's status |
| `phase` | `server-info`, `server-compat`, `metadata`, `file-start` (a bundle's next file), `downloading`, `complete`, then `done` once it has completed |
| `text` | What it's doing, for people, such as `Downloading file 2 of 3...` |
| `percent` | 0 to 100 |
| `processedBytes`, `totalBytes` | Bytes written to the sink so far, and of all the files together (0 until the metadata is in) |
| `fileIndex`, `totalFiles` | Which of a bundle's files it's on (from 0), and how many |

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

`client.hosted.metadata({ fileId })` gives a `FileMetadata`: `kind: 'file'`, `fileId`, `isEncrypted`, `name` and `sizeBytes`. `client.hosted.metadata({ bundleId })` gives a `BundleMetadata`: `kind: 'bundle'`, `bundleId`, `isEncrypted`, `sealed`, `files` (each `fileId`, `name` and `sizeBytes`), `fileCount` and `totalSizeBytes`.

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
| `filenames.validate(name)` | Throws `INVALID_FILENAME` for a name that's empty, too long or has a path in it, as an unencrypted upload's name is checked |
| `codes.generate()` | A new random direct transfer code, such as `ABCD-1234` |
| `codes.isLike(value)` | Whether a value is shaped like a direct transfer code |
| `hosts.isLocalhost(hostname)` | Whether a hostname is this machine (`localhost`, `127.0.0.1` or `::1`) |
| `hosts.isSecureForDirect(hostname, isSecureContext)` | Whether a direct transfer can run here: a secure context, or this machine |
| `zip.writer(onData)` | A streaming ZIP writer (below) |

## zip.writer()

A streaming ZIP writer, for writing several files received in a direct transfer into one archive. It wraps [fflate](https://github.com/101arrowz/fflate), stores without compressing, and never holds a whole file in memory. A hosted bundle's ZIP needs none of this: `client.hosted.download({ bundleId, asZip: true, sink })` writes it.

```javascript
import { zip } from '@dropgate/core';

const archive = zip.writer((zipChunk) => writer.write(zipChunk)); // e.g. a StreamSaver writer

archive.startFile('photo.jpg');
archive.writeChunk(chunk1);
await archive.drained(); // waits for onData, so a slow output slows the writer down
archive.writeChunk(chunk2);
await archive.drained();
archive.endFile();

archive.startFile('notes.txt');
archive.writeChunk(chunk3);
archive.endFile();

await archive.finalize(); // writes the rest and the ZIP's footer, and waits for onData
```

`writeChunk()` returns at once and queues its output for `onData`, one call at a time. Await `drained()` after it to wait for `onData`. Once `onData` fails, nothing more is given to it, and `drained()` and `finalize()` throw its error.
