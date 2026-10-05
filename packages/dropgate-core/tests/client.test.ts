import { describe, it, expect } from 'vitest';
import { open, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DropgateClient, DropgateError, getServerInfo, fileHandleSource } from '../src/index.js';
import type { DownloadOutcome, FileSource, Outcome, UploadHandle, UploadSnapshot } from '../src/index.js';

// DropgateClient against a fake server, through its `fetchFn` option: no
// network.

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
  const chunkBodies: Uint8Array[] = [];
  let onChunk: (index: number) => void = () => {};
  // Answers that replace the usual one, by `METHOD /path`. One that throws is a network failure.
  const answers = new Map<string, (init: RequestInit) => Response | Promise<Response>>();

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
      if (init.body instanceof Blob) chunkBodies.push(new Uint8Array(await init.body.arrayBuffer()));
      onChunk(index);
    }
    if (init.signal?.aborted) {
      throw init.signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
    }

    const answer = answers.get(`${method} ${path}`);
    if (answer) return answer(init);

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
    chunkBodies,
    paths: () => requests.map((r) => `${r.method} ${new URL(r.url).pathname}`),
    set onChunk(callback: (index: number) => void) { onChunk = callback; },
    answer: (route: string, respond: ((init: RequestInit) => Response | Promise<Response>) | null) => {
      if (respond) answers.set(route, respond);
      else answers.delete(route);
    },
    json,
  };
}

/** A response whose body never ends, like a download still arriving. */
function endlessBody(): Response {
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(CHUNK_SIZE)); } }));
}

/** An answer that never comes: the request waits until it's aborted, as a real one would. */
function noAnswer(init: RequestInit): Promise<never> {
  return new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
  });
}

const fileNamed = (name: string, chunks = 1) => new File([new Uint8Array(CHUNK_SIZE * chunks)], name);

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
  // v3's bug: with a signal passed in, the upload used that signal instead of
  // its own, so cancel() told the server but the chunks kept going.
  it('cancel() stops an upload that was given an external AbortSignal', async () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);
    const external = new AbortController();
    let upload: UploadHandle | undefined;
    let cancelPressed = false;
    server.onChunk = (index) => {
      if (index === 0 && upload) {
        upload.cancel();
        cancelPressed = true;
      }
    };

    // Two chunks, with cancel() pressed while the first is uploading.
    upload = client.uploadFiles({
      files: new File([new Uint8Array(CHUNK_SIZE * 2)], 'notes.txt', { type: 'text/plain' }),
      lifetimeMs: 60_000,
      encrypt: false,
      signal: external.signal,
      retry: { retries: 0 },
    });
    const outcome = await upload.result;
    expect(cancelPressed, 'cancel() should be pressed during the first chunk').toBe(true);

    expect(
      { chunks: server.chunkIndexes, completed: server.paths().includes('POST /upload/complete'), status: upload.snapshot.status },
      'the upload kept going after cancel()'
    ).toEqual({ chunks: [0], completed: false, status: 'cancelled' });
    expect(outcome).toEqual({ status: 'cancelled', cancellation: { by: 'self', source: 'upload' } });
    // The signal passed in is the caller's: cancel() never aborts it.
    expect(external.signal.aborted).toBe(false);
  });

  it('aborting the AbortSignal passed in cancels the upload by signal, as its own cancel() would', async () => {
    const server = fakeServer();
    const external = new AbortController();
    server.onChunk = (index) => { if (index === 0) external.abort(); };
    const upload = createClient(server.fetchFn).uploadFiles({
      files: fileNamed('notes.txt', 3), lifetimeMs: 60_000, encrypt: false, signal: external.signal, retry: { retries: 0 },
    });

    expect(await upload.result).toEqual({ status: 'cancelled', cancellation: { by: 'signal', source: 'upload' } });
    expect(server.chunkIndexes).toEqual([0]);
    expect(server.paths()).not.toContain('POST /upload/complete');
    await expect.poll(() => server.paths()).toContain('POST /upload/cancel');
  });

  it('an upload given an AbortSignal that is already aborted is cancelled before it asks the server anything', async () => {
    const server = fakeServer();
    const upload = createClient(server.fetchFn).uploadFiles({
      files: fileNamed('notes.txt'), lifetimeMs: 60_000, encrypt: false, signal: AbortSignal.abort(),
    });
    expect(await upload.result).toEqual({ status: 'cancelled', cancellation: { by: 'signal', source: 'upload' } });
    expect(server.requests).toEqual([]);
  });

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
    const file = (name: string) => new File([new Uint8Array(CHUNK_SIZE)], name);

    await getServerInfo({ server: BASE_URL, fetchFn: server.fetchFn });
    await client.connect();
    await client.resolveShareTarget(`${BASE_URL}/${FILE_ID}#${LINK_KEY}`);
    await client.getFileMetadata(FILE_ID);
    await client.getBundleMetadata(BUNDLE_ID);
    const completed = [
      await client.uploadFiles({ files: file('one.txt'), lifetimeMs: 60_000, encrypt: false }).result,
      await client.uploadFiles({ files: [file('one.txt'), file('two.txt')], lifetimeMs: 60_000, encrypt: false }).result,
      await client.downloadFiles({ fileId: FILE_ID }),
      await client.downloadFiles({ bundleId: BUNDLE_ID, asZip: true, onData: () => {} }),
    ];
    expect(completed.map((outcome) => outcome.status)).toEqual(['completed', 'completed', 'completed', 'completed']);
    const cancelled = client.uploadFiles({ files: file('three.txt'), lifetimeMs: 60_000, encrypt: false, retry: { retries: 0 } });
    server.onChunk = () => cancelled.cancel();
    expect((await cancelled.result).status).toBe('cancelled');
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

