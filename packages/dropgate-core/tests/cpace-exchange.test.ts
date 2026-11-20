import { afterEach, describe, it, expect, vi } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { inspect } from 'node:util';
import vectors from './fixtures/cpace-x25519-sha512-vectors.json';
import { DropgateError } from '../src/index.js';
import { nobleProvider, webCryptoProvider, type CryptoProvider, type NamedCryptoProvider } from '../src/crypto/index.js';
import { CodePassword, parseCode } from '../src/dgdtp/codes.js';
import {
  calculateGenerator, checkCpaceAbort, cpaceAbort, cpaceInitiator, cpaceResponder, generatorString,
} from '../src/dgdtp/cpace.js';
import { cpaceExchangeChecks } from './helpers/cpace-exchange-checks.js';
import { fromHex, hex } from './helpers/cpace-vectors.js';

// The CPace exchange a typed code runs: the receiver as initiator A, the
// sender as responder B, three messages through the rendezvous, explicit key
// confirmation (Tb checked before Ta is made, Ta before the sender hands the
// ISK on), and every abort CODE_MISMATCH on both sides, on each of core's
// crypto providers. Then what a failed exchange's transcript holds: nothing
// derived from the password that a guess could be checked against.

const webCrypto = webCryptoProvider(globalThis.crypto);
const noble = nobleProvider(globalThis.crypto);
const PROVIDERS: Array<[string, NamedCryptoProvider]> = [['WebCrypto', webCrypto], ['@noble', noble]];

const ascii = (text: string) => new TextEncoder().encode(text);
const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));
/** lv_cat for parts under 128 bytes, written here rather than taken from core: each part's length in one byte, then the part. */
const lv = (...parts: Uint8Array[]) => concat(...parts.flatMap((part) => [Uint8Array.of(part.byteLength), part]));
const isZero = (bytes: Uint8Array) => bytes.every((b) => b === 0);

const LOW_ORDER = vectors['B.1.10'].text;
const LOW_ORDER_SHARES = LOW_ORDER.abort.map((name) => [name, fromHex(LOW_ORDER.u[name as keyof typeof LOW_ORDER.u])] as const);

afterEach(() => {
  vi.restoreAllMocks();
});

/** A provider that records what CPace asks of it: HMAC inputs, SHA-512 inputs, and every X25519 call. */
function watched(provider: CryptoProvider) {
  const hmacs: Uint8Array[] = [];
  /** Each HMAC's key, as given (not a copy). */
  const hmacKeys: Uint8Array[] = [];
  const sha512s: Uint8Array[] = [];
  /** Each SHA-512's input, as given. */
  const sha512Inputs: Uint8Array[] = [];
  const x25519s: Array<{ u: Uint8Array; given: Uint8Array; out: Uint8Array; copy: Uint8Array }> = [];
  let zeroK = false;
  const wrapped: CryptoProvider = {
    ...provider,
    hmac(hash, key, data) {
      hmacs.push(new Uint8Array(data));
      hmacKeys.push(key);
      return provider.hmac(hash, key, data);
    },
    sha512(data) {
      sha512s.push(new Uint8Array(data));
      sha512Inputs.push(data);
      return provider.sha512(data);
    },
    async x25519(key, u) {
      const record = { u: new Uint8Array(u), given: u, out: new Uint8Array(0), copy: new Uint8Array(0) };
      // The second X25519 a side asks for is K; a provider that gives all zeros there, if asked to.
      const out = zeroK && x25519s.length === 1 ? new Uint8Array(32) : await provider.x25519(key, u);
      x25519s.push(Object.assign(record, { out, copy: new Uint8Array(out) }));
      return out;
    },
  };
  return { provider: wrapped, hmacs, hmacKeys, sha512s, sha512Inputs, x25519s, giveZeroK: () => { zeroK = true; } };
}

interface Side {
  error?: unknown;
  isk?: Uint8Array;
  peerVersion?: { major: number; minor: number };
  attemptId?: Uint8Array;
  /** Every ISK array handed on, as handed on (not a copy). */
  handedOn: Uint8Array[];
}

type Tamper = (message: Uint8Array) => Uint8Array;

