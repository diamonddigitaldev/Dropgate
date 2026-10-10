# P2P Consumer Responsibilities

The P2P methods are **headless**. The consumer is responsible for:

1. **Loading PeerJS**: Provide the `Peer` constructor to `client.direct.send()` and `client.direct.receive()`
2. **File Writing**: Handle received chunks via `onData` callback (e.g., using streamSaver)
3. **UI Updates**: React to callbacks (`onProgress`, `onStatus`, etc.)

This design allows the library to work in any environment (browser, Electron, Node.js with WebRTC).

Behaviour to account for in the current version:

- **`onCancel` also fires when the connection drops.** If the data channel closes mid-transfer, the receiver gets `cancelledBy: 'sender'` and the sender gets `cancelledBy: 'receiver'`, even if nobody cancelled. Word your UI accordingly. It says only who cancelled: what the other device said about it isn't passed on, since it could say anything.
- **Received names are checked, not made safe.** A name that breaks the [file name rule](quick-start.md#file-names) fails the transfer with `INVALID_FILENAME`; any other is given as the sender sent it. Save a file under `filenames.sanitize(name)`.
- **The sender is told the transfer succeeded before `onComplete` runs.** The receiver acknowledges completion first, then calls `onComplete` without waiting for it. If closing or finalising your output fails there, the sender still reports success, so handle that error yourself.
- **Flow control only works if `onData` waits for the write.** The receiver acknowledges a chunk when `onData` resolves. `zip.writer()`'s `writeChunk()` returns immediately and queues its output, so with a slow destination, await its `drained()` before acknowledging, or that queue can grow without limit.
- **Several files into one ZIP: start each member in `onFileStart`, with its `name` and `size`.** [`zip.writer()`](api-reference.md#zipwriter) makes the name safe and unique, and refuses a file whose bytes don't come to the size the sender gave, so a throw from `onData` or `onFileEnd` fails the transfer rather than saving an archive that looks whole but isn't.
- **Resume is not implemented.** `onResumeRequest` is never called; an interrupted transfer has to be restarted.
- **Security:** see [DGDTP §18](../technical/DGDTP.md#18-security-considerations) for what the P2P code and DTLS do and don't protect against.

## Large File Support

The P2P implementation is designed for **unlimited file sizes** with constant memory usage:

- **Stream-through architecture**: Chunks flow immediately to `onData`, no buffering
- **Flow control**: Sender pauses when receiver's write queue backs up
- **WebRTC reliability**: SCTP provides reliable, ordered, checksum-verified delivery

> **Note**: For large files, always use the `onData` callback approach rather than buffering in memory.
