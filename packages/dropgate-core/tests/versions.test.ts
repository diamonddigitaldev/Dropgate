import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DropgateClient, DropgateError } from '../src/index.js';
import type { PeerConstructor } from '../src/index.js';
import { P2P_PROTOCOL_VERSION } from '../src/p2p/index.js';

// Hard requirement 6: core knows its own version and its protocol versions,
// and works out with each server whether they work together, each protocol on
// its own. Nobody types a version in; an app's own name and version
// (`appInfo`) are for display and its logs only.

const BASE_URL = 'https://files.example';
const FILE_ID = '0b7d4c52-5f0e-4d8e-9a57-3c1f2e6b8a90';
const { version: PACKAGE_VERSION } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const json = (status: number, value: unknown): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

/** A fake server whose /api/info gives `info`, recording every request in full. */
function serverGiving(info: Record<string, unknown>) {
  const requests: Array<{ url: string; headers: string; body: string }> = [];
  const fetchFn = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    requests.push({ url, headers: JSON.stringify(init.headers ?? {}), body: typeof init.body === 'string' ? init.body : '' });
    const path = new URL(url).pathname;
    if (path === '/api/info') return json(200, info);
    if (path === `/api/file/${FILE_ID}/meta`) return json(200, { isEncrypted: false, sizeBytes: 4, filename: 'notes.txt' });
    if (path === '/api/resolve') return json(200, { valid: true, type: 'file', target: `/${FILE_ID}` });
    return json(404, { error: 'Not found.' });
  };
  return { fetchFn, requests };
}

const CAPABILITIES = {
  upload: { enabled: true, maxSizeMB: 0, maxLifetimeHours: 0, e2ee: true, chunkSize: 4 },
  p2p: { enabled: true, peerjsPath: '/peerjs', iceServers: [] },
};
const v = (major: number, minor = 0) => ({ major, minor });
const infoWith = (protocols: unknown, version = '4.0.0') => ({ name: 'Test server', version, protocols, capabilities: CAPABILITIES });

describe('Core knows its own versions', () => {
  it("DropgateClient.version is the package's version, written in by the build", () => {
    expect(DropgateClient.version).toBe(PACKAGE_VERSION);
  });

  it('DropgateClient.protocols gives DGUP and DGDTP, each its own major and minor, and nothing can change them', () => {
    expect(DropgateClient.protocols).toEqual({ dgup: v(4), dgdtp: v(4) });
    expect(Object.isFrozen(DropgateClient.protocols)).toBe(true);
    expect(Object.isFrozen(DropgateClient.protocols.dgup)).toBe(true);
    expect(Object.isFrozen(DropgateClient.protocols.dgdtp)).toBe(true);
  });

  it("a direct transfer's hello carries the DGDTP major", () => {
    expect(P2P_PROTOCOL_VERSION).toBe(DropgateClient.protocols.dgdtp.major);
  });

  it('a client is made without any version: clientVersion is gone, and passing it changes nothing', async () => {
    const server = serverGiving(infoWith({ dgup: v(4), dgdtp: v(4) }));
    const options = { server: BASE_URL, fetchFn: server.fetchFn, clientVersion: '3.0.13' };
    const client = new DropgateClient(options as ConstructorParameters<typeof DropgateClient>[0]);
    expect('clientVersion' in client).toBe(false);
    expect((await client.server.connect()).dgup.compatible).toBe(true);
    expect(server.requests.map((r) => r.url + r.headers + r.body).join('\n')).not.toContain('3.0.13');
  });
});