/**
 * One exchange as the channel will run it, each side sending an abort when
 * its step fails: the receiver typed `typed`, the sender's code is `sent`.
 */
async function exchange(options: {
  a?: CryptoProvider; b?: CryptoProvider; typed?: string; sent?: string; letters?: 2 | 3;
  tamper?: { m1?: Tamper; m2?: Tamper; m3?: Tamper };
} = {}) {
  const { a = webCrypto, b = webCrypto, sent = 'ABCD-1234', letters = 2, tamper = {} } = options;
  const senderParts = parseCode(sent, letters);
  const typedParts = parseCode(options.typed ?? sent, letters);
  const roomNonce = webCrypto.randomBytes(16);
  const attemptId = webCrypto.randomBytes(16);
  const sender = cpaceResponder(b, { password: senderParts.password, locator: senderParts.locator, roomNonce });
  const receiver = cpaceInitiator(a, { password: typedParts.password, locator: typedParts.locator, roomNonce, attemptId });
  const transcript: Uint8Array[] = [];
  const send = (message: Uint8Array, change?: Tamper) => {
    const out = change ? change(new Uint8Array(message)) : message;
    transcript.push(new Uint8Array(out));
    return out;
  };
  const receiverSide: Side = { handedOn: [] };
  const senderSide: Side = { handedOn: [] };
  const handOn = (side: Side) => (isk: Uint8Array) => {
    side.handedOn.push(isk);
    return new Uint8Array(isk);
  };

  const m1 = send(await receiver.writeMessage1(), tamper.m1);
  let m2: Uint8Array;
  try {
    const read = await sender.readMessage1(m1);
    expect(Object.keys(read).sort()).toEqual(['attemptId', 'message2', 'peerVersion']);
    expect(senderSide.handedOn).toHaveLength(0);
    m2 = read.message2;
    senderSide.peerVersion = read.peerVersion;
    senderSide.attemptId = read.attemptId;
  } catch (err) {
    senderSide.error = err;
    m2 = cpaceAbort();
  }
  m2 = send(m2, tamper.m2);
  let m3: Uint8Array;
  try {
    const read = await receiver.readMessage2(m2, handOn(receiverSide));
    m3 = read.message3;
    receiverSide.isk = read.result;
    receiverSide.peerVersion = read.peerVersion;
  } catch (err) {
    receiverSide.error = err;
    m3 = cpaceAbort();
  }
  m3 = send(m3, tamper.m3);
  if (!senderSide.error) {
    try {
      senderSide.isk = (await sender.readMessage3(m3, handOn(senderSide))).result;
    } catch (err) {
      senderSide.error = err;
      // The sender's abort, where the receiver waits for its first sealed
      // frame, unless the receiver has aborted already.
      if (!receiverSide.error) {
        try {
          checkCpaceAbort(send(cpaceAbort()));
        } catch (abortErr) {
          receiverSide.error = abortErr;
        }
      }
    }
  }
  return { receiver: receiverSide, sender: senderSide, transcript, roomNonce, attemptId, objects: { receiver, sender } };
}

/**
 * Both sides ended with CODE_MISMATCH, origin peer, not retryable, carrying
 * nothing, and the sender never handed an ISK on; nor the receiver, unless
 * it had checked Tb (`afterTb`: what failed was message 3, on its way).
 */
function expectBothMismatched(result: Awaited<ReturnType<typeof exchange>>, { afterTb = false } = {}) {
  if (afterTb) expect(result.receiver.handedOn).toHaveLength(1);
  for (const [name, side] of [['receiver', result.receiver], ['sender', result.sender]] as const) {
    expect(side.error, name).toBeInstanceOf(DropgateError);
    const err = side.error as DropgateError;
    expect({ code: err.code, origin: err.origin, retryable: err.retryable }, name).toEqual({ code: 'CODE_MISMATCH', origin: 'peer', retryable: false });
    expect(err.message, name).toBe("The code didn't match, so the connection was closed.");
    expect(err.cause, name).toBeUndefined();
    expect(err.details, name).toBeUndefined();
    if (afterTb && side === result.receiver) continue;
    expect(side.isk, name).toBeUndefined();
    expect(side.handedOn, name).toHaveLength(0);
  }
}

