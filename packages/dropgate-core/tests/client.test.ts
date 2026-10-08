import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { open, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DropgateClient, DropgateError, sources } from '../src/index.js';
import type { DownloadOutcome, DownloadSink, DownloadSnapshot, FileSource, Outcome, UploadHandle, UploadSnapshot } from '../src/index.js';
import { newOperationId } from '../src/operation.js';
import { cryptoProvider, keyToBase64 } from '../src/crypto/index.js';
import { getDefaultBase64 } from '../src/adapters/defaults.js';
import { createObject } from '../src/object/index.js';
import { CHUNK_SIZE, fakeV4 } from './helpers/fake-v4.js';

const provider = cryptoProvider();
const base64 = getDefaultBase64();

// DropgateClient against a fake server, through its `fetchFn` option: no
// network. One file is a Dropgate 4 upload; several are a bundle, which is
// still sent and fetched on version 3's routes. The real server is in
// hosted.test.ts.

const BASE_URL = 'https://files.example';
const FILE_ID = '0b7d4c52-5f0e-4d8e-9a57-3c1f2e6b8a90';
const BUNDLE_ID = '6a1e9f3b-2c4d-4b7a-8e5f-9d0c1b2a3e4f';
const SECOND_FILE_ID = '9c3b2a1d-7e6f-4a5b-8c9d-0e1f2a3b4c5d';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// A link's secret, as it appears after the # in an encrypted link: 32 bytes, URL-safe base64.
const LINK_SECRET = 'CPuytR72dDo2WhXGdB6x6aXlPcJu7Ec0tYvcUn5GL0k';
// A version 3 link's key (standard base64, 44 characters), as a bundle's link still has.
const LINK_KEY = 'q3Rk8vXo2LmN5pT7wYc9ZbHd4sFj6gKa1eUi0rQnVxM=';
// The bytes of a bundle's member, as the fake server's version 3 routes give them.
const MEMBER_BYTES = 4;
// How a client reaches the fake server, on https://: every snapshot, result and error carries it.
const transport = { secure: true };

// Dropgate 4's routes, as `answer()` names them.
const START = 'POST /api/v4/uploads';
const CHUNK = 'PUT /api/v4/upload/chunks/:index';
const FINISH = 'POST /api/v4/upload/complete';
const CANCEL = 'DELETE /api/v4/upload';
const META = `GET /api/v4/objects/${FILE_ID}`;
const LEASE = `POST /api/v4/objects/${FILE_ID}/leases`;
const CONTENT = `GET /api/v4/objects/${FILE_ID}/content`;
const RELEASE = 'DELETE /api/v4/lease';

interface RecordedRequest {
  method: string;
  url: string;
  headers: string;
  body: string;
  credentials: RequestCredentials | undefined;
}

/**
 * A fake Dropgate server behind `fetchFn`. It records every request, answers
 * Dropgate 4's routes as a server would (`v4`), with an unencrypted
 * `notes.txt` of CHUNK_SIZE bytes stored as FILE_ID, and every upload
 * finished stored there too, and answers version 3's bundle routes. `onChunk`
 * runs while a chunk request is in flight, before the server answers it.
 */
