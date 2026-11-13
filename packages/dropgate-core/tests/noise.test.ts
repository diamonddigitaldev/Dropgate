import { describe, it, expect } from 'vitest';
import { createCipheriv, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { build } from 'esbuild';
import cacophony from './fixtures/noise-cacophony-vector.json';
import rekeyFixture from './fixtures/noise-rekey-vectors.json';
import { nobleProvider, webCryptoProvider, type CryptoProvider, type NamedCryptoProvider } from '../src/crypto/index.js';
import {
  NOISE_MAX_HANDSHAKE_PAYLOAD_BYTES, NOISE_MAX_MESSAGE_BYTES, NOISE_MAX_RECORD_PLAINTEXT_BYTES, NOISE_PROTOCOL_NAME, NOISE_REKEY_INTERVAL,
  noiseInitiator, noiseResponder, setNonceForTests, type NoiseOptions, type NoiseTransport,
} from '../src/dgdtp/noise.js';
import { fromHex, hex } from './helpers/cpace-vectors.js';
import { cacophonySides, flipped, noiseVectorChecks } from './helpers/noise-vectors.js';
// The second implementation: plain JavaScript on node:crypto.
import * as reference from './helpers/reference-noise.mjs';
import { testBuildDefine } from '../scripts/test-build-define.mjs';
import { versionDefine } from '../scripts/version-define.mjs';

// Core's Noise_NNpsk0_25519_AESGCM_SHA256 (src/dgdtp/noise.ts) on each of
// core's crypto providers. Cacophony's published vector for this exact name;
// Dropgate's own rekey vectors from a second implementation on node:crypto
// (tests/helpers/reference-noise.mjs), written from the Noise spec and
// Dropgate's rules for it, not from core; the limits, every flipped bit
// refused, the nonce's end; a handshake with one side on each provider. These tests run as a test build (vitest.config.ts), which
// may pin ephemerals and lower the rekey interval; core's builds can't.

const webCrypto = webCryptoProvider(globalThis.crypto);
const noble = nobleProvider(globalThis.crypto);
const PROVIDERS: Array<[string, NamedCryptoProvider]> = [['WebCrypto', webCrypto], ['@noble', noble]];
const MISMATCH = 'SECURITY_POLICY_MISMATCH';

/** 4 zero bytes, then `n` as 8 bytes big-endian: Noise's AES-GCM nonce. */
const nonceOf = (n: number | bigint) => {
  const iv = Buffer.alloc(12);
  iv.writeBigUInt64BE(BigInt(n), 4);
  return iv;
};
/** AES-256-GCM on node:crypto, no associated data: a record as Noise seals it. */
const nodeSeal = (key: string, n: number | bigint, plaintext: Uint8Array) => {
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), nonceOf(n));
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]).toString('hex');
};

const prologue = new TextEncoder().encode('a prologue');
const psk = () => fromHex('11'.repeat(32));

/** A handshake between `a` (the initiator) and `b`, with `options`' extras, carried through: both transports. */
async function handshake(a: CryptoProvider, b: CryptoProvider, extra: { initiator?: Partial<NoiseOptions>; responder?: Partial<NoiseOptions>; payload2?: Uint8Array } = {}) {
  const initiator = noiseInitiator(a, { prologue, psk: psk(), ...extra.initiator });
  const responder = noiseResponder(b, { prologue, psk: psk(), ...extra.responder });
  const message1 = await initiator.writeMessage1();
  expect(message1.byteLength).toBe(48);
  expect((await responder.readMessage1(message1)).byteLength).toBe(0);
  const { message: message2, transport: responderTransport } = await responder.writeMessage2(extra.payload2);
  const { payload, transport: initiatorTransport } = await initiator.readMessage2(message2);
  return { message1, message2, payload, initiatorTransport, responderTransport };
}

/**
 * Core's two sides on the rekey vectors' fixed inputs, and the second
 * implementation's handshake on the same, whose keys are core's: so a test can
 * make a message core would open, but must refuse for its length or nonce.
 */
async function pinned(provider: CryptoProvider) {
  const v = rekeyFixture.inputs;
  const fixed = (ephemeral: string) => ({ prologue: fromHex(v.prologue), psk: fromHex(v.psk), testing: { ephemeral: fromHex(ephemeral) } });
  const sides = await handshake(provider, provider, { initiator: fixed(v.initEphemeral), responder: fixed(v.respEphemeral) });
  const second = reference.handshake(v);
  return { ...sides, fixed, k1: hex(second.k1) };
}

