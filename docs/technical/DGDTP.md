# DGDTP — Dropgate Direct Transfer Protocol

**Protocol Version:** 3
**Status:** Stable
**Last Updated:** April 2026

---

## 1. Overview

The Dropgate Direct Transfer Protocol (DGDTP) defines the peer-to-peer (P2P) file transfer mechanism used by Dropgate. Unlike DGUP (which uploads files to a server for later retrieval), DGDTP streams file data directly from one peer to another over a WebRTC data channel. The Dropgate Server acts only as a signalling relay; it never sees, stores, or processes the transferred file content.

DGDTP supports single-file transfers, multi-file transfers (streamed into a ZIP archive on the receiving end), flow control with chunk-level acknowledgements, connection health monitoring, and resumable sessions.

### 1.1 Design Goals

- **Zero server storage** — file data never touches the server's filesystem or memory.
- **Transport encryption** — WebRTC data channels are encrypted via DTLS by default. No plaintext data traverses the network.
- **Flow control** — chunk acknowledgements and buffer monitoring prevent fast senders from overwhelming slow receivers.
- **Minimal signalling** — the server's role is limited to PeerJS signalling (peer discovery, ICE candidate relay, SDP exchange). Once the data channel is established, the server is no longer involved.
- **Human-readable codes** — peers are identified by short, pronounceable codes rather than opaque UUIDs or IP addresses.

---

## 2. Terminology

| Term | Meaning |
|------|---------|
| **Sender** | The peer that holds the file(s) and initiates the DGDTP session. |
| **Receiver** | The peer that connects to the sender's code and receives file data. |
| **Signalling Server** | The Dropgate Server component that relays WebRTC signalling messages (PeerJS). |
| **Data Channel** | The WebRTC RTCDataChannel over which DGDTP messages and binary data are sent. |
| **P2P Code** | A human-readable identifier in the format `XXXX-0000` (4 letters + 4 digits). |
| **Session ID** | A UUID identifying a specific transfer session, used for resume detection. |
| **Watchdog** | A receiver-side timer that detects stalled senders. |
| **Heartbeat** | A sender-side periodic ping that prevents idle-timeout disconnections. |

---

## 3. P2P Code Generation

### 3.1 Format

Codes follow the pattern `XXXX-0000`:

