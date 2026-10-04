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

```javascript
const session = await client.uploadFiles({
  files: myFile, // File or Blob (implements FileSource), or an array of them
  lifetimeMs: 3600000, // 1 hour
  maxDownloads: 5,
  encrypt: true,
  onProgress: ({ phase, text, percent }) => {
    console.log(`${phase}: ${text} (${percent ?? 0}%)`);
  },
});

// The upload's one outcome: completed, cancelled or failed. It never rejects.
const outcome = await session.result;
if (outcome.status === 'completed') {
  console.log('Download URL:', outcome.value.downloadUrl);
} else if (outcome.status === 'failed') {
  console.error('Upload failed:', outcome.error.code, outcome.error.message);
}

// Cancel an in-progress upload (its outcome is then 'cancelled'):
// session.cancel();
```

[Outcomes and Cancellation](outcomes.md) has the rest, including cancelling everything at once with `client.cancelAll()`.

> **If you pass your own `signal`, `session.cancel()` doesn't stop the upload.** It tells the server to discard the upload, but the client keeps sending chunks. To cancel straight away, call `session.cancel()` first, so the server is told, and then abort your own signal:
>
> ```javascript
> const controller = new AbortController();
> const session = await client.uploadFiles({ files: myFile, lifetimeMs: 3600000, signal: controller.signal });
>
> // To cancel:
> session.cancel();
> controller.abort();
> ```

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
