# Outcomes and Cancellation

## Outcomes

An upload, a download, a direct send and a direct receive each end with exactly one **outcome**, which says how it ended. The promise of it never rejects, so there's no `try`/`catch` around it: look at its `status`.

| `status` | Also holds | When |
| --- | --- | --- |
| `completed` | `value`: the operation's result (an `UploadResult`, a `DownloadResult` or a `DirectResult`) | It finished |
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

A failed or cancelled outcome never holds a file name, a secret or a manage token, so it's safe to show and to log, serialised or not. A completed one holds what you asked for, which may: an encrypted upload's link carries its secret, the upload's value its manage token, and a download's result its file names.

Work that ends after a cancel, however it ends, is `cancelled`, even if a request then fails on the way out. Work that had already finished when the cancel came is `completed`: an upload the server has already saved can't be taken back by cancelling it.

Calling an upload or a download with nothing to do (no files, or no `id`), or a download without a sink that fits it, throws `INVALID_ARGUMENT` at once, since there's no operation for an outcome to describe.

A paused upload or download hasn't ended: its outcome comes once it's resumed and finishes, it's cancelled, or it's still paused at the server's deadline, when it fails with `NOT_FOUND`, "The server dropped this paused upload." (or download). Nothing resumes by itself ([Pausing](api-reference.md#pausing)).

A download only completes once its sink has closed. A sink's `write()` or `close()` that fails fails the download, with `OUTPUT_WRITE_FAILED`, and a download that fails or is cancelled aborts its sink, so nothing half-written is finished as if it were whole.

## Direct transfers

A direct transfer has an outcome on each device, and the two always agree on how it ended. The sender's completes only once the receiver has saved every file (closed every sink) and said so; its value, on both sides, is `{ assurance, files, totalBytes, transport }`, where `assurance` is `saved`, or `handed-off` for a sink that hands the files to a browser. Every other end is told to the other device, through the connection and, sealed, through the server, so a page closed mid-transfer is heard even when the connection has already gone. Each device gets its own words:

| What happened | The receiver | The sender |
| --- | --- | --- |
| The files were saved | `completed`, `saved` | `completed`, `saved` ("The receiver has the files.") |
| Handed to a browser to save | `completed`, `handed-off` ("Handed to your browser. Check your downloads.") | `completed`, `handed-off` ("Delivered to the receiver's browser.") |
| This device cancelled | `cancelled`, `by: 'self'` | the same |
| The other device cancelled | `cancelled`, `by: 'peer'` ("The sender cancelled the transfer.") | `cancelled`, `by: 'peer'` ("The receiver cancelled the transfer.") |
| The receiver declined | `cancelled`, `by: 'self'` | `cancelled`, `by: 'peer'`, `declined: true` ("The receiver declined the transfer.") |
| The other device's app closed | `failed`, `PEER_CLOSED` ("The sender closed Dropgate before the transfer finished.") | the mirror |
| A pause limit ran out | `failed`, `PAUSE_LIMIT`, in the words of whose limit it was | the same |
| The connection dropped | `failed`, `CONNECTION_LOST` ("The connection was lost, so the transfer couldn't continue.") | the same |
| The receiver couldn't save, or saving stalled for 2 minutes | `failed`, `OUTPUT_WRITE_FAILED` or `OUTPUT_STALLED` | `failed`, `PEER_FAILED` ("The receiver couldn't save the file.", "The receiver's device stopped saving the file.") |
| The sender's file couldn't be read | `failed`, `PEER_FAILED` ("The sender's file couldn't be read.") | `failed`, `SOURCE_UNAVAILABLE` |
| A block or the checkpoint chain didn't match | `failed`, `INTEGRITY_FAILED` | `failed`, `PEER_FAILED` ("The file didn't arrive intact.") |
| The other device sent something this version doesn't understand | `failed`, `INVALID_MESSAGE` | the same, or `PEER_FAILED` on the device that didn't find it |
| A wrong code; a connection that couldn't be secured | `failed`, `CODE_MISMATCH`; `SECURITY_POLICY_MISMATCH` | the same (a wrong code fails only that receive: the send carries on, with a new code) |
| Nobody accepted within 10 minutes | `failed`, `TIMED_OUT` | the same |

A cancel that comes once all the data has been sent waits up to 2 seconds for the other device: if the receiver had already saved the files, both are `completed`, since a save can't be undone. `PEER_FAILED` says what failed in `details.reason`, never in the other device's own words. Nothing in a direct transfer's outcome, snapshot or error holds the link, the code, a secret or a file name.

## Cancellation

Every upload and download runs in one **cancellation tree**. The client is its root, each operation is a node under it, and the steps an operation starts, such as its requests, run under that. Cancelling a node cancels everything under it, once, and nothing above it or beside it.

There are three ways to cancel an operation on this device, and a direct transfer's other device can cancel it too; its `cancelled` outcome says which, in `cancellation`:

| `cancellation.by` | `cancellation.source` | How |
| --- | --- | --- |
| `self` | the operation's kind, such as `hosted.upload` or `direct.send` | The operation's own `cancel()` (for a receive, `decline()` too) |
| `parent` | `client` | `client.operations.cancelAll()`, which cancels everything running on the client |
| `signal` | the operation's kind | An `AbortSignal` passed in as `signal` was aborted |
| `peer` | `direct.send` or `direct.receive` | The other device cancelled it, or, for a send, declined its offer (then `cancellation.declined` is `true`) |

`source` names what was cancelled first: the operation itself, by its kind, or the client it runs under.

A signal you pass in feeds into the operation's own node: aborting it cancels the operation as its own `cancel()` would. It doesn't replace that node, so `upload.cancel()` and `client.operations.cancelAll()` still stop an upload that was given a signal. Cancelling never aborts your signal: it's yours.

```javascript
// Cancel one upload:
upload.cancel();

// Cancel every operation running on the client, such as when the app closes.
// Each ends as { status: 'cancelled', cancellation: { by: 'parent', source: 'client' } }.
client.operations.cancelAll();

// Cancel an upload or a download with your own signal:
const controller = new AbortController();
const download = client.hosted.download({ id, secret, sink, signal: controller.signal });
controller.abort();
// (await download.result) is { status: 'cancelled', cancellation: { by: 'signal', source: 'hosted.download' } }
```

The client stays usable after `cancelAll()`: operations started afterwards run as normal. Once an operation has ended, cancelling it does nothing.

When an upload is cancelled, however that happens, paused or not, core stops sending chunks and tells the server to discard what it has, without waiting for it. When a download ends, however it ends, core gives its lease back to the server, so a download cancelled after its first bytes counts as one, and one cancelled before them doesn't. An operation given a signal that's already aborted is cancelled before it asks the server anything.