- **Letters:** drawn from the alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ` (24 characters). The letters `I` and `O` are excluded to avoid visual confusion with `1` and `0`.
- **Digits:** `0`–`9`.

### 3.2 Entropy

- Letter space: 24⁴ = 331,776 combinations.
- Digit space: 10⁴ = 10,000 combinations.
- Total: ~3.3 × 10⁹ combinations.

### 3.3 Generation

Codes are generated using `crypto.getRandomValues()` when the Web Crypto API is available, falling back to `Math.random()` otherwise. The sender attempts code registration with the signalling server up to **4 times** (configurable), regenerating on collision.

### 3.4 Validation

Codes are normalised before use: trimmed, converted to uppercase, and whitespace is removed. The canonical pattern is `^[A-Z]{4}-\d{4}$`.

---

## 4. Signalling Layer

### 4.1 Architecture

DGDTP uses PeerJS as its signalling layer. The Dropgate Server mounts an ExpressPeerServer at the fixed path `/peerjs`. The signalling server handles:

- Peer registration and discovery.
- ICE candidate relay.
- SDP offer/answer exchange.
- Connection state notifications.

### 4.2 ICE Configuration

The server advertises ICE server configuration via the `/api/info` endpoint:

```json
{
  "capabilities": {
    "p2p": {
      "enabled": true,
      "peerjsPath": "/peerjs",
      "iceServers": [
        { "urls": ["stun:stun.cloudflare.com:3478"] }
      ]
    }
  }
}
```

- **Default STUN server:** `stun:stun.cloudflare.com:3478`.
- **Custom STUN servers:** configurable via the `P2P_STUN_SERVERS` environment variable (comma- or space-separated list).

### 4.3 Signalling Data Visible to the Server

The signalling server observes but does **not persist**:

| Data | Purpose |
|------|---------|
| Peer IDs (P2P codes) | Peer registration and routing. |
| ICE candidates | NAT traversal — includes IP addresses and ports of both peers. |
| SDP offers/answers | WebRTC capability negotiation — includes media/transport parameters. |
| Connection lifecycle events | Connect, disconnect, error. |

The server has **no visibility** into data channel content once the WebRTC connection is established.

### 4.4 Secure Context Requirement

WebRTC requires a secure context (HTTPS or `localhost`) in all modern browsers. The signalling server MUST be accessed over HTTPS in production. The `proxied: true` flag is set on the PeerJS server to indicate it operates behind a TLS-terminating reverse proxy.

---

## 5. Connection Establishment

### 5.1 Sender Setup

1. The sender creates a PeerJS peer using their generated P2P code as the peer ID.
2. The peer registers with the signalling server.
3. The sender enters the **listening** state and waits for incoming connections.

### 5.2 Receiver Setup

1. The receiver creates a PeerJS peer with an auto-generated ID (no code needed).
2. The receiver calls `peer.connect(code)` to initiate a data channel with the sender.

### 5.3 Connection Rate Limiting

The sender enforces a **sliding-window rate limit** on incoming connections:

- Maximum **10 connection attempts** per **10-second window**.
- Excess attempts are rejected with an error message.
- This prevents denial-of-service attacks via connection flooding.

### 5.4 Connection Replacement

If a new connection arrives while an existing one is present:

- If a transfer has already started (`transferEverStarted` flag), the new connection is rejected.
- If no transfer has started and the existing connection is closed or dead, the new connection is accepted.
- This prevents mid-transfer hijacking whilst allowing legitimate reconnection during the setup phase.

---

## 6. Handshake

Once the data channel is open, both peers exchange `hello` messages.

### 6.1 Hello Message

```json
{
  "t": "hello",
  "protocolVersion": 3,
  "sessionId": "<uuid>"
}
```

### 6.2 Version Compatibility

Protocol versions MUST match exactly. There is no backwards-compatibility negotiation. If a version mismatch is detected, the connection is terminated with an error:

```
Protocol version mismatch: sender v3, receiver v2
```

### 6.3 Timeout

The handshake MUST complete within **10 seconds**. If the `hello` is not received within this window, the connection is closed.

---

## 7. Metadata Exchange

### 7.1 Multi-File List (v3)

For transfers involving multiple files, the sender transmits a file list immediately after the handshake:

```json
{
  "t": "file_list",
  "fileCount": 3,
  "files": [
    { "name": "document.pdf", "size": 1048576, "mime": "application/pdf" },
    { "name": "photo.jpg", "size": 2097152, "mime": "image/jpeg" },
    { "name": "notes.txt", "size": 512, "mime": "text/plain" }
  ],
  "totalSize": 3146240
}
```

**Validation (receiver-side):**

- `fileCount` MUST NOT exceed **10,000**.
- `totalSize` MUST equal the sum of all individual file sizes.

### 7.2 File Metadata

Before each file's chunks, the sender transmits a `meta` message:

```json
{
  "t": "meta",
  "sessionId": "<uuid>",
  "name": "document.pdf",
  "size": 1048576,
  "mime": "application/pdf",
  "fileIndex": 0
}
```

- `fileIndex` is present only in multi-file transfers (v3).
- The `sessionId` is used for resume detection and session hijacking prevention.

### 7.3 Ready Signal

The receiver sends a `ready` message to indicate it is prepared to accept chunks:

```json
{
  "t": "ready"
}
```

- In **auto-ready mode** (default), the `ready` signal is sent automatically upon receiving the first `meta`.
- In **manual-ready mode**, the receiver can inspect the metadata (preview) before deciding whether to accept. The consumer calls a provided `sendReady()` function to proceed.

---

## 8. Data Transfer

### 8.1 Chunk Size

The default DGDTP chunk size is **65,536 bytes** (64 KiB). This is deliberately smaller than DGUP's 5 MiB chunks because:

- Smaller chunks reduce end-to-end latency.
- They enable finer-grained flow control over a real-time data channel.
- They minimise retransmission overhead if a chunk is lost.

### 8.2 Chunk Message

Each chunk is sent as two consecutive data channel messages:

**1. Header (JSON):**

```json
{
  "t": "chunk",
  "seq": 0,
  "offset": 0,
  "size": 65536,
  "total": 1048576
}
```

**2. Payload (ArrayBuffer):**

The raw binary data for this chunk.

### 8.3 Chunk Acknowledgement

The receiver sends an acknowledgement after processing each chunk:

```json
{
  "t": "chunk_ack",
  "seq": 0,
  "received": 65536
}
```

- `seq` echoes the sequence number of the acknowledged chunk.
- `received` indicates cumulative bytes received for the current transfer.

### 8.4 Sequence Enforcement

The receiver enforces strict sequential ordering. If a chunk arrives out of order:

```
Chunk sequence error: expected 5, got 7
```

The connection is terminated. WebRTC data channels configured in reliable mode guarantee ordering, so out-of-order delivery indicates a protocol violation.

### 8.5 Size Validation

- The payload size MUST match the declared `size` field.
- The cumulative received bytes MUST NOT exceed the declared `total`.

Violations result in immediate connection termination.

---

## 9. Flow Control

DGDTP implements multi-layered flow control to prevent fast senders from overwhelming slow receivers.

### 9.1 Chunk Acknowledgement Back-pressure

| Parameter | Default |
|-----------|---------|
| Maximum unacknowledged chunks | 64 |
| Unacknowledged chunk timeout | 60,000 ms |

The sender maintains a map of unacknowledged chunks. When the number of unacknowledged chunks reaches the maximum, the sender pauses until acknowledgements are received. If no acknowledgement arrives within 60 seconds, the transfer is aborted.

### 9.2 Data Channel Buffer Monitoring

| Parameter | Default |
|-----------|---------|
| Buffer high water mark | 8 MiB |
| Buffer low water mark | 2 MiB |

The sender monitors the RTCDataChannel's `bufferedAmount` property. When `bufferedAmount` exceeds the high water mark, the sender waits for the `bufferedamountlow` event (with a 60 ms fallback timeout) before sending the next chunk. The `bufferedAmountLowThreshold` is set to the low water mark.

### 9.3 Write Queue Depth Limiting

The receiver enforces a maximum write queue depth of **100 entries**. If the queue exceeds this limit, the transfer is aborted with:

```
Write queue overflow — receiver cannot keep up
```

This prevents unbounded memory consumption when the receiver's storage I/O is slower than the network throughput.

---

## 10. Multi-File Transfers (v3)

Protocol version 3 introduced native multi-file transfer support.

### 10.1 Sequence

```
Sender                                      Receiver
  │                                           │
  │  hello                                    │
  │──────────────────────────────────────────►│
  │◄──────────────────────────────────────────│
  │                                     hello │
  │                                           │
  │  file_list                                │
  │──────────────────────────────────────────►│
  │                                           │
  │  meta (fileIndex: 0)                      │
  │──────────────────────────────────────────►│
  │◄──────────────────────────────────────────│
  │                                     ready │
  │                                           │
  │  chunk [×N]                               │
  │──────────────────────────────────────────►│
  │◄──────────────────────────────────────────│
  │                               chunk_ack[] │
  │                                           │
  │  file_end (fileIndex: 0)                  │
  │──────────────────────────────────────────►│
  │◄──────────────────────────────────────────│
  │                   file_end_ack (index: 0) │
  │                                           │
  │  meta (fileIndex: 1)                      │
  │──────────────────────────────────────────►│
  │                                           │
  │  chunk [×M]                               │
  │──────────────────────────────────────────►│
  │◄──────────────────────────────────────────│
  │                               chunk_ack[] │
  │                                           │
  │  file_end (fileIndex: 1)                  │
  │──────────────────────────────────────────►│
  │◄──────────────────────────────────────────│
  │                   file_end_ack (index: 1) │
  │                                           │
  │  end                                      │
  │──────────────────────────────────────────►│
  │◄──────────────────────────────────────────│
  │                                   end_ack │
  │                                           │