function fakeServer({ chunkSize = CHUNK_SIZE, maxSizeMB = 0 }: { chunkSize?: number; maxSizeMB?: number } = {}) {
  const requests: RecordedRequest[] = [];
  const chunkIndexes: number[] = [];
  const chunkBodies: Uint8Array[] = [];
  let onChunk: (index: number) => void = () => {};
  // Answers that replace the usual one, by `METHOD /path`. One that throws is a network failure.
  const answers = new Map<string, (init: RequestInit) => Response | Promise<Response>>();
  const v4 = fakeV4({ chunkSize, id: FILE_ID });
  v4.store(FILE_ID, { encrypted: false, size: CHUNK_SIZE, bytes: new Uint8Array(CHUNK_SIZE), files: [{ name: 'notes.txt', size: CHUNK_SIZE }] });

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
    const route = `${method} ${path.replace(/\/chunks\/\d+$/, '/chunks/:index')}`;
    const chunkIndex = route === CHUNK ? Number(path.split('/').pop())
      : route === 'POST /upload/chunk' ? Number(headers['X-Chunk-Index']) : null;
    if (chunkIndex !== null) {
      chunkIndexes.push(chunkIndex);
      if (init.body instanceof Blob) chunkBodies.push(new Uint8Array(await init.body.arrayBuffer()));
      onChunk(chunkIndex);
    }
    if (init.signal?.aborted) {
      throw init.signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
    }

    const answer = answers.get(route);
    if (answer) return answer(init);

    switch (route) {
      case 'GET /api/info':
        return json(200, {
          name: 'Test server',
          version: '4.0.0',
          protocols: { dgup: { major: 4, minor: 0 }, dgdtp: { major: 4, minor: 0 } },
          capabilities: {
            upload: { enabled: true, maxSizeMB, maxLifetimeHours: 0, e2ee: true, chunkSize },
            p2p: { enabled: true },
          },
        });
      case 'POST /upload/chunk':
        return json(200, {});
      case 'POST /upload/complete':
        return json(200, { id: FILE_ID });
      case 'POST /upload/cancel':
        return json(200, {});
      case `GET /api/file/${FILE_ID}`:
        return new Response(new Uint8Array(MEMBER_BYTES));
      case `GET /api/bundle/${BUNDLE_ID}/meta`:
        return json(200, { isEncrypted: false, files: [{ fileId: FILE_ID, sizeBytes: MEMBER_BYTES, filename: 'notes.txt' }] });
      case `POST /api/bundle/${BUNDLE_ID}/downloaded`:
        return json(200, {});
      case 'POST /upload/init-bundle':
        return json(200, { bundleUploadId: 'bundle-1', fileUploadIds: ['upload-1', 'upload-2'] });
      case 'POST /upload/complete-bundle':
        return json(200, { bundleId: BUNDLE_ID });
      default:
        return (await v4.handle(method, path, init)) ?? json(404, { error: 'Not found.' });
    }
  };

  return {
    fetchFn,
    requests,
    chunkIndexes,
    chunkBodies,
    v4,
    paths: () => requests.map((r) => `${r.method} ${new URL(r.url).pathname}`),
    /** What a request to `route` sent in a header. */
    headerOf: (route: string, name: string) => requests
      .filter((r) => `${r.method} ${new URL(r.url).pathname}` === route)
      .map((r) => (JSON.parse(r.headers) as Record<string, string>)[name]),
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

/** A sink that keeps nothing. */
const nullSink = (): DownloadSink => ({ write: () => {}, close: () => {} });

function createClient(fetchFn: typeof fetch): DropgateClient {
  return new DropgateClient({ server: BASE_URL, fetchFn });
}

/** Every run of `length` characters in `text`. */
function piecesOf(text: string, length: number): string[] {
  const pieces: string[] = [];
  for (let i = 0; i + length <= text.length; i++) pieces.push(text.slice(i, i + length));
  return pieces;
}

/**
 * An encrypted upload as a Dropgate 4 server stores it, made as core makes
 * one: what the server keeps, and the secret its link carries.
 */
async function sealedObject(name: string, plaintext: Uint8Array) {
  const writer = await createObject(provider, { files: [{ name, size: plaintext.length }], chunkSize: CHUNK_SIZE });
  const { layout } = writer;
  const padded = new Uint8Array(layout.length);
  padded.set(plaintext);
  const parts: Uint8Array[] = [writer.header];
  for (let i = 0; i < layout.chunkCount; i++) {
    parts.push(await writer.seal(i, padded.slice(i * CHUNK_SIZE, i * CHUNK_SIZE + layout.chunkLength(i))));
  }
  return {
    secret: Buffer.from(writer.secret()).toString('base64url'),
    stored: { encrypted: true, size: layout.storedSize, bytes: new Uint8Array(Buffer.concat(parts)), meta: Buffer.from(writer.meta).toString('base64url') },
  };
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
    upload = client.hosted.upload({
      files: new File([new Uint8Array(CHUNK_SIZE * 2)], 'notes.txt', { type: 'text/plain' }),
      lifetimeMs: 60_000,
      encrypt: false,
      signal: external.signal,
      retry: { retries: 0 },
    });
    const outcome = await upload.result;
    expect(cancelPressed, 'cancel() should be pressed during the first chunk').toBe(true);

    expect(
      { chunks: server.chunkIndexes, completed: server.paths().includes(FINISH), status: upload.snapshot.status },
      'the upload kept going after cancel()'
    ).toEqual({ chunks: [0], completed: false, status: 'cancelled' });
    expect(outcome).toEqual({ status: 'cancelled', cancellation: { by: 'self', source: 'hosted.upload' }, transport });
    // The signal passed in is the caller's: cancel() never aborts it.
    expect(external.signal.aborted).toBe(false);
  });

  it('aborting the AbortSignal passed in cancels the upload by signal, as its own cancel() would', async () => {
    const server = fakeServer();
    const external = new AbortController();
    server.onChunk = (index) => { if (index === 0) external.abort(); };
    const upload = createClient(server.fetchFn).hosted.upload({
      files: fileNamed('notes.txt', 3), lifetimeMs: 60_000, encrypt: false, signal: external.signal, retry: { retries: 0 },
    });

    expect(await upload.result).toEqual({ status: 'cancelled', cancellation: { by: 'signal', source: 'hosted.upload' }, transport });
    expect(server.chunkIndexes).toEqual([0]);
    expect(server.paths()).not.toContain(FINISH);
    await expect.poll(() => server.paths()).toContain(CANCEL);
  });

  it('an upload given an AbortSignal that is already aborted is cancelled before it asks the server anything', async () => {
    const server = fakeServer();
    const upload = createClient(server.fetchFn).hosted.upload({
      files: fileNamed('notes.txt'), lifetimeMs: 60_000, encrypt: false, signal: AbortSignal.abort(),
    });
    expect(await upload.result).toEqual({ status: 'cancelled', cancellation: { by: 'signal', source: 'hosted.upload' }, transport });
    expect(server.requests).toEqual([]);
  });

  it('resolving a link reads it on the device: only the server\'s info is asked for, and the secret stays for the page it opens', async () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);

    const file = await client.links.resolve(`${BASE_URL}/${FILE_ID}#${LINK_SECRET}`);
    const bundle = await client.links.resolve(`${BASE_URL}/b/${BUNDLE_ID}#${LINK_KEY}`);
    expect(server.paths(), 'what the server was asked').toEqual(['GET /api/info']);

    // Any 8 characters of the secret, or of the ID, in a request's URL, headers or body count.
    const pieces = [...piecesOf(LINK_SECRET, 8), ...piecesOf(LINK_KEY, 8), FILE_ID, BUNDLE_ID];
    const leaks = server.requests.flatMap((req) => {
      const sent = [req.url, decodeURIComponent(req.url), req.headers, req.body].join('\n');
      return pieces.some((piece) => sent.includes(piece)) ? [`${req.method} ${req.url} ${req.body}`] : [];
    });
    expect(leaks, 'part of a link reached the server').toEqual([]);

    expect(file).toEqual({ valid: true, type: 'hosted', target: `/${FILE_ID}#${LINK_SECRET}`, transport });
    expect(bundle).toEqual({ valid: true, type: 'bundle', target: `/b/${BUNDLE_ID}#${LINK_KEY}`, transport });
  });

  it('refuses a link to another server without asking this one anything', async () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);

    const result = await client.links.resolve(`https://elsewhere.example/${FILE_ID}#${LINK_SECRET}`);
    expect(result).toEqual({ valid: false, reason: 'URL must be from this server.', transport });
    expect(server.requests).toEqual([]);
  });

  it('refuses a link or a code with no upload or transfer in it without asking the server', async () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);

    expect(await client.links.resolve(`${BASE_URL}/about#${LINK_SECRET}`)).toEqual({ valid: false, reason: 'Unrecognised sharing link.', transport });
    expect(await client.links.resolve('not a code')).toEqual({ valid: false, reason: 'Unrecognised sharing code.', transport });
    expect(server.requests).toEqual([]);
  });

  it('opens a typed code or ID as it is, without anything after a #, and sends neither', async () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);

    expect(await client.links.resolve(' abcd-1234 ')).toEqual({ valid: true, type: 'p2p', target: '/p2p/ABCD-1234', transport });
    expect(await client.links.resolve(`${FILE_ID.toUpperCase()}#${LINK_SECRET}`))
      .toEqual({ valid: true, type: 'hosted', target: `/${FILE_ID}#${LINK_SECRET}`, transport });
    expect(server.paths()).toEqual(['GET /api/info']);

    // A code on a server with direct transfer off opens nothing.
    server.answer('GET /api/info', () => server.json(200, {
      version: '4.0.0', protocols: { dgup: { major: 4, minor: 0 }, dgdtp: { major: 4, minor: 0 } }, capabilities: { p2p: { enabled: false } },
    }));
    expect(await createClient(server.fetchFn).links.resolve('ABCD-1234'))
      .toEqual({ valid: false, reason: 'Direct transfer is disabled on this server.', transport });
  });

  // Dropgate uses no cookies. A browser reads its cookie store before any
  // request that may carry them, and a new profile's store only loads from disk
  // then, which once held the desktop app's first server check for over 5 s.
  it('omits credentials from every request it makes', async () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);
    const file = (name: string) => new File([new Uint8Array(CHUNK_SIZE)], name);

    await client.server.info();
    await client.server.connect();
    await client.links.resolve(`${BASE_URL}/${FILE_ID}#${LINK_SECRET}`);
    await client.hosted.metadata({ id: FILE_ID });
    await client.hosted.metadata({ bundleId: BUNDLE_ID });
    const completed = [
      await client.hosted.upload({ files: file('one.txt'), lifetimeMs: 60_000, encrypt: false }).result,
      await client.hosted.upload({ files: [file('one.txt'), file('two.txt')], lifetimeMs: 60_000, encrypt: false }).result,
      await client.hosted.download({ id: FILE_ID, sink: nullSink() }).result,
      await client.hosted.download({ bundleId: BUNDLE_ID, asZip: true, sink: nullSink() }).result,
    ];
    expect(completed.map((outcome) => outcome.status)).toEqual(['completed', 'completed', 'completed', 'completed']);
    const cancelled = client.hosted.upload({ files: file('three.txt'), lifetimeMs: 60_000, encrypt: false, retry: { retries: 0 } });
    server.onChunk = () => cancelled.cancel();
    expect((await cancelled.result).status).toBe('cancelled');
    // cancel() tells the server without waiting for it.
    await expect.poll(() => server.paths()).toContain(CANCEL);

    const paths = new Set(server.paths());
    for (const path of [
      'GET /api/info', META, `GET /api/bundle/${BUNDLE_ID}/meta`,
      START, 'PUT /api/v4/upload/chunks/0', FINISH, LEASE, CONTENT, RELEASE, CANCEL,
      'POST /upload/init-bundle', 'POST /upload/chunk', 'POST /upload/complete',
      'POST /upload/complete-bundle', `GET /api/file/${FILE_ID}`, `POST /api/bundle/${BUNDLE_ID}/downloaded`,
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
  it('an upload ends with one completed outcome, with its link, its ID, its files and its manage token', async () => {
    const server = fakeServer();
    const upload = createClient(server.fetchFn).hosted.upload({ files: fileNamed('notes.txt'), lifetimeMs: 60_000, encrypt: false });
    const outcome = await upload.result;
    expect(outcome).toEqual({
      status: 'completed',
      value: {
        downloadUrl: `${BASE_URL}/${FILE_ID}`,
        id: FILE_ID,
        manageToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        files: [{ name: 'notes.txt', size: CHUNK_SIZE }],
        transport,
      },
      transport,
    });
    expect(upload.snapshot.status).toBe('completed');
  });

  it('cancel() ends an upload as cancelled by itself: no more chunks are sent, and the server is told', async () => {
    const server = fakeServer();
    const upload = createClient(server.fetchFn).hosted.upload({
      files: fileNamed('notes.txt', 3), lifetimeMs: 60_000, encrypt: false, retry: { retries: 0 },
    });
    server.onChunk = (index) => { if (index === 0) upload.cancel(); };

    expect(await upload.result).toEqual({ status: 'cancelled', cancellation: { by: 'self', source: 'hosted.upload' }, transport });
    expect(upload.snapshot.status).toBe('cancelled');
    expect(server.chunkIndexes).toEqual([0]);
    expect(server.paths()).not.toContain(FINISH);
    // The upload is named in its header, never in a URL or a body.
    await expect.poll(() => server.headerOf(CANCEL, 'Dropgate-Upload')).toEqual(['upload-1']);

    // Once it has ended, cancel() does nothing.
    upload.cancel();
    expect(upload.snapshot.status).toBe('cancelled');
  });

  it('cancelAll() cancels every upload and download running, each by its parent, once, and the client keeps working', async () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);
    server.answer(CONTENT, endlessBody);
    server.answer('POST /upload/chunk', noAnswer);

    const settled: string[] = [];
    const download = client.hosted.download({ id: FILE_ID, sink: nullSink() }).result.then((o) => { settled.push('download'); return o; });
    const handle = client.hosted.upload({ files: [fileNamed('one.txt'), fileNamed('two.txt')], lifetimeMs: 60_000, encrypt: false });
    const upload = handle.result.then((o) => { settled.push('upload'); return o; });
    await expect.poll(() => server.paths()).toEqual(expect.arrayContaining([CONTENT, 'POST /upload/chunk']));

    client.operations.cancelAll();
    const byClient = { status: 'cancelled', cancellation: { by: 'parent', source: 'client' }, transport };
    expect(await download).toEqual(byClient);
    expect(await upload).toEqual(byClient);
    expect(settled.sort()).toEqual(['download', 'upload']);
    await expect.poll(() => server.requests.filter((r) => r.url.endsWith('/upload/cancel')).map((r) => JSON.parse(r.body).uploadId))
      .toEqual(['upload-1', 'upload-2']);

    // A cancel after the fact reaches nothing, and new operations run as normal.
    client.operations.cancelAll();
    server.answer('POST /upload/chunk', null);
    server.answer(CONTENT, null);
    const next = client.hosted.upload({ files: fileNamed('three.txt'), lifetimeMs: 60_000, encrypt: false });
    expect((await next.result).status).toBe('completed');
    expect((await client.hosted.download({ id: FILE_ID, sink: nullSink() }).result).status).toBe('completed');
    expect(settled.sort()).toEqual(['download', 'upload']);
  });

  it('a download whose signal is aborted ends as cancelled by signal', async () => {
    const server = fakeServer();
    server.answer(CONTENT, endlessBody);
    const controller = new AbortController();
    const download = createClient(server.fetchFn).hosted.download({ id: FILE_ID, sink: nullSink(), signal: controller.signal }).result;
    await expect.poll(() => server.paths()).toContain(CONTENT);
    controller.abort();
    expect(await download).toEqual({ status: 'cancelled', cancellation: { by: 'signal', source: 'hosted.download' }, transport });
  });

  it('a failure ends as failed, with the code for what went wrong', async () => {
    const sealed = await sealedObject('sealed.bin', new Uint8Array(64));
    const run = async (setUp: (server: ReturnType<typeof fakeServer>) => void, operation: (client: DropgateClient) => Promise<Outcome<unknown>>) => {
      const server = fakeServer();
      setUp(server);
      return codeOf(await operation(createClient(server.fetchFn)));
    };
    const upload = (files: File | File[] = fileNamed('notes.txt'), encrypt = false) => (client: DropgateClient) =>
      client.hosted.upload({ files, lifetimeMs: 60_000, encrypt, retry: { retries: 0 } }).result;
    const download = (opts: { secret?: string; sink?: DownloadSink } = {}) => (client: DropgateClient): Promise<DownloadOutcome> =>
      client.hosted.download({ id: FILE_ID, sink: nullSink(), ...opts }).result;
    const encrypted = (s: ReturnType<typeof fakeServer>) => s.v4.store(FILE_ID, sealed.stored);
    const refused = (route: string, status: number, code: string) => (s: ReturnType<typeof fakeServer>) =>
      s.answer(route, () => s.json(status, { code, error: 'Refused.' }));

    const codes = {
      tooLarge: await run(refused(START, 413, 'TOO_LARGE'), upload()),
      rateLimited: await run((s) => s.answer(START, () => s.json(429, { error: 'Too many requests.' })), upload()),
      serverFull: await run(refused(START, 507, 'SERVER_FULL'), upload()),
      e2eeDisabled: await run(refused(START, 400, 'E2EE_DISABLED'), upload(fileNamed('notes.txt'), true)),
      unsupportedObject: await run(refused(START, 400, 'UNSUPPORTED_OBJECT'), upload(fileNamed('notes.txt'), true)),
      lifetime: await run(refused(START, 400, 'LIFETIME_NOT_ALLOWED'), upload()),
      chunkServerError: await run((s) => s.answer(CHUNK, () => new Response('Write failed.', { status: 500 })), upload()),
      chunkConflict: await run(refused(CHUNK, 409, 'CHUNK_CONFLICT'), upload()),
      digestMismatch: await run(refused(CHUNK, 400, 'DIGEST_MISMATCH'), upload()),
      unreachable: await run((s) => s.answer(START, () => { throw new TypeError('fetch failed'); }), upload()),
      noId: await run((s) => s.answer(FINISH, () => s.json(201, {})), upload()),
      empty: await run(() => {}, upload(new File([], 'empty.txt'))),
      unsupported: await run((s) => s.answer('GET /api/info', () => s.json(200, { version: '2.0.0', capabilities: {} })), upload()),
      notFound: await run(refused(META, 404, 'NOT_FOUND'), download()),
      leaseGone: await run(refused(LEASE, 404, 'NOT_FOUND'), download()),
      writeFailed: await run(() => {}, download({ sink: { write: () => { throw new Error('Disk full.'); }, close: () => {} } })),
      keyRequired: await run(encrypted, download()),
      wrongKey: await run(encrypted, download({ secret: LINK_SECRET })),
      v3Key: await run(encrypted, download({ secret: LINK_KEY })),
    };
    expect(codes).toEqual({
      tooLarge: 'FILE_TOO_LARGE', rateLimited: 'RATE_LIMITED', serverFull: 'SERVER_FULL',
      e2eeDisabled: 'CAPABILITY_UNSUPPORTED', unsupportedObject: 'VERSION_UNSUPPORTED', lifetime: 'LIFETIME_NOT_ALLOWED',
      chunkServerError: 'SERVER_ERROR', chunkConflict: 'INTEGRITY_FAILED', digestMismatch: 'INTEGRITY_FAILED',
      unreachable: 'SERVER_UNREACHABLE', noId: 'INVALID_RESPONSE', empty: 'FILE_EMPTY', unsupported: 'VERSION_UNSUPPORTED',
      notFound: 'NOT_FOUND', leaseGone: 'NOT_FOUND', writeFailed: 'OUTPUT_WRITE_FAILED',
      keyRequired: 'KEY_REQUIRED', wrongKey: 'DECRYPT_FAILED', v3Key: 'DECRYPT_FAILED',
    });
  });

  it('keeps the server\'s own message and status on a failure it answered', async () => {
    const server = fakeServer();
    server.answer(START, () => server.json(413, { code: 'TOO_LARGE', error: "This upload is over the server's limit of 1 MB." }));
    const outcome = await createClient(server.fetchFn).hosted.upload({ files: fileNamed('notes.txt'), lifetimeMs: 60_000, encrypt: false }).result;
    expect(outcome.status === 'failed' && outcome.error).toMatchObject({
      code: 'FILE_TOO_LARGE', status: 413, message: "This upload is over the server's limit of 1 MB.", origin: 'server', retryable: false,
    });
  });

  it('throws INVALID_ARGUMENT for an upload with no files or something that isn\'t a file, or a download with nothing to download, before one starts', async () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);
    expect(() => client.hosted.upload({ files: [], lifetimeMs: 60_000 })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    // A Node.js file handle goes through sources.fileHandle() first.
    const handle = { fd: 3, read: async () => ({ bytesRead: 0 }), stat: async () => ({ size: 4 }) };
    expect(() => client.hosted.upload({ files: handle as unknown as FileSource, lifetimeMs: 60_000 }))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT', message: 'File at index 0 is missing or invalid.' }));
    expect(() => client.hosted.download({} as never)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() => client.hosted.download({ id: FILE_ID } as never)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() => client.hosted.download({ id: FILE_ID, bundleId: BUNDLE_ID, sink: nullSink() } as never)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(server.requests).toEqual([]);
  });

  it("throws typed errors from the calls that aren't operations", async () => {
    const server = fakeServer();
    server.answer('GET /api/info', () => new Response('<html>Not Dropgate</html>', { status: 404 }));
    await expect(createClient(server.fetchFn).server.connect()).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 404 });

    const down = fakeServer();
    down.answer('GET /api/info', () => { throw new TypeError('fetch failed'); });
    const err = await createClient(down.fetchFn).server.connect().catch((e: unknown) => e);
    expect(DropgateError.is(err, 'SERVER_UNREACHABLE')).toBe(true);

    const gone = fakeServer();
    await expect(createClient(gone.fetchFn).hosted.metadata({ id: SECOND_FILE_ID })).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'The server has no such upload.' });
    gone.answer(`GET /api/bundle/${BUNDLE_ID}/meta`, () => gone.json(404, { error: 'Bundle not found.' }));
    await expect(createClient(gone.fetchFn).hosted.metadata({ bundleId: BUNDLE_ID })).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Bundle not found.' });

    const sealed = fakeServer();
    sealed.answer(`GET /api/bundle/${BUNDLE_ID}/meta`, () => sealed.json(200, { isEncrypted: true, sealed: true, encryptedManifest: 'AAAA' }));
    await expect(createClient(sealed.fetchFn).hosted.metadata({ bundleId: BUNDLE_ID })).rejects.toMatchObject({ code: 'KEY_REQUIRED' });
    await expect(createClient(sealed.fetchFn).hosted.metadata({ bundleId: BUNDLE_ID, keyB64: LINK_KEY })).rejects.toMatchObject({ code: 'DECRYPT_FAILED' });
  });

  // Hard requirement 8: what a failed or cancelled operation reports is safe to
  // show and to log. Its value, when it completes, is the link the caller asked for.
  it("a failed or cancelled outcome never carries a file name, a secret or a manage token, even serialised", async () => {
    const name = 'Tax return 2026 for Sam.pdf';
    const reported: unknown[] = [];
    const snapshots: UploadSnapshot[] = [];
    const tokens: string[] = [];
    const noteToken = (server: ReturnType<typeof fakeServer>) => server.answer(START, async (init) => {
      tokens.push(JSON.parse(String(init.body)).manageTokenHash);
      return (await server.v4.handle('POST', '/api/v4/uploads', init))!;
    });

    // An encrypted upload the server fails at the end, a bundle that fails, and one that's cancelled.
    const failing = fakeServer();
    noteToken(failing);
    failing.answer(FINISH, () => failing.json(500, { code: 'SERVER_ERROR', error: 'Something went wrong on the server.' }));
    const failingUpload = createClient(failing.fetchFn).hosted.upload({ files: fileNamed(name, 2), lifetimeMs: 60_000, encrypt: true });
    failingUpload.subscribe((snapshot) => snapshots.push(snapshot));
    reported.push(await failingUpload.result);
    failing.answer('POST /upload/complete', () => failing.json(500, { error: 'Server error during file validation.' }));
    const failingBundle = createClient(failing.fetchFn).hosted.upload({ files: [fileNamed(name), fileNamed(`Copy of ${name}`)], lifetimeMs: 60_000, encrypt: true });
    failingBundle.subscribe((snapshot) => snapshots.push(snapshot));
    reported.push(await failingBundle.result);
    const cancelling = fakeServer();
    const cancelled = createClient(cancelling.fetchFn).hosted.upload({ files: fileNamed(name, 2), lifetimeMs: 60_000, encrypt: true });
    cancelled.subscribe((snapshot) => snapshots.push(snapshot));
    cancelling.onChunk = () => cancelled.cancel();
    reported.push(await cancelled.result);

    // A download with the wrong secret, and one whose output fails with an error naming the file.
    const sealed = await sealedObject(name, new Uint8Array(100));
    const wrongKey = fakeServer();
    wrongKey.v4.store(FILE_ID, sealed.stored);
    reported.push(await createClient(wrongKey.fetchFn).hosted.download({ id: FILE_ID, secret: LINK_SECRET, sink: nullSink() }).result);
    reported.push(await createClient(wrongKey.fetchFn).hosted.download({
      id: FILE_ID, secret: sealed.secret, sink: { write: () => { throw new Error(`Couldn't write ${name} with ${sealed.secret}`); }, close: () => {} },
    }).result);

    expect(reported.map((o) => (o as Outcome<unknown>).status)).toEqual(['failed', 'failed', 'cancelled', 'failed', 'failed']);
    const secrets = [...piecesOf(name, 8), ...piecesOf(LINK_SECRET, 8), ...piecesOf(sealed.secret, 8), ...tokens.flatMap((t) => piecesOf(t, 8))];
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

describe('The manage token', () => {
  it('is 32 random bytes, sent only as its SHA-256 with the start, and given only in the completed value', async () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);
    const runs = [];
    for (const encrypt of [true, false, true]) {
      const upload = client.hosted.upload({ files: fileNamed('notes.txt', 2), lifetimeMs: 60_000, encrypt });
      const snapshots: UploadSnapshot[] = [];
      upload.subscribe((snapshot) => snapshots.push(snapshot));
      const outcome = await upload.result;
      if (outcome.status !== 'completed') throw outcome.error;
      runs.push({ token: outcome.value.manageToken!, snapshots });
    }

    const tokens = runs.map((run) => run.token);
    expect(new Set(tokens).size, 'each upload has its own').toBe(3);
    for (const token of tokens) expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    // The start carries the token's hash, and nothing anywhere carries the token.
    const starts = server.requests.filter((r) => r.url.endsWith('/api/v4/uploads')).map((r) => JSON.parse(r.body).manageTokenHash);
    expect(starts).toEqual(tokens.map((token) => createHash('sha256').update(Buffer.from(token, 'base64url')).digest('base64url')));
    const sent = server.requests.map((r) => [r.url, r.headers, r.body].join('\n')).join('\n');
    for (const { token, snapshots } of runs) {
      expect(sent.includes(token), 'the token reached the server').toBe(false);
      expect(JSON.stringify(snapshots).includes(token), 'the token in a snapshot').toBe(false);
    }
  });
});