const flip = (at: number) => (message: Uint8Array) => {
  message[at < 0 ? message.byteLength + at : at] ^= 0x01;
  return message;
};
const put = (at: number, bytes: Uint8Array) => (message: Uint8Array) => {
  message.set(bytes, at);
  return message;
};

describe('the CPace exchange with the same code', () => {
  for (const [a, b] of [[webCrypto, webCrypto], [noble, noble], [webCrypto, noble], [noble, webCrypto]]) {
    it(`hands the same 64-byte ISK on to both sides, however the code was typed: ${a.name} receiving, ${b.name} sending`, async () => {
      const result = await exchange({ a, b, typed: ' ab cd1234 ' });
      expect(result.receiver.error).toBeUndefined();
      expect(result.sender.error).toBeUndefined();
      expect(result.receiver.isk).toHaveLength(64);
      expect(hex(result.receiver.isk!)).toBe(hex(result.sender.isk!));
      // Each ISK handed on is overwritten once its function is done with it.
      for (const isk of [...result.receiver.handedOn, ...result.sender.handedOn]) expect(isZero(isk)).toBe(true);
    });
  }

  it('sends messages of 51, 99 and 64 bytes: the attempt ID, Ya and ADa; Yb, ADb and Tb; Ta', async () => {
    const { transcript, attemptId, receiver, sender } = await exchange();
    const [m1, m2, m3] = transcript;
    expect(transcript.map((m) => m.byteLength)).toEqual([51, 99, 64]);
    expect(hex(m1.subarray(0, 16))).toBe(hex(attemptId));
    // ADa: the receiver's role, then DGDTP 4.0; ADb: the sender's.
    expect(hex(m1.subarray(48))).toBe('010400');
    expect(hex(m2.subarray(32, 35))).toBe('020400');
    expect(receiver.peerVersion).toEqual({ major: 4, minor: 0 });
    expect(sender.peerVersion).toEqual({ major: 4, minor: 0 });
    expect(hex(sender.attemptId!)).toBe(hex(attemptId));
    expect(m3).not.toEqual(m2.subarray(35));
  });

  it("makes Tb and Ta as HMAC-SHA-512 under SHA-512(\"CPaceMac\" ‖ sid ‖ ISK), as node:crypto makes them from that formula", async () => {
    const { transcript, roomNonce, attemptId, receiver } = await exchange();
    const [m1, m2, m3] = transcript;
    const sid = concat(roomNonce, attemptId);
    const macKey = createHash('sha512').update(concat(ascii('CPaceMac'), sid, receiver.isk!)).digest();
    const tag = (share: Uint8Array, ad: Uint8Array) => createHmac('sha512', macKey).update(lv(share, ad)).digest('hex');
    expect(hex(m2.subarray(35))).toBe(tag(m2.subarray(0, 32), m2.subarray(32, 35)));
    expect(hex(m3)).toBe(tag(m1.subarray(16, 48), m1.subarray(48)));
  });

  for (const letters of [2, 3] as const) {
    it(`makes the generator from the password's characters, CI of the roles and the locator, and the room's and attempt's nonces: ${letters} locator letters`, async () => {
      const a = watched(webCrypto);
      const b = watched(noble);
      const { roomNonce, attemptId } = await exchange({ a: a.provider, b: b.provider, typed: 'abcd 1234', letters });
      const [locator, prs] = letters === 2 ? ['AB', 'CD1234'] : ['ABC', 'D1234'];
      const ci = lv(ascii('dropgate/4 dgdtp cpace'), ascii('receiver'), ascii('sender'), ascii(locator));
      const expected = hex(generatorString(ascii(prs), ci, concat(roomNonce, attemptId)));
      // Each side's first SHA-512 is the generator string's.
      expect(hex(a.sha512s[0])).toBe(expected);
      expect(hex(b.sha512s[0])).toBe(expected);
    });
  }

  it('gives a new ISK for each attempt', async () => {
    const first = await exchange();
    const second = await exchange();
    expect(hex(first.receiver.isk!)).not.toBe(hex(second.receiver.isk!));
  });
});

