import { describe, it, expect, vi } from 'vitest';
import { inspect } from 'node:util';
import { DropgateClient } from '../src/index.js';
import type { CredentialProvider, CredentialRequest, DownloadSink } from '../src/index.js';
import { errorFromStatus } from '../src/errors.js';
import { CHUNK_SIZE, fakeV4 } from './helpers/fake-v4.js';

// The credential boundary (08 §7.3; 09 §14): how core asks for a credential
// for a server that needs one, and where one may and may not go. Against a
// fake server through `fetchFn`: no network.

const BASE_URL = 'https://files.example';
const FILE_ID = '0b7d4c52-5f0e-4d8e-9a57-3c1f2e6b8a90';
const BUNDLE_ID = '6a1e9f3b-2c4d-4b7a-8e5f-9d0c1b2a3e4f';
// Tokens that would be noticed anywhere they turned up.
const TOKEN = 'zq7TOKENaaaa.bbbb-cccc_dddd~eeee';
const RENEWED = 'zq7RENEWEDffff.gggg';

interface Seen {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  init: RequestInit;
}

// One file's upload, on Dropgate 4's routes.
const START = '/api/v4/uploads';
const CHUNK = '/api/v4/upload/chunks/0';
const FINISH = '/api/v4/upload/complete';
const CANCEL = '/api/v4/upload';
const isUpload = (path: string) => path.startsWith('/upload/') || path.startsWith('/api/v4/upload');

/**
 * A fake Dropgate server: Dropgate 4's routes for one file, version 3's for a
 * bundle. With `credentialRequired`, it says so in its info, and answers any
 * upload request without `Authorization: Bearer <accept>` with 401. `answer`
 * replaces a route's answer (a chunk's as `PUT /api/v4/upload/chunks/:index`),
 * and `pass` gives the usual one.
 */
function fakeServer({ credentialRequired = false, accept = TOKEN }: { credentialRequired?: boolean; accept?: string } = {}) {
  const seen: Seen[] = [];
  const answers = new Map<string, (request: Seen) => Response | Promise<Response>>();
  const state = { accept };
  const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  const v4 = fakeV4({ id: FILE_ID });
  v4.store(FILE_ID, { encrypted: false, size: CHUNK_SIZE, bytes: new Uint8Array(CHUNK_SIZE), files: [{ name: 'notes.txt', size: CHUNK_SIZE }] });
  const pass = async (request: Seen) => (await v4.handle(request.method, request.path, request.init)) ?? json(404, { error: 'Not found.' });

  const fetchFn = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const path = new URL(url).pathname;
    const method = init.method ?? 'GET';
    const headers = { ...(init.headers as Record<string, string> | undefined) };
    const body = typeof init.body === 'string' ? init.body : init.body instanceof Blob ? await init.body.text() : '';
    const request = { method, url, path, headers, body, init };
    seen.push(request);
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (init.signal?.aborted) throw init.signal.reason;

    const answer = answers.get(`${method} ${path.replace(/\/chunks\/\d+$/, '/chunks/:index')}`);
    if (answer) return answer(request);
    if (credentialRequired && isUpload(path) && headers.Authorization !== `Bearer ${state.accept}`) {
      return json(401, { error: 'Sign in first.', code: 'AUTH_REQUIRED' });
    }
    switch (`${method} ${path}`) {
      case 'GET /api/info':
        return json(200, {
          name: 'Test server', version: '4.0.0',
          protocols: { dgup: { major: 4, minor: 0 }, dgdtp: { major: 4, minor: 0 } },
          capabilities: { upload: { enabled: true, maxSizeMB: 0, maxLifetimeHours: 0, e2ee: true, chunkSize: CHUNK_SIZE, credentialRequired } },
        });
      case 'POST /upload/init-bundle': return json(200, { bundleUploadId: 'bundle-1', fileUploadIds: ['upload-1', 'upload-2'] });
      case 'POST /upload/chunk': return json(200, {});
      case 'POST /upload/complete': return json(200, { id: FILE_ID });
      case 'POST /upload/complete-bundle': return json(200, { bundleId: BUNDLE_ID });
      case 'POST /upload/cancel': return json(200, {});
      default: return pass(request);
    }
  };

  return {
    fetchFn,
    seen,
    state,
    json,
    pass,
    answer: (route: string, respond: (request: Seen) => Response | Promise<Response>) => { answers.set(route, respond); },
    uploads: () => seen.filter((r) => isUpload(r.path)),
    withAuth: () => seen.filter((r) => Object.keys(r.headers).some((h) => h.toLowerCase() === 'authorization')),
  };
}

