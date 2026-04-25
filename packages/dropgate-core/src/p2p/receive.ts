import { DropgateValidationError, DropgateNetworkError } from '../errors.js';
import { sleep } from '../utils/network.js';
import type { P2PReceiveOptions, P2PReceiveSession, P2PReceiveState, DataConnection } from './types.js';
import { isP2PCodeLike } from './utils.js';
import { buildPeerOptions, resolvePeerConfig } from './helpers.js';
import {
  P2P_PROTOCOL_VERSION,
  P2P_END_ACK_RETRY_DELAY_MS,
  isP2PMessage,
  type P2PChunkMessage,
  type P2PFileListMessage,
} from './protocol.js';

/**
 * Allowed state transitions to prevent invalid state changes.
 */
const ALLOWED_TRANSITIONS: Record<P2PReceiveState, P2PReceiveState[]> = {
  initializing: ['connecting', 'closed'],
  connecting: ['handshaking', 'closed', 'cancelled'],
  handshaking: ['negotiating', 'closed', 'cancelled'],
  negotiating: ['transferring', 'closed', 'cancelled'],
  transferring: ['completed', 'closed', 'cancelled'],
  completed: ['closed'],
  cancelled: ['closed'],
  closed: [],
};

/**
 * Start a direct transfer (P2P) receiver session.
 *
 * IMPORTANT: Consumer must provide the PeerJS Peer constructor and handle file writing.
 * This removes DOM coupling (no streamSaver).
 *
 * Protocol v2 features:
 * - Explicit version handshake
 * - Chunk-level acknowledgments for flow control
 * - Multiple end-ack sends for reliability
 * - Stream-through design for unlimited file sizes
 *
 * Example:
 * ```js
 * import Peer from 'peerjs';
 * import { startP2PReceive } from '@dropgate/core/p2p';
 *
 * let writer;
 * const session = await startP2PReceive({
 *   code: 'ABCD-1234',
 *   Peer,
 *   host: 'dropgate.link',
 *   secure: true,
 *   onMeta: ({ name, total }) => {
 *     // Consumer creates file writer
 *     writer = createWriteStream(name);
 *   },
 *   onData: async (chunk) => {
 *     // Consumer writes data
 *     await writer.write(chunk);
 *   },
 *   onComplete: () => {
 *     writer.close();
 *     console.log('Done!');
 *   },
 * });
 * ```
 */
