# Outcomes and Cancellation

## Outcomes

An upload and a download each end with exactly one **outcome**, which says how it ended. The promise of it never rejects, so there's no `try`/`catch` around it: look at its `status`.

| `status` | Also holds | When |
| --- | --- | --- |
| `completed` | `value`: the operation's result (an `UploadResult` or a `DownloadResult`) | It finished |
| `cancelled` | `cancellation`: who cancelled it (below) | It was cancelled before it finished |
| `failed` | `error`: a [`DropgateError`](errors.md) | It stopped on an error |

Every outcome also holds `transport`, `{ secure }`: `false` when the client reached an [insecure server](api-reference.md#insecure-servers), so even a cancelled operation can say so.

```javascript
const upload = client.hosted.upload({ files: myFile, lifetimeMs: 3600000 });
const outcome = await upload.result;

switch (outcome.status) {
  case 'completed':
    console.log('Download URL:', outcome.value.downloadUrl);
    break;
  case 'cancelled':
    console.log('Cancelled by', outcome.cancellation.by);
    break;
  case 'failed':
    console.error(outcome.error.code, outcome.error.message);
    break;
}
```

A failed or cancelled outcome never holds a file name or a key, so it's safe to show and to log, serialised or not. A completed one holds what you asked for, which may: an encrypted upload's link carries its key, and a download's result its file names.

Work that ends after a cancel, however it ends, is `cancelled`, even if a request then fails on the way out. Work that had already finished when the cancel came is `completed`: an upload the server has already saved can't be taken back by cancelling it.

Calling an upload or a download with nothing to do (no files, or neither a `fileId` nor a `bundleId`), or a download without a sink that fits it, throws `INVALID_ARGUMENT` at once, since there's no operation for an outcome to describe.

A download only completes once its sink has closed. A sink's `write()` or `close()` that fails fails the download, with `OUTPUT_WRITE_FAILED`, and a download that fails or is cancelled aborts its sink, so nothing half-written is finished as if it were whole.

## Cancellation

Every upload and download runs in one **cancellation tree**. The client is its root, each operation is a node under it, and the steps an operation starts, such as its requests, run under that. Cancelling a node cancels everything under it, once, and nothing above it or beside it.

There are three ways to cancel an operation, and its `cancelled` outcome says which, in `cancellation`:

| `cancellation.by` | `cancellation.source` | How |
| --- | --- | --- |
| `self` | `hosted.upload` or `hosted.download` | The operation's own `cancel()` |
| `parent` | `client` | `client.operations.cancelAll()`, which cancels everything running on the client |
| `signal` | `hosted.upload` or `hosted.download` | An `AbortSignal` passed in as `signal` was aborted |

`source` names what was cancelled first: the operation itself, by its kind, or the client it runs under.

A signal you pass in feeds into the operation's own node: aborting it cancels the operation as its own `cancel()` would. It doesn't replace that node, so `upload.cancel()` and `client.operations.cancelAll()` still stop an upload that was given a signal. Cancelling never aborts your signal: it's yours.

```javascript
// Cancel one upload:
upload.cancel();

// Cancel every upload and download running on the client, such as when the app closes.
// Each ends as { status: 'cancelled', cancellation: { by: 'parent', source: 'client' } }.
client.operations.cancelAll();

// Cancel an upload or a download with your own signal:
const controller = new AbortController();
const download = client.hosted.download({ fileId, sink, signal: controller.signal });
controller.abort();
// (await download.result) is { status: 'cancelled', cancellation: { by: 'signal', source: 'hosted.download' } }
```

The client stays usable after `cancelAll()`: operations started afterwards run as normal. Once an operation has ended, cancelling it does nothing.

When an upload is cancelled, however that happens, core stops sending chunks and tells the server to discard what it has, without waiting for it. An operation given a signal that's already aborted is cancelled before it asks the server anything.
