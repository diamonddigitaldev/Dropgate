import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import { webCryptoProvider } from '../src/crypto/index.js';
import {
  connectByCode, connectByLink, openRoom, reconnect, type IncomingAttempt, type SecureChannel, type SenderRoom,
} from '../src/dgdtp/channel.js';
import { parseCode } from '../src/dgdtp/codes.js';
import { deriveRoomId } from '../src/dgdtp/keys.js';
import {
  CODE_RETRY_MS, RENDEZVOUS_PATH, RENDEZVOUS_TYPE, RENEW_INTERVAL_MS, receiverRendezvous, rendezvousUrl, senderRendezvous,
  type RendezvousTimers, type WebSocketClass,
} from '../src/dgdtp/rendezvous.js';
import { webRtcPeer } from '../src/dgdtp/webrtc.js';
import { hex } from './helpers/cpace-vectors.js';
import { Loopback, useLoopback } from './helpers/werift-loopback.js';
// The server suite's own harness: the real server.js, in a throwaway folder, on a free port.
import { startServer } from '../../../server/test/helpers/harness.mjs';
// The server suite's raw clients, which hold codes the way any sender would.
import * as raw from '../../../server/test/helpers/rendezvous.mjs';

// Core's rendezvous client (src/dgdtp/rendezvous.ts) against the real Dropgate
// server: the secure channel set up through the server's rendezvous at
// /api/v4/rendezvous, with werift's RTCPeerConnection on both sides in Node
// (on ::1 alone, a certificate each: tests/helpers/werift-loopback.ts). By
// link, by code and on resume; a wrong code, after which the sender is given a
// fresh code and both its link and its new code still connect; every locator
// held, so a send starts with its link and asks again for a code every 15
// seconds (on a test clock) until one frees, and stops once a receiver is
// accepted; what each message carries (never the link's secret, the code or
// its password: a code's locator alone); and each refusal as core words it.

const provider = webCryptoProvider(globalThis.crypto);

/** Each test's peer connections at most: several attempts' worth. */
useLoopback(8);

interface Server {
  baseUrl: string;
  requests(): Array<{ method: string; url: string; headers: Record<string, string> }>;
  advanceClock(ms: number): Promise<void>;
  rendezvousHeld(): Promise<Record<string, number>>;
  stop(): Promise<void>;
}

/** What one client's sockets sent and were sent, every message, in order. */
interface Recording {
  urls: string[];
  sent: Uint8Array[];
  received: Uint8Array[];
}

const recording = (): Recording => ({ urls: [], sent: [], received: [] });

/** The global WebSocket, recording into `rec`. */
function recordingWebSocket(rec: Recording, change?: (bytes: Uint8Array) => Uint8Array): WebSocketClass {
  const Base = globalThis.WebSocket;
  return class extends Base {
    constructor(url: string) {
      super(url);
      rec.urls.push(url);
      this.addEventListener('message', (event: MessageEvent) => {
        if (event.data instanceof ArrayBuffer) rec.received.push(new Uint8Array(event.data));
      });
    }

    send(data: Uint8Array): void {
      const out = change ? change(new Uint8Array(data)) : data;
      rec.sent.push(new Uint8Array(out));
      super.send(out);
    }
  } as unknown as WebSocketClass;
}

/** A test's clock for the sender's renewing and asking. */
class TestTimers implements RendezvousTimers {
  now = 0;
  #next = 1;
  readonly #pending = new Map<number, { at: number; run: () => void }>();

  setTimeout(run: () => void, ms: number): number {
    const id = this.#next++;
    this.#pending.set(id, { at: this.now + ms, run });
    return id;
  }

  clearTimeout(id: unknown): void {
    this.#pending.delete(id as number);
  }

  /** Moves the clock on by `ms`, running every timer that comes due, in order. */
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.#pending].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.#pending.delete(due[0]);
      this.now = due[1].at;
      due[1].run();
    }
    this.now = end;
  }
}

