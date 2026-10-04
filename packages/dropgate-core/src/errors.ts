/**
 * Where an error came from: this device, the server, the network between, or
 * the other device in a direct transfer.
 */
export type ErrorOrigin = 'local' | 'server' | 'network' | 'peer';

interface ErrorCodeInfo {
  readonly origin: ErrorOrigin;
  readonly retryable: boolean;
  readonly message: string;
}

/**
 * Every code a DropgateError can carry. The codes are stable: a code keeps its
 * meaning, and a new situation gets a new code. Each has the origin and
 * retryable it defaults to, and its message. A message never holds a file name
 * or a key, so it's safe to show and to log.
 */
export const ERROR_CODES = {
  INVALID_ARGUMENT: { origin: 'local', retryable: false, message: 'An option passed to Dropgate is missing or invalid.' },
  RUNTIME_UNSUPPORTED: { origin: 'local', retryable: false, message: 'This environment lacks something Dropgate needs.' },
  OPERATION_CANCELLED: { origin: 'local', retryable: false, message: 'The operation was cancelled.' },
  SOURCE_UNAVAILABLE: { origin: 'local', retryable: false, message: "A file couldn't be read." },
  OUTPUT_WRITE_FAILED: { origin: 'local', retryable: false, message: "Received data couldn't be written." },
  ENCRYPT_FAILED: { origin: 'local', retryable: false, message: "The upload couldn't be encrypted." },
  KEY_REQUIRED: { origin: 'local', retryable: false, message: 'This upload is encrypted, and the link has no key.' },
  DECRYPT_FAILED: { origin: 'local', retryable: false, message: "This upload couldn't be decrypted. The key may be wrong." },
  INTEGRITY_FAILED: { origin: 'server', retryable: false, message: "Received data didn't pass its integrity check." },
  INVALID_MANIFEST: { origin: 'peer', retryable: false, message: "The list of files sent didn't add up." },
  INVALID_FILENAME: { origin: 'local', retryable: false, message: 'A file name is empty, too long, or has a path in it.' },
  INVALID_CODE: { origin: 'local', retryable: false, message: "That isn't a valid sharing code." },
  FILE_EMPTY: { origin: 'local', retryable: false, message: 'Empty files (0 bytes) cannot be uploaded.' },
  FILE_TOO_LARGE: { origin: 'server', retryable: false, message: "The upload is larger than the server's limit." },
  LIFETIME_NOT_ALLOWED: { origin: 'server', retryable: false, message: "The server doesn't allow that file lifetime." },
  CAPABILITY_UNSUPPORTED: { origin: 'server', retryable: false, message: "The server doesn't support this." },
  VERSION_UNSUPPORTED: { origin: 'server', retryable: false, message: "This version of Dropgate can't work with the server." },
  NOT_FOUND: { origin: 'server', retryable: false, message: "The upload wasn't found. It may have expired." },
  REQUEST_REJECTED: { origin: 'server', retryable: false, message: 'The server refused the request.' },
  RATE_LIMITED: { origin: 'server', retryable: true, message: 'Too many requests. Try again later.' },
  SERVER_FULL: { origin: 'server', retryable: true, message: 'The server is out of space. Try again later.' },
  SERVER_ERROR: { origin: 'server', retryable: true, message: 'The server ran into an error.' },
  INVALID_RESPONSE: { origin: 'server', retryable: false, message: "The server's answer wasn't understood." },
  SERVER_UNREACHABLE: { origin: 'network', retryable: true, message: "The server couldn't be reached." },
  TIMED_OUT: { origin: 'network', retryable: true, message: 'The server took too long to answer.' },
  CONNECTION_LOST: { origin: 'network', retryable: true, message: 'The connection was lost.' },
  PEER_FAILED: { origin: 'peer', retryable: false, message: 'The other device reported an error.' },
  UNEXPECTED_ERROR: { origin: 'local', retryable: false, message: 'Something unexpected went wrong.' },
} as const satisfies Record<string, ErrorCodeInfo>;