describe('The upload handle', () => {
  it('gives where the upload is as snapshots, each new and frozen, to every subscriber, ending with its outcome\'s status', async () => {
    const server = fakeServer();
    const upload = createClient(server.fetchFn).hosted.upload({
      files: [fileNamed('one.txt', 2), fileNamed('two.txt', 1)], lifetimeMs: 60_000, encrypt: false,
    });
    expect(upload.snapshot).toEqual({
      status: 'initializing', phase: 'server-info', text: 'Checking server...', percent: 0, processedBytes: 0, totalBytes: CHUNK_SIZE * 3, transport,
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

  it('one file goes through its steps, with an encrypted one sealed first, its chunks counted in the file\'s own bytes', async () => {
    for (const encrypt of [false, true]) {
      const server = fakeServer();
      const upload = createClient(server.fetchFn).hosted.upload({ files: fileNamed('one.txt', 2), lifetimeMs: 60_000, encrypt });
      const seen: UploadSnapshot[] = [];
      upload.subscribe((snapshot) => seen.push(snapshot));
      expect((await upload.result).status).toBe('completed');

      const steps = seen.map((snapshot) => `${snapshot.status}:${snapshot.phase}`).filter((step, i, all) => step !== all[i - 1]);
      expect(steps, `encrypt: ${encrypt}`).toEqual([
        'initializing:server-compat', ...(encrypt ? ['initializing:crypto'] : []), 'initializing:init', 'uploading:init',
        'uploading:chunk', 'completing:complete', 'completed:done',
      ]);
      expect(seen.filter((s) => s.phase === 'chunk').map((s) => [s.chunkIndex, s.totalChunks, s.processedBytes]), `encrypt: ${encrypt}`)
        .toEqual([[0, 2, 0], [1, 2, CHUNK_SIZE]]);
      expect(upload.snapshot).toMatchObject({ processedBytes: CHUNK_SIZE * 2, totalBytes: CHUNK_SIZE * 2, percent: 100 });
    }
  });

  it('a failed upload\'s last snapshot keeps the step it stopped at, with the error\'s message', async () => {
    const server = fakeServer();
    server.answer(FINISH, () => server.json(500, { code: 'SERVER_ERROR', error: 'Disk error.' }));
    const upload = createClient(server.fetchFn).hosted.upload({ files: fileNamed('notes.txt'), lifetimeMs: 60_000, encrypt: false, retry: { retries: 0 } });
    expect((await upload.result).status).toBe('failed');
    expect(upload.snapshot).toMatchObject({ status: 'failed', phase: 'complete', text: 'Disk error.' });
  });

  it('while a chunk waits to be retried, the snapshot says so and keeps its place, and the same bytes are sent again', async () => {
    const server = fakeServer();
    let failures = 1;
    server.answer(CHUNK, async (init) => (failures-- > 0
      ? new Response('Busy.', { status: 503 })
      : (await server.v4.handle('PUT', '/api/v4/upload/chunks/0', init))!));
    const upload = createClient(server.fetchFn).hosted.upload({
      files: fileNamed('notes.txt', 1), lifetimeMs: 60_000, encrypt: true, retry: { retries: 1, backoffMs: 100 },
    });
    const seen: UploadSnapshot[] = [];
    upload.subscribe((snapshot) => seen.push(snapshot));
    expect((await upload.result).status).toBe('completed');

    const waiting = seen.find((snapshot) => snapshot.phase === 'retry-wait');
    expect(waiting).toMatchObject({ status: 'uploading', chunkIndex: 0, processedBytes: 0, totalBytes: CHUNK_SIZE });
    expect(waiting?.text).toMatch(/^Chunk upload failed\. Retrying in 0\.1s\.\.\. \(1\/1\)$/);
    // A sealed chunk is sealed once: what's sent again is the same bytes, with the same digest.
    expect(server.chunkBodies).toHaveLength(2);
    expect(Buffer.from(server.chunkBodies[1]).equals(Buffer.from(server.chunkBodies[0]))).toBe(true);
    const digests = server.headerOf('PUT /api/v4/upload/chunks/0', 'Content-Digest');
    expect(digests).toEqual([digests[0], digests[0]]);
  });
});

describe('File sources', () => {
  it('a FileSource is read in bounded ranges, one chunk at a time, and what it gives is what is sent', async () => {
    const server = fakeServer();
    const bytes = Uint8Array.from({ length: CHUNK_SIZE * 2 + 1 }, (_, i) => (i * 7) % 251);
    const reads: Array<[number, number]> = [];
    const source: FileSource = {
      name: 'readings.bin',
      size: bytes.length,
      async read(start, end) {
        reads.push([start, end]);
        return bytes.slice(start, end);
      },
    };

    const outcome = await createClient(server.fetchFn).hosted.upload({ files: source, lifetimeMs: 60_000, encrypt: false }).result;
    expect(outcome.status).toBe('completed');
    expect(reads).toEqual([[0, CHUNK_SIZE], [CHUNK_SIZE, CHUNK_SIZE * 2], [CHUNK_SIZE * 2, CHUNK_SIZE * 2 + 1]]);
    expect(server.chunkBodies.map((body) => body.length)).toEqual([CHUNK_SIZE, CHUNK_SIZE, 1]);
    expect(Buffer.concat(server.chunkBodies).equals(Buffer.from(bytes))).toBe(true);
    expect(JSON.parse(server.requests.find((r) => r.url.endsWith('/api/v4/uploads'))!.body))
      .toMatchObject({ encrypted: false, size: CHUNK_SIZE * 2 + 1, files: [{ name: 'readings.bin', size: CHUNK_SIZE * 2 + 1 }] });
  });

  it('a Node.js file handle is a source through sources.fileHandle()', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropgate-core-'));
    const path = join(dir, 'on-disk.bin');
    await writeFile(path, Uint8Array.from([9, 8, 7, 6, 5, 4]));
    const handle = await open(path, 'r');
    try {
      const source = await sources.fileHandle(handle, { name: 'on-disk.bin' });
      expect({ name: source.name, size: source.size }).toEqual({ name: 'on-disk.bin', size: 6 });
      expect([...await source.read(2, 5)]).toEqual([7, 6, 5]);

      const server = fakeServer();
      const outcome = await createClient(server.fetchFn).hosted.upload({ files: source, lifetimeMs: 60_000, encrypt: true }).result;
      expect(outcome.status).toBe('completed');
      // Encrypted: one chunk, the 6 bytes (which Padmé leaves as they are) and a 16-byte tag, after the 60-byte header.
      expect(server.chunkBodies.map((body) => body.length)).toEqual([6 + 16]);
      expect(JSON.parse(server.requests.find((r) => r.url.endsWith('/api/v4/uploads'))!.body)).toMatchObject({ encrypted: true, size: 60 + 6 + 16 });
    } finally {
      await handle.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('a source that fails to read, or gives other than the bytes asked for, fails the upload as SOURCE_UNAVAILABLE', async () => {
    const short: FileSource = { name: 'shrunk.bin', size: CHUNK_SIZE * 2, read: async (start, end) => new Uint8Array(Math.max(0, end - start - 1)) };
    const broken: FileSource = { name: 'gone.bin', size: CHUNK_SIZE, read: async () => { throw new Error('ENOENT: gone.bin'); } };
    for (const source of [short, broken]) {
      for (const encrypt of [false, true]) {
        const server = fakeServer();
        const outcome = await createClient(server.fetchFn).hosted.upload({ files: source, lifetimeMs: 60_000, encrypt }).result;
        expect(codeOf(outcome)).toBe('SOURCE_UNAVAILABLE');
        expect(server.chunkIndexes).toEqual([]);
        expect(JSON.stringify(outcome)).not.toContain(source.name);
      }
    }
  });
});

/** A promise and the function that settles it, for holding a step until the test lets it go. */
function gate<T = void>() {
  let open!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { open = resolve; });
  return { promise, open };
}

/** A sink that records what it's given and what's called on it, in `log`. */
function recordingSink(log: string[] = [], label = 'sink') {
  const chunks: Uint8Array[] = [];
  const sink: Required<DownloadSink> = {
    write: (chunk: Uint8Array) => { chunks.push(chunk.slice()); log.push(`${label} write ${chunk.byteLength}`); },
    close: () => { log.push(`${label} close`); },
    abort: (reason?: unknown) => { log.push(`${label} abort ${(reason as { code?: string })?.code ?? 'no code'}`); },
  };
  return { sink, log, bytes: () => new Uint8Array(Buffer.concat(chunks)) };
}

/** Everything a fake server was sent, as one string. */
const allSent = (server: ReturnType<typeof fakeServer>) =>
  server.requests.map((r) => [r.url, decodeURIComponent(r.url), r.headers, r.body].join('\n')).join('\n');

describe('client.operations', () => {
  it('gives every operation an ID of its own, a random UUID that never reaches the server, and lists what is running', async () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);
    server.answer(CHUNK, noAnswer);
    server.answer(CONTENT, endlessBody);

    const handles = [
      client.hosted.upload({ files: fileNamed('one.txt'), lifetimeMs: 60_000, encrypt: false }),
      client.hosted.upload({ files: fileNamed('two.txt'), lifetimeMs: 60_000, encrypt: false }),
      client.hosted.download({ id: FILE_ID, sink: nullSink() }),
    ];
    const ids = handles.map((handle) => handle.id);
    expect(new Set(ids).size, 'each ID is its own').toBe(3);
    for (const id of ids) expect(id).toMatch(UUID_V4);

    expect(client.operations.list()).toEqual([
      { id: ids[0], kind: 'hosted.upload' },
      { id: ids[1], kind: 'hosted.upload' },
      { id: ids[2], kind: 'hosted.download' },
    ]);
    for (const handle of handles) expect(client.operations.get(handle.id)).toBe(handle);
    expect(client.operations.get('9f1c0d2e-0000-4000-8000-000000000000')).toBeUndefined();

    await expect.poll(() => server.paths()).toEqual(expect.arrayContaining(['PUT /api/v4/upload/chunks/0', CONTENT]));
    client.operations.cancelAll();
    await Promise.all(handles.map((handle) => handle.result));
    expect(ids.filter((id) => allSent(server).includes(id)), 'IDs that reached the server').toEqual([]);
  });

  it('an operation leaves the moment it ends, however it ends, before its outcome or last snapshot reaches anyone', async () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);
    const completing = client.hosted.upload({ files: fileNamed('one.txt'), lifetimeMs: 60_000, encrypt: false });
    const failing = client.hosted.download({ id: FILE_ID, sink: { write: () => { throw new Error('Disk full.'); }, close: () => {} } });
    const cancelled = client.hosted.upload({ files: fileNamed('two.txt'), lifetimeMs: 60_000, encrypt: false });
    cancelled.cancel();
    expect(client.operations.list()).toHaveLength(3);

    const atTheEnd: string[] = [];
    const where = (id: string) => (client.operations.get(id) ? 'listed' : 'gone');
    completing.subscribe((s) => { if (s.status === 'completed') atTheEnd.push(`completed: ${where(completing.id)}`); });
    failing.subscribe((s) => { if (s.status === 'failed') atTheEnd.push(`failed: ${where(failing.id)}`); });
    const outcomes = await Promise.all([completing, failing, cancelled].map(async (handle) => {
      const outcome = await handle.result;
      return `${outcome.status}: ${where(handle.id)}`;
    }));

    expect(outcomes).toEqual(['completed: gone', 'failed: gone', 'cancelled: gone']);
    expect(atTheEnd.sort()).toEqual(['completed: gone', 'failed: gone']);
    expect(client.operations.list()).toEqual([]);
  });

  it('cancelAll() cancels everything running, by the client; the registry empties, and what starts afterwards is listed as usual', async () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);
    server.answer(CHUNK, noAnswer);
    server.answer(CONTENT, endlessBody);
    const upload = client.hosted.upload({ files: fileNamed('one.txt'), lifetimeMs: 60_000, encrypt: false });
    const download = client.hosted.download({ id: FILE_ID, sink: nullSink() });
    await expect.poll(() => server.paths()).toEqual(expect.arrayContaining(['PUT /api/v4/upload/chunks/0', CONTENT]));

    client.operations.cancelAll();
    const byClient = { status: 'cancelled', cancellation: { by: 'parent', source: 'client' }, transport };
    expect([await upload.result, await download.result]).toEqual([byClient, byClient]);
    expect(client.operations.list()).toEqual([]);

    server.answer(CHUNK, null);
    const next = client.hosted.upload({ files: fileNamed('two.txt'), lifetimeMs: 60_000, encrypt: false });
    expect(client.operations.list()).toEqual([{ id: next.id, kind: 'hosted.upload' }]);
    expect((await next.result).status).toBe('completed');
    expect(client.operations.list()).toEqual([]);
  });

  it("makes its IDs without crypto.randomUUID(), which a page served over plain HTTP doesn't have", () => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const ids = Array.from({ length: 50 }, () => newOperationId());
      for (const id of ids) expect(id).toMatch(UUID_V4);
      expect(new Set(ids).size).toBe(50);
    } finally {
      delete (globalThis.crypto as { randomUUID?: unknown }).randomUUID;
    }
    expect(typeof globalThis.crypto.randomUUID).toBe('function');
  });
});

