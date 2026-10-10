import { DropgateError, toDropgateError } from '../errors.js';
import type { FetchFn, ServerTarget } from '../types.js';

/**
 * Parse a server URL string into host, port, and secure components.
 * If no protocol is specified, defaults to HTTPS.
 */
export function parseServerUrl(urlStr: string): ServerTarget {
  let normalized = String(urlStr ?? '').trim();
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized;
  }
  let url: URL;
  try {
    url = new URL(normalized);
  } catch (err) {
    throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'The server address is not a valid URL.', cause: err });
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : undefined,
    secure: url.protocol === 'https:',
  };
}

/**
 * Build a base URL from host, port, and secure options.
 */
export function buildBaseUrl(opts: ServerTarget): string {
  const { host, port, secure } = opts;

  if (!host || typeof host !== 'string') {
    throw new DropgateError({ code: 'INVALID_ARGUMENT', message: 'Server host is required.' });
  }

  const protocol = secure === false ? 'http' : 'https';
  const portSuffix = port ? `:${port}` : '';

  return `${protocol}://${host}${portSuffix}`;
}

/**
 * Sleep for a specified duration, with optional abort signal support.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(signal.reason || new DropgateError({ code: 'OPERATION_CANCELLED' }));
    }

    const t = setTimeout(resolve, ms);

    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(signal.reason || new DropgateError({ code: 'OPERATION_CANCELLED' }));
        },
        { once: true }
      );
    }
  });
}

export interface AbortSignalWithCleanup {
  signal: AbortSignal;
  cleanup: () => void;
}

/**
 * Create an AbortSignal that combines a parent signal with a timeout.
 */
export function makeAbortSignal(
  parentSignal?: AbortSignal | null,
  timeoutMs?: number
): AbortSignalWithCleanup {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const abort = (reason?: unknown): void => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener('abort', () => abort(parentSignal.reason), {
        once: true,
      });
    }
  }

  if (Number.isFinite(timeoutMs) && timeoutMs! > 0) {
    timeoutId = setTimeout(() => {
      abort(new DropgateError({ code: 'TIMED_OUT' }));
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutId) clearTimeout(timeoutId);
    },
  };
}

export interface WaitSignal extends AbortSignalWithCleanup {
  /**
   * Runs `start` and waits for what it gives, aborting the signal with
   * TIMED_OUT if that takes longer than the timeout.
   */
  waiting<T>(start: () => Promise<T>): Promise<T>;
}

/**
 * Create an AbortSignal that aborts with its parent, and with TIMED_OUT when
 * one wait run through `waiting()` takes longer than `timeoutMs` (0 for no
 * timeout). Only the waits count: time spent between them, such as writing
 * what arrived, never does, so a long download only times out if it stalls.
 */
export function makeWaitSignal(parentSignal: AbortSignal, timeoutMs: number): WaitSignal {
  const controller = new AbortController();
  const abort = (reason: unknown): void => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  const onParentAbort = () => abort(parentSignal.reason);
  if (parentSignal.aborted) abort(parentSignal.reason);
  else parentSignal.addEventListener('abort', onParentAbort, { once: true });

  const timed = Number.isFinite(timeoutMs) && timeoutMs > 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const stopTimer = () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;
  };

  return {
    signal: controller.signal,
    async waiting(start) {
      if (timed) timeoutId = setTimeout(() => abort(new DropgateError({ code: 'TIMED_OUT' })), timeoutMs);
      try {
        return await start();
      } finally {
        stopTimer();
      }
    },
    cleanup: () => {
      stopTimer();
      parentSignal.removeEventListener('abort', onParentAbort);
    },
  };
}

/**
 * Wrap a fetch implementation so every request it makes omits credentials.
 * Dropgate uses no cookies, so none are ever sent, and a browser never has to
 * load its cookie store before a request goes out (on a new profile that can
 * take seconds).
 */
export function withoutCredentials(fetchFn: FetchFn): FetchFn {
  return (input, init) => fetchFn(input, { ...init, credentials: 'omit' });
}

export interface FetchJsonResult {
  res: Response;
  json: unknown;
  text: string;
}

export interface FetchJsonOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Fetch JSON from a URL with timeout and error handling. A request that gets no
 * answer throws SERVER_UNREACHABLE (or TIMED_OUT, or OPERATION_CANCELLED), and an answer
 * cut off part-way CONNECTION_LOST. An error status is returned, not thrown.
 */
export async function fetchJson(
  fetchFn: FetchFn,
  url: string,
  opts: FetchJsonOptions = {}
): Promise<FetchJsonResult> {
  const { timeoutMs, signal, ...rest } = opts;
  const { signal: s, cleanup } = makeAbortSignal(signal, timeoutMs);

  try {
    let res: Response;
    try {
      res = await fetchFn(url, { ...rest, signal: s });
    } catch (err) {
      throw toDropgateError(err, 'SERVER_UNREACHABLE');
    }
    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      throw toDropgateError(err, 'CONNECTION_LOST');
    }

    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Ignore parse errors - json will remain null
    }

    return { res, json, text };
  } finally {
    cleanup();
  }
}
