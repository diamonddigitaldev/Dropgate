import { describe, it, expect, beforeEach } from 'vitest';
import { DropgateClient, DropgateError } from '../src/index.js';
import type { DownloadSink, PeerConstructor } from '../src/index.js';
import { FakePeer } from './helpers/fake-peer.js';
import { CHUNK_SIZE, MANAGE_TOKEN_HASH, MANAGE_TOKEN, fakeV4 } from './helpers/fake-v4.js';

// The insecure-transport policy (`09` 7.1.1–7.1.6): no automatic fallback to
// plain HTTP, no redirect followed, an insecure server only with
// `allowInsecure`, loopback counted as secure, and `transport.secure` on every
// snapshot, result and error. Against a fake server through `fetchFn`: no network.

const SECURE_URL = 'https://files.example';
const LAN_URL = 'http://192.168.1.10';
const FILE_ID = '0b7d4c52-5f0e-4d8e-9a57-3c1f2e6b8a90';

const INFO = {
  name: 'Test server',
  version: '4.0.0',
  protocols: { dgup: { major: 4, minor: 0 }, dgdtp: { major: 4, minor: 0 } },
  capabilities: {
    upload: { enabled: true, maxSizeMB: 0, maxLifetimeHours: 0, e2ee: true, chunkSize: CHUNK_SIZE },
    p2p: { enabled: true, peerjsPath: '/peerjs', iceServers: [] },
  },
};

const json = (status: number, value: unknown): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

interface Seen {
  url: string;
  redirect: RequestRedirect | undefined;
}

/**
 * A fake Dropgate server. `failing` makes every route but /api/info answer
 * 500, and `infoFails` makes /api/info answer 500 too. `p2p: false` turns
 * direct transfer off.
 */
function fakeServer(opts: { failing?: boolean; infoFails?: boolean; p2p?: boolean } = {}) {
  const requests: Seen[] = [];
  const v4 = fakeV4({ id: FILE_ID });
  v4.store(FILE_ID, { encrypted: false, size: CHUNK_SIZE, bytes: new Uint8Array(CHUNK_SIZE), files: [{ name: 'notes.txt', size: CHUNK_SIZE }], manageTokenHash: MANAGE_TOKEN_HASH });
  const fetchFn = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    requests.push({ url, redirect: init.redirect });
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (init.signal?.aborted) throw init.signal.reason;

    const method = init.method ?? 'GET';
    const path = new URL(url).pathname;
    if (path === '/api/info') {
      if (opts.infoFails) return json(500, { error: 'Broken.' });
      return json(200, opts.p2p === false ? { ...INFO, capabilities: { ...INFO.capabilities, p2p: { enabled: false } } } : INFO);
    }
    if (opts.failing) return json(500, { code: 'SERVER_ERROR', error: 'Broken.' });
    return (await v4.handle(method, path, init)) ?? json(404, { error: 'Not found.' });
  };
  return { fetchFn, requests };
}

const nullSink = (): DownloadSink => ({ write: () => {}, close: () => {} });
const fileNamed = (name: string) => new File([new Uint8Array(CHUNK_SIZE)], name);

/** An answer that never comes: the request waits until it's aborted. */
const noAnswer = (init: RequestInit): Promise<never> => new Promise((_, reject) => {
  init.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
});

/** The error `run` throws or rejects with. */
async function errorFrom(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error('It did not fail.');
}

beforeEach(() => {
  FakePeer.reset();
});

