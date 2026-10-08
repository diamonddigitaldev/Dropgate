import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DropgateClient } from '../src/index.js';
import type { DownloadSink, UploadResult } from '../src/index.js';
import { encryptedSize, paddedLength, padme } from '../src/object/index.js';
// The server suite's own harness: the real server.js, in a throwaway folder, on a free port.
import { startServer } from '../../../server/test/helpers/harness.mjs';

// One file's upload, metadata and download, against the real server: what
// core sends is what the server takes, stores and gives back.

interface Server {
  baseUrl: string;
  uploadsDir: string;
  storedFiles(): string[];
  requests(): Array<{ method: string; url: string; headers: Record<string, string | string[]>; body: Buffer }>;
  restart(opts?: { env?: Record<string, string> }): Promise<void>;
  stop(): Promise<void>;
}

const KiB = 1024;
const MiB = 1024 * 1024;
// The smallest chunk size the server takes, so the files here can be small and still span chunks.
const CHUNK = 64 * KiB;
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A server with uploads on, its chunk size CHUNK, writing down every request it gets. */
async function withServer(env: Record<string, string>, run: (server: Server) => Promise<void>): Promise<void> {
  const server = (await startServer({
    env: { ENABLE_UPLOAD: 'true', UPLOAD_CHUNK_SIZE_BYTES: String(CHUNK), ...env },
    requests: true,
  })) as Server;
  try {
    await run(server);
  } finally {
    await server.stop();
  }
}

/** Bytes that differ along the file, so a chunk out of place would show. */
const fileBytes = (size: number, seed: number) => {
  const bytes = new Uint8Array(size);
  let x = seed;
  for (let i = 0; i < size; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    bytes[i] = x >>> 24;
  }
  return bytes;
};

/** A sink that keeps what it's given. */
const keeping = () => {
  const chunks: Uint8Array[] = [];
  const sink: DownloadSink = { write: (chunk) => { chunks.push(chunk.slice()); }, close: () => {} };
  return { sink, bytes: () => Buffer.concat(chunks) };
};

const upload = async (client: DropgateClient, file: File, opts: { encrypt: boolean; maxDownloads?: number }): Promise<UploadResult> => {
  const outcome = await client.hosted.upload({ files: file, lifetimeMs: 60 * 60 * 1000, ...opts }).result;
  if (outcome.status !== 'completed') throw outcome.status === 'failed' ? outcome.error : new Error('The upload was cancelled.');
  return outcome.value;
};

const download = async (client: DropgateClient, id: string, secret?: string) => {
  const { sink, bytes } = keeping();
  const outcome = await client.hosted.download({ id, secret, sink }).result;
  if (outcome.status !== 'completed') throw outcome.status === 'failed' ? outcome.error : new Error('The download was cancelled.');
  return { value: outcome.value, bytes: bytes() };
};

/** Each request as `METHOD /path`. */
const routes = (server: Server) => server.requests().map((r) => `${r.method} ${new URL(r.url, 'http://server').pathname}`);

/** Every way a secret could be written into a request: as text, and as the bytes it stands for. */
const spellings = (base64url: string) => {
  const raw = Buffer.from(base64url, 'base64url');
  return [base64url, raw.toString('base64'), raw.toString('hex'), encodeURIComponent(raw.toString('base64'))].map((s) => Buffer.from(s)).concat([raw]);
};

/** Each request whose URL, headers or body holds any of `forms`. */
const holding = (server: Server, forms: Buffer[]) => server.requests()
  .filter((r) => [Buffer.from(r.url), Buffer.from(JSON.stringify(r.headers)), r.body].some((part) => forms.some((form) => part.includes(form))))
  .map((r) => `${r.method} ${r.url}`);

