import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ObjectLayout } from '../../src/object/index.js';

// Dropgate 4's upload and download routes, in memory, for the fake servers the
// client's tests put behind `fetchFn`. It keeps what it's sent as a real server
// would, and serves it back, so an upload can be downloaded again; and it
// checks what a real server checks of a request's shape, so a test fails if
// the client sends something the server would refuse. The real server is in
// hosted.test.ts.

/** The smallest chunk size an object may have, which keeps the fakes' files small. */
export const CHUNK_SIZE = 64 * 1024;

/** A manage token, as an upload's value gives it, and the SHA-256 the server keeps of it. */
export const MANAGE_TOKEN = Buffer.alloc(32, 7).toString('base64url');
export const MANAGE_TOKEN_HASH = createHash('sha256').update(Buffer.from(MANAGE_TOKEN, 'base64url')).digest('base64url');

/** A stored upload, as the server's record and object hold it. */
export interface StoredObject {
  encrypted: boolean;
  size: number;
  bytes: Uint8Array;
  meta?: string;
  files?: Array<{ name: string; size: number }>;
  maxDownloads: number;
  /** Downloads counted so far: a lease that sent anything, once it ended. */
  downloadCount?: number;
  manageTokenHash?: string;
}

interface Upload {
  encrypted: boolean;
  size: number;
  chunks: number;
  header?: Uint8Array;
  meta?: string;
  files?: Array<{ name: string; size: number }>;
  maxDownloads: number;
  manageTokenHash: string;
  received: Map<number, Uint8Array>;
  paused: boolean;
  deadline: number;
}

/** A download's lease: its upload, whether it has sent anything, and whether it's paused. */
interface Lease {
  id: string;
  served: boolean;
  paused: boolean;
}

/** How long the fake holds an upload or a lease with no request. */
const QUIET_MS = 300_000;

/** The chunks an upload holds, as the server gives them: ranges of indexes, first and last included. */
const rangesOf = (indexes: Iterable<number>): Array<[number, number]> => {
  const ranges: Array<[number, number]> = [];
  for (const i of [...indexes].sort((a, b) => a - b)) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else ranges.push([i, i]);
  }
  return ranges;
};