describe('No automatic fallback to plain HTTP', () => {
  it('a server that only answers on http:// is never tried there: connect() fails with a network error', async () => {
    const requests: string[] = [];
    // Port 443 is blocked: every https:// request fails as a refused connection does.
    const fetchFn = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      requests.push(url);
      if (url.startsWith('https://')) throw new TypeError('fetch failed');
      return json(200, INFO);
    };
    const client = new DropgateClient({ server: 'https://lan-box', fetchFn });

    const err = await errorFrom(() => client.server.connect());
    expect(DropgateError.is(err, 'SERVER_UNREACHABLE')).toBe(true);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.filter((url) => url.startsWith('http://')), 'requests over plain HTTP').toEqual([]);
    expect(client.server.baseUrl).toBe('https://lan-box');
  });

  it('fallbackToHttp is no longer an option: passing it changes nothing', async () => {
    const requests: string[] = [];
    const fetchFn = async (input: RequestInfo | URL): Promise<Response> => {
      requests.push(String(input));
      throw new TypeError('fetch failed');
    };
    const options = { server: 'https://lan-box', fetchFn, fallbackToHttp: true };
    const client = new DropgateClient(options as ConstructorParameters<typeof DropgateClient>[0]);
    await errorFrom(() => client.server.connect());
    expect(requests.filter((url) => url.startsWith('http://'))).toEqual([]);
    expect('fallbackToHttp' in client).toBe(false);
  });
});

describe('No redirect is followed', () => {
  it('an https:// server that redirects to http:// is refused with a typed error, and nothing is sent to http://', async () => {
    const requests: Seen[] = [];
    // As fetch() does: a redirect is followed unless the request says otherwise.
    const fetchFn = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
      const url = String(input);
      requests.push({ url, redirect: init.redirect });
      if (url.startsWith('https://')) {
        const redirect = new Response(null, { status: 301, headers: { Location: url.replace('https://', 'http://') } });
        if (init.redirect === 'manual') return redirect;
        requests.push({ url: url.replace('https://', 'http://'), redirect: init.redirect });
        return json(200, INFO);
      }
      return json(200, INFO);
    };
    const client = new DropgateClient({ server: SECURE_URL, fetchFn });

    const err = await errorFrom(() => client.server.connect());
    expect(DropgateError.is(err, 'REDIRECT_NOT_FOLLOWED')).toBe(true);
    expect((err as DropgateError).status).toBe(301);
    expect(requests.map((r) => r.url).filter((url) => url.startsWith('http://')), 'requests over plain HTTP').toEqual([]);
    expect(requests.every((r) => r.redirect === 'manual'), 'every request asks not to follow redirects').toBe(true);
  });

  it("a browser's answer for a redirect it didn't follow (opaque, status 0) is refused the same way", async () => {
    const opaque = { type: 'opaqueredirect', status: 0, ok: false, headers: new Headers(), body: null } as unknown as Response;
    const client = new DropgateClient({ server: SECURE_URL, fetchFn: async () => opaque });
    const err = await errorFrom(() => client.server.connect());
    expect(DropgateError.is(err, 'REDIRECT_NOT_FOLLOWED')).toBe(true);
    expect((err as DropgateError).status).toBeUndefined();
  });

  it('a redirect during an upload fails it, without sending the chunks anywhere else', async () => {
    const server = fakeServer();
    const fetchFn = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
      if (new URL(String(input)).pathname === '/api/v4/uploads') {
        return new Response(null, { status: 307, headers: { Location: 'http://files.example/api/v4/uploads' } });
      }
      return server.fetchFn(input, init);
    };
    const client = new DropgateClient({ server: SECURE_URL, fetchFn });
    const outcome = await client.hosted.upload({ files: fileNamed('a.txt'), lifetimeMs: 60_000, encrypt: false }).result;
    expect(outcome.status === 'failed' && outcome.error.code).toBe('REDIRECT_NOT_FOLLOWED');
    expect(server.requests.map((r) => new URL(r.url).pathname)).not.toContain('/api/v4/upload/chunks/0');
  });
});