describe("the CPace exchange's aborts, each CODE_MISMATCH on both sides", () => {
  it('a wrong code: the receiver finds it at Tb, and never makes Ta', async () => {
    const a = watched(webCrypto);
    const result = await exchange({ a: a.provider, typed: 'ABCD-1243' });
    expectBothMismatched(result);
    expect(result.transcript.map((m) => m.byteLength)).toEqual([51, 99, 0]);
    // The receiver's one HMAC was the check of Tb: lv_cat(Yb, ADb), never lv_cat(Ya, ADa).
    const [m1, m2] = result.transcript;
    expect(a.hmacs.map(hex)).toEqual([hex(lv(m2.subarray(0, 32), m2.subarray(32, 35)))]);
    expect(a.hmacs.map(hex)).not.toContain(hex(lv(m1.subarray(16, 48), m1.subarray(48))));
  });

  it('with the same code, the receiver checks Tb before it makes Ta', async () => {
    const a = watched(webCrypto);
    const { transcript } = await exchange({ a: a.provider });
    const [m1, m2] = transcript;
    expect(a.hmacs.map(hex)).toEqual([hex(lv(m2.subarray(0, 32), m2.subarray(32, 35))), hex(lv(m1.subarray(16, 48), m1.subarray(48)))]);
  });

  for (const [label, provider] of PROVIDERS) {
    describe(`on ${label}`, () => {
      const run = (tamper: NonNullable<Parameters<typeof exchange>[0]>['tamper'], typed?: string) => exchange({ a: provider, b: provider, tamper, typed });

      it('a message 1, 2 or 3 a byte short or a byte long (a share of the wrong length)', async () => {
        for (const [which, change] of [
          ['m1', (m: Uint8Array) => m.subarray(0, 50)], ['m1', (m: Uint8Array) => concat(m, Uint8Array.of(0))],
          ['m2', (m: Uint8Array) => m.subarray(0, 98)], ['m2', (m: Uint8Array) => concat(m, Uint8Array.of(0))],
          ['m3', (m: Uint8Array) => m.subarray(0, 63)], ['m3', (m: Uint8Array) => concat(m, Uint8Array.of(0))],
        ] as const) {
          expectBothMismatched(await run({ [which]: change }), { afterTb: which === 'm3' });
        }
      });

      it('a message of the wrong length is refused before any shared point is made', async () => {
        for (const change of [(m: Uint8Array) => m.subarray(0, 50), (m: Uint8Array) => concat(m, Uint8Array.of(0))]) {
          const b = watched(provider);
          expectBothMismatched(await exchange({ a: provider, b: b.provider, tamper: { m1: change } }));
          expect(b.x25519s).toHaveLength(0);
        }
        for (const change of [(m: Uint8Array) => m.subarray(0, 98), (m: Uint8Array) => concat(m, Uint8Array.of(0))]) {
          const a = watched(provider);
          expectBothMismatched(await exchange({ a: a.provider, b: provider, tamper: { m2: change } }));
          // Its own share alone.
          expect(a.x25519s).toHaveLength(1);
        }
      });

      it("each low-order share, as the receiver's Ya or the sender's Yb", async () => {
        expect(LOW_ORDER_SHARES.map(([name]) => name)).toEqual(['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u7']);
        for (const [, u] of LOW_ORDER_SHARES) {
          expectBothMismatched(await run({ m1: put(16, u) }));
          expectBothMismatched(await run({ m2: put(0, u) }));
        }
      });

      it('a Tb that doesn\'t match, so no Ta is made', async () => {
        for (const at of [35, -1]) {
          const result = await run({ m2: flip(at) });
          expectBothMismatched(result);
          expect(result.transcript[2]).toHaveLength(0);
        }
      });

      it("a Ta that doesn't match, so the sender never hands the ISK on, and its abort reaches the receiver", async () => {
        for (const at of [0, -1]) {
          const result = await run({ m3: flip(at) });
          expectBothMismatched(result, { afterTb: true });
          expect(result.transcript.map((m) => m.byteLength)).toEqual([51, 99, 64, 0]);
        }
      });

      it('an abort in place of message 2 or 3', async () => {
        expectBothMismatched(await run({ m2: () => cpaceAbort() }));
        expectBothMismatched(await run({ m3: () => cpaceAbort() }), { afterTb: true });
      });

      it("a role, version or attempt ID changed on the way, which the confirmations don't match", async () => {
        expectBothMismatched(await run({ m1: put(48, Uint8Array.of(0x02)) }));
        expectBothMismatched(await run({ m2: put(32, Uint8Array.of(0x01)) }));
        expectBothMismatched(await run({ m1: flip(49) }));
        expectBothMismatched(await run({ m1: flip(50) }));
        expectBothMismatched(await run({ m2: flip(34) }));
        expectBothMismatched(await run({ m1: flip(0) }));
        expectBothMismatched(await run({ m1: flip(15) }));
      });

      it("a message from the other role is refused before any shared point is made", async () => {
        const b = watched(provider);
        expectBothMismatched(await exchange({ a: provider, b: b.provider, tamper: { m1: put(48, Uint8Array.of(0x02)) } }));
        // The sender refused it before its share or anything after; the receiver, after its own share alone.
        expect(b.x25519s).toHaveLength(0);
        const a = watched(provider);
        expectBothMismatched(await exchange({ a: a.provider, b: provider, tamper: { m2: put(32, Uint8Array.of(0x01)) } }));
        expect(a.x25519s).toHaveLength(1);
      });

      it('a shared point K of all zeros, which CPace refuses itself as the provider would', async () => {
        for (const side of ['a', 'b'] as const) {
          const w = watched(provider);
          w.giveZeroK();
          const result = await exchange({ a: provider, b: provider, [side]: w.provider });
          expectBothMismatched(result);
          // The side whose K was all zeros stopped there: the sender sent an abort for message 2,
          // and the receiver never checked Tb.
          if (side === 'b') expect(result.transcript[1]).toHaveLength(0);
          else expect(w.hmacs).toHaveLength(0);
        }
      });
    });
  }
});

