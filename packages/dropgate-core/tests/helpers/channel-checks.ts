// A direct transfer's secure channel end to end (src/dgdtp/channel.ts), over
// the fakes in fake-channel.ts, and the DTLS binding (src/dgdtp/prologue.ts)
// against the second implementation's pinned vectors (tests/fixtures/dgdtp-
// prologue-vectors.json, from tests/helpers/reference-prologue.mjs), as one
// list of checks: each a name, what should happen and what did.
// tests/channel.test.ts runs them in Node on each provider, and the
// integration suite's core/crypto-vectors.spec.mjs runs the same code (bundled
// from tests/browser/vectors-entry.ts) in Chromium, Firefox and WebKit, so each
// engine's X25519, HKDF and AES-GCM carry the whole handshake. Nothing here uses
// Node.
import vectors from '../fixtures/dgdtp-prologue-vectors.json';
import type { CryptoProvider } from '../../src/crypto/index.js';
import {
  connectByCode, connectByLink, openRoom, reconnect, type SecureChannel, type SenderRoom,
} from '../../src/dgdtp/channel.js';
import { deriveAttemptKeys } from '../../src/dgdtp/keys.js';
import { noiseInitiator, noiseResponder } from '../../src/dgdtp/noise.js';
import { buildPrologue, prologueFromSdp, sdpFingerprint } from '../../src/dgdtp/prologue.js';
import { signalChannel, type SignalChannel, type SignalMessage } from '../../src/dgdtp/seal.js';
import { fromHex, hex, type VectorCheck } from './cpace-vectors.js';
import { MockRendezvous, PeerPair, fingerprintText, pipePair, type Relay } from './fake-channel.js';

const v = vectors.inputs;

/** X25519's base point. */
const BASE = Uint8Array.of(9, ...new Uint8Array(31));

const codeOf = (err: unknown) => String((err as { code?: string })?.code ?? err);

/** One side's outcome: `up`, or its error's code and message. */
const outcome = (result: PromiseSettledResult<SecureChannel>) =>
  (result.status === 'fulfilled' ? 'up' : `${codeOf(result.reason)}: ${(result.reason as Error)?.message}`);

export interface Transfer {
  rendezvous: MockRendezvous;
  peers: PeerPair;
  room: SenderRoom;
  receiver: PromiseSettledResult<SecureChannel>;
  sender: PromiseSettledResult<SecureChannel>;
}

/** What each side says when a code didn't match. */
export const WRONG_CODE = {
  receiver: "CODE_MISMATCH: That code didn't match. Ask the sender for the new one.",
  sender: "CODE_MISMATCH: Someone entered the wrong code. Here's a new one.",
} as const;

/** `code` with its last digit changed. */
export const wrongDigit = (code: string) => `${code.slice(0, -1)}${(Number(code.slice(-1)) + 1) % 10}`;

export interface TransferOptions {
  /** Each side's provider, if not the one given. */
  receiverProvider?: CryptoProvider;
  senderProvider?: CryptoProvider;
  /** A relay on the attempt's rendezvous pipe, made once the room's values are known. */
  relay?: (room: SenderRoom) => Relay;
  /** Each side's data channel's max-message-size, if not the fakes'. */
  maxMessageBytes?: Partial<Record<'receiver' | 'sender', number>>;
  /** A relay on the data channel. */
  dataRelay?: Relay;
  /** Set up the peers before the attempt. */
  peers?: (peers: PeerPair) => void;
  hello?: Uint8Array;
  capabilities?: Uint8Array;
}

/** One attempt by link, both sides at once, over a mock rendezvous and fake peers: how each side ended. */
export async function transfer(provider: CryptoProvider, options: TransferOptions = {}): Promise<Transfer> {
  const rendezvous = new MockRendezvous();
  const peers = new PeerPair({ dataRelay: options.dataRelay, maxMessageBytes: options.maxMessageBytes });
  options.peers?.(peers);
  const room = await openRoom(options.senderProvider ?? provider, { rendezvous: rendezvous.sender });
  const relay = options.relay?.(room);
  if (relay) rendezvous.relay = () => relay;
  const sender = rendezvous.nextAttempt().then((attempt) => room.accept(attempt, { peer: peers.sender, hello: options.hello }));
  const receiver = connectByLink(options.receiverProvider ?? provider, {
    rendezvous: rendezvous.receiver, secret: room.linkSecret() as Uint8Array, peer: peers.receiver, hello: options.capabilities,
  });
  const [r, s] = await Promise.allSettled([receiver, sender]);
  return { rendezvous, peers, room, receiver: r, sender: s };
}

