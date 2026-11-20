import { DropgateError } from './errors.js';
import type { FetchFn } from './types.js';
import { isLocalhostHostname } from './p2p/utils.js';

/**
 * How a client reaches its server. Every snapshot, result and error a client
 * gives carries it, so whatever shows them can say when the connection isn't
 * secure.
 */
export interface Transport {
  /**
   * False when the server is reached over plain `http://` on another machine:
   * anyone on the network between can read and change what's sent. True over
   * `https://`, and over `http://` to this machine (`localhost`, `127.0.0.1`
   * or `[::1]`), which never leaves it.
   */
  readonly secure: boolean;
}

/**
 * Whether a server address is secure: `https://`, or `http://` to this
 * machine by one of its loopback names. Only the name counts, never what it
 * resolves to: `localhost.example.com`, or a name for a private address, is
 * another machine.
 */
export function isSecureServerUrl(baseUrl: string): boolean {
  const url = new URL(baseUrl);
  return url.protocol === 'https:' || isLocalhostHostname(url.hostname);
}

/** The error for an insecure server the client wasn't allowed to use. */
export function insecureTransportNotAllowed(): DropgateError {
  return new DropgateError({ code: 'INSECURE_TRANSPORT_NOT_ALLOWED', transport: { secure: false } });
}

/**
 * Wraps a fetch implementation for every request a client makes:
 * - credentials are omitted. Dropgate uses no cookies, so none are ever sent,
 *   and a browser never has to load its cookie store before a request goes out
 *   (on a new profile that can take seconds);
 * - redirects are never followed. A redirect could take a request from
 *   `https://` to plain `http://` before anyone could see it (a browser
 *   doesn't say where a redirect goes until it has followed it), so an answer
 *   that redirects fails with REDIRECT_NOT_FOLLOWED, and nothing is sent to
 *   where it points.
 */
export function guardedFetch(fetchFn: FetchFn): FetchFn {
  return async (input, init) => {
    const res = await fetchFn(input, { ...init, credentials: 'omit', redirect: 'manual' });
    // A browser gives an opaque answer for a redirect it didn't follow; Node gives the 3xx itself.
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400 && res.headers.has('location'))) {
      throw new DropgateError({ code: 'REDIRECT_NOT_FOLLOWED', status: res.status || undefined });
    }
    return res;
  };
}
