import { describe, it, expect } from 'vitest';
import { DropgateClient, DropgateError, getServerInfo } from '../src/index.js';
import type { DownloadOutcome, FileSource, Outcome, UploadSession } from '../src/index.js';
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

const fileNamed = (name: string, chunks = 1) => new File([new Uint8Array(CHUNK_SIZE * chunks)], name) as unknown as FileSource;

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
      const outcome = await session.result;
      expect(cancelPressed, 'cancel() should be pressed during the first chunk').toBe(true);

      expect(
        { chunks: server.chunkIndexes, completed: server.paths().includes('POST /upload/complete'), status: session.getStatus() },
        'the upload kept going after cancel()'
      ).toEqual({ chunks: [0], completed: false, status: 'cancelled' });
      expect(outcome).toEqual({ status: 'cancelled', cancellation: { by: 'self', source: 'upload' } });
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
    const completed = [
      await (await client.uploadFiles({ files: file('one.txt'), lifetimeMs: 60_000, encrypt: false })).result,
      await (await client.uploadFiles({ files: [file('one.txt'), file('two.txt')], lifetimeMs: 60_000, encrypt: false })).result,
      await client.downloadFiles({ fileId: FILE_ID }),
      await client.downloadFiles({ bundleId: BUNDLE_ID, asZip: true, onData: () => {} }),
    ];
    expect(completed.map((outcome) => outcome.status)).toEqual(['completed', 'completed', 'completed', 'completed']);
    const cancelled = await client.uploadFiles({ files: file('three.txt'), lifetimeMs: 60_000, encrypt: false, retry: { retries: 0 } });
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
    const session = await createClient(server.fetchFn).uploadFiles({ files: fileNamed('notes.txt'), lifetimeMs: 60_000, encrypt: false });
    const outcome = await session.result;
    expect(outcome).toEqual({ status: 'completed', value: expect.objectContaining({ downloadUrl: `${BASE_URL}/${FILE_ID}`, fileId: FILE_ID }) });
    expect(session.getStatus()).toBe('completed');
  });

  it('cancel() ends an upload as cancelled by itself: no more chunks are sent, and the server is told', async () => {
    const server = fakeServer();
    const session = await createClient(server.fetchFn).uploadFiles({
      files: fileNamed('notes.txt', 3), lifetimeMs: 60_000, encrypt: false, retry: { retries: 0 },
    });
    server.onChunk = (index) => { if (index === 0) session.cancel(); };

    expect(await session.result).toEqual({ status: 'cancelled', cancellation: { by: 'self', source: 'upload' } });
    expect(session.getStatus()).toBe('cancelled');
    expect(server.chunkIndexes).toEqual([0]);
    expect(server.paths()).not.toContain('POST /upload/complete');
    await expect.poll(() => server.requests.filter((r) => r.url.endsWith('/upload/cancel')).map((r) => JSON.parse(r.body)))
      .toEqual([{ uploadId: 'upload-1' }]);

    // Once it has ended, cancel() does nothing.
    session.cancel();
    expect(session.getStatus()).toBe('cancelled');
  });

  it('cancelAll() cancels every upload and download running, each by its parent, once, and the client keeps working', async () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);
    server.answer(`GET /api/file/${FILE_ID}`, endlessBody);
    server.answer('POST /upload/chunk', noAnswer);

    const settled: string[] = [];
    const download = client.downloadFiles({ fileId: FILE_ID, onData: () => {} }).then((o) => { settled.push('download'); return o; });
    const session = await client.uploadFiles({ files: [fileNamed('one.txt'), fileNamed('two.txt')], lifetimeMs: 60_000, encrypt: false });
    const upload = session.result.then((o) => { settled.push('upload'); return o; });
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
    const next = await client.uploadFiles({ files: fileNamed('three.txt'), lifetimeMs: 60_000, encrypt: false });
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
    const upload = (files: FileSource | FileSource[] = fileNamed('notes.txt')) => async (client: DropgateClient) =>
      (await client.uploadFiles({ files, lifetimeMs: 60_000, encrypt: false, retry: { retries: 0 } })).result;
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
      empty: await run(() => {}, upload(new File([], 'empty.txt') as unknown as FileSource)),
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
    const outcome = await (await createClient(server.fetchFn).uploadFiles({ files: fileNamed('notes.txt'), lifetimeMs: 60_000, encrypt: false })).result;
    expect(outcome.status === 'failed' && outcome.error).toMatchObject({ code: 'FILE_TOO_LARGE', status: 413, message: 'File exceeds limit of 1 MB.', origin: 'server', retryable: false });
  });

  it('throws INVALID_ARGUMENT for an upload with no files or a download with nothing to download, before one starts', async () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);
    await expect(client.uploadFiles({ files: [], lifetimeMs: 60_000 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
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
    reported.push(await (await createClient(failing.fetchFn).uploadFiles({ files: fileNamed(name), lifetimeMs: 60_000, encrypt: true })).result);
    const cancelling = fakeServer();
    const session = await createClient(cancelling.fetchFn).uploadFiles({ files: fileNamed(name, 2), lifetimeMs: 60_000, encrypt: true });
    cancelling.onChunk = () => session.cancel();
    reported.push(await session.result);

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
  });
});
