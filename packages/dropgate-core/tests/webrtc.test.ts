import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  CipherContext, HashAlgorithm, NamedCurveAlgorithm, RTCCertificate, RTCPeerConnection as WeriftPeerConnection, SignatureAlgorithm,
  type RTCDataChannel as WeriftDataChannel,
} from 'werift';
import { webCryptoProvider, type CryptoProvider } from '../src/crypto/index.js';
import {
  connectByCode, connectByLink, openRoom, reconnect, type IceCandidate, type PeerConnection, type ReceiverRendezvous, type SecureChannel,
  type SenderRoom, type SessionDescription,
} from '../src/dgdtp/channel.js';
import { deriveAttemptKeys } from '../src/dgdtp/keys.js';
import { sdpFingerprint } from '../src/dgdtp/prologue.js';
import { signalChannel, type SignalChannel, type SignalMessage } from '../src/dgdtp/seal.js';
import {
  DATA_CHANNEL_LABEL, LOW_WATER_BYTES, WRITABLE_POLL_MS, webRtcPeer, type RtcPeerConnectionClass,
} from '../src/dgdtp/webrtc.js';
import { hex } from './helpers/cpace-vectors.js';
import { MockRendezvous, pipePair } from './helpers/fake-channel.js';
// The second implementation: plain JavaScript on node:crypto, written from the format.
import * as referencePrologue from './helpers/reference-prologue.mjs';

// A direct transfer's secure channel over real WebRTC (src/dgdtp/webrtc.ts):
// werift's RTCPeerConnection on both sides, in Node, with real DTLS between
// them, through core's mock rendezvous (tests/helpers/fake-channel.ts). By
// link, by code and on resume, with the prologue from the fingerprints in the
// real SDP; a record of the largest size across, intact; writable() resolving
// with no bufferedamountlow event; the data channel closing mid-way; and a relay
// in the middle that holds the signalling keys and terminates DTLS on both
// sides with its own certificates, which both devices refuse.
//
// Two of werift's defaults are set aside here. With no ICE servers it still
// asks Google's STUN server (stun.l.google.com) for every IPv4 address, so ICE
// runs on IPv6's loopback address, ::1, alone, where it asks none: nothing
// leaves the machine and nothing is looked up. And it gives every peer
// connection in a process the same DTLS certificate, so each one here gets its
// own, as two devices would have. No candidate names a .local host: werift
// would look one up with an mDNS query on the LAN.

const provider = webCryptoProvider(globalThis.crypto);
const NOISE_NAME = new TextEncoder().encode('Noise_NNpsk0_25519_AESGCM_SHA256');
const MISMATCH = 'SECURITY_POLICY_MISMATCH';
const LOST = 'CONNECTION_LOST';
/** Each test's peer connections at most: two devices, then two more (a resume, or the relay's). */
const CERTIFICATES_PER_TEST = 4;

/** A new self-signed DTLS certificate, as werift makes its own. */
async function newCertificate(): Promise<RTCCertificate> {
  const { certPem, keyPem, signatureHash } = await CipherContext.createSelfSignedCertificateWithKey(
    { signature: SignatureAlgorithm.ecdsa_3, hash: HashAlgorithm.sha256_4 }, NamedCurveAlgorithm.secp256r1_23,
  );
  return new RTCCertificate(keyPem, certPem, signatureHash);
}

/** Certificates for the test's peer connections, one each, made before it starts. */
const certificates: RTCCertificate[] = [];
/** Every werift peer connection a test made, in order, to close once it's done. */
const made: LoopbackPeerConnection[] = [];

/**
 * werift's RTCPeerConnection on IPv6's loopback address alone, with a
 * certificate of its own. It keeps its data channel and its certificate's
 * fingerprint, so a test can reach under the adapter.
 */
class LoopbackPeerConnection extends WeriftPeerConnection {
  channel: WeriftDataChannel | undefined;
  readonly fingerprint: string;

  constructor(config: ConstructorParameters<typeof WeriftPeerConnection>[0] = {}) {
    const certificate = certificates.shift();
    if (!certificate) throw new Error('No certificate left for another peer connection: raise CERTIFICATES_PER_TEST.');
    super({ ...config, certificates: [certificate], iceInterfaceAddresses: { udp6: '::1' }, iceUseIpv4: false, iceUseIpv6: true });
    this.fingerprint = (certificate.getFingerprints().find((f) => f.algorithm === 'sha-256')?.value ?? '').replace(/:/g, '').toLowerCase();
    made.push(this);
    this.addEventListener('datachannel', (event: { channel: WeriftDataChannel }) => { this.channel = event.channel; });
  }

  createDataChannel(...args: Parameters<WeriftPeerConnection['createDataChannel']>): WeriftDataChannel {
    this.channel = super.createDataChannel(...args);
    return this.channel;
  }
}

const Loopback = LoopbackPeerConnection as unknown as RtcPeerConnectionClass;

beforeEach(async () => {
  certificates.push(...await Promise.all(Array.from({ length: CERTIFICATES_PER_TEST }, newCertificate)));
});

afterEach(async () => {
  certificates.length = 0;
  await Promise.allSettled(made.splice(0).map((pc) => pc.close()));
});

/** What one device's peer connection did: the descriptions it applied and the candidates it gave. */
interface Side {
  peer: PeerConnection;
  pc: LoopbackPeerConnection;
  local?: SessionDescription;
  remote?: SessionDescription;
  candidates: Array<IceCandidate | null>;
}