describe('Version negotiation', () => {
  it('the same majors work together, for both protocols', async () => {
    const client = new DropgateClient({ server: BASE_URL, fetchFn: serverGiving(infoWith({ dgup: v(4), dgdtp: v(4) })).fetchFn });
    const connection = await client.server.connect();
    expect(connection.dgup).toEqual({ compatible: true, client: v(4), server: v(4), message: expect.any(String) });
    expect(connection.dgdtp).toEqual({ compatible: true, client: v(4), server: v(4), message: expect.any(String) });
    expect(connection.serverVersion).toBe('4.0.0');
    await expect(client.hosted.metadata({ fileId: FILE_ID })).resolves.toMatchObject({ name: 'notes.txt' });
  });

  it('a different minor still works, newer or older', async () => {
    for (const minor of [0, 3]) {
      const client = new DropgateClient({ server: BASE_URL, fetchFn: serverGiving(infoWith({ dgup: v(4, minor), dgdtp: v(4, minor + 1) })).fetchFn });
      const connection = await client.server.connect();
      expect(connection.dgup.compatible && connection.dgdtp.compatible, `server minors ${minor}, ${minor + 1}`).toBe(true);
    }
  });

  it("the server's own version doesn't count: only its protocols do", async () => {
    // A v3 server's version with v4 protocols works; a v4 version with no protocols doesn't.
    const old = new DropgateClient({ server: BASE_URL, fetchFn: serverGiving(infoWith({ dgup: v(4), dgdtp: v(4) }, '3.0.13')).fetchFn });
    expect((await old.server.connect()).dgup.compatible).toBe(true);
    const unsaid = new DropgateClient({ server: BASE_URL, fetchFn: serverGiving(infoWith(undefined, '4.0.0')).fetchFn });
    expect((await unsaid.server.connect()).dgup.compatible).toBe(false);
  });

  it('a server older than Dropgate 4, which gives no protocols, is refused for everything: the server needs updating', async () => {
    const server = serverGiving({ name: 'Old server', version: '3.0.13', capabilities: CAPABILITIES });
    const client = new DropgateClient({ server: BASE_URL, fetchFn: server.fetchFn });

    const connection = await client.server.connect();
    for (const protocol of ['dgup', 'dgdtp'] as const) {
      expect(connection[protocol]).toEqual({
        compatible: false, client: v(4), server: null, update: 'server', message: expect.stringMatching(/^Update required: .*operator/),
      });
    }

    const err = await client.hosted.metadata({ fileId: FILE_ID }).catch((e: unknown) => e);
    expect(DropgateError.is(err, 'VERSION_UNSUPPORTED')).toBe(true);
    expect((err as DropgateError).details).toEqual({ component: 'dgup', update: 'server', client: v(4), server: null });
    expect((err as DropgateError).message).toBe(connection.dgup.message);

    const upload = await client.hosted.upload({ files: new File([new Uint8Array(4)], 'a.txt'), lifetimeMs: 60_000 }).result;
    expect(upload.status === 'failed' && upload.error.code).toBe('VERSION_UNSUPPORTED');
    await expect(client.links.resolve(FILE_ID)).rejects.toMatchObject({ code: 'VERSION_UNSUPPORTED' });
    await expect(client.direct.receive({ code: 'ABCD-1234', Peer: class {} as unknown as PeerConstructor }))
      .rejects.toMatchObject({ code: 'VERSION_UNSUPPORTED', details: { component: 'dgdtp', update: 'server' } });

    // Nothing but the server's info was asked for.
    expect(server.requests.map((r) => new URL(r.url).pathname)).toEqual(['/api/info']);
  });

  it('an older major is refused the same way; a newer one says this app needs updating', async () => {
    const older = new DropgateClient({ server: BASE_URL, fetchFn: serverGiving(infoWith({ dgup: v(3), dgdtp: v(3) })).fetchFn });
    expect((await older.server.connect()).dgup).toMatchObject({ compatible: false, server: v(3), update: 'server' });

    const newer = new DropgateClient({ server: BASE_URL, fetchFn: serverGiving(infoWith({ dgup: v(5), dgdtp: v(5) })).fetchFn });
    const connection = await newer.server.connect();
    expect(connection.dgup).toMatchObject({ compatible: false, server: v(5), update: 'client', message: expect.stringMatching(/^Update required: .*Update this app/) });
    await expect(newer.hosted.metadata({ fileId: FILE_ID })).rejects.toMatchObject({
      code: 'VERSION_UNSUPPORTED', details: { component: 'dgup', update: 'client' },
    });
  });

  it('each protocol is negotiated on its own: hosted transfers work while direct ones need an update', async () => {
    const client = new DropgateClient({ server: BASE_URL, fetchFn: serverGiving(infoWith({ dgup: v(4), dgdtp: v(5) })).fetchFn });
    const connection = await client.server.connect();
    expect(connection.dgup.compatible).toBe(true);
    expect(connection.dgdtp).toMatchObject({ compatible: false, update: 'client' });

    await expect(client.hosted.metadata({ fileId: FILE_ID })).resolves.toMatchObject({ name: 'notes.txt' });
    await expect(client.direct.receive({ code: 'ABCD-1234', Peer: class {} as unknown as PeerConstructor }))
      .rejects.toMatchObject({ code: 'VERSION_UNSUPPORTED', details: { component: 'dgdtp' } });
  });

  it.each([
    ['strings', { dgup: '4.0', dgdtp: '4' }],
    ['numbers', { dgup: 4, dgdtp: 4 }],
    ['fractions', { dgup: v(4.5), dgdtp: { major: 4, minor: 0.5 } }],
    ['negatives', { dgup: v(-4), dgdtp: { major: 4, minor: -1 } }],
    ['nothing usable', 'v4'],
  ])('protocols the server gives as %s count as none given', async (_, protocols) => {
    const client = new DropgateClient({ server: BASE_URL, fetchFn: serverGiving(infoWith(protocols)).fetchFn });
    const connection = await client.server.connect();
    expect(connection.dgup).toMatchObject({ compatible: false, server: null, update: 'server' });
    expect(connection.dgdtp).toMatchObject({ compatible: false, server: null, update: 'server' });
  });
});

describe('appInfo', () => {
  it("is kept as given, frozen, for the app's display and logs, and never sent anywhere", async () => {
    const server = serverGiving(infoWith({ dgup: v(4), dgdtp: v(4) }));
    const appInfo = { name: 'Zebra Uploader', version: '9.8.7' };
    const client = new DropgateClient({ server: BASE_URL, fetchFn: server.fetchFn, appInfo });
    expect(client.appInfo).toEqual(appInfo);
    expect(client.appInfo).not.toBe(appInfo);
    expect(Object.isFrozen(client.appInfo)).toBe(true);

    await client.server.connect();
    await client.hosted.metadata({ fileId: FILE_ID });
    await client.links.resolve(FILE_ID);
    const sent = server.requests.map((r) => r.url + r.headers + r.body).join('\n');
    expect(sent).not.toContain('Zebra');
    expect(sent).not.toContain('9.8.7');
  });

  it('is optional, and its version too', () => {
    expect(new DropgateClient({ server: BASE_URL }).appInfo).toBeUndefined();
    expect(new DropgateClient({ server: BASE_URL, appInfo: { name: 'Dropgate Client' } }).appInfo).toEqual({ name: 'Dropgate Client' });
  });

  it.each([
    ['a string', 'Dropgate Client 4.0.0'],
    ['null', null],
    ['no name', { version: '1.0.0' }],
    ['an empty name', { name: '  ' }],
    ['a number for its version', { name: 'App', version: 4 }],
  ])('given as %s is refused with INVALID_ARGUMENT', (_, appInfo) => {
    const options = { server: BASE_URL, appInfo };
    expect(() => new DropgateClient(options as unknown as ConstructorParameters<typeof DropgateClient>[0]))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});
