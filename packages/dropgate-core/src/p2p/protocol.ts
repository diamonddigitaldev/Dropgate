/**
 * P2P Protocol Definitions
 *
 * This file defines the application-level protocol for P2P file transfers.
 * Protocol version 2 introduces:
 * - Explicit handshake with version negotiation
 * - Chunk-level acknowledgments for flow control
 * - Multiple end-ack retries for reliability
 * - Resume capability support
 *
 * Protocol version 3 introduces:
 * - Multi-file transfers via file_list, file_end, file_end_ack messages
 * - Sequential file-by-file transfer within a single session
 */

// Protocol version for forward compatibility
export const P2P_PROTOCOL_VERSION = 3;

/**
 * All possible P2P message types.
 */
export type P2PMessageType =
    | 'hello'        // Initial handshake with protocol version
    | 'file_list'    // v3: List of files in multi-file transfer
    | 'meta'         // File metadata (name, size, mime)
    | 'ready'        // Receiver is ready to receive
    | 'chunk'        // Data chunk with sequence number
    | 'chunk_ack'    // Chunk acknowledgment (for flow control)
    | 'file_end'     // v3: Current file fully sent
    | 'file_end_ack' // v3: Current file receipt confirmed
    | 'end'          // All chunks/files sent
    | 'end_ack'      // Transfer verified complete
    | 'ping'         // Heartbeat
    | 'pong'         // Heartbeat response
    | 'error'        // Error occurred
    | 'cancelled'    // User cancelled
    | 'resume'       // Request to resume from offset
    | 'resume_ack';  // Resume position confirmed

/**
 * Base interface for all P2P messages.
 */
export interface P2PMessageBase {
    t: P2PMessageType;
}

/**
 * Initial handshake message exchanged between sender and receiver.
 */
export interface P2PHelloMessage extends P2PMessageBase {
    t: 'hello';
    protocolVersion: number;
    sessionId: string;
}

/**
 * v3: File list sent by sender after handshake for multi-file transfers.
 */
export interface P2PFileListMessage extends P2PMessageBase {
    t: 'file_list';
    fileCount: number;
    files: Array<{ name: string; size: number; mime: string }>;
    totalSize: number;
}

/**
 * File metadata sent by sender after handshake (single file)
 * or before each file's chunks in multi-file mode.
 */
export interface P2PMetaMessage extends P2PMessageBase {
    t: 'meta';
    sessionId: string;
    name: string;
    size: number;
    mime: string;
    /** v3: File index within the file list (0-based). Absent for single-file transfers. */
    fileIndex?: number;
}

/**
 * Receiver signals readiness to receive data.
 */
export interface P2PReadyMessage extends P2PMessageBase {
    t: 'ready';
}

/**
 * Chunk header sent before binary data.
 * The actual binary data follows immediately after this message.
 */
export interface P2PChunkMessage extends P2PMessageBase {
    t: 'chunk';
    seq: number;     // Sequence number for ordering/ack
    offset: number;  // Byte offset in file
    size: number;    // Size of this chunk
    total: number;   // Total file size
}

/**
 * Acknowledgment for a received chunk.
 */
export interface P2PChunkAckMessage extends P2PMessageBase {
    t: 'chunk_ack';
    seq: number;       // Acknowledged sequence number
    received: number;  // Total bytes received so far
}

/**
 * v3: Sender signals all chunks for the current file have been sent.
 */
export interface P2PFileEndMessage extends P2PMessageBase {
    t: 'file_end';
    fileIndex: number;
    attempt?: number;
}

/**
 * v3: Receiver confirms current file receipt.
 */
export interface P2PFileEndAckMessage extends P2PMessageBase {
    t: 'file_end_ack';
    fileIndex: number;
    received: number;
    size: number;
}

/**
 * Sender signals all chunks have been sent.
 */
export interface P2PEndMessage extends P2PMessageBase {
    t: 'end';
    attempt?: number;  // Retry attempt number
}