describe('Hosted download into a sink', () => {
  it('awaits each write before reading on, and only completes once the sink has closed, then releases its lease', async () => {
    const server = fakeServer();
    server.v4.store(FILE_ID, { encrypted: false, size: 8, bytes: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), files: [{ name: 'notes.txt', size: 8 }] });
    server.answer(CONTENT, () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
        controller.enqueue(new Uint8Array([5, 6, 7, 8]));
        controller.close();
      },
    })));
    const writes: Array<{ chunk: number[]; done: { open: () => void } }> = [];
    const closing = gate();
    let closeCalled = false;
    const download = createClient(server.fetchFn).hosted.download({
      id: FILE_ID,
      sink: {
        write: (chunk) => { const done = gate(); writes.push({ chunk: [...chunk], done }); return done.promise; },
        close: () => { closeCalled = true; return closing.promise; },
      },
    });
    let ended = false;
    void download.result.then(() => { ended = true; });

    await expect.poll(() => writes.length).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect({ writes: writes.length, processed: download.snapshot.processedBytes }, 'nothing more while the first write waits').toEqual({ writes: 1, processed: 0 });

    writes[0].done.open();
    await expect.poll(() => writes.length).toBe(2);
    writes[1].done.open();
    await expect.poll(() => closeCalled).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect({ ended, status: download.snapshot.status }, 'not complete until the sink has closed').toEqual({ ended: false, status: 'completing' });
    expect(server.paths(), 'the lease is held until the sink has closed').not.toContain(RELEASE);

    closing.open();
    expect(await download.result).toEqual({ status: 'completed', value: { filename: 'notes.txt', receivedBytes: 8, wasEncrypted: false, transport }, transport });
    expect(writes.map((w) => w.chunk)).toEqual([[1, 2, 3, 4], [5, 6, 7, 8]]);
    expect(download.snapshot).toMatchObject({ status: 'completed', phase: 'done', percent: 100, processedBytes: 8, totalBytes: 8 });
    expect(server.paths().filter((path) => path.includes('/api/v4/'))).toEqual([META, LEASE, CONTENT, RELEASE]);
  });

  it('takes one lease for a download, sends it only in Dropgate-Lease, and releases it however the download ends', async () => {
    const run = async (setUp: (server: ReturnType<typeof fakeServer>) => void, sink: DownloadSink = nullSink(), cancel = false) => {
      const server = fakeServer();
      setUp(server);
      const download = createClient(server.fetchFn).hosted.download({ id: FILE_ID, sink });
      if (cancel) {
        await expect.poll(() => server.paths()).toContain(CONTENT);
        download.cancel();
      }
      const status = (await download.result).status;
      await expect.poll(() => server.paths()).toContain(RELEASE);
      const [lease] = [...server.v4.leases.keys()];
      return {
        status,
        leases: server.paths().filter((path) => path === LEASE).length,
        headers: [...server.headerOf(CONTENT, 'Dropgate-Lease'), ...server.headerOf(RELEASE, 'Dropgate-Lease')],
        inUrls: server.requests.filter((r) => lease && r.url.includes(lease)).length,
        released: server.v4.leases.size,
      };
    };
    const results = [
      await run(() => {}),
      await run(() => {}, { write: () => { throw new Error('Disk full.'); }, close: () => {} }),
      await run((s) => s.answer(CONTENT, endlessBody), nullSink(), true),
    ];
    expect(results.map((r) => r.status)).toEqual(['completed', 'failed', 'cancelled']);
    for (const result of results) {
      expect(result.leases, 'one lease each').toBe(1);
      expect(result.headers, 'the lease, in its header').toEqual([expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), result.headers[0]]);
      expect(result.inUrls, 'the lease in a URL').toBe(0);
      expect(result.released, 'leases still open').toBe(0);
    }

    // Metadata takes none.
    const server = fakeServer();
    await createClient(server.fetchFn).hosted.metadata({ id: FILE_ID });
    expect(server.paths()).toEqual(['GET /api/info', META]);
  });

  it('waits while the server says someone else is downloading, asking again when it says to, then downloads', async () => {
    const server = fakeServer();
    let busy = 2;
    server.answer(LEASE, async (init) => (busy-- > 0
      ? new Response(JSON.stringify({ code: 'DOWNLOADS_BUSY', error: 'Someone is downloading this right now. Try again shortly.' }), {
        status: 423, headers: { 'Content-Type': 'application/json', 'Retry-After': '0' },
      })
      : (await server.v4.handle('POST', `/api/v4/objects/${FILE_ID}/leases`, init))!));
    const download = createClient(server.fetchFn).hosted.download({ id: FILE_ID, sink: nullSink() });
    const seen: DownloadSnapshot[] = [];
    download.subscribe((snapshot) => seen.push(snapshot));
    expect((await download.result).status).toBe('completed');
    expect(server.paths().filter((path) => path === LEASE)).toHaveLength(3);
    expect(seen.filter((s) => s.text === 'Someone is downloading this right now.').map((s) => s.status)).toEqual(['downloading', 'downloading']);
  });

  it('a write or a close that fails fails the download as OUTPUT_WRITE_FAILED, so it never completes', async () => {
    const failingWrite = recordingSink();
    failingWrite.sink.write = () => { throw new Error('Disk full.'); };
    const failingClose = recordingSink();
    failingClose.sink.close = () => Promise.reject(new Error('The file could not be saved.'));

    for (const { sink } of [failingWrite, failingClose]) {
      const outcome = await createClient(fakeServer().fetchFn).hosted.download({ id: FILE_ID, sink }).result;
      expect(codeOf(outcome)).toBe('OUTPUT_WRITE_FAILED');
    }
    // A failed write aborts the sink, and it's never closed; a close that failed leaves nothing to abort.
    expect(failingWrite.log).toEqual(['sink abort OUTPUT_WRITE_FAILED']);
    expect(failingClose.log).toEqual([`sink write ${CHUNK_SIZE}`]);
  });

  it('a cancelled download aborts its sink and never closes it, and so does one cut off part-way', async () => {
    const server = fakeServer();
    server.answer(CONTENT, endlessBody);
    server.v4.store(FILE_ID, { encrypted: false, size: CHUNK_SIZE * 2, bytes: new Uint8Array(CHUNK_SIZE * 2), files: [{ name: 'notes.txt', size: CHUNK_SIZE * 2 }] });
    const { sink, log } = recordingSink();
    const download = createClient(server.fetchFn).hosted.download({ id: FILE_ID, sink });
    await expect.poll(() => log).toContain(`sink write ${CHUNK_SIZE}`);
    download.cancel();
    expect(await download.result).toEqual({ status: 'cancelled', cancellation: { by: 'self', source: 'hosted.download' }, transport });
    expect(log).toEqual([`sink write ${CHUNK_SIZE}`, 'sink abort OPERATION_CANCELLED']);

    // Even with every byte of the file in: the download isn't whole until the answer has ended.
    const lost = fakeServer();
    let pulls = 0;
    lost.answer(CONTENT, () => new Response(new ReadableStream({
      pull(controller) {
        if (pulls++ === 0) controller.enqueue(new Uint8Array(CHUNK_SIZE));
        else controller.error(new TypeError('terminated'));
      },
    })));
    const cut = recordingSink();
    expect(codeOf(await createClient(lost.fetchFn).hosted.download({ id: FILE_ID, sink: cut.sink }).result)).toBe('CONNECTION_LOST');
    expect(cut.log).toEqual([`sink write ${CHUNK_SIZE}`, 'sink abort CONNECTION_LOST']);
  });

  it('an unencrypted upload whose bytes come to more or less than its size fails INTEGRITY_FAILED, and its sink is aborted', async () => {
    for (const sent of [CHUNK_SIZE + 1, CHUNK_SIZE - 1]) {
      const server = fakeServer();
      server.answer(CONTENT, () => new Response(new Uint8Array(sent)));
      const opened = recordingSink();
      const outcome = await createClient(server.fetchFn).hosted.download({ id: FILE_ID, sink: opened.sink }).result;
      expect(codeOf(outcome), `${sent} bytes for a ${CHUNK_SIZE}-byte file`).toBe('INTEGRITY_FAILED');
      expect(opened.log.at(-1)).toBe('sink abort INTEGRITY_FAILED');
      expect(opened.log).not.toContain('sink close');
    }
  });

  it('an encrypted upload cut short, changed or with bytes added fails INTEGRITY_FAILED, before its sink is closed', async () => {
    const plaintext = Uint8Array.from({ length: CHUNK_SIZE + 100 }, (_, i) => i % 256);
    const sealed = await sealedObject('report.pdf', plaintext);
    const { bytes } = sealed.stored;
    const changed = bytes.slice();
    changed[100] ^= 1;
    for (const [what, sent] of [
      ['cut short at its last chunk', bytes.subarray(0, bytes.length - 20)],
      ['one byte changed', changed],
      ['a byte added', new Uint8Array(Buffer.concat([bytes, new Uint8Array(1)]))],
    ] as const) {
      const server = fakeServer();
      server.v4.store(FILE_ID, sealed.stored);
      server.answer(CONTENT, () => new Response(sent));
      const opened = recordingSink();
      const outcome = await createClient(server.fetchFn).hosted.download({ id: FILE_ID, secret: sealed.secret, sink: opened.sink }).result;
      expect(codeOf(outcome), what).toBe('INTEGRITY_FAILED');
      expect(opened.log, what).not.toContain('sink close');
      expect(opened.log.at(-1), what).toBe('sink abort INTEGRITY_FAILED');
    }
  });

  it('a bundle as separate files asks for a sink for each, told its name and size; as a ZIP it writes one archive to one sink', async () => {
    const log: string[] = [];
    const server = fakeServer();
    server.answer(`GET /api/bundle/${BUNDLE_ID}/meta`, () => server.json(200, {
      isEncrypted: false,
      files: [{ fileId: FILE_ID, sizeBytes: 4, filename: 'a.txt' }, { fileId: SECOND_FILE_ID, sizeBytes: 2, filename: 'b.txt' }],
    }));
    server.answer(`GET /api/file/${SECOND_FILE_ID}`, () => new Response(new Uint8Array([7, 8])));
    server.answer(`POST /api/bundle/${BUNDLE_ID}/downloaded`, () => { log.push('server told'); return server.json(200, {}); });
    const client = createClient(server.fetchFn);

    const asked: unknown[] = [];
    const separate = await client.hosted.download({
      bundleId: BUNDLE_ID,
      sink: (file) => { asked.push(file); return recordingSink(log, file.name).sink; },
    }).result;
    expect(asked).toEqual([{ name: 'a.txt', size: 4, index: 0 }, { name: 'b.txt', size: 2, index: 1 }]);
    expect(log).toEqual(['a.txt write 4', 'a.txt close', 'b.txt write 2', 'b.txt close']);
    expect(separate).toEqual({ status: 'completed', value: { filenames: ['a.txt', 'b.txt'], receivedBytes: 6, wasEncrypted: false, transport }, transport });

    log.length = 0;
    const archive = recordingSink(log, 'zip');
    const zipped = await client.hosted.download({ bundleId: BUNDLE_ID, asZip: true, sink: archive.sink }).result;
    expect(zipped.status).toBe('completed');
    expect([...archive.bytes().slice(0, 2)], 'a ZIP archive starts PK').toEqual([0x50, 0x4b]);
    expect(log.filter((entry) => !entry.startsWith('zip write')), 'the server is told only once the archive is saved').toEqual(['zip close', 'server told']);
  });

  it('an upload of several files gives each to its own sink, or all to one ZIP, under one lease', async () => {
    const server = fakeServer();
    const files = [{ name: 'a.txt', size: 3 }, { name: 'b.txt', size: CHUNK_SIZE + 1 }];
    const bytes = Uint8Array.from({ length: CHUNK_SIZE + 4 }, (_, i) => i % 251);
    server.v4.store(FILE_ID, { encrypted: false, size: bytes.length, bytes, files });
    const client = createClient(server.fetchFn);

    expect(await client.hosted.metadata({ id: FILE_ID })).toEqual({ kind: 'bundle', id: FILE_ID, encrypted: false, files, totalSize: CHUNK_SIZE + 4, transport });
    const log: string[] = [];
    const sinks = new Map<string, ReturnType<typeof recordingSink>>();
    const separate = await client.hosted.download({
      id: FILE_ID,
      sink: (file) => { const sink = recordingSink(log, file.name); sinks.set(file.name, sink); return sink.sink; },
    }).result;
    expect(separate).toEqual({ status: 'completed', value: { filenames: ['a.txt', 'b.txt'], receivedBytes: CHUNK_SIZE + 4, wasEncrypted: false, transport }, transport });
    expect([...sinks.get('a.txt')!.bytes()]).toEqual([...bytes.subarray(0, 3)]);
    expect([...sinks.get('b.txt')!.bytes()]).toEqual([...bytes.subarray(3)]);
    expect(log.filter((entry) => entry.endsWith('close'))).toEqual(['a.txt close', 'b.txt close']);

    const archive = recordingSink();
    expect((await client.hosted.download({ id: FILE_ID, asZip: true, sink: archive.sink }).result).status).toBe('completed');
    expect(zipMemberNames(archive.bytes())).toEqual(['a.txt', 'b.txt']);
    expect(server.paths().filter((path) => path === LEASE)).toHaveLength(2);
    // Several files apart need a sink each.
    expect(codeOf(await client.hosted.download({ id: FILE_ID, sink: nullSink() }).result)).toBe('INVALID_ARGUMENT');
  });

  it("a ZIP that couldn't be saved is never reported to the server as downloaded", async () => {
    const server = fakeServer();
    const archive = recordingSink();
    archive.sink.close = () => Promise.reject(new Error('Disk full.'));
    const outcome = await createClient(server.fetchFn).hosted.download({ bundleId: BUNDLE_ID, asZip: true, sink: archive.sink }).result;
    expect(codeOf(outcome)).toBe('OUTPUT_WRITE_FAILED');
    expect(server.paths()).not.toContain(`POST /api/bundle/${BUNDLE_ID}/downloaded`);
  });

  it("a ZIP member whose bytes don't come to the size the server gave fails INTEGRITY_FAILED, and the archive is never finished", async () => {
    for (const sent of [MEMBER_BYTES + 1, MEMBER_BYTES - 1]) {
      const server = fakeServer();
      server.answer(`GET /api/file/${FILE_ID}`, () => new Response(new Uint8Array(sent)));
      const archive = recordingSink();
      const outcome = await createClient(server.fetchFn).hosted.download({ bundleId: BUNDLE_ID, asZip: true, sink: archive.sink }).result;
      expect(codeOf(outcome), `${sent} bytes for a ${MEMBER_BYTES}-byte member`).toBe('INTEGRITY_FAILED');
      expect(archive.log.at(-1)).toBe('sink abort INTEGRITY_FAILED');
      expect(archive.log).not.toContain('sink close');
      expect(server.paths()).not.toContain(`POST /api/bundle/${BUNDLE_ID}/downloaded`);
    }
  });

  it('a download needs a sink that fits it, checked before it starts', () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);
    for (const opts of [
      { id: FILE_ID },
      { id: FILE_ID, sink: { write: () => {} } },
      { id: FILE_ID, asZip: true, sink: () => nullSink() },
      { bundleId: BUNDLE_ID, sink: nullSink() },
      { bundleId: BUNDLE_ID, asZip: true, sink: () => nullSink() },
    ]) {
      expect(() => client.hosted.download(opts as never), JSON.stringify(opts)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    }
    expect(client.operations.list()).toEqual([]);
    expect(server.requests).toEqual([]);
  });

  it('decrypts an encrypted file into its sink, padding and all checked, and none of its snapshots names the file', async () => {
    const name = 'Medical records for Sam.pdf';
    const plaintext = Uint8Array.from({ length: CHUNK_SIZE * 3 + 2 }, (_, i) => (i * 13) % 256);
    const sealed = await sealedObject(name, plaintext);
    const server = fakeServer();
    server.v4.store(FILE_ID, sealed.stored);

    const opened = recordingSink();
    const asked: unknown[] = [];
    const snapshots: DownloadSnapshot[] = [];
    const download = createClient(server.fetchFn).hosted.download({
      id: FILE_ID, secret: sealed.secret, sink: (file) => { asked.push(file); return opened.sink; },
    });
    download.subscribe((snapshot) => snapshots.push(snapshot));
    expect(await download.result).toEqual({ status: 'completed', value: { filename: name, receivedBytes: plaintext.length, wasEncrypted: true, transport }, transport });
    expect(asked).toEqual([{ name, size: plaintext.length, index: 0 }]);
    expect(Buffer.from(opened.bytes()).equals(Buffer.from(plaintext))).toBe(true);

    expect(snapshots.at(-1)).toMatchObject({ status: 'completed', totalBytes: plaintext.length });
    const secrets = [...piecesOf(name, 8), ...piecesOf(sealed.secret, 8)];
    for (const snapshot of snapshots) {
      const shown = JSON.stringify(snapshot);
      expect(secrets.filter((piece) => shown.includes(piece)), shown).toEqual([]);
    }
    expect(secrets.filter((piece) => allSent(server).includes(piece)), 'the secret or the name reached the server').toEqual([]);
  });

  it('times each wait, not the whole download: a file that keeps arriving completes, however long it takes, and a slow sink never counts', async () => {
    const server = fakeServer();
    server.v4.store(FILE_ID, { encrypted: false, size: 16, bytes: new Uint8Array(16), files: [{ name: 'notes.txt', size: 16 }] });
    server.answer(CONTENT, () => {
      let sent = 0;
      return new Response(new ReadableStream({
        async pull(controller) {
          await new Promise((resolve) => setTimeout(resolve, 40));
          if (sent === 4) {
            controller.close();
            return;
          }
          sent += 1;
          controller.enqueue(new Uint8Array(4));
        },
      }));
    });
    const opened = recordingSink();
    const write = opened.sink.write;
    opened.sink.write = async (chunk) => {
      write(chunk);
      await new Promise((resolve) => setTimeout(resolve, 150));
    };

    const started = Date.now();
    const outcome = await createClient(server.fetchFn).hosted.download({ id: FILE_ID, sink: opened.sink, timeoutMs: 100 }).result;
    expect(codeOf(outcome)).toBe('completed');
    expect(Date.now() - started, 'the whole download took longer than timeoutMs').toBeGreaterThan(400);
    expect(opened.log).toEqual(['sink write 4', 'sink write 4', 'sink write 4', 'sink write 4', 'sink close']);
  });

  it('fails TIMED_OUT when the answer or the next bytes take longer than timeoutMs, and aborts its sink', async () => {
    for (const [answer, log] of [
      [endlessBody, [`sink write ${CHUNK_SIZE}`, 'sink abort TIMED_OUT']],
      [noAnswer, ['sink abort TIMED_OUT']],
    ] as const) {
      const server = fakeServer();
      server.v4.store(FILE_ID, { encrypted: false, size: CHUNK_SIZE * 2, bytes: new Uint8Array(CHUNK_SIZE * 2), files: [{ name: 'notes.txt', size: CHUNK_SIZE * 2 }] });
      server.answer(CONTENT, answer);
      const opened = recordingSink();
      const outcome = await createClient(server.fetchFn).hosted.download({ id: FILE_ID, sink: opened.sink, timeoutMs: 50 }).result;
      expect(codeOf(outcome), answer.name).toBe('TIMED_OUT');
      expect(opened.log, answer.name).toEqual(log);
    }
  });
});