/** The code of a failed outcome, or its status if it didn't fail. */
const codeOf = (outcome: Outcome<unknown>): string => (outcome.status === 'failed' ? outcome.error.code : outcome.status);

describe('Outcomes', () => {
  it('an upload ends with one completed outcome, with its link', async () => {
    const server = fakeServer();
    const upload = createClient(server.fetchFn).uploadFiles({ files: fileNamed('notes.txt'), lifetimeMs: 60_000, encrypt: false });
    const outcome = await upload.result;
    expect(outcome).toEqual({ status: 'completed', value: expect.objectContaining({ downloadUrl: `${BASE_URL}/${FILE_ID}`, fileId: FILE_ID }) });
    expect(upload.snapshot.status).toBe('completed');
  });

  it('cancel() ends an upload as cancelled by itself: no more chunks are sent, and the server is told', async () => {
    const server = fakeServer();
    const upload = createClient(server.fetchFn).uploadFiles({
      files: fileNamed('notes.txt', 3), lifetimeMs: 60_000, encrypt: false, retry: { retries: 0 },
    });
    server.onChunk = (index) => { if (index === 0) upload.cancel(); };

    expect(await upload.result).toEqual({ status: 'cancelled', cancellation: { by: 'self', source: 'upload' } });
    expect(upload.snapshot.status).toBe('cancelled');
    expect(server.chunkIndexes).toEqual([0]);
    expect(server.paths()).not.toContain('POST /upload/complete');
    await expect.poll(() => server.requests.filter((r) => r.url.endsWith('/upload/cancel')).map((r) => JSON.parse(r.body)))
      .toEqual([{ uploadId: 'upload-1' }]);

    // Once it has ended, cancel() does nothing.
    upload.cancel();
    expect(upload.snapshot.status).toBe('cancelled');
  });

  it('cancelAll() cancels every upload and download running, each by its parent, once, and the client keeps working', async () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);
    server.answer(`GET /api/file/${FILE_ID}`, endlessBody);
    server.answer('POST /upload/chunk', noAnswer);

    const settled: string[] = [];
    const download = client.downloadFiles({ fileId: FILE_ID, onData: () => {} }).then((o) => { settled.push('download'); return o; });
    const handle = client.uploadFiles({ files: [fileNamed('one.txt'), fileNamed('two.txt')], lifetimeMs: 60_000, encrypt: false });
    const upload = handle.result.then((o) => { settled.push('upload'); return o; });
    await expect.poll(() => server.paths()).toEqual(expect.arrayContaining([`GET /api/file/${FILE_ID}`, 'POST /upload/chunk']));

    client.cancelAll();
    const byClient = { status: 'cancelled', cancellation: { by: 'parent', source: 'client' } };
    expect(await download).toEqual(byClient);
    expect(await upload).toEqual(byClient);
    expect(settled.sort()).toEqual(['download', 'upload']);
    await expect.poll(() => server.requests.filter((r) => r.url.endsWith('/upload/cancel')).map((r) => JSON.parse(r.body).uploadId))
      .toEqual(['upload-1', 'upload-2']);

    // A cancel after the fact reaches nothing, and new operations run as normal.
    client.cancelAll();
    server.answer('POST /upload/chunk', null);
    server.answer(`GET /api/file/${FILE_ID}`, null);
    const next = client.uploadFiles({ files: fileNamed('three.txt'), lifetimeMs: 60_000, encrypt: false });
    expect((await next.result).status).toBe('completed');
    expect((await client.downloadFiles({ fileId: FILE_ID })).status).toBe('completed');
    expect(settled.sort()).toEqual(['download', 'upload']);
  });

  it('a download whose signal is aborted ends as cancelled by signal', async () => {
    const server = fakeServer();
    server.answer(`GET /api/file/${FILE_ID}`, endlessBody);
    const controller = new AbortController();
    const download = createClient(server.fetchFn).downloadFiles({ fileId: FILE_ID, onData: () => {}, signal: controller.signal });
    await expect.poll(() => server.paths()).toContain(`GET /api/file/${FILE_ID}`);
    controller.abort();
    expect(await download).toEqual({ status: 'cancelled', cancellation: { by: 'signal', source: 'download' } });
  });

  it('a failure ends as failed, with the code for what went wrong', async () => {
    const run = async (setUp: (server: ReturnType<typeof fakeServer>) => void, operation: (client: DropgateClient) => Promise<Outcome<unknown>>) => {
      const server = fakeServer();
      setUp(server);
      return codeOf(await operation(createClient(server.fetchFn)));
    };
    const upload = (files: File | File[] = fileNamed('notes.txt')) => (client: DropgateClient) =>
      client.uploadFiles({ files, lifetimeMs: 60_000, encrypt: false, retry: { retries: 0 } }).result;
    const download = (opts: { keyB64?: string; onData?: () => void } = {}) => (client: DropgateClient): Promise<DownloadOutcome> =>
      client.downloadFiles({ fileId: FILE_ID, ...opts });
    const encryptedMeta = (s: ReturnType<typeof fakeServer>) => s.answer(`GET /api/file/${FILE_ID}/meta`, () =>
      s.json(200, { isEncrypted: true, sizeBytes: 64, encryptedFilename: Buffer.from(new Uint8Array(48)).toString('base64') }));

    const codes = {
      tooLarge: await run((s) => s.answer('POST /upload/init', () => s.json(413, { error: 'File exceeds limit of 1 MB.' })), upload()),
      rateLimited: await run((s) => s.answer('POST /upload/init', () => s.json(429, { error: 'Too many requests.' })), upload()),
      serverFull: await run((s) => s.answer('POST /upload/init', () => s.json(507, { error: 'Server out of capacity.' })), upload()),
      chunkServerError: await run((s) => s.answer('POST /upload/chunk', () => new Response('Write failed.', { status: 500 })), upload()),
      unreachable: await run((s) => s.answer('POST /upload/init', () => { throw new TypeError('fetch failed'); }), upload()),
      noFileId: await run((s) => s.answer('POST /upload/complete', () => s.json(200, {})), upload()),
      empty: await run(() => {}, upload(new File([], 'empty.txt'))),
      unsupported: await run((s) => s.answer('GET /api/info', () => s.json(200, { version: '2.0.0', capabilities: {} })), upload()),
      notFound: await run((s) => s.answer(`GET /api/file/${FILE_ID}/meta`, () => s.json(404, { error: 'File not found.' })), download()),
      writeFailed: await run(() => {}, download({ onData: () => { throw new Error('Disk full.'); } })),
      keyRequired: await run(encryptedMeta, download()),
      wrongKey: await run(encryptedMeta, download({ keyB64: LINK_KEY })),
    };
    expect(codes).toEqual({
      tooLarge: 'FILE_TOO_LARGE', rateLimited: 'RATE_LIMITED', serverFull: 'SERVER_FULL', chunkServerError: 'SERVER_ERROR',
      unreachable: 'SERVER_UNREACHABLE', noFileId: 'INVALID_RESPONSE', empty: 'FILE_EMPTY', unsupported: 'VERSION_UNSUPPORTED',
      notFound: 'NOT_FOUND', writeFailed: 'OUTPUT_WRITE_FAILED', keyRequired: 'KEY_REQUIRED', wrongKey: 'DECRYPT_FAILED',
    });
  });

  it('keeps the server\'s own message and status on a failure it answered', async () => {
    const server = fakeServer();
    server.answer('POST /upload/init', () => server.json(413, { error: 'File exceeds limit of 1 MB.' }));
    const outcome = await createClient(server.fetchFn).uploadFiles({ files: fileNamed('notes.txt'), lifetimeMs: 60_000, encrypt: false }).result;
    expect(outcome.status === 'failed' && outcome.error).toMatchObject({ code: 'FILE_TOO_LARGE', status: 413, message: 'File exceeds limit of 1 MB.', origin: 'server', retryable: false });
  });

  it('throws INVALID_ARGUMENT for an upload with no files or something that isn\'t a file, or a download with nothing to download, before one starts', async () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);
    expect(() => client.uploadFiles({ files: [], lifetimeMs: 60_000 })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    // A Node.js file handle goes through fileHandleSource() first.
    const handle = { fd: 3, read: async () => ({ bytesRead: 0 }), stat: async () => ({ size: 4 }) };
    expect(() => client.uploadFiles({ files: handle as unknown as FileSource, lifetimeMs: 60_000 }))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT', message: 'File at index 0 is missing or invalid.' }));
    await expect(client.downloadFiles({})).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(server.requests).toEqual([]);
  });

  it("throws typed errors from the calls that aren't operations", async () => {
    const server = fakeServer();
    server.answer('GET /api/info', () => new Response('<html>Not Dropgate</html>', { status: 404 }));
    await expect(createClient(server.fetchFn).connect()).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 404 });

    const down = fakeServer();
    down.answer('GET /api/info', () => { throw new TypeError('fetch failed'); });
    const err = await createClient(down.fetchFn).connect().catch((e: unknown) => e);
    expect(DropgateError.is(err, 'SERVER_UNREACHABLE')).toBe(true);

    const gone = fakeServer();
    gone.answer(`GET /api/bundle/${BUNDLE_ID}/meta`, () => gone.json(404, { error: 'Bundle not found.' }));
    await expect(createClient(gone.fetchFn).getBundleMetadata(BUNDLE_ID)).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Bundle not found.' });

    const sealed = fakeServer();
    sealed.answer(`GET /api/bundle/${BUNDLE_ID}/meta`, () => sealed.json(200, { isEncrypted: true, sealed: true, encryptedManifest: 'AAAA' }));
    await expect(createClient(sealed.fetchFn).getBundleMetadata(BUNDLE_ID)).rejects.toMatchObject({ code: 'KEY_REQUIRED' });
    await expect(createClient(sealed.fetchFn).getBundleMetadata(BUNDLE_ID, LINK_KEY)).rejects.toMatchObject({ code: 'DECRYPT_FAILED' });
  });

  // Hard requirement 8: what a failed or cancelled operation reports is safe to
  // show and to log. Its value, when it completes, is the link the caller asked for.
  it("a failed or cancelled outcome never carries a file name or a key, even serialised", async () => {
    const name = 'Tax return 2026 for Sam.pdf';
    const reported: unknown[] = [];

    // An encrypted upload the server fails at the end, and one that's cancelled.
    const failing = fakeServer();
    failing.answer('POST /upload/complete', () => failing.json(500, { error: 'Server error during file validation.' }));
    const snapshots: UploadSnapshot[] = [];
    const failingUpload = createClient(failing.fetchFn).uploadFiles({ files: [fileNamed(name), fileNamed(`Copy of ${name}`)], lifetimeMs: 60_000, encrypt: true });
    failingUpload.subscribe((snapshot) => snapshots.push(snapshot));
    reported.push(await failingUpload.result);
    const cancelling = fakeServer();
    const cancelled = createClient(cancelling.fetchFn).uploadFiles({ files: fileNamed(name, 2), lifetimeMs: 60_000, encrypt: true });
    cancelled.subscribe((snapshot) => snapshots.push(snapshot));
    cancelling.onChunk = () => cancelled.cancel();
    reported.push(await cancelled.result);

    // A download with the wrong key, and one whose output fails with an error naming the file.
    const wrongKey = fakeServer();
    wrongKey.answer(`GET /api/file/${FILE_ID}/meta`, () =>
      wrongKey.json(200, { isEncrypted: true, sizeBytes: 64, encryptedFilename: Buffer.from(new Uint8Array(48)).toString('base64') }));
    reported.push(await createClient(wrongKey.fetchFn).downloadFiles({ fileId: FILE_ID, keyB64: LINK_KEY }));
    reported.push(await createClient(fakeServer().fetchFn).downloadFiles({
      fileId: FILE_ID, keyB64: LINK_KEY, onData: () => { throw new Error(`Couldn't write ${name} with key ${LINK_KEY}`); },
    }));

    expect(reported.map((o) => (o as Outcome<unknown>).status)).toEqual(['failed', 'cancelled', 'failed', 'failed']);
    const secrets = [...piecesOf(name, 8), ...piecesOf(LINK_KEY, 8)];
    for (const outcome of reported) {
      const shown = [JSON.stringify(outcome), (outcome as { error?: Error }).error?.message ?? ''].join('\n');
      expect(secrets.filter((piece) => shown.includes(piece)), shown).toEqual([]);
    }
    // Nor does any snapshot an upload gives along the way, the bundle's per-file steps included.
    expect(snapshots.some((snapshot) => snapshot.phase === 'file-start')).toBe(true);
    for (const snapshot of snapshots) {
      const shown = JSON.stringify(snapshot);
      expect(secrets.filter((piece) => shown.includes(piece)), shown).toEqual([]);
    }
  });
});