/**
 * Receiver confirms transfer completion.
 */
export interface P2PEndAckMessage extends P2PMessageBase {
    t: 'end_ack';
    received: number;
    total: number;
}

/**
 * Heartbeat ping.
 */
export interface P2PPingMessage extends P2PMessageBase {
    t: 'ping';
    timestamp: number;
}

/**
 * Heartbeat pong response.
 */
export interface P2PPongMessage extends P2PMessageBase {
    t: 'pong';
    timestamp: number;
}

/**
 * Error message sent when something goes wrong.
 */
export interface P2PErrorMessage extends P2PMessageBase {
    t: 'error';
    message: string;
    code?: string;
}

/**
 * Cancellation message sent when user cancels transfer.
 */
export interface P2PCancelledMessage extends P2PMessageBase {
    t: 'cancelled';
    reason?: string;
}

/**
 * Resume request sent by receiver to continue interrupted transfer.
 */
export interface P2PResumeMessage extends P2PMessageBase {
    t: 'resume';
    sessionId: string;
    receivedBytes: number;
}

/**
 * Resume acknowledgment from sender.
 */
export interface P2PResumeAckMessage extends P2PMessageBase {
    t: 'resume_ack';
    resumeFromOffset: number;
    accepted: boolean;
}

/**
 * Union type of all possible P2P messages.
 */
export type P2PMessage =
    | P2PHelloMessage
    | P2PFileListMessage
    | P2PMetaMessage
    | P2PReadyMessage
    | P2PChunkMessage
    | P2PChunkAckMessage
    | P2PFileEndMessage
    | P2PFileEndAckMessage
    | P2PEndMessage
    | P2PEndAckMessage
    | P2PPingMessage
    | P2PPongMessage
    | P2PErrorMessage
    | P2PCancelledMessage
    | P2PResumeMessage
    | P2PResumeAckMessage;

/**
 * Type guard to check if a value is a valid P2P message.
 */
export function isP2PMessage(value: unknown): value is P2PMessage {
    if (!value || typeof value !== 'object') return false;
    const msg = value as Record<string, unknown>;
    return typeof msg.t === 'string' && [
        'hello', 'file_list', 'meta', 'ready', 'chunk', 'chunk_ack',
        'file_end', 'file_end_ack', 'end', 'end_ack', 'ping', 'pong',
        'error', 'cancelled', 'resume', 'resume_ack'
    ].includes(msg.t);
}

/**
 * Check if protocol versions are compatible.
 */
export function isProtocolCompatible(
    senderVersion: number,
    receiverVersion: number
): boolean {
    return senderVersion === receiverVersion;
}

/**
 * Default chunk size for P2P transfers (64KB).
 * Smaller than standard upload to reduce latency and improve flow control.
 */
export const P2P_CHUNK_SIZE = 64 * 1024;

/**
 * Default maximum unacknowledged chunks before sender pauses.
 * This creates backpressure when receiver is slow.
 *
 * Sized to leave comfortable head-room below the receiver's
 * MAX_WRITE_QUEUE_DEPTH (100) while filling typical residential
 * bandwidth-delay products (Powerline / CGNAT links can stall briefly).
 */
export const P2P_MAX_UNACKED_CHUNKS = 64;

/**
 * Default timeout for waiting on end acknowledgment (ms).
 */
export const P2P_END_ACK_TIMEOUT_MS = 15000;

/**
 * Number of times to retry sending end message.
 */
export const P2P_END_ACK_RETRIES = 3;

/**
 * Delay between multiple end_ack sends from receiver (ms).
 */
export const P2P_END_ACK_RETRY_DELAY_MS = 100;

/**
 * Grace period after connection close before declaring failure (ms).
 * Allows for brief reconnection attempts.
 */
export const P2P_CLOSE_GRACE_PERIOD_MS = 2000;