```

### 10.2 File End Signalling

```json
{ "t": "file_end", "fileIndex": 0, "attempt": 0 }
```

The sender signals that all chunks for the current file have been transmitted. The receiver flushes its write queue and responds:

```json
{ "t": "file_end_ack", "fileIndex": 0, "received": 1048576, "size": 1048576 }
```

Only after receiving the `file_end_ack` does the sender proceed to the next file.

### 10.3 Browser-Side ZIP Streaming

When a multi-file transfer is received in a browser, the Web UI creates a streaming ZIP archive. Each file's chunks are piped through a `StreamingZipWriter` and ultimately saved as a single `.zip` download.

---

## 11. Transfer Completion

### 11.1 End Message

Once all files have been transferred, the sender transmits:

```json
{ "t": "end", "attempt": 0 }
```

### 11.2 End Acknowledgement

The receiver validates that all expected bytes have been received and responds:

```json
{ "t": "end_ack", "received": 3146240, "total": 3146240 }
```

### 11.3 Retry Logic

The `end` message is critical — if it is lost, the receiver will never know the transfer is complete. The sender therefore retries:

| Parameter | Default |
|-----------|---------|
| Maximum retries | 3 |
| Base timeout | 15,000 ms |
| Back-off multiplier | 1.5× |

- Attempt 0: wait 15 s.
- Attempt 1: wait 22.5 s.
- Attempt 2: wait 33.75 s.

The receiver sends multiple `end_ack` messages for reliability — an immediate response plus 2 additional retransmissions at **100 ms** intervals.

### 11.4 Validation

The sender validates: `end_ack.received >= total`. If the receiver reports fewer bytes than expected, the sender treats the transfer as failed.

### 11.5 Grace Period

After successful completion, both peers wait **2 seconds** before closing the connection. This grace period allows any in-flight acknowledgements to be processed.

---

## 12. Heartbeat and Watchdog

### 12.1 Heartbeat (Sender)

The sender emits periodic pings to prevent idle-timeout disconnections:

```json
{ "t": "ping", "timestamp": 1706200000000 }
```

The receiver auto-responds:

```json
{ "t": "pong", "timestamp": 1706200000000 }
```

| Parameter | Default |
|-----------|---------|
| Interval | 5,000 ms |

The heartbeat is active during the `transferring`, `finishing`, and `awaiting_ack` states. Setting the interval to 0 disables it.

### 12.2 Watchdog (Receiver)

The receiver runs a watchdog timer that detects stalled senders:

| Parameter | Default |
|-----------|---------|
| Timeout | 30,000 ms |

**Critically**, the watchdog resets **only on receipt of binary data** (actual file chunks), not on control messages such as `ping`. This prevents a malicious sender from keeping the connection alive with heartbeats alone whilst never delivering file data.

If the watchdog fires, the transfer is aborted.

---

## 13. Connection Health Monitoring

### 13.1 Health Event

Clients may optionally monitor connection health via periodic callbacks:

```json
{
  "iceConnectionState": "connected",
  "bufferedAmount": 65536,
  "lastActivityMs": 200
}
```

Health checks run every **2 seconds** and report:

- The ICE connection state.
- The data channel's buffered byte count.
- Milliseconds since last activity.

### 13.2 Uses

- Display connection quality indicators in the UI.
- Detect degrading connections before the watchdog fires.
- Monitor buffer build-up indicative of network congestion.

---

## 14. Cancellation

### 14.1 Sender Cancellation

The sender transmits:

```json
{ "t": "cancelled", "reason": "Sender cancelled the transfer." }
```

The session transitions to `cancelled` → `closed`. All timers are cleared and the connection is destroyed.

### 14.2 Receiver Cancellation

The receiver transmits:

```json
{ "t": "cancelled", "reason": "Receiver cancelled the transfer." }
```

Both peers receive an `onCancel` callback with:

```json
{ "cancelledBy": "sender" | "receiver", "message": "..." }
```

### 14.3 Browser Navigation

The Web UI registers a `beforeunload` handler to warn users before navigating away during an active transfer. Navigation triggers implicit cancellation.

---

## 15. Resume Support

DGDTP defines resume messages for interrupted transfers, though full implementation is session-scoped (reconnection within the same P2P code session).

### 15.1 Resume Request (Receiver)

```json
{ "t": "resume", "sessionId": "<uuid>", "receivedBytes": 524288 }
```

### 15.2 Resume Acknowledgement (Sender)

```json
{ "t": "resume_ack", "resumeFromOffset": 524288, "accepted": true }
```

The sender validates the resume request via an `onResumeRequest` callback, which returns a boolean. If accepted, the sender skips to the indicated byte offset and resumes chunk transmission.

---

## 16. State Machines

### 16.1 Sender States

```
initializing ──► listening ──► handshaking ──► negotiating ──► transferring
                     │              │              │                │
                     ▼              ▼              ▼                ▼
                  closed         closed         closed          finishing
                  cancelled      cancelled      cancelled          │
                                                                   ▼
                                                             awaiting_ack
                                                                   │
                                                                   ▼
                                                              completed
                                                                   │
                                                                   ▼
                                                                closed