const file = (name = 'notes.txt', size = CHUNK_SIZE * 2) => new File([new Uint8Array(size).fill(7)], name);
const nullSink = (): DownloadSink => ({ write: () => {}, close: () => {} });
const make = (server: ReturnType<typeof fakeServer>, auth?: CredentialProvider) =>
  new DropgateClient({ server: BASE_URL, fetchFn: server.fetchFn, ...(auth ? { auth } : {}) });
const upload = (client: DropgateClient, files: File | File[] = file(), encrypt = false) =>
  client.hosted.upload({ files, lifetimeMs: 60_000, encrypt });
const giving = (...tokens: Array<string | null>) => {
  let i = 0;
  return vi.fn<CredentialProvider>(async () => {
    const token = tokens[Math.min(i++, tokens.length - 1)];
    return token === null ? null : { token };
  });
};

/** Everything a caller can see of a run, as one string: snapshots, the outcome, and any error, every way it's printed. */
async function everythingSeen(client: DropgateClient, handle: ReturnType<DropgateClient['hosted']['upload']>) {
  const snapshots: unknown[] = [handle.snapshot];
  handle.subscribe((s) => snapshots.push(s));
  const outcome = await handle.result;
  const parts = [JSON.stringify(snapshots), JSON.stringify(outcome), inspect(outcome, { depth: 8 }), inspect(client, { depth: 4 }), JSON.stringify(client)];
  if (outcome.status === 'failed') {
    parts.push(String(outcome.error), String(outcome.error.stack), JSON.stringify(outcome.error), inspect(outcome.error, { depth: 8 }));
  }
  return { outcome, text: parts.join('\n') };
}

describe('Nothing is sent unless the server asks and a provider gives one (09 14.1, 14.2)', () => {
  it('sends no credential with no provider: every request, every operation', async () => {
    const server = fakeServer();
    const client = make(server);
    await client.server.info();
    expect((await upload(client).result).status).toBe('completed');
    expect((await client.hosted.download({ id: FILE_ID, sink: nullSink() }).result).status).toBe('completed');
    await client.hosted.metadata({ id: FILE_ID });
    await client.links.resolve(`${BASE_URL}/${FILE_ID}`);
    expect(server.seen.length).toBeGreaterThan(6);
    expect(server.withAuth()).toEqual([]);
  });

  it("never asks the provider, nor sends anything, when the server doesn't ask for a credential", async () => {
    const server = fakeServer();
    const auth = giving(TOKEN);
    const client = make(server, auth);
    expect((await upload(client).result).status).toBe('completed');
    expect((await upload(client, [file('a.txt'), file('b.txt')]).result).status).toBe('completed');
    expect((await client.hosted.download({ id: FILE_ID, sink: nullSink() }).result).status).toBe('completed');
    expect(auth).not.toHaveBeenCalled();
    expect(server.withAuth()).toEqual([]);
    expect(server.seen.map((r) => r.body + r.url).join('\n')).not.toContain(TOKEN);
  });
});