const json = (status: number, value: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const notFound = () => json(404, { code: 'NOT_FOUND', error: 'The server has no such upload.' });
const invalid = (field: string) => json(400, { code: 'INVALID_REQUEST', error: 'A field of the request is missing or wrong.', details: { field } });

const bodyBytes = async (body: BodyInit | null | undefined): Promise<Uint8Array> => {
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (body instanceof Uint8Array) return body;
  if (typeof body === 'string') return new TextEncoder().encode(body);
  return new Uint8Array(0);
};

const headerOf = (init: RequestInit, name: string): string | undefined => {
  const headers = new Headers(init.headers);
  return headers.get(name) ?? undefined;
};

/**
 * The one range a Range header asks for, as the server reads it: `bytes=a-`
 * or `bytes=a-b` within `size` bytes, or null for anything else.
 */
const rangeOf = (header: string, size: number): [number, number] | null => {
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (!match) return null;
  const first = Number(match[1]);
  const last = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  return first < size && first <= last ? [first, last] : null;
};

/**
 * Dropgate 4's routes, in memory, with `chunkSize` as the server's. `handle()`
 * answers a request to one of them, or gives undefined for any other path.
 * Every finished upload is stored under `id`, when it's given. A content
 * request with `Range` gets that range (206), unless its `If-Range` isn't the
 * upload's ETag, which gets the whole upload (200), as the server answers.
 * A lease counts as one download when it's released, if it sent anything; at
 * its limit, with no other lease open, the upload goes. A new lease waits
 * (423) while open leases and counted downloads make the limit. An upload or
 * a lease pauses for `maxPauseMinutes` (409 PAUSE_DISABLED at 0); a chunk the
 * upload already holds is taken again only with the same bytes (409
 * CHUNK_CONFLICT for others), and one sent while paused resumes it.
 */
export function fakeV4({ chunkSize = CHUNK_SIZE, id: fixedId, maxPauseMinutes = 60 }: { chunkSize?: number; id?: string; maxPauseMinutes?: number } = {}) {
  const uploads = new Map<string, Upload>();
  const objects = new Map<string, StoredObject>();
  const leases = new Map<string, Lease>();
  /** Every renew asked for, by lease. */
  const renewals: string[] = [];
  /** Every pause asked for, of an upload (`upload`) or a lease (`lease`), in order. */
  const pauses: string[] = [];
  const pauseDisabled = () => json(409, { code: 'PAUSE_DISABLED', error: 'Pausing is turned off on this server.' });
  const openLeases = (id: string) => [...leases.values()].filter((lease) => lease.id === id).length;
  /** Ends a lease: one download, if it sent anything; the upload goes at its limit, once no other lease is open. */
  const endLease = (key: string) => {
    const lease = leases.get(key);
    if (!lease) return false;
    leases.delete(key);
    const stored = objects.get(lease.id);
    if (lease.served && stored) {
      stored.downloadCount = (stored.downloadCount ?? 0) + 1;
      if (stored.maxDownloads > 0 && stored.downloadCount >= stored.maxDownloads && openLeases(lease.id) === 0) objects.delete(lease.id);
    }
    return true;
  };
  /** The ID the next finished upload gets, if one is set. */
  const next: { id?: string } = {};
  let uploadCount = 0;

  const upload = (init: RequestInit) => uploads.get(headerOf(init, 'Dropgate-Upload') ?? '');

  async function handle(method: string, path: string, init: RequestInit): Promise<Response | undefined> {
    if (method === 'POST' && path === '/api/v4/uploads') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const { encrypted, size, header, meta, files, lifetimeMs, maxDownloads, manageTokenHash } = body;
      if (typeof encrypted !== 'boolean') return invalid('encrypted');
      if (!Number.isSafeInteger(size) || (size as number) < 1) return invalid('size');
      if (!Number.isSafeInteger(lifetimeMs)) return invalid('lifetimeMs');
      if (typeof manageTokenHash !== 'string' || Buffer.from(manageTokenHash, 'base64url').length !== 32) return invalid('manageTokenHash');
      let chunks: number;
      if (encrypted) {
        if (typeof header !== 'string' || Buffer.from(header, 'base64url').length !== 60) return invalid('header');
        if (typeof meta !== 'string' || files !== undefined) return invalid('meta');
        chunks = ObjectLayout.fromStoredSize(size as number, chunkSize).chunkCount;
      } else {
        if (header !== undefined || meta !== undefined || !Array.isArray(files)) return invalid('files');
        if ((files as Array<{ size: number }>).reduce((sum, f) => sum + f.size, 0) !== size) return invalid('files');
        chunks = Math.ceil((size as number) / chunkSize);
      }
      const uploadId = `upload-${++uploadCount}`;
      uploads.set(uploadId, {
        encrypted, size: size as number, chunks, maxDownloads: Number(maxDownloads ?? 0), manageTokenHash,
        ...(encrypted ? { header: new Uint8Array(Buffer.from(header as string, 'base64url')), meta: meta as string } : { files: files as Upload['files'] }),
        received: new Map(),
        paused: false,
        deadline: Date.now() + QUIET_MS,
      });
      return json(201, { uploadId, chunks, chunkSize, deadline: Date.now() + QUIET_MS });
    }

    const chunk = /^\/api\/v4\/upload\/chunks\/(\d+)$/.exec(path);
    if (method === 'PUT' && chunk) {
      const found = upload(init);
      if (!found) return notFound();
      const index = Number(chunk[1]);
      if (index >= found.chunks) return json(400, { code: 'INVALID_CHUNK', error: 'There is no chunk with that index in this upload.' });
      const bytes = await bodyBytes(init.body);
      const digest = /sha-256=:([A-Za-z0-9+/=]+):/.exec(headerOf(init, 'Content-Digest') ?? '')?.[1];
      if (digest !== createHash('sha256').update(bytes).digest('base64')) {
        return json(400, { code: 'DIGEST_MISMATCH', error: "The chunk's Content-Digest is missing, or doesn't match its bytes." });
      }
      const held = found.received.get(index);
      if (held && createHash('sha256').update(held).digest('base64') !== digest) {
        return json(409, { code: 'CHUNK_CONFLICT', error: 'The server already holds different bytes for that chunk.' });
      }
      found.received.set(index, bytes);
      // A chunk sent while paused resumes the upload.
      found.paused = false;
      found.deadline = Date.now() + QUIET_MS;
      return json(200, { deadline: found.deadline });
    }

    if (method === 'GET' && path === '/api/v4/upload') {
      const found = upload(init);
      if (!found) return notFound();
      if (!found.paused) found.deadline = Date.now() + QUIET_MS;
      return json(200, { chunks: found.chunks, received: rangesOf(found.received.keys()), paused: found.paused, deadline: found.deadline });
    }

    if (method === 'POST' && path === '/api/v4/upload/pause') {
      const found = upload(init);
      if (!found) return notFound();
      if (maxPauseMinutes === 0) return pauseDisabled();
      pauses.push('upload');
      found.paused = true;
      found.deadline = Date.now() + maxPauseMinutes * 60_000;
      return json(200, { paused: true, deadline: found.deadline });
    }

    if (method === 'POST' && path === '/api/v4/upload/resume') {
      const found = upload(init);
      if (!found) return notFound();
      found.paused = false;
      found.deadline = Date.now() + QUIET_MS;
      return json(200, { paused: false, deadline: found.deadline, received: rangesOf(found.received.keys()) });
    }

    if (method === 'POST' && path === '/api/v4/upload/complete') {
      const found = upload(init);
      if (!found) return notFound();
      if (found.received.size !== found.chunks) return json(409, { code: 'UPLOAD_INCOMPLETE', error: "The server doesn't hold every chunk of this upload yet." });
      const parts = [...(found.header ? [found.header] : []), ...[...found.received.keys()].sort((a, b) => a - b).map((i) => found.received.get(i)!)];
      const bytes = new Uint8Array(Buffer.concat(parts));
      if (bytes.byteLength !== found.size) return json(500, { code: 'SERVER_ERROR', error: 'Something went wrong on the server.' });
      const id = next.id ?? fixedId ?? randomUUID();
      delete next.id;
      objects.set(id, {
        encrypted: found.encrypted, size: found.size, bytes, maxDownloads: found.maxDownloads, manageTokenHash: found.manageTokenHash,
        ...(found.encrypted ? { meta: found.meta } : { files: found.files }),
      });
      uploads.delete(headerOf(init, 'Dropgate-Upload')!);
      return json(201, { id });
    }

    if (method === 'DELETE' && path === '/api/v4/upload') {
      const id = headerOf(init, 'Dropgate-Upload') ?? '';
      return uploads.delete(id) ? new Response(null, { status: 204 }) : notFound();
    }

    const object = /^\/api\/v4\/objects\/([^/]+)(\/leases|\/content)?$/.exec(path);
    if (object) {
      const [, id, rest] = object;
      const stored = objects.get(id);
      if (method === 'GET' && !rest) {
        if (!stored) return notFound();
        return stored.encrypted
          ? json(200, { encrypted: true, size: stored.size, header: Buffer.from(stored.bytes.subarray(0, 60)).toString('base64url'), meta: stored.meta })
          : json(200, { encrypted: false, size: stored.size, files: stored.files });
      }
      if (method === 'POST' && rest === '/leases') {
        if (!stored) return notFound();
        if (stored.maxDownloads > 0 && openLeases(id) + (stored.downloadCount ?? 0) >= stored.maxDownloads) {
          return json(423, { code: 'DOWNLOADS_BUSY', error: 'Someone is downloading this right now. Try again shortly.' }, { 'Retry-After': '5' });
        }
        const lease = randomBytes(32).toString('base64url');
        leases.set(lease, { id, served: false, paused: false });
        return json(201, { lease, deadline: Date.now() + QUIET_MS, etag: `"${id}"` });
      }
      if (method === 'GET' && rest === '/content') {
        const lease = leases.get(headerOf(init, 'Dropgate-Lease') ?? '');
        if (!headerOf(init, 'Dropgate-Lease')) return json(400, { code: 'LEASE_REQUIRED', error: 'A download needs a lease, in the Dropgate-Lease header.' });
        if (!stored || !lease || lease.id !== id) return notFound();
        lease.served = true;
        lease.paused = false;
        const etag = `"${id}"`;
        const range = headerOf(init, 'Range');
        const ifRange = headerOf(init, 'If-Range');
        if (range !== undefined && (ifRange === undefined || ifRange === etag)) {
          const asked = rangeOf(range, stored.size);
          if (!asked) return json(416, { code: 'RANGE_NOT_SATISFIABLE', error: "The server can't send that range of bytes." }, { 'Content-Range': `bytes */${stored.size}` });
          const [first, last] = asked;
          return new Response(stored.bytes.slice(first, last + 1) as Uint8Array<ArrayBuffer>, {
            status: 206,
            headers: { 'Content-Length': String(last - first + 1), 'Content-Range': `bytes ${first}-${last}/${stored.size}`, ETag: etag },
          });
        }
        return new Response(stored.bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { 'Content-Length': String(stored.size), ETag: etag } });
      }
      if (method === 'DELETE' && !rest) {
        if (!stored) return notFound();
        const token = headerOf(init, 'Dropgate-Manage-Token') ?? '';
        const hash = createHash('sha256').update(Buffer.from(token, 'base64url')).digest('base64url');
        if (!token || hash !== stored.manageTokenHash) return json(403, { code: 'MANAGE_DENIED', error: "That manage token isn't this upload's." });
        objects.delete(id);
        for (const [key, lease] of leases) if (lease.id === id) leases.delete(key);
        return new Response(null, { status: 204 });
      }
    }

    if (method === 'DELETE' && path === '/api/v4/lease') {
      return endLease(headerOf(init, 'Dropgate-Lease') ?? '') ? new Response(null, { status: 204 }) : notFound();
    }
    if (method === 'POST' && path === '/api/v4/lease/renew') {
      const key = headerOf(init, 'Dropgate-Lease') ?? '';
      const lease = leases.get(key);
      if (!lease) return notFound();
      renewals.push(key);
      lease.paused = false;
      return json(200, { deadline: Date.now() + QUIET_MS });
    }
    if (method === 'POST' && path === '/api/v4/lease/pause') {
      const lease = leases.get(headerOf(init, 'Dropgate-Lease') ?? '');
      if (!lease) return notFound();
      if (maxPauseMinutes === 0) return pauseDisabled();
      pauses.push('lease');
      lease.paused = true;
      return json(200, { paused: true, deadline: Date.now() + maxPauseMinutes * 60_000 });
    }
    return undefined;
  }

  return {
    handle,
    uploads,
    objects,
    leases,
    renewals,
    pauses,
    /** Gives the next finished upload this ID. */
    nextId: (id: string) => { next.id = id; },
    /** Stores an upload as if it had been sent, by its ID. */
    store: (id: string, stored: Omit<StoredObject, 'maxDownloads'> & { maxDownloads?: number }) => {
      objects.set(id, { maxDownloads: 0, ...stored });
    },
  };
}