describe('client.hosted.validate()', () => {
  const MB = 1024 * 1024;
  const serverInfo = (e2ee: boolean) => ({
    version: '4.0.0',
    capabilities: { upload: { enabled: true, maxSizeMB: 1, maxLifetimeHours: 0, e2ee, chunkSize: MB } },
  });
  const codeThrown = (run: () => unknown): string => {
    try {
      run();
      return 'passed';
    } catch (err) {
      return (err as DropgateError).code;
    }
  };

  it('counts encryption as upload() does when encrypt is left out: encrypted where the server supports it', () => {
    const { hosted } = createClient(fakeServer().fetchFn);
    const files = new File([new Uint8Array(MB)], 'data.bin');
    expect(codeThrown(() => hosted.validate({ files, lifetimeMs: 60_000, serverInfo: serverInfo(true) })), 'overhead counted').toBe('FILE_TOO_LARGE');
    expect(codeThrown(() => hosted.validate({ files, lifetimeMs: 60_000, encrypt: false, serverInfo: serverInfo(true) }))).toBe('passed');
    expect(codeThrown(() => hosted.validate({ files, lifetimeMs: 60_000, serverInfo: serverInfo(false) })), 'no E2EE, so none').toBe('passed');
  });

  it("counts one encrypted file as the server stores it: its header and tags, but never padding past the limit", () => {
    const { hosted } = createClient(fakeServer().fetchFn);
    // 1 MB less the header and one tag fits exactly; one byte more doesn't. Padmé would make both larger.
    const fits = new File([new Uint8Array(MB - 60 - 16)], 'fits.bin');
    const over = new File([new Uint8Array(MB - 60 - 15)], 'over.bin');
    expect(codeThrown(() => hosted.validate({ files: fits, lifetimeMs: 60_000, serverInfo: serverInfo(true) }))).toBe('passed');
    expect(codeThrown(() => hosted.validate({ files: over, lifetimeMs: 60_000, serverInfo: serverInfo(true) }))).toBe('FILE_TOO_LARGE');
  });
});

