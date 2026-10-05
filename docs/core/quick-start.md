# Quick Start

## Configure Once, Use Everywhere

All operations go through a single `DropgateClient` instance. Server connection details are specified once in the constructor:

```javascript
import { DropgateClient } from '@dropgate/core';

const client = new DropgateClient({
  clientVersion: '3.0.13',
  server: 'https://dropgate.link', // URL string or { host, port?, secure? }
  fallbackToHttp: true,             // retry over plain HTTP if HTTPS fails (optional; see Constructor Options)
});
```

## Connecting to the Server

`connect()` fetches server info, checks version compatibility, and caches the result. All methods call `connect()` internally, so explicit calls are optional — useful for "Test Connection" buttons or eager validation.

```javascript
const { serverInfo, compatible, message } = await client.connect({ timeoutMs: 5000 });

console.log('Server version:', serverInfo.version);
console.log('Compatible:', compatible);
console.log('Upload enabled:', serverInfo.capabilities?.upload?.enabled);
console.log('P2P enabled:', serverInfo.capabilities?.p2p?.enabled);
```

## Uploading Files

`uploadFiles()` starts the upload and gives its **handle** straight away: `result`, `snapshot`, `subscribe()` and `cancel()`.

```javascript
const upload = client.uploadFiles({
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

`upload.snapshot` is where it is now, as a new, frozen object each time it changes. The [API Reference](api-reference.md#the-upload-handle) lists its fields, and [Outcomes and Cancellation](outcomes.md) has the rest, including cancelling with your own `AbortSignal`, and everything at once with `client.cancelAll()`.

### File Sources

Core reads a file one chunk at a time, through a **file source**: a `name`, a `size`, and `read(start, end)`, which gives exactly those bytes. A browser `File` or `Blob` is used as it is. For a file on disk in Node.js, open it and pass `fileHandleSource()`:

```javascript
import { open } from 'node:fs/promises';
import { fileHandleSource } from '@dropgate/core';

const handle = await open('/files/report.pdf', 'r');
try {
  const source = await fileHandleSource(handle, { name: 'report.pdf' });
  const outcome = await client.uploadFiles({ files: source, lifetimeMs: 3600000 }).result;
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

## Fetching File/Bundle Metadata

```javascript
// Fetch file metadata (size, encryption status, filename)
const fileMeta = await client.getFileMetadata('file-id-123');
console.log('File size:', fileMeta.sizeBytes);
console.log('Encrypted:', fileMeta.isEncrypted);
console.log('Filename:', fileMeta.filename || fileMeta.encryptedFilename);

// Fetch bundle metadata with automatic derivation
const bundleMeta = await client.getBundleMetadata(
  'bundle-id-456',
  'base64-key-from-url-hash' // Required for encrypted bundles
);

console.log('Files:', bundleMeta.fileCount);
console.log('Total size:', bundleMeta.totalSizeBytes);
console.log('Sealed:', bundleMeta.sealed);

// For sealed bundles, the manifest is automatically decrypted
// and files array is populated from the decrypted manifest
bundleMeta.files.forEach(file => {
  console.log(`- ${file.filename}: ${file.sizeBytes} bytes`);
});
```

## Downloading Files

```javascript
// Download with streaming (for large files). Like an upload, it ends with one outcome.
const outcome = await client.downloadFiles({
  fileId: 'abc123',
  keyB64: 'base64-key-from-url-hash', // Required for encrypted files
  onProgress: ({ phase, percent, processedBytes, totalBytes }) => {
    console.log(`${phase}: ${percent}% (${processedBytes}/${totalBytes})`);
  },
  onData: async (chunk) => {
    await writer.write(chunk);
  },
});

if (outcome.status === 'completed') console.log('Downloaded:', outcome.value.filename);
else if (outcome.status === 'failed') console.error('Download failed:', outcome.error.code);

// Or download to memory (for small files — omit onData)
const inMemory = await client.downloadFiles({ fileId: 'abc123' });
if (inMemory.status === 'completed') console.log('File size:', inMemory.value.data?.length);
```

A download takes a `signal` too: aborting it ends the download with a `cancelled` outcome.

## P2P File Transfer (Sender)

```javascript
const Peer = await loadPeerJS(); // Your loader function

const session = await client.p2pSend({
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

const session = await client.p2pReceive({
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
const session = await client.p2pReceive({
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

## Standalone Server Info

For one-off checks before constructing a client:

```javascript
import { getServerInfo } from '@dropgate/core';

const { serverInfo } = await getServerInfo({
  server: 'https://dropgate.link',
  timeoutMs: 5000,
});

console.log('Server version:', serverInfo.version);
```

## Metadata Fetching

The core library provides intelligent metadata fetching methods that handle all the complexity of deriving computed fields from server responses.

### Philosophy

The server stores and sends only **minimal, essential data**:
- For files: Basic metadata (size, encryption flag, filename)
- For bundles: File list (for unsealed) or encrypted manifest (for sealed)

The core library **derives all computed fields**:
- `totalSizeBytes`: Sum of all file sizes
- `fileCount`: Length of files array
- Decrypted manifest contents (for sealed bundles)

### Benefits

1. **Single Source of Truth**: All derivation logic lives in one place (the core library)
2. **Server Efficiency**: Server stores less redundant data
3. **Client Flexibility**: Clients can compute fields in any format they need
4. **Future-Proof**: Changes to derivation logic only require library updates

### Usage

```javascript
// The core library automatically:
// 1. Fetches raw metadata from the server
// 2. Decrypts sealed bundle manifests (if keyB64 provided)
// 3. Derives totalSizeBytes and fileCount from files array
// 4. Returns a complete BundleMetadata object

const meta = await client.getBundleMetadata('bundle-id', 'optional-key');
// meta.totalSizeBytes and meta.fileCount are computed client-side
```
