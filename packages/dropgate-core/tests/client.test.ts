import { describe, it, expect } from 'vitest';
import { DropgateClient, getServerInfo } from '../src/index.js';
import type { FileSource, UploadSession } from '../src/index.js';
import { onlyFailsWith } from './helpers/known-issue.js';

// DropgateClient against a fake server, through its `fetchFn` option: no
// network. A known issue states the behaviour the v4 core rework must have, and
// is marked `it.fails` until then.

const BASE_URL = 'https://files.example';
const FILE_ID = '0b7d4c52-5f0e-4d8e-9a57-3c1f2e6b8a90';
const BUNDLE_ID = '6a1e9f3b-2c4d-4b7a-8e5f-9d0c1b2a3e4f';
// An AES-256 key in base64, as it appears after the # in an encrypted link.
const LINK_KEY = 'q3Rk8vXo2LmN5pT7wYc9ZbHd4sFj6gKa1eUi0rQnVxM=';
const CHUNK_SIZE = 4;

interface RecordedRequest {
  method: string;
  url: string;
  headers: string;
  body: string;
  credentials: RequestCredentials | undefined;
}

/**
 * A fake Dropgate server behind `fetchFn`. It records every request and
 * answers the upload and resolve endpoints. `onChunk` runs while a chunk
 * request is in flight, before the server answers it.
 */
function fakeServer() {
  const requests: RecordedRequest[] = [];
  const chunkIndexes: number[] = [];
  let onChunk: (index: number) => void = () => {};

  const json = (status: number, value: unknown): Response =>
    new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

  const fetchFn = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const headers = (init.headers ?? {}) as Record<string, string>;
    requests.push({
      method,
      url,
      headers: JSON.stringify(headers),
      body: typeof init.body === 'string' ? init.body : '',
      credentials: init.credentials,
    });

    // Answer on a later turn of the event loop, like a real network.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const path = new URL(url).pathname;
    if (method === 'POST' && path === '/upload/chunk') {
      const index = Number(headers['X-Chunk-Index']);
      chunkIndexes.push(index);
      onChunk(index);
    }
    if (init.signal?.aborted) {
      throw init.signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
    }

    switch (`${method} ${path}`) {
      case 'GET /api/info':
        return json(200, {
          name: 'Test server',
          version: '3.0.13',
          capabilities: {
            upload: { enabled: true, maxSizeMB: 0, maxLifetimeHours: 0, e2ee: true, chunkSize: CHUNK_SIZE },
          },
        });
      case 'POST /api/resolve':
        return json(200, { valid: true, type: 'file', target: `/${FILE_ID}` });
      case 'POST /upload/init':
        return json(200, { uploadId: 'upload-1' });
      case 'POST /upload/chunk':
        return json(200, {});
      case 'POST /upload/complete':
        return json(200, { id: FILE_ID });
      case 'POST /upload/cancel':
        return json(200, {});
      case `GET /api/file/${FILE_ID}/meta`:
        return json(200, { isEncrypted: false, sizeBytes: CHUNK_SIZE, filename: 'notes.txt' });
      case `GET /api/file/${FILE_ID}`:
        return new Response(new Uint8Array(CHUNK_SIZE));
      case `GET /api/bundle/${BUNDLE_ID}/meta`:
        return json(200, { isEncrypted: false, files: [{ fileId: FILE_ID, sizeBytes: CHUNK_SIZE, filename: 'notes.txt' }] });
      case `POST /api/bundle/${BUNDLE_ID}/downloaded`:
        return json(200, {});
      case 'POST /upload/init-bundle':
        return json(200, { bundleUploadId: 'bundle-1', fileUploadIds: ['upload-1', 'upload-2'] });
      case 'POST /upload/complete-bundle':
        return json(200, { bundleId: BUNDLE_ID });
      default:
        return json(404, { error: 'Not found.' });
    }
  };

  return {
    fetchFn,
    requests,
    chunkIndexes,
    paths: () => requests.map((r) => `${r.method} ${new URL(r.url).pathname}`),
    set onChunk(callback: (index: number) => void) { onChunk = callback; },
  };
}

function createClient(fetchFn: typeof fetch): DropgateClient {
  return new DropgateClient({ clientVersion: '3.0.13', server: BASE_URL, fetchFn });
}

/** Every run of `length` characters in `text`. */
function piecesOf(text: string, length: number): string[] {
  const pieces: string[] = [];
  for (let i = 0; i + length <= text.length; i++) pieces.push(text.slice(i, i + length));
  return pieces;
}