describe('client.hosted.metadata()', () => {
  it("gives a file's name and size, opened with the secret for an encrypted upload, and never sends the secret", async () => {
    const name = 'Holiday photos.zip';
    const sealed = await sealedObject(name, new Uint8Array(CHUNK_SIZE * 2 + 1));
    const server = fakeServer();
    const client = createClient(server.fetchFn);
    expect(await client.hosted.metadata({ id: FILE_ID }))
      .toEqual({ kind: 'file', id: FILE_ID, encrypted: false, files: [{ name: 'notes.txt', size: CHUNK_SIZE }], totalSize: CHUNK_SIZE, transport });

    server.v4.store(FILE_ID, sealed.stored);
    expect(await client.hosted.metadata({ id: FILE_ID, secret: sealed.secret }))
      .toEqual({ kind: 'file', id: FILE_ID, encrypted: true, files: [{ name, size: CHUNK_SIZE * 2 + 1 }], totalSize: CHUNK_SIZE * 2 + 1, transport });
    await expect(client.hosted.metadata({ id: FILE_ID })).rejects.toMatchObject({ code: 'KEY_REQUIRED' });
    await expect(client.hosted.metadata({ id: FILE_ID, secret: LINK_SECRET })).rejects.toMatchObject({ code: 'DECRYPT_FAILED' });
    await expect(client.hosted.metadata({ id: FILE_ID, secret: 'too-short' })).rejects.toMatchObject({ code: 'DECRYPT_FAILED' });
    expect(piecesOf(sealed.secret, 8).filter((piece) => allSent(server).includes(piece))).toEqual([]);
    expect(server.paths().filter((path) => path.endsWith('/leases')), 'leases taken').toEqual([]);
  });

  it("reads a sealed bundle's files with its key", async () => {
    const files = [
      { fileId: FILE_ID, name: 'tax return.xlsx', sizeBytes: 9 },
      { fileId: SECOND_FILE_ID, name: 'a.txt', sizeBytes: 3 },
    ];
    const key = await provider.generateKey();
    const manifest = await provider.encrypt(key, new TextEncoder().encode(JSON.stringify({ files })));
    const encryptedManifest = Buffer.from(manifest).toString('base64');
    const server = fakeServer();
    server.answer(`GET /api/bundle/${BUNDLE_ID}/meta`, () => server.json(200, { isEncrypted: true, sealed: true, encryptedManifest }));
    const meta = await createClient(server.fetchFn).hosted.metadata({ bundleId: BUNDLE_ID, keyB64: await keyToBase64(provider, key, base64) });
    expect(meta).toEqual({ kind: 'bundle', bundleId: BUNDLE_ID, isEncrypted: true, sealed: true, files, fileCount: 2, totalSizeBytes: 12, transport });
  });

  it('needs an upload or a bundle ID, and asks nothing without one, nor about an ID no server makes', async () => {
    const server = fakeServer();
    await expect(createClient(server.fetchFn).hosted.metadata({} as never)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(server.requests).toEqual([]);
    await expect(createClient(server.fetchFn).hosted.metadata({ id: '../api/info' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(server.paths()).toEqual(['GET /api/info']);
  });

  it("refuses an unencrypted upload's list of files that doesn't add up to its size", async () => {
    const server = fakeServer();
    server.answer(META, () => server.json(200, { encrypted: false, size: 10, files: [{ name: 'a.txt', size: 4 }] }));
    await expect(createClient(server.fetchFn).hosted.metadata({ id: FILE_ID })).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
  });
});

/** The member names in a ZIP archive, from its local file headers. */
function zipMemberNames(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const names: string[] = [];
  for (let i = 0; i + 30 <= bytes.length; i++) {
    if (view.getUint32(i, true) !== 0x04034b50) continue;
    const length = view.getUint16(i + 26, true);
    names.push(new TextDecoder().decode(bytes.slice(i + 30, i + 30 + length)));
  }
  return names;
}

describe('The file name rule and the size rule in the client', () => {
  it('refuses a bad name in an upload, encrypted or not, one file or several, before any request', async () => {
    for (const encrypt of [true, false]) {
      for (const [files, index] of [[[fileNamed('fine.txt'), fileNamed('é'.repeat(200))], 1], [[fileNamed('a/b.txt')], 0]] as const) {
        const server = fakeServer();
        const outcome = await createClient(server.fetchFn).hosted.upload({ files: [...files], lifetimeMs: 60_000, encrypt }).result;
        expect(outcome.status === 'failed' && outcome.error, `encrypt: ${encrypt}`).toMatchObject({ code: 'INVALID_FILENAME', origin: 'local', details: { index } });
        expect(server.requests).toEqual([]);
      }
    }
  });

  it('refuses a name received from the server that is structurally invalid, without naming it', async () => {
    const server = fakeServer();
    server.v4.store(FILE_ID, { encrypted: false, size: 4, bytes: new Uint8Array(4), files: [{ name: '../../evil.txt', size: 4 }] });
    server.answer(`GET /api/bundle/${BUNDLE_ID}/meta`, () => server.json(200, {
      isEncrypted: false,
      files: [{ fileId: FILE_ID, sizeBytes: 4, filename: 'a.txt' }, { fileId: SECOND_FILE_ID, sizeBytes: 4, filename: 'b\u0000.txt' }],
    }));
    const client = createClient(server.fetchFn);
    const error = await client.hosted.metadata({ id: FILE_ID }).catch((err: unknown) => err as DropgateError);
    expect(error).toMatchObject({ code: 'INVALID_FILENAME', origin: 'server' });
    expect(JSON.stringify(error)).not.toContain('evil');
    await expect(client.hosted.metadata({ bundleId: BUNDLE_ID })).rejects.toMatchObject({ code: 'INVALID_FILENAME', origin: 'server', details: { index: 1 } });
    expect(codeOf(await client.hosted.download({ id: FILE_ID, sink: nullSink() }).result)).toBe('INVALID_FILENAME');
  });

  it("saves a ZIP's members under their safe names, and tells two the same apart", async () => {
    const server = fakeServer();
    server.answer(`GET /api/bundle/${BUNDLE_ID}/meta`, () => server.json(200, {
      isEncrypted: false,
      files: [
        { fileId: FILE_ID, sizeBytes: 4, filename: 'photo‮gnp.exe' },
        { fileId: SECOND_FILE_ID, sizeBytes: 4, filename: 'Notes.txt' },
        { fileId: FILE_ID, sizeBytes: 4, filename: 'notes.txt' },
        { fileId: SECOND_FILE_ID, sizeBytes: 4, filename: 'CON.txt' },
      ],
    }));
    server.answer(`GET /api/file/${SECOND_FILE_ID}`, () => new Response(new Uint8Array(4)));
    const archive = recordingSink();
    const outcome = await createClient(server.fetchFn).hosted.download({ bundleId: BUNDLE_ID, asZip: true, sink: archive.sink }).result;
    expect(outcome.status).toBe('completed');
    expect(zipMemberNames(archive.bytes())).toEqual(['photo[U+202E]gnp.exe', 'Notes.txt', 'notes (1).txt', '_CON.txt']);
  });

  it("counts a server's maxSizeMB in 1024s: 1 MB allows 1,048,576 bytes, not 1,000,000", async () => {
    const MB = 1024 * 1024;
    const run = async (size: number) => {
      const server = fakeServer({ chunkSize: MB, maxSizeMB: 1 });
      const outcome = await createClient(server.fetchFn).hosted.upload({
        files: new File([new Uint8Array(size)], 'data.bin'),
        lifetimeMs: 60_000,
        encrypt: false,
      }).result;
      return codeOf(outcome);
    };
    expect(await run(1_000_001)).toBe('completed');
    expect(await run(MB)).toBe('completed');
    expect(await run(MB + 1)).toBe('FILE_TOO_LARGE');
  });
});

describe('Downloading some of an upload\'s files', () => {
  it('writes only the files asked for, by their index in the list, in order, each told its index', async () => {
    const server = fakeServer();
    const files = [{ name: 'a.txt', size: 3 }, { name: 'b.txt', size: CHUNK_SIZE + 1 }, { name: 'c.txt', size: 5 }];
    const bytes = Uint8Array.from({ length: CHUNK_SIZE + 9 }, (_, i) => i % 251);
    server.v4.store(FILE_ID, { encrypted: false, size: bytes.length, bytes, files });
    const client = createClient(server.fetchFn);

    const asked: unknown[] = [];
    const sinks: Record<string, ReturnType<typeof recordingSink>> = {};
    const outcome = await client.hosted.download({
      id: FILE_ID, files: [2, 1],
      sink: (file) => { asked.push(file); sinks[file.name] = recordingSink(); return sinks[file.name].sink; },
    }).result;
    expect(outcome).toEqual({ status: 'completed', value: { filenames: ['b.txt', 'c.txt'], receivedBytes: CHUNK_SIZE + 6, wasEncrypted: false, transport }, transport });
    expect(asked).toEqual([{ name: 'b.txt', size: CHUNK_SIZE + 1, index: 1 }, { name: 'c.txt', size: 5, index: 2 }]);
    expect(Buffer.from(sinks['b.txt'].bytes()).equals(Buffer.from(bytes.subarray(3, CHUNK_SIZE + 4)))).toBe(true);
    expect(Buffer.from(sinks['c.txt'].bytes()).equals(Buffer.from(bytes.subarray(CHUNK_SIZE + 4)))).toBe(true);

    // One file of several takes a single sink, and gives its name.
    const one = recordingSink();
    expect(await client.hosted.download({ id: FILE_ID, files: [0], sink: one.sink }).result)
      .toEqual({ status: 'completed', value: { filename: 'a.txt', receivedBytes: 3, wasEncrypted: false, transport }, transport });
    expect(one.log).toEqual(['sink write 3', 'sink close']);
    expect(codeOf(await client.hosted.download({ id: FILE_ID, files: [3], sink: nullSink() }).result), 'a file it doesn\'t have').toBe('INVALID_ARGUMENT');
  });

  it("gives a bundle's files one at a time without telling the server it was downloaded", async () => {
    const log: string[] = [];
    const server = fakeServer();
    server.answer(`GET /api/bundle/${BUNDLE_ID}/meta`, () => server.json(200, {
      isEncrypted: false,
      files: [{ fileId: FILE_ID, sizeBytes: 4, filename: 'a.txt' }, { fileId: SECOND_FILE_ID, sizeBytes: 2, filename: 'b.txt' }],
    }));
    server.answer(`GET /api/file/${SECOND_FILE_ID}`, () => new Response(new Uint8Array([7, 8])));
    server.answer(`POST /api/bundle/${BUNDLE_ID}/downloaded`, () => { log.push('server told'); return server.json(200, {}); });
    const client = createClient(server.fetchFn);

    const asked: unknown[] = [];
    const second = await client.hosted.download({
      bundleId: BUNDLE_ID, files: [1], sink: (file) => { asked.push(file); return recordingSink(log, file.name).sink; },
    }).result;
    expect(second.status === 'completed' && second.value.filenames).toEqual(['b.txt']);
    expect(asked).toEqual([{ name: 'b.txt', size: 2, index: 1 }]);
    expect(server.paths()).not.toContain(`GET /api/file/${FILE_ID}`);
    const partZip = await client.hosted.download({ bundleId: BUNDLE_ID, files: [0], asZip: true, sink: recordingSink(log, 'zip').sink }).result;
    expect(partZip.status).toBe('completed');
    expect(log, 'the server is told only of a ZIP of every file').not.toContain('server told');
  });

  it('refuses a files list that isn\'t indexes, each once, before anything starts', () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);
    for (const files of [[], [-1], [1.5], [0, 0], 'all']) {
      expect(() => client.hosted.download({ id: FILE_ID, files, sink: nullSink() } as never), JSON.stringify(files))
        .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    }
    expect(server.requests).toEqual([]);
  });
});