```

### 16.2 Receiver States

```
initializing ──► connecting ──► handshaking ──► negotiating ──► transferring
                      │              │              │                │
                      ▼              ▼              ▼                ▼
                   closed         closed         closed         completed
                   cancelled      cancelled      cancelled          │
                                                                    ▼
                                                                 closed
```

Invalid state transitions are logged as warnings but do not throw exceptions, preventing cascading failures during error recovery.

---

## 17. Error Model

### 17.1 Error Message

```json
{ "t": "error", "message": "Human-readable description", "code": "OPTIONAL_CODE" }
```

### 17.2 Error Propagation

When one peer encounters an error, it transmits an `error` message to the other peer before closing the connection. Both peers invoke their `onError` callbacks.

### 17.3 Error Classes

| Class | Meaning |
|-------|---------|
| `DropgateValidationError` | Invalid input: malformed code, unexpected sequence number, size mismatch. |
| `DropgateNetworkError` | Connection failure, stalled acknowledgements, write queue overflow. |
| `DropgateProtocolError` | Signalling error, PeerJS failure. |
| `DropgateAbortError` | User-initiated cancellation. |
| `DropgateTimeoutError` | Handshake timeout, end-ack timeout. |

---

## 18. Security Considerations

### 18.1 Transport Encryption

WebRTC data channels are encrypted via **DTLS** (Datagram Transport Layer Security). This is handled transparently by the browser's WebRTC implementation. All data in transit between peers — including DGDTP messages and file content — is encrypted.

DGDTP does **not** implement an additional application-layer encryption scheme. The rationale is that DTLS already provides confidentiality and integrity for the data channel. Adding a second encryption layer would impose a performance cost without meaningful security benefit, given that both peers must already trust the WebRTC implementation.

### 18.2 Session ID Tracking

The `sessionId` from the initial `meta` message is stored by the receiver. Subsequent `meta` messages (in multi-file transfers) MUST carry the same `sessionId`. A mismatch indicates a possible session hijacking attempt and causes immediate termination.

### 18.3 Binary Data State Gating

The receiver only accepts binary data (file chunks) when in the `transferring` state. Binary data received in any other state is rejected.

This prevents pre-transfer data injection attacks.

### 18.4 Connection Rate Limiting

A sliding-window rate limit (10 attempts per 10 seconds) protects the sender from connection-flooding attacks.

### 18.5 Write Queue Depth Limiting

The receiver's write queue is capped at 100 entries. This prevents a malicious or buggy sender from causing unbounded memory allocation on the receiver.

### 18.6 Watchdog Data-Only Reset

The receiver's watchdog timer resets only on actual binary data, not on `ping`/`pong` messages. A sender cannot keep a connection alive indefinitely by sending heartbeats without delivering file data.

### 18.7 ICE Candidate Exposure

During WebRTC connection establishment, ICE candidates are exchanged via the signalling server. These candidates contain IP addresses and port numbers of both peers. In environments where IP privacy is critical:

- **Use a VPN** to mask real IP addresses. Select a VPN provider that supports peer-to-peer traffic so that the WebRTC data channel can be established through the VPN tunnel. Research providers carefully, paying attention to their logging policies, jurisdiction, and track record.
- Be aware that STUN servers receive requests from both peers' IP addresses during the ICE gathering phase.

### 18.8 Code Brute-Force Resistance

With ~3.3 billion possible codes and active codes existing only for the duration of a transfer, brute-force guessing is impractical under the connection rate limit (10 attempts per 10 seconds per sender). However, server operators SHOULD monitor for distributed scanning patterns.

---

## 19. Configuration Reference

### 19.1 Server Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_P2P` | `true` | Enable or disable DGDTP. |
| `P2P_STUN_SERVERS` | `stun:stun.cloudflare.com:3478` | Comma-separated list of STUN server URLs. |
| `PEERJS_DEBUG` | `false` | Enable PeerJS debug logging. |

