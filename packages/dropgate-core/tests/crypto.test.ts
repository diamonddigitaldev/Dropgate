import { describe, it, expect, vi, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { inspect } from 'node:util';
import { createCipheriv, createHmac } from 'node:crypto';
import { DropgateClient, codes } from '../src/index.js';
import { cryptoProvider, webCryptoProvider } from '../src/crypto/index.js';
import { newOperationId } from '../src/operation.js';
import { CHUNK_SIZE, fakeV4 } from './helpers/fake-v4.js';

// The crypto provider: every encrypt, decrypt, key, hash and random number
// core uses goes through it. WebCrypto today; phase 11 adds the audited
// JavaScript one where crypto.subtle is missing.

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
  });
});