export type DropgateErrorCode = keyof typeof ERROR_CODES;

export interface DropgateErrorOptions {
  code: DropgateErrorCode;
  /** Replaces the code's own message. It must never hold a file name or a key. */
  message?: string;
  /** Replaces the code's own origin. */
  origin?: ErrorOrigin;
  /** Replaces the code's own retryable. */
  retryable?: boolean;
  /** The HTTP status, when the server answered with an error. */
  status?: number;
  details?: Record<string, unknown>;
  cause?: unknown;
}

/**
 * The one error Dropgate gives. Check its `code`, never its message: the codes
 * are stable, and each is listed in the docs.
 */
export class DropgateError extends Error {
  readonly code: DropgateErrorCode;
  readonly origin: ErrorOrigin;
  /** Whether the same request could succeed if made again later. */
  readonly retryable: boolean;
  readonly status?: number;
  readonly details?: Record<string, unknown>;

  constructor(opts: DropgateErrorOptions) {
    const info: ErrorCodeInfo = ERROR_CODES[opts.code] ?? ERROR_CODES.UNEXPECTED_ERROR;
    super(opts.message ?? info.message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'DropgateError';
    this.code = opts.code in ERROR_CODES ? opts.code : 'UNEXPECTED_ERROR';
    this.origin = opts.origin ?? info.origin;
    this.retryable = opts.retryable ?? info.retryable;
    if (opts.status !== undefined) this.status = opts.status;
    if (opts.details !== undefined) this.details = opts.details;
  }

  /** Whether `err` is a DropgateError, with `code` if one is given. */
  static is(err: unknown, code?: DropgateErrorCode): err is DropgateError {
    return err instanceof DropgateError && (code === undefined || err.code === code);
  }

  /** What JSON.stringify() gives: never the cause, which Dropgate didn't write. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      origin: this.origin,
      retryable: this.retryable,
      ...(this.status !== undefined ? { status: this.status } : {}),
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

/**
 * The error for a server's error status. The server's own message is kept,
 * because the server writes it for people (it never knows a key, nor an
 * encrypted upload's file names), but only a short one.
 */
export function errorFromStatus(status: number, json: unknown, fallback?: string): DropgateError {
  const said = json && typeof json === 'object' && 'error' in json ? (json as { error?: unknown }).error : undefined;
  const serverMessage = typeof said === 'string' && said.trim() && said.length <= 200 ? said.trim() : undefined;
  const code: DropgateErrorCode =
    status === 404 || status === 410 ? 'NOT_FOUND'
      : status === 413 ? 'FILE_TOO_LARGE'
        : status === 429 ? 'RATE_LIMITED'
          : status === 507 ? 'SERVER_FULL'
            : status >= 500 ? 'SERVER_ERROR'
              : 'REQUEST_REJECTED';
  return new DropgateError({ code, status, message: serverMessage ?? fallback });
}

/** The error for a server with direct transfer turned off. */
export function directTransferDisabled(): DropgateError {
  return new DropgateError({
    code: 'CAPABILITY_UNSUPPORTED',
    message: 'Direct transfer is disabled on this server.',
    details: { capability: 'p2p' },
  });
}

/**
 * Any error as a DropgateError: a DropgateError as it is, a timeout or an abort
 * as their codes, and anything else as `fallback` (or UNEXPECTED_ERROR), kept
 * as the cause.
 */
export function toDropgateError(err: unknown, fallback: DropgateErrorCode = 'UNEXPECTED_ERROR', message?: string): DropgateError {
  if (err instanceof DropgateError) return err;
  const name = err instanceof Error || (err && typeof err === 'object' && 'name' in err) ? (err as { name?: unknown }).name : undefined;
  if (name === 'TimeoutError') return new DropgateError({ code: 'TIMED_OUT', cause: err });
  if (name === 'AbortError') return new DropgateError({ code: 'OPERATION_CANCELLED', cause: err });
  return new DropgateError({ code: fallback, cause: err, ...(message ? { message } : {}) });
}