### 19.2 Client Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `chunkSize` | 65,536 (64 KiB) | Size of each data chunk. |
| `maxAttempts` | 4 | Code registration retries. |
| `endAckTimeoutMs` | 15,000 | Base timeout for end acknowledgement. |
| `bufferHighWaterMark` | 8,388,608 (8 MiB) | Pause sending above this buffer level. |
| `bufferLowWaterMark` | 2,097,152 (2 MiB) | Resume sending below this buffer level. |
| `heartbeatIntervalMs` | 5,000 | Ping interval (0 = disabled). |
| `chunkAcknowledgments` | `true` | Enable chunk-level acks. |
| `maxUnackedChunks` | 64 | Back-pressure threshold. |
| `watchdogTimeoutMs` | 30,000 | Receiver stall detection timeout. |
| `autoReady` | `true` | Auto-accept transfers on metadata receipt. |

---

## 20. Protocol Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `P2P_PROTOCOL_VERSION` | 3 | Current protocol version. |
| `P2P_CHUNK_SIZE` | 65,536 | Default chunk size (bytes). |
| `P2P_MAX_UNACKED_CHUNKS` | 64 | Flow control threshold. |
| `P2P_END_ACK_TIMEOUT_MS` | 15,000 | End-ack base timeout. |
| `P2P_END_ACK_RETRIES` | 3 | End message retry count. |
| `P2P_END_ACK_RETRY_DELAY_MS` | 100 | Delay between redundant end-acks. |
| `P2P_CLOSE_GRACE_PERIOD_MS` | 2,000 | Delay before closing after completion. |
| `P2P_UNACKED_CHUNK_TIMEOUT_MS` | 60,000 | Stale ack detection. |
| `MAX_FILE_COUNT` | 10,000 | Maximum files in a multi-file transfer. |
| `MAX_CONNECTION_ATTEMPTS` | 10 | Connection rate limit. |
| `CONNECTION_RATE_WINDOW_MS` | 10,000 | Rate limit sliding window. |
| `MAX_WRITE_QUEUE_DEPTH` | 100 | Receiver memory protection. |

