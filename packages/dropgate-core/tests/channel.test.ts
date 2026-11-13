import { afterEach, describe, it, expect, vi } from 'vitest';
import { inspect } from 'node:util';
import { nobleProvider, webCryptoProvider, type CryptoProvider, type NamedCryptoProvider } from '../src/crypto/index.js';
import {
  MAX_HELLO_BYTES, connectByCode, connectByLink, openRoom, reconnect, type SecureChannel,
} from '../src/dgdtp/channel.js';
import { MAX_GENERATION } from '../src/dgdtp/prologue.js';
import { hex } from './helpers/cpace-vectors.js';
import {
  WRONG_CODE, channelChecks, channels, codeTransfer, ending, transfer, wrongDigit, type Transfer,
} from './helpers/channel-checks.js';
import { FAKE_LOW_WATER_BYTES, MockRendezvous, PeerPair, pipePair, type Relay } from './helpers/fake-channel.js';
// The second implementations: plain JavaScript on node:crypto, written from the formats.
import * as referencePrologue from './helpers/reference-prologue.mjs';
import * as referenceSignal from './helpers/reference-signal.mjs';

// A direct transfer's secure channel end to end (src/dgdtp/channel.ts), on
// each of core's crypto providers and across them, over a mock rendezvous and
// fake peer connections with fake SDP (tests/helpers/fake-channel.ts): by link,
// by code and on resume, through the room's ID and nonce, CPace, sealed
// signalling, the prologue from both fingerprints, Noise and BIND, to the
// out-of-band close. Then what ends an attempt: a code that doesn't match (each
// side in its own words), a fingerprint swapped by something holding the
// signalling keys, a message 1 that isn't empty, a BIND that isn't one, a frame
// that doesn't open, the rendezvous or the data channel going; each with every
// key let go and nothing after the handshake sent. And what leaves the device:
// of a code, only its locator; nothing secret in any record, error or log.

const webCrypto = webCryptoProvider(globalThis.crypto);
const noble = nobleProvider(globalThis.crypto);
const PROVIDERS: Array<[string, NamedCryptoProvider]> = [['WebCrypto', webCrypto], ['@noble', noble]];
const MISMATCH = 'SECURITY_POLICY_MISMATCH';
const PSK_LABEL = 'dropgate/4 dgdtp psk';
const ROOM_LABEL = 'dropgate/4 dgdtp room';
const NOISE_NAME = new TextEncoder().encode('Noise_NNpsk0_25519_AESGCM_SHA256');

afterEach(() => {
  vi.restoreAllMocks();
});

const codeOf = (err: unknown) => String((err as { code?: string })?.code ?? err);
const outcomeOf = (result: PromiseSettledResult<unknown>) => (result.status === 'fulfilled' ? 'up' : codeOf(result.reason));
const codes = (t: Pick<Transfer, 'receiver' | 'sender'>) => `${outcomeOf(t.receiver)} / ${outcomeOf(t.sender)}`;
const allZero = (bytes: Uint8Array) => bytes.every((b) => b === 0);
/** The data channel's abort: one zero byte. */
const isAbort = (m: Uint8Array) => m.byteLength === 1 && m[0] === 0;
const ascii = (text: string) => new TextEncoder().encode(text);

