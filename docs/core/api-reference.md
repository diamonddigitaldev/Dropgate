# API Reference

## DropgateClient

The main client class for interacting with Dropgate servers.

### Constructor Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `clientVersion` | `string` | Yes | Client version for compatibility checking |
| `server` | `string \| ServerTarget` | Yes | Server URL or `{ host, port?, secure? }` |
| `fallbackToHttp` | `boolean` | No | Auto-retry with HTTP if HTTPS fails in `connect()` |
| `chunkSize` | `number` | No | Upload chunk size fallback (default: 5MB). The server's configured chunk size (from `/api/info`) takes precedence when available. |
| `fetchFn` | `FetchFn` | No | Custom fetch implementation. Every request is made with `credentials: 'omit'`, so no cookies are sent. |
| `cryptoObj` | `CryptoAdapter` | No | Custom crypto implementation |
| `base64` | `Base64Adapter` | No | Custom base64 encoder/decoder |

> **`fallbackToHttp` and security:** when enabled, *any* failure to reach the `https://` URL makes the client retry over plain `http://` and keep using it, including a failure caused by someone on the network blocking HTTPS. Only enable it for servers you knowingly run without TLS (for example on a private LAN), and check `client.baseUrl` after `connect()` so you can tell the user the connection is not secure.

### Properties

| Property | Type | Description |
| --- | --- | --- |
| `baseUrl` | `string` | Resolved server base URL (may change if HTTP fallback occurs) |
| `serverTarget` | `ServerTarget` | Derived `{ host, port, secure }` from `baseUrl` |

### Methods

| Method | Description |
| --- | --- |
| `connect(opts?)` | Fetch server info, check compatibility, cache result |
| `getFileMetadata(fileId, opts?)` | Fetch metadata for a single file |
| `getBundleMetadata(bundleId, keyB64?, opts?)` | Fetch bundle metadata with automatic manifest decryption and field derivation |
| `uploadFiles(opts)` | Upload one or more files with optional encryption. Gives the upload's [handle](#the-upload-handle) at once; pass `signal` to cancel it with your own `AbortSignal` too |
| `downloadFiles(opts)` | Download a file or a bundle with optional decryption. Gives the download's one [outcome](outcomes.md); pass `signal` to cancel it |
| `cancelAll()` | Cancel every upload and download running on the client. Each ends as `cancelled`, `by: 'parent'`; the client stays usable |
| `p2pSend(opts)` | Start a P2P send session |
| `p2pReceive(opts)` | Start a P2P receive session |
| `validateUploadInputs(opts)` | Validate file and settings before upload |
| `resolveShareTarget(value, opts?)` | Resolve a sharing code or link via the server. A link is read locally, and only the ID or code in it is sent: never anything after its `#` (the encryption key), which comes back on the end of `target`. A link to another server is refused without a request. |

An upload or a download reports how it ended in its outcome, and never throws once it has started. The other methods throw a [`DropgateError`](errors.md).

### The Upload Handle

`uploadFiles()` gives a handle, the same shape later versions give for every operation:

| Member | Description |
| --- | --- |
| `result` | A promise of the upload's one [outcome](outcomes.md). It never rejects |
| `snapshot` | Where the upload is now (below). A new, frozen object each time it changes |
| `subscribe(listener)` | Calls `listener` with each new snapshot until the upload has ended, the last with its outcome's status. Returns a function that unsubscribes. A listener that throws doesn't stop the upload or the others |
| `cancel()` | Cancels the upload: its outcome is then `cancelled`, `by: 'self'`. Does nothing once it has ended |

An upload's snapshot (`UploadSnapshot`) never holds a file name or a key:

| Field | Description |
| --- | --- |
| `status` | `initializing`, `uploading` or `completing` while it runs, then its outcome's status: `completed`, `cancelled` or `failed` |
| `phase` | The step it's on: `server-info`, `server-compat`, `crypto`, `init`, `file-start`, `chunk`, `file-complete`, `retry-wait`, `retry`, `complete`, then `done` once it has completed. A cancelled or failed upload keeps the step it stopped at |
| `text` | What it's doing, for people, such as `Uploading chunk 2 of 5...`. A failed upload's is its error's message |
| `percent` | 0 to 100 |
| `processedBytes`, `totalBytes` | Bytes of the files sent so far, and of all the files together |
| `fileIndex`, `totalFiles` | Which of the files given it's on (from 0), and how many, for an upload of several files |
| `chunkIndex`, `totalChunks` | Which chunk of the current file it's on (from 0), and how many it has |

## File Sources

An upload reads each file one chunk at a time through a `FileSource`: `name`, `size`, an optional `type`, and `read(start, end)`, a promise of a `Uint8Array` of exactly `end - start` bytes. `uploadFiles()` takes FileSources, browser `File`s and `Blob`s (a `Blob` with no name is called `file`), and throws `INVALID_ARGUMENT` for anything else, before the upload starts.

