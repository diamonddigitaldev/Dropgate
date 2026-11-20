import { afterEach, describe, it, expect } from 'vitest';
import { inspect } from 'node:util';
import { webCryptoProvider } from '../src/crypto/index.js';
import { connectByCode, openRoom, type IncomingAttempt, type RoomNews } from '../src/dgdtp/channel.js';
import {
  CODE_RETRY_MS, RENDEZVOUS_TYPE, RENEW_INTERVAL_MS, receiverRendezvous, rendezvousError, senderRendezvous, type RendezvousTimers,
  type WebSocketClass,
} from '../src/dgdtp/rendezvous.js';
import { hex } from './helpers/cpace-vectors.js';
import { MockRendezvous, PeerPair } from './helpers/fake-channel.js';

// Core's rendezvous client (src/dgdtp/rendezvous.ts) on a stand-in WebSocket,
// for what the real server never does (tests/rendezvous.test.ts has the real
// one): messages that aren't the server's, answers out of turn, a socket
// closing at each step, a code released or given just as the room is locked;
// and the room (src/dgdtp/channel.ts' SenderRoom) taking what the rendezvous
// tells it in order.

const provider = webCryptoProvider(globalThis.crypto);

/** A stand-in for the global WebSocket: what it was sent, and a test's hand on what it's told. */
class StandIn {
  static made: StandIn[] = [];
  static refuse = false;
  readonly url: string;
  binaryType = 'blob';
  readyState = 0;
  readonly sent: Uint8Array[] = [];
  closedWith: number | undefined;
  readonly #listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(url: string) {
    if (StandIn.refuse) throw new SyntaxError('That address is no good.');
    this.url = url;
    StandIn.made.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  #emit(type: string, event: unknown = {}): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }

  send(data: Uint8Array): void {
    if (this.readyState !== 1) throw new Error('Not open.');
    this.sent.push(new Uint8Array(data));
  }

  close(code?: number): void {
    this.closedWith = code;
    this.readyState = 3;
  }

