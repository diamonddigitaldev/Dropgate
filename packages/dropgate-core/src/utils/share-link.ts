/**
 * What someone typed or pasted to open a share, read without the network.
 */
export interface ShareInput {
  /**
   * What it opens: a hosted upload (`/<id>`), a bundle's older link
   * (`/b/<id>`), or a direct transfer's code.
   */
  kind: 'hosted' | 'bundle' | 'direct';
  /** The upload's ID, or the code, upper case. Never a whole link, and never anything after a #. */
  locator: string;
  /** Everything after the #, if there was one: an encrypted upload's secret. Never sent anywhere. */
  secret?: string;
  /** The host the link was for (host and port), when the input was a link. */
  linkHost?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^[A-Z]{4}-\d{4}$/;

/**
 * Read a sharing code or link on the device, with no request. A link is
 * reduced to the ID or code in its path, and anything after a # is kept apart
 * as its secret. Returns null for anything that isn't an upload's ID, a
 * direct transfer's code, or a link to either.
 */
export function parseShareInput(value: string): ShareInput | null {
  const raw = String(value ?? '').trim();
  const hashAt = raw.indexOf('#');
  const before = hashAt === -1 ? raw : raw.slice(0, hashAt);
  const after = hashAt === -1 ? '' : raw.slice(hashAt + 1);
  const secret = after ? after : undefined;

  if (!/^https?:\/\//i.test(before)) {
    const typed = before.replace(/\s+/g, '');
    if (UUID_RE.test(typed)) return { kind: 'hosted', locator: typed.toLowerCase(), ...(secret ? { secret } : {}) };
    const code = typed.toUpperCase();
    return CODE_RE.test(code) ? { kind: 'direct', locator: code } : null;
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

  if (path.startsWith('/p2p/')) {
    const code = path.slice('/p2p/'.length).replace(/\s+/g, '').toUpperCase();
    return CODE_RE.test(code) ? { kind: 'direct', locator: code, linkHost: url.host } : null;
  }
  const bundle = path.startsWith('/b/');
  const id = path.slice(bundle ? '/b/'.length : 1);
  if (!UUID_RE.test(id)) return null;
  return { kind: bundle ? 'bundle' : 'hosted', locator: id.toLowerCase(), linkHost: url.host, ...(secret ? { secret } : {}) };
}
