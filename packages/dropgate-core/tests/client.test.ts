import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { open, mkdtemp, writeFile, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DropgateClient, DropgateError, sources } from '../src/index.js';
import type { DownloadOutcome, DownloadSink, DownloadSnapshot, FileSource, Outcome, UploadHandle, UploadSnapshot } from '../src/index.js';
import { newOperationId } from '../src/operation.js';
import { cryptoProvider } from '../src/crypto/index.js';
import { createObject, ObjectLayout } from '../src/object/index.js';
import { CHUNK_SIZE, MANAGE_TOKEN, MANAGE_TOKEN_HASH, fakeV4 } from './helpers/fake-v4.js';
import type { StoredObject } from './helpers/fake-v4.js';
import { readZip } from './helpers/zip-reader.js';

const provider = cryptoProvider();

// DropgateClient against a fake server, through its `fetchFn` option: no
// network. One file or several, an upload is one Dropgate 4 object. The real
// server is in hosted.test.ts.

const BASE_URL = 'https://files.example';
const FILE_ID = '0b7d4c52-5f0e-4d8e-9a57-3c1f2e6b8a90';
// A Dropgate 3 bundle's ID, as its /b/ link has it.
const BUNDLE_ID = '6a1e9f3b-2c4d-4b7a-8e5f-9d0c1b2a3e4f';
const SECOND_FILE_ID = '9c3b2a1d-7e6f-4a5b-8c9d-0e1f2a3b4c5d';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// A link's secret, as it appears after the # in an encrypted link: 32 bytes, URL-safe base64.
const LINK_SECRET = 'CPuytR72dDo2WhXGdB6x6aXlPcJu7Ec0tYvcUn5GL0k';
// A version 3 link's key (standard base64, 44 characters), as a Dropgate 3 bundle's link had.
const LINK_KEY = 'q3Rk8vXo2LmN5pT7wYc9ZbHd4sFj6gKa1eUi0rQnVxM=';
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
const RENEW = 'POST /api/v4/lease/renew';

interface RecordedRequest {
  method: string;
  url: string;
  headers: string;
  body: string;
  credentials: RequestCredentials | undefined;
  keepalive: boolean | undefined;
}

/**
 * A fake Dropgate server behind `fetchFn`. It records every request, answers
 * Dropgate 4's routes as a server would (`v4`), with an unencrypted
 * `notes.txt` of CHUNK_SIZE bytes stored as FILE_ID, and every upload
 * finished stored there too. `onChunk`
 * runs while a chunk request is in flight, before the server answers it.
 */