| Export | Description |
| --- | --- |
| `fileHandleSource(handle, { name, type? })` | A promise of a FileSource reading a Node.js `FileHandle` (from `fs/promises`' `open()`). Its size is the file's when called. Closing the handle once the upload has ended is yours to do |
| `blobSource(blob, name?)` | A FileSource reading a browser `File` or `Blob`. `uploadFiles()` does this itself |

## Errors

| Export | Description |
| --- | --- |
| `DropgateError` | The one error core gives, with a stable `code`. `DropgateError.is(err, code?)` tells one apart |
| `ERROR_CODES` | Every code, each with its default `origin`, `retryable` and `message` |

## P2P Utility Functions

| Function | Description |
| --- | --- |
| `generateP2PCode(cryptoObj?)` | Generate a secure sharing code |
| `isP2PCodeLike(code)` | Check if a string looks like a P2P code |
| `isSecureContextForP2P(hostname, isSecureContext)` | Check if P2P is allowed |
| `isLocalhostHostname(hostname)` | Check if hostname is localhost |

## Utility Functions

| Function | Description |
| --- | --- |
| `getServerInfo(opts)` | Fetch server info and capabilities (standalone) |
| `lifetimeToMs(value, unit)` | Convert lifetime to milliseconds |
| `estimateTotalUploadSizeBytes(...)` | Estimate upload size with encryption overhead |
| `bytesToBase64(bytes)` | Convert bytes to base64 |
| `arrayBufferToBase64(buffer)` | Convert an ArrayBuffer to base64 |
| `base64ToBytes(b64)` | Convert base64 to bytes |
| `parseSemverMajorMinor(version)` | Parse a semver string into `{ major, minor }` |
| `validatePlainFilename(name)` | Validate that a filename has no path traversal or illegal characters |

## Crypto Functions

| Function | Description |
| --- | --- |
| `sha256Hex(data)` | Compute a SHA-256 hex digest |
| `generateAesGcmKey()` | Generate a random AES-256-GCM CryptoKey |
| `exportKeyBase64(key)` | Export a CryptoKey as a base64 string |
| `importKeyFromBase64(b64)` | Import a CryptoKey from a base64 string |
| `encryptToBlob(blob, key)` | Encrypt a Blob with AES-256-GCM |
| `encryptFilenameToBase64(name, key)` | Encrypt a filename string to base64 |
| `decryptChunk(chunk, key)` | Decrypt an AES-256-GCM encrypted chunk |
| `decryptFilenameFromBase64(b64, key)` | Decrypt a filename from base64 |

## Adapter Defaults

| Function | Description |
| --- | --- |
| `getDefaultFetch()` | Get the default `fetch` implementation for the current environment |
| `getDefaultCrypto()` | Get the default `CryptoAdapter` (Web Crypto API) |
| `getDefaultBase64()` | Get the default `Base64Adapter` for the current environment |

## Network Helpers (advanced)

| Function | Description |
| --- | --- |
| `buildBaseUrl(server)` | Build a base URL string from a server URL or `ServerTarget` |
| `parseServerUrl(url)` | Parse a URL string into a `ServerTarget` |
| `fetchJson(url, opts?)` | Fetch JSON with timeout and error handling |
| `sleep(ms)` | Promise-based delay |
| `makeAbortSignal(timeoutMs?)` | Create an `AbortSignal` with optional timeout |

## Constants

| Constant | Description |
| --- | --- |
| `DEFAULT_CHUNK_SIZE` | Default upload chunk size in bytes (5 MB) |
| `AES_GCM_IV_BYTES` | AES-GCM initialisation vector length |
| `AES_GCM_TAG_BYTES` | AES-GCM authentication tag length |
| `ENCRYPTION_OVERHEAD_PER_CHUNK` | Total encryption overhead added to each chunk |

## StreamingZipWriter

A streaming ZIP assembler for multi-file P2P transfers. Wraps [fflate](https://github.com/101arrowz/fflate) and produces a valid ZIP archive without buffering entire files in memory.

```javascript
import { StreamingZipWriter } from '@dropgate/core';

const zipWriter = new StreamingZipWriter((zipChunk) => {
  // Write each ZIP chunk to your output (e.g., StreamSaver writer)
  writer.write(zipChunk);
});

zipWriter.startFile('photo.jpg');
zipWriter.writeChunk(chunk1);
zipWriter.writeChunk(chunk2);
zipWriter.endFile();

zipWriter.startFile('notes.txt');
zipWriter.writeChunk(chunk3);
zipWriter.endFile();

zipWriter.finalize(); // Flush remaining data and write ZIP footer
```