/** Both sides' outcomes, `receiver / sender`; with both up, whether their handshake hashes match. */
export function ending(t: Transfer): string {
  if (t.receiver.status === 'fulfilled' && t.sender.status === 'fulfilled') {
    return hex(t.receiver.value.handshakeHash) === hex(t.sender.value.handshakeHash) ? 'up / up, the same handshake hash' : 'up / up, different handshake hashes';
  }
  return `${outcome(t.receiver)} / ${outcome(t.sender)}`;
}

/** Both channels, from a transfer that came up. */
export const channels = (t: Transfer) => ({
  receiver: (t.receiver as PromiseFulfilledResult<SecureChannel>).value,
  sender: (t.sender as PromiseFulfilledResult<SecureChannel>).value,
});

/**
 * A relay on the rendezvous that holds the attempt's signalling keys (from the
 * link's secret, which the real rendezvous never sees) and puts a fingerprint
 * of its own in the OFFER, the ANSWER or both, as something terminating DTLS
 * in the middle would have to: each frame opened, changed and sealed again at
 * its own counter, so the sealing itself still holds.
 */
export function fingerprintSwapper(provider: CryptoProvider, swap: { offer?: boolean; answer?: boolean }): (room: SenderRoom) => Relay {
  const theirs = (sdp: string) => sdp.replace(/a=fingerprint:sha-256 [0-9A-F:]+/, `a=fingerprint:sha-256 ${fingerprintText(globalThis.crypto.getRandomValues(new Uint8Array(32)))}`);
  return resealer(provider, (_from, message) => {
    if ((message.type === 'offer' && swap.offer) || (message.type === 'answer' && swap.answer)) return [{ ...message, sdp: theirs(message.sdp) }];
    return [message];
  });
}

/**
 * A relay on the rendezvous holding a link attempt's signalling keys: each
 * sealed frame opened, `edit` making the messages to send in its place, each
 * sealed again in turn, so their counters run on as the sealing requires.
 */
export function resealer(provider: CryptoProvider, edit: (from: 'receiver' | 'sender', message: SignalMessage) => SignalMessage[]): (room: SenderRoom) => Relay {
  return (room) => {
    let ready: Promise<{ asSender: SignalChannel; asReceiver: SignalChannel }> | undefined;
    return async (from, frame) => {
      if (frame[0] !== 0x10) return [frame];
      ready ??= deriveAttemptKeys(provider, { mode: 'link', base: room.linkSecret() as Uint8Array, roomNonce: room.roomNonce, attemptId: frame.slice(2, 18) })
        .then((keys) => ({ asSender: signalChannel(provider, { keys, role: 'sender' }), asReceiver: signalChannel(provider, { keys, role: 'receiver' }) }));
      const { asSender, asReceiver } = await ready;
      // What the receiver sealed is opened as the sender would, and sealed again as the receiver; and the other way.
      const [opener, sealer] = from === 'receiver' ? [asSender, asReceiver] : [asReceiver, asSender];
      const out: Uint8Array[] = [];
      for (const message of edit(from, await opener.open(frame))) out.push(await sealer.seal(message));
      return out;
    };
  };
}

/** `provider`, but its random bytes from `random` in turn and its X25519 key `ephemeral`'s, so a whole side is fixed. */
export function scripted(provider: CryptoProvider, random: Uint8Array[], ephemeral: Uint8Array): CryptoProvider {
  const queue = random.map((r) => new Uint8Array(r));
  return {
    ...provider,
    randomBytes: (length: number) => {
      const next = queue.shift();
      if (!next || next.byteLength !== length) throw new Error(`No scripted random bytes of ${length}.`);
      return next;
    },
    x25519Generate: async () => {
      const privateKey = await provider.x25519FromScalar(ephemeral);
      return { privateKey, publicKey: await provider.x25519(privateKey, BASE) };
    },
  };
}