---

## 21. Message Type Reference

| Type | Direction | State(s) | Purpose |
|------|-----------|----------|---------|
| `hello` | Both | handshaking | Protocol version and session negotiation. |
| `file_list` | Sender → Receiver | handshaking | Multi-file manifest (v3). |
| `meta` | Sender → Receiver | negotiating | File name, size, MIME type. |
| `ready` | Receiver → Sender | negotiating | Acceptance signal. |
| `chunk` | Sender → Receiver | transferring | Chunk header (followed by binary). |
| `chunk_ack` | Receiver → Sender | transferring | Per-chunk acknowledgement. |
| `file_end` | Sender → Receiver | transferring | Current file complete (v3 multi-file). |
| `file_end_ack` | Receiver → Sender | transferring | Current file receipt confirmed (v3). |
| `end` | Sender → Receiver | finishing | All data transmitted. |
| `end_ack` | Receiver → Sender | awaiting_ack | Transfer verified complete. |
| `ping` | Sender → Receiver | transferring+ | Keepalive. |
| `pong` | Receiver → Sender | transferring+ | Keepalive response. |
| `error` | Both | Any | Error notification. |
| `cancelled` | Both | Any | Cancellation notification. |
| `resume` | Receiver → Sender | handshaking | Resume request. |
| `resume_ack` | Sender → Receiver | handshaking | Resume response. |

