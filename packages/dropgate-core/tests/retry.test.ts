import { describe, it, expect } from 'vitest';
import { DropgateError } from '../src/index.js';
import { backoffMs, isRecoverable, retryPolicy, RetryWindow, QUIET_MS } from '../src/retry.js';

// Core's one retry policy, on its own: what can recover, and how long it waits.

const answered = (status: number) => new DropgateError({ code: 'REQUEST_REJECTED', status });
const bytes = (value: number) => () => new Uint8Array(4).fill(value);

describe('The retry policy', () => {
  it('retries no answer, a timeout, 408, 429 and every 5xx but 507; nothing else, and never a cancel', () => {
    for (const code of ['SERVER_UNREACHABLE', 'CONNECTION_LOST', 'TIMED_OUT'] as const) {
      expect(isRecoverable(new DropgateError({ code })), code).toBe(true);
    }
    for (const status of [408, 429, 500, 502, 503, 504]) expect(isRecoverable(answered(status)), String(status)).toBe(true);
    for (const status of [400, 401, 403, 404, 409, 410, 413, 416, 423, 507]) expect(isRecoverable(answered(status)), String(status)).toBe(false);
    for (const code of ['OPERATION_CANCELLED', 'INTEGRITY_FAILED', 'OUTPUT_WRITE_FAILED', 'SOURCE_UNAVAILABLE', 'DECRYPT_FAILED'] as const) {
      expect(isRecoverable(new DropgateError({ code })), code).toBe(false);
    }
    expect(isRecoverable(new Error('fetch failed'))).toBe(false);
  });

  it('backs off from 1 s, doubling, up to 30 s, at a random point in its upper half', () => {
    const policy = retryPolicy();
    expect(policy).toEqual({ backoffMs: 1000, maxBackoffMs: 30_000 });
    const most = [1, 2, 3, 4, 5, 6, 7, 40].map((attempt) => backoffMs(policy, attempt, bytes(0xff)));
    const least = [1, 2, 3, 4, 5, 6, 7, 40].map((attempt) => backoffMs(policy, attempt, bytes(0)));
    expect(most).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(least).toEqual([500, 1000, 2000, 4000, 8000, 15000, 15000, 15000]);
    expect(backoffMs(policy, 6, () => Uint8Array.of(0x80, 0, 0, 0))).toBe(22500);
  });

  it('never backs off for more than 30 s, whatever it is asked for, and takes a cap on the retries', () => {
    expect(retryPolicy({ maxBackoffMs: 120_000, backoffMs: 10 })).toEqual({ backoffMs: 10, maxBackoffMs: 30_000 });
    expect(retryPolicy({ retries: 3, maxBackoffMs: 5000 })).toEqual({ retries: 3, backoffMs: 1000, maxBackoffMs: 5000 });
    expect(retryPolicy({ retries: -1, backoffMs: Number.NaN })).toEqual({ backoffMs: 1000, maxBackoffMs: 30_000 });
  });

  it("waits until the server's deadline, or 5 minutes after it last answered, whichever is later", () => {
    const window = new RetryWindow();
    const now = Date.now();
    expect(window.end).toBeGreaterThanOrEqual(now + QUIET_MS);
    window.heard(now + 60 * 60_000);
    expect(window.end).toBe(now + 60 * 60_000);
    // A deadline already past (a clock ahead of the server's) still leaves the 5 minutes.
    window.heard(now - 60_000);
    expect(window.end).toBeGreaterThanOrEqual(now + QUIET_MS);
    window.heard('soon');
    expect(window.end).toBeGreaterThanOrEqual(now + QUIET_MS);
  });
});
