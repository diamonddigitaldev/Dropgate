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

/** A stored upload, as the server's record and object hold it. */
export interface StoredObject {
  encrypted: boolean;
  size: number;
  bytes: Uint8Array;
  meta?: string;
  files?: Array<{ name: string; size: number }>;
  maxDownloads: number;
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
}

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
 * Dropgate 4's routes, in memory, with `chunkSize` as the server's. `handle()`
 * answers a request to one of them, or gives undefined for any other path.
 * Every finished upload is stored under `id`, when it's given.
 */
export function fakeV4({ chunkSize = CHUNK_SIZE, id: fixedId }: { chunkSize?: number; id?: string } = {}) {
  const uploads = new Map<string, Upload>();
  const objects = new Map<string, StoredObject>();
  const leases = new Map<string, { id: string; served: boolean }>();
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
      });
      return json(201, { uploadId, chunks, chunkSize, deadline: Date.now() + 300_000 });
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
      found.received.set(index, bytes);
      return json(200, { deadline: Date.now() + 300_000 });
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
        const lease = randomBytes(32).toString('base64url');
        leases.set(lease, { id, served: false });
        return json(201, { lease, deadline: Date.now() + 300_000, etag: `"${id}"` });
      }
      if (method === 'GET' && rest === '/content') {
        const lease = leases.get(headerOf(init, 'Dropgate-Lease') ?? '');
        if (!headerOf(init, 'Dropgate-Lease')) return json(400, { code: 'LEASE_REQUIRED', error: 'A download needs a lease, in the Dropgate-Lease header.' });
        if (!stored || !lease || lease.id !== id) return notFound();
        lease.served = true;
        return new Response(stored.bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { 'Content-Length': String(stored.size), ETag: `"${id}"` } });
      }
    }

    if (method === 'DELETE' && path === '/api/v4/lease') {
      return leases.delete(headerOf(init, 'Dropgate-Lease') ?? '') ? new Response(null, { status: 204 }) : notFound();
    }
    return undefined;
  }

  return {
    handle,
    uploads,
    objects,
    leases,
    /** Gives the next finished upload this ID. */
    nextId: (id: string) => { next.id = id; },
    /** Stores an upload as if it had been sent, by its ID. */
    store: (id: string, stored: Omit<StoredObject, 'maxDownloads'> & { maxDownloads?: number }) => {
      objects.set(id, { maxDownloads: 0, ...stored });
    },
  };
}
