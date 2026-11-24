# API Reference

Core's API is grouped by feature, and called as `client.<feature>.<method>()`: `client.hosted.upload()`, `client.links.resolve()`. The standalone helpers are grouped the same way, as `<group>.<name>()`: `lifetime.toMs()`, `codes.isLike()`.

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
| `direct` | `{ pauseLimitMs?, reconnectWindowMs?, stun? }` | No | Direct transfers' settings, for every send and receive; each transfer can override any of them ([below](#the-direct-option)) |
| `RTCPeerConnection` | `RTCPeerConnection` class | No | The WebRTC class direct transfers use: the global one in browsers and Electron. In Node, pass a library's ([Direct Transfers](p2p.md#in-node)) |

The constructor throws a [`DropgateError`](errors.md): `INVALID_ARGUMENT` for a missing or invalid `server`, `appInfo`, `auth`, `direct` or `RTCPeerConnection`, `INSECURE_TRANSPORT_NOT_ALLOWED` for an insecure server without `allowInsecure`, and `RUNTIME_UNSUPPORTED` where there's no `fetch()` or no secure random numbers (`crypto.getRandomValues()`).

Core does its own encryption: there's no option for it. It uses the Web Crypto API wherever that can do everything core needs, and its own JavaScript crypto, on `@noble`, where it can't: a page with no `crypto.subtle` (one served over plain HTTP from another machine), or a Web Crypto with no X25519. Both give the same bytes, so encrypting and decrypting work in both ([Crypto](crypto.md)).

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

A server can ask for a credential before it accepts an upload, or opens a direct send's transfer, for accounts or quotas. It says so in `/api/info`, with `capabilities.upload.credentialRequired: true` or `capabilities.p2p.credentialRequired: true`. Give the client an `auth` function, and core asks it for one:

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
* It's asked once as each direct send starts (`operation: 'direct.send'`, `reason: 'required'`), on a server that says a send needs one. The token goes in the one message that opens the send's transfer on the server's rendezvous, and nowhere else. Receiving never asks: whoever holds a link or a code can use it.
* It's only asked when the server asks for a credential. A server that doesn't say so is sent none, so it never learns who is uploading or sending. Downloads, metadata, links and codes never need one: whoever holds a link can use it.
* The token is sent only to the client's own server: for an upload, only as `Authorization: Bearer <token>`, on each of its requests (its cancel included); for a direct send, only in the rendezvous message that opens it. It must be [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750#section-2.1)'s token68: letters, digits and `-._~+/`, optionally ending in `=`.
* It never appears in a link, a snapshot, a result, an error or a URL, and a redirect is never followed, so it can't be taken anywhere else.

An upload whose server asks for a credential fails with `AUTH_REQUIRED` if there's no `auth`, or it gives `null` or throws. What it threw isn't kept, not even as the `cause`, since it could quote the credential. A credential that isn't `{ token }` fails with `INVALID_ARGUMENT`, before anything is sent. The server can answer `AUTH_REQUIRED`, `AUTH_EXPIRED` (a second time), `AUTH_DENIED` or `QUOTA_EXCEEDED` ([Errors](errors.md#codes)); none is retried as it is. A direct send whose server asks fails the same way, `send()` rejecting before its transfer is opened.

### client.hosted

Uploads to the server, and downloads from it.