---

## 22. Best Practices

### 22.1 Server Deployment

- **Deploy the Dropgate Server/signalling server behind HTTPS.** WebRTC requires a secure context in all modern browsers. The PeerJS server MUST be accessed via HTTPS (or `localhost` for development).
- **Configure appropriate STUN servers.** The default Cloudflare STUN server is suitable for most deployments. For privacy-sensitive applications, consider self-hosting a STUN server or using a VPN to mask IP addresses.
- **Do not enable `PEERJS_DEBUG` in production.** Debug logging may expose ICE candidates (IP addresses) and connection metadata in server logs.
- **Monitor connection patterns.** Unusual rates of peer registrations or connection attempts may indicate scanning or abuse.

### 22.2 Client Behaviour

- **Keep chunk acknowledgements enabled.** Disabling them removes flow control and can cause buffer overflows on slow receivers.
- **Set appropriate buffer water marks.** The defaults (8 MiB high / 2 MiB low) are tuned for typical broadband connections. Constrained environments may benefit from lower values.
- **Implement `onConnectionHealth` monitoring** for user-facing applications. This allows early detection of degrading connections.
- **Respect the watchdog.** If the receiver's watchdog fires, the connection has genuinely stalled. Do not simply increase the timeout to mask underlying network problems.

### 22.3 Network Privacy

- **Use a VPN for sensitive P2P transfers.** ICE candidates expose real IP addresses to the signalling server and (briefly) to the peer. A VPN that supports peer-to-peer traffic masks the sender's and receiver's true network locations. Research VPN providers carefully — audit their logging policies, jurisdiction, and technical architecture before relying on them for privacy-critical transfers.
- **Be aware of STUN server visibility.** STUN servers receive ICE binding requests containing the peer's IP address. Self-hosted STUN servers eliminate third-party visibility.
- **Consider network topology.** In corporate or institutional environments, WebRTC traffic may be blocked or inspected.

---

## 23. Single-File Transfer Flow Summary

```
Sender                                      Receiver
  │                                           │
  │  [PeerJS signalling: SDP + ICE]           │
  │◄═════════════════════════════════════════►│
  │                                           │
  │  hello { v3, sessionId }                  │
  │──────────────────────────────────────────►│
  │◄──────────────────────────────────────────│
  │  hello { v3, sessionId }                  │
  │                                           │
  │  meta { name, size, mime }                │
  │──────────────────────────────────────────►│
  │◄──────────────────────────────────────────│
  │  ready                                    │
  │                                           │
  │  chunk { seq:0 } + [binary]               │
  │──────────────────────────────────────────►│
  │◄──────────────────────────────────────────│
  │  chunk_ack { seq:0, received }            │
  │                                           │
  │  ...repeated for all chunks...            │
  │                                           │
  │  end { attempt:0 }                        │
  │──────────────────────────────────────────►│
  │◄──────────────────────────────────────────│
  │  end_ack { received, total }              │
  │                                           │
  │  [2s grace period]                        │
  │  [connection closed]                      │
```