/** Every check, run on `provider`. */
export async function channelChecks(provider: CryptoProvider): Promise<VectorCheck[]> {
  const checks: VectorCheck[] = [];
  const check = async (name: string, expected: string, run: () => Promise<string> | string) => {
    let actual: string;
    try {
      actual = await run();
    } catch (err) {
      actual = `threw ${codeOf(err)}: ${(err as Error)?.message}`;
    }
    checks.push({ name, expected, actual });
  };

  // The fingerprint rule and the prologue, against the second implementation.
  for (const c of vectors.fingerprints) {
    await check(`the fingerprint rule: ${c.name}`, c.fingerprint ?? 'SECURITY_POLICY_MISMATCH', () => {
      try {
        return hex(sdpFingerprint(c.sdp));
      } catch (err) {
        return codeOf(err);
      }
    });
  }
  for (const p of vectors.prologues) {
    await check(`the prologue: ${p.name}`, p.prologue, () => hex(buildPrologue({
      mode: p.mode as 'link' | 'code' | 'resume', roomNonce: fromHex(v.roomNonce), attemptId: fromHex(v.attemptId), generation: BigInt(p.generation),
      receiverFingerprint: fromHex(v.receiverFingerprint), senderFingerprint: fromHex(v.senderFingerprint),
    })));
  }
  const hs = vectors.handshake;
  await check("the handshake vector's prologue, from its offer and answer", hs.prologue, () => hex(prologueFromSdp({
    mode: 'link', roomNonce: fromHex(v.roomNonce), attemptId: fromHex(v.attemptId), generation: 0n, offer: hs.offer, answer: hs.answer,
  })));
  await check("Noise over the handshake vector's prologue: both messages and the handshake hash", `${hs.message1} ${hs.message2} ${hs.handshakeHash}`, async () => {
    const initiator = noiseInitiator(provider, { prologue: fromHex(hs.prologue), psk: fromHex(hs.psk), testing: { ephemeral: fromHex(v.receiverEphemeral) } });
    const responder = noiseResponder(provider, { prologue: fromHex(hs.prologue), psk: fromHex(hs.psk), testing: { ephemeral: fromHex(v.senderEphemeral) } });
    const m1 = await initiator.writeMessage1();
    await responder.readMessage1(m1);
    const { message: m2, transport } = await responder.writeMessage2(fromHex(v.hello));
    await initiator.readMessage2(m2);
    return `${hex(m1)} ${hex(m2)} ${hex(transport.handshakeHash)}`;
  });
  await check("the channel by link, every random value and ephemeral fixed to the vector's: its messages and hash", `${hs.message1} ${hs.message2} ${hs.handshakeHash} ${hs.handshakeHash}`, async () => {
    const t = await transfer(provider, {
      senderProvider: scripted(provider, [fromHex(v.linkSecret), fromHex(v.roomNonce)], fromHex(v.senderEphemeral)),
      receiverProvider: scripted(provider, [fromHex(v.attemptId), new Uint8Array(32).fill(7)], fromHex(v.receiverEphemeral)),
      peers: (peers) => {
        peers.receiver.sdp = hs.offer;
        peers.sender.sdp = hs.answer;
      },
      hello: fromHex(v.hello),
    });
    if (t.receiver.status === 'rejected' || t.sender.status === 'rejected') return ending(t);
    const data = t.peers.data as NonNullable<PeerPair['data']>;
    const { receiver, sender } = channels(t);
    return `${hex(data.sent.receiver[0])} ${hex(data.sent.sender[0])} ${hex(receiver.handshakeHash)} ${hex(sender.handshakeHash)}`;
  });

  // End to end.
  const hello = new TextEncoder().encode("the sender's capabilities");
  const capabilities = new TextEncoder().encode("the receiver's capabilities");
  await check('by link: both up, the same handshake hash, each with the other\'s hello', `up / up, the same handshake hash; ${hex(capabilities)} ${hex(hello)}`, async () => {
    const t = await transfer(provider, { hello, capabilities });
    if (t.receiver.status === 'rejected' || t.sender.status === 'rejected') return ending(t);
    const { receiver, sender } = channels(t);
    return `${ending(t)}; ${hex(sender.peerHello)} ${hex(receiver.peerHello)}`;
  });
  await check('by link: a record each way, then an out-of-band close each way through the rendezvous', 'ping pong; bye from the receiver, bye from the sender', async () => {
    const t = await transfer(provider);
    if (t.receiver.status === 'rejected' || t.sender.status === 'rejected') return ending(t);
    const { receiver, sender } = channels(t);
    const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
    await receiver.send(new TextEncoder().encode('ping'));
    const ping = text(await sender.receive());
    await sender.send(new TextEncoder().encode('pong'));
    const pong = text(await receiver.receive());
    await receiver.sendClose(new TextEncoder().encode('bye from the receiver'));
    await sender.sendClose(new TextEncoder().encode('bye from the sender'));
    return `${ping} ${pong}; ${text(await sender.closeReceived)}, ${text(await receiver.closeReceived)}`;
  });
  await check('by code, typed in lower case without the dash: both up, the same handshake hash', 'up / up, the same handshake hash', async () =>
    ending(await codeTransfer(provider, (code) => code.toLowerCase().replace('-', ''))));
  await check('a wrong code (its last digit changed): CODE_MISMATCH on both sides, each in its own words', `${WRONG_CODE.receiver} / ${WRONG_CODE.sender}`, async () =>
    ending(await codeTransfer(provider, wrongDigit)));
  for (const [what, swap] of [['the offer', { offer: true }], ['the answer', { answer: true }], ['both', { offer: true, answer: true }]] as const) {
    await check(`a fingerprint swapped in ${what}: SECURITY_POLICY_MISMATCH on both sides; nothing after Noise's message 1 but aborts, one zero byte each`, 'SECURITY_POLICY_MISMATCH / SECURITY_POLICY_MISMATCH; 48 abort', async () => {
      const t = await transfer(provider, { relay: fingerprintSwapper(provider, swap), hello });
      const sent = t.peers.data?.sent ?? { receiver: [], sender: [] };
      const after = [...new Set([...sent.receiver.slice(1), ...sent.sender].map((m) => (m.byteLength === 1 && m[0] === 0 ? 'abort' : String(m.byteLength))))].sort();
      const codes = [t.receiver, t.sender].map((r) => (r.status === 'fulfilled' ? 'up' : codeOf(r.reason))).join(' / ');
      return `${codes}; ${sent.receiver[0]?.byteLength} ${after.join(' ')}`;
    });
  }
  await check('a resume on R: both up, mode resume, generation 1, a handshake hash of its own', 'up / up, the same handshake hash; resume 1 1; new hash', async () => {
    const first = await transfer(provider);
    if (first.receiver.status === 'rejected' || first.sender.status === 'rejected') return ending(first);
    const before = hex(channels(first).sender.handshakeHash);
    const resumeSecret = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const pipe = pipePair();
    const peers = new PeerPair();
    const [r, s] = await Promise.allSettled([
      reconnect(provider, { pipe: pipe.receiver, roomNonce: first.room.roomNonce, resumeSecret, previousGeneration: 0n, peer: peers.receiver }),
      first.room.accept({ by: 'resume', pipe: pipe.sender, resumeSecret, previousGeneration: 0n }, { peer: peers.sender }),
    ]);
    const t = { ...first, receiver: r, sender: s };
    if (r.status === 'rejected' || s.status === 'rejected') return ending(t);
    const { receiver, sender } = channels(t);
    return `${ending(t)}; ${receiver.mode} ${receiver.generation} ${sender.generation}; ${hex(sender.handshakeHash) === before ? 'the same hash' : 'new hash'}`;
  });
  return checks;
}

/** One attempt by code, the receiver typing what `typed` makes of the sender's code. */
export async function codeTransfer(provider: CryptoProvider, typed: (code: string) => string, options: Omit<TransferOptions, 'typed'> = {}): Promise<Transfer> {
  const rendezvous = new MockRendezvous();
  const peers = new PeerPair({ dataRelay: options.dataRelay, maxMessageBytes: options.maxMessageBytes });
  options.peers?.(peers);
  const room = await openRoom(options.senderProvider ?? provider, { rendezvous: rendezvous.sender, code: true });
  const relay = options.relay?.(room);
  if (relay) rendezvous.relay = () => relay;
  const sender = rendezvous.nextAttempt().then((attempt) => room.accept(attempt, { peer: peers.sender, hello: options.hello }));
  const receiver = connectByCode(options.receiverProvider ?? provider, {
    rendezvous: rendezvous.receiver, code: typed(room.code as string), peer: peers.receiver, hello: options.capabilities,
  });
  const [r, s] = await Promise.allSettled([receiver, sender]);
  return { rendezvous, peers, room, receiver: r, sender: s };
}