for (const [label, provider] of PROVIDERS) {
  describe(`the CPace exchange's checks the browser engines run too, on ${label}`, async () => {
    const checks = await cpaceExchangeChecks(provider);

    it('cover the same code, a wrong one, each low-order share both ways and each confirmation', () => {
      expect(checks).toHaveLength(18);
    });

    for (const { name, expected, actual } of checks) {
      it(name, () => {
        expect(actual).toBe(expected);
      });
    }
  });
}

describe('a code runs CPace once, right or wrong', () => {
  it('a second message 1 is refused, and the first attempt still completes', async () => {
    const roomNonce = webCrypto.randomBytes(16);
    const sent = parseCode('ABCD-1234');
    const sender = cpaceResponder(webCrypto, { password: sent.password, locator: 'AB', roomNonce });
    const receiverFor = () => cpaceInitiator(webCrypto, { password: parseCode('ABCD-1234').password, locator: 'AB', roomNonce, attemptId: webCrypto.randomBytes(16) });
    const first = receiverFor();
    const second = receiverFor();
    const { message2 } = await sender.readMessage1(await first.writeMessage1());
    await expect(sender.readMessage1(await second.writeMessage1())).rejects.toMatchObject({ code: 'CODE_MISMATCH' });
    const { message3, result: iskA } = await first.readMessage2(message2, (isk) => hex(isk));
    const { result: iskB } = await sender.readMessage3(message3, (isk) => hex(isk));
    expect(iskB).toBe(iskA);
    await expect(sender.readMessage1(await receiverFor().writeMessage1())).rejects.toMatchObject({ code: 'CODE_MISMATCH' });
  });

  it("a wrong code spends it: the same password can't run again, on either side", async () => {
    const roomNonce = webCrypto.randomBytes(16);
    const sent = parseCode('ABCD-1234');
    const typed = parseCode('ABCD-9999');
    const sender = cpaceResponder(webCrypto, { password: sent.password, locator: 'AB', roomNonce });
    const receiver = cpaceInitiator(webCrypto, { password: typed.password, locator: 'AB', roomNonce, attemptId: webCrypto.randomBytes(16) });
    const { message2 } = await sender.readMessage1(await receiver.writeMessage1());
    await expect(receiver.readMessage2(message2, () => undefined)).rejects.toMatchObject({ code: 'CODE_MISMATCH' });
    await expect(sender.readMessage3(cpaceAbort(), () => undefined)).rejects.toMatchObject({ code: 'CODE_MISMATCH' });
    // A new exchange on either password finds it spent.
    const again = cpaceInitiator(webCrypto, { password: sent.password, locator: 'AB', roomNonce, attemptId: webCrypto.randomBytes(16) });
    await expect(again.writeMessage1()).rejects.toMatchObject({ code: 'CODE_MISMATCH' });
    const senderAgain = cpaceResponder(webCrypto, { password: typed.password, locator: 'AB', roomNonce });
    const fresh = cpaceInitiator(webCrypto, { password: parseCode('ABCD-9999').password, locator: 'AB', roomNonce, attemptId: webCrypto.randomBytes(16) });
    await expect(senderAgain.readMessage1(await fresh.writeMessage1())).rejects.toMatchObject({ code: 'CODE_MISMATCH' });
  });

  it("a message 1 that isn't one spends the code too", async () => {
    const roomNonce = webCrypto.randomBytes(16);
    const sent = parseCode('ABCD-1234');
    const sender = cpaceResponder(webCrypto, { password: sent.password, locator: 'AB', roomNonce });
    await expect(sender.readMessage1(new Uint8Array(51))).rejects.toMatchObject({ code: 'CODE_MISMATCH' });
    expect(CodePassword.spend(sent.password)).toBeUndefined();
  });
});