/** A werift peer for `role`, through the adapter, watched. */
function side(role: 'receiver' | 'sender'): Side {
  const inner = webRtcPeer({ RTCPeerConnection: Loopback, role });
  const watched: Side = { pc: made[made.length - 1], candidates: [], peer: undefined as unknown as PeerConnection };
  watched.peer = {
    createOffer: () => inner.createOffer(),
    createAnswer: () => inner.createAnswer(),
    setLocalDescription: async (d) => { watched.local = { ...d }; return inner.setLocalDescription(d); },
    setRemoteDescription: async (d) => { watched.remote = { ...d }; return inner.setRemoteDescription(d); },
    addIceCandidate: (c) => inner.addIceCandidate(c),
    onIceCandidate: (listener) => inner.onIceCandidate((c) => { watched.candidates.push(c); listener(c); }),
    dataChannel: () => inner.dataChannel(),
    close: () => inner.close(),
  };
  return watched;
}

/** `base`, with each prologue Noise hashes in recorded. */
function watching(base: CryptoProvider) {
  const prologues: string[] = [];
  const watchingProvider: CryptoProvider = {
    ...base,
    sha256: async (data) => {
      if (data.byteLength === 32 + 131 && NOISE_NAME.every((b, i) => data[i] === b)) prologues.push(hex(data.subarray(32)));
      return base.sha256(data);
    },
  };
  return { provider: watchingProvider, prologues };
}

const codeOf = (err: unknown) => String((err as { code?: string })?.code ?? err);
const outcomeOf = (r: PromiseSettledResult<unknown>) => (r.status === 'fulfilled' ? 'up' : codeOf(r.reason));
const outcomes = (r: { receiver: PromiseSettledResult<unknown>; sender: PromiseSettledResult<unknown> }) => `${outcomeOf(r.receiver)} / ${outcomeOf(r.sender)}`;

interface Run {
  receiver: PromiseSettledResult<SecureChannel>;
  sender: PromiseSettledResult<SecureChannel>;
  sides: { receiver: Side; sender: Side };
  prologues: { receiver: string[]; sender: string[] };
  room: SenderRoom;
}

/** One attempt by link or code, werift on both sides, through the mock rendezvous. */
async function run(how: 'link' | 'code'): Promise<Run> {
  const rendezvous = new MockRendezvous();
  const r = watching(provider);
  const s = watching(provider);
  const room = await openRoom(s.provider, { rendezvous: rendezvous.sender, code: how === 'code' });
  const receiver = side('receiver');
  const sender = side('sender');
  const accepted = rendezvous.nextAttempt().then((attempt) => room.accept(attempt, { peer: sender.peer }));
  const connected = how === 'link'
    ? connectByLink(r.provider, { rendezvous: rendezvous.receiver, secret: room.linkSecret() as Uint8Array, peer: receiver.peer })
    : connectByCode(r.provider, { rendezvous: rendezvous.receiver, code: room.code as string, peer: receiver.peer });
  const [rr, ss] = await Promise.allSettled([connected, accepted]);
  return { receiver: rr, sender: ss, sides: { receiver, sender }, prologues: { receiver: r.prologues, sender: s.prologues }, room };
}

const up = (r: { receiver: PromiseSettledResult<SecureChannel>; sender: PromiseSettledResult<SecureChannel> }) => ({
  receiver: (r.receiver as PromiseFulfilledResult<SecureChannel>).value,
  sender: (r.sender as PromiseFulfilledResult<SecureChannel>).value,
});

/** Each distinct a=fingerprint:sha-256 value in `sdp`. */
const sha256Lines = (sdp: string) => new Set([...sdp.matchAll(/^a=fingerprint:sha-256 (.+)$/gim)].map((m) => m[1].trim().toUpperCase()));

/** A candidate's address: the fifth field of its line. */
const addressOf = (c: IceCandidate) => c.candidate.split(' ')[4];

const random = (length: number) => {
  const out = new Uint8Array(length);
  for (let at = 0; at < length; at += 65536) globalThis.crypto.getRandomValues(out.subarray(at, Math.min(length, at + 65536)));
  return out;
};