describe('One file on Dropgate 4, against the real server', { timeout: 60_000 }, () => {
  it('unencrypted: uploads as the file\'s own bytes, reads its metadata with no lease, and downloads intact', async () => {
    await withServer({}, async (server) => {
      const client = new DropgateClient({ server: server.baseUrl });
      const bytes = fileBytes(CHUNK * 2 + 123, 1);
      const value = await upload(client, new File([bytes], 'Field notes é.bin'), { encrypt: false });

      // The link is the upload's ID, with nothing after it.
      expect(value.id).toMatch(UPLOAD_ID);
      expect(value.downloadUrl).toBe(`${server.baseUrl}/${value.id}`);
      expect(value.files).toEqual([{ name: 'Field notes é.bin', size: bytes.length }]);
      expect(server.storedFiles()).toEqual([`objects/${value.id}`]);
      expect(fs.readFileSync(path.join(server.uploadsDir, 'objects', value.id)).equals(Buffer.from(bytes)), 'what the server stores').toBe(true);

      expect(await client.hosted.metadata({ id: value.id })).toEqual({
        kind: 'file', id: value.id, encrypted: false, files: value.files, totalSize: bytes.length, transport: { secure: true },
      });
      expect(routes(server).filter((route) => route.endsWith('/leases')), 'metadata takes no lease').toEqual([]);

      const got = await download(client, value.id);
      expect(got.value).toEqual({ filename: 'Field notes é.bin', receivedBytes: bytes.length, wasEncrypted: false, transport: { secure: true } });
      expect(got.bytes.equals(Buffer.from(bytes))).toBe(true);
    });
  });

  it('encrypted: one padded object, its chunks sealed and each sent with its digest; the secret and the name never reach the server', async () => {
    await withServer({}, async (server) => {
      const client = new DropgateClient({ server: server.baseUrl });
      const name = 'Bank statements for Sam.pdf';
      const bytes = fileBytes(CHUNK * 3 + 5000, 2);
      const value = await upload(client, new File([bytes], name), { encrypt: true, maxDownloads: 1 });

      // The link: the ID, then 32 bytes of secret as 43 characters of URL-safe base64.
      const link = new URL(value.downloadUrl);
      expect(`${link.origin}${link.pathname}`).toBe(`${server.baseUrl}/${value.id}`);
      const secret = link.hash.slice(1);
      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(secret, 'base64url')).toHaveLength(32);

      // What the server stores is the object: its header, then the padded file sealed in chunks.
      const stored = fs.readFileSync(path.join(server.uploadsDir, 'objects', value.id));
      const expectedSize = encryptedSize(padme(bytes.length), CHUNK);
      expect(stored.length, 'the stored object, padding and tags included').toBe(expectedSize);
      expect(stored.length).toBeGreaterThan(60 + bytes.length + 16 * 4);
      expect(stored.subarray(0, 4).toString('latin1')).toBe('DGUP');
      expect(stored.includes(Buffer.from(bytes.subarray(1000, 1064))), 'the stored object holds plaintext').toBe(false);
      expect(stored.includes(Buffer.from(name)), 'the stored object holds the name').toBe(false);

      // The start carries the header, the sealed list and the manage token's hash, and no list in plain.
      const requests = server.requests();
      const start = JSON.parse(requests.find((r) => r.url === '/api/v4/uploads')!.body.toString('utf8'));
      expect(Object.keys(start).sort()).toEqual(['encrypted', 'header', 'lifetimeMs', 'manageTokenHash', 'maxDownloads', 'meta', 'size']);
      expect(start).toMatchObject({ encrypted: true, size: expectedSize, maxDownloads: 1 });
      expect(Buffer.from(start.header, 'base64url').equals(stored.subarray(0, 60))).toBe(true);
      expect(start.manageTokenHash).toBe(createHash('sha256').update(Buffer.from(value.manageToken!, 'base64url')).digest('base64url'));

      // Each chunk once, in order, named by the upload's header, with a digest that matches it.
      const chunks = requests.filter((r) => r.method === 'PUT');
      expect(chunks.map((r) => r.url)).toEqual([0, 1, 2, 3].map((i) => `/api/v4/upload/chunks/${i}`));
      for (const chunk of chunks) {
        expect(chunk.headers['content-digest']).toBe(`sha-256=:${createHash('sha256').update(chunk.body).digest('base64')}:`);
        expect(chunk.headers['dropgate-upload']).toBeTruthy();
      }
      // No request holds the secret, the name, or the manage token, however it's written.
      expect(holding(server, spellings(secret)), 'requests holding the secret').toEqual([]);
      expect(holding(server, [Buffer.from(name), Buffer.from(encodeURIComponent(name))]), 'requests holding the name').toEqual([]);
      expect(holding(server, spellings(value.manageToken!)), 'requests holding the manage token').toEqual([]);
      // Nor does any URL hold the upload in progress.
      const uploadIds = new Set(chunks.map((r) => String(r.headers['dropgate-upload'])));
      expect(requests.filter((r) => [...uploadIds].some((id) => r.url.includes(id)))).toEqual([]);

      expect(await client.hosted.metadata({ id: value.id, secret })).toEqual({
        kind: 'file', id: value.id, encrypted: true, files: [{ name, size: bytes.length }], totalSize: bytes.length, transport: { secure: true },
      });
      const got = await download(client, value.id, secret);
      expect(got.value).toEqual({ filename: name, receivedBytes: bytes.length, wasEncrypted: true, transport: { secure: true } });
      expect(got.bytes.equals(Buffer.from(bytes))).toBe(true);

      // One lease, in its header, released as the download ended: at a limit of 1 the upload is gone at once.
      expect(routes(server).filter((route) => route.includes('lease'))).toEqual([`POST /api/v4/objects/${value.id}/leases`, 'DELETE /api/v4/lease']);
      await expect(client.hosted.metadata({ id: value.id, secret })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(server.storedFiles()).toEqual([]);
      expect(holding(server, spellings(secret)), 'requests holding the secret').toEqual([]);
    });
  });

  it('a server whose chunk size changed since the upload still serves it: the object records its own', async () => {
    await withServer({ UPLOAD_PRESERVE_UPLOADS: 'true' }, async (server) => {
      const before = new DropgateClient({ server: server.baseUrl });
      const bytes = fileBytes(CHUNK * 2 + 7, 3);
      const encrypted = await upload(before, new File([bytes], 'sealed.bin'), { encrypt: true });
      const plain = await upload(before, new File([bytes], 'plain.bin'), { encrypt: false });

      await server.restart({ env: { UPLOAD_CHUNK_SIZE_BYTES: String(CHUNK * 2) } });
      const after = new DropgateClient({ server: server.baseUrl });
      expect((await after.server.info()).capabilities?.upload?.chunkSize).toBe(CHUNK * 2);

      const secret = new URL(encrypted.downloadUrl).hash.slice(1);
      expect((await download(after, encrypted.id, secret)).bytes.equals(Buffer.from(bytes))).toBe(true);
      expect((await download(after, plain.id)).bytes.equals(Buffer.from(bytes))).toBe(true);
      // And a new upload takes the new size.
      const fresh = await upload(after, new File([bytes], 'fresh.bin'), { encrypt: true });
      expect((await download(after, fresh.id, new URL(fresh.downloadUrl).hash.slice(1))).bytes.equals(Buffer.from(bytes))).toBe(true);
    });
  });

  it("checks the server's limit against the stored size: padding is clamped to it, and a file too large unpadded is refused before it starts", async () => {
    await withServer({ UPLOAD_MAX_FILE_SIZE_MB: '1' }, async (server) => {
      const client = new DropgateClient({ server: server.baseUrl });
      // Padmé would take this past 1 MiB stored, so the padding stops at exactly 1 MiB.
      const near = 1_040_000;
      expect(encryptedSize(padme(near), CHUNK)).toBeGreaterThan(MiB);
      const bytes = fileBytes(near, 4);
      const value = await upload(client, new File([bytes], 'near.bin'), { encrypt: true });
      expect(fs.statSync(path.join(server.uploadsDir, 'objects', value.id)).size).toBe(MiB);
      expect(encryptedSize(paddedLength(near, CHUNK, MiB), CHUNK)).toBe(MiB);
      expect((await download(client, value.id, new URL(value.downloadUrl).hash.slice(1))).bytes.equals(Buffer.from(bytes))).toBe(true);

      // The most that fits encrypted: 1 MiB less the header and a tag per chunk. One byte more doesn't.
      const most = MiB - 60 - 16 * 16;
      expect(encryptedSize(most, CHUNK)).toBe(MiB);
      const fits = await upload(client, new File([fileBytes(most, 5)], 'most.bin'), { encrypt: true });
      expect(fs.statSync(path.join(server.uploadsDir, 'objects', fits.id)).size).toBe(MiB);
      const starts = () => routes(server).filter((route) => route === 'POST /api/v4/uploads').length;
      const started = starts();
      const over = await client.hosted.upload({ files: new File([new Uint8Array(most + 1)], 'over.bin'), lifetimeMs: 60_000, encrypt: true }).result;
      expect(over.status === 'failed' && over.error.code).toBe('FILE_TOO_LARGE');
      expect(starts(), 'uploads started for a file too large').toBe(started);

      // Unencrypted, the limit is the file's own size.
      expect((await upload(client, new File([new Uint8Array(MiB)], 'exact.bin'), { encrypt: false })).id).toMatch(UPLOAD_ID);
      const plainOver = await client.hosted.upload({ files: new File([new Uint8Array(MiB + 1)], 'over.bin'), lifetimeMs: 60_000, encrypt: false }).result;
      expect(plainOver.status === 'failed' && plainOver.error.code).toBe('FILE_TOO_LARGE');
    });
  });

  it("counts the stored, padded size against the server's storage", async () => {
    // Room for the file's 1,040,000 bytes and its tags, but not for its padding.
    await withServer({ UPLOAD_MAX_FILE_SIZE_MB: '0', UPLOAD_MAX_STORAGE_GB: '0.00097' }, async (server) => {
      const client = new DropgateClient({ server: server.baseUrl });
      const room = Math.floor(0.00097 * 1024 ** 3);
      const near = 1_040_000;
      expect(encryptedSize(near, CHUNK)).toBeLessThan(room);
      expect(encryptedSize(padme(near), CHUNK)).toBeGreaterThan(room);
      const outcome = await client.hosted.upload({ files: new File([new Uint8Array(near)], 'near.bin'), lifetimeMs: 60_000, encrypt: true }).result;
      expect(outcome.status === 'failed' && outcome.error).toMatchObject({ code: 'SERVER_FULL', status: 507 });
      // Unencrypted, it isn't padded, and fits.
      expect((await upload(client, new File([new Uint8Array(near)], 'near.bin'), { encrypt: false })).id).toMatch(UPLOAD_ID);
    });
  });
});