describe('An insecure server needs allowInsecure', () => {
  it('http:// on another machine, without opting in, is refused with INSECURE_TRANSPORT_NOT_ALLOWED before any request', () => {
    const server = fakeServer();
    const err = (() => {
      try {
        new DropgateClient({ server: LAN_URL, fetchFn: server.fetchFn });
      } catch (e) {
        return e;
      }
    })();
    expect(DropgateError.is(err, 'INSECURE_TRANSPORT_NOT_ALLOWED')).toBe(true);
    expect((err as DropgateError).transport).toEqual({ secure: false });
    expect(server.requests, 'requests made').toEqual([]);

    // A ServerTarget is held to the same rule, and so is `allowInsecure` given as anything but true.
    expect(() => new DropgateClient({ server: { host: '192.168.1.10', secure: false }, fetchFn: server.fetchFn }))
      .toThrow(expect.objectContaining({ code: 'INSECURE_TRANSPORT_NOT_ALLOWED' }));
    const truthy = { server: LAN_URL, fetchFn: server.fetchFn, allowInsecure: 'yes' };
    expect(() => new DropgateClient(truthy as unknown as ConstructorParameters<typeof DropgateClient>[0]))
      .toThrow(expect.objectContaining({ code: 'INSECURE_TRANSPORT_NOT_ALLOWED' }));
    expect(server.requests).toEqual([]);
  });

  it('with allowInsecure: true it works; connect() says secure: false, and insecure-transport fires', async () => {
    const server = fakeServer();
    const client = new DropgateClient({ server: LAN_URL, fetchFn: server.fetchFn, allowInsecure: true });
    expect(client.server.transport).toEqual({ secure: false });

    const heard: unknown[] = [];
    const alsoHeard: unknown[] = [];
    client.server.on('insecure-transport', (event) => heard.push(event));
    const stop = client.server.on('insecure-transport', (event) => alsoHeard.push(event));
    client.server.on('insecure-transport', () => { throw new Error('A listener that throws.'); });
    stop();

    const connection = await client.server.connect();
    expect(connection.transport).toEqual({ secure: false });
    expect(connection.dgup.compatible).toBe(true);
    expect(heard).toEqual([{ baseUrl: LAN_URL, transport: { secure: false } }]);
    expect(alsoHeard, 'a listener that stopped listening').toEqual([]);

    // The connection is kept, so it fires once, as the client connects.
    await client.server.connect();
    expect(heard).toHaveLength(1);
  });

  it("insecure-transport never fires for a secure server, and on() takes no other event", async () => {
    const client = new DropgateClient({ server: SECURE_URL, fetchFn: fakeServer().fetchFn });
    const heard: unknown[] = [];
    client.server.on('insecure-transport', (event) => heard.push(event));
    await client.server.connect();
    expect(heard).toEqual([]);

    const err = await errorFrom(() => client.server.on('connected' as 'insecure-transport', () => {}));
    expect(DropgateError.is(err, 'INVALID_ARGUMENT')).toBe(true);
    expect((err as DropgateError).transport).toEqual({ secure: true });
  });
});

describe('Loopback is secure', () => {
  it.each([
    'http://localhost', 'http://localhost:52443', 'http://127.0.0.1', 'http://127.0.0.1:52443',
    'http://[::1]', 'http://[::1]:52443', 'http://LOCALHOST', 'https://192.168.1.10', 'https://files.example',
  ])('%s counts as secure, with no opt-in', async (url) => {
    const server = fakeServer();
    const client = new DropgateClient({ server: url, fetchFn: server.fetchFn });
    expect(client.server.transport).toEqual({ secure: true });
    expect((await client.server.connect()).transport).toEqual({ secure: true });
  });

  it.each([
    'http://localhost.example.com', 'http://127.0.0.1.nip.io', 'http://192.168.1.10', 'http://10.0.0.5:52443',
    'http://nas.local', 'http://[fe80::1]', 'http://0.0.0.0', 'http://127.0.0.2',
  ])('%s is another machine as far as core knows, whatever it resolves to: refused without the opt-in', (url) => {
    const server = fakeServer();
    expect(() => new DropgateClient({ server: url, fetchFn: server.fetchFn }))
      .toThrow(expect.objectContaining({ code: 'INSECURE_TRANSPORT_NOT_ALLOWED' }));
    expect(server.requests).toEqual([]);
    expect(new DropgateClient({ server: url, fetchFn: server.fetchFn, allowInsecure: true }).server.transport).toEqual({ secure: false });
  });
});