describe('The upload handle', () => {
  it('gives where the upload is as snapshots, each new and frozen, to every subscriber, ending with its outcome\'s status', async () => {
    const server = fakeServer();
    const upload = createClient(server.fetchFn).uploadFiles({
      files: [fileNamed('one.txt', 2), fileNamed('two.txt', 1)], lifetimeMs: 60_000, encrypt: false,
    });
    expect(upload.snapshot).toEqual({
      status: 'initializing', phase: 'server-info', text: 'Checking server...', percent: 0, processedBytes: 0, totalBytes: CHUNK_SIZE * 3,
    });

    const seen: UploadSnapshot[] = [];
    const alsoSeen: UploadSnapshot[] = [];
    upload.subscribe((snapshot) => seen.push(snapshot));
    const unsubscribe = upload.subscribe((snapshot) => alsoSeen.push(snapshot));
    upload.subscribe(() => { throw new Error('A subscriber that throws.'); });

    const outcome = await upload.result;
    expect(outcome.status).toBe('completed');
    unsubscribe();

    expect(seen.length).toBeGreaterThan(5);
    expect(alsoSeen).toEqual(seen);
    expect(new Set(seen).size, 'a new object each time').toBe(seen.length);
    expect(seen.every((snapshot) => Object.isFrozen(snapshot))).toBe(true);
    expect(seen.at(-1)).toBe(upload.snapshot);
    expect(upload.snapshot).toMatchObject({ status: 'completed', phase: 'done', percent: 100, processedBytes: CHUNK_SIZE * 3, totalBytes: CHUNK_SIZE * 3 });

    // The steps in order, each status once it's reached.
    const steps = seen.map((snapshot) => `${snapshot.status}:${snapshot.phase}`).filter((step, i, all) => step !== all[i - 1]);
    expect(steps).toEqual([
      'initializing:server-compat', 'initializing:init', 'uploading:init',
      'uploading:file-start', 'uploading:chunk', 'uploading:file-complete',
      'uploading:file-start', 'uploading:chunk', 'uploading:file-complete',
      'completing:complete', 'completed:done',
    ]);
    // Bytes only ever go up, and each file's chunks are counted on the bundle's whole.
    const bytes = seen.map((snapshot) => snapshot.processedBytes);
    expect(bytes).toEqual([...bytes].sort((x, y) => x - y));
    expect(seen.filter((snapshot) => snapshot.phase === 'chunk').map((s) => [s.fileIndex, s.chunkIndex, s.processedBytes]))
      .toEqual([[0, 0, 0], [0, 1, CHUNK_SIZE], [1, 0, CHUNK_SIZE * 2]]);

    // Once it has ended, subscribe() adds nothing, and nothing more is given.
    const late: UploadSnapshot[] = [];
    upload.subscribe((snapshot) => late.push(snapshot));
    upload.cancel();
    expect(late).toEqual([]);
    expect(upload.snapshot.status).toBe('completed');
  });

  it('a failed upload\'s last snapshot keeps the step it stopped at, with the error\'s message', async () => {
    const server = fakeServer();
    server.answer('POST /upload/complete', () => server.json(500, { error: 'Disk error.' }));
    const upload = createClient(server.fetchFn).uploadFiles({ files: fileNamed('notes.txt'), lifetimeMs: 60_000, encrypt: false });
    expect((await upload.result).status).toBe('failed');
    expect(upload.snapshot).toMatchObject({ status: 'failed', phase: 'complete', text: 'Disk error.' });
  });

  it('while a chunk waits to be retried, the snapshot says so and keeps its place', async () => {
    const server = fakeServer();
    let failures = 1;
    server.answer('POST /upload/chunk', () => (failures-- > 0 ? new Response('Busy.', { status: 503 }) : server.json(200, {})));
    const upload = createClient(server.fetchFn).uploadFiles({
      files: fileNamed('notes.txt', 2), lifetimeMs: 60_000, encrypt: false, retry: { retries: 1, backoffMs: 100 },
    });
    const seen: UploadSnapshot[] = [];
    upload.subscribe((snapshot) => seen.push(snapshot));
    expect((await upload.result).status).toBe('completed');

    const waiting = seen.find((snapshot) => snapshot.phase === 'retry-wait');
    expect(waiting).toMatchObject({ status: 'uploading', chunkIndex: 0, processedBytes: 0, totalBytes: CHUNK_SIZE * 2 });
    expect(waiting?.text).toMatch(/^Chunk upload failed\. Retrying in 0\.1s\.\.\. \(1\/1\)$/);
  });
});