/** A copy of `body` that gives its first `bytes` bytes, then drops as a lost connection does. */
function cutAfter(body: ReadableStream<Uint8Array>, bytes: number): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let left = bytes;
  return new ReadableStream({
    async pull(controller) {
      if (left <= 0) {
        // The connection goes: the server's answer is never read to its end.
        await reader.cancel().catch(() => {});
        controller.error(new TypeError('terminated'));
        return;
      }
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      const part = value.subarray(0, left);
      left -= part.byteLength;
      controller.enqueue(part);
    },
  });
}

/** Numbers from a seed, the same every run, so a failure can be run again. */
const seeded = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) >>> 0;
  return seed / 2 ** 32;
};

/** The content requests the server got, as their Range, If-Range and lease. */
const contentRequests = (requests: ReturnType<Server['requests']>) => requests
  .filter((r) => r.method === 'GET' && /^\/api\/v4\/objects\/[^/]+\/content$/.test(r.url))
  .map((r) => ({ range: r.headers.range, ifRange: r.headers['if-range'], lease: r.headers['dropgate-lease'] }));

describe('Retries and reconnecting downloads, against the real server', { timeout: 60_000 }, () => {
  it('a chunk that gets a 500, a reset, a 429 with Retry-After, no answer in time, or an answer lost on the way back is sent again, the same sealed bytes, and the upload completes intact', async () => {
    await withServer({}, async (server) => {
      const faults = ['500', 'reset', '429', 'no answer', 'answer lost'];
      const fetchFn: typeof fetch = async (input, init = {}) => {
        const fault = init.method === 'PUT' ? faults.shift() : undefined;
        if (fault === '500') return new Response(JSON.stringify({ code: 'SERVER_ERROR', error: 'Something went wrong on the server.' }), { status: 500 });
        if (fault === 'reset') throw new TypeError('fetch failed');
        if (fault === '429') return new Response(JSON.stringify({ code: 'RATE_LIMITED', error: 'Too many requests.' }), { status: 429, headers: { 'Retry-After': '1' } });
        if (fault === 'no answer') {
          return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true }));
        }
        if (fault === 'answer lost') {
          await (await fetch(input, init)).text();
          throw new TypeError('terminated');
        }
        return fetch(input, init);
      };
      const client = new DropgateClient({ server: server.baseUrl, fetchFn });
      const bytes = fileBytes(CHUNK * 2 + 999, 11);
      const started = Date.now();
      const outcome = await client.hosted.upload({
        files: new File([bytes], 'retried.bin'), lifetimeMs: 60 * 60 * 1000, encrypt: true,
        timeouts: { chunkMs: 500 }, retry: { backoffMs: 10 },
      }).result;
      if (outcome.status !== 'completed') throw outcome.status === 'failed' ? outcome.error : new Error('Cancelled.');
      expect(Date.now() - started, "the 429's Retry-After was waited").toBeGreaterThanOrEqual(1000);

      // The server got chunk 0 twice (its answer was lost the first time), the same bytes both times, then the rest once.
      const puts = server.requests().filter((r) => r.method === 'PUT');
      expect(puts.map((r) => r.url)).toEqual(['/api/v4/upload/chunks/0', '/api/v4/upload/chunks/0', '/api/v4/upload/chunks/1', '/api/v4/upload/chunks/2']);
      expect(puts[1].body.equals(puts[0].body)).toBe(true);
      expect(puts[1].headers['content-digest']).toBe(puts[0].headers['content-digest']);

      const got = await download(new DropgateClient({ server: server.baseUrl }), outcome.value.id, new URL(outcome.value.downloadUrl).hash.slice(1));
      expect(got.bytes.equals(Buffer.from(bytes))).toBe(true);
    });
  });

  it('a download cut off at random places continues with Range under the same lease, is byte for byte, and counts once, encrypted or not', async () => {
    await withServer({ UPLOAD_MAX_FILE_DOWNLOADS: '2' }, async (server) => {
      const uploader = new DropgateClient({ server: server.baseUrl });
      const bytes = fileBytes(CHUNK * 5 + 4321, 12);
      const random = seeded(7);
      for (const encrypt of [true, false]) {
        const value = await upload(uploader, new File([bytes], 'cut.bin'), { encrypt, maxDownloads: 2 });
        const secret = encrypt ? new URL(value.downloadUrl).hash.slice(1) : undefined;
        const before = server.requests().length;
        const cuts = Array.from({ length: 4 }, () => Math.floor(random() * CHUNK));
        const fetchFn: typeof fetch = async (input, init = {}) => {
          const res = await fetch(input, init);
          const cut = String(input).endsWith('/content') ? cuts.shift() : undefined;
          return cut === undefined || !res.body ? res : new Response(cutAfter(res.body, cut), { status: res.status, headers: res.headers });
        };
        const { sink, bytes: got } = keeping();
        const outcome = await new DropgateClient({ server: server.baseUrl, fetchFn }).hosted.download({ id: value.id, secret, sink, retry: { backoffMs: 10 } }).result;
        expect(outcome.status, `encrypted: ${encrypt}`).toBe('completed');
        expect(got().equals(Buffer.from(bytes)), `encrypted: ${encrypt}: byte for byte`).toBe(true);

        const asked = contentRequests(server.requests().slice(before));
        expect(asked.length, `encrypted: ${encrypt}`).toBe(5);
        expect(new Set(asked.map((a) => a.lease)).size, 'one lease').toBe(1);
        const leases = server.requests().slice(before).filter((r) => r.url.endsWith('/leases') || r.url === '/api/v4/lease');
        expect(leases.map((r) => r.method), 'taken once, released once').toEqual(['POST', 'DELETE']);
        for (const { range, ifRange } of asked.filter((a) => a.range !== undefined)) {
          expect(ifRange).toBe(`"${value.id}"`);
          const from = Number(/^bytes=(\d+)-$/.exec(String(range))![1]);
          // Encrypted, from a whole chunk; unencrypted, from the next byte.
          if (encrypt) expect((from - 60) % (CHUNK + 16), `${range}`).toBe(0);
        }

        // It counted once: one more download is allowed, and then the upload is gone.
        expect((await download(uploader, value.id, secret)).bytes.equals(Buffer.from(bytes))).toBe(true);
        await expect(uploader.hosted.metadata({ id: value.id, secret })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      }
    });
  });

  it("refuses to append the whole upload the server sends when a resumed download's If-Range doesn't match", async () => {
    await withServer({}, async (server) => {
      const uploader = new DropgateClient({ server: server.baseUrl });
      const bytes = fileBytes(CHUNK * 3 + 10, 13);
      const value = await upload(uploader, new File([bytes], 'changed.bin'), { encrypt: true });
      let first = true;
      const fetchFn: typeof fetch = async (input, init = {}) => {
        const headers = new Headers(init.headers);
        // As if the upload had changed since the download started.
        if (headers.has('If-Range')) headers.set('If-Range', '"another upload"');
        const res = await fetch(input, { ...init, headers });
        if (!String(input).endsWith('/content') || !first) return res;
        first = false;
        return new Response(cutAfter(res.body!, 60 + (CHUNK + 16) + 100), { status: res.status, headers: res.headers });
      };
      const { sink, bytes: got } = keeping();
      const aborted: unknown[] = [];
      const outcome = await new DropgateClient({ server: server.baseUrl, fetchFn }).hosted.download({
        id: value.id, secret: new URL(value.downloadUrl).hash.slice(1), sink: { ...sink, abort: (reason) => { aborted.push(reason); } }, retry: { backoffMs: 10 },
      }).result;
      expect(outcome.status === 'failed' && outcome.error.code).toBe('INTEGRITY_FAILED');
      expect(got().equals(Buffer.from(bytes.subarray(0, CHUNK))), 'only the chunk before the cut').toBe(true);
      expect(aborted).toHaveLength(1);
      expect(contentRequests(server.requests()).map((a) => a.ifRange)).toEqual([undefined, '"another upload"']);
    });
  });
});