| Method | Description |
| --- | --- |
| `upload(opts)` | Upload one or more files, encrypted if the server supports it unless `encrypt: false`. One file or several, an upload is one object on the server, under one link. Gives the upload's [handle](#operation-handles) at once |
| `download(opts)` | Download an upload (`id`), or some of its files, into a [sink](#download-sinks), decrypting it with the `secret` from its link if it was encrypted. Gives the download's [handle](#operation-handles) at once |
| `metadata(opts)` | What the server holds about an upload (`id`, with its `secret`): the files' names and sizes, decrypted if it was encrypted ([below](#metadata)). It takes no lease and counts nothing |
| `open(opts)` | Open an upload (`id`, with its `secret`) for a page that may download it several times, all counted as one download ([below](#clienthostedopenopts)) |
| `validate(opts)` | Check files and settings against a server's limits (`files`, `lifetimeMs`, `encrypt`, and the `serverInfo` from `client.server.connect()`), as `upload()` does before it starts, and give `true`. Left out, `encrypt` is what `upload()` would do: encrypted where the server supports it |
| `delete(opts)` | Delete an upload (`id`) from the server at once, with the `manageToken` its upload gave ([below](#clienthosteddeleteopts)) |

`upload()` takes `files` (a [file source](#file-sources), a browser `File` or `Blob`, or an array of them), `lifetimeMs` (0 for unlimited, where the server allows it), and optionally `encrypt` (default: encrypted where the server supports it), `maxDownloads`, `filenameOverrides` (names to send instead, by file index), `signal`, `timeouts` (`serverInfoMs` 5000, `initMs` 15000 for the start and for a pause or resume, `chunkMs` 60000 for each chunk, `completeMs` 30000) and `retry` ([below](#retries)). Its completed value, an `UploadResult`, holds `downloadUrl`, the link; `id`, the upload's ID on the server, which is the link's path; `files`, each `name` and `size`; `manageToken`; and `transport`.

* **The link** is `https://<server>/<id>` for an unencrypted upload. An encrypted one's adds `#` and its **secret**: 32 random bytes, in URL-safe base64 with no `=` (43 characters). The keys that encrypt the upload are made from the secret, which never leaves the device: it's in the link alone. One file and several have links of the same shape.
* **The manage token** lets whoever has it delete the upload: 32 random bytes, URL-safe base64. Only its SHA-256 is sent, when the upload starts, and the token itself is in this value alone: never in a snapshot, an error, a log or the link. Keep it where only the upload's sender can use it, such as the page or the app that made the upload.
* **One upload is one encrypted object,** one file or several: the files' names and sizes, and how many there are, are sealed in a list only the secret opens, and the files are padded inside it, one after another, so the stored size says little about theirs (never past the server's maximum upload size, so padding never makes an upload too large; the limit is on the whole of it). Each chunk is sealed once, and a chunk sent again is the same bytes.

`download()` takes `id` (with `secret`, for an encrypted upload), `sink`, and optionally `files` (which of several files to download, by their index in the upload's list, each once; all of them if left out), `asZip` (several files as one ZIP archive), `signal`, `timeoutMs`: how long each wait may take, for the server's answer and then for each file's next bytes (default 60000, and 0 for none), and `retry` ([below](#retries)). A big file never times out for taking long, only if it stalls, and time spent writing to the sink never counts. Its completed value, a `DownloadResult`, holds `filename` (one file) or `filenames` (several), `receivedBytes`, `wasEncrypted` and `transport`.

* **One download, one lease.** Each `download()` of an upload by `id` takes a lease from the server, and releases it as soon as the download ends, however it ends. A lease that sent any byte is one download against the upload's limit, so at its limit the upload is gone once the download is saved. While other downloads hold every place the limit allows, the download waits, with the snapshot's `text` saying "Someone is downloading this right now.", and starts when one frees.
* **Everything is checked before it's finished.** An encrypted upload is read to its last chunk, padding included, and every chunk is checked, so a changed, reordered or shortened upload fails with `INTEGRITY_FAILED`; the last file's sink (or the ZIP) is only closed once all of it has been. A download of some of an upload's files asks only for the chunks they're in (one `Range` for each run of files next to each other), never a chunk that's only padding, and checks each of those.
* **A dropped connection is picked up where it stopped,** under the same lease, so it counts once: core asks for the rest with `Range`, from the next whole chunk of an encrypted upload (the next byte of an unencrypted one), and `If-Range`, so it only ever continues the same upload. Nothing is written twice. If the server sends the whole upload again instead of the rest, none of it is written, and the download fails with `INTEGRITY_FAILED`.

`upload()` and `download()` throw `INVALID_ARGUMENT` at once, before anything starts, for no files, something that isn't a file, no `id`, a `files` that isn't indexes, or a sink that doesn't fit. After that, they report how they ended in their [outcome](outcomes.md), and never throw. `metadata()` and `validate()` throw a [`DropgateError`](errors.md).

#### Retries

A request that can't succeed now but may soon is made again: one that got no answer (the network, or a timeout), and one answered `408`, `429` or a `5xx` but `507`. Anything else the server says fails at once with its [code](errors.md#codes), since asking again wouldn't change it: a bad request fails in a second, not after a minute of retries. A cancel is never retried.

* **What's retried:** an upload's chunks (each sent again as the same bytes, an encrypted one sealed only once) and its finish; a download's bytes, which continue from where they stopped. The start of an upload, metadata, a download's lease and `delete()` aren't.
* **How long:** until the server stops waiting, which is 5 minutes after it last heard from the upload or the download. An upload whose server couldn't be reached for longer fails with `NOT_FOUND`, "The server dropped this upload"; a download fails with its last error. Meanwhile, the snapshot's `text` says so ("Chunk upload failed. Retrying in 4.2s...", "The connection was lost. Reconnecting in 4.2s..."), and its `deadline` is when the server stops waiting: `null` again once it answers.
* **The wait** doubles from `backoffMs`, up to `maxBackoffMs`, each at a random point in its upper half, so clients that failed together don't all come back together. The randomness is the crypto provider's. A server's `Retry-After` is waited instead (up to a minute).

`retry` is optional on both `upload()` and `download()`:

| Option | Default | Description |
| --- | --- | --- |
| `retries` | None | At most this many retries of one request. Left out, core retries until the server stops waiting |
| `backoffMs` | 1000 | The first wait, in milliseconds |
| `maxBackoffMs` | 30000 | The longest wait, in milliseconds. It's never more than 30000 |

#### Pausing

```javascript
const upload = client.hosted.upload({ files: myFile, lifetimeMs: 3600000 });
// Later, while upload.snapshot.canPause is true:
await upload.pause();
// upload.snapshot: { status: 'paused', pausedBy: 'self', deadline: 1759770300000, ... }
await upload.resume();
```

An upload or a download can pause, and later resume from where it stopped, with its handle's `pause()` and `resume()` ([Operation Handles](#operation-handles)), where the server allows it: for as long as its `maxPauseMinutes` (`UPLOAD_MAX_PAUSE_MINUTES`, 60 by default; 0 turns pausing off). The snapshot's `canPause` says whether `pause()` can be called now.

* **An upload** stops the chunk it's sending, and asks the server to hold the upload. Resumed, it asks the server to go on, which says which chunks it holds, and sends only the rest. The chunk stopped by the pause goes again exactly as it was: an encrypted chunk is sealed once, never again. A file that changed while the upload was paused can't be read on, and the upload fails with `SOURCE_UNAVAILABLE`: a browser's `File` can't be read once its file has changed, and nor can [`sources.fileHandle()`](#file-sources)'s, or the Dropgate Client's own FileSource, which reads through its main process with the same check.
* **A download** closes its request and holds its sink as it is: no `write()`, `close()` or `abort()` while it's paused, and nothing times out. The server holds its lease for the pause. Resumed, it renews the lease, which ends the pause, and asks for the rest under it with `Range`, from the next whole chunk of an encrypted upload (the next byte of an unencrypted one), so it still counts as one download. The Web UI's download pages have no Pause of their own: what a browser's own Pause does to them is in [DGUP §9.2](../technical/DGUP.md#92-the-download-page).
* **A download of an [opened upload](#clienthostedopenopts)** holds the opened upload's one lease: while none of its downloads runs, the lease is no longer renewed and the server holds it for the pause. While another download under it runs, a paused one has no `deadline`, since nothing ends it; once the last one running ends, the paused ones are given the server's.
* **It settles once the server has answered:** `pause()` resolves once the server holds it, and `resume()` once it's running again. Meanwhile `canPause` is `false`. If the server refuses the pause, nothing changes, and `pause()` rejects; if the server no longer has the upload, or the lease, the operation fails with `NOT_FOUND`, and so does the call. A resume the server can't be asked about stays paused. Each request is retried as a chunk is ([Retries](#retries)).
* **The deadline:** paused, the snapshot's `deadline` is when the server stops holding it, in milliseconds since 1970: the server's own deadline, or its pause length from when it answered if that's later, so a server clock behind this one never ends a pause early. Pausing again while paused renews it from then. **Nothing resumes by itself:** still paused at the deadline, the operation fails with `NOT_FOUND`, "The server dropped this paused upload." (or download).
* `cancel()` works while paused: an upload's server is told to discard it, and a download's sink is aborted and its lease released.
* **What a pause holds is in memory only:** the operation's own state, an upload's sealed chunk that was stopped, and nothing more than the server already holds for the upload or the lease ([DGUP §5.4](../technical/DGUP.md#54-pause-and-resume)).

`pause()` rejects with `PAUSE_UNAVAILABLE` before the server has taken the upload or given the download its lease, once it's finishing or has ended, or while a pause or resume is settling, and `CAPABILITY_UNSUPPORTED` on a server with pausing turned off; `resume()` rejects with `PAUSE_UNAVAILABLE` when it isn't paused. Neither changes anything then.

#### client.hosted.delete(opts)

```javascript
await client.hosted.delete({ id: result.id, manageToken: result.manageToken });
```

Deletes an upload from the server at once: its bytes and its details go, its link stops working, and a download of it under way stops. It takes `id` and `manageToken`, from the completed upload's value, and optionally `timeoutMs` (default 5000) and `signal`. It gives a promise, which resolves once the upload is gone.

* **Only the token's holder can.** The token is sent only in the `Dropgate-Manage-Token` header, to the client's own server: never in a URL, and it's never in an error. No credential is sent, and none is needed.
* It throws `INVALID_ARGUMENT` before any request without an `id`, or with a `manageToken` that isn't 32 bytes of URL-safe base64; `NOT_FOUND` for an upload that isn't there (it was deleted, expired, or downloaded as many times as it allowed); `REQUEST_REJECTED`, with `status` 403, for a token that isn't this upload's; or a request's error. It isn't retried.
#### client.hosted.open(opts)

```javascript
const opened = await client.hosted.open({ id, secret });
// opened.metadata: the files, read with no lease
const one = opened.download({ files: [1], sink: ({ name }) => sinkFor(name) });
const all = opened.download({ asZip: true, sink: zipWriter });
// As the page goes:
addEventListener('pagehide', () => opened.close());
```

Opens an upload for a page that may download it several times, its files one by one and all of them as a ZIP, as the Web UI's download page does. It takes `id`, `secret` (for an encrypted upload), and optionally `timeoutMs` (default 5000) and `signal`, and gives a promise of an opened upload: its `metadata` ([below](#metadata)), `download(opts)` and `close()`.

* **One lease for all of them.** Opening reads the metadata and takes no lease. The first download takes one, every download after shares it, and it's renewed every 2 minutes while the upload is open. `close()` releases it: then, if anything was downloaded, it counts as one download, however many there were; opened and closed with none, it counts nothing. While other downloads hold every place the upload's limit allows, a download waits, as `client.hosted.download()`'s does.
* **`download(opts)`** takes `download()`'s options but `id` and `secret` (`sink`, `files`, `asZip`, `signal`, `timeoutMs`, `retry`), and gives the download's [handle](#operation-handles) at once. Once the upload has been closed, it throws `INVALID_ARGUMENT`.
* **A download of it can pause,** holding the one lease ([Pausing](#pausing)).
* **`close()`** cancels its downloads still running, paused ones too, and releases the lease. It makes its request before it waits for anything, with `keepalive`, so a page can call it from `pagehide` as it goes. Calling it again does nothing.
* Printed, logged or serialised, an opened upload shows nothing of its secret or its lease.
* It throws as `metadata()` does.

**Changed in 4.0:** every upload, one file or several, is a Dropgate 4 object, under the link `https://<server>/<id>#<secret>`. The completed value's `fileId`, `bundleId`, `uploadId`, `keyB64` and `baseUrl` are gone: `id` is the one ID, the secret is in `downloadUrl`, the server's address is `client.server.baseUrl`, and `manageToken` is always there. `download()` and `metadata()` take `id` and `secret`, where 3.x took `fileId` or `bundleId`, and `keyB64`; `BundleMetadata` and `HostedFileInfo` are gone, and the metadata has one shape for one file or several ([below](#metadata)). A file of several downloads by its own chunks, and counts against the upload's limit: 3.x never counted a bundle's files downloaded one by one. `open()` and `delete()` are new, and so are the handles' `pause()` and `resume()`, with the snapshot's `canPause`, `pausedBy` and `deadline`. Retries changed: 3.x retried a failed chunk 5 times whatever the error; 4.0 retries only what can recover, until the server stops waiting, and a dropped download continues instead of failing.

### client.direct

Direct transfers, from one device straight to another: the server only introduces the two, and never sees the files, their names or the keys ([Direct Transfers](p2p.md), [DGDTP](../technical/DGDTP.md)).

| Method | Description |
| --- | --- |
| `send(opts)` | Offer files to whoever opens its link or types its code. A promise of the send's [handle](#direct-transfer-handles), once its transfer is open on the server |
| `receive(opts)` | Receive from a sender's link or code. A promise of the receive's [handle](#direct-transfer-handles), at once |
| `appClosing()` | The app is closing (a page's `pagehide`, a desktop app quitting): every direct transfer this client runs ends, each telling its other device, which reads that this side closed Dropgate before the transfer finished (`PEER_CLOSED`). Each ends `cancelled`, `by: 'self'`; one still opening its room or connecting has nobody to tell, and is cancelled. It returns at once, and the transfers running at the call end in a microtask straight after the caller's code (a `pagehide` listener) returns, each sealing its message with nothing to wait for and sending it before anything else, since a page being closed has almost no time; one started after the call carries on. Telling the other device is still best effort: a page being closed may be gone before the message is, and the other device then reads `CONNECTION_LOST` ([DGDTP §13.3](../technical/DGDTP.md#133-an-app-closing)). The client stays usable |

```javascript
// The sender
const send = await client.direct.send({ files: [file1, file2] });
const { link, code } = send.share(); // show both; read share() again when send.snapshot.code changes
const outcome = await send.result;    // completed: { assurance, files, totalBytes }

// The receiver
const receive = await client.direct.receive({ link }); // or { code: 'ABCD-1234' }
const { files, totalSize } = await receive.offer();     // the names, sizes and types
await receive.accept({ sink: (file) => sinkFor(file.name) }); // or { sink, asZip: true }, or receive.decline()
await receive.result;
```

`send()` takes `files` (a [file source](#file-sources), a browser `File` or `Blob`, or an array of them; empty files are sent too) and optionally:

| Option | Description |
| --- | --- |
| `code` | Ask the server for a short code as well as the link (default `true`). The link always works |
| `signal` | An `AbortSignal` that cancels the send, `by: 'signal'` |
| `direct` | This send's [settings](#the-direct-option), over the client's |

`receive()` takes one of `link` (the whole `https://<server>/p2p#<secret>`) and `code` (as someone typed it: spaces, lower case and no dash are fine), and optionally `signal` and `direct`.

* **Links and codes.** A send's link is `https://<server>/p2p#` and its secret: 32 random bytes in URL-safe base64 with no `=` (43 characters), made on the device, after the `#` so it never reaches the server; the transfer is found on the server by a value made from it. The link holds no code. A code is four letters (A–Z without I and O) and four digits: the server gives its first two letters (three on a server set for more transfers), and the rest is drawn on the device, the part the server never sees. The receiver's device uses only those first letters to find the transfer, and the rest to make the connection's keys with the sender's (CPace), so a code is tried once: right or wrong, the sender is given a new one, and the link keeps working.
* **Who gets the files.** Anyone with the link or code sees the offer; the first to accept gets the files, and nobody else can join after that. A receiver that declines, or an offer nobody accepts within 10 minutes (`TIMED_OUT`), ends the send. One that leaves before accepting (cancelling, its app closing, or failing to connect) doesn't: the send waits for another, its link still good.
* **Before anything starts,** `send()` rejects with `INVALID_ARGUMENT` for no files, one that isn't a file, or a setting out of range; `INVALID_FILENAME` for a name the [file name rule](quick-start.md#file-names) refuses; `RUNTIME_UNSUPPORTED` with no `RTCPeerConnection` or `WebSocket` here; then, from the server, `VERSION_UNSUPPORTED` if its DGDTP doesn't work with this client's, `CAPABILITY_UNSUPPORTED` if it has direct transfers off, `AUTH_REQUIRED` ([Credentials](#credentials)), or a connection's error. `receive()` rejects with `INVALID_ARGUMENT` for neither or both of `link` and `code`, a link that isn't a direct link or is another server's ("URL must be from this server."), or a setting out of range; `INVALID_CODE` for a code that isn't one; and `RUNTIME_UNSUPPORTED`. A link is never quoted in an error. Everything after that is the handle's [outcome](outcomes.md): a wrong code, say, is a receive `failed` with `CODE_MISMATCH`, and a receive by code on a server with codes off, `CAPABILITY_UNSUPPORTED`.

#### Direct transfer handles

Both are [operation handles](#operation-handles) (`kind` `direct.send` and `direct.receive`), listed in `client.operations` while they run. `pause()` and `resume()` work from the receiver's acceptance until all the data has been sent, on either device ([Pausing a direct transfer](#pausing-a-direct-transfer)).

A send's handle also has **`share()`**: `{ link, code }` as they are now. `code` is `null` when none was asked for, none is free yet, or the last was just tried and the next is on its way; both are `null` once a receiver has accepted, or the send has ended. Its snapshot's `code` says which (`ready`, `unavailable` or `off`): read `share()` again whenever it changes.

A receive's handle also has:

| Method | Description |
| --- | --- |
| `offer()` | A promise of the sender's files, once connected and their whole list is in and checked: `{ files: [{ name, size, type }], totalSize }`. The only place a receive gives the names. It rejects if the transfer ends first |
| `accept({ sink, asZip?, handOff? })` | Accept the offer into a [sink](#download-sinks): one sink, or a function giving one for each file (`{ name, size, index }`); several files apart take a function, and several as one ZIP (`asZip: true`) take one sink. `handOff: true` says the sink hands the files to a browser to save, as StreamSaver does: the transfer can't know they were saved, so both sides' result is `handed-off`. Resolves once accepted |
| `decline()` | Decline it: the sender is told, this receive ends `cancelled` `by: 'self'`, and the send `cancelled` `by: 'peer'`, `declined: true` |

`accept()` rejects with `INVALID_ARGUMENT`, with nothing sent and the offer still waiting, for no sink or one without `write()` and `close()`, several files apart into one sink, or a function for a ZIP. `accept()` or `decline()` after the other, a second time, or once the transfer has ended rejects with `INVALID_ARGUMENT` too. A sink that can't be had fails the receive with `OUTPUT_WRITE_FAILED` before anything is accepted. Core writes each block to the sink only once it has been checked, awaits each write, and the receive completes only once every file's sink has closed (the ZIP finished first); any other end aborts the sink.

A direct transfer's snapshot (`DirectSendSnapshot`, `DirectReceiveSnapshot`) never holds the link, the code, a secret or a file name:

| Field | Description |
| --- | --- |
| `status` | A send: `waiting` (for a receiver), `connecting` (one is being connected), `offered`, `transferring`, `paused` (either device holds it), `finalising` (all sent, the receiver finishing its files). A receive: `connecting`, `offered`, `transferring`, `paused`, `finalising`. Then the outcome's status |
| `text` | Where it is, for people, such as `Connected. Waiting for them to accept.`, `The receiver paused the transfer.` or `Paused by both of you.` A failed one's is its error's message |
| `code` | A send's only: `ready`, `unavailable` or `off` ([above](#direct-transfer-handles)) |
| `percent`, `processedBytes`, `totalBytes` | The bytes the receiver has written to its sink, and of all the files (a receive's `totalBytes` is 0 until the offer is in) |
| `fileIndex`, `totalFiles` | Which file it's on (from 0), and how many |
| `stalled` | `true` once reading a file (sending) or saving one (receiving) has been stuck for 30 seconds. At 2 minutes the transfer fails, `SOURCE_UNAVAILABLE` or `OUTPUT_STALLED`; neither counts while it's paused |
| `canPause` | Whether `pause()` can be called now |
| `pausedBy` | `self`, `peer` or `both` while it's paused; `null` otherwise |
| `deadline` | While paused with a pause limit on either device: when the transfer ends unless both resume, in milliseconds since 1970, the earlier of the two limits, so both devices show the same; `null` otherwise |
| `transport` | `{ secure }`, as every snapshot's |

A completed transfer's value, on each side, is `{ assurance, files, totalBytes, transport }`: `assurance` is `saved` once the receiver had every file closed in its sink, or `handed-off`; `files` is how many went. How it can end, on each side, is in [Outcomes](outcomes.md#direct-transfers).

#### Pausing a direct transfer

Either device can pause from the receiver's acceptance until all the data has been sent, and the transfer runs only while neither holds it. `pause()` resolves at once: the other device is told, no more data is sent, and what's already on its way is still received, checked and saved. Both snapshots say `paused` and who holds it. `resume()` lets this device's hold go, and rejects with `PAUSE_UNAVAILABLE` if this device hasn't paused it (the other device's hold is its own to let go). `pause()` rejects with `PAUSE_UNAVAILABLE` before acceptance and once all the data is sent.

Nothing ends a pause but a pause limit: with one set on either device ([below](#the-direct-option)), the device whose limit runs out first ends the transfer, and both fail with `PAUSE_LIMIT`, worded by whose limit it was. A pause by either device counts against both limits, from the moment the transfer stopped. The connection is kept alive while paused, and a connection that drops ends the transfer (`CONNECTION_LOST`), paused or not.

#### The direct option

```javascript
const client = new DropgateClient({ server, direct: { pauseLimitMs: 3_600_000 } });
await client.direct.send({ files, direct: { pauseLimitMs: null, stun: false } }); // this send's own
```

| Setting | Default | Description |
| --- | --- | --- |
| `pauseLimitMs` | `null` | How long the transfer may stay paused, by either device, before this device ends it: `null` for no limit, or a whole number of seconds from one minute to one week, in milliseconds (60,000 to 604,800,000) |
| `reconnectWindowMs` | 120,000 | How long a dropped connection may be recovered for: a whole number of seconds from 10 seconds to an hour, in milliseconds (10,000 to 3,600,000). In this version a dropped connection ends the transfer; the window is told to the other device for recovery to use |
| `stun` | `true` | Use the server's STUN servers (`capabilities.p2p.iceServers`) to find a route between two networks. `false` gives the connection no ICE servers at all, so nothing is sent to a STUN server, and only devices that can reach each other directly, as on one network, connect |

Each setting given to a send or receive wins over the client's, one by one. Each device applies its own and tells the other as they connect, in whole seconds. Anything else, an unknown setting included, is `INVALID_ARGUMENT`: from the constructor for the client's, and from `send()` or `receive()` for a transfer's.

#### Dropgate 3's calls

A `send()` or `receive()` made Dropgate 3's way, passing PeerJS's `Peer` option, is refused with `INVALID_ARGUMENT` before anything is made or sent: "Dropgate 4's direct transfers take no Peer option: use the handle that send() or receive() gives." Its listeners (`onCode`, `onMeta`, `onData` and the rest) and its sessions are gone; the handles above do what they did.

**Changed in 4.0:** direct transfers are on handles and outcomes, as hosted transfers are, over Dropgate 4's own secure channel and the server's rendezvous instead of PeerJS. A send gives a link (`https://<server>/p2p#<secret>`) as well as a code, and the code's first letters come from the server, so `codes` no longer makes codes. The listeners, the `Peer` option and the sessions are gone with PeerJS, and so are the `@dropgate/core/p2p` entry point, every `P2P*` and `Peer*` type and the `peerjs` peer dependency. `capabilities.p2p`'s type is `DirectCapabilities` (it was `P2PCapabilities`), without `peerjsPath`. Nothing of Dropgate 3's direct transfers works with Dropgate 4: a Dropgate 3 sender's code finds no transfer (`NOT_FOUND`), and its link (`/p2p/<code>`) isn't a direct link ([DGDTP §4.17](../technical/DGDTP.md#417-no-compatibility-with-dropgate-3)).

### client.links

| Method | Description |
| --- | --- |
| `resolve(value, opts?)` | Resolve a sharing code or link someone typed or pasted, into where to open it on this server. It's read on the device, and nothing of it is sent: the server is only asked for its info (as `connect()` does, and kept), to check it works with this client and has direct transfer on. A link to another server is refused without a request |

Its result has `valid`, and `transport`, valid or not. A valid one has `type` and `target`, the path to open on the server: `hosted` for an upload's link or ID (`/<id>`, with the secret after its `#` still on it), `bundle` for a Dropgate 3 bundle's link (`/b/<id>#<key>`), whose page says it was made with an older version, or `p2p` for a direct transfer: a link's `target` is its path with the secret still after the `#` (`/p2p#<secret>`), and a typed code's is the receive page with the code after the `#` (`/p2p#ABCD-1234`: any case, the dash optional, given upper case with its dash), where the page reads it and never sends it; a Dropgate 3 link with its code in the path (`/p2p/<code>`) keeps that path, which a Dropgate 4 server answers with its older-version page. Whether the upload is there is for the page it opens to find out. One that isn't valid has `reason`, for people. It throws `VERSION_UNSUPPORTED` if the server's DGUP doesn't work with this client's, or `connect()`'s errors.

**Changed in 4.0:** `resolve()` asks the server nothing about the input, where 3.x sent the ID or code to the server to resolve (a Dropgate 4 server has no such route); a hosted upload's `type` is `hosted`, where 3.x said `file`.

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
| `capabilities.upload` | `enabled`, `maxSizeMB` (0 for no limit), `maxLifetimeHours` (0 for unlimited), `maxFileDownloads` (the most an upload's `maxDownloads` may be, and what it is when left out; 0 for no limit), `e2ee`, `chunkSize` in bytes, `maxPauseMinutes` (how long a paused upload or download is held; 0 when pausing is off, [Pausing](#pausing)), and `credentialRequired` ([Credentials](#credentials)) |
| `capabilities.p2p` | `enabled`, `iceServers` (its STUN servers, `[]` with STUN off), `codeLetters` (how many of a code's letters are the server's: 2 or 3, or 0 with codes off) and `credentialRequired` ([Credentials](#credentials)), for direct transfers |
| `capabilities.webUI` | `enabled` |

### client.operations

What's running on the client: every upload, download, direct send and direct receive, by its handle's `id`.

| Method | Description |
| --- | --- |
| `get(id)` | The handle of the running operation with this ID, or `undefined` if none is running with it |
| `list()` | What's running, in the order it started: each one's `id` and `kind` (`hosted.upload`, `hosted.download`, `direct.send` or `direct.receive`) |
| `cancelAll()` | Cancel everything running on the client. Each ends as `cancelled`, `by: 'parent'`; the client stays usable. A direct transfer's other device is told, and ends `cancelled` `by: 'peer'` |

An operation is listed from the moment it starts until the moment it ends, however it ends, and nothing about it is kept after that: keep its outcome from `result`. It has left the registry before its outcome or its last snapshot reaches you. IDs are made on the device, and never sent to a server; they don't survive a restart.

## Operation Handles

`client.hosted.upload()`, `client.hosted.download()`, `client.direct.send()` and `client.direct.receive()` each give a **handle**, the same shape for every operation (a direct transfer's has a few methods more, [above](#direct-transfer-handles)):

| Member | Description |
| --- | --- |
| `id` | The operation's ID: a random UUID made on the device, never sent to a server. `client.operations.get(id)` gives the handle back while it runs |
| `kind` | `hosted.upload`, `hosted.download`, `direct.send` or `direct.receive` |
| `result` | A promise of the operation's one [outcome](outcomes.md). It never rejects |
| `snapshot` | Where it is now (below). A new, frozen object each time it changes |
| `subscribe(listener)` | Calls `listener` with each new snapshot until it has ended, the last with its outcome's status. Returns a function that unsubscribes. A listener that throws doesn't stop the operation or the others |
| `cancel()` | Cancels it: its outcome is then `cancelled`, `by: 'self'`. Does nothing once it has ended. It cancels a paused one too |
| `pause()` | Pauses it, where `snapshot.canPause` says it can: a promise that resolves once the server holds it. Paused already, it renews the server's deadline ([Pausing](#pausing)) |
| `resume()` | Resumes it from where it stopped: a promise that resolves once it's running again |

A snapshot never holds a file name or a key. An upload's (`UploadSnapshot`):

| Field | Description |
| --- | --- |
| `status` | `initializing`, `uploading`, `paused` or `completing` while it runs, then its outcome's status: `completed`, `cancelled` or `failed` |
| `phase` | The step it's on: `server-info`, `server-compat`, `crypto`, `init`, `file-start`, `chunk`, `file-complete`, `retry-wait`, `retry`, `complete`, then `done` once it has completed. A cancelled or failed upload keeps the step it stopped at |
| `text` | What it's doing, for people, such as `Uploading chunk 2 of 5...`. A failed upload's is its error's message |
| `percent` | 0 to 100 |
| `processedBytes`, `totalBytes` | Bytes of the files sent so far, and of all the files together |
| `fileIndex`, `totalFiles` | Which of the files given it's on (from 0), and how many, for an upload of several files |
| `chunkIndex`, `totalChunks` | Which chunk of the current file it's on (from 0), and how many it has |
| `canPause` | Whether `pause()` can be called now: `false` until the server has taken the upload, while a pause or resume is settling, once it's finishing or has ended, and on a server with pausing off. `true` while paused, since pausing again renews the deadline |
| `pausedBy` | `self` while it's paused, `null` while it isn't |
| `deadline` | When it ends unless something changes, in milliseconds since 1970: paused, when the server stops holding it; reconnecting, when the server stops waiting for it. `null` otherwise |
| `transport` | `{ secure }`: `false` for an [insecure server](#insecure-servers) |

A download's (`DownloadSnapshot`):

| Field | Description |
| --- | --- |
| `status` | `initializing`, `downloading`, `paused` or `completing` (the sink is closing) while it runs, then its outcome's status |
| `phase` | `server-info`, `server-compat`, `metadata`, `file-start` (the next of several files), `downloading`, `complete`, then `done` once it has completed |
| `text` | What it's doing, for people, such as `Downloading file 2 of 3...` |
| `percent` | 0 to 100 |
| `processedBytes`, `totalBytes` | Bytes written to the sink so far, and of all the files being downloaded together (0 until the metadata is in) |
| `fileIndex`, `totalFiles` | For several files: which it's on (its index in the upload's list), and how many are being downloaded |
| `canPause`, `pausedBy`, `deadline` | As an upload's, from the moment the server gives the download its lease. A paused download of an opened upload has no `deadline` while another under its lease runs |
| `transport` | `{ secure }`, as an upload's |

`pausedBy` is `self` for every hosted operation: a direct transfer can be paused by the other device too (`peer`), or both (`both`), and its snapshot is [its own](#direct-transfer-handles).

## Download Sinks

A download writes into a **sink**: any object with `write(chunk)` and `close()`, and optionally `abort(reason)`. Each may return a promise. A `WritableStream`'s writer (`stream.getWriter()`) is one, and so is a Node.js `FileHandle` opened for writing.

* Core awaits each `write()` before it reads more from the server, so a slow sink slows the download down instead of filling memory.
* Core calls `close()` once every byte is written, and the download only completes once `close()` has. A `write()` or `close()` that fails fails the download, with `OUTPUT_WRITE_FAILED`.
* A download that fails or is cancelled calls `abort()`, if the sink has one, and never `close()`, so a partial file isn't finished as if it were whole.

`sink` is either a sink, or a function given each file as its download starts (`{ name, size, index }`, the name decrypted, `index` its place in the upload's list) that returns a sink, or a promise of one:

| Download | `sink` |
| --- | --- |
| One file | A sink, or a function (called once, so you can name the file) |
| Several files as a ZIP (`asZip: true`) | A sink, for the one archive |
| Several files apart | A function, called for each file |

Every download, one file or several, a ZIP or not, is one download against the upload's limit; downloads made through one [opened upload](#clienthostedopenopts) are one together.

## Metadata

`client.hosted.metadata({ id, secret })` gives an `UploadMetadata`, the same shape for one file or several: `kind` (`file` for one, `bundle` for several), `id`, `encrypted`, `files` (each `name` and `size`, in order), `totalSize` and `transport`. Asking takes no lease and counts nothing, so a page can show what's there before anyone downloads it. It never says when the upload expires or how many downloads it has left: the server doesn't give that.

Names are decrypted, and sizes are the files' as they'll be downloaded, so neither needs any crypto of your own. An encrypted upload needs its `secret`: without it, `metadata()` throws `KEY_REQUIRED`, and with one that doesn't open it, or isn't 32 bytes, `DECRYPT_FAILED`. The upload's header is checked before any of it is downloaded: an upload whose list of files or header was changed throws `INTEGRITY_FAILED`, and one made in a format this version can't read, `VERSION_UNSUPPORTED`. A name that breaks the [file name rule](quick-start.md#file-names) throws `INVALID_FILENAME`, without the name. An encrypted upload's list of files is sealed too, so only the secret's holder can read its names and sizes.

## File Sources

An upload reads each file one chunk at a time through a `FileSource`: `name`, `size`, an optional `type`, and `read(start, end)`, a promise of a `Uint8Array` of exactly `end - start` bytes. `client.hosted.upload()` takes FileSources, browser `File`s and `Blob`s (a `Blob` with no name is called `file`), and throws `INVALID_ARGUMENT` for anything else, before the upload starts.

| Helper | Description |
| --- | --- |
| `sources.fileHandle(handle, { name, type? })` | A promise of a FileSource reading a Node.js `FileHandle` (from `fs/promises`' `open()`). Its size is the file's when called. Like a browser's `File`, it can't be read once the file changes: each read checks the file's size and modification time are still what they were, and fails `SOURCE_UNAVAILABLE` if not, so a file edited during an upload, or while it's paused, is never sent part old, part new. Closing the handle once the upload has ended is yours to do |
| `sources.blob(blob, name?)` | A FileSource reading a browser `File` or `Blob`. `upload()` does this itself |

A FileSource of your own that reads files on disk should refuse a file that has changed since it was chosen in the same way, throwing a `DropgateError` with `SOURCE_UNAVAILABLE`. The Dropgate Client does: its transfer window reads each range from its file service, which compares the file's size and modification time with those when it was chosen.

## Errors

| Export | Description |
| --- | --- |
| `DropgateError` | The one error core gives, with a stable `code`. `DropgateError.is(err, code?)` tells one apart |
| `ERROR_CODES` | Every code, each with its default `origin`, `retryable` and `message` |

## Helpers

| Helper | Description |
| --- | --- |
| `lifetime.toMs(value, unit)` | A lifetime in `minutes`, `hours` or `days` in milliseconds; 0 for `unlimited` or anything invalid |
| `sizes.estimateUpload(sizeBytes, { encrypted, chunkSize?, maxBytes? })` | How many bytes the server stores for an upload of one file, which its maximum upload size is checked against: the file's size, or encrypted, with its 60-byte header, a 16-byte tag for each chunk, and its padding. `chunkSize` is the server's (default 5 MB), and `maxBytes` its maximum upload size in bytes (`maxSizeMB` × 1024², 0 or left out for none): padding stops there, so the result is over `maxBytes` only when the file itself doesn't fit |
| `filenames.validate(name)` | Throws `INVALID_FILENAME` for a name that's empty, over 255 UTF-8 bytes, or has a control character or path separator in it: the check core makes of every name it sends and receives |
| `filenames.sanitize(name)` | The name to save a received file under, the same on every OS: NFC, bidi and zero-width characters shown as `[U+XXXX]`, control characters and `< > : " / \ \| ? *` as `_`, no trailing dots or spaces, `_` before a Windows reserved name, within 255 UTF-8 bytes, never empty ([File Names](quick-start.md#file-names)) |
| `filenames.unique(name, taken)` | `name` if it isn't taken, or else `name (1).ext`, `name (2).ext` and so on. `taken` is the names already used, compared without regard to case, or a function that says whether a name is |
| `codes.isLike(value)` | Whether a value is a direct transfer code as someone might type it: spaces anywhere and lower case are fine, and the dash may be left out (`abcd 1234` is `ABCD-1234`); an I or an O, or any other character, isn't. `codes` makes no codes: a code is made by a send, its first letters from the server |
| `hosts.isLocalhost(hostname)` | Whether a hostname is this machine (`localhost`, `127.0.0.1` or `::1`, also as `[::1]`) |
| `hosts.isSecureForDirect(hostname, isSecureContext)` | Whether a direct transfer can run here: a secure context, or this machine |
| `zip.writer(onData)` | A streaming ZIP writer (below) |

## zip.writer()

A streaming ZIP writer, for writing several files received in a direct transfer into one archive. It's core's own: it stores without compressing, never holds a whole file in memory, and has no dependencies. A hosted upload's ZIP of several files needs none of this: `client.hosted.download({ id, secret, asZip: true, sink })` writes it with the same writer.

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