  // The test's side.
  open(): void { this.readyState = 1; this.#emit('open'); }
  tell(...bytes: number[]): void { this.#emit('message', { data: Uint8Array.from(bytes).buffer }); }
  tellBytes(bytes: Uint8Array): void { this.#emit('message', { data: bytes.slice().buffer }); }
  tellText(text: string): void { this.#emit('message', { data: text }); }
  drop(): void { this.readyState = 3; this.#emit('error'); this.#emit('close', { code: 1006 }); }
}

const WS = StandIn as unknown as WebSocketClass;
const URL_ = 'ws://127.0.0.1:1/api/v4/rendezvous';
const last = () => StandIn.made[StandIn.made.length - 1];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** `check` true, polled. */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; !check(); i++) {
    if (i > 500) throw new Error('Timed out.');
    await tick();
  }
}

/** The next socket core makes after `count` were made, opened, once it has sent its first message. */
async function opened(count: number): Promise<StandIn> {
  await until(() => StandIn.made.length > count);
  const socket = StandIn.made[count];
  socket.open();
  await until(() => socket.sent.length > 0);
  return socket;
}
const codeOf = (err: unknown) => String((err as { code?: string })?.code ?? err);
const types = (socket: StandIn) => socket.sent.map((m) => m[0]);

afterEach(() => {
  StandIn.made = [];
  StandIn.refuse = false;
});

class TestTimers implements RendezvousTimers {
  readonly pending = new Map<number, { at: number; run: () => void }>();
  now = 0;
  #id = 1;
  setTimeout(run: () => void, ms: number): number { this.pending.set(this.#id, { at: this.now + ms, run }); return this.#id++; }
  clearTimeout(id: unknown): void { this.pending.delete(id as number); }
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.pending].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.pending.delete(due[0]);
      this.now = due[1].at;
      due[1].run();
    }
    this.now = end;
  }
}

/** A sender's room on the stand-in, created: CREATED answered with `locator` (letters), or none. */
async function room(options: { codeLetters?: 0 | 2 | 3; code?: boolean; locator?: string; timers?: TestTimers } = {}) {
  const rendezvous = senderRendezvous({ url: URL_, codeLetters: options.codeLetters ?? 2, WebSocket: WS, timers: options.timers });
  const count = StandIn.made.length;
  const opening = openRoom(provider, { rendezvous, code: options.code ?? true, letters: options.codeLetters === 3 ? 3 : 2 });
  const socket = await opened(count);
  const locator = options.locator ?? '';
  socket.tell(0x81, locator.length, ...[...locator].map((c) => c.charCodeAt(0)));
  return { rendezvous, room: await opening, socket };
}

describe('the sender, on a stand-in WebSocket', () => {
  it('binary messages only, and its first a CREATE; the room ends INVALID_RESPONSE on anything that isn\'t the server\'s', async () => {
    const cases: Array<[string, (s: StandIn) => void]> = [
      ['a text message', (s) => s.tellText('{}')],
      ['an empty message', (s) => s.tell()],
      ['a receiver\'s JOINED', (s) => s.tellBytes(Uint8Array.of(0x91, ...new Uint8Array(16)))],
      ['CREATED a second time', (s) => s.tell(0x81, 0)],
      ['an ATTEMPT one byte short', (s) => s.tell(0x83, 1)],
      ['an unknown ERROR code', (s) => s.tell(0xff, 99)],
    ];
    for (const [name, send] of cases) {
      const { room: r, socket } = await room({ locator: 'AB' });
      let ended: unknown;
      r.nextAttempt().catch((err) => { ended = err; });
      send(socket);
      await tick();
      expect(codeOf(ended), name).toBe('INVALID_RESPONSE');
      expect(socket.closedWith, name).toBe(1000);
      expect(r.codeState, name).toBe('unavailable');
    }
    expect(hex(StandIn.made[0].sent[0].subarray(0, 3))).toBe('010400');
    expect(StandIn.made[0].binaryType).toBe('arraybuffer');
  });

  it('a first answer that isn\'t CREATED, a locator when none was asked for, or one of the wrong length: INVALID_RESPONSE, and the room never opens', async () => {
    const cases: Array<[string, { code: boolean; codeLetters?: 0 | 2 | 3 }, number[]]> = [
      ['an ATTEMPT first', { code: true }, [0x83, 1, 1]],
      ['a locator not asked for', { code: false }, [0x81, 2, 0x41, 0x42]],
      ['a locator asked of a server that gives none', { code: true, codeLetters: 0 }, [0x81, 2, 0x41, 0x42]],
      ['3 letters from a 2-letter server', { code: true }, [0x81, 3, 0x41, 0x42, 0x43]],
      ['2 letters from a 3-letter server', { code: true, codeLetters: 3 }, [0x81, 2, 0x41, 0x42]],
    ];
    for (const [name, options, answer] of cases) {
      const rendezvous = senderRendezvous({ url: URL_, codeLetters: options.codeLetters ?? 2, WebSocket: WS });
      const count = StandIn.made.length;
      const opening = openRoom(provider, { rendezvous, code: options.code });
      (await opened(count)).tell(...answer);
      expect(codeOf(await opening.catch((err) => err)), name).toBe('INVALID_RESPONSE');
      expect(last().closedWith, name).toBe(1000);
    }
  });

  it('a socket that closes before CREATED is CONNECTION_LOST; one that never opens SERVER_UNREACHABLE; no WebSocket at all RUNTIME_UNSUPPORTED', async () => {
    let opening = openRoom(provider, { rendezvous: senderRendezvous({ url: URL_, codeLetters: 2, WebSocket: WS }) });
    (await opened(0)).drop();
    expect(codeOf(await opening.catch((err) => err))).toBe('CONNECTION_LOST');
    opening = openRoom(provider, { rendezvous: senderRendezvous({ url: URL_, codeLetters: 2, WebSocket: WS }) });
    await until(() => StandIn.made.length > 1);
    last().drop();
    expect(codeOf(await opening.catch((err) => err))).toBe('SERVER_UNREACHABLE');
    StandIn.refuse = true;
    expect(codeOf(await openRoom(provider, { rendezvous: senderRendezvous({ url: URL_, codeLetters: 2, WebSocket: WS }) }).catch((err) => err)))
      .toBe('SERVER_UNREACHABLE');
    const global = globalThis.WebSocket;
    try {
      (globalThis as { WebSocket?: unknown }).WebSocket = undefined;
      expect(codeOf(await openRoom(provider, { rendezvous: senderRendezvous({ url: URL_, codeLetters: 2 }) }).catch((err) => err)))
        .toBe('RUNTIME_UNSUPPORTED');
    } finally {
      globalThis.WebSocket = global;
    }
  });

  it('refuses options that aren\'t: no address, code letters other than 0, 2 or 3, a credential that isn\'t a token68, a version past a byte; one room per rendezvous', async () => {
    const refused = (run: () => unknown) => { try { run(); return 'accepted'; } catch (err) { return codeOf(err); } };
    expect(refused(() => senderRendezvous(undefined as never))).toBe('INVALID_ARGUMENT');
    expect(refused(() => senderRendezvous({ url: URL_, codeLetters: 4 }))).toBe('INVALID_ARGUMENT');
    expect(refused(() => receiverRendezvous({ url: URL_, codeLetters: 1 }))).toBe('INVALID_ARGUMENT');
    expect(refused(() => senderRendezvous({ url: URL_, codeLetters: 2, credential: 'not a token' }))).toBe('INVALID_ARGUMENT');
    expect(refused(() => senderRendezvous({ url: URL_, codeLetters: 2, credential: 'a'.repeat(8193) }))).toBe('INVALID_ARGUMENT');
    expect(refused(() => senderRendezvous({ url: URL_, codeLetters: 2, credential: 'abc==' }))).toBe('accepted');
    expect(refused(() => senderRendezvous({ url: URL_, codeLetters: 2, version: { major: 256, minor: 0 } }))).toBe('INVALID_ARGUMENT');
    const { rendezvous } = await room();
    expect(codeOf(await rendezvous.create({ roomId: new Uint8Array(16), roomNonce: new Uint8Array(16), code: false }).catch((e) => e))).toBe('INVALID_ARGUMENT');
    expect([String(rendezvous), JSON.stringify(rendezvous), inspect(rendezvous)]).toEqual(['[SenderRendezvous]', '"[SenderRendezvous]"', '[SenderRendezvous]']);
  });

  it('sends its credential in CREATE, and nothing else of it anywhere', async () => {
    const rendezvous = senderRendezvous({ url: URL_, codeLetters: 2, WebSocket: WS, credential: 'zq7CREDENTIAL' });
    const opening = openRoom(provider, { rendezvous });
    const create = (await opened(0)).sent[0];
    expect(create.byteLength).toBe(38 + 13);
    expect(new TextDecoder().decode(create.subarray(38))).toBe('zq7CREDENTIAL');
    expect(hex(create.subarray(36, 38))).toBe('000d');
    expect(last().url).toBe(URL_);
    last().tell(0x81, 0);
    await opening;
  });

  it('attempts by link and code reach the room in order; frames go both ways under their tag; GONE ends one; a frame for an ended attempt goes nowhere', async () => {
    const { room: r, socket } = await room({ locator: 'AB' });
    socket.tell(0x83, 7, 1);
    socket.tell(0x83, 8, 2);
    const one = await r.nextAttempt();
    const two = await r.nextAttempt();
    expect([one.by, two.by]).toEqual(['link', 'code']);
    socket.tell(0x84, 7, 0xaa);
    socket.tell(0x84, 8, 0xbb, 0xcc);
    expect(hex(await one.pipe.receive())).toBe('aa');
    expect(hex(await two.pipe.receive())).toBe('bbcc');
    one.pipe.send(Uint8Array.of(1, 2));
    two.pipe.send(new Uint8Array(0));
    expect(socket.sent.slice(-3).map(hex)).toEqual(['02', '04070102', '0408']);
    expect(codeOf((() => { try { one.pipe.send(new Uint8Array(8231)); return 'sent'; } catch (err) { return err; } })())).toBe('INVALID_ARGUMENT');
    await one.pipe.writable();
    socket.tell(0x85, 7);
    expect(codeOf(await one.pipe.receive().catch((err) => err))).toBe('CONNECTION_LOST');
    expect(codeOf(await one.pipe.writable().catch((err) => err))).toBe('CONNECTION_LOST');
    const before = socket.sent.length;
    one.pipe.send(Uint8Array.of(9));
    socket.tell(0x84, 7, 1);
    socket.tell(0x85, 7);
    expect(socket.sent.length).toBe(before);
    // A tag already in use, and an attempt by code where no code was asked for: not the server's doing.
    socket.tell(0x83, 8, 1);
    await tick();
    expect(codeOf(await r.nextAttempt().catch((err) => err))).toBe('INVALID_RESPONSE');
    const { room: linkOnly, socket: s2 } = await room({ code: false });
    s2.tell(0x83, 1, 2);
    expect(codeOf(await linkOnly.nextAttempt().catch((err) => err))).toBe('INVALID_RESPONSE');
  });

  it('closing an attempt\'s pipe DROPs it, once; the socket dropping ends every pipe CONNECTION_LOST and the room', async () => {
    const { room: r, socket } = await room({ code: false });
    socket.tell(0x83, 3, 1);
    socket.tell(0x83, 4, 1);
    const one = await r.nextAttempt();
    const two = await r.nextAttempt();
    one.pipe.close();
    one.pipe.close();
    expect(socket.sent.slice(1).map(hex)).toEqual(['0503']);
    expect(codeOf(await one.pipe.receive().catch((err) => err))).toBe('CONNECTION_LOST');
    socket.drop();
    expect(codeOf(await two.pipe.receive().catch((err) => err))).toBe('CONNECTION_LOST');
    expect(codeOf(await r.nextAttempt().catch((err) => err))).toBe('CONNECTION_LOST');
    // An ERROR to the sender's socket ends the room in core's words.
    const { room: r2, socket: s2 } = await room({ code: false });
    s2.tell(0x83, 1, 1);
    const three = await r2.nextAttempt();
    s2.tell(0xff, 3);
    expect(codeOf(await three.pipe.receive().catch((err) => err))).toBe('REQUEST_REJECTED');
    expect(codeOf(await r2.nextAttempt().catch((err) => err))).toBe('REQUEST_REJECTED');
  });

  it('after an attempt by code, a new code at once (its first frame, or its end), once; CODE_GONE asks again at once; while none is free, every 15 s', async () => {
    const timers = new TestTimers();
    const { room: r, socket } = await room({ locator: 'AB', timers });
    const first = r.code as string;
    expect(first.slice(0, 2)).toBe('AB');
    socket.tell(0x83, 1, 2);
    const a = await r.nextAttempt();
    expect(r.codeState).toBe('unavailable');
    expect(types(socket).filter((t) => t === 2)).toHaveLength(0);
    socket.tell(0x84, 1, 0x51);
    socket.tell(0x84, 1, 0x52);
    a.pipe.close();
    expect(types(socket).filter((t) => t === 2)).toHaveLength(1);
    socket.tell(0x82, 2, 0x43, 0x44);
    expect(r.code?.slice(0, 2)).toBe('CD');
    // Released by the server: none on the screen, and asked for at once.
    socket.tell(0x86);
    expect(r.codeState).toBe('unavailable');
    expect(types(socket).filter((t) => t === 2)).toHaveLength(2);
    socket.tell(0x82, 0);
    timers.advance(CODE_RETRY_MS - 1);
    expect(types(socket).filter((t) => t === 2)).toHaveLength(2);
    timers.advance(1);
    expect(types(socket).filter((t) => t === 2)).toHaveLength(3);
    socket.tell(0x82, 2, 0x45, 0x46);
    expect(r.code?.slice(0, 2)).toBe('EF');
    timers.advance(CODE_RETRY_MS * 4);
    expect(types(socket).filter((t) => t === 2)).toHaveLength(3);
    timers.advance(RENEW_INTERVAL_MS);
    expect(types(socket).filter((t) => t === RENDEZVOUS_TYPE.RENEW)).toHaveLength(1);
    // A CODE_IS whose locator isn't one ends the room.
    socket.tell(0x82, 2, 0x49, 0x4f);
    expect(codeOf(await r.nextAttempt().catch((err) => err))).toBe('INVALID_RESPONSE');
  });

  it('a room that wants no code never asks for one, nor renews, however long it lives', async () => {
    const timers = new TestTimers();
    const { room: r, socket } = await room({ code: false, timers });
    expect(r.codeState).toBe('off');
    timers.advance(60 * 60_000);
    expect(types(socket)).toEqual([RENDEZVOUS_TYPE.CREATE]);
    expect(timers.pending.size).toBe(0);
  });

  it('this side ending an attempt by code before it was tried still asks for a new code, once', async () => {
    const { room: r, socket } = await room({ locator: 'AB' });
    socket.tell(0x83, 5, 2);
    const a = await r.nextAttempt();
    a.pipe.close();
    a.pipe.close();
    expect(socket.sent.slice(1).map(hex)).toEqual(['0505', '02']);
  });

  it('once locked: a code given just after is never shown, an attempt that joined just before is dropped and never offered, and nothing more is asked', async () => {
    const timers = new TestTimers();
    const { room: r, socket } = await room({ timers });
    expect(r.codeState).toBe('unavailable');
    socket.tell(0x83, 1, 1);
    const kept = await r.nextAttempt();
    r.lock(kept);
    r.lock(kept);
    expect(types(socket).filter((t) => t === RENDEZVOUS_TYPE.LOCK)).toHaveLength(1);
    socket.tell(0x82, 2, 0x41, 0x42);
    expect(r.codeState).toBe('unavailable');
    socket.tell(0x83, 2, 1);
    expect(socket.sent.map(hex).slice(-1)).toEqual(['0502']);
    socket.tell(0x86);
    timers.advance(CODE_RETRY_MS * 10);
    expect(types(socket).filter((t) => t === RENDEZVOUS_TYPE.CODE)).toHaveLength(0);
    expect(timers.pending.size).toBe(0);
    // The kept attempt carries on.
    socket.tell(0x84, 1, 0x77);
    expect(hex(await kept.pipe.receive())).toBe('77');
  });
});

describe('the receiver, on a stand-in WebSocket', () => {
  const joining = async (by: { roomId: Uint8Array } | { locator: string }, codeLetters: 0 | 2 | 3 = 2) => {
    const count = StandIn.made.length;
    const join = receiverRendezvous({ url: URL_, codeLetters, WebSocket: WS }).join(by);
    await until(() => StandIn.made.length > count);
    return { join, socket: last() };
  };

  it('JOINs once open, then takes JOINED\'s nonce; frames both ways; GONE ends the pipe CONNECTION_LOST, an ERROR in core\'s words', async () => {
    const { join, socket } = await joining({ roomId: new Uint8Array(16).fill(7) });
    socket.open();
    await tick();
    expect(socket.sent.map(hex)).toEqual([`11040001${'07'.repeat(16)}`]);
    socket.tellBytes(Uint8Array.of(0x91, ...new Uint8Array(16).fill(9)));
    const { roomNonce, pipe } = await join;
    expect(hex(roomNonce)).toBe('09'.repeat(16));
    pipe.send(Uint8Array.of(5));
    expect(hex(socket.sent[1])).toBe('1205');
    socket.tell(0x92, 6, 6);
    expect(hex(await pipe.receive())).toBe('0606');
    socket.tell(0x92);
    expect(hex(await pipe.receive())).toBe('');
    socket.tell(0x93);
    expect(codeOf(await pipe.receive().catch((err) => err))).toBe('CONNECTION_LOST');
    expect(socket.closedWith).toBe(1000);

    const second = await joining({ locator: 'XY' });
    second.socket.open();
    await tick();
    expect(hex(second.socket.sent[0])).toBe('11040002025859');
    second.socket.tellBytes(Uint8Array.of(0x91, ...new Uint8Array(16)));
    const joined = await second.join;
    second.socket.tell(0xff, 5);
    expect(codeOf(await joined.pipe.receive().catch((err) => err))).toBe('INVALID_RESPONSE');
  });

  it('before JOINED: an ERROR in core\'s words, anything else INVALID_RESPONSE, a close CONNECTION_LOST, never opening SERVER_UNREACHABLE', async () => {
    const cases: Array<[string, (s: StandIn) => void, string]> = [
      ['NOT_FOUND', (s) => s.tell(0xff, 2), 'NOT_FOUND'],
      ['BUSY', (s) => s.tell(0xff, 3), 'REQUEST_REJECTED'],
      ['AUTH_REQUIRED', (s) => s.tell(0xff, 6), 'AUTH_REQUIRED'],
      ['a FRAME first', (s) => s.tell(0x92, 1), 'INVALID_RESPONSE'],
      ['GONE first', (s) => s.tell(0x93), 'INVALID_RESPONSE'],
      ['a text message', (s) => s.tellText('hi'), 'INVALID_RESPONSE'],
      ['JOINED one byte short', (s) => s.tellBytes(Uint8Array.of(0x91, ...new Uint8Array(15))), 'INVALID_RESPONSE'],
      ['a close', (s) => s.drop(), 'CONNECTION_LOST'],
    ];
    for (const [name, then, want] of cases) {
      const { join, socket } = await joining({ roomId: new Uint8Array(16) });
      socket.open();
      await tick();
      then(socket);
      expect(codeOf(await join.catch((err) => err)), name).toBe(want);
    }
    const { join, socket } = await joining({ roomId: new Uint8Array(16) });
    socket.drop();
    expect(codeOf(await join.catch((err) => err))).toBe('SERVER_UNREACHABLE');
    // After JOINED, a second JOINED isn't the server's.
    const late = await joining({ roomId: new Uint8Array(16) });
    late.socket.open();
    await tick();
    late.socket.tellBytes(Uint8Array.of(0x91, ...new Uint8Array(16)));
    const { pipe } = await late.join;
    late.socket.tellBytes(Uint8Array.of(0x91, ...new Uint8Array(16)));
    expect(codeOf(await pipe.receive().catch((err) => err))).toBe('INVALID_RESPONSE');
  });

  it('a code on a server without codes is CAPABILITY_UNSUPPORTED, and one of the wrong length INVALID_ARGUMENT, with no socket opened', async () => {
    expect(codeOf(await receiverRendezvous({ url: URL_, codeLetters: 0, WebSocket: WS }).join({ locator: 'AB' }).catch((e) => e))).toBe('CAPABILITY_UNSUPPORTED');
    expect(codeOf(await receiverRendezvous({ url: URL_, codeLetters: 3, WebSocket: WS }).join({ locator: 'AB' }).catch((e) => e))).toBe('INVALID_ARGUMENT');
    expect(codeOf(await receiverRendezvous({ url: URL_, codeLetters: 2, WebSocket: WS }).join({ locator: 'IO' }).catch((e) => e))).toBe('INVALID_ARGUMENT');
    expect(StandIn.made).toHaveLength(0);
    // A room ID still works on such a server.
    const join = receiverRendezvous({ url: URL_, codeLetters: 0, WebSocket: WS }).join({ roomId: new Uint8Array(16) });
    await tick();
    expect(StandIn.made).toHaveLength(1);
    last().drop();
    await join.catch(() => undefined);
  });

  it('closing its pipe closes its socket; nothing it\'s sent afterwards is taken', async () => {
    const { join, socket } = await joining({ roomId: new Uint8Array(16) });
    socket.open();
    await tick();
    socket.tellBytes(Uint8Array.of(0x91, ...new Uint8Array(16)));
    const { pipe } = await join;
    pipe.close();
    expect(socket.closedWith).toBe(1000);
    socket.tell(0x92, 1);
    pipe.send(Uint8Array.of(1));
    expect(socket.sent).toHaveLength(1);
    expect(codeOf(await pipe.receive().catch((err) => err))).toBe('CONNECTION_LOST');
  });
});

describe("the server's errors in core's words", () => {
  it('names the side to update, and refuses a server refusing its own major', () => {
    expect(rendezvousError(1, { major: 5, minor: 0 })).toMatchObject({ code: 'VERSION_UNSUPPORTED', details: { update: 'client' } });
    expect(rendezvousError(1, { major: 3, minor: 0 })).toMatchObject({ code: 'VERSION_UNSUPPORTED', details: { update: 'server' } });
    expect(rendezvousError(1, { major: 4, minor: 7 }).code).toBe('INVALID_RESPONSE');
    expect([2, 3, 4, 5, 6, 7, 8, 9, 0].map((code) => rendezvousError(code).code)).toEqual([
      'NOT_FOUND', 'REQUEST_REJECTED', 'INVALID_RESPONSE', 'INVALID_RESPONSE', 'AUTH_REQUIRED', 'AUTH_EXPIRED', 'AUTH_DENIED', 'INVALID_RESPONSE',
      'INVALID_RESPONSE',
    ]);
  });
});

describe('the room and the rendezvous\'s news', () => {
  /** A rendezvous a test drives by hand. */
  const handDriven = (locator?: string) => {
    const calls: string[] = [];
    let news: RoomNews | undefined;
    const rendezvous = {
      create: async (_room: unknown, n?: RoomNews) => {
        news = n;
        // News that comes before the room exists is kept for it.
        n?.attempt({ by: 'link', pipe: stubPipe(calls, 'early') });
        return locator ? { locator } : {};
      },
      lock: (keep?: IncomingAttempt) => calls.push(`lock ${keep ? 'one' : 'none'}`),
      close: () => calls.push('close'),
    };
    return { rendezvous, calls, news: () => news as RoomNews };
  };
  const stubPipe = (calls: string[], name: string) => ({
    send: () => undefined, receive: () => new Promise<Uint8Array>(() => undefined), writable: async () => undefined,
    close: () => { calls.push(`close ${name}`); },
  });

  it('takes news that came while it was being made, in order; tells listeners of each code change until they stop', async () => {
    const d = handDriven('AB');
    const r = await openRoom(provider, { rendezvous: d.rendezvous, code: true });
    expect((await r.nextAttempt()).by).toBe('link');
    const seen: Array<string | undefined> = [];
    const stop = r.onCodeChange(() => seen.push(r.code));
    r.onCodeChange(() => { throw new Error("A listener's own error."); });
    d.news().code('CD');
    d.news().code(undefined);
    stop();
    d.news().code('EF');
    expect(seen.map((c) => c?.slice(0, 2))).toEqual(['CD', undefined]);
    expect(r.code?.slice(0, 2)).toBe('EF');
    // A locator that isn't one of this room's length: no code.
    d.news().code('GHJ');
    expect(r.codeState).toBe('unavailable');
  });

  it('lock() passes the kept attempt on and closes the others it holds; close() closes them all and the rendezvous, and ends nextAttempt()', async () => {
    const d = handDriven('AB');
    const r = await openRoom(provider, { rendezvous: d.rendezvous, code: true });
    d.news().attempt({ by: 'link', pipe: stubPipe(d.calls, 'second') });
    const kept = await r.nextAttempt();
    r.lock(kept);
    expect(d.calls).toEqual(['lock one', 'close second']);
    expect(r.codeState).toBe('unavailable');
    const waiting = r.nextAttempt();
    d.news().attempt({ by: 'link', pipe: stubPipe(d.calls, 'third') });
    await waiting;
    d.news().attempt({ by: 'code', pipe: stubPipe(d.calls, 'fourth') });
    r.close();
    expect(d.calls.slice(2)).toEqual(['close fourth', 'close']);
    expect(codeOf(await r.nextAttempt().catch((err) => err))).toBe('OPERATION_CANCELLED');
    // News after the end closes what it brings.
    d.news().attempt({ by: 'link', pipe: stubPipe(d.calls, 'fifth') });
    expect(d.calls.slice(-1)).toEqual(['close fifth']);
  });

  it('a room with its code off takes no code from the rendezvous; lock() leaves the kept attempt open even before it is taken', async () => {
    const d = handDriven();
    const r = await openRoom(provider, { rendezvous: d.rendezvous, code: false });
    d.news().code('CD');
    expect([r.codeState, r.code]).toEqual(['off', undefined]);
    const kept: IncomingAttempt = { by: 'link', pipe: stubPipe(d.calls, 'kept') };
    d.news().attempt(kept);
    r.lock(kept);
    // The early attempt is closed, the kept one isn't.
    expect(d.calls).toEqual(['lock one', 'close early']);
    expect(await r.nextAttempt()).toBe(kept);
  });

  it('an attempt by code accepted after the room was locked for it still runs on its own code', async () => {
    const rendezvous = new MockRendezvous();
    const r = await openRoom(provider, { rendezvous: rendezvous.sender, code: true });
    const peers = new PeerPair();
    const connected = connectByCode(provider, { rendezvous: rendezvous.receiver, code: r.code as string, peer: peers.receiver });
    const attempt = await r.nextAttempt();
    r.lock(attempt);
    const channel = await r.accept(attempt, { peer: peers.sender });
    expect((await connected).mode).toBe('code');
    expect(channel.mode).toBe('code');
    channel.close();
  });

  it('a rendezvous that gives a locator that isn\'t one: INVALID_RESPONSE, and the rendezvous closed', async () => {
    const d = handDriven('ab');
    expect(codeOf(await openRoom(provider, { rendezvous: d.rendezvous, code: true }).catch((err) => err))).toBe('INVALID_RESPONSE');
    expect(d.calls).toEqual(['close']);
  });
});