describe('DropgateClient', () => {
  it.fails(
    'cancel() stops an upload that was given an external AbortSignal (known issue until the v4 core rework)',
    onlyFailsWith(/the upload kept going after cancel\(\)/, async () => {
      const server = fakeServer();
      const client = createClient(server.fetchFn);
      const external = new AbortController();
      let session: UploadSession | undefined;
      let cancelPressed = false;
      server.onChunk = (index) => {
        if (index === 0 && session) {
          session.cancel();
          cancelPressed = true;
        }
      };

      // Two chunks, with cancel() pressed while the first is uploading.
      session = await client.uploadFiles({
        files: new File([new Uint8Array(CHUNK_SIZE * 2)], 'notes.txt', { type: 'text/plain' }) as unknown as FileSource,
        lifetimeMs: 60_000,
        encrypt: false,
        signal: external.signal,
        retry: { retries: 0 },
      });
      const outcome = await session.result.then(() => 'resolved', () => 'rejected');
      expect(cancelPressed, 'cancel() should be pressed during the first chunk').toBe(true);

      expect(
        { chunks: server.chunkIndexes, completed: server.paths().includes('POST /upload/complete'), status: session.getStatus() },
        'the upload kept going after cancel()'
      ).toEqual({ chunks: [0], completed: false, status: 'cancelled' });
      expect(outcome).toBe('rejected');
    })
  );

  it('resolving a link never sends any part of its #fragment to the server, and keeps the key for the page it opens', async () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);

    const file = await client.resolveShareTarget(`${BASE_URL}/${FILE_ID}#${LINK_KEY}`);
    const bundle = await client.resolveShareTarget(`${BASE_URL}/b/${BUNDLE_ID}#${LINK_KEY}`);
    expect(server.paths(), 'both links should be resolved').toEqual([
      'GET /api/info',
      'POST /api/resolve',
      'POST /api/resolve',
    ]);

    // Any 8 characters of the key in a request's URL, headers or body count.
    const pieces = piecesOf(LINK_KEY, 8);
    const leaks = server.requests.flatMap((req) => {
      const sent = [req.url, decodeURIComponent(req.url), req.headers, req.body].join('\n');
      return pieces.some((piece) => sent.includes(piece)) ? [`${req.method} ${req.url} ${req.body}`] : [];
    });
    expect(leaks, "part of the link's #fragment reached the server").toEqual([]);

    // Only the IDs were asked about, never the links.
    expect(server.requests.slice(1).map((r) => JSON.parse(r.body))).toEqual([{ value: FILE_ID }, { value: BUNDLE_ID }]);
    expect(file.target, 'where the file link opens').toBe(`/${FILE_ID}#${LINK_KEY}`);
    expect(bundle.valid).toBe(true);
    expect(bundle.target?.endsWith(`#${LINK_KEY}`), 'the bundle link keeps its key').toBe(true);
  });

  it('refuses a link to another server without asking this one about it', async () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);

    const result = await client.resolveShareTarget(`https://elsewhere.example/${FILE_ID}#${LINK_KEY}`);
    expect(result).toEqual({ valid: false, reason: 'URL must be from this server.' });
    expect(server.paths()).not.toContain('POST /api/resolve');
  });

  it('refuses a link with no file, bundle or code in it without asking the server', async () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);

    const result = await client.resolveShareTarget(`${BASE_URL}/about#${LINK_KEY}`);
    expect(result.valid).toBe(false);
    expect(server.requests).toEqual([]);
  });

  it('sends a typed code or ID as it is, without anything after a #', async () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);

    await client.resolveShareTarget(' abcd-1234 ');
    await client.resolveShareTarget(`${FILE_ID}#${LINK_KEY}`);
    expect(server.requests.filter((r) => r.url.endsWith('/api/resolve')).map((r) => JSON.parse(r.body)))
      .toEqual([{ value: 'abcd-1234' }, { value: FILE_ID }]);
  });

  // Dropgate uses no cookies. A browser reads its cookie store before any
  // request that may carry them, and a new profile's store only loads from disk
  // then, which once held the desktop app's first server check for over 5 s.
  it('omits credentials from every request it makes', async () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);
    const file = (name: string) => new File([new Uint8Array(CHUNK_SIZE)], name) as unknown as FileSource;

    await getServerInfo({ server: BASE_URL, fetchFn: server.fetchFn });
    await client.connect();
    await client.resolveShareTarget(`${BASE_URL}/${FILE_ID}#${LINK_KEY}`);
    await client.getFileMetadata(FILE_ID);
    await client.getBundleMetadata(BUNDLE_ID);
    await (await client.uploadFiles({ files: file('one.txt'), lifetimeMs: 60_000, encrypt: false })).result;
    await (await client.uploadFiles({ files: [file('one.txt'), file('two.txt')], lifetimeMs: 60_000, encrypt: false })).result;
    await client.downloadFiles({ fileId: FILE_ID });
    await client.downloadFiles({ bundleId: BUNDLE_ID, asZip: true, onData: () => {} });
    const cancelled = await client.uploadFiles({ files: file('three.txt'), lifetimeMs: 60_000, encrypt: false, retry: { retries: 0 } });
    server.onChunk = () => cancelled.cancel();
    await cancelled.result.catch(() => {});
    // cancel() tells the server without waiting for it.
    await expect.poll(() => server.paths()).toContain('POST /upload/cancel');

    const paths = new Set(server.paths());
    for (const path of [
      'GET /api/info', 'POST /api/resolve', `GET /api/file/${FILE_ID}/meta`, `GET /api/bundle/${BUNDLE_ID}/meta`,
      'POST /upload/init', 'POST /upload/chunk', 'POST /upload/complete', 'POST /upload/init-bundle',
      'POST /upload/complete-bundle', `GET /api/file/${FILE_ID}`, `POST /api/bundle/${BUNDLE_ID}/downloaded`,
      'POST /upload/cancel',
    ]) {
      expect(paths.has(path), `the test should make ${path}`).toBe(true);
    }
    expect(
      server.requests.filter((r) => r.credentials !== 'omit').map((r) => `${r.method} ${new URL(r.url).pathname}: ${r.credentials}`),
      'requests that could carry cookies'
    ).toEqual([]);
  });
});