/** Whether `needle`'s bytes appear anywhere in `haystack`. */
function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.byteLength <= haystack.byteLength; i++) {
    for (let j = 0; j < needle.byteLength; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * `provider`, watched: every PSK and room ID the key schedule makes and every
 * random byte string handed out, as the very arrays core holds (so a test sees
 * them overwritten), the PSKs also copied when made; and each prologue Noise
 * hashes in.
 */
function watched(provider: CryptoProvider) {
  const made = { psk: [] as Uint8Array[], pskAtBirth: [] as string[], roomId: [] as Uint8Array[], random: [] as Uint8Array[], prologues: [] as string[] };
  const watchedProvider: CryptoProvider = {
    ...provider,
    hkdf: async (ikm, salt, info, length) => {
      const out = await provider.hkdf(ikm, salt, info, length);
      const label = new TextDecoder().decode(info);
      if (label === PSK_LABEL) {
        made.psk.push(out);
        made.pskAtBirth.push(hex(out));
      }
      if (label === ROOM_LABEL) made.roomId.push(out);
      return out;
    },
    randomBytes: (length) => {
      const out = provider.randomBytes(length);
      made.random.push(out);
      return out;
    },
    sha256: async (data) => {
      // Noise's first hash: its name (h at the start), then the prologue.
      if (data.byteLength === 32 + 131 && NOISE_NAME.every((b, i) => data[i] === b)) made.prologues.push(hex(data.subarray(32)));
      return provider.sha256(data);
    },
  };
  return { provider: watchedProvider, made };
}

/** A relay that changes the `index`th message (from 0) `from` one side with `change`, passing the rest. */
const changing = (from: 'receiver' | 'sender', index: number, change: (message: Uint8Array) => Uint8Array): Relay => {
  let n = 0;
  return (side, message) => {
    if (side !== from) return [message];
    return [n++ === index ? change(new Uint8Array(message)) : message];
  };
};
const flip = (at: number) => (message: Uint8Array) => {
  message[at < 0 ? message.byteLength + at : at] ^= 1;
  return message;
};

describe.each(PROVIDERS)('the secure channel end to end, on %s', (_name, provider) => {
  it('every check holds', async () => {
    const checks = await channelChecks(provider);
    expect(checks.filter(({ expected, actual }) => expected !== actual)).toEqual([]);
    expect(checks.length).toBe(33);
  });

  it('by code: both sides derive the same PSK, the handshake completes, and the handshake hashes match', async () => {
    const r = watched(provider);
    const s = watched(provider);
    const t = await codeTransfer(provider, (code) => code, { receiverProvider: r.provider, senderProvider: s.provider });
    expect(ending(t)).toBe('up / up, the same handshake hash');
    expect(r.made.pskAtBirth).toHaveLength(1);
    expect(s.made.pskAtBirth).toEqual(r.made.pskAtBirth);
    // Each PSK overwritten once Noise took it.
    for (const psk of [...r.made.psk, ...s.made.psk]) expect(allZero(psk)).toBe(true);
    const { receiver, sender } = channels(t);
    expect([receiver.mode, sender.mode, receiver.generation, sender.generation]).toEqual(['code', 'code', 0n, 0n]);
    expect(hex(receiver.attemptId)).toBe(hex(sender.attemptId));
    expect(hex(receiver.roomNonce)).toBe(hex(t.room.roomNonce));
  });

  it("by link: the PSK is the second implementation's, from the link's secret, the room's nonce and the attempt's ID", async () => {
    const r = watched(provider);
    const s = watched(provider);
    const t = await transfer(provider, { receiverProvider: r.provider, senderProvider: s.provider });
    expect(ending(t)).toBe('up / up, the same handshake hash');
    const { receiver } = channels(t);
    const want = referenceSignal.keySchedule({
      mode: 'link', base: hex(t.room.linkSecret() as Uint8Array), roomNonce: hex(t.room.roomNonce), attemptId: hex(receiver.attemptId), closeSecret: '00'.repeat(32),
    });
    expect(r.made.pskAtBirth).toEqual([want.psk]);
    expect(s.made.pskAtBirth).toEqual([want.psk]);
    // The attempt ID is the receiver's own, from its provider; the room nonce the sender's.
    expect(r.made.random.map((b) => b.byteLength)).toEqual([16, 32]);
    expect(hex(r.made.random[0])).toBe(hex(receiver.attemptId));
    expect(hex(s.made.random[1])).toBe(hex(t.room.roomNonce));
  });

  it("the prologue Noise hashes in is the second implementation's, from the fingerprints in the SDP each side applied", async () => {
    for (const how of ['link', 'code'] as const) {
      const r = watched(provider);
      const s = watched(provider);
      const options = { receiverProvider: r.provider, senderProvider: s.provider };
      const t = how === 'link' ? await transfer(provider, options) : await codeTransfer(provider, (code) => code, options);
      expect(ending(t)).toBe('up / up, the same handshake hash');
      const { receiver } = channels(t);
      const want = referencePrologue.prologue({
        mode: how, roomNonce: hex(t.room.roomNonce), attemptId: hex(receiver.attemptId), generation: 0,
        receiverFingerprint: hex(t.peers.receiver.fingerprint), senderFingerprint: hex(t.peers.sender.fingerprint),
      });
      expect(r.made.prologues).toEqual([want]);
      expect(s.made.prologues).toEqual([want]);
    }
  });

  it('a resume: its keys from R in resume mode, the generation one past the last, a new attempt and a new handshake', async () => {
    const first = await transfer(provider);
    expect(ending(first)).toBe('up / up, the same handshake hash');
    const resumeSecret = provider.randomBytes(32);
    let previous = channels(first).receiver;
    for (const generation of [1n, 2n]) {
      // The room's provider is the sender's: the receiver's is watched.
      const r = watched(provider);
      const pipe = pipePair();
      const peers = new PeerPair();
      const [rr, ss] = await Promise.allSettled([
        reconnect(r.provider, { pipe: pipe.receiver, roomNonce: first.room.roomNonce, resumeSecret, previousGeneration: generation - 1n, peer: peers.receiver }),
        first.room.accept({ by: 'resume', pipe: pipe.sender, resumeSecret, previousGeneration: generation - 1n }, { peer: peers.sender }),
      ]);
      expect(codes({ receiver: rr, sender: ss })).toBe('up / up');
      const receiver = (rr as PromiseFulfilledResult<SecureChannel>).value;
      const sender = (ss as PromiseFulfilledResult<SecureChannel>).value;
      expect([receiver.mode, sender.mode, receiver.generation, sender.generation]).toEqual(['resume', 'resume', generation, generation]);
      expect(hex(receiver.handshakeHash)).toBe(hex(sender.handshakeHash));
      expect(hex(receiver.handshakeHash)).not.toBe(hex(previous.handshakeHash));
      expect(hex(receiver.attemptId)).not.toBe(hex(previous.attemptId));
      const roomNonce = hex(first.room.roomNonce);
      const attemptId = hex(receiver.attemptId);
      expect(r.made.pskAtBirth).toEqual([referenceSignal.keySchedule({ mode: 'resume', base: hex(resumeSecret), roomNonce, attemptId, closeSecret: '00'.repeat(32) }).psk]);
      expect(r.made.prologues).toEqual([referencePrologue.prologue({
        mode: 'resume', roomNonce, attemptId, generation, receiverFingerprint: hex(peers.receiver.fingerprint), senderFingerprint: hex(peers.sender.fingerprint),
      })]);
      previous = receiver;
    }
  });

  it('a wrong code ends both sides with CODE_MISMATCH, each in its own words, carrying nothing else', async () => {
    const t = await codeTransfer(provider, wrongDigit);
    expect(ending(t)).toBe(`${WRONG_CODE.receiver} / ${WRONG_CODE.sender}`);
    for (const [side, result] of [['receiver', t.receiver], ['sender', t.sender]] as const) {
      const err = (result as PromiseRejectedResult).reason;
      expect(JSON.stringify(err)).toBe(JSON.stringify({ name: 'DropgateError', code: 'CODE_MISMATCH', message: WRONG_CODE[side].slice('CODE_MISMATCH: '.length), origin: 'peer', retryable: false }));
      expect(err.cause).toBeUndefined();
    }
    // No data channel was ever opened: nothing reached the sender's network.
    expect(t.peers.data).toBeUndefined();
    expect(t.peers.receiver.remote).toBeUndefined();
  });

  it("every abort in the code's exchange ends both sides with CODE_MISMATCH: message 2 an abort, a Tb or a Ta that doesn't match, a message cut short", async () => {
    const cases: Array<[string, Relay]> = [
      ['an abort in place of message 2', changing('sender', 0, () => new Uint8Array(0))],
      ["a Tb that doesn't match", changing('sender', 0, flip(-1))],
      ["a Ta that doesn't match", changing('receiver', 1, flip(0))],
      ['message 1 a byte short', changing('receiver', 0, (m) => m.slice(1))],
      ["message 1's attempt ID changed", changing('receiver', 0, flip(0))],
    ];
    for (const [what, relay] of cases) {
      const t = await codeTransfer(provider, (code) => code, { relay: () => relay });
      expect(ending(t), what).toBe(`${WRONG_CODE.receiver} / ${WRONG_CODE.sender}`);
    }
  });

  it('a code is used once: afterwards the room has none, a second try with the right code is CODE_MISMATCH both sides, and the link still connects', async () => {
    const rendezvous = new MockRendezvous();
    const room = await openRoom(provider, { rendezvous: rendezvous.sender, code: true });
    const code = room.code as string;
    const attempt = async (by: 'code' | 'link', typed?: string) => {
      const peers = new PeerPair();
      const sender = rendezvous.nextAttempt().then((a) => room.accept(a, { peer: peers.sender }));
      const receiver = by === 'code'
        ? connectByCode(provider, { rendezvous: rendezvous.receiver, code: typed as string, peer: peers.receiver })
        : connectByLink(provider, { rendezvous: rendezvous.receiver, secret: room.linkSecret() as Uint8Array, peer: peers.receiver });
      const [r, s] = await Promise.allSettled([receiver, sender]);
      return codes({ receiver: r, sender: s });
    };
    expect(await attempt('code', wrongDigit(code))).toBe('CODE_MISMATCH / CODE_MISMATCH');
    expect(room.code).toBeUndefined();
    expect(await attempt('code', code)).toBe('CODE_MISMATCH / CODE_MISMATCH');
    expect(await attempt('link')).toBe('up / up');
  });

  it('of a code, only the locator leaves the device: the join is the locator alone, and no form of the code is in anything either side sends', async () => {
    const encodings = (text: string) => [ascii(text), Uint8Array.from([...text].flatMap((c) => [c.charCodeAt(0), 0])), Uint8Array.from([...text].flatMap((c) => [0, c.charCodeAt(0)]))];
    for (const [what, typed, want] of [['right', (c: string) => c, 'up / up'], ['wrong', wrongDigit, 'CODE_MISMATCH / CODE_MISMATCH']] as const) {
      const rendezvous = new MockRendezvous();
      const room = await openRoom(provider, { rendezvous: rendezvous.sender, code: true });
      const code = room.code as string;
      const peers = new PeerPair();
      const sender = rendezvous.nextAttempt().then((a) => room.accept(a, { peer: peers.sender }));
      // Typed as someone might: lower case, spaces, no dash.
      const entered = typed(code);
      const receiver = connectByCode(provider, { rendezvous: rendezvous.receiver, code: ` ${entered.toLowerCase().replace('-', ' ')} `, peer: peers.receiver });
      const [r, s] = await Promise.allSettled([receiver, sender]);
      expect(codes({ receiver: r, sender: s }), what).toBe(want);
      const sent = [...rendezvous.records.map((x) => x.bytes), ...(peers.data ? [...peers.data.sent.receiver, ...peers.data.sent.sender] : [])];
      expect(sent.length, what).toBeGreaterThan(3);
      const forms = new Set<string>();
      for (const c of [code, entered]) {
        const password = c.slice(2).replace('-', '');
        for (const form of [c, c.replace('-', ''), c.slice(2), password]) {
          forms.add(form);
          forms.add(form.toLowerCase());
        }
      }
      for (const form of forms) {
        for (const bytes of encodings(form)) for (const message of sent) expect(contains(message, bytes), `${what}: ${form}`).toBe(false);
      }
      const joins = rendezvous.records.filter((x) => x.what === 'join');
      expect(joins.map((x) => new TextDecoder().decode(x.bytes)), what).toEqual([code.slice(0, 2)]);
    }
  });

  it('a code that isn\'t one is INVALID_CODE before anything is sent', async () => {
    const rendezvous = new MockRendezvous();
    await openRoom(provider, { rendezvous: rendezvous.sender, code: true });
    const before = rendezvous.records.length;
    const peers = new PeerPair();
    for (const typed of ['ABCI-1234', 'ABCD-12345', 'AB-1234', '']) {
      await expect(connectByCode(provider, { rendezvous: rendezvous.receiver, code: typed, peer: peers.receiver })).rejects.toMatchObject({ code: 'INVALID_CODE' });
    }
    expect(rendezvous.records.length).toBe(before);
    expect(peers.receiver.local).toBeUndefined();
  });

  it("a swapped fingerprint ends both sides with SECURITY_POLICY_MISMATCH: the sender's message 2 and the receiver's BIND are never sent", async () => {
    const { fingerprintSwapper } = await import('./helpers/channel-checks.js');
    const hello = ascii("the sender's capabilities");
    for (const swap of [{ offer: true }, { answer: true }]) {
      const r = watched(provider);
      const s = watched(provider);
      const t = await transfer(provider, { relay: fingerprintSwapper(provider, swap), hello, receiverProvider: r.provider, senderProvider: s.provider });
      expect(codes(t)).toBe(`${MISMATCH} / ${MISMATCH}`);
      const data = t.peers.data as NonNullable<PeerPair['data']>;
      expect(data.sent.receiver[0].byteLength).toBe(48);
      expect(data.sent.receiver.slice(1).every(isAbort)).toBe(true);
      expect(data.sent.sender.length > 0 && data.sent.sender.every(isAbort)).toBe(true);
      // Each side built its prologue from what it applied, and they differ.
      expect(r.made.prologues).toHaveLength(1);
      expect(s.made.prologues).toHaveLength(1);
      expect(r.made.prologues[0]).not.toBe(s.made.prologues[0]);
      // Every key let go.
      for (const psk of [...r.made.psk, ...s.made.psk]) expect(allZero(psk)).toBe(true);
    }
  });

  it("DGDTP's message 1 is empty: one with a payload ends both sides with SECURITY_POLICY_MISMATCH, and the sender sends no message 2", async () => {
    let done = false;
    const receiverProvider: CryptoProvider = {
      ...provider,
      // The receiver's first empty plaintext sealed is Noise's message 1: give it a byte.
      encryptWithNonce: (key, nonce, plaintext, ad) => {
        if (!done && plaintext.byteLength === 0) {
          done = true;
          return provider.encryptWithNonce(key, nonce, Uint8Array.of(0x42), ad);
        }
        return provider.encryptWithNonce(key, nonce, plaintext, ad);
      },
    };
    const t = await transfer(provider, { receiverProvider });
    expect(codes(t)).toBe(`${MISMATCH} / ${MISMATCH}`);
    const data = t.peers.data as NonNullable<PeerPair['data']>;
    expect(data.sent.receiver[0].byteLength).toBe(49);
    expect(data.sent.sender.length > 0 && data.sent.sender.every(isAbort)).toBe(true);
  });

  it("a BIND that isn't one ends the sender's attempt with SECURITY_POLICY_MISMATCH, and the receiver's channel with it", async () => {
    const changes: Array<[string, (bind: Uint8Array) => Uint8Array]> = [
      ['another type', (b) => Uint8Array.of(0x02, ...b.subarray(1))],
      ['no type at all: empty', () => new Uint8Array(0)],
      ['closeSecret cut short', (b) => b.slice(0, 32)],
      ['capabilities over 1,024 bytes', (b) => Uint8Array.of(...b, ...new Uint8Array(MAX_HELLO_BYTES + 1 - (b.byteLength - 33)))],
    ];
    for (const [what, change] of changes) {
      const receiverProvider: CryptoProvider = {
        ...provider,
        // Noise's transport records have no associated data, and BIND is the receiver's first.
        encryptWithNonce: (key, nonce, plaintext, ad) => provider.encryptWithNonce(key, nonce, ad && ad.byteLength === 0 && plaintext[0] === 0x01 ? change(plaintext) : plaintext, ad),
      };
      const t = await transfer(provider, { receiverProvider });
      expect(codes(t), what).toBe(`up / ${MISMATCH}`);
      await expect(channels(t).receiver.receive(), what).rejects.toMatchObject({ code: MISMATCH });
      await expect(channels(t).receiver.send(ascii('x')), what).rejects.toMatchObject({ code: MISMATCH });
    }
    // And the largest capabilities allowed come through.
    const capabilities = new Uint8Array(MAX_HELLO_BYTES).fill(0x33);
    const t = await transfer(provider, { capabilities, hello: new Uint8Array(MAX_HELLO_BYTES).fill(0x44) });
    expect(ending(t)).toBe('up / up, the same handshake hash');
    expect(hex(channels(t).sender.peerHello)).toBe(hex(capabilities));
  });

  it("a sealed frame that doesn't open during set-up ends the receiver's attempt with SECURITY_POLICY_MISMATCH, and the sender's, its rendezvous gone, with CONNECTION_LOST", async () => {
    for (const [what, relay] of [
      ['the answer', changing('sender', 0, flip(100))],
      ['a candidate after it', changing('sender', 1, flip(-1))],
      ['an empty message where the answer goes', changing('sender', 0, () => new Uint8Array(0))],
    ] as const) {
      const t = await transfer(provider, { relay: () => relay });
      expect(codes(t), what).toBe(`${MISMATCH} / CONNECTION_LOST`);
      expect(t.peers.data, what).toBeUndefined();
    }
    // The receiver's offer refused by the sender: the sender ends with SECURITY_POLICY_MISMATCH.
    const t = await transfer(provider, { relay: () => changing('receiver', 0, flip(50)) });
    expect(codes(t)).toBe(`CONNECTION_LOST / ${MISMATCH}`);
  });

  it('the out-of-band close: one each way, a second refused, anything else on the rendezvous of its kind ignored', async () => {
    const t = await transfer(provider);
    const { receiver, sender } = channels(t);
    const pipe = t.rendezvous.pipes[0];
    // What the server could put there: junk of a close's kind and size, and the receiver's own close sent back.
    const junk = new Uint8Array(550);
    junk[0] = 0x11;
    pipe.sender.send(junk);
    await receiver.sendClose(ascii('the receiver closed'));
    const own = pipe.sent.receiver[pipe.sent.receiver.length - 1];
    pipe.sender.send(own);
    await sender.sendClose(ascii('the sender closed'));
    // Each close in its own direction, under its own key: the receiver's direction 1, the sender's 2, both counter 0.
    const theirs = pipe.sent.sender[pipe.sent.sender.length - 1];
    expect([own[0], own[1], ...own.subarray(18, 22), own.byteLength]).toEqual([0x11, 1, 0, 0, 0, 0, 550]);
    expect([theirs[0], theirs[1], ...theirs.subarray(18, 22), theirs.byteLength]).toEqual([0x11, 2, 0, 0, 0, 0, 550]);
    expect(new TextDecoder().decode(await receiver.closeReceived)).toBe('the sender closed');
    expect(new TextDecoder().decode(await sender.closeReceived)).toBe('the receiver closed');
    await expect(receiver.sendClose(ascii('again'))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(sender.sendClose(new Uint8Array(510))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    // The channel carries on.
    await receiver.send(ascii('still here'));
    expect(new TextDecoder().decode(await sender.receive())).toBe('still here');
  });

  it("a signalling frame that doesn't open after the channel is up ends it, on both sides", async () => {
    const t = await transfer(provider);
    const { receiver, sender } = channels(t);
    const junk = new Uint8Array(550);
    junk[0] = 0x10;
    junk[1] = 2;
    t.rendezvous.pipes[0].sender.send(junk);
    await expect(receiver.receive()).rejects.toMatchObject({ code: MISMATCH });
    await expect(sender.receive()).rejects.toMatchObject({ code: MISMATCH });
    await expect(sender.send(ascii('x'))).rejects.toMatchObject({ code: MISMATCH });
  });

  it('the rendezvous or the data channel going before the channel is up is CONNECTION_LOST', async () => {
    // A receiver whose sender never answers its offer, the rendezvous's pipe then closed.
    const rendezvous = new MockRendezvous();
    const room = await openRoom(provider, { rendezvous: rendezvous.sender });
    const peers = new PeerPair();
    const receiver = connectByLink(provider, { rendezvous: rendezvous.receiver, secret: room.linkSecret() as Uint8Array, peer: peers.receiver });
    const attempt = await rendezvous.nextAttempt();
    await attempt.pipe.receive();
    attempt.pipe.close();
    await expect(receiver).rejects.toMatchObject({ code: 'CONNECTION_LOST' });
    expect(peers.receiver.closed).toBe(true);
    // The data channel closing under the handshake: both sides.
    const pair = new PeerPair({ dataRelay: (from, message) => {
      if (from === 'receiver') pair.sender.close();
      return [message];
    } });
    const r2 = new MockRendezvous();
    const room2 = await openRoom(provider, { rendezvous: r2.sender });
    const sender = r2.nextAttempt().then((a) => room2.accept(a, { peer: pair.sender }));
    const receiver2 = connectByLink(provider, { rendezvous: r2.receiver, secret: room2.linkSecret() as Uint8Array, peer: pair.receiver });
    const [rr, ss] = await Promise.allSettled([receiver2, sender]);
    expect(codes({ receiver: rr, sender: ss })).toBe('CONNECTION_LOST / CONNECTION_LOST');
  });

  it('close() lets everything go: its own calls refused, the other side told by its data channel closing', async () => {
    const t = await transfer(provider);
    const { receiver, sender } = channels(t);
    receiver.close();
    await expect(receiver.send(ascii('x'))).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' });
    await expect(receiver.receive()).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' });
    await expect(receiver.sendClose(ascii('x'))).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' });
    await expect(sender.receive()).rejects.toMatchObject({ code: 'CONNECTION_LOST' });
    expect(t.peers.receiver.closed).toBe(true);
    expect(t.peers.sender.closed).toBe(true);
    // A record too long is refused as it is, the channel left as it was.
    const t2 = await transfer(provider);
    await expect(channels(t2).receiver.send(new Uint8Array(65520))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await channels(t2).receiver.send(ascii('fine'));
    expect(new TextDecoder().decode(await channels(t2).sender.receive())).toBe('fine');
  });

  it("the receiver's first frame is its offer and the sender's its answer, one each: anything else ends the attempt", async () => {
    const { resealer } = await import('./helpers/channel-checks.js');
    const candidate = { type: 'candidate', candidate: 'candidate:9 1 udp 1 192.0.2.9 9 typ host', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: null } as const;
    const cases: Array<[string, Parameters<typeof resealer>[1], string]> = [
      ['a candidate before the offer', (from, m) => (from === 'receiver' && m.type === 'offer' ? [candidate, m] : [m]), `CONNECTION_LOST / ${MISMATCH}`],
      ['a second offer', (from, m) => (from === 'receiver' && m.type === 'offer' ? [m, m] : [m]), `CONNECTION_LOST / ${MISMATCH}`],
      ['the end of candidates before the answer', (from, m) => (from === 'sender' && m.type === 'answer' ? [{ type: 'end-of-candidates' }, m] : [m]), `${MISMATCH} / CONNECTION_LOST`],
      ['a second answer', (from, m) => (from === 'sender' && m.type === 'answer' ? [m, m] : [m]), `${MISMATCH} / CONNECTION_LOST`],
    ];
    for (const [what, edit, want] of cases) {
      const t = await transfer(provider, { relay: resealer(provider, edit) });
      expect(codes(t), what).toBe(want);
    }
    // And the same relay passing everything as it is changes nothing.
    expect(ending(await transfer(provider, { relay: resealer(provider, (_from, m) => [m]) }))).toBe('up / up, the same handshake hash');
  });

  it("a restart request from the sender is ignored, and a candidate the peer connection can't use is skipped", async () => {
    const { resealer } = await import('./helpers/channel-checks.js');
    const t = await transfer(provider, {
      relay: resealer(provider, (from, m) => (from === 'sender' && m.type === 'answer' ? [m, { type: 'restart' }] : [m])),
      peers: (peers) => {
        peers.receiver.refuseFirstCandidate = true;
        peers.sender.refuseFirstCandidate = true;
      },
    });
    expect(ending(t)).toBe('up / up, the same handshake hash');
    // Each side took the other's second candidate and the end of them.
    expect(t.peers.receiver.remoteCandidates.length).toBe(2);
    expect(t.peers.sender.remoteCandidates.length).toBe(2);
  });

  it("the sender's opened BIND, which holds the close secret, is overwritten once the close keys are made", async () => {
    const opened: Uint8Array[] = [];
    const senderProvider: CryptoProvider = {
      ...provider,
      decryptWithNonce: async (key, nonce, sealed, ad) => {
        const out = await provider.decryptWithNonce(key, nonce, sealed, ad);
        if (ad && ad.byteLength === 0 && out[0] === 0x01 && out.byteLength >= 33) opened.push(out);
        return out;
      },
    };
    const t = await transfer(provider, { senderProvider, capabilities: ascii('caps') });
    expect(ending(t)).toBe('up / up, the same handshake hash');
    expect(opened).toHaveLength(1);
    expect(allZero(opened[0])).toBe(true);
    expect(new TextDecoder().decode(channels(t).sender.peerHello)).toBe('caps');
  });

  it('every attempt has an attempt ID of its own: two receivers by the same link', async () => {
    const rendezvous = new MockRendezvous();
    const room = await openRoom(provider, { rendezvous: rendezvous.sender });
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const peers = new PeerPair();
      const sender = rendezvous.nextAttempt().then((a) => room.accept(a, { peer: peers.sender }));
      const receiver = await connectByLink(provider, { rendezvous: rendezvous.receiver, secret: room.linkSecret() as Uint8Array, peer: peers.receiver });
      expect(hex((await sender).attemptId)).toBe(hex(receiver.attemptId));
      ids.push(hex(receiver.attemptId));
    }
    expect(new Set(ids).size).toBe(2);
  });
});

describe('the secure channel across providers', () => {
  it('a receiver on WebCrypto and a sender on @noble, and the other way round, by link and by code', async () => {
    for (const [receiverProvider, senderProvider] of [[webCrypto, noble], [noble, webCrypto]]) {
      expect(ending(await transfer(webCrypto, { receiverProvider, senderProvider }))).toBe('up / up, the same handshake hash');
      expect(ending(await codeTransfer(webCrypto, (code) => code, { receiverProvider, senderProvider }))).toBe('up / up, the same handshake hash');
    }
  });
});

describe("the secure channel's secrets and checks", () => {
  it('every failure, and every close, leaves no PSK, room ID or close secret behind', async () => {
    const runs: Array<[string, (r: CryptoProvider, s: CryptoProvider) => Promise<Transfer>]> = [
      ['a wrong code', (r, s) => codeTransfer(webCrypto, wrongDigit, { receiverProvider: r, senderProvider: s })],
      ['a frame that doesn\'t open', (r, s) => transfer(webCrypto, { receiverProvider: r, senderProvider: s, relay: () => changing('sender', 0, flip(100)) })],
      ['a transfer that came up, then closed', async (r, s) => {
        const t = await transfer(webCrypto, { receiverProvider: r, senderProvider: s });
        channels(t).receiver.close();
        channels(t).sender.close();
        return t;
      }],
    ];
    for (const [what, run] of runs) {
      const r = watched(webCrypto);
      const s = watched(webCrypto);
      const t = await run(r.provider, s.provider);
      for (const secret of [...r.made.psk, ...s.made.psk, ...r.made.roomId, ...s.made.roomId]) expect(allZero(secret), what).toBe(true);
      // The receiver's 32 random bytes are its close secret.
      for (const random of r.made.random.filter((b) => b.byteLength === 32)) expect(allZero(random), what).toBe(true);
      // The link's secret stays with the room until it closes.
      const secret = s.made.random.find((b) => b.byteLength === 32) as Uint8Array;
      expect(allZero(secret), what).toBe(false);
      t.room.close();
      expect(allZero(secret), what).toBe(true);
      expect(t.room.linkSecret()).toBeUndefined();
    }
  });

  it('nothing secret in what the rendezvous sees, an error, a printed room or channel, or a log', async () => {
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const r = watched(webCrypto);
    const s = watched(webCrypto);
    const t = await transfer(webCrypto, { receiverProvider: r.provider, senderProvider: s.provider });
    const secret = t.room.linkSecret() as Uint8Array;
    const secrets = [secret, ...r.made.pskAtBirth.map((h) => Uint8Array.from(Buffer.from(h, 'hex')))];
    for (const record of t.rendezvous.records) for (const x of secrets) expect(contains(record.bytes, x)).toBe(false);
    expect(inspect(t.room)).toBe('[SenderRoom]');
    expect(JSON.stringify({ room: t.room })).toBe('{"room":"[SenderRoom]"}');
    expect(String(t.room)).toBe('[SenderRoom]');
    const shown = [inspect(channels(t).receiver, { depth: 5 }), JSON.stringify(channels(t).sender), String(channels(t).sender), JSON.stringify({ channel: channels(t).receiver })];
    expect(shown).toEqual(['[SecureChannel]', '"[SecureChannel]"', '[SecureChannel]', '{"channel":"[SecureChannel]"}']);
    const failed = await codeTransfer(webCrypto, wrongDigit);
    const swapped = await transfer(webCrypto, { relay: (await import('./helpers/channel-checks.js')).fingerprintSwapper(webCrypto, { offer: true }) });
    for (const result of [failed.receiver, failed.sender, swapped.receiver, swapped.sender]) {
      const err = (result as PromiseRejectedResult).reason;
      expect(err.cause).toBeUndefined();
      expect(err.details).toBeUndefined();
    }
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("the room's ID is overwritten once the rendezvous has it, on both sides", async () => {
    const r = watched(webCrypto);
    const s = watched(webCrypto);
    const rendezvous = new MockRendezvous();
    const room = await openRoom(s.provider, { rendezvous: rendezvous.sender });
    expect(s.made.roomId).toHaveLength(1);
    expect(allZero(s.made.roomId[0])).toBe(true);
    // The rendezvous got it whole.
    expect(allZero(rendezvous.records[0].bytes.subarray(0, 16))).toBe(false);
    const peers = new PeerPair();
    const sender = rendezvous.nextAttempt().then((a) => room.accept(a, { peer: peers.sender }));
    await connectByLink(r.provider, { rendezvous: rendezvous.receiver, secret: room.linkSecret() as Uint8Array, peer: peers.receiver });
    await sender;
    expect(r.made.roomId).toHaveLength(1);
    expect(allZero(r.made.roomId[0])).toBe(true);
    expect(hex(rendezvous.records[1].bytes)).toBe(hex(rendezvous.records[0].bytes.subarray(0, 16)));
  });

  it("refuses what isn't an attempt's before anything is sent, INVALID_ARGUMENT", async () => {
    const rendezvous = new MockRendezvous();
    const room = await openRoom(webCrypto, { rendezvous: rendezvous.sender });
    const before = rendezvous.records.length;
    const peers = new PeerPair();
    const secret = room.linkSecret() as Uint8Array;
    const bad: Array<() => Promise<unknown>> = [
      () => connectByLink(webCrypto, { rendezvous: rendezvous.receiver, secret: secret.slice(1), peer: peers.receiver }),
      () => connectByLink(webCrypto, { rendezvous: rendezvous.receiver, secret, peer: undefined as never }),
      () => connectByLink(webCrypto, { rendezvous: rendezvous.receiver, secret, peer: peers.receiver, hello: new Uint8Array(MAX_HELLO_BYTES + 1) }),
      () => connectByLink(webCrypto, { rendezvous: rendezvous.receiver, secret, peer: peers.receiver, hello: 'hi' as never }),
      () => reconnect(webCrypto, { pipe: pipePair().receiver, roomNonce: room.roomNonce, resumeSecret: new Uint8Array(31), previousGeneration: 0n, peer: peers.receiver }),
      () => reconnect(webCrypto, { pipe: pipePair().receiver, roomNonce: room.roomNonce, resumeSecret: new Uint8Array(32), previousGeneration: MAX_GENERATION, peer: peers.receiver }),
      () => reconnect(webCrypto, { pipe: pipePair().receiver, roomNonce: room.roomNonce, resumeSecret: new Uint8Array(32), previousGeneration: -1n, peer: peers.receiver }),
      () => reconnect(webCrypto, { pipe: pipePair().receiver, roomNonce: room.roomNonce, resumeSecret: new Uint8Array(32), previousGeneration: 0 as never, peer: peers.receiver }),
      () => reconnect(webCrypto, { pipe: undefined as never, roomNonce: room.roomNonce, resumeSecret: new Uint8Array(32), previousGeneration: 0n, peer: peers.receiver }),
      () => room.accept({ by: 'other' as never, pipe: pipePair().sender }, { peer: peers.sender }),
      () => room.accept({ by: 'resume', pipe: pipePair().sender, resumeSecret: new Uint8Array(16), previousGeneration: 0n }, { peer: peers.sender }),
      () => room.accept({ by: 'link', pipe: pipePair().sender }, { peer: peers.sender, hello: new Uint8Array(MAX_HELLO_BYTES + 1) }),
      () => openRoom(webCrypto, { rendezvous: undefined as never }),
    ];
    for (const run of bad) await expect(run()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(rendezvous.records.length).toBe(before);
    expect(peers.receiver.local).toBeUndefined();
    // The last generation resumed once more is the last one 8 bytes hold.
    const pipe = pipePair();
    const pair = new PeerPair();
    const resumeSecret = new Uint8Array(32).fill(9);
    const [rr, ss] = await Promise.allSettled([
      reconnect(webCrypto, { pipe: pipe.receiver, roomNonce: room.roomNonce, resumeSecret, previousGeneration: MAX_GENERATION - 1n, peer: pair.receiver }),
      room.accept({ by: 'resume', pipe: pipe.sender, resumeSecret, previousGeneration: MAX_GENERATION - 1n }, { peer: pair.sender }),
    ]);
    expect(codes({ receiver: rr, sender: ss })).toBe('up / up');
    expect((rr as PromiseFulfilledResult<SecureChannel>).value.generation).toBe(MAX_GENERATION);
    // A closed room takes no link attempt.
    room.close();
    await expect(room.accept({ by: 'link', pipe: pipePair().sender }, { peer: new PeerPair().sender })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it("the rendezvous's answers that aren't what they must be: INVALID_RESPONSE", async () => {
    const peers = new PeerPair();
    const short = { join: async () => ({ roomNonce: new Uint8Array(15), pipe: pipePair().receiver }) };
    await expect(connectByLink(webCrypto, { rendezvous: short, secret: new Uint8Array(32), peer: peers.receiver })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(peers.receiver.closed).toBe(true);
    const r = watched(webCrypto);
    await expect(openRoom(r.provider, { rendezvous: { create: async () => ({ locator: 'IO' }) }, code: true })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    const secret = r.made.random.find((b) => b.byteLength === 32) as Uint8Array;
    expect(allZero(secret)).toBe(true);
    // With no locator free, the room has its link and no code.
    const room = await openRoom(webCrypto, { rendezvous: { create: async () => ({}) }, code: true });
    expect(room.code).toBeUndefined();
    expect(room.linkSecret()?.byteLength).toBe(32);
  });

  it("a room's code is drawn on this device after the rendezvous's locator, and shown only as the room's code", async () => {
    const rendezvous = new MockRendezvous();
    rendezvous.locator = 'XY';
    const room = await openRoom(webCrypto, { rendezvous: rendezvous.sender, code: true });
    expect(room.code).toMatch(/^XY[A-HJ-NP-Z]{2}-[0-9]{4}$/);
    expect(JSON.stringify(room)).toBe('"[SenderRoom]"');
    // What the rendezvous got: the room ID, the nonce and that a code was wanted, nothing of the code.
    expect(rendezvous.records).toHaveLength(1);
    expect(rendezvous.records[0].bytes.byteLength).toBe(33);
    expect(rendezvous.records[0].bytes[32]).toBe(1);
    // A server set for three locator letters: a code of three, then one letter and four digits.
    rendezvous.locator = 'XYZ';
    const three = await openRoom(webCrypto, { rendezvous: rendezvous.sender, code: true, letters: 3 });
    expect(three.code).toMatch(/^XYZ[A-HJ-NP-Z]-[0-9]{4}$/);
    // A room with no code asks for none.
    const linkOnly = await openRoom(webCrypto, { rendezvous: rendezvous.sender });
    expect(linkOnly.code).toBeUndefined();
    expect(rendezvous.records[2].bytes[32]).toBe(0);
  });

  it("a receiver's first message too short to hold a frame's header ends the sender's attempt with SECURITY_POLICY_MISMATCH", async () => {
    const rendezvous = new MockRendezvous();
    const room = await openRoom(webCrypto, { rendezvous: rendezvous.sender });
    for (const length of [0, 5, 21]) {
      const pipe = pipePair();
      const peers = new PeerPair();
      const sender = room.accept({ by: 'link', pipe: pipe.sender }, { peer: peers.sender });
      pipe.receiver.send(new Uint8Array(length).fill(0x10));
      await expect(sender, `${length} bytes`).rejects.toMatchObject({ code: MISMATCH });
      expect(peers.sender.closed).toBe(true);
    }
  });
});

describe("the secure channel's records and backpressure on its data channel", () => {
  const sizes = (t: Transfer) => `${channels(t).receiver.maxRecordBytes} / ${channels(t).sender.maxRecordBytes}`;

  it("the largest record is min(65,535, the data channel's max-message-size), each side its own", async () => {
    expect(sizes(await transfer(webCrypto))).toBe('65535 / 65535');
    const odd = await transfer(webCrypto, { maxMessageBytes: { receiver: 16384, sender: 40000.9 } });
    expect(sizes(odd)).toBe('16384 / 40000');
    expect(sizes(await transfer(webCrypto, { maxMessageBytes: { receiver: Infinity, sender: 65536 } }))).toBe('65535 / 65535');
    // A record fits its side's limit with Noise's 16-byte tag; one byte more is refused, nothing sent, and the channel carries on.
    const { receiver, sender } = channels(odd);
    const data = odd.peers.data as NonNullable<PeerPair['data']>;
    const before = data.sent.receiver.length;
    await expect(receiver.send(new Uint8Array(16369))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(data.sent.receiver.length).toBe(before);
    await receiver.send(new Uint8Array(16368).fill(1));
    expect((await sender.receive()).byteLength).toBe(16368);
    await expect(sender.send(new Uint8Array(40000 - 15))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await sender.send(new Uint8Array(40000 - 16));
    expect((await receiver.receive()).byteLength).toBe(40000 - 16);
  });

  it("a data channel that can't take 16,384 bytes ends that side CAPABILITY_UNSUPPORTED, before any handshake message", async () => {
    for (const [what, max] of [['16,383 bytes', 16383], ['no number', Number.NaN], ['not a number at all', 'large' as unknown as number]] as const) {
      const t = await transfer(webCrypto, { maxMessageBytes: { receiver: max as number } });
      expect(codes(t), what).toBe('CAPABILITY_UNSUPPORTED / CONNECTION_LOST');
      const err = (t.receiver as PromiseRejectedResult).reason;
      expect(err.origin, what).toBe('peer');
      expect(err.message, what).toBe("The other device's connection can't take messages as large as a direct transfer needs.");
      expect((t.peers.data as NonNullable<PeerPair['data']>).sent.receiver, what).toEqual([]);
    }
    const t = await transfer(webCrypto, { maxMessageBytes: { sender: 16383 } });
    expect(codes(t)).toBe(`CONNECTION_LOST / CAPABILITY_UNSUPPORTED`);
    const ok = await transfer(webCrypto, { maxMessageBytes: { receiver: 16384, sender: 16384 } });
    expect(ending(ok)).toBe('up / up, the same handshake hash');
  });

  it("writable() waits while the data channel's buffer is over the low-water mark, and fails once the channel has ended", async () => {
    const t = await transfer(webCrypto);
    const { receiver, sender } = channels(t);
    const data = t.peers.data as NonNullable<PeerPair['data']>;
    await receiver.writable();
    data.receiver.bufferedAmount = FAKE_LOW_WATER_BYTES + 1;
    let ready = false;
    const waiting = receiver.writable().then(() => { ready = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(ready).toBe(false);
    data.receiver.bufferedAmount = FAKE_LOW_WATER_BYTES;
    await waiting;
    expect(ready).toBe(true);
    // The data channel going while it waits: CONNECTION_LOST, and the channel has ended.
    data.receiver.bufferedAmount = FAKE_LOW_WATER_BYTES + 1;
    const lost = receiver.writable();
    data.receiver.close();
    await expect(lost).rejects.toMatchObject({ code: 'CONNECTION_LOST' });
    await expect(receiver.send(Uint8Array.of(1))).rejects.toMatchObject({ code: 'CONNECTION_LOST' });
    await expect(receiver.writable()).rejects.toMatchObject({ code: 'CONNECTION_LOST' });
    // Closed by this side: OPERATION_CANCELLED.
    sender.close();
    await expect(sender.writable()).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' });
  });
});