/** The error a call fails with, so its code, origin and contents can be checked; fails the test if it doesn't fail. */
async function failure(run: () => Promise<unknown>): Promise<{ code?: string; origin?: string; message?: string; json: string; err: unknown }> {
  try {
    await run();
  } catch (err) {
    const { code, origin, message } = err as { code?: string; origin?: string; message?: string };
    return { code, origin, message, json: JSON.stringify(err), err };
  }
  throw new Error('it opened');
}

/** A provider like `provider`, whose X25519 of the base point gives `publicKey`: a side that sends a low-order key. */
const sendingPoint = (provider: CryptoProvider, publicKey: Uint8Array): CryptoProvider => ({
  ...provider,
  x25519: async (key, u) => (u[0] === 9 && u.subarray(1).every((b) => b === 0) ? new Uint8Array(publicKey) : provider.x25519(key, u)),
});

/** Low-order u-coordinates: 0, 1 and one of order 8. */
const LOW_ORDER = ['00'.repeat(32), `01${'00'.repeat(31)}`, 'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800'];

describe('Noise_NNpsk0_25519_AESGCM_SHA256', () => {
  it('is the name the hash starts from, 32 bytes, with Dropgate\'s limits', () => {
    expect(new TextEncoder().encode(NOISE_PROTOCOL_NAME).byteLength).toBe(32);
    expect(cacophony.vector.protocol_name).toBe(NOISE_PROTOCOL_NAME);
    expect([NOISE_MAX_MESSAGE_BYTES, NOISE_MAX_RECORD_PLAINTEXT_BYTES, NOISE_MAX_HANDSHAKE_PAYLOAD_BYTES, NOISE_REKEY_INTERVAL]).toEqual([65535, 65519, 1024, 65536]);
  });

  it("cacophony's vector is the second implementation's bytes too", () => {
    const v = cacophony.vector;
    const hs = reference.handshake({
      prologue: v.init_prologue, psk: v.init_psks[0], initEphemeral: v.init_ephemeral, respEphemeral: v.resp_ephemeral,
      payload1: v.messages[0].payload, payload2: v.messages[1].payload,
    });
    expect([hex(hs.message1), hex(hs.message2), hex(hs.handshakeHash)]).toEqual([v.messages[0].ciphertext, v.messages[1].ciphertext, v.handshake_hash]);
    const [a, b] = [reference.transport(hs.k1), reference.transport(hs.k2)];
    for (const [i, m] of v.messages.slice(2).entries()) expect(hex((i % 2 ? b : a).seal(Buffer.from(m.payload, 'hex')))).toBe(m.ciphertext);
    expect(cacophony.commit).toBe('8ee9d41e34a1a596cfa3ab12aa4069ff87dc1247');
    expect(cacophony.licence).toMatch(/^The Unlicense/);
  });
});

for (const [label, provider] of PROVIDERS) {
  describe(`Cacophony's vector on ${label}`, async () => {
    const checks = await noiseVectorChecks(provider);

    it('covers both handshake messages, the hash on both sides, the 4 transport messages, and 4 refusals', () => {
      expect(checks).toHaveLength(18);
      expect(checks.filter((c) => /^transport message \d, (sealed|opened)/.test(c.name))).toHaveLength(8);
    });

    for (const { name, expected, actual } of checks) {
      it(name, () => {
        expect(actual).toBe(expected);
      });
    }
  });
}

