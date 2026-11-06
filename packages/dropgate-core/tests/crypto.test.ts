import { describe, it, expect, vi, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { inspect } from 'node:util';
import { createCipheriv, createHash, createHmac, createPrivateKey, createPublicKey, diffieHellman, hkdfSync } from 'node:crypto';
import * as ed25519 from '@noble/curves/ed25519.js';
import { DropgateClient, codes } from '../src/index.js';
import { cryptoProvider, webCryptoProvider } from '../src/crypto/index.js';
import { newOperationId } from '../src/operation.js';
import { CHUNK_SIZE, fakeV4 } from './helpers/fake-v4.js';
import { providerVectorChecks } from './helpers/provider-vectors.js';

// The crypto provider: every encrypt, decrypt, key, hash and random number
// core uses goes through it. WebCrypto today; the audited JavaScript one
// (@noble) follows, for where crypto.subtle is missing or has no X25519.

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const fromHex = (value: string) => new Uint8Array(Buffer.from(value, 'hex'));

/** What a page served over plain HTTP from another machine has: getRandomValues, and no subtle or randomUUID. */
const plainHttpCrypto = () => ({ getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });

afterEach(() => { vi.unstubAllGlobals(); });

describe('The WebCrypto provider', () => {
  const provider = cryptoProvider();

  it('is the one core picks, and can encrypt here', () => {
    expect(provider.name).toBe('webcrypto');
    expect(provider.canEncrypt).toBe(true);
  });

  it('seals and opens, with a fresh IV each time, and refuses anything changed', async () => {
    const key = await provider.generateKey();
    const plaintext = new TextEncoder().encode('Tax return 2025.xlsx');
    const a = await provider.encrypt(key, plaintext);
    const b = await provider.encrypt(key, plaintext);
    expect(a.byteLength).toBe(12 + plaintext.byteLength + 16);
    expect(hex(a.subarray(0, 12))).not.toBe(hex(b.subarray(0, 12)));
    expect(new TextDecoder().decode(await provider.decrypt(key, a))).toBe('Tax return 2025.xlsx');
    const changed = a.slice();
    changed[20] ^= 1;
    await expect(provider.decrypt(key, changed)).rejects.toThrow();
    await expect(provider.decrypt(await provider.generateKey(), a)).rejects.toThrow();
  });

  it('opens a NIST AES-256-GCM known answer (gcmEncryptExtIV256, count 0 with plaintext)', async () => {
    const key = await provider.importKey(fromHex('31bdadd96698c204aa9ce1448ea94ae1fb4a9a0b3c9d773b51bb1822666b8f22'));
    const iv = '0d18e06c7c725ac9e362e1ce';
    const ct = 'fa4362189661d163fcd6a56d8bf0405a';
    const tag = 'd636ac1bbedd5cc3ee727dc2ab4a9489';
    expect(hex(await provider.decrypt(key, fromHex(iv + ct + tag)))).toBe('2db5168e932556f8089a0622981d017d');
  });

  it('exports what it imports, and only takes 32-byte keys', async () => {
    const raw = provider.randomBytes(32);
    expect(hex(await provider.exportKey(await provider.importKey(raw)))).toBe(hex(raw));
    await expect(provider.importKey(new Uint8Array(16))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('keeps a key to itself: printed, logged or serialised, it shows no bytes', async () => {
    const key = await provider.generateKey();
    expect(JSON.stringify({ key })).toBe('{"key":"[ContentKey]"}');
    expect(String(key)).toBe('[ContentKey]');
    expect(inspect(key)).toBe('[ContentKey]');
    expect(Object.keys(key)).toEqual([]);
    await expect(provider.encrypt({} as never, new Uint8Array(1))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('seals under a given nonce: the NIST AES-256-GCM known answer, with no IV in front', async () => {
    const key = await provider.importKey(fromHex('31bdadd96698c204aa9ce1448ea94ae1fb4a9a0b3c9d773b51bb1822666b8f22'));
    const nonce = fromHex('0d18e06c7c725ac9e362e1ce');
    const sealed = await provider.encryptWithNonce(key, nonce, fromHex('2db5168e932556f8089a0622981d017d'));
    expect(hex(sealed)).toBe('fa4362189661d163fcd6a56d8bf0405a' + 'd636ac1bbedd5cc3ee727dc2ab4a9489');
    expect(hex(await provider.decryptWithNonce(key, nonce, sealed))).toBe('2db5168e932556f8089a0622981d017d');
    // Under another nonce, or changed, it doesn't open; a nonce is 12 bytes.
    await expect(provider.decryptWithNonce(key, new Uint8Array(12), sealed)).rejects.toThrow();
    const changed = sealed.slice();
    changed[0] ^= 1;
    await expect(provider.decryptWithNonce(key, nonce, changed)).rejects.toThrow();
    await expect(provider.encryptWithNonce(key, new Uint8Array(16), new Uint8Array(1))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('derives keys with HKDF-SHA256 (RFC 5869, test case 1), for AES-256-GCM and for HMAC-SHA256', async () => {
    const ikm = fromHex('0b'.repeat(22));
    const salt = fromHex('000102030405060708090a0b0c');
    const info = fromHex('f0f1f2f3f4f5f6f7f8f9');
    // The test case's OKM, of which a 32-byte key is the first 32 bytes.
    const okm = Buffer.from('3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf', 'hex');
    const data = new TextEncoder().encode('Dropgate');

    const macKey = await provider.deriveMacKey(ikm, salt, info);
    const mac = await provider.hmacSha256(macKey, data);
    expect(hex(mac)).toBe(createHmac('sha256', okm).update(data).digest('hex'));
    expect(await provider.verifyHmacSha256(macKey, mac, data)).toBe(true);
    const wrong = mac.slice();
    wrong[31] ^= 1;
    expect(await provider.verifyHmacSha256(macKey, wrong, data)).toBe(false);
    expect(await provider.verifyHmacSha256(macKey, mac.subarray(0, 16), data)).toBe(false);

    const contentKey = await provider.deriveContentKey(ikm, salt, info);
    const nonce = new Uint8Array(12);
    const cipher = createCipheriv('aes-256-gcm', okm, nonce);
    const expected = Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
    expect(hex(await provider.encryptWithNonce(contentKey, nonce, data))).toBe(expected.toString('hex'));
  });

  it("keeps derived keys to itself: they can't be exported, show no bytes, and each does only its own job", async () => {
    const ikm = provider.randomBytes(32);
    const salt = provider.randomBytes(16);
    const contentKey = await provider.deriveContentKey(ikm, salt, new Uint8Array(1));
    const macKey = await provider.deriveMacKey(ikm, salt, new Uint8Array(1));
    await expect(provider.exportKey(contentKey)).rejects.toThrow();
    expect(JSON.stringify({ contentKey, macKey })).toBe('{"contentKey":"[ContentKey]","macKey":"[MacKey]"}');
    expect(`${inspect(macKey)} ${String(macKey)}`).toBe('[MacKey] [MacKey]');
    expect(Object.keys(macKey)).toEqual([]);
    await expect(provider.hmacSha256(contentKey as never, new Uint8Array(1))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(provider.encryptWithNonce(macKey as never, new Uint8Array(12), new Uint8Array(1))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('hashes SHA-256 (FIPS 180-4 "abc"), and gives random bytes of any length', async () => {
    expect(hex(await provider.sha256(new TextEncoder().encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const big = provider.randomBytes(200_000);
    expect(big.byteLength).toBe(200_000);
    expect(big.subarray(150_000).some((b) => b !== 0)).toBe(true);
    expect(provider.randomUUID()).toMatch(UUID_V4);
  });
});

describe("The WebCrypto provider's operations for direct transfers", async () => {
  const provider = cryptoProvider();
  const x25519Pkcs8 = (scalar: Uint8Array) => Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), scalar]);
  const nodeX25519 = (scalar: Uint8Array, u: Uint8Array) => new Uint8Array(diffieHellman({
    privateKey: createPrivateKey({ key: x25519Pkcs8(scalar), format: 'der', type: 'pkcs8' }),
    publicKey: createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), u]), format: 'der', type: 'spki' }),
  }));

  // The same known answers the integration suite runs in Chromium, Firefox and WebKit.
  for (const { name, expected, actual } of await providerVectorChecks(provider)) {
    it(`known answer: ${name}`, () => { expect(actual).toBe(expected); });
  }

  it('hashes SHA-512, HMACs with SHA-256 and SHA-512 and derives HKDF bytes as node:crypto does, on random inputs', async () => {
    for (let round = 0; round < 20; round++) {
      const key = provider.randomBytes(1 + round * 7);
      const data = provider.randomBytes(round * 37);
      const salt = provider.randomBytes(round % 3 === 0 ? 0 : 32);
      expect(hex(await provider.sha512(data))).toBe(createHash('sha512').update(data).digest('hex'));
      expect(hex(await provider.hmac('SHA-256', key, data))).toBe(createHmac('sha256', key).update(data).digest('hex'));
      expect(hex(await provider.hmac('SHA-512', key, data))).toBe(createHmac('sha512', key).update(data).digest('hex'));
      expect(hex(await provider.hkdf(key, salt, data, 16 + round))).toBe(Buffer.from(hkdfSync('sha256', key, salt, data, 16 + round)).toString('hex'));
    }
    await expect(provider.hmac('SHA-1' as never, new Uint8Array(1), new Uint8Array(0))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(provider.hmac('SHA-256', new Uint8Array(0), new Uint8Array(0))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    for (const length of [0, 8161, 1.5]) {
      await expect(provider.hkdf(new Uint8Array(32), new Uint8Array(0), new Uint8Array(0), length)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    expect((await provider.hkdf(new Uint8Array(32), new Uint8Array(0), new Uint8Array(0), 8160)).byteLength).toBe(8160);
  });

  it('seals with associated data as node:crypto does, and with none exactly as before', async () => {
    const raw = provider.randomBytes(32);
    const key = await provider.importKey(raw);
    const nonce = provider.randomBytes(12);
    const plaintext = provider.randomBytes(100);
    const ad = provider.randomBytes(23);
    const cipher = createCipheriv('aes-256-gcm', raw, nonce).setAAD(ad);
    const expected = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]).toString('hex');
    const sealed = await provider.encryptWithNonce(key, nonce, plaintext, ad);
    expect(hex(sealed)).toBe(expected);
    expect(hex(await provider.decryptWithNonce(key, nonce, sealed, ad))).toBe(hex(plaintext));
    // Without the associated data, or with none, it doesn't open; an empty one is no associated data.
    await expect(provider.decryptWithNonce(key, nonce, sealed)).rejects.toThrow();
    const plain = createCipheriv('aes-256-gcm', raw, nonce);
    const withNone = Buffer.concat([plain.update(plaintext), plain.final(), plain.getAuthTag()]).toString('hex');
    expect(hex(await provider.encryptWithNonce(key, nonce, plaintext))).toBe(withNone);
    expect(hex(await provider.encryptWithNonce(key, nonce, plaintext, new Uint8Array(0)))).toBe(withNone);
  });

  it('compares bytes: equal only when the same length and the same bytes', () => {
    const a = provider.randomBytes(64);
    expect(provider.equal(a, a.slice())).toBe(true);
    expect(provider.equal(new Uint8Array(0), new Uint8Array(0))).toBe(true);
    for (const at of [0, 31, 63]) {
      const b = a.slice();
      b[at] ^= 0x80;
      expect(provider.equal(a, b)).toBe(false);
    }
    expect(provider.equal(a, a.subarray(0, 63))).toBe(false);
  });

  it('generates X25519 keys whose exchange agrees, and matches node:crypto for any point', async () => {
    const alice = await provider.x25519Generate();
    const bob = await provider.x25519Generate();
    expect(alice.publicKey.byteLength).toBe(32);
    expect(hex(await provider.x25519(alice.privateKey, bob.publicKey))).toBe(hex(await provider.x25519(bob.privateKey, alice.publicKey)));
    for (let round = 0; round < 20; round++) {
      const scalar = provider.randomBytes(32);
      const u = provider.randomBytes(32);
      const ours = await provider.x25519(await provider.x25519FromScalar(scalar), u).then(hex, (err) => err.code);
      let theirs: string;
      try {
        theirs = hex(nodeX25519(scalar, u));
      } catch {
        theirs = 'INVALID_ARGUMENT';
      }
      expect(ours).toBe(theirs);
    }
  });

  it('keeps an X25519 private key to itself: printed, logged or serialised, it shows no bytes', async () => {
    const { privateKey } = await provider.x25519Generate();
    const fixed = await provider.x25519FromScalar(provider.randomBytes(32));
    for (const key of [privateKey, fixed]) {
      expect(JSON.stringify({ key })).toBe('{"key":"[X25519Key]"}');
      expect(`${String(key)} ${inspect(key)}`).toBe('[X25519Key] [X25519Key]');
      expect(Object.keys(key)).toEqual([]);
    }
    const contentKey = await provider.generateKey();
    await expect(provider.x25519(contentKey as never, new Uint8Array(32).fill(9))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(provider.encryptWithNonce(privateKey as never, new Uint8Array(12), new Uint8Array(1))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('refuses an X25519 point or scalar of the wrong length, and an all-zero result', async () => {
    const { privateKey } = await provider.x25519Generate();
    for (const length of [0, 31, 33]) {
      await expect(provider.x25519(privateKey, new Uint8Array(length))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(provider.x25519FromScalar(new Uint8Array(length))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    // u = 0 and u = 1 are low-order points (CPace's B.1.10 has the rest).
    await expect(provider.x25519(privateKey, new Uint8Array(32))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: expect.stringContaining('low-order') });
    await expect(provider.x25519(privateKey, Uint8Array.of(1, ...new Uint8Array(31)))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it("refuses an all-zero result itself, whether an engine's WebCrypto hands one back or refuses it", async () => {
    // The low-order points are refused before WebCrypto sees them, so these
    // engines are made up: one handing back zeros, one refusing as WebCrypto does.
    const subtle = globalThis.crypto.subtle;
    const withDeriveBits = (deriveBits: SubtleCrypto['deriveBits']) => webCryptoProvider({
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
      subtle: new Proxy(subtle, { get: (target, prop) => (prop === 'deriveBits' ? deriveBits : Reflect.get(target, prop, target).bind(target)) }),
    });
    for (const deriveBits of [
      async () => new ArrayBuffer(32),
      async () => { throw new DOMException('The operation failed for an operation-specific reason', 'OperationError'); },
    ]) {
      const engine = withDeriveBits(deriveBits);
      const { privateKey } = await engine.x25519Generate();
      await expect(engine.x25519(privateKey, new Uint8Array(32).fill(9))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: expect.stringContaining('low-order') });
    }
    // Any other refusal is passed on as it is.
    const other = withDeriveBits(async () => { throw new DOMException('Not supported', 'NotSupportedError'); });
    const { privateKey } = await other.x25519Generate();
    await expect(other.x25519(privateKey, new Uint8Array(32).fill(9))).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  it('reads a u-coordinate as RFC 7748 says (bit 255 ignored, reduced mod p) before WebCrypto sees it', async () => {
    const seen: Uint8Array[] = [];
    const subtle = globalThis.crypto.subtle;
    const watched = webCryptoProvider({
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
      subtle: new Proxy(subtle, {
        get: (target, prop) => (prop === 'importKey'
          ? (format: string, data: BufferSource, ...rest: unknown[]) => {
            if (format === 'raw') seen.push(new Uint8Array(data as ArrayBuffer));
            return (target.importKey as (...args: unknown[]) => Promise<CryptoKey>)(format, data, ...rest);
          }
          : Reflect.get(target, prop, target).bind(target)),
      }),
    });
    const scalar = await watched.x25519FromScalar(provider.randomBytes(32));
    const p = Uint8Array.of(0xed, ...new Uint8Array(30).fill(0xff), 0x7f);
    // p + 9, and 9 with bit 255 set, are both 9.
    const plus9 = p.slice();
    plus9[0] += 9;
    const high9 = Uint8Array.of(9, ...new Uint8Array(30), 0x80);
    const nine = hex(await watched.x25519(scalar, Uint8Array.of(9, ...new Uint8Array(31))));
    expect(hex(await watched.x25519(scalar, plus9))).toBe(nine);
    expect(hex(await watched.x25519(scalar, high9))).toBe(nine);
    expect(seen.map(hex)).toEqual(Array(3).fill(hex(Uint8Array.of(9, ...new Uint8Array(31)))));
  });

  it("maps with @noble/curves' Elligator 2, whose pinned version still exports it by that name", async () => {
    // An "experimental" name in @noble/curves 2.4.0. If a package sweep finds it
    // renamed, src/crypto/elligator.ts's import changes with it.
    expect(typeof ed25519._map_to_curve_elligator2_curve25519).toBe('function');

    // The same as the CPace draft's own reference map (Appendix A.5), written
    // here in plain BigInt arithmetic from the draft and not from @noble.
    const p = (1n << 255n) - 19n;
    const A = 486662n;
    const modP = (n: bigint) => ((n % p) + p) % p;
    const pow = (base: bigint, exp: bigint) => {
      let result = 1n;
      for (base = modP(base); exp > 0n; exp >>= 1n, base = modP(base * base)) if (exp & 1n) result = modP(result * base);
      return result;
    };
    const inv = (n: bigint) => pow(n, p - 2n);
    const reference = (bytes: Uint8Array) => {
      const r = BigInt(`0x${hex(bytes.slice().reverse())}`) & ((1n << 255n) - 1n);
      const v = modP(-A * inv(1n + 2n * r * r));
      const epsilon = pow(v * v * v + A * v * v + v, (p - 1n) / 2n);
      const x = modP(epsilon * v - (1n - epsilon) * A * inv(2n));
      return x.toString(16).padStart(64, '0').match(/../g)!.reverse().join('');
    };
    for (let round = 0; round < 50; round++) {
      const u = provider.randomBytes(32);
      expect(hex(provider.elligator2(u))).toBe(reference(u));
    }
    for (const u of [new Uint8Array(32), new Uint8Array(32).fill(0xff), Uint8Array.of(1, ...new Uint8Array(31))]) {
      expect(hex(provider.elligator2(u))).toBe(reference(u));
    }
    // Bit 255 is ignored, as RFC 7748 decodes a u-coordinate.
    const u = provider.randomBytes(32);
    const high = u.slice();
    high[31] |= 0x80;
    u[31] &= 0x7f;
    expect(hex(provider.elligator2(high))).toBe(hex(provider.elligator2(u)));
    expect(() => provider.elligator2(new Uint8Array(31))).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});

describe('On a page served over plain HTTP (no crypto.subtle, no randomUUID)', () => {
  const provider = webCryptoProvider(plainHttpCrypto());

  it("can't encrypt, but random bytes, UUIDs and hashes still work", async () => {
    expect(provider.canEncrypt).toBe(false);
    expect(provider.randomBytes(16).byteLength).toBe(16);
    const ids = Array.from({ length: 50 }, () => provider.randomUUID());
    for (const id of ids) expect(id).toMatch(UUID_V4);
    expect(new Set(ids).size).toBe(50);
    const data = cryptoProvider().randomBytes(10_000);
    expect(hex(await provider.sha256(data))).toBe(hex(await cryptoProvider().sha256(data)));
    await expect(provider.generateKey()).rejects.toMatchObject({ code: 'RUNTIME_UNSUPPORTED' });
    await expect(provider.deriveContentKey(new Uint8Array(32), new Uint8Array(16), new Uint8Array(1))).rejects.toMatchObject({ code: 'RUNTIME_UNSUPPORTED' });
    await expect(provider.deriveMacKey(new Uint8Array(32), new Uint8Array(16), new Uint8Array(1))).rejects.toMatchObject({ code: 'RUNTIME_UNSUPPORTED' });
  });

  it("can't do a direct transfer's crypto either (until the JavaScript provider), but the map is JavaScript and works", async () => {
    const none = new Uint8Array(32);
    for (const run of [
      () => provider.sha512(none), () => provider.hmac('SHA-512', none, none), () => provider.hkdf(none, none, none, 32),
      () => provider.x25519Generate(),
    ]) {
      await expect(run()).rejects.toMatchObject({ code: 'RUNTIME_UNSUPPORTED' });
    }
    expect(provider.equal(none, none)).toBe(true);
    expect(hex(provider.elligator2(none))).toBe(hex(cryptoProvider().elligator2(none)));
  });

  it('codes, operation IDs and an unencrypted upload work; an encrypted one fails RUNTIME_UNSUPPORTED', async () => {
    vi.stubGlobal('crypto', plainHttpCrypto());
    expect(codes.generate()).toMatch(/^[A-Z]{4}-\d{4}$/);
    expect(newOperationId()).toMatch(UUID_V4);

    const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
    const v4 = fakeV4();
    const fetchFn = async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/info') {
        return json({
          version: '4.0.0', protocols: { dgup: { major: 4, minor: 0 }, dgdtp: { major: 4, minor: 0 } },
          capabilities: { upload: { enabled: true, maxSizeMB: 0, maxLifetimeHours: 0, e2ee: true, chunkSize: CHUNK_SIZE } },
        });
      }
      return (await v4.handle(init.method ?? 'GET', path, init)) ?? json({});
    };
    const client = new DropgateClient({ server: 'http://192.168.1.10', allowInsecure: true, fetchFn });
    const files = new File([new Uint8Array(10).fill(1)], 'a.txt');
    expect((await client.hosted.upload({ files, lifetimeMs: 60_000, encrypt: false }).result).status).toBe('completed');
    expect(v4.objects.size, 'uploads stored').toBe(1);
    const encrypted = await client.hosted.upload({ files, lifetimeMs: 60_000, encrypt: true }).result;
    expect(encrypted.status === 'failed' && encrypted.error.code).toBe('RUNTIME_UNSUPPORTED');
  });
});

describe('With no secure random numbers at all', () => {
  it('refuses to make a client or a code, and never falls back to Math.random()', () => {
    vi.stubGlobal('crypto', undefined);
    const random = vi.spyOn(Math, 'random');
    expect(() => new DropgateClient({ server: 'https://files.example', fetchFn: async () => new Response() }))
      .toThrow(expect.objectContaining({ code: 'RUNTIME_UNSUPPORTED' }));
    expect(() => codes.generate()).toThrow(expect.objectContaining({ code: 'RUNTIME_UNSUPPORTED' }));
    expect(random).not.toHaveBeenCalled();
  });
});

describe('One provider', () => {
  it('nothing in core outside src/crypto/ uses crypto, or Math.random(), itself', () => {
    const root = join(__dirname, '..', 'src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.ts')) files.push(path);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(20);
    const direct = /globalThis\.crypto|\bcrypto\.(subtle|getRandomValues|randomUUID)\b|\.subtle\b|getRandomValues\(|Math\.random\(/;
    const offenders = files
      .filter((path) => !relative(root, path).startsWith('crypto'))
      .filter((path) => readFileSync(path, 'utf8').split('\n').some((line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && direct.test(line)))
      .map((path) => relative(root, path));
    expect(offenders).toEqual([]);

    // And @noble/curves comes in through one file, so a rename touches only it.
    const noble = files
      .filter((path) => /from\s+['"]@noble\//.test(readFileSync(path, 'utf8')))
      .map((path) => relative(root, path).replace(/\\/g, '/'));
    expect(noble).toEqual(['crypto/elligator.ts']);
  });
});