describe('the CPace exchange keeps its secrets', () => {
  it("never returns, logs or keeps K: each overwritten, in no message, result, error or snapshot", async () => {
    const logs = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((name) => vi.spyOn(console, name));
    for (const typed of ['ABCD-1234', 'ABCD-1243']) {
      const a = watched(webCrypto);
      const b = watched(noble);
      const result = await exchange({ a: a.provider, b: b.provider, typed });
      const shares = new Set([hex(result.transcript[0].subarray(16, 48)), hex(result.transcript[1].subarray(0, 32))]);
      const ks = [...a.x25519s, ...b.x25519s].filter((call) => !shares.has(hex(call.copy)));
      expect(ks).toHaveLength(2);
      const seen = [
        ...result.transcript.map(hex),
        ...[result.receiver.isk, result.sender.isk].filter(Boolean).map((isk) => hex(isk!)),
        ...[result.receiver.error, result.sender.error].filter(Boolean).map((err) => `${JSON.stringify(err)} ${(err as Error).message} ${inspect(err)}`),
        JSON.stringify(result.objects), inspect(result.objects, { showHidden: true, depth: 5 }),
      ].join(' ');
      for (const k of ks) {
        expect(isZero(k.out), typed).toBe(true);
        expect(seen, typed).not.toContain(hex(k.copy));
        expect(seen, typed).not.toContain(hex(k.copy.subarray(0, 8)));
      }
      expect(JSON.stringify(result.objects)).toBe('{"receiver":{},"sender":{}}');
    }
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it("overwrites the password's bytes, the generator string, the generator and the confirmation key once each is used", async () => {
    const spent: Uint8Array[] = [];
    const spend = CodePassword.spend.bind(CodePassword);
    vi.spyOn(CodePassword, 'spend').mockImplementation((password) => {
      const bytes = spend(password);
      if (bytes) spent.push(bytes);
      return bytes;
    });
    for (const typed of ['ABCD-1234', 'ABCD-1243']) {
      const a = watched(webCrypto);
      const b = watched(noble);
      await exchange({ a: a.provider, b: b.provider, typed });
      for (const w of [a, b]) {
        // The first SHA-512 is the generator string's; the first X25519, the share's, of the generator.
        expect(isZero(w.sha512Inputs[0]), typed).toBe(true);
        expect(isZero(w.x25519s[0].given), typed).toBe(true);
        // Every HMAC's key is the confirmation key.
        expect(w.hmacKeys.length, typed).toBeGreaterThan(0);
        for (const key of w.hmacKeys) expect(isZero(key), typed).toBe(true);
      }
    }
    expect(spent).toHaveLength(4);
    for (const bytes of spent) expect(isZero(bytes)).toBe(true);
  });

  it('overwrites the ISK once its function is done, even when that function fails', async () => {
    const roomNonce = webCrypto.randomBytes(16);
    const sender = cpaceResponder(webCrypto, { password: parseCode('ABCD-1234').password, locator: 'AB', roomNonce });
    const receiver = cpaceInitiator(webCrypto, { password: parseCode('ABCD-1234').password, locator: 'AB', roomNonce, attemptId: webCrypto.randomBytes(16) });
    const { message2 } = await sender.readMessage1(await receiver.writeMessage1());
    let given: Uint8Array | undefined;
    const failure = new Error('The key schedule failed.');
    await expect(receiver.readMessage2(message2, (isk) => {
      given = isk;
      throw failure;
    })).rejects.toBe(failure);
    expect(given).toHaveLength(64);
    expect(isZero(given!)).toBe(true);
  });

  it('closed, lets go of everything: every later call fails, and an unused password is forgotten', async () => {
    const roomNonce = webCrypto.randomBytes(16);
    const sent = parseCode('ABCD-1234');
    const sender = cpaceResponder(webCrypto, { password: sent.password, locator: 'AB', roomNonce });
    sender.close();
    expect(CodePassword.spend(sent.password)).toBeUndefined();
    const receiver = cpaceInitiator(webCrypto, { password: parseCode('ABCD-1234').password, locator: 'AB', roomNonce, attemptId: webCrypto.randomBytes(16) });
    await expect(sender.readMessage1(await receiver.writeMessage1())).rejects.toMatchObject({ code: 'CODE_MISMATCH' });
    receiver.close();
    await expect(receiver.readMessage2(new Uint8Array(99), () => undefined)).rejects.toMatchObject({ code: 'CODE_MISMATCH' });
  });
});

describe('the CPace exchange, used wrongly', () => {
  const roomNonce = new Uint8Array(16);
  const attemptId = new Uint8Array(16);

  it('a message out of turn changes nothing', async () => {
    const receiver = cpaceInitiator(webCrypto, { password: parseCode('ABCD-1234').password, locator: 'AB', roomNonce, attemptId });
    await expect(receiver.readMessage2(new Uint8Array(99), () => undefined)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(await receiver.writeMessage1()).toHaveLength(51);
    await expect(receiver.writeMessage1()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const sender = cpaceResponder(webCrypto, { password: parseCode('ABCD-1234').password, locator: 'AB', roomNonce });
    await expect(sender.readMessage3(new Uint8Array(64), () => undefined)).rejects.toMatchObject({ code: 'CODE_MISMATCH' });
  });

  it("refuses options that aren't right, before anything is spent", () => {
    const password = parseCode('ABCD-1234').password;
    const base = { password, locator: 'AB', roomNonce, attemptId };
    for (const options of [
      { ...base, password: 'CD1234' }, { ...base, locator: 'A' }, { ...base, locator: 'ABCD' }, { ...base, locator: 'AI' },
      { ...base, locator: 'ab' }, { ...base, roomNonce: new Uint8Array(15) }, { ...base, attemptId: new Uint8Array(17) },
      { ...base, version: { major: 256, minor: 0 } }, { ...base, version: { major: 4, minor: -1 } }, undefined,
    ]) {
      expect(() => cpaceInitiator(webCrypto, options as never)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    }
    expect(() => cpaceResponder(webCrypto, { ...base, roomNonce: 'nonce' } as never)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(CodePassword.spend(password)).toHaveLength(6);
  });

  it('hands the ISK on only to a function', async () => {
    const receiver = cpaceInitiator(webCrypto, { password: parseCode('ABCD-1234').password, locator: 'AB', roomNonce, attemptId });
    await receiver.writeMessage1();
    await expect(receiver.readMessage2(new Uint8Array(99), undefined as never)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('takes the AD version given, for a test', async () => {
    const sender = cpaceResponder(webCrypto, { password: parseCode('ABCD-1234').password, locator: 'AB', roomNonce, version: { major: 4, minor: 7 } });
    const receiver = cpaceInitiator(webCrypto, { password: parseCode('ABCD-1234').password, locator: 'AB', roomNonce, attemptId, version: { major: 4, minor: 3 } });
    const read = await sender.readMessage1(await receiver.writeMessage1());
    expect(read.peerVersion).toEqual({ major: 4, minor: 3 });
    expect((await receiver.readMessage2(read.message2, () => undefined)).peerVersion).toEqual({ major: 4, minor: 7 });
  });
});

describe('offline guessing: a failed exchange holds nothing a guess at the code could be checked against', () => {
  it('no plain hash or MAC of the code or the password, nor either generator, is anywhere in its transcript', async () => {
    const a = watched(webCrypto);
    const b = watched(webCrypto);
    const result = await exchange({ a: a.provider, b: b.provider, sent: 'ABCD-1234', typed: 'ABCD-1243' });
    expectBothMismatched(result);
    // Every 8-byte run of the transcript.
    const runs = new Set<string>();
    for (const message of result.transcript) for (let i = 0; i + 8 <= message.byteLength; i++) runs.add(hex(message.subarray(i, i + 8)));
    const appears = (value: Uint8Array) => {
      for (let i = 0; i + 8 <= value.byteLength; i++) if (runs.has(hex(value.subarray(i, i + 8)))) return true;
      return false;
    };
    const whole = hex(concat(...result.transcript));

    const candidates: Array<[string, Uint8Array]> = [];
    for (const text of ['CD1234', 'CD1243', 'ABCD-1234', 'ABCD1234', 'ABCD-1243', 'ABCD1243', 'abcd-1234', 'cd1234']) {
      // The text itself is under 8 bytes for a password: looked for whole.
      expect(whole, text).not.toContain(hex(ascii(text)));
      for (const algorithm of ['sha1', 'sha256', 'sha512', 'sha3-256', 'md5']) candidates.push([`${algorithm}(${text})`, createHash(algorithm).update(text).digest()]);
      for (const algorithm of ['sha256', 'sha512']) {
        candidates.push([`hmac-${algorithm}(${text}, "")`, createHmac(algorithm, text).update('').digest()]);
        for (const [i, message] of result.transcript.entries()) {
          candidates.push([`hmac-${algorithm}(${text}, message ${i + 1})`, createHmac(algorithm, text).update(message).digest()]);
          candidates.push([`hmac-${algorithm}(message ${i + 1}, ${text})`, createHmac(algorithm, message.byteLength ? message : 'x').update(text).digest()]);
        }
      }
    }
    // Each side's generator (the u of its share's X25519) and the hash it was mapped from (the
    // generator string holds the public sid too, so it's the password's part that's looked for above).
    for (const [side, w] of [['receiver', a], ['sender', b]] as const) {
      candidates.push([`${side}'s generator`, w.x25519s[0].u]);
      candidates.push([`${side}'s generator hash`, createHash('sha512').update(w.sha512s[0]).digest()]);
    }
    for (const [name, value] of candidates) expect(appears(value), name).toBe(false);
  });

  it("nor is the generator or a hash of the password, for any of 10,000 guesses that share the code's letters", async () => {
    const result = await exchange({ sent: 'ABCD-1234', typed: 'ABCD-1243' });
    const runs = new Set<string>();
    for (const message of result.transcript) for (let i = 0; i + 8 <= message.byteLength; i++) runs.add(hex(message.subarray(i, i + 8)));
    // What anyone recording the exchange knows: the locator, the room's nonce and the attempt ID.
    const ci = lv(ascii('dropgate/4 dgdtp cpace'), ascii('receiver'), ascii('sender'), ascii('AB'));
    const sid = concat(result.roomNonce, result.transcript[0].subarray(0, 16));
    let tried = 0;
    for (let n = 0; n < 10_000; n++) {
      const guess = ascii(`CD${String(n).padStart(4, '0')}`);
      const g = await calculateGenerator(webCrypto, guess, ci, sid);
      const hashed = createHash('sha512').update(guess).digest();
      for (const value of [g, hashed]) {
        for (let i = 0; i + 8 <= value.byteLength; i++) expect(runs.has(hex(value.subarray(i, i + 8)))).toBe(false);
      }
      tried++;
    }
    expect(tried).toBe(10_000);
  }, 60_000);
});