describe("Dropgate's own rekey vectors", () => {
  it('are what the second implementation makes', { timeout: 120_000 }, () => {
    expect(reference.rekeyVectors()).toEqual(rekeyFixture);
  });

  for (const [label, provider] of PROVIDERS) {
    for (const run of rekeyFixture.runs) {
      it(`core gives the same bytes on ${label}: ${run.name}`, { timeout: 300_000 }, async () => {
        const inputs = rekeyFixture.inputs;
        // Dropgate's own interval is the default: only the lowered ones are asked for.
        const rekeyEvery = run.rekeyEvery === NOISE_REKEY_INTERVAL ? {} : { rekeyEvery: run.rekeyEvery };
        const { message1, message2, initiatorTransport, responderTransport } = await handshake(provider, provider, {
          initiator: { prologue: fromHex(inputs.prologue), psk: fromHex(inputs.psk), testing: { ephemeral: fromHex(inputs.initEphemeral), ...rekeyEvery } },
          responder: { prologue: fromHex(inputs.prologue), psk: fromHex(inputs.psk), testing: { ephemeral: fromHex(inputs.respEphemeral), ...rekeyEvery } },
        });
        expect([hex(message1), hex(message2), hex(initiatorTransport.handshakeHash)]).toEqual([run.message1, run.message2, run.handshakeHash]);

        const directions: Array<[number, NoiseTransport, NoiseTransport, typeof run.initiatorToResponder]> = [
          [1, initiatorTransport, responderTransport, run.initiatorToResponder],
          [2, responderTransport, initiatorTransport, run.responderToInitiator],
        ];
        for (const [d, sender, receiver, expected] of directions) {
          const digest = createHash('sha256');
          const atKeys = new Map(expected.keys.map(({ afterRecords }) => [afterRecords, '']));
          const kept: Record<string, string> = {};
          for (let i = 0; i < run.records; i++) {
            const plaintext = reference.recordPlaintext(d, i);
            const record = await sender.encrypt(plaintext);
            expect(hex(await receiver.decrypt(record))).toBe(hex(plaintext));
            digest.update(record);
            if (i in expected.records) kept[i] = hex(record);
            if (atKeys.has(i)) atKeys.set(i, hex(record));
          }
          expect(kept, `direction ${d}'s records`).toEqual(expected.records);
          expect(digest.digest('hex'), `direction ${d}'s records, all of them`).toBe(expected.sha256OfRecords);
          // The exact key after each rekey, the nonce carrying on: the record
          // that follows, sealed by node:crypto under the pinned key and the
          // record's own nonce, is core's record.
          expect(expected.keys.length).toBe(Math.floor(run.records / run.rekeyEvery) + 1);
          for (const { afterRecords, k } of expected.keys) {
            if (afterRecords >= run.records) continue;
            expect(atKeys.get(afterRecords), `direction ${d}'s key after ${afterRecords} records`)
              .toBe(nodeSeal(k, afterRecords, reference.recordPlaintext(d, afterRecords)));
          }
        }
      });
    }
  }
});

