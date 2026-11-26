# Quick Start

## Configure Once, Use Everywhere

Everything goes through one `DropgateClient` for a server, given its address once:

```javascript
import { DropgateClient } from '@dropgate/core';

const client = new DropgateClient({
  server: 'https://dropgate.link', // URL string or { host, port?, secure? }
  appInfo: { name: 'My App', version: '1.2.0' }, // optional: for your own display and logs, never sent
});
```

There's no version to give: core knows its own, and works out with the server whether they work together. A server on plain `http://` on another machine also needs `allowInsecure: true`, which is never automatic ([Insecure Servers](api-reference.md#insecure-servers)).

Its calls are grouped by feature: `client.hosted` uploads and downloads through the server, `client.direct` transfers from one device to another, `client.links` resolves sharing codes and links, `client.server` is the server, and `client.operations` is what's running.

## Connecting to the Server

`client.server.connect()` asks for the server's info, checks this client can work with it, protocol by protocol, and keeps the answer. Every other call connects first, so calling it yourself is only needed to check a server, such as for a "Test Connection" button.

```javascript
const { serverInfo, dgup, dgdtp, transport } = await client.server.connect({ timeoutMs: 5000 });

console.log('Server version:', serverInfo.version); // for display only
if (!dgup.compatible) console.log(dgup.message);    // "Update required: ..." for whichever side needs it
console.log('Direct transfers work:', dgdtp.compatible);
console.log('Secure connection:', transport.secure);
console.log('Upload enabled:', serverInfo.capabilities?.upload?.enabled);
console.log('P2P enabled:', serverInfo.capabilities?.p2p?.enabled);
```

`client.server.info()` asks again each time, without keeping the answer or checking compatibility.

## Uploading Files

`client.hosted.upload()` starts the upload and gives its **handle** straight away: `id`, `result`, `snapshot`, `subscribe()`, `cancel()`, `pause()` and `resume()`.

```javascript
const upload = client.hosted.upload({
  files: myFile, // a browser File or Blob, or a FileSource (below), or an array of them
  lifetimeMs: 3600000, // 1 hour
  maxDownloads: 5,
  encrypt: true,
});

// Where it is, each time that changes. A snapshot never names a file: for an
// upload of several, fileIndex says which of yours it's on.
upload.subscribe(({ status, phase, text, percent }) => {
  console.log(`${status} ${phase}: ${text} (${percent.toFixed(0)}%)`);
});

// The upload's one outcome: completed, cancelled or failed. It never rejects.
const outcome = await upload.result;
if (outcome.status === 'completed') {
  console.log('Download URL:', outcome.value.downloadUrl); // https://<server>/<id>#<secret>
  keepForDeleting(outcome.value.id, outcome.value.manageToken); // only the sender has it
} else if (outcome.status === 'failed') {
  console.error('Upload failed:', outcome.error.code, outcome.error.message);
}

// Cancel an in-progress upload (its outcome is then 'cancelled'):
// upload.cancel();

// Delete a finished one from the server, with the token its upload gave:
// await client.hosted.delete({ id: outcome.value.id, manageToken: outcome.value.manageToken });
```

An encrypted upload's link ends with `#` and its secret, from which the keys that encrypt it are made: it never leaves the device, except in the link you share. The `manageToken` deletes the upload with [`client.hosted.delete()`](api-reference.md#clienthosteddeleteopts), and only the sender has it: keep it no further than you need, and never in a log.