function fakeServer({ chunkSize = CHUNK_SIZE, maxSizeMB = 0, maxPauseMinutes = 60 }: { chunkSize?: number; maxSizeMB?: number; maxPauseMinutes?: number } = {}) {
  const requests: RecordedRequest[] = [];
  const chunkIndexes: number[] = [];
  const chunkBodies: Uint8Array[] = [];
  let onChunk: (index: number) => void = () => {};
  // Answers that replace the usual one, by `METHOD /path`. One that throws is a network failure.
  const answers = new Map<string, (init: RequestInit) => Response | Promise<Response>>();
  const v4 = fakeV4({ chunkSize, id: FILE_ID, maxPauseMinutes });
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
      keepalive: init.keepalive,
    });

    // Answer on a later turn of the event loop, like a real network.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const path = new URL(url).pathname;
    const route = `${method} ${path.replace(/\/chunks\/\d+$/, '/chunks/:index')}`;
    const chunkIndex = route === CHUNK ? Number(path.split('/').pop()) : null;
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
            upload: { enabled: true, maxSizeMB, maxLifetimeHours: 0, e2ee: true, chunkSize, maxPauseMinutes },
            p2p: { enabled: true },
          },
        });
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
    /** The Range header of each content request, or `whole` for one with none. */
    ranges: () => requests
      .filter((r) => `${r.method} ${new URL(r.url).pathname}` === CONTENT)
      .map((r) => (JSON.parse(r.headers) as Record<string, string>).Range ?? 'whole'),
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
    const completed = [
      await client.hosted.upload({ files: file('one.txt'), lifetimeMs: 60_000, encrypt: false }).result,
      await client.hosted.upload({ files: [file('one.txt'), file('two.txt')], lifetimeMs: 60_000, encrypt: false }).result,
      await client.hosted.download({ id: FILE_ID, sink: () => nullSink() }).result,
      await client.hosted.download({ id: FILE_ID, asZip: true, sink: nullSink() }).result,
      await client.hosted.download({ id: FILE_ID, files: [1], sink: nullSink() }).result,
    ];
    expect(completed.map((outcome) => outcome.status)).toEqual(['completed', 'completed', 'completed', 'completed', 'completed']);
    const opened = await client.hosted.open({ id: FILE_ID });
    expect((await opened.download({ files: [0], sink: nullSink() }).result).status).toBe('completed');
    await opened.close();
    const cancelled = client.hosted.upload({ files: file('three.txt'), lifetimeMs: 60_000, encrypt: false, retry: { retries: 0 } });
    server.onChunk = () => cancelled.cancel();
    expect((await cancelled.result).status).toBe('cancelled');
    // cancel() tells the server without waiting for it.
    await expect.poll(() => server.paths()).toContain(CANCEL);

    const paths = new Set(server.paths());
    for (const path of [
      'GET /api/info', META, START, 'PUT /api/v4/upload/chunks/0', 'PUT /api/v4/upload/chunks/1',
      FINISH, LEASE, CONTENT, RELEASE, CANCEL,
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
    server.answer(CHUNK, noAnswer);

    const settled: string[] = [];
    const download = client.hosted.download({ id: FILE_ID, sink: nullSink() }).result.then((o) => { settled.push('download'); return o; });
    const handle = client.hosted.upload({ files: [fileNamed('one.txt'), fileNamed('two.txt')], lifetimeMs: 60_000, encrypt: false });
    const upload = handle.result.then((o) => { settled.push('upload'); return o; });
    await expect.poll(() => server.paths()).toEqual(expect.arrayContaining([CONTENT, 'PUT /api/v4/upload/chunks/0']));

    client.operations.cancelAll();
    const byClient = { status: 'cancelled', cancellation: { by: 'parent', source: 'client' }, transport };
    expect(await download).toEqual(byClient);
    expect(await upload).toEqual(byClient);
    expect(settled.sort()).toEqual(['download', 'upload']);
    // One upload of two files, so one cancel.
    await expect.poll(() => server.headerOf(CANCEL, 'Dropgate-Upload')).toEqual(['upload-1']);

    // A cancel after the fact reaches nothing, and new operations run as normal.
    client.operations.cancelAll();
    server.answer(CHUNK, null);
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
    await expect(createClient(gone.fetchFn).hosted.open({ id: SECOND_FILE_ID })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(createClient(gone.fetchFn).hosted.open({} as never)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
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
    const failingUpload = createClient(failing.fetchFn).hosted.upload({ files: fileNamed(name, 2), lifetimeMs: 60_000, encrypt: true, retry: { retries: 0 } });
    failingUpload.subscribe((snapshot) => snapshots.push(snapshot));
    reported.push(await failingUpload.result);
    const failingBundle = createClient(failing.fetchFn).hosted.upload({
      files: [fileNamed(name), fileNamed(`Copy of ${name}`)], lifetimeMs: 60_000, encrypt: true, retry: { retries: 0 },
    });
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
    // Nor does any snapshot an upload gives along the way, those saying which of several files it's on included.
    expect(snapshots.some((snapshot) => snapshot.fileIndex === 1)).toBe(true);
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
      status: 'initializing', phase: 'server-info', text: 'Checking server...', percent: 0, processedBytes: 0, totalBytes: CHUNK_SIZE * 3,
      canPause: false, pausedBy: null, deadline: null, transport,
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
      'initializing:server-compat', 'initializing:init', 'uploading:init', 'uploading:chunk',
      'completing:complete', 'completed:done',
    ]);
    // Bytes only ever go up, the files' chunks counted as one upload's, each saying which file it starts in.
    const bytes = seen.map((snapshot) => snapshot.processedBytes);
    expect(bytes).toEqual([...bytes].sort((x, y) => x - y));
    expect(seen.filter((snapshot) => snapshot.phase === 'chunk').map((s) => [s.fileIndex, s.chunkIndex, s.processedBytes]))
      .toEqual([[0, 0, 0], [0, 1, CHUNK_SIZE], [1, 2, CHUNK_SIZE * 2]]);
    expect(seen.filter((snapshot) => snapshot.status === 'uploading').every((s) => s.totalFiles === 2)).toBe(true);

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
    expect(waiting?.text).toMatch(/^Chunk upload failed\. Retrying in 0\.\ds\.\.\. \(1\/1\)$/);
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
    lost.answer(CONTENT, () => {
      let pulls = 0;
      return new Response(new ReadableStream({
        pull(controller) {
          if (pulls++ === 0) controller.enqueue(new Uint8Array(CHUNK_SIZE));
          else controller.error(new TypeError('terminated'));
        },
      }));
    });
    const cut = recordingSink();
    const outcome = await createClient(lost.fetchFn).hosted.download({ id: FILE_ID, sink: cut.sink, retry: { retries: 0 } }).result;
    expect(codeOf(outcome)).toBe('CONNECTION_LOST');
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

  it('several files apart ask for a sink for each, told its name and size; as a ZIP they write one archive to one sink', async () => {
    const log: string[] = [];
    const server = fakeServer();
    server.v4.store(FILE_ID, { encrypted: false, size: 6, bytes: new Uint8Array([1, 2, 3, 4, 7, 8]), files: [{ name: 'a.txt', size: 4 }, { name: 'b.txt', size: 2 }] });
    const client = createClient(server.fetchFn);

    const asked: unknown[] = [];
    const separate = await client.hosted.download({
      id: FILE_ID,
      sink: (file) => { asked.push(file); return recordingSink(log, file.name).sink; },
    }).result;
    expect(asked).toEqual([{ name: 'a.txt', size: 4, index: 0 }, { name: 'b.txt', size: 2, index: 1 }]);
    expect(log).toEqual(['a.txt write 4', 'a.txt close', 'b.txt write 2', 'b.txt close']);
    expect(separate).toEqual({ status: 'completed', value: { filenames: ['a.txt', 'b.txt'], receivedBytes: 6, wasEncrypted: false, transport }, transport });

    log.length = 0;
    const archive = recordingSink(log, 'zip');
    const zipped = await client.hosted.download({ id: FILE_ID, asZip: true, sink: archive.sink }).result;
    expect(zipped.status).toBe('completed');
    expect([...archive.bytes().slice(0, 2)], 'a ZIP archive starts PK').toEqual([0x50, 0x4b]);
    expect(log.filter((entry) => !entry.startsWith('zip write'))).toEqual(['zip close']);
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

  it("a ZIP that couldn't be saved fails OUTPUT_WRITE_FAILED, and its lease is still released", async () => {
    const server = fakeServer();
    server.v4.store(FILE_ID, { encrypted: false, size: 6, bytes: new Uint8Array(6), files: [{ name: 'a.txt', size: 4 }, { name: 'b.txt', size: 2 }] });
    const archive = recordingSink();
    archive.sink.close = () => Promise.reject(new Error('Disk full.'));
    const outcome = await createClient(server.fetchFn).hosted.download({ id: FILE_ID, asZip: true, sink: archive.sink }).result;
    expect(codeOf(outcome)).toBe('OUTPUT_WRITE_FAILED');
    expect(server.paths()).toContain(RELEASE);
    expect(server.v4.leases.size).toBe(0);
  });

  it("a ZIP whose bytes don't come to the sizes the server gave fails INTEGRITY_FAILED, and the archive is never finished", async () => {
    for (const sent of [7, 5]) {
      const server = fakeServer();
      server.v4.store(FILE_ID, { encrypted: false, size: 6, bytes: new Uint8Array(6), files: [{ name: 'a.txt', size: 4 }, { name: 'b.txt', size: 2 }] });
      server.answer(CONTENT, () => new Response(new Uint8Array(sent), { status: 200 }));
      const archive = recordingSink();
      const outcome = await createClient(server.fetchFn).hosted.download({ id: FILE_ID, asZip: true, sink: archive.sink }).result;
      expect(codeOf(outcome), `${sent} bytes for 6`).toBe('INTEGRITY_FAILED');
      expect(archive.log.at(-1)).toBe('sink abort INTEGRITY_FAILED');
      expect(archive.log).not.toContain('sink close');
    }
  });

  it('a download needs a sink that fits it, checked before it starts', () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);
    for (const opts of [
      { id: FILE_ID },
      { id: FILE_ID, sink: { write: () => {} } },
      { id: FILE_ID, asZip: true, sink: () => nullSink() },
      { id: FILE_ID, files: [0, 1], asZip: true, sink: () => nullSink() },
      { sink: nullSink() },
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
      const outcome = await createClient(server.fetchFn).hosted.download({ id: FILE_ID, sink: opened.sink, timeoutMs: 50, retry: { retries: 0 } }).result;
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

  it("reads an encrypted upload of several files from its sealed list, which only the secret opens: the server is never told how many", async () => {
    const sealed = await sealedFiles([{ name: 'tax return.xlsx', bytes: varied(9, 1) }, { name: 'a.txt', bytes: varied(3, 2) }]);
    const server = fakeServer();
    server.v4.store(FILE_ID, sealed.stored);
    const meta = await createClient(server.fetchFn).hosted.metadata({ id: FILE_ID, secret: sealed.secret });
    expect(meta).toEqual({
      kind: 'bundle', id: FILE_ID, encrypted: true, files: [{ name: 'tax return.xlsx', size: 9 }, { name: 'a.txt', size: 3 }], totalSize: 12, transport,
    });
    await expect(createClient(server.fetchFn).hosted.metadata({ id: FILE_ID })).rejects.toMatchObject({ code: 'KEY_REQUIRED' });
    await expect(createClient(server.fetchFn).hosted.metadata({ id: FILE_ID, secret: LINK_SECRET })).rejects.toMatchObject({ code: 'DECRYPT_FAILED' });
  });

  it('needs an upload ID, and asks nothing without one, nor about an ID no server makes', async () => {
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
    server.v4.store(SECOND_FILE_ID, { encrypted: false, size: 8, bytes: new Uint8Array(8), files: [{ name: 'a.txt', size: 4 }, { name: 'b\u0000.txt', size: 4 }] });
    const client = createClient(server.fetchFn);
    const error = await client.hosted.metadata({ id: FILE_ID }).catch((err: unknown) => err as DropgateError);
    expect(error).toMatchObject({ code: 'INVALID_FILENAME', origin: 'server' });
    expect(JSON.stringify(error)).not.toContain('evil');
    await expect(client.hosted.metadata({ id: SECOND_FILE_ID })).rejects.toMatchObject({ code: 'INVALID_FILENAME', origin: 'server', details: { index: 1 } });
    expect(codeOf(await client.hosted.download({ id: FILE_ID, sink: nullSink() }).result)).toBe('INVALID_FILENAME');
  });

  it("saves a ZIP's members under their safe names, and tells two the same apart", async () => {
    const server = fakeServer();
    const names = ['photo‮gnp.exe', 'Notes.txt', 'notes.txt', 'CON.txt'];
    server.v4.store(FILE_ID, { encrypted: false, size: 16, bytes: new Uint8Array(16), files: names.map((name) => ({ name, size: 4 })) });
    const archive = recordingSink();
    const outcome = await createClient(server.fetchFn).hosted.download({ id: FILE_ID, asZip: true, sink: archive.sink }).result;
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

  it('checks several files against the limit together, as one upload, before anything is sent', async () => {
    const MB = 1024 * 1024;
    for (const encrypt of [false, true]) {
      const server = fakeServer({ chunkSize: MB, maxSizeMB: 1 });
      const half = () => new File([new Uint8Array(MB / 2 + 1)], 'half.bin');
      const outcome = await createClient(server.fetchFn).hosted.upload({ files: [half(), half()], lifetimeMs: 60_000, encrypt }).result;
      expect(outcome.status === 'failed' && outcome.error, `encrypt: ${encrypt}`).toMatchObject({ code: 'FILE_TOO_LARGE', message: expect.stringMatching(/too large together/) });
      expect(server.paths().filter((path) => path !== 'GET /api/info')).toEqual([]);
    }
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

  it("asks only for the chunks a file is in, by one Range, never a chunk that's only padding, and writes it byte for byte", async () => {
    // 4 MiB and a byte, so Padme pads past its last chunk with a chunk of padding alone.
    const contents = [varied(10, 1), varied(4 * 1024 * 1024 - 10 - (CHUNK_SIZE + 5) + 1, 2), varied(CHUNK_SIZE + 5, 3)];
    const sealed = await sealedFiles(contents.map((bytes, i) => ({ name: `${'abc'[i]}.txt`, bytes })));
    const layout = ObjectLayout.fromStoredSize(sealed.stored.size, CHUNK_SIZE);
    const total = contents.reduce((sum, c) => sum + c.length, 0);
    expect((layout.chunkCount - 1) * CHUNK_SIZE, 'the last chunk is padding alone').toBeGreaterThanOrEqual(total);
    const server = fakeServer();
    server.v4.store(FILE_ID, sealed.stored);
    const client = createClient(server.fetchFn);
    // The stored bytes of the chunks holding plaintext [start, end).
    const chunksOf = (start: number, end: number) => {
      const { start: from, end: to } = layout.range(Math.floor(start / CHUNK_SIZE), Math.floor((end - 1) / CHUNK_SIZE));
      return `bytes=${from}-${to - 1}`;
    };
    const offsets = [0, 10, 10 + contents[1].length];

    for (let index = 0; index < 3; index++) {
      const before = server.ranges().length;
      const one = recordingSink();
      const outcome = await client.hosted.download({ id: FILE_ID, secret: sealed.secret, files: [index], sink: one.sink }).result;
      expect(codeOf(outcome), `file ${index}`).toBe('completed');
      expect(server.ranges().slice(before), `file ${index}'s request`).toEqual([chunksOf(offsets[index], offsets[index] + contents[index].length)]);
      expect(Buffer.from(one.bytes()).equals(Buffer.from(contents[index])), `file ${index}'s bytes`).toBe(true);
    }
    // No chunk of padding alone was asked for.
    const lastAsked = Math.max(...server.ranges().map((r) => Number(/-(\d+)$/.exec(r)![1])));
    expect(lastAsked).toBeLessThan(layout.range(layout.chunkCount - 1).start);

    // Two files side by side are one run, one Range.
    const before = server.ranges().length;
    const outcome = await client.hosted.download({ id: FILE_ID, secret: sealed.secret, files: [0, 1], asZip: true, sink: recordingSink().sink }).result;
    expect(codeOf(outcome)).toBe('completed');
    expect(server.ranges().slice(before)).toEqual([chunksOf(0, offsets[2])]);
  });

  it("asks only for an unencrypted file's own bytes, and writes them byte for byte", async () => {
    const contents = [varied(10, 4), varied(CHUNK_SIZE, 5), varied(7, 6)];
    const server = fakeServer();
    const bytes = new Uint8Array(Buffer.concat(contents));
    server.v4.store(FILE_ID, { encrypted: false, size: bytes.length, bytes, files: contents.map((c, i) => ({ name: `${'abc'[i]}.txt`, size: c.length })) });
    const client = createClient(server.fetchFn);
    const one = recordingSink();
    expect(codeOf(await client.hosted.download({ id: FILE_ID, files: [1], sink: one.sink }).result)).toBe('completed');
    expect(server.ranges()).toEqual([`bytes=10-${10 + CHUNK_SIZE - 1}`]);
    expect(Buffer.from(one.bytes()).equals(Buffer.from(contents[1]))).toBe(true);
    // Files not side by side are a Range each.
    const sinks: Uint8Array[][] = [];
    expect(codeOf(await client.hosted.download({
      id: FILE_ID, files: [0, 2], sink: () => { const sink = recordingSink(); sinks.push([]); return sink.sink; },
    }).result)).toBe('completed');
    expect(server.ranges().slice(1)).toEqual(['bytes=0-9', `bytes=${10 + CHUNK_SIZE}-`]);
  });

  it('downloads every file whole, to the last chunk and its padding, when all of them are asked for', async () => {
    const sealed = await sealedFiles([{ name: 'a.txt', bytes: varied(10, 1) }, { name: 'b.txt', bytes: varied(20, 2) }]);
    const server = fakeServer();
    server.v4.store(FILE_ID, sealed.stored);
    expect(codeOf(await createClient(server.fetchFn).hosted.download({ id: FILE_ID, secret: sealed.secret, files: [1, 0], asZip: true, sink: recordingSink().sink }).result)).toBe('completed');
    expect(server.ranges()).toEqual(['whole']);
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

/** A copy of `body` that gives its first `bytes` bytes, then fails as a dropped connection does. */
function cutAfter(body: ReadableStream<Uint8Array>, bytes: number): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let left = bytes;
  return new ReadableStream({
    async pull(controller) {
      if (left <= 0) {
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

/**
 * Answers the content route as the fake server does, but cuts each answer's
 * body after the next of `cuts` bytes (none once they've run out).
 */
function cutting(server: ReturnType<typeof fakeServer>, cuts: number[]) {
  server.answer(CONTENT, async (init) => {
    const res = (await server.v4.handle('GET', `/api/v4/objects/${FILE_ID}/content`, init))!;
    const cut = cuts.shift();
    return cut === undefined || !res.body ? res : new Response(cutAfter(res.body, cut), { status: res.status, headers: res.headers });
  });
}

/** Several files as one encrypted upload, as core makes it: what the server stores, and the link's secret. */
async function sealedFiles(files: Array<{ name: string; bytes: Uint8Array }>) {
  const writer = await createObject(provider, { files: files.map((f) => ({ name: f.name, size: f.bytes.length })), chunkSize: CHUNK_SIZE });
  const { layout } = writer;
  const padded = new Uint8Array(layout.length);
  padded.set(Buffer.concat(files.map((f) => f.bytes)));
  const parts: Uint8Array[] = [writer.header];
  for (let i = 0; i < layout.chunkCount; i++) {
    parts.push(await writer.seal(i, padded.slice(i * CHUNK_SIZE, i * CHUNK_SIZE + layout.chunkLength(i))));
  }
  return {
    secret: Buffer.from(writer.secret()).toString('base64url'),
    stored: { encrypted: true, size: layout.storedSize, bytes: new Uint8Array(Buffer.concat(parts)), meta: Buffer.from(writer.meta).toString('base64url') },
  };
}

/** Bytes that differ along their length, so a piece out of place or written twice shows. */
const varied = (size: number, seed: number) => Uint8Array.from({ length: size }, (_, i) => (i * 31 + seed * 7 + (i >> 8)) % 256);

/** Runs the fake timers, a tenth of a second at a time, until `promise` settles. */
async function settled<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  void promise.finally(() => { done = true; });
  while (!done) {
    await vi.advanceTimersByTimeAsync(100);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return promise;
}

describe('Retries', () => {
  it('retries a chunk that got no answer, timed out, or got a 408, 429 or 5xx, sending the same sealed bytes each time, then completes', async () => {
    const server = fakeServer();
    const plaintext = varied(CHUNK_SIZE, 1);
    const faults: Array<(init: RequestInit) => Response | Promise<Response>> = [
      () => new Response('Busy.', { status: 503 }),
      () => { throw new TypeError('fetch failed'); },
      noAnswer,
      () => server.json(500, { code: 'SERVER_ERROR', error: 'Something went wrong on the server.' }),
      () => server.json(408, { error: 'Request timeout.' }),
      () => new Response(JSON.stringify({ code: 'RATE_LIMITED', error: 'Too many requests.' }), {
        status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '1' },
      }),
      // The server took it, and the answer was lost on the way back.
      async (init) => { await server.v4.handle('PUT', '/api/v4/upload/chunks/0', init); throw new TypeError('terminated'); },
    ];
    const faultCount = faults.length;
    server.answer(CHUNK, async (init) => {
      const fault = faults.shift();
      return fault ? fault(init) : (await server.v4.handle('PUT', '/api/v4/upload/chunks/0', init))!;
    });
    const tries: number[] = [];
    server.onChunk = () => tries.push(Date.now());
    const random = vi.spyOn(Math, 'random');

    try {
      const upload = createClient(server.fetchFn).hosted.upload({
        files: new File([plaintext], 'notes.txt'), lifetimeMs: 60_000, encrypt: true,
        timeouts: { chunkMs: 50 }, retry: { backoffMs: 1 },
      });
      const outcome = await upload.result;
      expect(outcome.status).toBe('completed');
      expect(random, 'jitter comes from the crypto provider').not.toHaveBeenCalled();

      expect(server.chunkBodies).toHaveLength(faultCount + 1);
      for (const body of server.chunkBodies) expect(Buffer.from(body).equals(Buffer.from(server.chunkBodies[0])), 'the same sealed bytes').toBe(true);
      const digests = server.headerOf('PUT /api/v4/upload/chunks/0', 'Content-Digest');
      expect(new Set(digests).size).toBe(1);
      // The server's Retry-After is waited, not the backoff.
      expect(tries[6] - tries[5], 'the wait after a 429 with Retry-After: 1').toBeGreaterThanOrEqual(950);

      const secret = new URL((outcome as { value: { downloadUrl: string } }).value.downloadUrl).hash.slice(1);
      const got = recordingSink();
      expect((await createClient(server.fetchFn).hosted.download({ id: FILE_ID, secret, sink: got.sink }).result).status).toBe('completed');
      expect(Buffer.from(got.bytes()).equals(Buffer.from(plaintext))).toBe(true);
    } finally {
      random.mockRestore();
    }
  });

  it('fails at once with its code, never retrying, for any other 4xx and for 507', async () => {
    for (const [status, body, code] of [
      [400, { code: 'INVALID_CHUNK', error: 'There is no chunk with that index in this upload.' }, 'REQUEST_REJECTED'],
      [400, { code: 'DIGEST_MISMATCH', error: "The chunk's Content-Digest is missing, or doesn't match its bytes." }, 'INTEGRITY_FAILED'],
      [403, { code: 'AUTH_DENIED', error: 'No.' }, 'AUTH_DENIED'],
      [404, { code: 'NOT_FOUND', error: 'The server has no such upload.' }, 'NOT_FOUND'],
      [409, { code: 'CHUNK_CONFLICT', error: 'That chunk was already sent with other bytes.' }, 'INTEGRITY_FAILED'],
      [410, { code: 'VERSION_UNSUPPORTED', error: 'This server runs Dropgate 4.' }, 'NOT_FOUND'],
      [413, { code: 'TOO_LARGE', error: 'Too large.' }, 'FILE_TOO_LARGE'],
      [507, { code: 'SERVER_FULL', error: 'The server is out of space.' }, 'SERVER_FULL'],
    ] as const) {
      const server = fakeServer();
      server.answer(CHUNK, () => server.json(status, body));
      const outcome = await createClient(server.fetchFn).hosted.upload({ files: fileNamed('notes.txt'), lifetimeMs: 60_000, encrypt: false }).result;
      expect(codeOf(outcome), `${status} ${body.code}`).toBe(code);
      expect(server.chunkIndexes, `${status} ${body.code} sent again`).toEqual([0]);
      if (status === 404) expect(outcome.status === 'failed' && outcome.error.message).toBe('The server dropped this upload.');
    }
  });

  it('retries the finish as a chunk, since the server gives the same answer again, and fails at once if it has dropped the upload', async () => {
    const server = fakeServer();
    let failures = 2;
    server.answer(FINISH, async (init) => (failures-- > 0
      ? server.json(502, { error: 'Bad gateway.' })
      : (await server.v4.handle('POST', '/api/v4/upload/complete', init))!));
    const outcome = await createClient(server.fetchFn).hosted.upload({ files: fileNamed('notes.txt'), lifetimeMs: 60_000, encrypt: false, retry: { backoffMs: 1 } }).result;
    expect(outcome.status).toBe('completed');
    expect(server.paths().filter((path) => path === FINISH)).toHaveLength(3);

    const dropped = fakeServer();
    dropped.answer(FINISH, () => dropped.json(404, { code: 'NOT_FOUND', error: 'The server has no such upload.' }));
    const failed = await createClient(dropped.fetchFn).hosted.upload({ files: fileNamed('notes.txt'), lifetimeMs: 60_000, encrypt: false }).result;
    expect(failed.status === 'failed' && failed.error).toMatchObject({ code: 'NOT_FOUND', status: 404, message: 'The server dropped this upload.' });
    expect(dropped.paths().filter((path) => path === FINISH)).toHaveLength(1);
  });

  it("with the server unreachable for 3 minutes, backs off with jitter up to 30 s and completes once it's back; past the server's 5 minutes, it fails, saying the server dropped the upload", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const run = async (downMs: number) => {
        const server = fakeServer();
        let downUntil = 0;
        const failed: number[] = [];
        server.answer(CHUNK, async (init) => {
          const index = server.chunkIndexes.at(-1)!;
          // The network goes as the second chunk is sent.
          if (index === 1 && downUntil === 0) downUntil = Date.now() + downMs;
          if (index === 1 && Date.now() < downUntil) {
            failed.push(Date.now());
            throw new TypeError('fetch failed');
          }
          return (await server.v4.handle('PUT', `/api/v4/upload/chunks/${index}`, init))!;
        });
        const outcome = await settled(createClient(server.fetchFn).hosted.upload({ files: fileNamed('notes.txt', 3), lifetimeMs: 60_000, encrypt: false }).result);
        return { outcome, failed, gaps: failed.slice(1).map((at, i) => at - failed[i]), server };
      };

      const back = await run(3 * 60_000);
      expect(back.outcome.status).toBe('completed');
      expect(back.server.chunkIndexes.filter((i) => i === 2), 'the chunks after it').toHaveLength(1);
      expect(back.gaps.length).toBeGreaterThan(5);
      expect(Math.max(...back.gaps), 'capped at 30 s').toBeLessThanOrEqual(30_000 + 200);
      // Each backoff doubles, from 1 s, and is jittered within its upper half.
      back.gaps.forEach((gap, i) => {
        const full = Math.min(1000 * 2 ** i, 30_000);
        expect(gap, `retry ${i + 1}`).toBeGreaterThanOrEqual(full / 2 - 200);
        expect(gap, `retry ${i + 1}`).toBeLessThanOrEqual(full + 200);
      });
      expect(new Set(back.gaps.slice(5)).size, 'the capped waits differ').toBeGreaterThan(1);

      const gone = await run(6 * 60_000);
      expect(gone.outcome.status === 'failed' && gone.outcome.error).toMatchObject({ code: 'NOT_FOUND', message: expect.stringMatching(/^The server dropped this upload/) });
      const triedFor = gone.failed.at(-1)! - gone.failed[0];
      expect(triedFor, "tried until the server's 5 minutes were up").toBeGreaterThan(5 * 60_000 - 31_000);
      expect(triedFor).toBeLessThanOrEqual(5 * 60_000 + 200);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a download that keeps failing to reconnect stops once the server stops holding its lease, and releases it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const server = fakeServer();
      const tries: number[] = [];
      server.answer(CONTENT, () => { tries.push(Date.now()); throw new TypeError('fetch failed'); });
      const { sink, log } = recordingSink();
      const outcome = await settled(createClient(server.fetchFn).hosted.download({ id: FILE_ID, sink }).result);
      expect(codeOf(outcome)).toBe('SERVER_UNREACHABLE');
      expect(tries.at(-1)! - tries[0]).toBeGreaterThan(5 * 60_000 - 31_000);
      expect(tries.at(-1)! - tries[0]).toBeLessThanOrEqual(5 * 60_000 + 200);
      expect(log).toEqual(['sink abort SERVER_UNREACHABLE']);
      expect(server.paths().filter((path) => path === RELEASE)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('A download cut off part-way, after a while', () => {
  it("still reconnects after receiving for longer than 5 minutes: the server holds its lease 5 minutes from its last bytes", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const server = fakeServer();
      const bytes = varied(CHUNK_SIZE * 2, 6);
      server.v4.store(FILE_ID, { encrypted: false, size: bytes.length, bytes, files: [{ name: 'slow.bin', size: bytes.length }] });
      let answers = 0;
      server.answer(CONTENT, async (init) => {
        if (answers++ > 0) return (await server.v4.handle('GET', `/api/v4/objects/${FILE_ID}/content`, init))!;
        // 4 KiB every 30 s for 7 minutes, then the connection drops.
        let sent = 0;
        return new Response(new ReadableStream({
          async pull(controller) {
            await new Promise((resolve) => setTimeout(resolve, 30_000));
            if (sent === 14) return controller.error(new TypeError('terminated'));
            controller.enqueue(bytes.slice(sent * 4096, (sent + 1) * 4096));
            sent += 1;
          },
        }));
      });
      const { sink, bytes: got } = recordingSink();
      const outcome = await settled(createClient(server.fetchFn).hosted.download({ id: FILE_ID, sink }).result);
      expect(outcome.status).toBe('completed');
      expect(Buffer.from(got()).equals(Buffer.from(bytes))).toBe(true);
      expect(server.headerOf(CONTENT, 'Range')).toEqual([undefined, `bytes=${14 * 4096}-`]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('A download cut off part-way', () => {
  /** The content requests' Range, If-Range and lease, in order. */
  const asked = (server: ReturnType<typeof fakeServer>) => ({
    ranges: server.headerOf(CONTENT, 'Range'),
    ifRanges: server.headerOf(CONTENT, 'If-Range'),
    leases: server.headerOf(CONTENT, 'Dropgate-Lease'),
  });

  it('continues with Range from the next whole chunk, under the same lease and If-Range, and writes every byte once, encrypted or not', async () => {
    const plaintext = varied(CHUNK_SIZE * 3 + 1234, 2);
    const sealed = await sealedObject('report.pdf', plaintext);
    const stored = CHUNK_SIZE + 16;
    for (const [what, object, secret, cuts] of [
      // In the header, in chunk 1, in the next answer's first chunk, and just past the next chunk's start.
      ['encrypted', sealed.stored, sealed.secret, [10, 60 + stored + 500, 30, stored + 5]],
      ['unencrypted', { encrypted: false, size: plaintext.length, bytes: plaintext, files: [{ name: 'report.pdf', size: plaintext.length }] }, undefined, [7, CHUNK_SIZE + 99, 1, CHUNK_SIZE]],
    ] as const) {
      const server = fakeServer();
      server.v4.store(FILE_ID, object);
      cutting(server, [...cuts]);
      const { sink, log, bytes } = recordingSink();
      const outcome = await createClient(server.fetchFn).hosted.download({ id: FILE_ID, secret, sink, retry: { backoffMs: 1 } }).result;
      expect(outcome.status, what).toBe('completed');
      expect(Buffer.from(bytes()).equals(Buffer.from(plaintext)), `${what}: byte for byte`).toBe(true);
      expect(log.filter((entry) => !entry.startsWith('sink write')), what).toEqual(['sink close']);

      const { ranges, ifRanges, leases } = asked(server);
      expect(ranges, what).toHaveLength(cuts.length + 1);
      expect(server.paths().filter((path) => path === LEASE), `${what}: one lease`).toHaveLength(1);
      expect(new Set(leases).size, `${what}: the same lease every time`).toBe(1);
      expect(server.paths().filter((path) => path === RELEASE), `${what}: released once`).toHaveLength(1);
      // Asked from where it got to: the start until something was written, then the rest, as the same upload.
      const starts = ranges.map((range) => (range === undefined ? 0 : Number(/^bytes=(\d+)-$/.exec(range)![1])));
      if (what === 'encrypted') {
        expect(starts).toEqual([0, 0, 60 + stored, 60 + stored, 60 + stored * 2]);
      } else {
        expect(starts).toEqual([0, 7, 7 + CHUNK_SIZE + 99, 7 + CHUNK_SIZE + 100, 7 + CHUNK_SIZE * 2 + 100]);
      }
      ranges.forEach((range, i) => expect(ifRanges[i], `${what}: If-Range with Range ${i}`).toBe(range === undefined ? undefined : `"${FILE_ID}"`));
    }
  });

  it('continues a ZIP of several files, and one file of several, the same way', async () => {
    const files = [{ name: 'a.bin', bytes: varied(CHUNK_SIZE + 300, 3) }, { name: 'b.bin', bytes: varied(CHUNK_SIZE * 2 + 7, 4) }];
    const sealed = await sealedFiles(files);
    const stored = CHUNK_SIZE + 16;
    for (const [what, run, ranges] of [
      ['a ZIP', async (client: DropgateClient) => {
        const archive = recordingSink();
        const outcome = await client.hosted.download({ id: FILE_ID, secret: sealed.secret, asZip: true, sink: archive.sink, retry: { backoffMs: 1 } }).result;
        expect(outcome.status, 'a ZIP').toBe('completed');
        const zip = readZip([{ bytes: archive.bytes() }]);
        expect(zip.entries.map((e) => e.name)).toEqual(['a.bin', 'b.bin']);
        zip.entries.forEach((entry, i) => expect(Buffer.from(zip.bytesOf(entry)).equals(Buffer.from(files[i].bytes)), entry.name).toBe(true));
      }, [undefined, `bytes=${60 + stored}-`, `bytes=${60 + stored * 2}-`]],
      ['the second file', async (client: DropgateClient) => {
        const one = recordingSink();
        const outcome = await client.hosted.download({ id: FILE_ID, secret: sealed.secret, files: [1], sink: () => one.sink, retry: { backoffMs: 1 } }).result;
        expect(outcome.status, 'the second file').toBe('completed');
        expect(Buffer.from(one.bytes()).equals(Buffer.from(files[1].bytes))).toBe(true);
        // Its chunks alone, from the one it starts in; the cut is continued from the next whole chunk after it.
      }, [`bytes=${60 + stored}-`, `bytes=${60 + stored * 2}-`]],
    ] as const) {
      const server = fakeServer();
      server.v4.store(FILE_ID, sealed.stored);
      cutting(server, [60 + stored + 1, stored * 2 - 3]);
      await run(createClient(server.fetchFn));
      expect(server.headerOf(CONTENT, 'Range'), what).toEqual(ranges);
      expect(server.paths().filter((path) => path === LEASE), `${what}: one lease`).toHaveLength(1);
    }
  });

  it('refuses to append a whole upload sent in answer to a Range (its If-Range no longer matched): INTEGRITY_FAILED, and none of it is written', async () => {
    const plaintext = varied(CHUNK_SIZE * 2 + 50, 5);
    const sealed = await sealedObject('report.pdf', plaintext);
    for (const encrypted of [true, false]) {
      const server = fakeServer();
      server.v4.store(FILE_ID, encrypted ? sealed.stored : { encrypted: false, size: plaintext.length, bytes: plaintext, files: [{ name: 'report.pdf', size: plaintext.length }] });
      let answers = 0;
      server.answer(CONTENT, async (init) => {
        // The first is cut off in its second chunk; the second ignores the Range, as a changed upload's answer would.
        const whole = (await server.v4.handle('GET', `/api/v4/objects/${FILE_ID}/content`, { ...init, headers: { 'Dropgate-Lease': new Headers(init.headers).get('Dropgate-Lease')! } }))!;
        return answers++ === 0 ? new Response(cutAfter(whole.body!, 60 + CHUNK_SIZE + 16 + 10), { headers: whole.headers }) : whole;
      });
      const { sink, log, bytes } = recordingSink();
      const outcome = await createClient(server.fetchFn).hosted.download({ id: FILE_ID, secret: encrypted ? sealed.secret : undefined, sink, retry: { backoffMs: 1 } }).result;
      expect(outcome.status === 'failed' && outcome.error.code, `encrypted: ${encrypted}`).toBe('INTEGRITY_FAILED');
      // Only what came before the cut: a whole chunk encrypted, every byte unencrypted.
      const before = encrypted ? CHUNK_SIZE : 60 + CHUNK_SIZE + 16 + 10;
      expect(Buffer.from(bytes()).equals(Buffer.from(plaintext.subarray(0, before))), `encrypted: ${encrypted}`).toBe(true);
      expect(log.at(-1)).toBe('sink abort INTEGRITY_FAILED');
      expect(log).not.toContain('sink close');
      expect(server.headerOf(CONTENT, 'If-Range')).toEqual([undefined, `"${FILE_ID}"`]);
      expect(server.paths().filter((path) => path === RELEASE)).toHaveLength(1);
    }

    // A 206 for any other range than the rest is refused too.
    const server = fakeServer();
    server.v4.store(FILE_ID, sealed.stored);
    let answers = 0;
    server.answer(CONTENT, async (init) => {
      const res = (await server.v4.handle('GET', `/api/v4/objects/${FILE_ID}/content`, init))!;
      if (answers++ === 0) return new Response(cutAfter(res.body!, 60 + CHUNK_SIZE + 16 + 10), { headers: res.headers });
      return new Response(res.body, { status: 206, headers: { 'Content-Range': `bytes 60-${sealed.stored.size - 1}/${sealed.stored.size}` } });
    });
    const { sink } = recordingSink();
    expect(codeOf(await createClient(server.fetchFn).hosted.download({ id: FILE_ID, secret: sealed.secret, sink, retry: { backoffMs: 1 } }).result)).toBe('INVALID_RESPONSE');
  });
});

describe('client.hosted.delete()', () => {
  const DELETE = `DELETE /api/v4/objects/${FILE_ID}`;

  it('deletes an upload with its manage token, sent only in Dropgate-Manage-Token with no credential; its details and its bytes are then gone', async () => {
    const server = fakeServer();
    let asked = 0;
    const client = new DropgateClient({ server: BASE_URL, fetchFn: server.fetchFn, auth: () => { asked++; return { token: 'account-token' }; } });
    const outcome = await client.hosted.upload({ files: fileNamed('notes.txt'), lifetimeMs: 60_000, encrypt: true }).result;
    if (outcome.status !== 'completed') throw new Error('The upload failed.');
    const { id, manageToken, downloadUrl } = outcome.value;
    const secret = new URL(downloadUrl).hash.slice(1);

    await expect(client.hosted.delete({ id, manageToken: manageToken! })).resolves.toBeUndefined();
    const sent = server.requests.filter((r) => `${r.method} ${new URL(r.url).pathname}` === DELETE);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(`${BASE_URL}/api/v4/objects/${id}`);
    expect(JSON.parse(sent[0].headers)).toEqual({ Accept: 'application/json', 'Dropgate-Manage-Token': manageToken });
    expect(sent[0].body).toBe('');
    expect(asked, 'the credential was asked for').toBe(0);
    // Nowhere else: not in a URL, and in no other request.
    const elsewhere = server.requests.filter((r) => r !== sent[0] && [r.url, r.headers, r.body].some((part) => part.includes(manageToken!)));
    expect(elsewhere).toEqual([]);

    await expect(client.hosted.metadata({ id, secret })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(codeOf(await client.hosted.download({ id, secret, sink: nullSink() }).result)).toBe('NOT_FOUND');
  });

  it("a token that isn't the upload's is REQUEST_REJECTED (403) and deletes nothing; an upload that isn't there is NOT_FOUND; neither error holds the token", async () => {
    const server = fakeServer();
    server.v4.store(FILE_ID, { encrypted: false, size: 4, bytes: new Uint8Array(4), files: [{ name: 'a.txt', size: 4 }], manageTokenHash: MANAGE_TOKEN_HASH });
    const client = createClient(server.fetchFn);
    const wrong = Buffer.alloc(32, 9).toString('base64url');

    const denied = await client.hosted.delete({ id: FILE_ID, manageToken: wrong }).catch((err: unknown) => err as DropgateError);
    expect(denied).toMatchObject({ code: 'REQUEST_REJECTED', status: 403, transport });
    expect((await client.hosted.metadata({ id: FILE_ID })).files, 'still there').toEqual([{ name: 'a.txt', size: 4 }]);

    const missing = await client.hosted.delete({ id: SECOND_FILE_ID, manageToken: MANAGE_TOKEN }).catch((err: unknown) => err as DropgateError);
    expect(missing).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    for (const err of [denied, missing]) {
      const shown = [JSON.stringify(err), (err as Error).message, String((err as Error).stack)].join('\n');
      expect(shown.includes(wrong) || shown.includes(MANAGE_TOKEN), shown).toBe(false);
    }

    await client.hosted.delete({ id: FILE_ID, manageToken: MANAGE_TOKEN });
    await expect(client.hosted.metadata({ id: FILE_ID })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('needs an id and a token that could be one, and asks nothing without them', async () => {
    const server = fakeServer();
    const client = createClient(server.fetchFn);
    for (const opts of [{}, { id: FILE_ID }, { manageToken: MANAGE_TOKEN }, { id: FILE_ID, manageToken: 'not-a-token' }, { id: FILE_ID, manageToken: `${MANAGE_TOKEN}A` }]) {
      const err = await client.hosted.delete(opts as never).catch((e: unknown) => e as DropgateError);
      expect(err, JSON.stringify(opts)).toMatchObject({ code: 'INVALID_ARGUMENT' });
      expect((err as Error).message.includes('not-a-token')).toBe(false);
    }
    // An ID no server makes is never put in a path.
    await expect(client.hosted.delete({ id: '../uploads', manageToken: MANAGE_TOKEN })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(server.requests).toEqual([]);
  });
});

describe('client.hosted.open()', () => {
  /** An upload of three files, stored as FILE_ID. */
  async function threeFiles(server: ReturnType<typeof fakeServer>, encrypted: boolean) {
    const contents = [varied(10, 1), varied(CHUNK_SIZE + 3, 2), varied(20, 3)];
    const files = contents.map((bytes, i) => ({ name: `${'abc'[i]}.txt`, bytes }));
    if (encrypted) {
      const sealed = await sealedFiles(files);
      server.v4.store(FILE_ID, sealed.stored);
      return { contents, secret: sealed.secret };
    }
    const bytes = new Uint8Array(Buffer.concat(contents));
    server.v4.store(FILE_ID, { encrypted: false, size: bytes.length, bytes, files: files.map((f) => ({ name: f.name, size: f.bytes.length })) });
    return { contents, secret: undefined };
  }

  it('reads the metadata with no lease; every download after shares one lease, taken at the first, and close() releases it, counting once', async () => {
    for (const encrypted of [false, true]) {
      const server = fakeServer();
      const { contents, secret } = await threeFiles(server, encrypted);
      const client = createClient(server.fetchFn);

      const opened = await client.hosted.open({ id: FILE_ID, secret });
      expect(opened.metadata).toEqual({
        kind: 'bundle', id: FILE_ID, encrypted, files: contents.map((bytes, i) => ({ name: `${'abc'[i]}.txt`, size: bytes.length })),
        totalSize: CHUNK_SIZE + 33, transport,
      });
      expect(server.paths().filter((path) => path === LEASE), 'opening takes no lease').toEqual([]);

      // Each file on its own, then all of them as a ZIP.
      for (let index = 0; index < 3; index++) {
        const one = recordingSink();
        expect(codeOf(await opened.download({ files: [index], sink: one.sink }).result)).toBe('completed');
        expect(Buffer.from(one.bytes()).equals(Buffer.from(contents[index])), `file ${index}`).toBe(true);
      }
      const archive = recordingSink();
      expect(codeOf(await opened.download({ asZip: true, sink: archive.sink }).result)).toBe('completed');
      expect(readZip([{ bytes: archive.bytes() }]).entries.map((entry) => entry.name)).toEqual(['a.txt', 'b.txt', 'c.txt']);

      const lease = server.headerOf(CONTENT, 'Dropgate-Lease');
      expect(server.paths().filter((path) => path === LEASE), 'one lease for them all').toHaveLength(1);
      expect(new Set(lease).size, 'every request under it').toBe(1);
      expect(server.paths(), 'nothing released while it is open').not.toContain(RELEASE);
      expect(server.v4.objects.get(FILE_ID)?.downloadCount ?? 0, 'nothing counted while it is open').toBe(0);

      await opened.close();
      expect(server.paths().filter((path) => path === RELEASE)).toHaveLength(1);
      expect(server.headerOf(RELEASE, 'Dropgate-Lease')).toEqual([lease[0]]);
      expect(server.v4.objects.get(FILE_ID)?.downloadCount, 'one download').toBe(1);
      // Closing again does nothing more.
      await opened.close();
      expect(server.paths().filter((path) => path === RELEASE)).toHaveLength(1);
      // Printed, logged or serialised, it shows nothing of the secret or the lease.
      expect(JSON.stringify(opened)).toBe('"[DropgateOpenedUpload]"');
      expect(String(opened)).toBe('[DropgateOpenedUpload]');
    }
  });

  it('opened and closed with no download takes no lease and counts nothing', async () => {
    const server = fakeServer();
    await threeFiles(server, false);
    const opened = await createClient(server.fetchFn).hosted.open({ id: FILE_ID });
    await opened.close();
    expect(server.paths()).toEqual(['GET /api/info', META]);
    expect(server.v4.objects.get(FILE_ID)?.downloadCount ?? 0).toBe(0);
  });

  it('keeps its lease while open, renewing it every 2 minutes: 30 minutes on, it is still held, and still one download', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const server = fakeServer();
      const { contents } = await threeFiles(server, false);
      const opened = await createClient(server.fetchFn).hosted.open({ id: FILE_ID });
      expect(codeOf(await opened.download({ files: [0], sink: recordingSink().sink }).result)).toBe('completed');
      const [lease] = server.headerOf(CONTENT, 'Dropgate-Lease');

      for (let minute = 0; minute < 30; minute += 2) await vi.advanceTimersByTimeAsync(2 * 60_000);
      await expect.poll(() => server.v4.renewals.length).toBe(15);
      expect(new Set(server.v4.renewals)).toEqual(new Set([lease]));

      const last = recordingSink();
      expect(codeOf(await opened.download({ files: [2], sink: last.sink }).result)).toBe('completed');
      expect(Buffer.from(last.bytes()).equals(Buffer.from(contents[2]))).toBe(true);
      expect(server.paths().filter((path) => path === LEASE), 'the same lease, 30 minutes on').toHaveLength(1);

      await opened.close();
      // Closed, it renews nothing more.
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(server.v4.renewals).toHaveLength(15);
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes a new lease for its next download once the server says its lease has gone', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const server = fakeServer();
      await threeFiles(server, false);
      const opened = await createClient(server.fetchFn).hosted.open({ id: FILE_ID });
      expect(codeOf(await opened.download({ files: [0], sink: recordingSink().sink }).result)).toBe('completed');
      // The server forgets it, as it would one that ran out while nothing could renew it.
      server.v4.leases.clear();
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      await expect.poll(() => server.paths().filter((path) => path === RENEW)).toHaveLength(1);
      // Its answer, a 404, comes on a later turn, as the fake server's answers do.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(codeOf(await opened.download({ files: [1], sink: recordingSink().sink }).result)).toBe('completed');
      expect(server.paths().filter((path) => path === LEASE)).toHaveLength(2);
      await opened.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('downloads started together share the one lease', async () => {
    const server = fakeServer();
    const { secret } = await threeFiles(server, true);
    const opened = await createClient(server.fetchFn).hosted.open({ id: FILE_ID, secret });
    const outcomes = await Promise.all([0, 1, 2].map((index) => opened.download({ files: [index], sink: recordingSink().sink }).result));
    expect(outcomes.map(codeOf)).toEqual(['completed', 'completed', 'completed']);
    expect(server.paths().filter((path) => path === LEASE)).toHaveLength(1);
    await opened.close();
  });

  it('close() cancels its downloads still running, then releases the lease; after it, a download is refused', async () => {
    const server = fakeServer();
    await threeFiles(server, false);
    server.answer(CONTENT, endlessBody);
    const opened = await createClient(server.fetchFn).hosted.open({ id: FILE_ID });
    const sink = recordingSink();
    const running = opened.download({ asZip: true, sink: sink.sink });
    await expect.poll(() => server.paths()).toContain(CONTENT);

    await opened.close();
    expect(await running.result).toEqual({ status: 'cancelled', cancellation: { by: 'self', source: 'hosted.download' }, transport });
    expect(sink.log.at(-1)).toBe('sink abort OPERATION_CANCELLED');
    expect(server.paths().at(-1)).toBe(RELEASE);
    // Kept alive, so it's sent even as a page closes.
    expect(server.requests.at(-1)!.keepalive).toBe(true);
    expect(() => opened.download({ sink: nullSink() })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT', transport }));
  });

  it('needs the secret of an encrypted upload, as metadata() does, and asks for nothing more without it', async () => {
    const server = fakeServer();
    await threeFiles(server, true);
    await expect(createClient(server.fetchFn).hosted.open({ id: FILE_ID })).rejects.toMatchObject({ code: 'KEY_REQUIRED' });
    await expect(createClient(server.fetchFn).hosted.open({ id: FILE_ID, secret: LINK_SECRET })).rejects.toMatchObject({ code: 'DECRYPT_FAILED' });
    expect(server.paths().filter((path) => path !== 'GET /api/info' && path !== META)).toEqual([]);
  });
});

/**
 * Holds chunk `index`'s first try in flight, never answered until it's
 * aborted; with `taken`, the server has it first and only its answer is lost.
 * Settles as that try reaches the server.
 */
function holdingChunk(server: ReturnType<typeof fakeServer>, index: number, { taken = false }: { taken?: boolean } = {}) {
  const arrived = gate();
  let held = false;
  server.answer(CHUNK, async (init) => {
    const i = server.chunkIndexes.at(-1)!;
    if (i === index && !held) {
      held = true;
      if (taken) await server.v4.handle('PUT', `/api/v4/upload/chunks/${i}`, init);
      arrived.open();
      return noAnswer(init);
    }
    return (await server.v4.handle('PUT', `/api/v4/upload/chunks/${i}`, init))!;
  });
  return arrived.promise;
}

/** A FileSource of `bytes` that writes down each range read, as `file:start-end`. */
function readingSource(bytes: Uint8Array, name: string, file: number, reads: string[]): FileSource {
  return {
    name,
    size: bytes.length,
    read: async (start, end) => {
      reads.push(`${file}:${start}-${end}`);
      return bytes.slice(start, end);
    },
  };
}

/** Downloads FILE_ID from the fake server, every file to its own sink, and gives each file's bytes. */
async function downloadedFiles(server: ReturnType<typeof fakeServer>, secret?: string): Promise<Uint8Array[]> {
  const got: Array<ReturnType<typeof recordingSink>> = [];
  const sink = (info: { index: number }) => {
    got[info.index] = recordingSink();
    return got[info.index].sink;
  };
  const outcome = await createClient(server.fetchFn).hosted.download({ id: FILE_ID, secret, sink }).result;
  expect(outcome.status).toBe('completed');
  return got.map((one) => one.bytes());
}

const secretOf = (outcome: Outcome<{ downloadUrl: string }>) =>
  (outcome.status === 'completed' ? new URL(outcome.value.downloadUrl).hash.slice(1) || undefined : undefined);

const PAUSE = 'POST /api/v4/upload/pause';
const RESUME = 'POST /api/v4/upload/resume';
const LEASE_PAUSE = 'POST /api/v4/lease/pause';

describe('Pausing and resuming an upload', () => {
  it('pauses once the server holds it, sends nothing while paused, and resumes with the chunks the server lacks: the upload is stored byte for byte', async () => {
    for (const encrypt of [false, true]) {
      for (const several of [false, true]) {
        for (const taken of [false, true]) {
          const what = `encrypt: ${encrypt}, several: ${several}, the chunk in flight ${taken ? 'taken' : 'lost'}`;
          const server = fakeServer();
          const contents = several ? [varied(CHUNK_SIZE + 100, 1), varied(CHUNK_SIZE * 2, 2)] : [varied(CHUNK_SIZE * 3 + 7, 3)];
          const reads: string[] = [];
          const files = contents.map((bytes, f) => readingSource(bytes, `file ${f}.bin`, f, reads));
          const arrived = holdingChunk(server, 1, { taken });
          const upload = createClient(server.fetchFn).hosted.upload({ files: several ? files : files[0], lifetimeMs: 60_000, encrypt });
          const seen: UploadSnapshot[] = [];
          upload.subscribe((snapshot) => seen.push(snapshot));

          await arrived;
          expect(upload.snapshot.canPause, what).toBe(true);
          const pausing = upload.pause();
          // Settling, it can't be paused again.
          expect(upload.snapshot, what).toMatchObject({ status: 'uploading', canPause: false, text: 'Pausing...' });
          const asked = Date.now();
          await pausing;
          expect(upload.snapshot, what).toMatchObject({ status: 'paused', pausedBy: 'self', canPause: true, text: 'Paused.' });
          // The server's deadline: its pause length (60 minutes here) from the pause.
          expect(upload.snapshot.deadline! - asked, what).toBeGreaterThanOrEqual(60 * 60_000);
          expect(upload.snapshot.deadline! - Date.now(), what).toBeLessThanOrEqual(60 * 60_000);
          expect(server.paths().at(-1), what).toBe(PAUSE);
          expect(server.headerOf(PAUSE, 'Dropgate-Upload')).toEqual(server.headerOf(CHUNK.replace(':index', '0'), 'Dropgate-Upload'));

          // Nothing more is sent, or read, while it's paused.
          const sentAtPause = server.requests.length;
          const readAtPause = reads.length;
          await new Promise((resolve) => setTimeout(resolve, 50));
          expect(server.requests.length, `${what}: nothing sent while paused`).toBe(sentAtPause);
          expect(reads.length, `${what}: nothing read while paused`).toBe(readAtPause);

          await upload.resume();
          expect(upload.snapshot, what).toMatchObject({ status: 'uploading', pausedBy: null, deadline: null, canPause: true });
          const outcome = await upload.result;
          expect(outcome.status, what).toBe('completed');

          // After the pause: the resume, which says which chunks the server holds, then only the rest, then the finish.
          const after = server.paths().slice(sentAtPause);
          expect(after[0], what).toBe(RESUME);
          expect(after.at(-1), what).toBe(FINISH);
          const count = Math.max(...server.chunkIndexes) + 1;
          expect(server.chunkIndexes, what).toEqual([0, 1, ...(taken ? [] : [1]), ...Array.from({ length: count - 2 }, (_, i) => i + 2)]);
          if (!taken) {
            // The chunk stopped by the pause goes again exactly as it was: never read or sealed again.
            expect(Buffer.from(server.chunkBodies[2]).equals(Buffer.from(server.chunkBodies[1])), what).toBe(true);
            const digests = server.headerOf('PUT /api/v4/upload/chunks/1', 'Content-Digest');
            expect(digests, what).toEqual([digests[0], digests[0]]);
          }
          expect(new Set(reads).size, `${what}: each part read once`).toBe(reads.length);

          // The snapshots: running, settling, paused, settling, running; never paused without its deadline.
          expect(seen.filter((s) => s.status === 'paused').every((s) => s.deadline !== null && s.pausedBy === 'self'), what).toBe(true);
          expect(seen.filter((s) => s.text === 'Pausing...' || s.text === 'Resuming...').every((s) => !s.canPause), what).toBe(true);
          expect(seen.filter((s) => s.status === 'completing').every((s) => !s.canPause), `${what}: never while finishing`).toBe(true);
          expect(upload.snapshot, what).toMatchObject({ status: 'completed', canPause: false, pausedBy: null, deadline: null });

          const got = await downloadedFiles(server, secretOf(outcome));
          got.forEach((bytes, f) => expect(Buffer.from(bytes).equals(Buffer.from(contents[f])), `${what}: file ${f}`).toBe(true));
        }
      }
    }
  });

  it("still paused at the server's deadline, it fails NOT_FOUND, the server having dropped it: nothing resumes by itself, and pausing again first renews the deadline", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const server = fakeServer({ maxPauseMinutes: 20 });
      const arrived = holdingChunk(server, 1);
      const upload = createClient(server.fetchFn).hosted.upload({ files: fileNamed('notes.txt', 3), lifetimeMs: 60_000, encrypt: true });
      await settled(arrived);
      await settled(upload.pause());
      // The server's deadline, which the snapshot gives. Fake time can pass while core's crypto runs, so it's
      // measured from the server's answer, never from the test's own clock.
      const held = [...server.v4.uploads.values()][0];
      const first = upload.snapshot.deadline!;
      expect(first - held.deadline).toBeGreaterThanOrEqual(0);
      expect(first - held.deadline).toBeLessThan(1000);

      await vi.advanceTimersByTimeAsync(15 * 60_000);
      expect(upload.snapshot.status).toBe('paused');
      await settled(upload.pause());
      const renewed = upload.snapshot.deadline!;
      expect(held.deadline - first, 'pausing again renews it from then').toBeGreaterThanOrEqual(15 * 60_000 - 1000);
      expect(renewed - held.deadline).toBeGreaterThanOrEqual(0);
      expect(renewed - held.deadline).toBeLessThan(1000);
      expect(server.v4.pauses).toEqual(['upload', 'upload']);

      const sent = server.requests.length;
      await vi.advanceTimersByTimeAsync(20 * 60_000 - 1000);
      expect(upload.snapshot.status, 'not before its deadline').toBe('paused');
      const outcome = await settled(upload.result);
      expect(outcome.status === 'failed' && outcome.error).toMatchObject({ code: 'NOT_FOUND', message: 'The server dropped this paused upload.' });
      expect(Date.now()).toBeGreaterThanOrEqual(renewed);
      expect(server.requests.length, 'nothing resumed by itself').toBe(sent);
      expect(upload.snapshot).toMatchObject({ status: 'failed', text: 'The server dropped this paused upload.', canPause: false, deadline: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it("on a server whose clock is behind this device's, a pause still lasts the server's whole pause length here", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const server = fakeServer({ maxPauseMinutes: 20 });
      // The server's deadline, as its clock 10 minutes behind gives it.
      let answeredAt = 0;
      server.answer(PAUSE, async (init) => {
        await server.v4.handle('POST', '/api/v4/upload/pause', init);
        answeredAt = Date.now();
        return server.json(200, { paused: true, deadline: Date.now() - 10 * 60_000 + 20 * 60_000 });
      });
      const arrived = holdingChunk(server, 1);
      const upload = createClient(server.fetchFn).hosted.upload({ files: fileNamed('notes.txt', 3), lifetimeMs: 60_000, encrypt: false });
      await settled(arrived);
      await settled(upload.pause());
      // Its own pause length from the server's answer, not the server's earlier deadline.
      expect(upload.snapshot.deadline! - (answeredAt + 20 * 60_000)).toBeGreaterThanOrEqual(0);
      expect(upload.snapshot.deadline! - (answeredAt + 20 * 60_000)).toBeLessThan(1000);
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      expect(upload.snapshot.status, "past the server's own deadline as this device reads it").toBe('paused');
      await settled(upload.resume());
      expect((await settled(upload.result)).status).toBe('completed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('resumed once the server has dropped it (a restart drops every upload), it fails NOT_FOUND, saying the server dropped the paused upload', async () => {
    const server = fakeServer();
    const arrived = holdingChunk(server, 1);
    const upload = createClient(server.fetchFn).hosted.upload({ files: fileNamed('notes.txt', 3), lifetimeMs: 60_000, encrypt: false });
    await arrived;
    await upload.pause();
    server.v4.uploads.clear();

    const resuming = upload.resume();
    await expect(resuming).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'The server dropped this paused upload.', transport });
    const outcome = await upload.result;
    expect(outcome.status === 'failed' && outcome.error).toMatchObject({ code: 'NOT_FOUND', message: 'The server dropped this paused upload.' });
    expect(server.paths().at(-1)).toBe(RESUME);
  });

  it('cancel() while paused ends it cancelled, and the server is told to discard it', async () => {
    const server = fakeServer();
    const arrived = holdingChunk(server, 1);
    const upload = createClient(server.fetchFn).hosted.upload({ files: fileNamed('notes.txt', 3), lifetimeMs: 60_000, encrypt: true });
    await arrived;
    await upload.pause();
    upload.cancel();
    const outcome = await upload.result;
    expect(outcome.status === 'cancelled' && outcome.cancellation.by).toBe('self');
    await expect.poll(() => server.v4.uploads.size).toBe(0);
    expect(server.paths().at(-1)).toBe(CANCEL);
    expect(upload.snapshot).toMatchObject({ status: 'cancelled', canPause: false, pausedBy: null, deadline: null });
    await expect(upload.resume()).rejects.toMatchObject({ code: 'PAUSE_UNAVAILABLE' });
  });

  it("can't pause before the server has taken it, once it's finishing or has ended, or on a server with pausing off; a pause the server refuses changes nothing", async () => {
    // Before the server has answered, and after the upload has ended.
    const server = fakeServer();
    const upload = createClient(server.fetchFn).hosted.upload({ files: fileNamed('notes.txt', 2), lifetimeMs: 60_000, encrypt: false });
    expect(upload.snapshot.canPause).toBe(false);
    await expect(upload.pause()).rejects.toMatchObject({ code: 'PAUSE_UNAVAILABLE', transport });
    await expect(upload.resume()).rejects.toMatchObject({ code: 'PAUSE_UNAVAILABLE', message: "It isn't paused." });
    expect((await upload.result).status).toBe('completed');
    await expect(upload.pause()).rejects.toMatchObject({ code: 'PAUSE_UNAVAILABLE', message: "It has ended, so it can't be paused." });
    expect(server.paths()).not.toContain(PAUSE);

    // A server with pausing off: never pausable, and a pause is refused before anything is asked.
    const off = fakeServer({ maxPauseMinutes: 0 });
    const arrived = holdingChunk(off, 1);
    const unpausable = createClient(off.fetchFn).hosted.upload({ files: fileNamed('notes.txt', 3), lifetimeMs: 60_000, encrypt: true });
    const seen: UploadSnapshot[] = [];
    unpausable.subscribe((snapshot) => seen.push(snapshot));
    await arrived;
    await expect(unpausable.pause()).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED', message: 'Pausing is turned off on this server.' });
    expect(seen.every((snapshot) => !snapshot.canPause)).toBe(true);
    expect(off.paths()).not.toContain(PAUSE);
    unpausable.cancel();
    expect((await unpausable.result).status).toBe('cancelled');

    // A server that refuses a pause: nothing changes, and the chunk it stopped goes again, the same bytes.
    const refusing = fakeServer();
    refusing.answer(PAUSE, () => refusing.json(409, { code: 'PAUSE_DISABLED', error: 'Pausing is turned off on this server.' }));
    const stopped = holdingChunk(refusing, 1);
    const going = createClient(refusing.fetchFn).hosted.upload({ files: fileNamed('notes.txt', 3), lifetimeMs: 60_000, encrypt: true });
    await stopped;
    await expect(going.pause()).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED', status: 409 });
    expect(going.snapshot).toMatchObject({ status: 'uploading', pausedBy: null, deadline: null });
    expect((await going.result).status).toBe('completed');
    expect(refusing.chunkIndexes).toEqual([0, 1, 1, 2]);
    expect(Buffer.from(refusing.chunkBodies[2]).equals(Buffer.from(refusing.chunkBodies[1]))).toBe(true);
  });

  it('a chunk in flight at a pause goes again byte for byte after it, never read or sealed again; a file that changed during the pause fails the upload SOURCE_UNAVAILABLE', async () => {
    // As a browser's File does once its file changes on disk: it can't be read any more.
    const server = fakeServer();
    const bytes = varied(CHUNK_SIZE * 3, 4);
    const reads: string[] = [];
    let changed = false;
    const file: FileSource = {
      name: 'Changing report.pdf',
      size: bytes.length,
      read: async (start, end) => {
        reads.push(`${start}-${end}`);
        if (changed) throw new DOMException('The requested file could not be read.', 'NotReadableError');
        return bytes.slice(start, end);
      },
    };
    const arrived = holdingChunk(server, 1);
    const upload = createClient(server.fetchFn).hosted.upload({ files: file, lifetimeMs: 60_000, encrypt: true });
    await arrived;
    await upload.pause();
    changed = true;
    await upload.resume();
    const outcome = await upload.result;
    expect(outcome.status === 'failed' && outcome.error.code).toBe('SOURCE_UNAVAILABLE');
    expect(JSON.stringify(outcome)).not.toContain('Changing report');
    // Chunk 1 went again as it was sealed; chunk 2 was the first read after the pause, and it failed.
    expect(server.chunkIndexes).toEqual([0, 1, 1]);
    expect(Buffer.from(server.chunkBodies[2]).equals(Buffer.from(server.chunkBodies[1]))).toBe(true);
    expect(reads).toEqual([`0-${CHUNK_SIZE}`, `${CHUNK_SIZE}-${CHUNK_SIZE * 2}`, `${CHUNK_SIZE * 2}-${CHUNK_SIZE * 3}`]);

    // A file on disk, through sources.fileHandle(), rewritten during the pause with the same size.
    const dir = await mkdtemp(join(tmpdir(), 'dropgate-core-'));
    const path = join(dir, 'on-disk.bin');
    await writeFile(path, bytes);
    const handle = await open(path, 'r');
    try {
      const source = await sources.fileHandle(handle, { name: 'on-disk.bin' });
      const disk = fakeServer();
      const held = holdingChunk(disk, 1);
      const fromDisk = createClient(disk.fetchFn).hosted.upload({ files: source, lifetimeMs: 60_000, encrypt: true });
      await held;
      await fromDisk.pause();
      const before = await stat(path);
      await writeFile(path, varied(bytes.length, 5));
      // A file system whose times are coarse may not move them: this edit is a later one.
      if ((await stat(path)).mtimeMs === before.mtimeMs) await utimes(path, new Date(), new Date(before.mtimeMs + 2000));
      await fromDisk.resume();
      const failed = await fromDisk.result;
      expect(failed.status === 'failed' && failed.error).toMatchObject({
        code: 'SOURCE_UNAVAILABLE', message: "A file changed after the upload started, so the rest of it can't be read as it was.",
      });
      expect(disk.chunkIndexes).toEqual([0, 1, 1]);
      expect(Buffer.from(disk.chunkBodies[2]).equals(Buffer.from(disk.chunkBodies[1]))).toBe(true);
    } finally {
      await handle.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('while reconnecting, the snapshot gives when the server stops waiting for the upload, and none once it answers again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const server = fakeServer();
      let downUntil = 0;
      let answeredAt = 0;
      server.answer(CHUNK, async (init) => {
        const index = server.chunkIndexes.at(-1)!;
        if (index === 1 && downUntil === 0) downUntil = Date.now() + 60_000;
        if (Date.now() < downUntil) throw new TypeError('fetch failed');
        if (downUntil === 0) answeredAt = Date.now();
        return (await server.v4.handle('PUT', `/api/v4/upload/chunks/${index}`, init))!;
      });
      const upload = createClient(server.fetchFn).hosted.upload({ files: fileNamed('notes.txt', 3), lifetimeMs: 60_000, encrypt: false });
      const seen: UploadSnapshot[] = [];
      upload.subscribe((snapshot) => seen.push(snapshot));
      expect((await settled(upload.result)).status).toBe('completed');

      const waiting = seen.filter((s) => s.phase === 'retry-wait');
      expect(waiting.length).toBeGreaterThan(3);
      // The server's 5 minutes from chunk 0's answer, the last before the outage, the same in every wait.
      expect(new Set(waiting.map((s) => s.deadline)).size).toBe(1);
      expect(waiting.every((s) => s.status === 'uploading')).toBe(true);
      expect(waiting[0].deadline! - answeredAt - 5 * 60_000).toBeGreaterThanOrEqual(0);
      expect(waiting[0].deadline! - answeredAt - 5 * 60_000).toBeLessThan(1000);
      const afterIt = seen.slice(seen.indexOf(waiting.at(-1)!) + 1);
      expect(afterIt.find((s) => s.phase === 'chunk')?.deadline, 'none once it answers').toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * A response body that gives the first `bytes` of `body`, then nothing more
 * until it's cancelled, like a download whose connection has gone quiet.
 */
function stallAfter(body: ReadableStream<Uint8Array>, bytes: number, cancelled: () => void): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let left = bytes;
  return new ReadableStream({
    async pull(controller) {
      if (left <= 0) return new Promise<void>(() => { });
      const { done, value } = await reader.read();
      if (done) return controller.close();
      const part = value.subarray(0, left);
      left -= part.byteLength;
      controller.enqueue(part);
      return undefined;
    },
    cancel() {
      cancelled();
      reader.cancel().catch(() => { });
    },
  });
}

/** Answers the first content request with its first `bytes`, then holds it open until it's closed, which `closed` counts. */
function stallingFirst(server: ReturnType<typeof fakeServer>, bytes: number) {
  const state = { closed: 0 };
  let first = true;
  server.answer(CONTENT, async (init) => {
    const res = (await server.v4.handle('GET', `/api/v4/objects/${FILE_ID}/content`, init))!;
    if (!first || !res.body) return res;
    first = false;
    return new Response(stallAfter(res.body, bytes, () => { state.closed++; }), { status: res.status, headers: res.headers });
  });
  return state;
}

describe('Pausing and resuming a download', () => {
  it('closes its request and holds its sink, with no write, close or abort, for longer than its timeoutMs; resumes with Range from the next whole chunk, under the same lease, byte for byte, counted once', async () => {
    const plaintext = varied(CHUNK_SIZE * 3 + 999, 7);
    const sealed = await sealedObject('report.pdf', plaintext);
    const stored = CHUNK_SIZE + 16;
    for (const [what, object, secret, cutAt, resumeFrom] of [
      // Encrypted: chunk 0 and part of chunk 1 come; it asks again from chunk 1.
      ['encrypted', sealed.stored, sealed.secret, 60 + stored + 500, 60 + stored],
      // Unencrypted: from the next byte.
      ['unencrypted', { encrypted: false, size: plaintext.length, bytes: plaintext, files: [{ name: 'report.pdf', size: plaintext.length }] }, undefined, CHUNK_SIZE + 500, CHUNK_SIZE + 500],
    ] as Array<[string, StoredObject, string | undefined, number, number]>) {
      const server = fakeServer();
      server.v4.store(FILE_ID, { ...object, maxDownloads: 2 });
      const stall = stallingFirst(server, cutAt);
      const { sink, log, bytes } = recordingSink();
      const download = createClient(server.fetchFn).hosted.download({ id: FILE_ID, secret, sink, timeoutMs: 50 });
      await expect.poll(() => log.length, { message: what }).toBeGreaterThan(0);
      await expect.poll(() => download.snapshot.processedBytes, { message: what }).toBeGreaterThanOrEqual(CHUNK_SIZE);
      expect(download.snapshot.canPause, what).toBe(true);

      const asked = Date.now();
      await download.pause();
      expect(stall.closed, `${what}: its request closed`).toBe(1);
      expect(download.snapshot, what).toMatchObject({ status: 'paused', pausedBy: 'self', canPause: true, text: 'Paused.' });
      expect(download.snapshot.deadline! - asked, what).toBeGreaterThanOrEqual(60 * 60_000);
      expect(server.paths().at(-1), what).toBe(LEASE_PAUSE);
      expect(server.v4.pauses, what).toEqual(['lease']);

      // Paused for four times its timeout: nothing reaches the sink, and nothing times out.
      const logAtPause = [...log];
      const sentAtPause = server.requests.length;
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(log, `${what}: no write, close or abort while paused`).toEqual(logAtPause);
      expect(server.requests.length, what).toBe(sentAtPause);
      expect(download.snapshot.status, what).toBe('paused');

      await download.resume();
      expect(download.snapshot, what).toMatchObject({ status: 'downloading', pausedBy: null, deadline: null });
      const outcome = await download.result;
      expect(outcome.status, what).toBe('completed');
      expect(Buffer.from(bytes()).equals(Buffer.from(plaintext)), `${what}: byte for byte`).toBe(true);
      expect(log.filter((entry) => entry.endsWith('close')), what).toEqual(['sink close']);

      // One lease: paused, renewed on resuming, which ends the pause, then the rest asked for under it.
      expect(server.paths().filter((path) => [LEASE, LEASE_PAUSE, RENEW, CONTENT, RELEASE].includes(path)), what)
        .toEqual([LEASE, CONTENT, LEASE_PAUSE, RENEW, CONTENT, RELEASE]);
      expect(server.ranges(), what).toEqual(['whole', `bytes=${resumeFrom}-`]);
      expect(new Set(server.headerOf(CONTENT, 'Dropgate-Lease')).size, what).toBe(1);
      expect(server.headerOf(CONTENT, 'If-Range')[1], what).toBe(`"${FILE_ID}"`);
      expect(server.v4.objects.get(FILE_ID)?.downloadCount, `${what}: counted once`).toBe(1);
    }
  });

  it('pauses a file of several, and a ZIP of them all, the same way: the rest asked for from the next whole chunk', async () => {
    const contents = [varied(CHUNK_SIZE + 10, 1), varied(CHUNK_SIZE * 2 + 5, 2), varied(30, 3)];
    const sealed = await sealedFiles(contents.map((bytes, i) => ({ name: `${'abc'[i]}.bin`, bytes })));
    const stored = CHUNK_SIZE + 16;
    for (const asZip of [false, true]) {
      const server = fakeServer();
      server.v4.store(FILE_ID, sealed.stored);
      // The member starts in chunk 1; its first two chunks come, then part of its third.
      stallingFirst(server, asZip ? 60 + 2 * stored + 100 : 2 * stored + 100);
      const one = recordingSink();
      const client = createClient(server.fetchFn);
      const download = asZip
        ? client.hosted.download({ id: FILE_ID, secret: sealed.secret, asZip: true, sink: one.sink })
        : client.hosted.download({ id: FILE_ID, secret: sealed.secret, files: [1], sink: one.sink });
      await expect.poll(() => download.snapshot.processedBytes).toBeGreaterThan(CHUNK_SIZE);
      await download.pause();
      const logAtPause = [...one.log];
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(one.log).toEqual(logAtPause);
      await download.resume();
      expect((await download.result).status).toBe('completed');

      const [firstRange, secondRange] = server.ranges();
      const from = Number(/^bytes=(\d+)-/.exec(secondRange)![1]);
      expect((from - 60) % stored, `${secondRange}: a whole chunk`).toBe(0);
      expect(from).toBe(60 + (asZip ? 2 : 3) * stored);
      // The member's chunks run to the upload's last.
      expect(firstRange).toBe(asZip ? 'whole' : `bytes=${60 + stored}-`);
      if (asZip) {
        const archive = readZip([{ bytes: one.bytes() }]);
        archive.entries.forEach((entry, i) => expect(Buffer.from(archive.bytesOf(entry)).equals(Buffer.from(contents[i])), `member ${i}`).toBe(true));
      } else {
        expect(Buffer.from(one.bytes()).equals(Buffer.from(contents[1]))).toBe(true);
      }
      expect(server.paths().filter((path) => path === LEASE)).toHaveLength(1);
    }
  });

  it("still paused at the server's deadline, it fails NOT_FOUND, the server having dropped it: its sink is aborted, and nothing resumes by itself", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const server = fakeServer({ maxPauseMinutes: 10 });
      const asked = gate();
      let answers = 0;
      server.answer(CONTENT, async (init) => {
        if (answers++ > 0) return (await server.v4.handle('GET', `/api/v4/objects/${FILE_ID}/content`, init))!;
        asked.open();
        return noAnswer(init);
      });
      const { sink, log } = recordingSink();
      const download = createClient(server.fetchFn).hosted.download({ id: FILE_ID, sink });
      await settled(asked.promise);
      await settled(download.pause());
      const sent = server.requests.length;
      await vi.advanceTimersByTimeAsync(10 * 60_000 - 1000);
      expect(download.snapshot.status).toBe('paused');
      const outcome = await settled(download.result);
      expect(outcome.status === 'failed' && outcome.error).toMatchObject({ code: 'NOT_FOUND', message: 'The server dropped this paused download.' });
      expect(log).toEqual(['sink abort NOT_FOUND']);
      // Only the lease's release follows: nothing asked for more.
      expect(server.paths().slice(sent)).toEqual([RELEASE]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("can't pause on a server with pausing off, nor before its lease; cancel() while paused aborts its sink and releases its lease", async () => {
    const off = fakeServer({ maxPauseMinutes: 0 });
    stallingFirst(off, 100);
    const { sink, log } = recordingSink();
    const unpausable = createClient(off.fetchFn).hosted.download({ id: FILE_ID, sink, timeoutMs: 100, retry: { backoffMs: 1 } });
    expect(unpausable.snapshot.canPause).toBe(false);
    await expect(unpausable.pause()).rejects.toMatchObject({ code: 'PAUSE_UNAVAILABLE' });
    await expect.poll(() => log.length).toBeGreaterThan(0);
    await expect(unpausable.pause()).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' });
    expect((await unpausable.result).status).toBe('completed');
    expect(off.paths()).not.toContain(LEASE_PAUSE);

    const server = fakeServer();
    stallingFirst(server, 100);
    const held = recordingSink();
    const download = createClient(server.fetchFn).hosted.download({ id: FILE_ID, sink: held.sink });
    await expect.poll(() => held.log.length).toBeGreaterThan(0);
    await download.pause();
    download.cancel();
    const outcome = await download.result;
    expect(outcome.status === 'cancelled' && outcome.cancellation.by).toBe('self');
    expect(held.log.at(-1)).toBe('sink abort OPERATION_CANCELLED');
    expect(server.paths().at(-1)).toBe(RELEASE);
    expect(server.v4.objects.get(FILE_ID)?.downloadCount, 'it sent bytes, so it counts').toBe(1);
  });

  it('while reconnecting, the snapshot gives when the server stops holding its lease, and none once it answers again', async () => {
    const server = fakeServer();
    // The first answer is cut short, and the next three tries get no answer.
    cutting(server, [100]);
    let contentTries = 0;
    const flaky: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/content') && contentTries++ > 0 && contentTries <= 4) throw new TypeError('fetch failed');
      return server.fetchFn(input, init);
    };
    const { sink, bytes } = recordingSink();
    const download = createClient(flaky).hosted.download({ id: FILE_ID, sink, retry: { backoffMs: 1 } });
    const seen: DownloadSnapshot[] = [];
    download.subscribe((snapshot) => seen.push(snapshot));
    expect((await download.result).status).toBe('completed');
    expect(bytes()).toHaveLength(CHUNK_SIZE);

    const waiting = seen.filter((s) => s.text.startsWith('The connection was lost. Reconnecting in'));
    expect(waiting.length).toBeGreaterThan(0);
    for (const s of waiting) {
      expect(s.status).toBe('downloading');
      expect(s.deadline! - Date.now()).toBeGreaterThan(4 * 60_000);
      expect(s.deadline! - Date.now()).toBeLessThanOrEqual(5 * 60_000);
    }
    const afterIt = seen.slice(seen.indexOf(waiting.at(-1)!) + 1);
    expect(afterIt.some((s) => s.deadline === null && s.status === 'downloading'), 'none once it answers').toBe(true);
    expect(download.snapshot.deadline).toBeNull();
  });
});

describe('Pausing a download of an opened upload', () => {
  /** Two files, unencrypted, stored as FILE_ID. */
  function twoFiles(server: ReturnType<typeof fakeServer>) {
    const contents = [varied(CHUNK_SIZE * 2, 1), varied(CHUNK_SIZE * 2, 2)];
    const bytes = new Uint8Array(Buffer.concat(contents));
    server.v4.store(FILE_ID, { encrypted: false, size: bytes.length, bytes, files: [{ name: 'a.bin', size: CHUNK_SIZE * 2 }, { name: 'b.bin', size: CHUNK_SIZE * 2 }] });
    return contents;
  }

  it('holds its one lease paused, unrenewed, while nothing else under it runs; resumed, it renews it again and goes on, and it counts once', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const server = fakeServer();
      const contents = twoFiles(server);
      stallingFirst(server, 1000);
      const opened = await createClient(server.fetchFn).hosted.open({ id: FILE_ID });
      const one = recordingSink();
      const download = opened.download({ files: [0], sink: one.sink });
      await expect.poll(() => one.log.length).toBeGreaterThan(0);
      await download.pause();
      expect(server.v4.pauses).toEqual(['lease']);
      expect(download.snapshot.deadline).not.toBeNull();

      // Paused for 10 minutes: no renewal, which would end the server's pause.
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(server.v4.renewals).toEqual([]);

      await download.resume();
      expect(server.v4.renewals).toHaveLength(1);
      expect((await download.result).status).toBe('completed');
      expect(Buffer.from(one.bytes()).equals(Buffer.from(contents[0]))).toBe(true);
      // Open again, it's renewed every 2 minutes as before.
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      await expect.poll(() => server.v4.renewals.length).toBe(2);

      await opened.close();
      expect(server.paths().filter((path) => path === LEASE)).toHaveLength(1);
      expect(new Set(server.headerOf(CONTENT, 'Dropgate-Lease')).size).toBe(1);
      expect(server.v4.objects.get(FILE_ID)?.downloadCount, 'one download').toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('paused while another download under its lease runs, it has no deadline; once that one ends, the lease is paused and it is told the deadline', async () => {
    const server = fakeServer();
    twoFiles(server);
    // Both downloads' first requests stall, so both are running at once.
    const release: Array<() => void> = [];
    server.answer(CONTENT, async (init) => {
      const res = (await server.v4.handle('GET', `/api/v4/objects/${FILE_ID}/content`, init))!;
      if (release.length >= 2) return res;
      const reader = res.body!.getReader();
      let gone = false;
      const waitFor = new Promise<void>((resolve) => release.push(resolve));
      return new Response(new ReadableStream({
        async pull(controller) {
          if (gone) return;
          await waitFor;
          const { done, value } = await reader.read();
          if (done) controller.close();
          else controller.enqueue(value);
        },
        cancel() { gone = true; reader.cancel().catch(() => { }); },
      }), { status: res.status, headers: res.headers });
    });
    const opened = await createClient(server.fetchFn).hosted.open({ id: FILE_ID });
    const first = opened.download({ files: [0], sink: recordingSink().sink });
    const second = opened.download({ files: [1], sink: recordingSink().sink });
    await expect.poll(() => release.length).toBe(2);

    await first.pause();
    expect(first.snapshot).toMatchObject({ status: 'paused', deadline: null });
    expect(server.v4.pauses, 'the other keeps the lease').toEqual([]);

    release[1]();
    expect((await second.result).status).toBe('completed');
    await expect.poll(() => first.snapshot.deadline).not.toBeNull();
    expect(server.v4.pauses).toEqual(['lease']);

    await first.resume();
    release[0]();
    expect((await first.result).status).toBe('completed');
    await opened.close();
    expect(server.paths().filter((path) => path === LEASE)).toHaveLength(1);
    expect(server.v4.objects.get(FILE_ID)?.downloadCount).toBe(1);
  });
});