// ===== 7.1.6: transport.secure everywhere =====

interface Collected {
  snapshots: unknown[];
  results: unknown[];
  errors: unknown[];
}

type Mode = { label: string; url: string; secure: boolean };
const MODES: Mode[] = [
  { label: 'secure (https://)', url: SECURE_URL, secure: true },
  { label: 'insecure (http:// on the LAN, allowed)', url: LAN_URL, secure: false },
];

/** Waits for the client to make its fake peer, then lets the signalling server accept it. */
async function peerOpens(id: string): Promise<FakePeer> {
  await expect.poll(() => FakePeer.instances.length).toBeGreaterThan(0);
  const peer = FakePeer.latest();
  peer.simulateOpen(id);
  return peer;
}

/**
 * Every public operation, each run once succeeding and once failing (or
 * cancelled), giving back every snapshot, result and error it gave.
 */
/** Makes a client for the mode under test, against a fake server with these options, or this fetch. */
type Make = (opts?: Parameters<typeof fakeServer>[0], fetchFn?: typeof fetch) => DropgateClient;

const OPERATIONS: Record<string, (make: Make) => Promise<Collected>> = {
  'server.connect': async (make) => ({
    snapshots: [],
    results: [await make().server.connect()],
    errors: [await errorFrom(() => make({ infoFails: true }).server.connect())],
  }),
  'server.info': async (make) => ({
    snapshots: [],
    results: [await make().server.info()],
    errors: [await errorFrom(() => make({ infoFails: true }).server.info())],
  }),
  'links.resolve': async (make) => ({
    snapshots: [],
    results: [
      await make().links.resolve(FILE_ID),
      await make().links.resolve('not a link'),
    ],
    errors: [await errorFrom(() => make({ infoFails: true }).links.resolve('ABCD-1234'))],
  }),
  'hosted.upload': async (make) => {
    const snapshots: unknown[] = [];
    const upload = make().hosted.upload({ files: fileNamed('a.txt'), lifetimeMs: 60_000, encrypt: false });
    snapshots.push(upload.snapshot);
    upload.subscribe((s) => snapshots.push(s));
    const done = await upload.result;
    const failing = make({ failing: true }).hosted.upload({ files: fileNamed('a.txt'), lifetimeMs: 60_000, encrypt: false });
    failing.subscribe((s) => snapshots.push(s));
    const failed = await failing.result;
    return {
      snapshots,
      results: [done, done.status === 'completed' && done.value, failed],
      errors: [
        failed.status === 'failed' && failed.error,
        await errorFrom(() => make().hosted.upload({ files: [], lifetimeMs: 0 })),
      ],
    };
  },
  'hosted.download': async (make) => {
    const snapshots: unknown[] = [];
    const download = make().hosted.download({ id: FILE_ID, sink: nullSink() });
    snapshots.push(download.snapshot);
    download.subscribe((s) => snapshots.push(s));
    const done = await download.result;
    const failing = make({ failing: true }).hosted.download({ id: FILE_ID, sink: nullSink() });
    failing.subscribe((s) => snapshots.push(s));
    const failed = await failing.result;
    return {
      snapshots,
      results: [done, done.status === 'completed' && done.value, failed],
      errors: [
        failed.status === 'failed' && failed.error,
        await errorFrom(() => make().hosted.download({ id: FILE_ID } as Parameters<DropgateClient['hosted']['download']>[0])),
      ],
    };
  },
  'hosted.metadata': async (make) => ({
    snapshots: [],
    results: [await make().hosted.metadata({ id: FILE_ID })],
    errors: [await errorFrom(() => make({ failing: true }).hosted.metadata({ id: FILE_ID }))],
  }),
  'hosted.open': async (make) => {
    const snapshots: unknown[] = [];
    const opened = await make().hosted.open({ id: FILE_ID });
    const download = opened.download({ sink: nullSink() });
    snapshots.push(download.snapshot);
    download.subscribe((s) => snapshots.push(s));
    const done = await download.result;
    await opened.close();
    return {
      snapshots,
      results: [opened.metadata, done, done.status === 'completed' && done.value],
      errors: [
        await errorFrom(() => make({ failing: true }).hosted.open({ id: FILE_ID })),
        await errorFrom(() => opened.download({ sink: nullSink() })),
      ],
    };
  },
  // It resolves to nothing, so only its error has a transport to carry.
  'hosted.delete': async (make) => ({
    snapshots: [],
    results: (await make().hosted.delete({ id: FILE_ID, manageToken: MANAGE_TOKEN }), []),
    errors: [await errorFrom(() => make({ failing: true }).hosted.delete({ id: FILE_ID, manageToken: MANAGE_TOKEN }))],
  }),
  'hosted.validate': async (make) => ({
    snapshots: [],
    results: [],
    errors: [await errorFrom(() => make().hosted.validate({ files: fileNamed('a.txt'), lifetimeMs: 0, serverInfo: { version: '4.0.0' } }))],
  }),
  'direct.send': async (make) => {
    const events: unknown[] = [];
    const errors: unknown[] = [];
    const sending = make().direct.send({
      file: fileNamed('a.txt'),
      Peer: FakePeer as unknown as PeerConstructor,
      codeGenerator: () => 'ABCD-1234',
      onStatus: (e) => events.push(e),
      onError: (e) => errors.push(e),
    });
    const peer = await peerOpens('ABCD-1234');
    const session = await sending;
    // A receiver older than Dropgate 4 says hello: it's refused, through onError.
    const conn = peer.simulateConnection();
    conn.simulateOpen();
    await conn.deliver({ t: 'hello', protocolVersion: 3, sessionId: '' });
    await expect.poll(() => errors.length).toBeGreaterThan(0);
    session.stop();
    errors.push(await errorFrom(() => make({ p2p: false }).direct.send({ file: fileNamed('a.txt'), Peer: FakePeer as unknown as PeerConstructor })));
    expect(events.length, 'status events').toBeGreaterThan(0);
    return { snapshots: events, results: [session], errors };
  },
  'direct.receive': async (make) => {
    const events: unknown[] = [];
    const receiving = make().direct.receive({
      code: 'ABCD-1234',
      Peer: FakePeer as unknown as PeerConstructor,
      watchdogTimeoutMs: 0,
      onStatus: (e) => events.push(e),
    });
    const peer = await peerOpens('receiver');
    const session = await receiving;
    // The receiver's connection to the sender opens.
    peer.connections[0].simulateOpen();
    session.stop();
    const err = await errorFrom(() => make({ p2p: false }).direct.receive({ code: 'ABCD-1234', Peer: FakePeer as unknown as PeerConstructor }));
    expect(events.length, 'status events').toBeGreaterThan(0);
    return { snapshots: events, results: [session], errors: [err] };
  },
  'operations.cancelAll': async (make) => {
    const server = fakeServer();
    const slow = async (input: RequestInfo | URL, init: RequestInit = {}) =>
      new URL(String(input)).pathname === '/api/v4/uploads' ? noAnswer(init) : server.fetchFn(input, init);
    const client = make({}, slow);
    const snapshots: unknown[] = [];
    const upload = client.hosted.upload({ files: fileNamed('a.txt'), lifetimeMs: 60_000, encrypt: false });
    upload.subscribe((s) => snapshots.push(s));
    await expect.poll(() => upload.snapshot.phase).toBe('init');
    client.operations.cancelAll();
    return { snapshots, results: [await upload.result], errors: [] };
  },
};