A chunk that gets no answer, or a `408`, `429` or `5xx` but `507`, is sent again, after a growing wait, until the server stops waiting for the upload; anything else fails at once ([Retries](api-reference.md#retries)).

An upload can pause, and resume from where it stopped, on a server that allows it ([Pausing](api-reference.md#pausing)):

```javascript
if (upload.snapshot.canPause) await upload.pause();
// The server holds it until upload.snapshot.deadline (ms since 1970); still paused then, it fails.
console.log('Paused until', new Date(upload.snapshot.deadline));
await upload.resume(); // sends only what the server doesn't have
```

`upload.snapshot` is where it is now, as a new, frozen object each time it changes. The [API Reference](api-reference.md#operation-handles) lists its fields, and [Outcomes and Cancellation](outcomes.md) has the rest, including cancelling with your own `AbortSignal`, and everything at once with `client.operations.cancelAll()`.

### File Sources

Core reads a file one chunk at a time, through a **file source**: a `name`, a `size`, and `read(start, end)`, which gives exactly those bytes. A browser `File` or `Blob` is used as it is. For a file on disk in Node.js, open it and pass `sources.fileHandle()`:

```javascript
import { open } from 'node:fs/promises';
import { sources } from '@dropgate/core';

const handle = await open('/files/report.pdf', 'r');
try {
  const source = await sources.fileHandle(handle, { name: 'report.pdf' });
  const outcome = await client.hosted.upload({ files: source, lifetimeMs: 3600000 }).result;
} finally {
  await handle.close();
}
```

Anything else that can read a range of bytes on request, such as a file another process holds, implements `read()` itself:

```javascript
const source = {
  name: 'report.pdf',
  size: 1048576,
  read: (start, end) => readBytesSomehow(start, end), // a Promise of a Uint8Array of end - start bytes
};
```

A source must be able to read any range, more than once: a stream that can only be read once isn't a source. If a read fails, or gives a different number of bytes (the file changed while it was read), the upload fails with `SOURCE_UNAVAILABLE`.

## Reading Metadata

`client.hosted.metadata()` gives what the server holds about an upload, with the file names decrypted for an encrypted one. The secret is the part of the link after its `#`, and it never leaves the device. Reading metadata takes no lease and counts as no download.

```javascript
const link = new URL('https://dropgate.example/f5aa7a2f-ce3a-4deb-b92f-2da74b6b9bae#CPuytR72dDo2WhXGdB6x6aXlPcJu7Ec0tYvcUn5GL0k');
const id = link.pathname.slice(1);
const secret = link.hash.slice(1) || undefined; // an unencrypted upload's link has none

const upload = await client.hosted.metadata({ id, secret });
console.log(upload.kind, upload.encrypted, `${upload.totalSize} bytes`);
for (const { name, size } of upload.files) console.log(`- ${name}: ${size} bytes`);
```

One file and several are read the same way, from links of the same shape: `kind` is `file` for one and `bundle` for several. An encrypted upload's list of files is sealed as well, so only the secret's holder can read its names and sizes, or how many there are. An encrypted upload without its secret throws `KEY_REQUIRED`, and a secret that doesn't open it, `DECRYPT_FAILED`.

## Downloading Files

`client.hosted.download()` writes the file into a **sink**, which it needs: anything with `write(chunk)` and `close()`, and ideally `abort()`. Core awaits each write, and the download only completes once the sink has closed; a failed or cancelled download aborts it instead. Like an upload, it gives its handle at once, and ends with one outcome. It only times out if the server's answer, or the next bytes, take longer than `timeoutMs` (60 seconds unless you give another), so a big file never times out for taking long.

Each download is one download against the upload's limit: core takes a lease for it from the server, and gives it back the moment the download ends, so an upload at its limit is gone as soon as it's saved. A download pauses and resumes as an upload does, under the same lease, so it still counts once. While someone else is downloading the last copy the limit allows, the download waits ("Someone is downloading this right now.") and starts when it can.

In a browser, a `WritableStream`'s writer is a sink, such as [StreamSaver](https://github.com/jimmywarting/StreamSaver.js)'s:

```javascript
const download = client.hosted.download({
  id,
  secret, // for an encrypted file
  sink: streamSaver.createWriteStream('report.pdf').getWriter(),
});

download.subscribe(({ percent, processedBytes, totalBytes }) => {
  console.log(`${percent.toFixed(0)}% (${processedBytes}/${totalBytes})`);
});

const outcome = await download.result;
if (outcome.status === 'completed') console.log('Saved:', outcome.value.filename);
else if (outcome.status === 'failed') console.error('Download failed:', outcome.error.code);
```

In Node.js, so is a file opened for writing. To name the file after the one being downloaded, pass a function: it's given each file's name and size as its download starts, and returns the sink.

Core has already refused a name that's empty, too long, or has a control character or path in it. Before using one as a path, give it to `filenames.sanitize()` for a name that's safe on every OS, and `filenames.unique()` so it doesn't replace a file already there (see [File Names](#file-names)).

```javascript
import { open, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { filenames } from '@dropgate/core';

let path;
const download = client.hosted.download({
  id,
  secret,
  sink: async ({ name }) => {
    const safe = filenames.unique(filenames.sanitize(name), (n) => existsSync(join('/downloads', n)));
    return open((path = join('/downloads', safe)), 'wx');
  },
});
const outcome = await download.result;
if (outcome.status !== 'completed' && path) await rm(path, { force: true }); // a FileHandle has no abort()
```

Several files download as one ZIP archive into one sink with `asZip: true`, or as separate files, with a function giving a sink for each; `files` picks some of them, by their index in the list, and only their part of the upload is downloaded:

```javascript
const zipped = client.hosted.download({ id, secret, asZip: true, sink: zipWriter });
const separate = client.hosted.download({ id, secret, sink: ({ name }) => sinkFor(name) });
const second = client.hosted.download({ id, secret, files: [1], sink: ({ name }) => sinkFor(name) });
```

Each of those is one download against the upload's limit. A page that offers its files one by one and as a ZIP opens the upload instead, so that everything it downloads counts once, and closes it as it goes ([`client.hosted.open()`](api-reference.md#clienthostedopenopts)):

```javascript
const opened = await client.hosted.open({ id, secret });
const first = opened.download({ files: [0], sink: ({ name }) => sinkFor(name) });
const all = opened.download({ asZip: true, sink: zipWriter });
addEventListener('pagehide', () => opened.close());
```

## File Names

Core has one file name rule, for hosted uploads and direct transfers alike.

**Sent or received, a name is refused** with `INVALID_FILENAME` only if it's empty, longer than 255 bytes in UTF-8, or has a control character (NUL included) or a `/` or `\` in it. Core checks every name it sends, encrypted or not, before anything goes out, and every name it receives. The error never holds the name.

**Where a name is written out**, `filenames.sanitize()` gives the name to save it under. It gives the same name on every OS, using Windows' rules everywhere, so a file saved anywhere can be copied anywhere:

| Received | Saved as | Why |
| --- | --- | --- |
| `u` + combining `¨` + `.txt` | `ü.txt` | Normalised to NFC |
| `photo` + U+202E + `gnp.exe` | `photo[U+202E]gnp.exe` | Bidi controls and zero-width characters are shown, so a name can't pass for another |
| `CON.txt` | `_CON.txt` | A Windows reserved name |
| `report.pdf. ` | `report.pdf` | Trailing dots and spaces |
| `a:b` | `a_b` | `:` (a Windows `name:stream`) and `< > " \| ? *` |

`filenames.unique(name, taken)` gives `name (1).ext`, `name (2).ext` and so on when a name is taken; `taken` is a list of names, compared without regard to case, or a function. A ZIP of several files has its members named this way already.

## Sizes

Every conversion between bytes and KB, MB or GB is in 1024s, labelled KB, MB and GB: a server's `maxSizeMB` of 100 allows 104,857,600 bytes.

## What's Running

Every handle has an `id`, made on the device. `client.operations` finds a running operation by it, lists what's running, and cancels everything:

```javascript
const { id } = client.hosted.upload({ files: myFile, lifetimeMs: 3600000 });

client.operations.get(id);   // the same handle, while it runs; undefined once it has ended
client.operations.list();    // [{ id, kind: 'hosted.upload' }, ...]
client.operations.cancelAll(); // such as when the app closes
```

An operation leaves the list the moment it ends, and nothing about it is kept, so keep its outcome from `result`.

## Resolving a Code or Link

```javascript
const result = await client.links.resolve(pastedText);
if (result.valid) location.href = result.target; // an encrypted link's secret is back on the end
else console.log(result.reason);
```

The text is read on the device, and nothing of it is sent to the server: the page it opens finds out whether the upload is there.

## Direct Transfer (Sender)

```javascript
const send = await client.direct.send({ files: [file1, file2] });

const { link, code } = send.share(); // give the receiver either
send.subscribe((s) => {
  console.log(s.status, `${s.percent}%`, s.text); // never the link, the code or a name
  if (s.code === 'ready') console.log('Code:', send.share().code); // a new code after one was tried
});

// Either device can pause once the receiver has accepted:
// await send.pause(); await send.resume();

const outcome = await send.result;
if (outcome.status === 'completed') console.log(`The receiver has ${outcome.value.files} files.`);
else if (outcome.status === 'cancelled') console.log('Cancelled by', outcome.cancellation.by); // 'peer' if they declined
else console.error(outcome.error.code, outcome.error.message);
```

## Direct Transfer (Receiver)

```javascript
import { filenames } from '@dropgate/core';

const receive = await client.direct.receive({ link }); // or { code: 'ABCD-1234' }

// The files first: show them, then let the person choose.
const { files, totalSize } = await receive.offer();
console.log(files.map((f) => `${f.name} (${f.size} bytes)`), totalSize);

if (confirmed) {
  // One sink for each file, or one for a ZIP of them all: { sink, asZip: true }.
  // sinkFor() is yours: anything with write() and close() (Download Sinks, in the API Reference).
  await receive.accept({ sink: (file) => sinkFor(filenames.sanitize(file.name)) });
} else {
  await receive.decline();
}

const outcome = await receive.result; // completed only once every sink has closed
```

In Node, give the client an `RTCPeerConnection`, such as node-datachannel's or werift's ([Direct Transfers](p2p.md#in-node)).
