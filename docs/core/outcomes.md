# Outcomes and Cancellation

## Outcomes

An upload and a download each end with exactly one **outcome**, which says how it ended. The promise of it never rejects, so there's no `try`/`catch` around it: look at its `status`.

| `status` | Also holds | When |
| --- | --- | --- |
| `completed` | `value`: the operation's result (an `UploadResult` or a `DownloadResult`) | It finished |
| `cancelled` | `cancellation`: who cancelled it (below) | It was cancelled before it finished |
| `failed` | `error`: a [`DropgateError`](errors.md) | It stopped on an error |

```javascript
const session = await client.uploadFiles({ files: myFile, lifetimeMs: 3600000 });
const outcome = await session.result;

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

Calling an upload or a download with nothing to do (no files, or neither a `fileId` nor a `bundleId`) throws `INVALID_ARGUMENT` at once, since there's no operation for an outcome to describe.

## Cancellation

Every upload and download runs in one **cancellation tree**. The client is its root, each operation is a node under it, and the steps an operation starts, such as its requests, run under that. Cancelling a node cancels everything under it, once, and nothing above it or beside it.

There are three ways to cancel an operation, and its `cancelled` outcome says which, in `cancellation`:

| `cancellation.by` | `cancellation.source` | How |
| --- | --- | --- |
| `self` | `upload` | The upload's own `session.cancel()` |
| `parent` | `client` | The client's `cancelAll()`, which cancels everything running on it |
| `signal` | `download` | An `AbortSignal` passed in as `signal` was aborted |

`source` names what was cancelled first: the operation itself, or the one it runs under.

```javascript
// Cancel one upload:
session.cancel();

// Cancel every upload and download running on the client, such as when the app closes.
// Each ends as { status: 'cancelled', cancellation: { by: 'parent', source: 'client' } }.
client.cancelAll();

// Cancel a download with your own signal:
const controller = new AbortController();
const download = client.downloadFiles({ fileId, onData, signal: controller.signal });
controller.abort();
// (await download) is { status: 'cancelled', cancellation: { by: 'signal', source: 'download' } }
```

The client stays usable after `cancelAll()`: operations started afterwards run as normal. Once an operation has ended, cancelling it does nothing.

When an upload is cancelled, however that happens, core tells the server to discard what it has, without waiting for it.

> **Known issue: an upload given its own `signal`.** The upload uses that signal for its requests instead of its own node of the tree, so `session.cancel()` and `cancelAll()` tell the server to discard the upload but don't stop the client sending chunks, and the upload's outcome then depends on what the server does with them. Aborting the signal itself does stop it, with `by: 'signal'`. Until this is fixed, call `session.cancel()` first, so the server is told, and then abort your signal.