describe('File sources', () => {
  it('a FileSource is read in bounded ranges, one chunk at a time, and what it gives is what is sent', async () => {
    const server = fakeServer();
    const bytes = Uint8Array.from({ length: CHUNK_SIZE * 2 + 1 }, (_, i) => i + 1);
    const reads: Array<[number, number]> = [];
    const source: FileSource = {
      name: 'readings.bin',
      size: bytes.length,
      async read(start, end) {
        reads.push([start, end]);
        return bytes.slice(start, end);
      },
    };

    const outcome = await createClient(server.fetchFn).uploadFiles({ files: source, lifetimeMs: 60_000, encrypt: false }).result;
    expect(outcome.status).toBe('completed');
    expect(reads).toEqual([[0, CHUNK_SIZE], [CHUNK_SIZE, CHUNK_SIZE * 2], [CHUNK_SIZE * 2, CHUNK_SIZE * 2 + 1]]);
    expect(server.chunkBodies.map((body) => [...body])).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9]]);
    expect(JSON.parse(server.requests.find((r) => r.url.endsWith('/upload/init'))!.body)).toMatchObject({ filename: 'readings.bin', totalSize: 9, totalChunks: 3 });
  });

  it('a Node.js file handle is a source through fileHandleSource()', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropgate-core-'));
    const path = join(dir, 'on-disk.bin');
    await writeFile(path, Uint8Array.from([9, 8, 7, 6, 5, 4]));
    const handle = await open(path, 'r');
    try {
      const source = await fileHandleSource(handle, { name: 'on-disk.bin' });
      expect({ name: source.name, size: source.size }).toEqual({ name: 'on-disk.bin', size: 6 });
      expect([...await source.read(2, 5)]).toEqual([7, 6, 5]);

      const server = fakeServer();
      const outcome = await createClient(server.fetchFn).uploadFiles({ files: source, lifetimeMs: 60_000, encrypt: true }).result;
      expect(outcome.status).toBe('completed');
      // Encrypted: each chunk is its 12-byte IV, the ciphertext and a 16-byte tag.
      expect(server.chunkBodies.map((body) => body.length)).toEqual([12 + CHUNK_SIZE + 16, 12 + 2 + 16]);
    } finally {
      await handle.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('a source that fails to read, or gives other than the bytes asked for, fails the upload as SOURCE_UNAVAILABLE', async () => {
    const short: FileSource = { name: 'shrunk.bin', size: CHUNK_SIZE * 2, read: async (start, end) => new Uint8Array(Math.max(0, end - start - 1)) };
    const broken: FileSource = { name: 'gone.bin', size: CHUNK_SIZE, read: async () => { throw new Error('ENOENT: gone.bin'); } };
    for (const source of [short, broken]) {
      const server = fakeServer();
      const outcome = await createClient(server.fetchFn).uploadFiles({ files: source, lifetimeMs: 60_000, encrypt: false }).result;
      expect(codeOf(outcome)).toBe('SOURCE_UNAVAILABLE');
      expect(server.chunkIndexes).toEqual([]);
      expect(JSON.stringify(outcome)).not.toContain(source.name);
    }
  });
});
