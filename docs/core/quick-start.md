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

`client.hosted.upload()` starts the upload and gives its **handle** straight away: `id`, `result`, `snapshot`, `subscribe()` and `cancel()`.

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
  console.log('Download URL:', outcome.value.downloadUrl);
} else if (outcome.status === 'failed') {
  console.error('Upload failed:', outcome.error.code, outcome.error.message);
}

// Cancel an in-progress upload (its outcome is then 'cancelled'):
// upload.cancel();
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

`client.hosted.metadata()` gives what the server holds about an upload, with the file names decrypted for an encrypted one. The key is the part of the link after its `#`, and it never leaves the device.

```javascript
const file = await client.hosted.metadata({ fileId: 'file-id-123', keyB64: 'key-from-the-link' });
console.log(file.name, file.sizeBytes, file.isEncrypted);

const bundle = await client.hosted.metadata({ bundleId: 'bundle-id-456', keyB64: 'key-from-the-link' });
console.log(`${bundle.fileCount} files, ${bundle.totalSizeBytes} bytes`);
for (const { name, sizeBytes } of bundle.files) console.log(`- ${name}: ${sizeBytes} bytes`);
```

A sealed bundle's list of files is encrypted as well, so only the key's holder can read it. An encrypted upload without its key throws `KEY_REQUIRED`, and a key that doesn't open it, `DECRYPT_FAILED`.

## Downloading Files

`client.hosted.download()` writes the file into a **sink**, which it needs: anything with `write(chunk)` and `close()`, and ideally `abort()`. Core awaits each write, and the download only completes once the sink has closed; a failed or cancelled download aborts it instead. Like an upload, it gives its handle at once, and ends with one outcome.

In a browser, a `WritableStream`'s writer is a sink, such as [StreamSaver](https://github.com/jimmywarting/StreamSaver.js)'s:

```javascript
const download = client.hosted.download({
  fileId: 'abc123',
  keyB64: 'key-from-the-link', // for an encrypted file
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

```javascript
import { open, rm } from 'node:fs/promises';
import { join } from 'node:path';

let path;
const download = client.hosted.download({
  fileId: 'abc123',
  keyB64: 'key-from-the-link',
  sink: async ({ name }) => open((path = join('/downloads', name)), 'w'), // check the name before using it as a path
});
const outcome = await download.result;
if (outcome.status !== 'completed' && path) await rm(path, { force: true }); // a FileHandle has no abort()
```

A bundle downloads as one ZIP archive into one sink with `asZip: true`, or as its separate files, with a function giving a sink for each:

```javascript
const zipped = client.hosted.download({ bundleId, keyB64, asZip: true, sink: zipWriter });
const separate = client.hosted.download({ bundleId, keyB64, sink: ({ name }) => sinkFor(name) });
```

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
if (result.valid) location.href = result.target; // an encrypted link's key is back on the end
else console.log(result.reason);
```

The text is read on the device first, and only the ID or code in it is sent to the server: never the key after a link's `#`.

## P2P File Transfer (Sender)

```javascript
const Peer = await loadPeerJS(); // Your loader function

const session = await client.direct.send({
  file: myFile,
  Peer,
  onCode: (code) => console.log('Share this code:', code),
  onProgress: ({ processedBytes, totalBytes, percent }) => {
    console.log(`Sending: ${percent.toFixed(1)}%`);
  },
  onComplete: () => console.log('Transfer complete!'),
  onError: (err) => console.error('Error:', err),
  onCancel: ({ cancelledBy }) => console.log(`Cancelled by ${cancelledBy}`),
  onDisconnect: () => console.log('Receiver disconnected'),
});

// Session control
console.log('Status:', session.getStatus());
console.log('Bytes sent:', session.getBytesSent());
session.stop(); // Cancel
```

## P2P File Transfer (Receiver)

```javascript
const Peer = await loadPeerJS();

const session = await client.direct.receive({
  code: 'ABCD-1234',
  Peer,
  onMeta: ({ name, total, fileCount, files }) => {
    console.log(`Receiving: ${name} (${total} bytes)`);
    if (fileCount) console.log(`Multi-file transfer: ${fileCount} files`);
  },
  onData: async (chunk) => {
    await writer.write(chunk);
  },
  onProgress: ({ processedBytes, totalBytes, percent }) => {
    console.log(`Receiving: ${percent.toFixed(1)}%`);
  },
  // Multi-file transfers: called when each individual file starts/ends
  onFileStart: ({ fileIndex, name, size }) => {
    console.log(`File ${fileIndex}: ${name} (${size} bytes)`);
  },
  onFileEnd: ({ fileIndex, receivedBytes }) => {
    console.log(`File ${fileIndex} complete (${receivedBytes} bytes)`);
  },
  onComplete: ({ received, total }) => console.log(`Complete! ${received}/${total}`),
  onCancel: ({ cancelledBy }) => console.log(`Cancelled by ${cancelledBy}`),
  onError: (err) => console.error('Error:', err),
  onDisconnect: () => console.log('Sender disconnected'),
});

session.stop(); // Cancel
```

## P2P with File Preview (Receiver)

Use `autoReady: false` to show a file preview before starting the transfer:

```javascript
const session = await client.direct.receive({
  code: 'ABCD-1234',
  Peer,
  autoReady: false,
  onMeta: ({ name, total, sendReady }) => {
    console.log(`File: ${name} (${total} bytes)`);
    showPreviewUI(name, total);

    confirmButton.onclick = () => {
      writer = createWriteStream(name);
      sendReady(); // Signal sender to begin transfer
    };
  },
  onData: async (chunk) => {
    await writer.write(chunk);
  },
  onComplete: () => {
    writer.close();
    console.log('Transfer complete!');
  },
});
```