for (const [label, provider] of PROVIDERS) {
  describe(`Noise's limits on ${label}`, () => {
    it('seals 65,519 bytes into a record of 65,535, which opens; refuses 65,520 to seal, leaving the transport as it was', async () => {
      const { initiatorTransport: a, responderTransport: b } = await handshake(provider, provider);
      const largest = new Uint8Array(NOISE_MAX_RECORD_PLAINTEXT_BYTES).fill(7);
      await expect(a.encrypt(new Uint8Array(65_520))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      const record = await a.encrypt(largest);
      expect(record.byteLength).toBe(65_535);
      expect(hex(await b.decrypt(record))).toBe(hex(largest));
    });

    it('refuses a record of 65,536 bytes that would open, and opens one of 65,535, each sealed by the second implementation', async () => {
      const longest = await pinned(provider);
      const record = nodeSeal(longest.k1, 0, new Uint8Array(NOISE_MAX_RECORD_PLAINTEXT_BYTES).fill(5));
      expect(record.length / 2).toBe(65_535);
      expect(hex(await longest.responderTransport.decrypt(fromHex(record)))).toBe('05'.repeat(NOISE_MAX_RECORD_PLAINTEXT_BYTES));
      const tooLong = await pinned(provider);
      const over = fromHex(nodeSeal(tooLong.k1, 0, new Uint8Array(NOISE_MAX_RECORD_PLAINTEXT_BYTES + 1)));
      expect(over.byteLength).toBe(65_536);
      expect((await failure(() => tooLong.responderTransport.decrypt(over))).code).toBe(MISMATCH);
    });

    it('refuses a record of 65,536 bytes, or one shorter than its tag, as SECURITY_POLICY_MISMATCH, and nothing after', async () => {
      for (const length of [65_536, 15, 0]) {
        const { initiatorTransport: a, responderTransport: b } = await handshake(provider, provider);
        const record = await a.encrypt(new Uint8Array(NOISE_MAX_RECORD_PLAINTEXT_BYTES));
        const wrong = length > record.byteLength ? new Uint8Array([...record, 0]) : record.subarray(0, length);
        expect(wrong.byteLength).toBe(length);
        expect((await failure(() => b.decrypt(wrong))).code).toBe(MISMATCH);
        expect((await failure(() => b.decrypt(record))).code, 'the genuine record after').toBe(MISMATCH);
      }
    });

    it('takes a handshake payload of 1,024 bytes, refuses 1,025 to send, and refuses a message 1 or 2 longer than 1,072 bytes or shorter than 48', async () => {
      const big = new Uint8Array(NOISE_MAX_HANDSHAKE_PAYLOAD_BYTES).fill(1);
      const { message2, payload } = await handshake(provider, provider, { payload2: big });
      expect([message2.byteLength, hex(payload)]).toEqual([1072, hex(big)]);
      await expect(noiseResponder(provider, { prologue, psk: psk() }).writeMessage2(big)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(noiseInitiator(provider, { prologue, psk: psk() }).writeMessage1(new Uint8Array(1025))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      const responder = noiseResponder(provider, { prologue, psk: psk() });
      await responder.readMessage1(await noiseInitiator(provider, { prologue, psk: psk() }).writeMessage1());
      await expect(responder.writeMessage2(new Uint8Array(1025))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

      for (const length of [1073, 47, 0]) {
        expect((await failure(() => noiseResponder(provider, { prologue, psk: psk() }).readMessage1(new Uint8Array(length)))).code).toBe(MISMATCH);
        const initiator = noiseInitiator(provider, { prologue, psk: psk() });
        await initiator.writeMessage1();
        expect((await failure(() => initiator.readMessage2(new Uint8Array(length)))).code).toBe(MISMATCH);
      }
    });

    it('refuses a message 1 or 2 with a 1,025-byte payload that would open, and opens 1,024, each written by the second implementation', async () => {
      const { fixed } = await pinned(provider);
      const v = rekeyFixture.inputs;
      for (const [bytes, opens] of [[1024, true], [1025, false]] as const) {
        const payload = '07'.repeat(bytes);
        const one = reference.handshake({ ...v, payload1: payload });
        const responder = noiseResponder(provider, fixed(v.respEphemeral));
        if (opens) expect(hex(await responder.readMessage1(one.message1))).toBe(payload);
        else expect((await failure(() => responder.readMessage1(one.message1))).code, 'message 1').toBe(MISMATCH);

        const two = reference.handshake({ ...v, payload2: payload });
        expect(two.message2.byteLength).toBe(48 + bytes);
        const initiator = noiseInitiator(provider, fixed(v.initEphemeral));
        expect(hex(await initiator.writeMessage1())).toBe(hex(two.message1));
        if (opens) expect(hex((await initiator.readMessage2(two.message2)).payload)).toBe(payload);
        else expect((await failure(() => initiator.readMessage2(two.message2))).code, 'message 2').toBe(MISMATCH);
      }
    });

    it('takes nothing more after a handshake message refused for its length, not even the genuine one', async () => {
      const v = rekeyFixture.inputs;
      const { fixed } = await pinned(provider);
      const genuine = reference.handshake(v);
      const responder = noiseResponder(provider, fixed(v.respEphemeral));
      expect((await failure(() => responder.readMessage1(genuine.message1.subarray(0, 47)))).code).toBe(MISMATCH);
      expect((await failure(() => responder.readMessage1(genuine.message1))).code).toBe(MISMATCH);
      const initiator = noiseInitiator(provider, fixed(v.initEphemeral));
      await initiator.writeMessage1();
      expect((await failure(() => initiator.readMessage2(new Uint8Array(1073)))).code).toBe(MISMATCH);
      expect((await failure(() => initiator.readMessage2(genuine.message2))).code).toBe(MISMATCH);
    });

    it('refuses a flipped bit anywhere in message 1, message 2 or a record, as SECURITY_POLICY_MISMATCH, then the genuine message too', { timeout: 120_000 }, async () => {
      const { initiator, responder } = cacophonySides(provider);
      const v = cacophony.vector;
      const message1 = await initiator.writeMessage1(fromHex(v.messages[0].payload));
      await responder.readMessage1(message1);
      const { message: message2 } = await responder.writeMessage2(fromHex(v.messages[1].payload));
      let refused = 0;

      for (let bit = 0; bit < message1.byteLength * 8; bit++) {
        const side = cacophonySides(provider).responder;
        expect((await failure(() => side.readMessage1(flipped(message1, bit)))).code, `message 1, bit ${bit}`).toBe(MISMATCH);
        expect((await failure(() => side.readMessage1(message1))).code, 'message 1 again').toBe(MISMATCH);
        refused++;
      }
      for (let bit = 0; bit < message2.byteLength * 8; bit++) {
        const side = cacophonySides(provider).initiator;
        await side.writeMessage1(fromHex(v.messages[0].payload));
        expect((await failure(() => side.readMessage2(flipped(message2, bit)))).code, `message 2, bit ${bit}`).toBe(MISMATCH);
        expect((await failure(() => side.readMessage2(message2))).code, 'message 2 again').toBe(MISMATCH);
        refused++;
      }
      const record = await (await handshake(provider, provider, {
        initiator: { testing: { ephemeral: fromHex('21'.repeat(32)) } }, responder: { testing: { ephemeral: fromHex('42'.repeat(32)) } },
      })).initiatorTransport.encrypt(new Uint8Array(16).fill(3));
      for (let bit = 0; bit < record.byteLength * 8; bit++) {
        const { responderTransport } = await handshake(provider, provider, {
          initiator: { testing: { ephemeral: fromHex('21'.repeat(32)) } }, responder: { testing: { ephemeral: fromHex('42'.repeat(32)) } },
        });
        expect((await failure(() => responderTransport.decrypt(flipped(record, bit)))).code, `the record, bit ${bit}`).toBe(MISMATCH);
        expect((await failure(() => responderTransport.decrypt(record))).code, 'the record again').toBe(MISMATCH);
        refused++;
      }
      expect(refused).toBe((message1.byteLength + message2.byteLength + record.byteLength) * 8);
    });

    it('refuses records out of order, replayed or from the other direction', async () => {
      const { initiatorTransport: a, responderTransport: b } = await handshake(provider, provider);
      const [r0, r1] = [await a.encrypt(Uint8Array.of(0)), await a.encrypt(Uint8Array.of(1))];
      expect((await failure(() => b.decrypt(r1))).code).toBe(MISMATCH);
      const second = await handshake(provider, provider);
      const s0 = await second.initiatorTransport.encrypt(Uint8Array.of(0));
      expect(hex(await second.responderTransport.decrypt(s0))).toBe('00');
      expect((await failure(() => second.responderTransport.decrypt(s0))).code, 'a replay').toBe(MISMATCH);
      const third = await handshake(provider, provider);
      const back = await third.initiatorTransport.encrypt(Uint8Array.of(0));
      expect((await failure(() => third.initiatorTransport.decrypt(back))).code, 'its own record').toBe(MISMATCH);
      void r0;
    });

    it('fails message 1 with another PSK or another prologue (another DTLS fingerprint)', async () => {
      for (const responderOptions of [{ psk: fromHex('12'.repeat(32)) }, { prologue: new TextEncoder().encode('a prologuf') }]) {
        const message1 = await noiseInitiator(provider, { prologue, psk: psk() }).writeMessage1();
        const responder = noiseResponder(provider, { prologue, psk: psk(), ...responderOptions });
        expect((await failure(() => responder.readMessage1(message1))).code).toBe(MISMATCH);
      }
    });

    it("refuses a low-order key in message 2, or in message 1, as SECURITY_POLICY_MISMATCH, not the provider's INVALID_ARGUMENT", async () => {
      for (const point of LOW_ORDER) {
        const scalar = { testing: { ephemeral: fromHex('33'.repeat(32)) } };
        const initiator = noiseInitiator(provider, { prologue, psk: psk(), ...scalar });
        const evilResponder = noiseResponder(sendingPoint(provider, fromHex(point)), { prologue, psk: psk(), ...scalar });
        await evilResponder.readMessage1(await initiator.writeMessage1());
        // Its own DH is with a real key: only the key it sends is low-order.
        const { message } = await evilResponder.writeMessage2();
        expect(hex(message.subarray(0, 32))).toBe(point);
        expect((await failure(() => initiator.readMessage2(message))).code, `message 2's ${point}`).toBe(MISMATCH);

        const evilInitiator = noiseInitiator(sendingPoint(provider, fromHex(point)), { prologue, psk: psk(), ...scalar });
        const message1 = await evilInitiator.writeMessage1();
        expect(hex(message1.subarray(0, 32))).toBe(point);
        const responder = noiseResponder(provider, { prologue, psk: psk() });
        await responder.readMessage1(message1);
        expect((await failure(() => responder.writeMessage2())).code, `message 1's ${point}, found at the first DH`).toBe(MISMATCH);
      }
    });

    it('stops each direction before nonce 2^64 - 1: the last record seals and opens, the next is refused', async () => {
      const { initiatorTransport: a, responderTransport: b } = await handshake(provider, provider);
      const last = (1n << 64n) - 2n;
      setNonceForTests(a, 'send', last);
      setNonceForTests(b, 'receive', last);
      const record = await a.encrypt(Uint8Array.of(9));
      expect(hex(await b.decrypt(record))).toBe('09');
      const sending = await failure(() => a.encrypt(Uint8Array.of(10)));
      expect([sending.code, sending.origin]).toEqual([MISMATCH, 'local']);
      expect(sending.message).toBe('This connection has sent every record its keys allow, so it was closed.');
      expect((await failure(() => b.decrypt(record))).code).toBe(MISMATCH);
      // Both directions that reached the end are closed; the others still work.
      expect((await failure(() => a.encrypt(Uint8Array.of(11)))).code).toBe(MISMATCH);
      expect(hex(await a.decrypt(await b.encrypt(Uint8Array.of(12))))).toBe('0c');
    });

    it('refuses a record sealed under nonce 2^64 - 1, which would open, after opening the one before it', async () => {
      const { responderTransport, k1 } = await pinned(provider);
      const max = (1n << 64n) - 1n;
      setNonceForTests(responderTransport, 'receive', max - 1n);
      expect(hex(await responderTransport.decrypt(fromHex(nodeSeal(k1, max - 1n, Uint8Array.of(1)))))).toBe('01');
      expect((await failure(() => responderTransport.decrypt(fromHex(nodeSeal(k1, max, Uint8Array.of(2)))))).code).toBe(MISMATCH);
    });

    it('rekeys after every 65,536 records by default, the nonce carrying on, matching the second implementation', { timeout: 120_000 }, async () => {
      // A shorter run than the pinned one, starting near the boundary: the
      // nonce moved to 65,530, as if 65,530 records had gone, needs no key
      // change itself, so the rekey at 65,536 follows from Split()'s key.
      const v = rekeyFixture.inputs;
      const fixed = (ephemeral: string) => ({ prologue: fromHex(v.prologue), psk: fromHex(v.psk), testing: { ephemeral: fromHex(ephemeral) } });
      const { initiatorTransport: a, responderTransport: b } = await handshake(provider, provider, { initiator: fixed(v.initEphemeral), responder: fixed(v.respEphemeral) });
      const hs = reference.handshake(v);
      const mirror = reference.transport(hs.k1);
      for (let i = 0; i < 65_530; i++) mirror.seal(reference.recordPlaintext(1, i));
      setNonceForTests(a, 'send', 65_530n);
      setNonceForTests(b, 'receive', 65_530n);
      for (let i = 65_530; i < 65_540; i++) {
        const plaintext = reference.recordPlaintext(1, i);
        const record = await a.encrypt(plaintext);
        expect(hex(record), `record ${i}`).toBe(hex(mirror.seal(plaintext)));
        expect(hex(await b.decrypt(record))).toBe(hex(plaintext));
      }
    });

    it('seals records in the order they were asked for, even all at once', async () => {
      const { initiatorTransport: a, responderTransport: b } = await handshake(provider, provider, {
        initiator: { testing: { rekeyEvery: 5 } }, responder: { testing: { rekeyEvery: 5 } },
      });
      const records = await Promise.all(Array.from({ length: 40 }, (_, i) => a.encrypt(Uint8Array.of(i))));
      const opened = await Promise.all(records.map((record) => b.decrypt(record)));
      expect(opened.map((p) => p[0])).toEqual(Array.from({ length: 40 }, (_, i) => i));
    });

    it('says nothing in its errors, keeps the caller\'s PSK as given, shows no key, and closes', async () => {
      const key = psk();
      const { initiatorTransport: a, responderTransport: b } = await handshake(provider, provider, { initiator: { psk: key } });
      expect(hex(key), "the caller's PSK, which is the caller's to overwrite").toBe('11'.repeat(32));
      const record = await a.encrypt(new TextEncoder().encode('secret words'));
      const err = await failure(() => b.decrypt(flipped(record, 0)));
      expect(JSON.parse(err.json)).toEqual({ name: 'DropgateError', code: MISMATCH, message: "The connection couldn't be secured, so it was closed.", origin: 'peer', retryable: false });
      expect((err.err as Error).cause).toBeUndefined();
      expect(inspect(a, { depth: 5 })).not.toMatch(/[0-9a-f]{64}/);
      expect(Object.keys(a).sort()).toEqual(['close', 'decrypt', 'encrypt', 'handshakeHash']);
      a.close();
      expect((await failure(() => a.encrypt(Uint8Array.of(1)))).code).toBe(MISMATCH);
      expect((await failure(() => a.decrypt(record))).code).toBe(MISMATCH);
    });

    it('takes each handshake message only in its turn, and nothing after a failure', async () => {
      const initiator = noiseInitiator(provider, { prologue, psk: psk() });
      await expect(initiator.readMessage2(new Uint8Array(48))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      const message1 = await initiator.writeMessage1();
      await expect(initiator.writeMessage1()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      const responder = noiseResponder(provider, { prologue, psk: psk() });
      await expect(responder.writeMessage2()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await responder.readMessage1(message1);
      await expect(responder.readMessage1(message1)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      for (const options of [{ prologue, psk: new Uint8Array(31) }, { prologue: 'text', psk: psk() }]) {
        expect(() => noiseInitiator(provider, options as unknown as NoiseOptions)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
      }
    });
  });
}

describe('A Noise handshake with one side on each provider', () => {
  for (const [a, b] of [[webCrypto, noble], [noble, webCrypto]]) {
    it(`completes, and carries records both ways past a rekey: ${a.name} the initiator, ${b.name} the responder`, async () => {
      const lowered = { testing: { rekeyEvery: 3 } };
      const { initiatorTransport, responderTransport, payload } = await handshake(a, b, {
        initiator: lowered, responder: lowered, payload2: new TextEncoder().encode('capabilities'),
      });
      expect(new TextDecoder().decode(payload)).toBe('capabilities');
      expect(hex(initiatorTransport.handshakeHash)).toBe(hex(responderTransport.handshakeHash));
      for (let i = 0; i < 8; i++) {
        expect(hex(await responderTransport.decrypt(await initiatorTransport.encrypt(Uint8Array.of(i))))).toBe(hex(Uint8Array.of(i)));
        expect(hex(await initiatorTransport.decrypt(await responderTransport.encrypt(Uint8Array.of(100 + i))))).toBe(hex(Uint8Array.of(100 + i)));
      }
    });
  }
});

describe('Outside a test build', () => {
  it("refuses a fixed ephemeral, a lowered rekey interval and a moved nonce, as core's builds are made, and still completes a handshake", async () => {
    // noise.ts bundled with exactly the define tsup.config.ts gives every build.
    const { outputFiles } = await build({
      entryPoints: [fileURLToPath(new URL('../src/dgdtp/noise.ts', import.meta.url))],
      bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent',
      define: { ...versionDefine, ...testBuildDefine(false) },
    });
    const code = outputFiles[0].text;
    expect(code).not.toContain('__DROPGATE_TEST_BUILD__');
    const built = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as typeof import('../src/dgdtp/noise.js');
    for (const testing of [{ ephemeral: new Uint8Array(32) }, { rekeyEvery: 4 }, {}]) {
      expect(() => built.noiseInitiator(webCrypto, { prologue, psk: psk(), testing })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
      expect(() => built.noiseResponder(webCrypto, { prologue, psk: psk(), testing })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    }
    // The built initiator against the test build's responder.
    const initiator = built.noiseInitiator(webCrypto, { prologue, psk: psk() });
    const responder = noiseResponder(webCrypto, { prologue, psk: psk() });
    await responder.readMessage1(await initiator.writeMessage1());
    const { message, transport: responderTransport } = await responder.writeMessage2();
    const { transport } = await initiator.readMessage2(message);
    expect(hex(await responderTransport.decrypt(await transport.encrypt(Uint8Array.of(5))))).toBe('05');
    expect(() => built.setNonceForTests(transport, 'send', 5n)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    // And the test build's own source says the same about its gate.
    expect(readFileSync(new URL('../src/dgdtp/noise.ts', import.meta.url), 'utf8')).toContain("typeof __DROPGATE_TEST_BUILD__ === 'boolean' && __DROPGATE_TEST_BUILD__");
  });
});