/** `promise`, or a rejection with `what` after `ms`. */
const within = <T>(promise: Promise<T>, ms: number, what: string) =>
  Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what}: nothing in ${ms} ms`)), ms))]);

describe('the secure channel over werift, Node to Node, real DTLS on loopback', () => {
  it.each(['link', 'code'] as const)('by %s: both sides up with the same handshake hash, the prologue from the fingerprints in the real SDP', async (how) => {
    const r = await run(how);
    expect(outcomes(r)).toBe('up / up');
    const { receiver, sender } = up(r);
    expect(hex(receiver.handshakeHash)).toBe(hex(sender.handshakeHash));
    expect([receiver.mode, sender.mode, receiver.generation, sender.generation]).toEqual([how, how, 0n, 0n]);
    const offer = r.sides.receiver.local as SessionDescription;
    const answer = r.sides.sender.local as SessionDescription;
    expect([offer.type, answer.type]).toEqual(['offer', 'answer']);
    // Each side applied the other's exactly as it was made.
    expect(r.sides.sender.remote).toEqual(offer);
    expect(r.sides.receiver.remote).toEqual(answer);
    // One sha-256 fingerprint in each SDP: the certificate its DTLS used.
    expect(sha256Lines(offer.sdp).size).toBe(1);
    expect(sha256Lines(answer.sdp).size).toBe(1);
    const fpReceiver = hex(sdpFingerprint(offer.sdp));
    const fpSender = hex(sdpFingerprint(answer.sdp));
    expect(fpReceiver).toBe(r.sides.receiver.pc.fingerprint);
    expect(fpSender).toBe(r.sides.sender.pc.fingerprint);
    expect(fpReceiver).not.toBe(fpSender);
    // The prologue both sides hashed in is the second implementation's, from those two fingerprints.
    const want = referencePrologue.prologue({
      mode: how, roomNonce: hex(r.room.roomNonce), attemptId: hex(receiver.attemptId), generation: 0,
      receiverFingerprint: fpReceiver, senderFingerprint: fpSender,
    });
    expect(r.prologues.receiver).toEqual([want]);
    expect(r.prologues.sender).toEqual([want]);
    // werift's data channel takes 65,536-byte messages, so records are full size.
    expect([receiver.maxRecordBytes, sender.maxRecordBytes]).toEqual([65535, 65535]);
    // Records cross both ways.
    await receiver.send(new TextEncoder().encode('to the sender'));
    await sender.send(new TextEncoder().encode('to the receiver'));
    expect(new TextDecoder().decode(await sender.receive())).toBe('to the sender');
    expect(new TextDecoder().decode(await receiver.receive())).toBe('to the receiver');
    // Every candidate either side gave is on ::1, and the end of them came: no .local name, nothing off the machine.
    for (const s of [r.sides.receiver, r.sides.sender]) {
      const given = s.candidates.filter((c): c is IceCandidate => c !== null);
      expect(given.length).toBeGreaterThan(0);
      expect(given.map(addressOf).every((a) => a === '::1')).toBe(true);
      expect(given.some((c) => c.candidate.includes('.local'))).toBe(false);
      expect(s.candidates[s.candidates.length - 1]).toBeNull();
    }
    receiver.close();
    sender.close();
  });

  it('a resume: a new attempt on new peer connections, mode resume, generation 1, its prologue from their fingerprints', async () => {
    const first = await run('link');
    expect(outcomes(first)).toBe('up / up');
    up(first).receiver.close();
    up(first).sender.close();
    const resumeSecret = provider.randomBytes(32);
    const r = watching(provider);
    const pipe = pipePair();
    const receiver = side('receiver');
    const sender = side('sender');
    const [rr, ss] = await Promise.allSettled([
      reconnect(r.provider, { pipe: pipe.receiver, roomNonce: first.room.roomNonce, resumeSecret, previousGeneration: 0n, peer: receiver.peer }),
      first.room.accept({ by: 'resume', pipe: pipe.sender, resumeSecret, previousGeneration: 0n }, { peer: sender.peer }),
    ]);
    const resumed = { receiver: rr, sender: ss };
    expect(outcomes(resumed)).toBe('up / up');
    const channels = up(resumed);
    expect([channels.receiver.mode, channels.sender.mode, channels.receiver.generation, channels.sender.generation]).toEqual(['resume', 'resume', 1n, 1n]);
    expect(hex(channels.receiver.handshakeHash)).toBe(hex(channels.sender.handshakeHash));
    expect(hex(channels.receiver.handshakeHash)).not.toBe(hex(up(first).receiver.handshakeHash));
    expect(r.prologues).toEqual([referencePrologue.prologue({
      mode: 'resume', roomNonce: hex(first.room.roomNonce), attemptId: hex(channels.receiver.attemptId), generation: 1,
      receiverFingerprint: receiver.pc.fingerprint, senderFingerprint: sender.pc.fingerprint,
    })]);
    channels.receiver.close();
    channels.sender.close();
  });

  it("a record of 65,535 bytes (65,519 of plaintext) crosses each way intact; one byte more is refused and the channel carries on", async () => {
    const { receiver, sender } = up(await run('link'));
    for (const [from, to] of [[receiver, sender], [sender, receiver]] as const) {
      const plaintext = random(65519);
      await from.send(plaintext);
      expect(hex(await to.receive())).toBe(hex(plaintext));
      await expect(from.send(new Uint8Array(65520))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await from.send(Uint8Array.of(7));
      expect([...await to.receive()]).toEqual([7]);
    }
    receiver.close();
    sender.close();
  });

  it('writable() resolves by looking at the buffer when no bufferedamountlow event ever comes, and every record still arrives', async () => {
    const r = await run('link');
    const { receiver, sender } = up(r);
    const channel = r.sides.receiver.pc.channel as WeriftDataChannel;
    // Every bufferedamountlow listener is kept from werift: the event can't reach the adapter.
    let asked = 0;
    const add = channel.addEventListener.bind(channel);
    channel.addEventListener = ((type: string, listener: (...args: unknown[]) => void, options?: unknown) => {
      if (type === 'bufferedamountlow') {
        asked++;
        return;
      }
      add(type, listener, options as never);
    }) as typeof channel.addEventListener;
    const records = Array.from({ length: 24 }, () => random(65519));
    for (const record of records) await receiver.send(record);
    expect(channel.bufferedAmount).toBeGreaterThan(LOW_WATER_BYTES);
    await within(receiver.writable(), 10000, 'writable()');
    expect(channel.bufferedAmount).toBeLessThanOrEqual(LOW_WATER_BYTES);
    expect(asked).toBe(1);
    for (const record of records) expect(hex(await sender.receive())).toBe(hex(record));
    // With nothing buffered, it resolves at once.
    await receiver.writable();
    receiver.close();
    sender.close();
  }, 20000);

  it.each(['receiver', 'sender'] as const)("the %s's data channel closing mid-way is CONNECTION_LOST on both sides", async (closing) => {
    const r = await run('link');
    const channels = up(r);
    // Something underneath closes the data channel: not the secure channel's own close().
    r.sides[closing].pc.channel?.close();
    for (const channel of [channels.receiver, channels.sender]) {
      await expect(within(channel.receive(), 10000, 'receive()')).rejects.toMatchObject({ code: LOST });
      await expect(channel.send(Uint8Array.of(1))).rejects.toMatchObject({ code: LOST });
      await expect(channel.writable()).rejects.toMatchObject({ code: LOST });
    }
  }, 20000);
});

/**
 * A relay in the middle, back to back: two werift peer connections of its
 * own, one facing each device, each terminating DTLS with its own certificate.
 * It holds the attempt's signalling keys (from the link's secret, which the
 * real rendezvous never sees), as a malicious server that had them would: it
 * opens each device's sealed signalling, answers the receiver's offer itself,
 * makes its own offer to the sender, seals each again with its own
 * fingerprints in place, and forwards whatever crosses the two data channels.
 */
async function backToBack(room: SenderRoom) {
  const toReceiver = pipePair();
  const toSender = pipePair();
  const crossed = { receiver: [] as Uint8Array[], sender: [] as Uint8Array[] };
  const relayed = { towardReceiver: [] as SignalMessage['type'][], towardSender: [] as SignalMessage['type'][] };
  let keys: { asSender: SignalChannel; asReceiver: SignalChannel } | undefined;
  let outReceiver: Promise<unknown> = Promise.resolve();
  let outSender: Promise<unknown> = Promise.resolve();
  const sealTo = (to: 'receiver' | 'sender', message: SignalMessage) => {
    const k = keys as NonNullable<typeof keys>;
    // Sealed now, so the counters run in call order; sent in that order.
    if (to === 'receiver') {
      relayed.towardReceiver.push(message.type);
      const sealed = k.asSender.seal(message);
      outReceiver = outReceiver.then(() => sealed).then((frame) => toReceiver.sender.send(frame)).catch(() => undefined);
    } else {
      relayed.towardSender.push(message.type);
      const sealed = k.asReceiver.seal(message);
      outSender = outSender.then(() => sealed).then((frame) => toSender.receiver.send(frame)).catch(() => undefined);
    }
  };
  const candidates = (pc: LoopbackPeerConnection, to: 'receiver' | 'sender') => {
    pc.addEventListener('icecandidate', (event: { candidate?: IceCandidate }) => {
      const c = event.candidate;
      if (!c) sealTo(to, { type: 'end-of-candidates' });
      else sealTo(to, { type: 'candidate', candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null, usernameFragment: c.usernameFragment ?? null });
    });
  };
  const wire = (from: 'receiver' | 'sender', channel: WeriftDataChannel, other: () => WeriftDataChannel | undefined) => {
    const waiting: Uint8Array[] = [];
    channel.addEventListener('message', (event: { data: Uint8Array }) => {
      const message = new Uint8Array(event.data);
      crossed[from].push(message);
      const to = other();
      if (to?.readyState === 'open') to.send(message as never);
      else waiting.push(message);
    });
    channel.addEventListener('open', () => {
      // What the other side sent before this channel opened.
      const back = from === 'receiver' ? 'sender' : 'receiver';
      for (const message of pending[back].splice(0)) channel.send(message as never);
    });
    pending[from] = waiting;
  };
  const pending: Record<'receiver' | 'sender', Uint8Array[]> = { receiver: [], sender: [] };
  // Facing the receiver, as its sender; facing the sender, as its receiver.
  const facingReceiver = new LoopbackPeerConnection();
  const facingSender = new LoopbackPeerConnection();
  candidates(facingReceiver, 'receiver');
  candidates(facingSender, 'sender');
  const toSenderChannel = facingSender.createDataChannel('dgdtp/4', { ordered: true });
  wire('sender', toSenderChannel, () => facingReceiver.channel);
  facingReceiver.addEventListener('datachannel', (event: { channel: WeriftDataChannel }) => wire('receiver', event.channel, () => toSenderChannel));

  const fromReceiver = async () => {
    for (;;) {
      let frame: Uint8Array;
      try {
        frame = await toReceiver.sender.receive();
      } catch {
        return;
      }
      if (frame[0] !== 0x10) continue;
      if (!keys) {
        const attemptKeys = await deriveAttemptKeys(provider, { mode: 'link', base: room.linkSecret() as Uint8Array, roomNonce: room.roomNonce, attemptId: frame.slice(2, 18) });
        keys = { asSender: signalChannel(provider, { keys: attemptKeys, role: 'sender' }), asReceiver: signalChannel(provider, { keys: attemptKeys, role: 'receiver' }) };
        // Its own offer to the sender, sealed as the receiver's.
        const offer = await facingSender.createOffer();
        sealTo('sender', { type: 'offer', sdp: offer.sdp });
        void facingSender.setLocalDescription(offer);
        void fromSender();
      }
      const message = await keys.asSender.open(frame);
      if (message.type === 'offer') {
        await facingReceiver.setRemoteDescription({ type: 'offer', sdp: message.sdp });
        const answer = await facingReceiver.createAnswer();
        sealTo('receiver', { type: 'answer', sdp: answer.sdp });
        await facingReceiver.setLocalDescription(answer);
      } else if (message.type === 'candidate') {
        await facingReceiver.addIceCandidate({ candidate: message.candidate, sdpMid: message.sdpMid ?? undefined, sdpMLineIndex: message.sdpMLineIndex ?? undefined, usernameFragment: message.usernameFragment ?? undefined }).catch(() => undefined);
      } else if (message.type === 'end-of-candidates') {
        await facingReceiver.addIceCandidate().catch(() => undefined);
      }
    }
  };
  const fromSender = async () => {
    for (;;) {
      let frame: Uint8Array;
      try {
        frame = await toSender.receiver.receive();
      } catch {
        return;
      }
      if (frame[0] !== 0x10) continue;
      const message = await (keys as NonNullable<typeof keys>).asReceiver.open(frame);
      if (message.type === 'answer') {
        await facingSender.setRemoteDescription({ type: 'answer', sdp: message.sdp });
      } else if (message.type === 'candidate') {
        await facingSender.addIceCandidate({ candidate: message.candidate, sdpMid: message.sdpMid ?? undefined, sdpMLineIndex: message.sdpMLineIndex ?? undefined, usernameFragment: message.usernameFragment ?? undefined }).catch(() => undefined);
      } else if (message.type === 'end-of-candidates') {
        await facingSender.addIceCandidate().catch(() => undefined);
      }
    }
  };
  void fromReceiver();
  const rendezvous: ReceiverRendezvous = { join: async () => ({ roomNonce: room.roomNonce, pipe: toReceiver.receiver }) };
  return {
    rendezvous, senderPipe: toSender.sender, crossed, relayed,
    fingerprints: { facingReceiver: facingReceiver.fingerprint, facingSender: facingSender.fingerprint },
  };
}

describe('a relay in the middle terminating DTLS on both sides, over werift', () => {
  it('both devices end SECURITY_POLICY_MISMATCH, and nothing after the handshake crosses', async () => {
    const r = watching(provider);
    const s = watching(provider);
    const room = await openRoom(s.provider, { rendezvous: new MockRendezvous().sender });
    const relay = await backToBack(room);
    const receiver = side('receiver');
    const sender = side('sender');
    const [rr, ss] = await Promise.allSettled([
      within(connectByLink(r.provider, { rendezvous: relay.rendezvous, secret: room.linkSecret() as Uint8Array, peer: receiver.peer }), 15000, 'the receiver'),
      within(room.accept({ by: 'link', pipe: relay.senderPipe }, { peer: sender.peer }), 15000, 'the sender'),
    ]);
    expect(outcomes({ receiver: rr, sender: ss })).toBe(`${MISMATCH} / ${MISMATCH}`);
    // The relay really sat in the middle: it gave each device an SDP of its own, and both data channels opened through it.
    expect(relay.relayed.towardReceiver[0]).toBe('answer');
    expect(relay.relayed.towardSender[0]).toBe('offer');
    expect(hex(sdpFingerprint(receiver.remote?.sdp as string))).toBe(relay.fingerprints.facingReceiver);
    expect(hex(sdpFingerprint(sender.remote?.sdp as string))).toBe(relay.fingerprints.facingSender);
    // Each device built its prologue from the fingerprints it saw, so the two differ.
    expect(r.prologues).toEqual([referencePrologue.prologue({
      mode: 'link', roomNonce: hex(room.roomNonce), attemptId: r.prologues[0].slice(2 * 43, 2 * 59), generation: 0,
      receiverFingerprint: receiver.pc.fingerprint, senderFingerprint: relay.fingerprints.facingReceiver,
    })]);
    expect(s.prologues).toHaveLength(1);
    expect(s.prologues[0]).not.toBe(r.prologues[0]);
    // On the data channels: the receiver's Noise message 1 (48 bytes) and then only aborts, one zero byte each; no message 2, no BIND, no record.
    const isAbort = (m: Uint8Array) => m.byteLength === 1 && m[0] === 0;
    expect(relay.crossed.receiver[0]?.byteLength).toBe(48);
    expect(relay.crossed.receiver.slice(1).every(isAbort)).toBe(true);
    expect(relay.crossed.sender.length).toBeGreaterThan(0);
    expect(relay.crossed.sender.every(isAbort)).toBe(true);
  }, 30000);
});

/** A stand-in RTCDataChannel: what was sent, how often it was closed, and its listeners, for a test to drive. */
class StandInChannel {
  readyState = 'connecting';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  binaryType = 'blob';
  readonly sent: Uint8Array[] = [];
  closes = 0;
  failSend = false;
  readonly #listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(readonly label: string, readonly ordered = true) {}

  addEventListener(type: string, listener: (event: unknown) => void): void {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
    this.#listeners.get(type)?.add(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.#listeners.get(type)?.delete(listener);
  }

  listening(type: string): number {
    return this.#listeners.get(type)?.size ?? 0;
  }

  emit(type: string, event?: unknown): void {
    for (const listener of [...(this.#listeners.get(type) ?? [])]) listener(event);
  }

  send(data: Uint8Array): void {
    if (this.failSend) throw new Error('InvalidStateError');
    this.sent.push(new Uint8Array(data));
  }

  close(): void {
    this.closes++;
  }

  open(): void {
    this.readyState = 'open';
    this.emit('open');
  }
}

/** A stand-in RTCPeerConnection, W3C-shaped: every call recorded, its states and events set by the test. */
class StandInPeerConnection extends StandInChannel {
  static readonly made: StandInPeerConnection[] = [];
  iceConnectionState = 'new';
  connectionState = 'new';
  sctp: { maxMessageSize: number } | null = { maxMessageSize: 262144 };
  readonly channels: Array<{ channel: StandInChannel; options: unknown }> = [];
  readonly calls: unknown[][] = [];
  sdp: string | null = 'v=0';

  constructor(readonly configuration: unknown) {
    super('');
    StandInPeerConnection.made.push(this);
  }

  createDataChannel(label: string, options: { ordered: boolean }): StandInChannel {
    const channel = new StandInChannel(label, options.ordered);
    this.channels.push({ channel, options });
    return channel;
  }

  async createOffer() { return { type: 'offer', sdp: this.sdp }; }
  async createAnswer() { return { type: 'answer', sdp: this.sdp }; }
  async setLocalDescription(...args: unknown[]) { this.calls.push(['local', ...args]); }
  async setRemoteDescription(...args: unknown[]) { this.calls.push(['remote', ...args]); }
  async addIceCandidate(...args: unknown[]) { this.calls.push(['candidate', ...args]); }

  /** ICE's state and the connection's, each event fired only for the one that changed, as a browser does. */
  state(ice: string, connection = this.connectionState): void {
    if (ice !== this.iceConnectionState) {
      this.iceConnectionState = ice;
      this.emit('iceconnectionstatechange');
    }
    if (connection !== this.connectionState) {
      this.connectionState = connection;
      this.emit('connectionstatechange');
    }
  }
}

const StandIn = StandInPeerConnection as unknown as RtcPeerConnectionClass;

/** A stand-in peer for `role`, and its RTCPeerConnection. */
function standIn(role: 'receiver' | 'sender', iceServers?: Array<{ urls: string }>) {
  const peer = webRtcPeer({ RTCPeerConnection: StandIn, role, iceServers });
  const pc = StandInPeerConnection.made[StandInPeerConnection.made.length - 1];
  return { peer, pc };
}

/** A receiver over the stand-in with its data channel open, and the pipe. */
async function openPipe() {
  const { peer, pc } = standIn('receiver');
  const channel = pc.channels[0].channel;
  channel.open();
  return { peer, pc, channel, pipe: await peer.dataChannel() };
}

describe('the WebRTC adapter, over a stand-in RTCPeerConnection', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("RUNTIME_UNSUPPORTED with no RTCPeerConnection to make; INVALID_ARGUMENT for a role that isn't one", () => {
    expect(() => webRtcPeer({ RTCPeerConnection: undefined as never, role: 'receiver' })).toThrow(expect.objectContaining({ code: 'RUNTIME_UNSUPPORTED' }));
    expect(() => webRtcPeer(undefined as never)).toThrow(expect.objectContaining({ code: 'RUNTIME_UNSUPPORTED' }));
    expect(() => webRtcPeer({ RTCPeerConnection: StandIn, role: 'both' as never })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('the receiver makes the one data channel, dgdtp/4, ordered, as ArrayBuffers, its low-water mark 256 KiB; the sender makes none', () => {
    const { pc } = standIn('receiver');
    expect(pc.channels).toHaveLength(1);
    const [{ channel, options }] = pc.channels;
    expect([channel.label, options]).toEqual([DATA_CHANNEL_LABEL, { ordered: true }]);
    expect(DATA_CHANNEL_LABEL).toBe('dgdtp/4');
    expect([channel.binaryType, channel.bufferedAmountLowThreshold]).toEqual(['arraybuffer', 262144]);
    expect(LOW_WATER_BYTES).toBe(262144);
    expect(WRITABLE_POLL_MS).toBe(10);
    expect(standIn('sender').pc.channels).toHaveLength(0);
  });

  it('ICE servers: none unless given, and copies of those given', () => {
    expect(standIn('receiver').pc.configuration).toEqual({ iceServers: [] });
    const given = [{ urls: 'stun:stun.example.net:3478' }];
    const { pc } = standIn('sender', given);
    expect(pc.configuration).toEqual({ iceServers: given });
    const passed = (pc.configuration as { iceServers: unknown[] }).iceServers;
    expect(passed).not.toBe(given);
    expect(passed[0]).not.toBe(given[0]);
  });

  it('SDP as strings each way; a description with none is UNEXPECTED_ERROR', async () => {
    const { peer, pc } = standIn('receiver');
    pc.sdp = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n';
    expect(await peer.createOffer()).toBe(pc.sdp);
    expect(await peer.createAnswer()).toBe(pc.sdp);
    await peer.setLocalDescription({ type: 'offer', sdp: 'one' });
    await peer.setRemoteDescription({ type: 'answer', sdp: 'two' });
    expect(pc.calls).toEqual([['local', { type: 'offer', sdp: 'one' }], ['remote', { type: 'answer', sdp: 'two' }]]);
    pc.sdp = null;
    await expect(peer.createOffer()).rejects.toMatchObject({ code: 'UNEXPECTED_ERROR' });
    await expect(peer.createAnswer()).rejects.toMatchObject({ code: 'UNEXPECTED_ERROR' });
  });

  it("local candidates: each its four fields, the end of them null, a section's empty end skipped, those found before a listener kept for it", () => {
    const { peer, pc } = standIn('receiver');
    const line = 'candidate:1 1 udp 2122260223 192.0.2.1 50000 typ host';
    pc.emit('icecandidate', { candidate: { candidate: line, sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'abcd', extra: 'dropped' } });
    pc.emit('icecandidate', { candidate: { candidate: '', sdpMid: '0', sdpMLineIndex: 0 } });
    const got: unknown[] = [];
    peer.onIceCandidate((c) => got.push(c));
    pc.emit('icecandidate', { candidate: { candidate: line } });
    pc.emit('icecandidate', { candidate: null });
    pc.emit('icecandidate', { candidate: undefined });
    pc.emit('icecandidate', { candidate: { candidate: 7 } });
    expect(got).toEqual([
      { candidate: line, sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'abcd' },
      { candidate: line, sdpMid: null, sdpMLineIndex: null, usernameFragment: null },
      null, null,
    ]);
    // After close, none.
    peer.close();
    pc.emit('icecandidate', { candidate: { candidate: line } });
    expect(got).toHaveLength(4);
  });

  it("the other side's candidates: the four fields, and the end of them as no candidate at all", async () => {
    const { peer, pc } = standIn('sender');
    const c = { candidate: 'candidate:1 1 udp 1 192.0.2.1 1 typ host', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'abcd' };
    await peer.addIceCandidate(c);
    await peer.addIceCandidate(null);
    expect(pc.calls).toEqual([['candidate', c], ['candidate']]);
  });

  it('the sender takes the first ordered dgdtp/4 channel the receiver opens, and closes any other', async () => {
    const { peer, pc } = standIn('sender');
    const other = new StandInChannel('chat');
    const unordered = new StandInChannel(DATA_CHANNEL_LABEL, false);
    const ours = new StandInChannel(DATA_CHANNEL_LABEL);
    const second = new StandInChannel(DATA_CHANNEL_LABEL);
    for (const channel of [other, unordered]) pc.emit('datachannel', { channel });
    pc.emit('datachannel', {});
    ours.readyState = 'open';
    pc.emit('datachannel', { channel: ours });
    pc.emit('datachannel', { channel: second });
    expect([other.closes, unordered.closes, ours.closes, second.closes]).toEqual([1, 1, 0, 1]);
    const pipe = await peer.dataChannel();
    expect([ours.binaryType, ours.bufferedAmountLowThreshold]).toEqual(['arraybuffer', 262144]);
    pipe.send(Uint8Array.of(1));
    expect(ours.sent).toEqual([Uint8Array.of(1)]);
  });

  it("dataChannel() once open: its max-message-size the SCTP transport's, RFC 8841's 65,536 when there's none", async () => {
    const { pc, pipe } = await openPipe();
    expect(pipe.maxMessageBytes).toBe(262144);
    expect(pc.channels[0].channel.listening('open')).toBe(1);
    for (const [sctp, want] of [[null, 65536], [{ maxMessageSize: Infinity }, Infinity], [{ maxMessageSize: 1024 }, 1024], [{}, 65536], [{ maxMessageSize: '70000' }, 65536]] as const) {
      const { peer, pc: other } = standIn('receiver');
      other.sctp = sctp as never;
      other.channels[0].channel.open();
      other.channels[0].channel.open();
      expect((await peer.dataChannel()).maxMessageBytes).toBe(want);
      // Opened twice, one pipe: one listener for its messages.
      expect(other.channels[0].channel.listening('message')).toBe(1);
    }
  });

  it('messages: each copied as bytes of its own, in order; text, or anything else, an empty message; what came before an end still taken, then CONNECTION_LOST', async () => {
    const { pc, channel, pipe } = await openPipe();
    const buffer = Uint8Array.of(1, 2, 3).buffer;
    const big = Uint8Array.of(9, 8, 7, 6, 5);
    channel.emit('message', { data: buffer });
    channel.emit('message', { data: big.subarray(1, 3) });
    channel.emit('message', { data: 'text' });
    channel.emit('message', undefined);
    const first = await pipe.receive();
    expect([...first]).toEqual([1, 2, 3]);
    expect(first.buffer).not.toBe(buffer);
    const view = await pipe.receive();
    expect([...view, view.byteOffset, view.buffer.byteLength]).toEqual([8, 7, 0, 2]);
    expect([...await pipe.receive()]).toEqual([]);
    expect([...await pipe.receive()]).toEqual([]);
    // One waiting, then the next message.
    const next = pipe.receive();
    channel.emit('message', { data: Uint8Array.of(4) });
    expect([...await next]).toEqual([4]);
    // The connection fails: what came first is still taken, nothing after it, then CONNECTION_LOST.
    channel.emit('message', { data: Uint8Array.of(5) });
    pc.state('failed');
    channel.emit('message', { data: Uint8Array.of(6) });
    expect([...await pipe.receive()]).toEqual([5]);
    await expect(pipe.receive()).rejects.toMatchObject({ code: 'CONNECTION_LOST' });
    expect(channel.listening('message')).toBe(0);
  });

  it('send(): CONNECTION_LOST once the channel or connection has gone, or if the channel refuses; INVALID_ARGUMENT over its max-message-size', async () => {
    const { channel, pipe } = await openPipe();
    pipe.send(new Uint8Array(262144));
    expect(() => pipe.send(new Uint8Array(262145))).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(channel.sent).toHaveLength(1);
    channel.readyState = 'closing';
    expect(() => pipe.send(Uint8Array.of(1))).toThrow(expect.objectContaining({ code: 'CONNECTION_LOST' }));
    channel.readyState = 'open';
    channel.failSend = true;
    expect(() => pipe.send(Uint8Array.of(1))).toThrow(expect.objectContaining({ code: 'CONNECTION_LOST' }));
    // Refusing once ends the pipe.
    channel.failSend = false;
    expect(() => pipe.send(Uint8Array.of(1))).toThrow(expect.objectContaining({ code: 'CONNECTION_LOST' }));
    await expect(pipe.receive()).rejects.toMatchObject({ code: 'CONNECTION_LOST' });
    const after = await openPipe();
    after.pc.state('new', 'closed');
    expect(() => after.pipe.send(Uint8Array.of(1))).toThrow(expect.objectContaining({ code: 'CONNECTION_LOST' }));
    // Closed by this side, its channel still saying open: nothing more is sent, and what was waiting isn't taken.
    const closing = await openPipe();
    closing.channel.emit('message', { data: Uint8Array.of(1) });
    closing.pipe.close();
    expect(() => closing.pipe.send(Uint8Array.of(1))).toThrow(expect.objectContaining({ code: 'CONNECTION_LOST' }));
    expect(closing.channel.sent).toHaveLength(0);
    await expect(closing.pipe.receive()).rejects.toMatchObject({ code: 'CONNECTION_LOST' });
  });

  it('writable(): at once at or under 256 KiB; above it, on bufferedamountlow, or by looking every 10 ms when no event comes', async () => {
    vi.useFakeTimers();
    const { channel, pipe } = await openPipe();
    channel.bufferedAmount = LOW_WATER_BYTES;
    await pipe.writable();
    expect(channel.listening('bufferedamountlow')).toBe(0);
    // Above the mark: waits, with one listener and one poll however many wait.
    channel.bufferedAmount = LOW_WATER_BYTES + 1;
    let done = 0;
    const both = [pipe.writable(), pipe.writable()].map((p) => p.then(() => { done++; }));
    expect(channel.listening('bufferedamountlow')).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(done).toBe(0);
    // The event, at or under the mark: both at once, before any poll.
    channel.bufferedAmount = 1000;
    channel.emit('bufferedamountlow');
    await Promise.all(both);
    expect(done).toBe(2);
    expect(channel.listening('bufferedamountlow')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    // An event while still over the mark changes nothing.
    channel.bufferedAmount = LOW_WATER_BYTES + 1;
    const polled = pipe.writable().then(() => { done++; });
    channel.emit('bufferedamountlow');
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(2);
    // No event at all: the next look after the buffer drains, within 10 ms.
    await vi.advanceTimersByTimeAsync(30);
    channel.bufferedAmount = LOW_WATER_BYTES;
    await vi.advanceTimersByTimeAsync(WRITABLE_POLL_MS - 1);
    expect(done).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    await polled;
    expect(done).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
    expect(channel.listening('bufferedamountlow')).toBe(0);
  });

  it('writable() fails with CONNECTION_LOST when the channel ends while it waits, or after; and stops looking', async () => {
    vi.useFakeTimers();
    for (const end of ['the channel closing', 'ICE failing', 'ICE closed', 'the connection failing', 'this side closing'] as const) {
      const { peer, pc, channel, pipe } = await openPipe();
      channel.bufferedAmount = LOW_WATER_BYTES + 1;
      const waiting = pipe.writable();
      if (end === 'the channel closing') channel.emit('close');
      else if (end === 'ICE failing') pc.state('failed');
      else if (end === 'ICE closed') pc.state('closed');
      else if (end === 'the connection failing') pc.state('new', 'failed');
      else peer.close();
      await expect(waiting, end).rejects.toMatchObject({ code: 'CONNECTION_LOST' });
      await expect(pipe.writable(), end).rejects.toMatchObject({ code: 'CONNECTION_LOST' });
      expect(vi.getTimerCount(), end).toBe(0);
      expect(channel.listening('bufferedamountlow'), end).toBe(0);
    }
  });

  it("ICE or the connection failing before the data channel opens: dataChannel() is CONNECTION_LOST; 'disconnected' isn't an end", async () => {
    for (const [ice, connection] of [['failed', 'new'], ['closed', 'new'], ['new', 'failed'], ['new', 'closed']]) {
      const { peer, pc } = standIn('receiver');
      pc.state(ice, connection);
      await expect(peer.dataChannel()).rejects.toMatchObject({ code: 'CONNECTION_LOST' });
    }
    const { peer, pc } = standIn('receiver');
    pc.state('disconnected', 'disconnected');
    pc.channels[0].channel.emit('close');
    await expect(peer.dataChannel()).rejects.toMatchObject({ code: 'CONNECTION_LOST' });
    const still = await openPipe();
    still.pc.state('disconnected', 'disconnected');
    still.channel.emit('message', { data: Uint8Array.of(1) });
    expect([...await still.pipe.receive()]).toEqual([1]);
    still.pipe.send(Uint8Array.of(2));
    expect(still.channel.sent).toHaveLength(1);
  });

  it('close(): the data channel and the peer connection closed, once; dataChannel() and the pipe end; nothing opens after', async () => {
    const { peer, pc, channel, pipe } = await openPipe();
    const waiting = pipe.receive();
    peer.close();
    peer.close();
    expect([channel.closes, pc.closes]).toEqual([1, 1]);
    await expect(waiting).rejects.toMatchObject({ code: 'CONNECTION_LOST' });
    pipe.close();
    expect(channel.closes).toBe(1);
    // Before it opened: dataChannel() fails, and an open after that makes nothing.
    const early = standIn('receiver');
    early.peer.close();
    expect(early.pc.channels[0].channel.closes).toBe(1);
    await expect(early.peer.dataChannel()).rejects.toMatchObject({ code: 'CONNECTION_LOST' });
    early.pc.channels[0].channel.open();
    expect(early.pc.channels[0].channel.listening('message')).toBe(0);
    // A peer connection whose close() throws, or gives a promise that rejects, is closed all the same.
    const throwing = standIn('receiver');
    throwing.pc.close = () => { throw new Error('closed'); };
    expect(() => throwing.peer.close()).not.toThrow();
    const rejecting = standIn('receiver');
    rejecting.pc.close = () => Promise.reject(new Error('closed')) as never;
    expect(() => rejecting.peer.close()).not.toThrow();
    const channelThrows = standIn('receiver');
    expect(channelThrows.pc.channels[0].channel.closes).toBe(0);
    channelThrows.pc.channels[0].channel.close = () => { throw new Error('closed'); };
    expect(() => channelThrows.peer.close()).not.toThrow();
    expect(channelThrows.pc.closes).toBe(1);
  });
});