/** A handle's own cancel() is an operation's last step, so it's checked on each handle. */
const HANDLE_CANCEL: Record<string, (client: DropgateClient) => { cancel(): void; snapshot: unknown; result: Promise<unknown> }> = {
  'hosted.upload': (client) => client.hosted.upload({ files: fileNamed('a.txt'), lifetimeMs: 60_000, encrypt: false }),
  'hosted.download': (client) => client.hosted.download({ id: FILE_ID, sink: nullSink() }),
};

/** What the client offers that isn't an operation, and so gives no snapshot, result or error of its own. */
const NOT_OPERATIONS = new Set(['server.on', 'operations.get', 'operations.list']);

describe('transport.secure on every snapshot, result and error', () => {
  it('every public method is in the table, or listed as not an operation', () => {
    const client = new DropgateClient({ server: SECURE_URL, fetchFn: fakeServer().fetchFn });
    const methods: string[] = [];
    for (const feature of ['server', 'hosted', 'direct', 'links', 'operations'] as const) {
      for (const [name, value] of Object.entries(client[feature])) {
        if (typeof value === 'function') methods.push(`${feature}.${name}`);
      }
    }
    // A feature added to the client must be added here, and so to the table.
    const features = Object.entries(client).filter(([key, value]) => !key.startsWith('_') && value && typeof value === 'object'
      && Object.values(value).some((v) => typeof v === 'function')
      && key !== 'base64').map(([key]) => key);
    expect(features.sort()).toEqual(['direct', 'hosted', 'links', 'operations', 'server']);
    const unlisted = methods.filter((m) => !(m in OPERATIONS) && !NOT_OPERATIONS.has(m));
    expect(unlisted, 'public methods with no row in the table').toEqual([]);
  });

  for (const mode of MODES) {
    describe(mode.label, () => {
      for (const [name, run] of Object.entries(OPERATIONS)) {
        it(`${name}: every snapshot, result and error has transport.secure ${mode.secure}`, async () => {
          const make = (opts: Parameters<typeof fakeServer>[0] = {}, fetchFn = fakeServer(opts).fetchFn) =>
            new DropgateClient({ server: mode.url, fetchFn, allowInsecure: !mode.secure });
          const collected = await run(make);
          const all = [...collected.snapshots, ...collected.results, ...collected.errors];
          expect(collected.results.length + collected.errors.length, 'something to check').toBeGreaterThan(0);
          for (const [i, item] of all.entries()) {
            expect(item, `item ${i}`).toBeTruthy();
            expect((item as { transport?: unknown }).transport, `item ${i}`).toEqual({ secure: mode.secure });
          }
          for (const err of collected.errors) expect(err, 'an error').toBeInstanceOf(DropgateError);
          // A serialised error keeps it, as it would be logged.
          for (const err of collected.errors) expect(JSON.parse(JSON.stringify(err)).transport).toEqual({ secure: mode.secure });
        });
      }

      for (const [name, start] of Object.entries(HANDLE_CANCEL)) {
        it(`${name}: cancel() gives a cancelled outcome and a last snapshot with transport.secure ${mode.secure}`, async () => {
          const server = fakeServer();
          const fetchFn = async (input: RequestInfo | URL, init: RequestInit = {}) =>
            new URL(String(input)).pathname === '/api/info' ? server.fetchFn(input, init) : noAnswer(init);
          const handle = start(new DropgateClient({ server: mode.url, fetchFn, allowInsecure: !mode.secure }));
          await expect.poll(() => server.requests.length).toBeGreaterThan(0);
          handle.cancel();
          const outcome = await handle.result;
          expect(outcome).toMatchObject({ status: 'cancelled', transport: { secure: mode.secure } });
          expect(handle.snapshot).toMatchObject({ status: 'cancelled', transport: { secure: mode.secure } });
        });
      }
    });
  }
});
