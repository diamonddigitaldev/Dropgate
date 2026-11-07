import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cryptoProvider, type CryptoProvider } from '../src/crypto/index.js';
import { nobleProvider } from '../src/crypto/noble.js';
import { createObject, openObject } from '../src/object/index.js';
import { calculateGenerator, deriveIsk, newShare, transcriptIr } from '../src/dgdtp/cpace.js';

// 09 7.1.11: core chooses its crypto provider once per runtime: WebCrypto when
// crypto.subtle exists and makes an X25519 key, else @noble, for every
// operation, never a mix. In Node (and a secure page in the supported
// browsers) that's always WebCrypto, which spies on crypto.subtle and on
// @noble's provider show.

// The @noble provider as it is, but counted: core must never make one where
// WebCrypto has X25519.
vi.mock('../src/crypto/noble.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/crypto/noble.js')>();
  return { ...actual, nobleProvider: vi.fn(actual.nobleProvider) };
});

const made = vi.mocked(nobleProvider);
const { getRandomValues } = globalThis.crypto;
const random = getRandomValues.bind(globalThis.crypto);

/** What a page served over plain HTTP from another machine has: getRandomValues, and no subtle. */
const plainHttpCrypto = () => ({ getRandomValues: random });

/** Every call this runtime's crypto.subtle is asked, by method; with `x25519: false`, one that can't make an X25519 key. */
function watchedCrypto({ x25519 }: { x25519: boolean }) {
  const subtle = globalThis.crypto.subtle;
  const calls: string[] = [];
  const watched = new Proxy(subtle, {
    get: (target, prop) => {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        calls.push(String(prop));
        const algorithm = args[prop === 'importKey' ? 2 : 0] as { name?: string } | string | undefined;
        const named = typeof algorithm === 'string' ? algorithm : algorithm?.name;
        if (!x25519 && named === 'X25519') return Promise.reject(new DOMException('Not supported', 'NotSupportedError'));
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { crypto: { getRandomValues: random, randomUUID: () => globalThis.crypto.randomUUID(), subtle: watched }, calls };
}

/** One of everything the provider does: an object sealed and opened, CPace both ways, and each hash, MAC and KDF. */
async function everything(provider: CryptoProvider) {
  const writer = await createObject(provider, { files: [{ name: 'a.txt', size: 3 }], chunkSize: 64 * 1024 });
  const plaintext = new Uint8Array(writer.layout.chunkLength(0));
  plaintext.set([1, 2, 3]);
  const chunk = await writer.seal(0, plaintext);
  const opened = await openObject(provider, {
    secret: writer.secret(), header: writer.header, meta: writer.meta, size: writer.header.byteLength + chunk.byteLength,
  });
  const read: Uint8Array[] = [];
  for await (const piece of opened.read([writer.header, chunk])) read.push(piece.plaintext);
  expect(read.map((bytes) => Array.from(bytes.subarray(0, 3)))).toEqual([[1, 2, 3]]);

  const sid = provider.randomBytes(16);
  const g = await calculateGenerator(provider, new TextEncoder().encode('CD1234'), new Uint8Array(1), sid);
  const [a, b] = [await newShare(provider, g), await newShare(provider, g)];
  const transcript = transcriptIr(a.share, new Uint8Array(1), b.share, new Uint8Array(1));
  const isk = await deriveIsk(provider, { scalar: a.scalar, peerShare: b.share, sid, transcript });
  expect(provider.equal(isk, await deriveIsk(provider, { scalar: b.scalar, peerShare: a.share, sid, transcript }))).toBe(true);

  const key = await provider.generateKey();
  await provider.decrypt(key, await provider.encrypt(key, new Uint8Array(5)));
  await provider.exportKey(await provider.importKey(provider.randomBytes(32)));
  await provider.sha256(new Uint8Array(1));
  await provider.hmac('SHA-256', new Uint8Array(1), new Uint8Array(1));
  await provider.hkdf(new Uint8Array(1), new Uint8Array(0), new Uint8Array(0), 32);
  await provider.x25519FromScalar(provider.randomBytes(32));
}

beforeEach(() => { made.mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('09 7.1.11: choosing the provider', () => {
  it('in Node, chooses WebCrypto, and every operation is WebCrypto: never @noble', async () => {
    const provider = cryptoProvider();
    expect((await provider.chosen()).name).toBe('webcrypto');
    const subtle = globalThis.crypto.subtle;
    const spies = (['encrypt', 'decrypt', 'digest', 'sign', 'verify', 'deriveBits', 'deriveKey', 'importKey', 'generateKey'] as const)
      .map((method) => vi.spyOn(subtle, method));
    await everything(provider);
    for (const spy of spies) expect(spy, spy.getMockName()).toHaveBeenCalled();
    expect(made, '@noble providers made').not.toHaveBeenCalled();
  });

  it('chooses once per runtime: the same provider every time, one probe however many operations wait for it', async () => {
    const { crypto, calls } = watchedCrypto({ x25519: true });
    vi.stubGlobal('crypto', crypto);
    const provider = cryptoProvider();
    expect(cryptoProvider()).toBe(provider);
    // Many operations at once, before anything is chosen, wait for the one choice.
    await Promise.all(Array.from({ length: 10 }, () => provider.sha256(new Uint8Array(1))));
    await everything(cryptoProvider());
    const probes = calls.filter((call, i) => call === 'generateKey' && i === calls.indexOf('generateKey'));
    expect(probes).toHaveLength(1);
    expect(calls[0], 'the probe comes first').toBe('generateKey');
    expect(await provider.chosen()).toBe(await cryptoProvider().chosen());
    expect(made).not.toHaveBeenCalled();
  });

  it('with no crypto.subtle (a page served over plain HTTP from another machine), chooses @noble, which encrypts there', async () => {
    vi.stubGlobal('crypto', plainHttpCrypto());
    const provider = cryptoProvider();
    expect(provider.canEncrypt).toBe(true);
    expect((await provider.chosen()).name).toBe('noble');
    await everything(provider);
    expect(made).toHaveBeenCalledTimes(1);
  });

  it("with a crypto.subtle that can't make an X25519 key, chooses @noble for every operation: nothing more reaches crypto.subtle", async () => {
    const { crypto, calls } = watchedCrypto({ x25519: false });
    vi.stubGlobal('crypto', crypto);
    const provider = cryptoProvider();
    expect((await provider.chosen()).name).toBe('noble');
    expect(calls, 'only the probe').toEqual(['generateKey']);
    await everything(provider);
    expect(calls, 'only the probe, after everything').toEqual(['generateKey']);
    expect(made).toHaveBeenCalledTimes(1);
  });

  it('a probe that throws as it is called, rather than rejecting, chooses @noble too', async () => {
    const subtle = new Proxy(globalThis.crypto.subtle, {
      get: (target, prop) => (prop === 'generateKey' ? () => { throw new TypeError('Unknown algorithm'); } : Reflect.get(target, prop, target)),
    });
    vi.stubGlobal('crypto', { getRandomValues: random, subtle });
    expect((await cryptoProvider().chosen()).name).toBe('noble');
  });

  it("random numbers come from getRandomValues() before any choice, and @noble's keys too; Math.random() never", async () => {
    const mathRandom = vi.spyOn(Math, 'random');
    for (const crypto of [plainHttpCrypto(), watchedCrypto({ x25519: false }).crypto, watchedCrypto({ x25519: true }).crypto]) {
      const counted = vi.fn(random);
      vi.stubGlobal('crypto', { ...crypto, getRandomValues: counted });
      const provider = cryptoProvider();
      expect(provider.randomBytes(70_000).byteLength).toBe(70_000);
      expect(counted).toHaveBeenCalledTimes(2);
      const { name } = await provider.chosen();
      await provider.generateKey();
      await provider.x25519Generate();
      // WebCrypto makes its own keys from the same system source; @noble's come from getRandomValues().
      if (name === 'noble') expect(counted).toHaveBeenCalledTimes(4);
      else expect(counted).toHaveBeenCalledTimes(2);
    }
    expect(mathRandom).not.toHaveBeenCalled();
  });
});
