import type { Transport } from './transport.js';

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
  INVALID_FILENAME: { origin: 'local', retryable: false, message: 'A file name is empty, too long, or has a control character or path in it.' },
  INVALID_CODE: { origin: 'local', retryable: false, message: "That isn't a valid sharing code." },
  FILE_EMPTY: { origin: 'local', retryable: false, message: 'Empty files (0 bytes) cannot be uploaded.' },
  FILE_TOO_LARGE: { origin: 'server', retryable: false, message: "The upload is larger than the server's limit." },
  LIFETIME_NOT_ALLOWED: { origin: 'server', retryable: false, message: "The server doesn't allow that file lifetime." },
  CAPABILITY_UNSUPPORTED: { origin: 'server', retryable: false, message: "The server doesn't support this." },
  VERSION_UNSUPPORTED: { origin: 'server', retryable: false, message: "This version of Dropgate can't work with the server." },
  INSECURE_TRANSPORT_NOT_ALLOWED: { origin: 'local', retryable: false, message: 'The server is on plain HTTP, which is not secure, and insecure servers are not allowed.' },
  REDIRECT_NOT_FOLLOWED: { origin: 'server', retryable: false, message: 'The server redirected the request elsewhere. Dropgate never follows a redirect: use the address it redirects to.' },
  AUTH_REQUIRED: { origin: 'server', retryable: false, message: 'The server needs a credential for this.' },
  AUTH_EXPIRED: { origin: 'server', retryable: false, message: 'The credential has expired.' },
  AUTH_DENIED: { origin: 'server', retryable: false, message: "The credential doesn't allow this." },
  QUOTA_EXCEEDED: { origin: 'server', retryable: false, message: 'This would go over the quota the server allows.' },
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
  /** How the client that gave the error reaches its server. */
  transport?: Transport;
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
  /**
   * How the client that gave the error reaches its server. Every error a
   * client gives has it, so an error shown to someone can say the connection
   * wasn't secure.
   */
  readonly transport?: Transport;

  constructor(opts: DropgateErrorOptions) {
    const info: ErrorCodeInfo = ERROR_CODES[opts.code] ?? ERROR_CODES.UNEXPECTED_ERROR;
    super(opts.message ?? info.message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'DropgateError';
    this.code = opts.code in ERROR_CODES ? opts.code : 'UNEXPECTED_ERROR';
    this.origin = opts.origin ?? info.origin;
    this.retryable = opts.retryable ?? info.retryable;
    if (opts.status !== undefined) this.status = opts.status;
    if (opts.details !== undefined) this.details = opts.details;
    if (opts.transport !== undefined) this.transport = Object.freeze({ secure: opts.transport.secure });
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
      ...(this.transport !== undefined ? { transport: this.transport } : {}),
    };
  }
}

/**
 * The error as a DropgateError that carries `transport`: `err` itself if it
 * already has one (a DropgateError is only given a transport once, by the
 * client it came from), or its DropgateError with it set.
 */
export function withTransport(err: unknown, transport: Transport): DropgateError {
  const error = toDropgateError(err);
  if (error.transport === undefined) {
    Object.defineProperty(error, 'transport', { value: Object.freeze({ secure: transport.secure }), enumerable: true });
  }
  return error;
}

/** The credential codes a server's answer can name, as `{ code }`. */
const SERVER_CREDENTIAL_CODES = new Set<DropgateErrorCode>(['AUTH_REQUIRED', 'AUTH_EXPIRED', 'AUTH_DENIED', 'QUOTA_EXCEEDED']);

/**
 * The codes a Dropgate 4 server names in its errors, as core's own, where
 * they're more than the status says. Any other is read from the status.
 */
const SERVER_CODES: Readonly<Record<string, DropgateErrorCode>> = Object.freeze({
  E2EE_DISABLED: 'CAPABILITY_UNSUPPORTED',
  PAUSE_DISABLED: 'CAPABILITY_UNSUPPORTED',
  UNSUPPORTED_OBJECT: 'VERSION_UNSUPPORTED',
  LIFETIME_NOT_ALLOWED: 'LIFETIME_NOT_ALLOWED',
  DIGEST_MISMATCH: 'INTEGRITY_FAILED',
  CHUNK_CONFLICT: 'INTEGRITY_FAILED',
  RANGE_NOT_SATISFIABLE: 'INVALID_RESPONSE',
});

/**
 * The error for a server's error status. The server's own message is kept,
 * because the server writes it for people (it never knows a key, nor an
 * encrypted upload's file names), but only a short one. A credential error
 * (any 401, or a 4xx naming a credential code) keeps core's own message
 * instead, so nothing the server says about a credential is repeated.
 */
export function errorFromStatus(status: number, json: unknown, fallback?: string): DropgateError {
  const named = json && typeof json === 'object' ? (json as { code?: unknown }).code : undefined;
  if (status >= 400 && status < 500 && typeof named === 'string' && SERVER_CREDENTIAL_CODES.has(named as DropgateErrorCode)) {
    return new DropgateError({ code: named as DropgateErrorCode, status });
  }
  if (status === 401) return new DropgateError({ code: 'AUTH_REQUIRED', status });
  const said = json && typeof json === 'object' && 'error' in json ? (json as { error?: unknown }).error : undefined;
  const serverMessage = typeof said === 'string' && said.trim() && said.length <= 200 ? said.trim() : undefined;
  const code: DropgateErrorCode =
    typeof named === 'string' && Object.prototype.hasOwnProperty.call(SERVER_CODES, named) ? SERVER_CODES[named]
    : status === 404 || status === 410 ? 'NOT_FOUND'
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

/** Whether `err` is about a credential, which is never retried as it is. */
export function isCredentialError(err: unknown): boolean {
  return err instanceof DropgateError && SERVER_CREDENTIAL_CODES.has(err.code);
}