export async function startP2PReceive(opts: P2PReceiveOptions): Promise<P2PReceiveSession> {
  const {
    code,
    Peer,
    serverInfo,
    host,
    port,
    peerjsPath,
    secure = false,
    iceServers,
    autoReady = true,
    watchdogTimeoutMs = 30000,
    onStatus,
    onMeta,
    onData,
    onProgress,
    onFileStart,
    onFileEnd,
    onComplete,
    onError,
    onDisconnect,
    onCancel,
  } = opts;

  // Validate required options
  if (!code) {
    throw new DropgateValidationError('No sharing code was provided.');
  }

  if (!Peer) {
    throw new DropgateValidationError(
      'PeerJS Peer constructor is required. Install peerjs and pass it as the Peer option.'
    );
  }

  // Check P2P capabilities if serverInfo is provided
  const p2pCaps = serverInfo?.capabilities?.p2p;
  if (serverInfo && !p2pCaps?.enabled) {
    throw new DropgateValidationError('Direct transfer is disabled on this server.');
  }

  // Validate and normalize code
  const normalizedCode = String(code).trim().replace(/\s+/g, '').toUpperCase();
  if (!isP2PCodeLike(normalizedCode)) {
    throw new DropgateValidationError('Invalid direct transfer code.');
  }

  // Resolve config from user options and server capabilities
  const { path: finalPath, iceServers: finalIceServers } = resolvePeerConfig(
    { peerjsPath, iceServers },
    p2pCaps
  );

  // Build peer options
  const peerOpts = buildPeerOptions({
    host,
    port,
    peerjsPath: finalPath,
    secure,
    iceServers: finalIceServers,
  });

  // Create peer (receiver doesn't need a specific ID)
  const peer = new Peer(undefined, peerOpts);

  // State machine - replaces boolean flags to prevent race conditions
  let state: P2PReceiveState = 'initializing';
  let total = 0;
  let received = 0;
  let currentSessionId: string | null = null;
  let writeQueue = Promise.resolve();
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  let activeConn: DataConnection | null = null;

  let pendingChunk: P2PChunkMessage | null = null;

  // Multi-file tracking (v3)
  let fileList: P2PFileListMessage | null = null;
  let currentFileReceived = 0;
  let totalReceivedAllFiles = 0;

  // Security: Chunk sequence validation
  let expectedChunkSeq = 0;

  // Security: Write queue depth limiting to prevent memory exhaustion
  let writeQueueDepth = 0;
  const MAX_WRITE_QUEUE_DEPTH = 100;

  // Security: Maximum file count for multi-file transfers
  const MAX_FILE_COUNT = 10000;

  /**
   * Attempt a state transition. Returns true if transition was valid.
   */
  const transitionTo = (newState: P2PReceiveState): boolean => {
    if (!ALLOWED_TRANSITIONS[state].includes(newState)) {
      console.warn(`[P2P Receive] Invalid state transition: ${state} -> ${newState}`);
      return false;
    }
    state = newState;
    return true;
  };

  // Helper to check if session is stopped
  const isStopped = (): boolean => state === 'closed' || state === 'cancelled';

  // Watchdog - detects dead connections during transfer
  const resetWatchdog = (): void => {
    if (watchdogTimeoutMs <= 0) return;

    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
    }

    watchdogTimer = setTimeout(() => {
      if (state === 'transferring') {
        safeError(new DropgateNetworkError('Connection timed out (no data received).'));
      }
    }, watchdogTimeoutMs);
  };

  const clearWatchdog = (): void => {
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  };

  // Safe error handler - prevents calling onError after completion or cancellation
  const safeError = (err: Error): void => {
    if (state === 'closed' || state === 'completed' || state === 'cancelled') return;
    transitionTo('closed');
    onError?.(err);
    cleanup();
  };

  // Safe complete handler - only fires from transferring state
  const safeComplete = (completeData: { received: number; total: number }): void => {
    if (state !== 'transferring') return;
    transitionTo('completed');
    onComplete?.(completeData);
    // Don't immediately cleanup - let acks be sent first
    // The sender will close the connection after receiving ack
    // Our close handler will call cleanup when that happens
  };

  // Cleanup all resources
  const cleanup = (): void => {
    clearWatchdog();

    // Remove beforeunload listener if in browser
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', handleUnload);
    }

    try {
      peer.destroy();
    } catch {
      // Ignore destroy errors
    }
  };

  // Handle browser tab close/refresh
  const handleUnload = (): void => {
    try {
      activeConn?.send({ t: 'error', message: 'Receiver closed the connection.' });
    } catch {
      // Best effort
    }
    stop();
  };

  // Add beforeunload listener if in browser
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', handleUnload);
  }

  const stop = (): void => {
    if (state === 'closed' || state === 'cancelled') return;

    // If already completed, just cleanup without callbacks
    if (state === 'completed') {
      cleanup();
      return;
    }

    const wasActive = state === 'transferring';
    transitionTo('cancelled');

    // Notify peer before cleanup
    try {
      // @ts-expect-error - open property may exist on PeerJS connections
      if (activeConn && activeConn.open) {
        activeConn.send({ t: 'cancelled', reason: 'Receiver cancelled the transfer.' });
      }
    } catch {
      // Best effort
    }

    if (wasActive && onCancel) {
      onCancel({ cancelledBy: 'receiver' });
    }

    cleanup();
  };

  // Send chunk acknowledgment
  const sendChunkAck = (conn: DataConnection, seq: number): void => {
    try {
      conn.send({ t: 'chunk_ack', seq, received });
    } catch {
      // Ignore send errors
    }
  };

  peer.on('error', (err: Error) => {
    safeError(err);
  });

  peer.on('open', () => {
    transitionTo('connecting');
    const conn = peer.connect(normalizedCode, { reliable: true });
    activeConn = conn;

    conn.on('open', () => {
      transitionTo('handshaking');
      onStatus?.({ phase: 'connected', message: 'Connected.' });

      // Send our hello immediately
      conn.send({
        t: 'hello',
        protocolVersion: P2P_PROTOCOL_VERSION,
        sessionId: '',
      });
    });

    conn.on('data', async (data: unknown) => {
      try {
        // Note: Watchdog is reset only on actual binary data, not control messages
        // This prevents attackers from keeping connections alive with just pings

        // Handle binary data - this is file content
        if (data instanceof ArrayBuffer || ArrayBuffer.isView(data) ||
          (typeof Blob !== 'undefined' && data instanceof Blob)) {

          // CRITICAL SECURITY: Only accept binary data if we're in 'transferring' state
          // This ensures the receiver has:
          // 1. Received file metadata (meta message)
          // 2. Consented to receive (sent 'ready' signal)
          // Without this check, a malicious sender could force data onto the receiver
          if (state !== 'transferring') {
            throw new DropgateValidationError(
              'Received binary data before transfer was accepted. Possible malicious sender.'
            );
          }

          // Security: Only reset watchdog on actual binary data (prevents keep-alive attacks)
          resetWatchdog();

          // Security: Check write queue depth to prevent memory exhaustion
          if (writeQueueDepth >= MAX_WRITE_QUEUE_DEPTH) {
            throw new DropgateNetworkError('Write queue overflow - receiver cannot keep up');
          }

          // Process the binary chunk
          let bufPromise: Promise<Uint8Array>;

          if (data instanceof ArrayBuffer) {
            bufPromise = Promise.resolve(new Uint8Array(data));
          } else if (ArrayBuffer.isView(data)) {
            bufPromise = Promise.resolve(
              new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            );
          } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
            bufPromise = data.arrayBuffer().then((buffer) => new Uint8Array(buffer));
          } else {
            return;
          }

          // Queue the write operation
          const chunkSeq = pendingChunk?.seq ?? -1;
          const expectedSize = pendingChunk?.size;
          pendingChunk = null;

          writeQueueDepth++;
          writeQueue = writeQueue
            .then(async () => {
              const buf = await bufPromise;

              // Security: Validate chunk size matches declared size
              if (expectedSize !== undefined && buf.byteLength !== expectedSize) {
                throw new DropgateValidationError(
                  `Chunk size mismatch: expected ${expectedSize}, got ${buf.byteLength}`
                );
              }

              // Security: Validate we don't receive more than declared total
              const newReceived = received + buf.byteLength;
              if (total > 0 && newReceived > total) {
                throw new DropgateValidationError(
                  `Received more data than expected: ${newReceived} > ${total}`
                );
              }

              // Call consumer's onData handler (stream-through, no buffering)
              if (onData) {
                await onData(buf);
              }

              received += buf.byteLength;
              currentFileReceived += buf.byteLength;
              const progressReceived = fileList ? (totalReceivedAllFiles + currentFileReceived) : received;
              const progressTotal = fileList ? fileList.totalSize : total;
              const percent = progressTotal ? Math.min(100, (progressReceived / progressTotal) * 100) : 0;
              if (!isStopped()) onProgress?.({ processedBytes: progressReceived, totalBytes: progressTotal, percent });

              // Send chunk acknowledgment
              if (chunkSeq >= 0) {
                sendChunkAck(conn, chunkSeq);
              }
            })
            .catch((err) => {
              try {
                conn.send({
                  t: 'error',
                  message: (err as Error)?.message || 'Receiver write failed.',
                });
              } catch {
                // Ignore send errors
              }
              safeError(err as Error);
            })
            .finally(() => {
              writeQueueDepth--;
            });

          return;
        }

        // Handle control messages
        if (!isP2PMessage(data)) return;

        const msg = data;

        switch (msg.t) {
          case 'hello':
            currentSessionId = msg.sessionId || null;
            transitionTo('negotiating');
            onStatus?.({ phase: 'waiting', message: 'Waiting for file details...' });
            break;

          case 'file_list': {
            // v3: Store file list for multi-file transfer
            const fileListMsg = msg as P2PFileListMessage;

            // Security: Validate file count
            if (fileListMsg.fileCount > MAX_FILE_COUNT) {
              throw new DropgateValidationError(`Too many files: ${fileListMsg.fileCount}`);
            }

            // Security: Validate total size matches sum of file sizes
            const sumSize = fileListMsg.files.reduce((sum, f) => sum + f.size, 0);
            if (sumSize !== fileListMsg.totalSize) {
              throw new DropgateValidationError(
                `File list size mismatch: declared ${fileListMsg.totalSize}, actual sum ${sumSize}`
              );
            }

            fileList = fileListMsg;
            total = fileListMsg.totalSize;
            break;
          }

          case 'meta': {
            // For multi-file: meta comes for each file (first triggers ready, subsequent auto-transition)
            if (state !== 'negotiating' && !(state === 'transferring' && fileList)) {
              return;
            }

            // Session ID validation - reject if we're busy with a different session
            if (currentSessionId && msg.sessionId && msg.sessionId !== currentSessionId) {
              try {
                conn.send({ t: 'error', message: 'Busy with another session.' });
              } catch {
                // Ignore send errors
              }
              return;
            }

            // Store the session ID for this transfer
            if (msg.sessionId) {
              currentSessionId = msg.sessionId;
            }

            const name = String(msg.name || 'file');
            const fileSize = Number(msg.size) || 0;
            const fi = msg.fileIndex;

            // For multi-file subsequent files, reset per-file tracking
            if (fileList && typeof fi === 'number' && fi > 0) {
              currentFileReceived = 0;
              // Don't reset writeQueue or received - they accumulate
              onFileStart?.({ fileIndex: fi, name, size: fileSize });
              break; // Already transferring, no need for ready signal
            }

            // First file (or single file transfer)
            received = 0;
            currentFileReceived = 0;
            totalReceivedAllFiles = 0;
            if (!fileList) {
              total = fileSize;
            }
            writeQueue = Promise.resolve();

            // Function to send ready signal
            const sendReady = (): void => {
              transitionTo('transferring');
              // Start watchdog once we're ready to receive data
              resetWatchdog();
              // Notify consumer about first file start (for multi-file ZIP assembly)
              if (fileList) {
                onFileStart?.({ fileIndex: 0, name, size: fileSize });
              }
              try {
                conn.send({ t: 'ready' });
              } catch {
                // Ignore send errors
              }
            };

            // Build metadata event
            const metaEvt: Parameters<NonNullable<typeof onMeta>>[0] = { name, total };
            if (fileList) {
              metaEvt.fileCount = fileList.fileCount;
              metaEvt.files = fileList.files.map(f => ({ name: f.name, size: f.size }));
              metaEvt.totalSize = fileList.totalSize;
            }

            if (autoReady) {
              if (!isStopped()) {
                onMeta?.(metaEvt);
                onProgress?.({ processedBytes: received, totalBytes: total, percent: 0 });
              }
              sendReady();
            } else {
              // Pass sendReady function to callback so consumer can trigger transfer start
              metaEvt.sendReady = sendReady;
              if (!isStopped()) {
                onMeta?.(metaEvt);
                onProgress?.({ processedBytes: received, totalBytes: total, percent: 0 });
              }
            }
            break;
          }

          case 'chunk': {
            const chunkMsg = msg as P2PChunkMessage;

            // Security: Only accept chunk messages if we're in 'transferring' state
            if (state !== 'transferring') {
              throw new DropgateValidationError(
                'Received chunk message before transfer was accepted.'
              );
            }

            // Security: Validate chunk sequence (must be in order)
            if (chunkMsg.seq !== expectedChunkSeq) {
              throw new DropgateValidationError(
                `Chunk sequence error: expected ${expectedChunkSeq}, got ${chunkMsg.seq}`
              );
            }
            expectedChunkSeq++;

            pendingChunk = chunkMsg;
            break;
          }

          case 'ping':
            // Respond to heartbeat - keeps watchdog alive and confirms we're active
            try {
              conn.send({ t: 'pong', timestamp: Date.now() });
            } catch {
              // Ignore send errors
            }
            break;

          case 'file_end': {
            // v3: Current file complete, ack it
            clearWatchdog();
            await writeQueue;

            const feIdx = msg.fileIndex;
            onFileEnd?.({ fileIndex: feIdx, receivedBytes: currentFileReceived });

            try {
              conn.send({ t: 'file_end_ack', fileIndex: feIdx, received: currentFileReceived, size: currentFileReceived });
            } catch {
              // Ignore send errors
            }

            totalReceivedAllFiles += currentFileReceived;
            currentFileReceived = 0;

            // Restart watchdog for next file
            resetWatchdog();
            break;
          }

          case 'end':
            clearWatchdog();
            await writeQueue;

            // For multi-file, use totalReceivedAllFiles + any remaining
            const finalReceived = fileList ? (totalReceivedAllFiles + currentFileReceived) : received;
            const finalTotal = fileList ? fileList.totalSize : total;

            if (finalTotal && finalReceived < finalTotal) {
              const err = new DropgateNetworkError(
                'Transfer ended before all data was received.'
              );
              try {
                conn.send({ t: 'error', message: err.message });
              } catch {
                // Ignore send errors
              }
              throw err;
            }

            // Send end_ack immediately so sender can complete
            try {
              conn.send({ t: 'end_ack', received: finalReceived, total: finalTotal });
            } catch {
              // Ignore send errors
            }

            // Mark as completed - protects against close handler race
            safeComplete({ received: finalReceived, total: finalTotal });

            // Send additional acks for reliability (fire-and-forget, best effort)
            (async () => {
              for (let i = 0; i < 2; i++) {
                await sleep(P2P_END_ACK_RETRY_DELAY_MS);
                try {
                  conn.send({ t: 'end_ack', received: finalReceived, total: finalTotal });
                } catch {
                  break; // Connection closed
                }
              }
            })().catch(() => { });
            break;

          case 'error':
            throw new DropgateNetworkError(msg.message || 'Sender reported an error.');

          case 'cancelled':
            if (state === 'cancelled' || state === 'closed' || state === 'completed') return;
            transitionTo('cancelled');
            onCancel?.({ cancelledBy: 'sender', message: msg.reason });
            cleanup();
            break;
        }
      } catch (err) {
        safeError(err as Error);
      }
    });

    conn.on('close', () => {
      if (state === 'closed' || state === 'completed' || state === 'cancelled') {
        // Clean shutdown or already cancelled, ensure full cleanup
        cleanup();
        return;
      }

      // Sender disconnected or cancelled before transfer completed
      if (state === 'transferring') {
        // Connection closed during active transfer — the sender either cancelled
        // or disconnected. Treat as a sender-initiated cancellation so the UI
        // can show a clean message instead of a raw error.
        transitionTo('cancelled');
        onCancel?.({ cancelledBy: 'sender' });
        cleanup();
      } else if (state === 'negotiating') {
        // We had metadata but transfer hadn't started
        transitionTo('closed');
        cleanup();
        onDisconnect?.();
      } else {
        // Disconnected before we even got file metadata
        safeError(new DropgateNetworkError('Sender disconnected before file details were received.'));
      }
    });
  });

  return {
    peer,
    stop,
    getStatus: () => state,
    getBytesReceived: () => received,
    getTotalBytes: () => total,
    getSessionId: () => currentSessionId,
  };
}
