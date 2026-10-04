/**
 * What someone typed or pasted to open a share, read without the network.
 */
export interface ShareInput {
  /**
   * What the server is asked to look up: a file or bundle ID, or a direct
   * transfer code. Never a whole link, and never anything after a #.
   */
  locator: string;
  /** Everything after the #, if there was one: an encrypted upload's key. Never sent anywhere. */
  secret?: string;
  /** The host the link was for (host and port), when the input was a link. */
  linkHost?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read a sharing code or link locally. A link is reduced to the ID or code in
 * its path, and anything after a # is kept apart as its secret, so the secret
 * can't reach a request. Returns null for a link with no ID or code in it.
 */
export function parseShareInput(value: string): ShareInput | null {
  const raw = String(value ?? '').trim();
  const hashAt = raw.indexOf('#');
  const before = hashAt === -1 ? raw : raw.slice(0, hashAt);
  const after = hashAt === -1 ? '' : raw.slice(hashAt + 1);
  const secret = after ? after : undefined;

  if (!/^https?:\/\//i.test(before)) {
    const locator = before.replace(/\s+/g, '');
    return locator ? { locator, ...(secret ? { secret } : {}) } : null;
  }

  let url: URL;
  try {
    url = new URL(before);
  } catch {
    return null;
  }

  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }

  let locator: string | null = null;
  if (path.startsWith('/p2p/')) {
    locator = path.slice('/p2p/'.length).replace(/\s+/g, '').toUpperCase();
  } else if (path.startsWith('/b/')) {
    locator = path.slice('/b/'.length);
  } else {
    locator = path.slice(1);
  }
  if (!locator || (!path.startsWith('/p2p/') && !UUID_RE.test(locator))) return null;

  return { locator, linkHost: url.host, ...(secret ? { secret } : {}) };
}
