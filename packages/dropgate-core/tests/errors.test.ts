import { describe, it, expect } from 'vitest';
import { DropgateError, ERROR_CODES } from '../src/index.js';
import type { DropgateErrorCode } from '../src/index.js';
import { errorFromStatus, toDropgateError } from '../src/errors.js';

// Core's one error, and the codes it carries. Integrators and the apps branch
// on the codes, so they're stable: renaming or removing one fails the first
// test, and has to be a deliberate change, made with the docs.

describe('DropgateError codes', () => {
  it('are exactly these, in this order', () => {
    expect(Object.keys(ERROR_CODES)).toEqual([
      'INVALID_ARGUMENT', 'RUNTIME_UNSUPPORTED', 'OPERATION_CANCELLED', 'SOURCE_UNAVAILABLE', 'OUTPUT_WRITE_FAILED',
      'ENCRYPT_FAILED', 'KEY_REQUIRED', 'DECRYPT_FAILED', 'INTEGRITY_FAILED', 'INVALID_MANIFEST', 'INVALID_FILENAME',
      'INVALID_CODE', 'FILE_EMPTY', 'FILE_TOO_LARGE', 'LIFETIME_NOT_ALLOWED', 'CAPABILITY_UNSUPPORTED',
      'VERSION_UNSUPPORTED', 'INSECURE_TRANSPORT_NOT_ALLOWED', 'REDIRECT_NOT_FOLLOWED',
      'AUTH_REQUIRED', 'AUTH_EXPIRED', 'AUTH_DENIED', 'QUOTA_EXCEEDED', 'NOT_FOUND', 'REQUEST_REJECTED',
      'RATE_LIMITED', 'SERVER_FULL', 'SERVER_ERROR',
      'INVALID_RESPONSE', 'SERVER_UNREACHABLE', 'TIMED_OUT', 'CONNECTION_LOST', 'PEER_FAILED', 'UNEXPECTED_ERROR',
    ]);
  });

  it('each give an error with that code, and the origin, retryable and message the code has', () => {
    for (const [code, info] of Object.entries(ERROR_CODES)) {
      const err = new DropgateError({ code: code as DropgateErrorCode });
      expect(err, code).toBeInstanceOf(Error);
      expect(err.name, code).toBe('DropgateError');
      expect(err.code, code).toBe(code);
      expect(err.origin, code).toBe(info.origin);
      expect(err.retryable, code).toBe(info.retryable);
      expect(err.message, code).toBe(info.message);
      expect(err.message, `${code}'s message is a sentence`).toMatch(/^[A-Z].*[.]$/);
    }
  });

  it('are upper snake case, and only the ones a retry could fix are retryable', () => {
    for (const code of Object.keys(ERROR_CODES)) expect(code).toMatch(/^[A-Z]+(?:_[A-Z]+)+$/);
    const retryable = Object.entries(ERROR_CODES).filter(([, info]) => info.retryable).map(([code]) => code);
    expect(retryable).toEqual(['RATE_LIMITED', 'SERVER_FULL', 'SERVER_ERROR', 'SERVER_UNREACHABLE', 'TIMED_OUT', 'CONNECTION_LOST']);
  });
});

describe('DropgateError', () => {
  it('takes its message, origin, retryable, status, details and cause from its options', () => {
    const cause = new Error('underneath');
    const err = new DropgateError({
      code: 'SERVER_ERROR', message: 'Down for maintenance.', origin: 'network', retryable: false,
      status: 503, details: { attempt: 2 }, cause,
    });
    expect(err).toMatchObject({ code: 'SERVER_ERROR', message: 'Down for maintenance.', origin: 'network', retryable: false, status: 503, details: { attempt: 2 } });
    expect(err.cause).toBe(cause);
  });

  it('gives a code it doesn\'t know as UNEXPECTED_ERROR', () => {
    const err = new DropgateError({ code: 'NO_SUCH_CODE' as DropgateErrorCode });
    expect(err.code).toBe('UNEXPECTED_ERROR');
    expect(err.message).toBe(ERROR_CODES.UNEXPECTED_ERROR.message);
  });

  it('leaves out its cause when serialised, since Dropgate didn\'t write it', () => {
    const err = new DropgateError({ code: 'SOURCE_UNAVAILABLE', cause: new Error('EACCES: C:\\Users\\sam\\Tax return.pdf') });
    const json = JSON.parse(JSON.stringify(err));
    expect(json).toEqual({ name: 'DropgateError', code: 'SOURCE_UNAVAILABLE', message: ERROR_CODES.SOURCE_UNAVAILABLE.message, origin: 'local', retryable: false });
  });

  it('is() tells a DropgateError, and its code, from anything else', () => {
    const err = new DropgateError({ code: 'NOT_FOUND' });
    expect(DropgateError.is(err)).toBe(true);
    expect(DropgateError.is(err, 'NOT_FOUND')).toBe(true);
    expect(DropgateError.is(err, 'OPERATION_CANCELLED')).toBe(false);
    expect(DropgateError.is(new Error('NOT_FOUND'))).toBe(false);
    expect(DropgateError.is({ code: 'NOT_FOUND' })).toBe(false);
  });
});

describe('errorFromStatus', () => {
  it('gives each error status its code', () => {
    const codes = Object.fromEntries([400, 403, 404, 410, 413, 429, 500, 502, 503, 507].map((status) => [status, errorFromStatus(status, null).code]));
    expect(codes).toEqual({
      400: 'REQUEST_REJECTED', 403: 'REQUEST_REJECTED', 404: 'NOT_FOUND', 410: 'NOT_FOUND', 413: 'FILE_TOO_LARGE',
      429: 'RATE_LIMITED', 500: 'SERVER_ERROR', 502: 'SERVER_ERROR', 503: 'SERVER_ERROR', 507: 'SERVER_FULL',
    });
    expect(errorFromStatus(507, null)).toMatchObject({ status: 507, retryable: true, origin: 'server' });
  });

  it("keeps the server's own short message, and otherwise uses the fallback or the code's", () => {
    expect(errorFromStatus(413, { error: 'File exceeds limit of 100 MB.' }, 'Upload failed.').message).toBe('File exceeds limit of 100 MB.');
    expect(errorFromStatus(413, { error: 'x'.repeat(201) }, 'Upload failed.').message).toBe('Upload failed.');
    expect(errorFromStatus(413, { error: { nested: true } }, 'Upload failed.').message).toBe('Upload failed.');
    expect(errorFromStatus(413, null).message).toBe(ERROR_CODES.FILE_TOO_LARGE.message);
  });
});

describe('toDropgateError', () => {
  it('passes a DropgateError through, and types a timeout, an abort and anything else', () => {
    const err = new DropgateError({ code: 'NOT_FOUND' });
    expect(toDropgateError(err, 'SERVER_UNREACHABLE')).toBe(err);
    expect(toDropgateError(new DOMException('The operation timed out.', 'TimeoutError')).code).toBe('TIMED_OUT');
    expect(toDropgateError(new DOMException('The operation was aborted.', 'AbortError')).code).toBe('OPERATION_CANCELLED');
    const failed = new TypeError('fetch failed');
    const typed = toDropgateError(failed, 'SERVER_UNREACHABLE');
    expect(typed).toMatchObject({ code: 'SERVER_UNREACHABLE', message: ERROR_CODES.SERVER_UNREACHABLE.message });
    expect(typed.cause).toBe(failed);
    expect(toDropgateError('a string').code).toBe('UNEXPECTED_ERROR');
  });
});