describe("The uploader's delete, against the real server", { timeout: 60_000 }, () => {
  it('deletes the upload with its manage token, sent only in Dropgate-Manage-Token: its details and bytes are gone, and a download under way stops', async () => {
    await withServer({}, async (server) => {
      const client = new DropgateClient({ server: server.baseUrl });
      // Large enough that the server is still sending when the delete comes.
      const bytes = fileBytes(8 * MiB, 14);
      const value = await upload(client, new File([bytes], 'to delete.bin'), { encrypt: true, maxDownloads: 0 });
      const secret = new URL(value.downloadUrl).hash.slice(1);
      const token = value.manageToken!;

      // A token that isn't the upload's deletes nothing.
      const wrong = Buffer.alloc(32, 1).toString('base64url');
      await expect(client.hosted.delete({ id: value.id, manageToken: wrong })).rejects.toMatchObject({ code: 'REQUEST_REJECTED', status: 403 });
      expect(server.storedFiles()).toEqual([`objects/${value.id}`]);

      // A download under way, held at its first write.
      let release = () => {};
      const held = new Promise<void>((resolve) => { release = resolve; });
      let writes = 0;
      const downloading = client.hosted.download({
        id: value.id, secret, retry: { backoffMs: 10 },
        sink: { write: async () => { if (writes++ === 0) await held; }, close: () => {} },
      });
      await expect.poll(() => writes).toBe(1);

      await expect(client.hosted.delete({ id: value.id, manageToken: token })).resolves.toBeUndefined();
      release();
      const stopped = await downloading.result;
      expect(stopped.status === 'failed' && stopped.error.code, 'the download under way').toBe('NOT_FOUND');

      expect(server.storedFiles()).toEqual([]);
      await expect(client.hosted.metadata({ id: value.id, secret })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const content = await fetch(`${server.baseUrl}/api/v4/objects/${value.id}/leases`, { method: 'POST' });
      expect(content.status, 'a new lease').toBe(404);
      await expect(client.hosted.delete({ id: value.id, manageToken: token })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

      // The token went in its header, in the deletes, and nowhere else.
      const withToken = holding(server, spellings(token));
      expect(withToken).toEqual([`DELETE /api/v4/objects/${value.id}`, `DELETE /api/v4/objects/${value.id}`]);
      for (const request of server.requests().filter((r) => r.method === 'DELETE' && r.url.startsWith('/api/v4/objects/'))) {
        expect(request.url.includes(token)).toBe(false);
        expect(request.headers.authorization).toBeUndefined();
      }
    });
  });
});