describe('Asked once per operation, sent with every request of it (09 14.3)', () => {
  it('asks once for an upload, and sends the token on each of its requests and no others', async () => {
    const server = fakeServer({ credentialRequired: true });
    const auth = giving(TOKEN);
    const client = make(server, auth);
    expect((await upload(client, file('a.txt', CHUNK_SIZE * 3)).result).status).toBe('completed');
    expect(auth).toHaveBeenCalledTimes(1);
    const request = auth.mock.calls[0][0] as CredentialRequest;
    expect({ ...request, signal: undefined }).toEqual({ operation: 'hosted.upload', reason: 'required', baseUrl: BASE_URL, signal: undefined });
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(server.uploads().map((r) => `${r.path} ${r.headers.Authorization}`)).toEqual([
      `${START} Bearer ${TOKEN}`,
      `/api/v4/upload/chunks/0 Bearer ${TOKEN}`,
      `/api/v4/upload/chunks/1 Bearer ${TOKEN}`,
      `/api/v4/upload/chunks/2 Bearer ${TOKEN}`,
      `${FINISH} Bearer ${TOKEN}`,
    ]);

    // The same client's receiving never asks, nor sends it: links and IDs are bearer capabilities.
    const before = server.seen.length;
    expect((await client.hosted.download({ id: FILE_ID, sink: nullSink() }).result).status).toBe('completed');
    await client.hosted.metadata({ id: FILE_ID });
    await client.links.resolve(FILE_ID);
    await client.server.info();
    expect(server.seen.slice(before).filter((r) => r.headers.Authorization)).toEqual([]);
    expect(auth).toHaveBeenCalledTimes(1);
  });

  it('asks once for a bundle, and its every request carries it', async () => {
    const server = fakeServer({ credentialRequired: true });
    const auth = giving(TOKEN);
    const outcome = await upload(make(server, auth), [file('a.txt'), file('b.txt')], true).result;
    expect(outcome.status).toBe('completed');
    expect(auth).toHaveBeenCalledTimes(1);
    expect(server.uploads().map((r) => r.path)).toContain('/upload/complete-bundle');
    expect(server.uploads().every((r) => r.headers.Authorization === `Bearer ${TOKEN}`)).toBe(true);
  });

  it('asks again for each new upload, and keeps no credential between them', async () => {
    const server = fakeServer({ credentialRequired: true });
    const auth = giving(TOKEN);
    const client = make(server, auth);
    await upload(client).result;
    await upload(client).result;
    expect(auth).toHaveBeenCalledTimes(2);
  });

  it("sends the credential with an upload's cancel", async () => {
    const server = fakeServer({ credentialRequired: true });
    let handle!: ReturnType<typeof upload>;
    server.answer('PUT /api/v4/upload/chunks/:index', (request) => {
      handle.cancel();
      return server.pass(request);
    });
    handle = upload(make(server, giving(TOKEN)));
    expect((await handle.result).status).toBe('cancelled');
    await vi.waitFor(() => expect(server.seen.map((r) => `${r.method} ${r.path}`)).toContain(`DELETE ${CANCEL}`));
    expect(server.seen.find((r) => r.method === 'DELETE' && r.path === CANCEL)!.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });
});

describe('No credential, no upload (09 14.4)', () => {
  it('fails AUTH_REQUIRED with no provider, before any upload request', async () => {
    const server = fakeServer({ credentialRequired: true });
    const outcome = await upload(make(server)).result;
    expect(outcome.status === 'failed' && outcome.error.code).toBe('AUTH_REQUIRED');
    expect(server.uploads()).toEqual([]);
  });

  it('fails AUTH_REQUIRED when the provider gives none, before any upload request', async () => {
    const server = fakeServer({ credentialRequired: true });
    const auth = giving(null);
    const outcome = await upload(make(server, auth)).result;
    expect(outcome.status === 'failed' && outcome.error.code).toBe('AUTH_REQUIRED');
    expect(auth).toHaveBeenCalledTimes(1);
    expect(server.uploads()).toEqual([]);
  });

  it('a provider that fails fails the upload AUTH_REQUIRED, keeping none of its error', async () => {
    const server = fakeServer({ credentialRequired: true });
    const auth: CredentialProvider = async () => { throw new Error(`refresh failed for ${TOKEN}`); };
    const client = make(server, auth);
    const { outcome, text } = await everythingSeen(client, upload(client));
    expect(outcome.status === 'failed' && outcome.error.code).toBe('AUTH_REQUIRED');
    expect(outcome.status === 'failed' && outcome.error.cause).toBeUndefined();
    expect(text).not.toContain(TOKEN);
    expect(server.uploads()).toEqual([]);
  });

  it('cancelling while the provider is working sends nothing, and aborts its signal', async () => {
    const server = fakeServer({ credentialRequired: true });
    let signal!: AbortSignal;
    const auth: CredentialProvider = (request) => {
      signal = request.signal;
      return new Promise(() => {});
    };
    const handle = upload(make(server, auth));
    await vi.waitFor(() => expect(signal).toBeDefined());
    handle.cancel();
    expect((await handle.result).status).toBe('cancelled');
    expect(signal.aborted).toBe(true);
    expect(server.uploads()).toEqual([]);
  });
});

describe('An expired credential is renewed once (09 14.5)', () => {
  it('asks once more after AUTH_EXPIRED, and sends the request again with the new token', async () => {
    const server = fakeServer({ credentialRequired: true });
    let expired = false;
    server.answer('PUT /api/v4/upload/chunks/:index', (r) => {
      if (!expired) {
        expired = true;
        server.state.accept = RENEWED;
        return server.json(401, { error: 'Expired.', code: 'AUTH_EXPIRED' });
      }
      return r.headers.Authorization === `Bearer ${RENEWED}` ? server.pass(r) : server.json(401, { code: 'AUTH_REQUIRED' });
    });
    const auth = giving(TOKEN, RENEWED);
    const outcome = await upload(make(server, auth)).result;
    expect(outcome.status).toBe('completed');
    expect(auth).toHaveBeenCalledTimes(2);
    expect((auth.mock.calls[1][0] as CredentialRequest).reason).toBe('expired');
    expect(server.uploads().map((r) => `${r.path} ${r.headers.Authorization.slice(7)}`)).toEqual([
      `${START} ${TOKEN}`, `/api/v4/upload/chunks/0 ${TOKEN}`, `/api/v4/upload/chunks/0 ${RENEWED}`, `/api/v4/upload/chunks/1 ${RENEWED}`, `${FINISH} ${RENEWED}`,
    ]);
  });

  it('renews on a JSON request too (the start)', async () => {
    const server = fakeServer({ credentialRequired: true });
    let first = true;
    server.answer(`POST ${START}`, (r) => {
      if (first) { first = false; return server.json(401, { code: 'AUTH_EXPIRED' }); }
      return r.headers.Authorization === `Bearer ${RENEWED}` ? server.pass(r) : server.json(401, {});
    });
    server.state.accept = RENEWED;
    const auth = giving(TOKEN, RENEWED);
    expect((await upload(make(server, auth)).result).status).toBe('completed');
    expect(auth).toHaveBeenCalledTimes(2);
  });

  it('fails AUTH_EXPIRED if it expires again, having asked only twice', async () => {
    const server = fakeServer({ credentialRequired: true });
    server.answer('PUT /api/v4/upload/chunks/:index', () => server.json(401, { code: 'AUTH_EXPIRED' }));
    const auth = giving(TOKEN, RENEWED);
    const outcome = await upload(make(server, auth)).result;
    expect(outcome.status === 'failed' && outcome.error.code).toBe('AUTH_EXPIRED');
    expect(auth).toHaveBeenCalledTimes(2);
    expect(server.uploads().filter((r) => r.path === CHUNK)).toHaveLength(2);
  });
});

describe('Typed outcomes, never retried as they are (09 14.6)', () => {
  it('maps a 401 to AUTH_REQUIRED, and a code the server names to its own', () => {
    expect(errorFromStatus(401, null).code).toBe('AUTH_REQUIRED');
    expect(errorFromStatus(401, { code: 'AUTH_EXPIRED' }).code).toBe('AUTH_EXPIRED');
    expect(errorFromStatus(403, { code: 'AUTH_DENIED' }).code).toBe('AUTH_DENIED');
    expect(errorFromStatus(403, null).code).toBe('REQUEST_REJECTED');
    expect(errorFromStatus(429, { code: 'QUOTA_EXCEEDED' }).code).toBe('QUOTA_EXCEEDED');
    // A server can't name just any code, nor a credential code on a 5xx.
    expect(errorFromStatus(400, { code: 'KEY_REQUIRED' }).code).toBe('REQUEST_REJECTED');
    expect(errorFromStatus(500, { code: 'AUTH_DENIED' }).code).toBe('SERVER_ERROR');
    // What the server said about a credential isn't repeated.
    expect(errorFromStatus(403, { code: 'AUTH_DENIED', error: `Token ${TOKEN} is revoked.` }).message).not.toContain(TOKEN);
  });

  for (const [status, code] of [[401, 'AUTH_REQUIRED'], [403, 'AUTH_DENIED'], [403, 'QUOTA_EXCEEDED']] as const) {
    it(`fails an upload ${code} on a chunk's ${status}, without retrying it`, async () => {
      const server = fakeServer({ credentialRequired: true });
      server.answer('PUT /api/v4/upload/chunks/:index', () => server.json(status, { code }));
      const auth = giving(TOKEN);
      const outcome = await upload(make(server, auth)).result;
      expect(outcome.status === 'failed' && outcome.error.code).toBe(code);
      expect(outcome.status === 'failed' && outcome.error.status).toBe(status);
      expect(server.uploads().filter((r) => r.path === CHUNK)).toHaveLength(1);
      expect(auth).toHaveBeenCalledTimes(1);
    });
  }
});

describe('Never in a snapshot, result, error, log or URL (09 14.7, hard requirement 8)', () => {
  it('a completed upload, encrypted: only the Authorization header carries it', async () => {
    const server = fakeServer({ credentialRequired: true });
    const client = make(server, giving(TOKEN));
    const runs = [
      await everythingSeen(client, upload(client, [file('a.txt'), file('b.txt')], true)),
      await everythingSeen(client, upload(client, file('a.txt'), true)),
    ];
    for (const { outcome, text } of runs) {
      expect(outcome.status).toBe('completed');
      expect(text).not.toContain(TOKEN);
      // The link, the secret and the manage token are this upload's own: none holds the credential.
      expect(outcome.status === 'completed' && JSON.stringify(outcome.value)).not.toContain(TOKEN);
    }
    for (const r of server.seen) {
      expect(r.url, r.path).not.toContain(TOKEN);
      expect(r.body, r.path).not.toContain(TOKEN);
      const { Authorization, ...rest } = r.headers;
      expect(JSON.stringify(rest), r.path).not.toContain(TOKEN);
      if (Authorization) expect(Authorization).toBe(`Bearer ${TOKEN}`);
    }
  });

  it('a failed upload: its error, however it is printed', async () => {
    const server = fakeServer({ credentialRequired: true });
    server.answer('PUT /api/v4/upload/chunks/:index', () => server.json(401, { code: 'AUTH_EXPIRED', error: `Expired: ${TOKEN}` }));
    const client = make(server, giving(TOKEN, TOKEN));
    const { outcome, text } = await everythingSeen(client, upload(client));
    expect(outcome.status === 'failed' && outcome.error.code).toBe('AUTH_EXPIRED');
    expect(text).not.toContain(TOKEN);
  });

  it('the client shows nothing of its provider', () => {
    const client = make(fakeServer(), giving(TOKEN));
    expect(Object.keys(client)).not.toContain('auth');
    expect(JSON.stringify(client)).not.toMatch(/auth/i);
  });
});

describe('Only what a credential may be, and only to its own server (09 14.8)', () => {
  for (const [label, given] of [
    ['a token with a line break', { token: `${TOKEN}\r\nX-Evil: 1` }],
    ['a token with a space', { token: `${TOKEN} more` }],
    ['an empty token', { token: '' }],
    ['a token that is not a string', { token: 42 }],
    ['no token', {}],
    ['a string, not { token }', TOKEN],
  ] as const) {
    it(`refuses ${label} with INVALID_ARGUMENT, sending nothing, and quoting none of it`, async () => {
      const server = fakeServer({ credentialRequired: true });
      const client = make(server, (async () => given) as unknown as CredentialProvider);
      const { outcome, text } = await everythingSeen(client, upload(client));
      expect(outcome.status === 'failed' && outcome.error.code).toBe('INVALID_ARGUMENT');
      expect(text).not.toContain(TOKEN);
      expect(server.uploads()).toEqual([]);
    });
  }

  it('refuses an auth option that is not a function', () => {
    for (const auth of [TOKEN, { token: TOKEN }, null]) {
      expect(() => new DropgateClient({ server: BASE_URL, fetchFn: fakeServer().fetchFn, auth } as unknown as ConstructorParameters<typeof DropgateClient>[0]))
        .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    }
  });

  it('follows no redirect, so the credential never goes anywhere else', async () => {
    const server = fakeServer({ credentialRequired: true });
    server.answer(`POST ${START}`, () => new Response(null, { status: 307, headers: { Location: `https://elsewhere.example${START}` } }));
    const outcome = await upload(make(server, giving(TOKEN))).result;
    expect(outcome.status === 'failed' && outcome.error.code).toBe('REDIRECT_NOT_FOLLOWED');
    expect(server.seen.every((r) => new URL(r.url).origin === BASE_URL)).toBe(true);
    expect(server.withAuth().map((r) => r.path)).toEqual([START]);
  });
});