/** The messages of one type a recording sent. */
const sentOf = (rec: Recording, type: number) => rec.sent.filter((m) => m[0] === type);
const receivedOf = (rec: Recording, type: number) => rec.received.filter((m) => m[0] === type);

/** Whether `needle` appears anywhere in `haystack`. */
function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.byteLength <= haystack.byteLength; i++) {
    for (let j = 0; j < needle.byteLength; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

const ascii = (text: string) => new TextEncoder().encode(text);
const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

/** `check` true within `ms`, polled. */
async function until(check: () => boolean, what: string, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.`);
    await sleep(10);
  }
}

const codeOf = (err: unknown) => String((err as { code?: string })?.code ?? err);
async function failure(promise: Promise<unknown>): Promise<{ code: string; message: string; details?: unknown }> {
  try {
    await promise;
  } catch (err) {
    return { code: codeOf(err), message: (err as Error).message, details: (err as { details?: unknown }).details };
  }
  throw new Error('It succeeded.');
}

/** `/api/info`'s codeLetters. */
async function codeLettersOf(server: Server): Promise<number> {
  const info = await (await fetch(`${server.baseUrl}/api/info`)).json() as { capabilities: { p2p: { codeLetters: number } } };
  return info.capabilities.p2p.codeLetters;
}

interface Client {
  url: string;
  codeLetters: number;
}

/** A sender's room on the server, through core's client. */
async function sending(client: Client, options: { code?: boolean; rec?: Recording; timers?: RendezvousTimers } = {}) {
  const rendezvous = senderRendezvous({
    url: client.url, codeLetters: client.codeLetters, timers: options.timers,
    ...(options.rec ? { WebSocket: recordingWebSocket(options.rec) } : {}),
  });
  const room = await openRoom(provider, { rendezvous, code: options.code ?? false, letters: (client.codeLetters || 2) as 2 | 3 });
  return { rendezvous, room };
}

const receiving = (client: Client, rec?: Recording) => receiverRendezvous({
  url: client.url, codeLetters: client.codeLetters, ...(rec ? { WebSocket: recordingWebSocket(rec) } : {}),
});

const peer = (role: 'receiver' | 'sender') => webRtcPeer({ RTCPeerConnection: Loopback, role });

/**
 * One attempt through the server: the receiver's `connect`, the sender
 * accepting whichever attempt reaches its room next. Both settle.
 */
async function attempt(room: SenderRoom, connect: (p: ReturnType<typeof peer>) => Promise<SecureChannel>) {
  let incoming: IncomingAttempt | undefined;
  const accepted = room.nextAttempt().then((a) => {
    incoming = a;
    return room.accept(a, { peer: peer('sender') });
  });
  const [receiver, sender] = await Promise.allSettled([connect(peer('receiver')), accepted]);
  return { receiver, sender, incoming: () => incoming as IncomingAttempt };
}

const outcome = (r: PromiseSettledResult<unknown>) => (r.status === 'fulfilled' ? 'up' : codeOf(r.reason));
const channelOf = (r: PromiseSettledResult<SecureChannel>) => (r as PromiseFulfilledResult<SecureChannel>).value;

/** Records cross both ways on two channels that are up. */
async function crosses(receiver: SecureChannel, sender: SecureChannel): Promise<void> {
  await receiver.send(ascii('to the sender'));
  await sender.send(ascii('to the receiver'));
  expect(new TextDecoder().decode(await sender.receive())).toBe('to the sender');
  expect(new TextDecoder().decode(await receiver.receive())).toBe('to the receiver');
}

describe("core's rendezvous client and the real server, over werift", () => {
  let server: Server;
  let client: Client;

  beforeAll(async () => {
    server = (await startServer({ env: { RATE_LIMIT_MAX_REQUESTS: '0', P2P_STUN_SERVERS: 'none' }, requests: true })) as Server;
    client = { url: rendezvousUrl(server.baseUrl), codeLetters: await codeLettersOf(server) };
  }, 30_000);

  afterAll(async () => {
    await server?.stop();
  });

  it('reads the address and the code letters as the server gives them: ws: on plain HTTP, wss: on HTTPS, the one path', () => {
    expect(client.codeLetters).toBe(2);
    expect(client.url).toBe(`${server.baseUrl.replace('http:', 'ws:')}${RENDEZVOUS_PATH}`);
    expect(rendezvousUrl('https://example.com')).toBe('wss://example.com/api/v4/rendezvous');
    expect(rendezvousUrl('https://example.com:8443/dropgate/?x=1#y')).toBe('wss://example.com:8443/dropgate/api/v4/rendezvous');
    expect(codeOf((() => { try { return rendezvousUrl('ftp://example.com'); } catch (err) { return err; } })())).toBe('INVALID_ARGUMENT');
  });

  it('by link: both sides up and records crossing; no request or message holds the link\'s secret, and the room\'s code is off', async () => {
    const before = server.requests().length;
    const s = recording();
    const r = recording();
    const { room } = await sending(client, { rec: s });
    expect(room.codeState).toBe('off');
    const secret = room.linkSecret() as Uint8Array;
    const run = await attempt(room, (p) => connectByLink(provider, { rendezvous: receiving(client, r), secret, peer: p }));
    expect(`${outcome(run.receiver)} / ${outcome(run.sender)}`).toBe('up / up');
    await crosses(channelOf(run.receiver), channelOf(run.sender));
    // What went to the server: CREATE with no code asked, JOIN by the room ID, then frames.
    expect(hex(sentOf(s, RENDEZVOUS_TYPE.CREATE)[0].subarray(35, 36))).toBe('00');
    const roomId = await deriveRoomId(provider, secret);
    expect(hex(sentOf(r, RENDEZVOUS_TYPE.JOIN)[0])).toBe(`11040001${hex(roomId)}`);
    for (const message of [...s.sent, ...r.sent]) {
      expect(contains(message, secret)).toBe(false);
      expect(contains(message, ascii(base64url(secret)))).toBe(false);
    }
    // Each socket's request is the rendezvous's path alone, with nothing of the room in it.
    const requests = server.requests().slice(before);
    expect(requests.map((q) => q.url)).toEqual([RENDEZVOUS_PATH, RENDEZVOUS_PATH]);
    expect(JSON.stringify(requests)).not.toContain(base64url(secret));
    expect(JSON.stringify(requests)).not.toContain(hex(secret));
    channelOf(run.receiver).close();
    channelOf(run.sender).close();
    room.close();
  }, 30_000);

  it('by code: the receiver joins by the locator alone; the code is used once, the sender is given a new one at once, and the old one is NOT_FOUND', async () => {
    const s = recording();
    const r = recording();
    const { room } = await sending(client, { code: true, rec: s });
    const first = room.code as string;
    expect(room.codeState).toBe('ready');
    expect(first).toMatch(/^[A-HJ-NP-Z]{4}-[0-9]{4}$/);
    const changes: Array<string | undefined> = [];
    room.onCodeChange(() => changes.push(room.code));
    const run = await attempt(room, (p) => connectByCode(provider, { rendezvous: receiving(client, r), code: first, peer: p }));
    expect(`${outcome(run.receiver)} / ${outcome(run.sender)}`).toBe('up / up');
    await crosses(channelOf(run.receiver), channelOf(run.sender));
    // CREATE asked for a code; the receiver's JOIN named the locator, and nothing else of the code left either device.
    expect(sentOf(s, RENDEZVOUS_TYPE.CREATE)[0][35]).toBe(1);
    expect(hex(sentOf(r, RENDEZVOUS_TYPE.JOIN)[0])).toBe(hex(Uint8Array.of(0x11, 4, 0, 2, 2, ...ascii(first.slice(0, 2)))));
    const password = first.slice(2).replace('-', '');
    for (const message of [...s.sent, ...r.sent]) {
      for (const text of [first, first.replace('-', ''), password, first.slice(2)]) expect(contains(message, ascii(text))).toBe(false);
    }
    // A new code at once: the screen went to none while the old one was tried, then to a new one.
    await until(() => room.codeState === 'ready', 'the new code');
    const second = room.code as string;
    expect(changes).toEqual([undefined, second]);
    expect(sentOf(s, RENDEZVOUS_TYPE.CODE)).toHaveLength(1);
    // A new locator (the old one waits out its quarantine) and a new password.
    expect(second.slice(0, 2)).not.toBe(first.slice(0, 2));
    expect(second.slice(2)).not.toBe(first.slice(2));
    const again = await failure(connectByCode(provider, { rendezvous: receiving(client), code: first, peer: peer('receiver') }));
    expect(again).toMatchObject({ code: 'NOT_FOUND', message: 'No transfer has that code or link. It may have ended, or the code was used.' });
    channelOf(run.receiver).close();
    channelOf(run.sender).close();
    room.close();
  }, 30_000);

  it('a resume through the server: a new attempt on the receiver\'s new socket, its keys from R, generation 1', async () => {
    const { room } = await sending(client);
    const secret = room.linkSecret() as Uint8Array;
    const first = await attempt(room, (p) => connectByLink(provider, { rendezvous: receiving(client), secret, peer: p }));
    expect(`${outcome(first.receiver)} / ${outcome(first.sender)}`).toBe('up / up');
    channelOf(first.receiver).close();
    channelOf(first.sender).close();
    // The receiver's new socket finds the room by its ID; the sender takes the attempt as a resume.
    const resumeSecret = provider.randomBytes(32);
    const joined = await receiving(client).join({ roomId: await deriveRoomId(provider, secret) });
    const [receiver, sender] = await Promise.allSettled([
      reconnect(provider, { pipe: joined.pipe, roomNonce: joined.roomNonce, resumeSecret, previousGeneration: 0n, peer: peer('receiver') }),
      room.nextAttempt().then((a) => room.accept({ by: 'resume', pipe: a.pipe, resumeSecret, previousGeneration: 0n }, { peer: peer('sender') })),
    ]);
    expect(`${outcome(receiver)} / ${outcome(sender)}`).toBe('up / up');
    expect([channelOf(receiver).mode, channelOf(receiver).generation, channelOf(sender).generation]).toEqual(['resume', 1n, 1n]);
    expect(hex(channelOf(receiver).handshakeHash)).toBe(hex(channelOf(sender).handshakeHash));
    await crosses(channelOf(receiver), channelOf(sender));
    channelOf(receiver).close();
    channelOf(sender).close();
    room.close();
  }, 30_000);

  it('a wrong code ends both sides CODE_MISMATCH in their own words; the sender is given a fresh code (new locator and password), and its link and its new code both still connect', async () => {
    const s = recording();
    const r = recording();
    const { room } = await sending(client, { code: true, rec: s });
    const right = room.code as string;
    // The right locator, the wrong password.
    const wrong = `${right.slice(0, 5)}${right.slice(5) === '0000' ? '1111' : '0000'}`;
    const run = await attempt(room, (p) => connectByCode(provider, { rendezvous: receiving(client, r), code: wrong, peer: p }));
    expect(outcome(run.receiver)).toBe('CODE_MISMATCH');
    expect(outcome(run.sender)).toBe('CODE_MISMATCH');
    expect((run.receiver as PromiseRejectedResult).reason.message).toBe("That code didn't match. Ask the sender for the new one.");
    expect((run.sender as PromiseRejectedResult).reason.message).toBe("Someone entered the wrong code. Here's a new one.");
    await until(() => room.codeState === 'ready', 'the fresh code');
    const fresh = room.code as string;
    expect(fresh.slice(0, 2)).not.toBe(right.slice(0, 2));
    expect(fresh).not.toBe(right);
    // Neither code, nor either password, in anything either device sent.
    for (const message of [...s.sent, ...r.sent]) {
      for (const text of [right, wrong, fresh, right.slice(2).replace('-', ''), wrong.slice(2).replace('-', '')]) {
        expect(contains(message, ascii(text))).toBe(false);
      }
    }
    // The link still connects.
    const byLink = await attempt(room, (p) => connectByLink(provider, { rendezvous: receiving(client), secret: room.linkSecret() as Uint8Array, peer: p }));
    expect(`${outcome(byLink.receiver)} / ${outcome(byLink.sender)}`).toBe('up / up');
    await crosses(channelOf(byLink.receiver), channelOf(byLink.sender));
    // And so does the fresh code.
    const byCode = await attempt(room, (p) => connectByCode(provider, { rendezvous: receiving(client), code: fresh, peer: p }));
    expect(`${outcome(byCode.receiver)} / ${outcome(byCode.sender)}`).toBe('up / up');
    for (const run2 of [byLink, byCode]) {
      channelOf(run2.receiver).close();
      channelOf(run2.sender).close();
    }
    room.close();
  }, 45_000);

  it('a receiver that leaves before trying the code: the sender still gets a new code, and never shows the old one again', async () => {
    const s = recording();
    const { room } = await sending(client, { code: true, rec: s });
    const first = room.code as string;
    const joined = await receiving(client).join({ locator: first.slice(0, 2) });
    const incoming = await room.nextAttempt();
    expect(incoming.by).toBe('code');
    expect(room.codeState).toBe('unavailable');
    joined.pipe.close();
    await until(() => room.codeState === 'ready', 'a new code');
    // The server kept the unused locator, so it comes back, with a new password drawn on this device.
    expect(room.code?.slice(0, 2)).toBe(first.slice(0, 2));
    expect(room.code).not.toBe(first);
    // The attempt's own pipe ended.
    expect(codeOf(await incoming.pipe.receive().catch((err) => err))).toBe('CONNECTION_LOST');
    room.close();
  }, 30_000);

  it('LOCK once a receiver is accepted: every other attempt is dropped, a later one is REQUEST_REJECTED, and the kept one goes on', async () => {
    const { room } = await sending(client, { code: true });
    const roomId = await deriveRoomId(provider, room.linkSecret() as Uint8Array);
    const one = await receiving(client).join({ roomId });
    const two = await receiving(client).join({ roomId });
    const a1 = await room.nextAttempt();
    const a2 = await room.nextAttempt();
    room.lock(a1);
    // The code goes from the screen once a receiver is accepted.
    expect(room.codeState).toBe('unavailable');
    expect(codeOf(await two.pipe.receive().catch((err) => err))).toBe('CONNECTION_LOST');
    expect(codeOf(await a2.pipe.receive().catch((err) => err))).toBe('CONNECTION_LOST');
    const late = await failure(receiving(client).join({ roomId }));
    expect(late).toMatchObject({ code: 'REQUEST_REJECTED', message: 'This transfer is already going to someone else.' });
    a1.pipe.send(ascii('kept'));
    expect(new TextDecoder().decode(await one.pipe.receive())).toBe('kept');
    one.pipe.send(ascii('still here'));
    expect(new TextDecoder().decode(await a1.pipe.receive())).toBe('still here');
    room.close();
  }, 30_000);

  it('either side leaving ends the other\'s pipe CONNECTION_LOST; the sender leaving ends the room\'s attempts', async () => {
    const { room } = await sending(client);
    const roomId = await deriveRoomId(provider, room.linkSecret() as Uint8Array);
    const leaving = await receiving(client).join({ roomId });
    const a = await room.nextAttempt();
    leaving.pipe.close();
    expect(codeOf(await a.pipe.receive().catch((err) => err))).toBe('CONNECTION_LOST');
    const staying = await receiving(client).join({ roomId });
    await room.nextAttempt();
    room.close();
    expect(codeOf(await staying.pipe.receive().catch((err) => err))).toBe('CONNECTION_LOST');
    expect(codeOf(await room.nextAttempt().catch((err) => err))).toBe('OPERATION_CANCELLED');
  }, 30_000);

  it('renews an unused code every 4 minutes, on its own clock', async () => {
    const s = recording();
    const timers = new TestTimers();
    const { room } = await sending(client, { code: true, rec: s, timers });
    timers.advance(RENEW_INTERVAL_MS - 1);
    expect(sentOf(s, RENDEZVOUS_TYPE.RENEW)).toHaveLength(0);
    timers.advance(1);
    expect(sentOf(s, RENDEZVOUS_TYPE.RENEW)).toHaveLength(1);
    timers.advance(RENEW_INTERVAL_MS);
    expect(sentOf(s, RENDEZVOUS_TYPE.RENEW)).toHaveLength(2);
    expect(sentOf(s, RENDEZVOUS_TYPE.CODE)).toHaveLength(0);
    // Locked: no more renewing.
    room.lock();
    timers.advance(RENEW_INTERVAL_MS * 3);
    expect(sentOf(s, RENDEZVOUS_TYPE.RENEW)).toHaveLength(2);
    room.close();
  }, 30_000);

  it("refusals in core's words: no such room NOT_FOUND, a server of another major VERSION_UNSUPPORTED naming the side, MALFORMED and LIMIT INVALID_RESPONSE", async () => {
    expect(await failure(receiving(client).join({ roomId: provider.randomBytes(16) })))
      .toMatchObject({ code: 'NOT_FOUND', message: 'No transfer has that code or link. It may have ended, or the code was used.' });
    expect(await failure(receiving(client).join({ locator: 'QX' }))).toMatchObject({ code: 'NOT_FOUND' });
    // This client older than the server: update the app.
    const older = await failure(receiverRendezvous({ url: client.url, codeLetters: 2, version: { major: 3, minor: 9 } }).join({ roomId: provider.randomBytes(16) }));
    expect(older).toMatchObject({
      code: 'VERSION_UNSUPPORTED', message: 'Update required: this server runs a newer version of Dropgate. Update this app to use it.',
      details: { component: 'dgdtp', update: 'client', client: { major: 3, minor: 9 }, server: { major: 4, minor: 0 } },
    });
    // This client newer: the server's operator updates it. The sender's CREATE is checked the same way.
    const newer = await failure(openRoom(provider, { rendezvous: senderRendezvous({ url: client.url, codeLetters: 2, version: { major: 5, minor: 0 } }) }));
    expect(newer).toMatchObject({
      code: 'VERSION_UNSUPPORTED', message: 'Update required: this server runs an older version of Dropgate. Its operator needs to update it.',
      details: { component: 'dgdtp', update: 'server' },
    });
    // A CREATE the server can't read (cut short on its way): MALFORMED, so INVALID_RESPONSE.
    const cut = senderRendezvous({ url: client.url, codeLetters: 2, WebSocket: recordingWebSocket(recording(), (b) => b.subarray(0, 10)) });
    expect(await failure(openRoom(provider, { rendezvous: cut }))).toMatchObject({ code: 'INVALID_RESPONSE' });
    // A receiver sending past the frames an attempt may carry: LIMIT, and its pipe ends INVALID_RESPONSE.
    const { room } = await sending(client);
    const joined = await receiving(client).join({ roomId: await deriveRoomId(provider, room.linkSecret() as Uint8Array) });
    for (let i = 0; i <= 4104; i++) joined.pipe.send(Uint8Array.of(1));
    const ended = await (async () => {
      for (;;) {
        try {
          await joined.pipe.receive();
        } catch (err) {
          return codeOf(err);
        }
      }
    })();
    expect(ended).toBe('INVALID_RESPONSE');
    room.close();
  }, 30_000);

  it('a server that can\'t be reached is SERVER_UNREACHABLE, for either side', async () => {
    const closed = 'ws://127.0.0.1:9/api/v4/rendezvous';
    expect(await failure(receiverRendezvous({ url: closed, codeLetters: 2 }).join({ roomId: provider.randomBytes(16) })))
      .toMatchObject({ code: 'SERVER_UNREACHABLE' });
    expect(await failure(openRoom(provider, { rendezvous: senderRendezvous({ url: closed, codeLetters: 2 }), code: true })))
      .toMatchObject({ code: 'SERVER_UNREACHABLE' });
  }, 30_000);
});

describe('servers whose codes differ', () => {
  it('3 locator letters: the code is split as the server gives it, and connects', async () => {
    const server = (await startServer({ env: { RATE_LIMIT_MAX_REQUESTS: '0', P2P_STUN_SERVERS: 'none', P2P_LOCATOR_LETTERS: '3' } })) as Server;
    try {
      const client = { url: rendezvousUrl(server.baseUrl), codeLetters: await codeLettersOf(server) };
      expect(client.codeLetters).toBe(3);
      const r = recording();
      const { room } = await sending(client, { code: true });
      const code = room.code as string;
      const run = await attempt(room, (p) => connectByCode(provider, { rendezvous: receiving(client, r), code, peer: p, letters: 3 }));
      expect(`${outcome(run.receiver)} / ${outcome(run.sender)}`).toBe('up / up');
      expect(hex(sentOf(r, RENDEZVOUS_TYPE.JOIN)[0])).toBe(hex(Uint8Array.of(0x11, 4, 0, 2, 3, ...ascii(code.slice(0, 3)))));
      expect(parseCode(code, 3).locator).toBe(code.slice(0, 3));
      channelOf(run.receiver).close();
      channelOf(run.sender).close();
      room.close();
    } finally {
      await server.stop();
    }
  }, 30_000);

  it('codes off (codeLetters 0): no code is asked for and the room\'s code is off; a typed code is refused before anything is sent', async () => {
    const server = (await startServer({ env: { RATE_LIMIT_MAX_REQUESTS: '0', P2P_STUN_SERVERS: 'none', P2P_MAX_CODES_PER_IP: '0' } })) as Server;
    try {
      const client = { url: rendezvousUrl(server.baseUrl), codeLetters: await codeLettersOf(server) };
      expect(client.codeLetters).toBe(0);
      const s = recording();
      const { room } = await sending(client, { code: true, rec: s });
      expect(sentOf(s, RENDEZVOUS_TYPE.CREATE)[0][35]).toBe(0);
      expect([room.codeState, room.code]).toEqual(['off', undefined]);
      const r = recording();
      expect(await failure(connectByCode(provider, { rendezvous: receiving(client, r), code: 'ABCD-1234', peer: peer('receiver') })))
        .toMatchObject({ code: 'CAPABILITY_UNSUPPORTED', message: "This server doesn't use codes. Ask the sender for the link." });
      expect(r.urls).toEqual([]);
      room.close();
    } finally {
      await server.stop();
    }
  }, 30_000);
});

describe('every locator held', () => {
  let server: Server;
  let client: Client;
  let holders: Array<{ sender: { close(): void; closed: Promise<unknown> }; locator: string | null }>;

  /** Moves the server's clock on, 50 seconds at a time, letting every socket answer the server's pings between. */
  const advanceServer = async (ms: number) => {
    for (let left = ms; left > 0; left -= 50_000) {
      await server.advanceClock(Math.min(50_000, left));
      await sleep(150);
    }
  };

  beforeAll(async () => {
    server = (await startServer({
      env: { RATE_LIMIT_MAX_REQUESTS: '0', P2P_STUN_SERVERS: 'none', P2P_MAX_CODES_PER_IP: '1000' }, clock: true, held: true,
    })) as Server;
    client = { url: rendezvousUrl(server.baseUrl), codeLetters: await codeLettersOf(server) };
    holders = [];
    for (let at = 0; at < 576; at += 192) {
      holders.push(...await Promise.all(Array.from({ length: 192 }, () => raw.openRoom(server, { code: true }))));
    }
  }, 60_000);

  afterAll(async () => {
    for (const holder of holders ?? []) holder.sender.close();
    await server?.stop();
  });

  it('a send starts with its link, the code unavailable and never failed; it asks again every 15 s; a freed locator gives the code; then it asks no more', async () => {
    expect(holders.filter((h) => h.locator !== null)).toHaveLength(576);
    expect(await server.rendezvousHeld()).toMatchObject({ codes: 576, free: 0 });
    const s = recording();
    const timers = new TestTimers();
    const { room } = await sending(client, { code: true, rec: s, timers });
    expect([room.codeState, room.code]).toEqual(['unavailable', undefined]);
    // Asked again every 15 seconds, each answered with none.
    for (let ask = 1; ask <= 3; ask++) {
      timers.advance(CODE_RETRY_MS - 1);
      expect(sentOf(s, RENDEZVOUS_TYPE.CODE)).toHaveLength(ask - 1);
      timers.advance(1);
      expect(sentOf(s, RENDEZVOUS_TYPE.CODE)).toHaveLength(ask);
      await until(() => receivedOf(s, RENDEZVOUS_TYPE.CODE_IS).length === ask, 'CODE_IS');
      expect(hex(receivedOf(s, RENDEZVOUS_TYPE.CODE_IS)[ask - 1])).toBe('8200');
      expect(room.codeState).toBe('unavailable');
    }
    // A holder leaves; once its locator's quarantine is over, the next asking gets it.
    const freed = holders[0];
    freed.sender.close();
    await freed.sender.closed;
    expect(await server.rendezvousHeld()).toMatchObject({ codes: 575, quarantined: 1, free: 0 });
    await advanceServer(5 * 60_000 + 1000);
    expect(await server.rendezvousHeld()).toMatchObject({ codes: 575, quarantined: 0, free: 1 });
    timers.advance(CODE_RETRY_MS);
    await until(() => room.codeState === 'ready', 'the freed code');
    expect(room.code?.slice(0, 2)).toBe(freed.locator);
    // No more asking: renewing instead.
    const asked = sentOf(s, RENDEZVOUS_TYPE.CODE).length;
    timers.advance(CODE_RETRY_MS * 10);
    expect(sentOf(s, RENDEZVOUS_TYPE.CODE)).toHaveLength(asked);
    timers.advance(RENEW_INTERVAL_MS);
    expect(sentOf(s, RENDEZVOUS_TYPE.RENEW).length).toBeGreaterThan(0);
    // Never failed: the code it was given, and the room, still connect.
    const run = await attempt(room, (p) => connectByCode(provider, { rendezvous: receiving(client), code: room.code as string, peer: p }));
    expect(`${outcome(run.receiver)} / ${outcome(run.sender)}`).toBe('up / up');
    channelOf(run.receiver).close();
    channelOf(run.sender).close();
    room.close();
  }, 120_000);

  it('the link connects while no code is free; the asking goes on while a receiver by link is only connected, and stops once one is accepted', async () => {
    expect(await server.rendezvousHeld()).toMatchObject({ free: 0 });
    const s = recording();
    const timers = new TestTimers();
    const { room } = await sending(client, { code: true, rec: s, timers });
    expect(room.codeState).toBe('unavailable');
    const run = await attempt(room, (p) => connectByLink(provider, { rendezvous: receiving(client), secret: room.linkSecret() as Uint8Array, peer: p }));
    expect(`${outcome(run.receiver)} / ${outcome(run.sender)}`).toBe('up / up');
    await crosses(channelOf(run.receiver), channelOf(run.sender));
    // Connected but not yet accepted: still asking.
    timers.advance(CODE_RETRY_MS);
    expect(sentOf(s, RENDEZVOUS_TYPE.CODE)).toHaveLength(1);
    await until(() => receivedOf(s, RENDEZVOUS_TYPE.CODE_IS).length === 1, 'CODE_IS');
    // Accepted: the room is locked, and nothing more is asked.
    room.lock(run.incoming());
    expect(sentOf(s, RENDEZVOUS_TYPE.LOCK)).toHaveLength(1);
    timers.advance(CODE_RETRY_MS * 10);
    expect(sentOf(s, RENDEZVOUS_TYPE.CODE)).toHaveLength(1);
    expect(room.codeState).toBe('unavailable');
    // The accepted receiver's channel carries on.
    await crosses(channelOf(run.receiver), channelOf(run.sender));
    channelOf(run.receiver).close();
    channelOf(run.sender).close();
    room.close();
  }, 60_000);
});
