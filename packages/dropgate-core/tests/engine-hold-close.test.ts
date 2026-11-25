import { describe, it, expect } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import { webCryptoProvider, type CryptoProvider } from '../src/crypto/index.js';
import { connectByCode, connectByLink, openRoom, type HelloOptions, type SecureChannel } from '../src/dgdtp/channel.js';
import { Link, STATUS_STATE, type DirectOutcome } from '../src/dgdtp/engine.js';
import { CLOSE_KIND } from '../src/dgdtp/seal.js';
import { BLOCK_BYTES, ManifestAssembler, decodeMessage, encodeMessage, manifestHash, type Message } from '../src/dgdtp/messages.js';
import { receiveDirect, type DirectReceiver } from '../src/dgdtp/receive.js';
import { sendDirect, type DirectSender } from '../src/dgdtp/send.js';
import type { FileSource } from '../src/source.js';
import { channels, fingerprintSwapper, transfer, wrongDigit } from './helpers/channel-checks.js';
import { FakeClock, tracked, MemorySink, ScriptedSender, memoryFile, patterned, recordOf, sameAs } from './helpers/direct.js';
import { MockRendezvous, PeerPair, pipePair, type FakePeer, type Side } from './helpers/fake-channel.js';

// The direct-transfer engine's holds, timers and ends (src/dgdtp/engine.ts,
// send.ts, receive.ts, timers.ts; the set-up's timers in channel.ts), in
// memory over the real secure channel, every timer on a clock the test moves
// (FakeClock): pausing either way and both, pause limits and the deadline,
// PING and PONG through a long pause, a peer gone quiet, stalls, STATUS, the
// offer's 10 minutes, the set-up's timers, and CLOSE: answered with
// CLOSE_ACK, sent both ways, heard once, the out-of-band copy arriving after
// the data channel has gone, a cancel racing the receiver's result. Then
// every way a transfer ends, table-driven: one outcome on each side, and at
// most one CLOSE from each.

// Tracked, so the fake clock waits for exactly the crypto each timer starts.
const provider = tracked(webCryptoProvider(globalThis.crypto));
const MiB = 1048576;

// The timers' values as the spec gives them, not read from the code under test, so a timer that moves fails here.
const ICE_TIMEOUT_MS = 30_000;
const HANDSHAKE_TIMEOUT_MS = 15_000;
const SETUP_TIMEOUT_MS = 90_000;
const OFFER_TIMEOUT_MS = 600_000;
const MIN_NO_ANSWER_MS = 15_000;
const NO_PROGRESS_MS = 30_000;
const STALL_SHOWN_MS = 30_000;
const STALL_FAILED_MS = 120_000;
const CLOSE_ACK_WAIT_MS = 2000;

/** `check` true within `ms` of real time, polled. */
async function until(check: () => boolean, what: string, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.`);
    await sleep(2);
  }
}

const said = (o: DirectOutcome) => (o.state === 'failed'
  ? `failed ${o.error.code}`
  : o.state === 'cancelled' ? `cancelled by ${o.by}${o.declined ? ', declined' : ''}` : `completed, ${o.assurance}`);

/** Settled within `ms` of real time: its value, or 'pending'. */
async function soon<T>(promise: Promise<T>, ms = 50): Promise<T | 'pending'> {
  return Promise.race([promise, sleep(ms).then(() => 'pending' as const)]);
}

// A CREDIT's size on the data channel, sealed: its plaintext and Noise's 16-byte tag.
const SEALED_CREDIT = 41 + 16;

/**
 * The CLOSEs each side sent: each goes through the rendezvous too, sealed, one
 * at most each way, so they're counted there (in-band, a CLOSE can lose the
 * race with the other side closing on hearing its copy).
 */
const closesSent = (rendezvous: MockRendezvous) => ({
  receiver: rendezvous.records.filter((r) => r.from === 'receiver' && r.what === 'message' && r.bytes[0] === CLOSE_KIND).length,
  sender: rendezvous.records.filter((r) => r.from === 'sender' && r.what === 'message' && r.bytes[0] === CLOSE_KIND).length,
});

interface Run {
  sender: DirectSender;
  receive(options?: { hello?: HelloOptions; byCode?: string }): Promise<{ receiver: DirectReceiver; pair: PeerPair; channel: SecureChannel }>;
  rendezvous: MockRendezvous;
  clock: FakeClock | undefined;
  /** Each data-channel message's size, by the side that sent it, from the receiver's handshake on. */
  sent: Record<Side, number[]>;
  /** While true, the data channel carries nothing either way: both sides go quiet. */
  cut: { quiet: boolean };
}

/** A whole send, and receivers by its link (or a code), over the in-memory channel, every timer on `clock` if one is given. */
async function direct(
  files: FileSource[],
  options: { clock?: FakeClock; senderHello?: HelloOptions; senderProvider?: CryptoProvider; code?: boolean } = {},
): Promise<Run> {
  const rendezvous = new MockRendezvous();
  const waiting: FakePeer[] = [];
  const sent: Record<Side, number[]> = { receiver: [], sender: [] };
  const cut = { quiet: false };
  const timers = options.clock ? { timers: options.clock } : {};
  const sender = await sendDirect(options.senderProvider ?? provider, {
    files, rendezvous: rendezvous.sender, peer: () => waiting.shift() as FakePeer, hello: options.senderHello, code: options.code, ...timers,
  });
  const receive: Run['receive'] = async ({ hello, byCode } = {}) => {
    const pair = new PeerPair({
      dataRelay: (from, message) => {
        if (cut.quiet) return [];
        sent[from].push(message.byteLength);
        return [message];
      },
    });
    waiting.push(pair.sender);
    const channel = byCode === undefined
      ? await connectByLink(provider, { rendezvous: rendezvous.receiver, secret: sender.room.linkSecret() as Uint8Array, peer: pair.receiver, hello, ...timers })
      : await connectByCode(provider, { rendezvous: rendezvous.receiver, code: byCode, peer: pair.receiver, hello, ...timers });
    return { receiver: receiveDirect(provider, channel, timers), pair, channel };
  };
  return { sender, receive, rendezvous, clock: options.clock, sent, cut };
}

/** Each terminal state a side's listeners saw: exactly one, for an end told once. */
function terminals(side: { state: string; onChange(listener: () => void): () => void }): string[] {
  const seen: string[] = [];
  side.onChange(() => {
    if (['completed', 'cancelled', 'failed'].includes(side.state) && seen[seen.length - 1] !== side.state) seen.push(side.state);
  });
  return seen;
}

describe('HOLD: pausing either way, and both', () => {
  it("the sender's hold: no new DATA after it, what was on its way still saved, nothing sent twice, and after resume the output is identical", async () => {
    const bytes = patterned(12 * MiB + 5, 41);
    const run = await direct([memoryFile('a.bin', bytes)]);
    const { receiver } = await run.receive();
    const sink = new MemorySink();
    expect(run.sender.canPause).toBe(false);
    await receiver.offer();
    expect(receiver.canPause).toBe(false);
    expect(() => receiver.pause()).toThrow(expect.objectContaining({ code: 'PAUSE_UNAVAILABLE' }));
    await receiver.accept({ sink });
    await until(() => run.sender.canPause, 'the sender transferring');
    run.sender.pause();
    expect(run.sender.pausedBy).toBe('self');
    await until(() => receiver.pausedBy === 'peer', 'the receiver hearing the hold');
    // What was already on its way arrives and is saved; then nothing more of the file comes.
    await sleep(300);
    const big = run.sent.sender.filter((n) => n > 1000).length;
    const saved = sink.bytes.byteLength;
    await sleep(300);
    expect(run.sent.sender.filter((n) => n > 1000).length).toBe(big);
    expect(sink.bytes.byteLength).toBe(saved);
    expect(saved).toBeLessThan(bytes.byteLength);
    run.sender.resume();
    expect(said(await run.sender.done)).toBe('completed, saved');
    expect(said(await receiver.done)).toBe('completed, saved');
    expect(sameAs(sink.bytes, bytes)).toBe('the same');
    expect(run.sender.canPause).toBe(false);
  });

  it("the receiver's hold: no CREDIT while it holds, the sender sends nothing beyond what was granted, then the same result", async () => {
    const bytes = patterned(12 * MiB + 1, 42);
    const run = await direct([memoryFile('a.bin', bytes)]);
    const { receiver } = await run.receive();
    const sink = new MemorySink();
    await receiver.accept({ sink });
    receiver.pause();
    expect(receiver.pausedBy).toBe('self');
    await until(() => run.sender.pausedBy === 'peer', 'the sender hearing the hold');
    await sleep(400);
    const credits = run.sent.receiver.filter((n) => n === SEALED_CREDIT).length;
    const fileBytes = run.sent.sender.filter((n) => n > 1000).length;
    await sleep(300);
    expect(run.sent.receiver.filter((n) => n === SEALED_CREDIT).length).toBe(credits);
    expect(run.sent.sender.filter((n) => n > 1000).length).toBe(fileBytes);
    // Never more than the 4 MiB granted at ACCEPT.
    expect(sink.bytes.byteLength).toBeLessThanOrEqual(4 * MiB);
    receiver.resume();
    expect(said(await receiver.done)).toBe('completed, saved');
    expect(said(await run.sender.done)).toBe('completed, saved');
    expect(sameAs(sink.bytes, bytes)).toBe('the same');
  });

  it("both hold; one resumes and it's still held; the other resumes and it runs: pausedBy right on each side at each step", async () => {
    const bytes = patterned(10 * MiB, 43);
    const run = await direct([memoryFile('a.bin', bytes)]);
    const { receiver } = await run.receive();
    const sink = new MemorySink();
    await receiver.accept({ sink });
    await until(() => run.sender.canPause, 'the sender transferring');
    run.sender.pause();
    receiver.pause();
    await until(() => run.sender.pausedBy === 'both' && receiver.pausedBy === 'both', 'both holding');
    run.sender.resume();
    await until(() => run.sender.pausedBy === 'peer' && receiver.pausedBy === 'self', 'the sender letting go');
    await sleep(300);
    const big = run.sent.sender.filter((n) => n > 1000).length;
    await sleep(300);
    expect(run.sent.sender.filter((n) => n > 1000).length).toBe(big);
    receiver.resume();
    await until(() => run.sender.pausedBy === null && receiver.pausedBy === null, 'neither holding');
    expect(said(await receiver.done)).toBe('completed, saved');
    expect(said(await run.sender.done)).toBe('completed, saved');
    expect(sameAs(sink.bytes, bytes)).toBe('the same');
  });

  it("a hold heard after FINISH is passed over and the files are finished: nothing is left to hold", async () => {
    const t = await transfer(provider);
    const { receiver, sender } = channels(t);
    const engine = receiveDirect(provider, receiver);
    const script = new ScriptedSender(provider, sender, [{ name: 'a.txt', bytes: patterned(1000, 44) }]);
    await script.offer();
    const sink = new MemorySink();
    let release!: () => void;
    sink.holdClose = new Promise<void>((resolve) => { release = resolve; });
    await engine.accept({ sink });
    await recordOf(sender, 'accept');
    await script.sendFile(0);
    // The receiver holds, but FINISH was already on its way.
    engine.pause();
    await script.finish();
    await recordOf(sender, 'hold');
    await until(() => engine.state === 'finalising', 'finalising');
    expect(engine.pausedBy).toBe(null);
    expect(engine.canPause).toBe(false);
    await script.send({ type: 'hold', held: true, reason: 'person' });
    await sleep(50);
    expect(engine.pausedBy).toBe(null);
    release();
    const result = await recordOf(sender, 'result');
    await script.send({ type: 'result-ack', commitId: result.commitId });
    expect(said(await engine.done)).toBe('completed, saved');
  });
});

describe('a long pause, and a peer gone quiet (fake clock)', () => {
  it('a 6-hour pause: PING and PONG carry on, no stall is counted even with a write waiting, and the transfer then completes', async () => {
    const clock = new FakeClock();
    const bytes = patterned(6 * MiB, 45);
    const run = await direct([memoryFile('a.bin', bytes)], { clock });
    const { receiver } = await run.receive();
    const sink = new MemorySink();
    let release!: () => void;
    sink.holdWrite = (n) => (n === 2 ? new Promise<void>((resolve) => { release = resolve; }) : undefined);
    await receiver.accept({ sink });
    await until(() => sink.writes === 2, 'the second write waiting');
    receiver.pause();
    await until(() => run.sender.pausedBy === 'peer', 'the hold heard');
    const before = { receiver: run.sent.receiver.length, sender: run.sent.sender.length };
    await clock.advance(6 * 3600_000, 10_000);
    expect(receiver.stalled).toBe(false);
    expect(receiver.state).toBe('transferring');
    expect(run.sender.state).toBe('transferring');
    // A PING each way every 5 s or so, and each answered: thousands of each.
    expect(run.sent.receiver.length - before.receiver).toBeGreaterThan(2 * 2000);
    expect(run.sent.sender.length - before.sender).toBeGreaterThan(2 * 2000);
    release();
    receiver.resume();
    // Real time from here.
    const done = Promise.all([receiver.done, run.sender.done]);
    for (let i = 0; i < 400 && (await soon(done, 5)) === 'pending'; i++) await clock.advance(1000);
    expect((await done).map(said)).toEqual(['completed, saved', 'completed, saved']);
    expect(sameAs(sink.bytes, bytes)).toBe('the same');
  }, 120_000);

  it("a peer that stops answering during a pause: CONNECTION_LOST on both sides after 15 s and the 2 s for a late CLOSE, never cancelled", async () => {
    const clock = new FakeClock();
    const run = await direct([memoryFile('a.bin', patterned(6 * MiB, 46))], { clock });
    const { receiver } = await run.receive();
    await receiver.accept({ sink: new MemorySink() });
    await until(() => run.sender.canPause, 'transferring');
    run.sender.pause();
    await until(() => receiver.pausedBy === 'peer', 'the hold heard');
    run.cut.quiet = true;
    await clock.advance(MIN_NO_ANSWER_MS - 1000, 1000);
    expect(await soon(receiver.done)).toBe('pending');
    await clock.advance(1000 + 2000 + 1000, 500);
    const outcomes = [await receiver.done, await run.sender.done];
    expect(outcomes.map(said)).toEqual(['failed CONNECTION_LOST', 'failed CONNECTION_LOST']);
    for (const o of outcomes) expect(o).toMatchObject({ error: { message: "The connection was lost, so the transfer couldn't continue." } });
  });
});

describe('pause limits and the deadline (fake clock)', () => {
  it('with no limit on either side, a 24-hour pause does not end the transfer, and there is no deadline', async () => {
    const clock = new FakeClock();
    const run = await direct([memoryFile('a.bin', patterned(3 * MiB, 47))], { clock });
    const { receiver } = await run.receive();
    await receiver.accept({ sink: new MemorySink() });
    receiver.pause();
    await until(() => run.sender.pausedBy === 'peer', 'the hold heard');
    expect(receiver.deadline).toBe(null);
    expect(run.sender.deadline).toBe(null);
    await clock.advance(24 * 3600_000, 10_000);
    expect(receiver.state).toBe('transferring');
    expect(run.sender.state).toBe('transferring');
    receiver.resume();
    const done = Promise.all([receiver.done, run.sender.done]);
    for (let i = 0; i < 400 && (await soon(done, 5)) === 'pending'; i++) await clock.advance(1000);
    expect((await done).map(said)).toEqual(['completed, saved', 'completed, saved']);
  }, 180_000);

  for (const pauser of ['sender', 'receiver'] as const) {
    it(`the sender's 1 hour and the receiver's 2 hours, the ${pauser} pausing: both deadlines the earlier, and at it PAUSE_LIMIT on both sides, worded by whose it was`, async () => {
      const clock = new FakeClock();
      const run = await direct([memoryFile('a.bin', patterned(6 * MiB, 48))], { clock, senderHello: { pauseLimitSeconds: 3600 } });
      const { receiver } = await run.receive({ hello: { pauseLimitSeconds: 7200 } });
      const seen = { sender: terminals(run.sender), receiver: terminals(receiver) };
      await receiver.accept({ sink: new MemorySink() });
      await until(() => run.sender.canPause, 'transferring');
      const before = Date.now();
      if (pauser === 'sender') run.sender.pause();
      else receiver.pause();
      await until(() => run.sender.pausedBy !== null && receiver.pausedBy !== null, 'both seeing the hold');
      for (const side of [run.sender, receiver]) {
        expect(side.deadline).toBeGreaterThanOrEqual(before + 3600_000);
        expect(side.deadline).toBeLessThanOrEqual(Date.now() + 3600_000);
      }
      await clock.advance(3600_000 - 10_000, 10_000);
      expect(await soon(receiver.done)).toBe('pending');
      await clock.advance(20_000, 1000);
      const [s, r] = [await run.sender.done, await receiver.done];
      expect(s).toMatchObject({ state: 'failed', error: { code: 'PAUSE_LIMIT', origin: 'local', message: 'Your app ended the transfer after a 1-hour pause.', details: { by: 'self' } } });
      expect(r).toMatchObject({ state: 'failed', error: { code: 'PAUSE_LIMIT', origin: 'peer', message: "The sender's app ended the transfer after a 1-hour pause.", details: { by: 'peer' } } });
      // One CLOSE, the sender's, with PAUSE_LIMIT; one end each.
      expect(closesSent(run.rendezvous)).toEqual({ receiver: 0, sender: 1 });
      expect(seen).toEqual({ sender: ['failed'], receiver: ['failed'] });
    }, 60_000);
  }

  it('each new stop counts afresh: a resume before the limit, then another pause, ends only a whole limit after that one', async () => {
    const clock = new FakeClock();
    const run = await direct([memoryFile('a.bin', patterned(6 * MiB, 49))], { clock });
    const { receiver } = await run.receive({ hello: { pauseLimitSeconds: 60 } });
    await receiver.accept({ sink: new MemorySink() });
    receiver.pause();
    await clock.advance(50_000, 5000);
    receiver.resume();
    receiver.pause();
    await clock.advance(50_000, 5000);
    expect(await soon(receiver.done)).toBe('pending');
    await clock.advance(15_000, 5000);
    expect(await receiver.done).toMatchObject({ state: 'failed', error: { code: 'PAUSE_LIMIT', message: 'Your app ended the transfer after a 1-minute pause.' } });
    expect(await run.sender.done).toMatchObject({ state: 'failed', error: { code: 'PAUSE_LIMIT', message: "The receiver's app ended the transfer after a 1-minute pause." } });
  });
});

describe('stalls (fake clock)', () => {
  it('a sink whose write never finishes: stalled at 30 s, OUTPUT_STALLED at 120 s, and the sender hears the receiver stopped saving', async () => {
    const clock = new FakeClock();
    const run = await direct([memoryFile('a.bin', patterned(3 * MiB, 50))], { clock });
    const { receiver } = await run.receive();
    const sink = new MemorySink();
    sink.holdWrite = (n) => (n === 2 ? new Promise<void>(() => undefined) : undefined);
    await receiver.accept({ sink });
    await until(() => sink.writes === 2, 'the second write waiting');
    await clock.advance(STALL_SHOWN_MS - 1000, 1000);
    expect(receiver.stalled).toBe(false);
    await clock.advance(1000);
    expect(receiver.stalled).toBe(true);
    await clock.advance(STALL_FAILED_MS - STALL_SHOWN_MS, 5000);
    expect(said(await receiver.done)).toBe('failed OUTPUT_STALLED');
    expect(await run.sender.done).toMatchObject({ state: 'failed', error: { code: 'PEER_FAILED', message: "The receiver's device stopped saving the file.", details: { reason: 'OUTPUT_STALLED' } } });
    expect(sink.aborted).toBeTruthy();
  });

  it("a source whose read never finishes: stalled at 30 s, SOURCE_UNAVAILABLE at 120 s, and the receiver hears the sender's file couldn't be read", async () => {
    const clock = new FakeClock();
    const bytes = patterned(3 * MiB, 51);
    let stuckAt = false;
    const stuck: FileSource = {
      name: 'a.bin', size: bytes.byteLength, type: '',
      read: async (start, end) => {
        if (start < BLOCK_BYTES) return bytes.slice(start, end);
        stuckAt = true;
        return new Promise<never>(() => undefined);
      },
    };
    const run = await direct([stuck], { clock });
    const { receiver } = await run.receive();
    await receiver.accept({ sink: new MemorySink() });
    await until(() => stuckAt, 'the read that never finishes');
    await clock.advance(STALL_SHOWN_MS, 1000);
    expect(run.sender.stalled).toBe(true);
    await clock.advance(STALL_FAILED_MS - STALL_SHOWN_MS, 5000);
    expect(await run.sender.done).toMatchObject({ state: 'failed', error: { code: 'SOURCE_UNAVAILABLE' } });
    expect(await receiver.done).toMatchObject({ state: 'failed', error: { code: 'PEER_FAILED', message: "The sender's file couldn't be read.", details: { reason: 'SOURCE_UNAVAILABLE' } } });
  });

  it('a held transfer never counts as stalled: the count stops at the hold and starts afresh at the resume', async () => {
    const clock = new FakeClock();
    const run = await direct([memoryFile('a.bin', patterned(3 * MiB, 52))], { clock });
    const { receiver } = await run.receive();
    const sink = new MemorySink();
    sink.holdWrite = (n) => (n === 2 ? new Promise<void>(() => undefined) : undefined);
    await receiver.accept({ sink });
    await until(() => sink.writes === 2, 'the second write waiting');
    await clock.advance(STALL_SHOWN_MS + 5000, 5000);
    expect(receiver.stalled).toBe(true);
    receiver.pause();
    expect(receiver.stalled).toBe(false);
    await clock.advance(10 * STALL_FAILED_MS, 10_000);
    expect(receiver.stalled).toBe(false);
    expect(await soon(receiver.done)).toBe('pending');
    receiver.resume();
    await clock.advance(STALL_SHOWN_MS - 5000, 5000);
    expect(receiver.stalled).toBe(false);
    await clock.advance(STALL_FAILED_MS, 5000);
    expect(said(await receiver.done)).toBe('failed OUTPUT_STALLED');
  });

  it('finalising: a sink that never finishes closing is OUTPUT_STALLED at 120 s', async () => {
    const clock = new FakeClock();
    const run = await direct([memoryFile('a.bin', patterned(1000, 53))], { clock });
    const { receiver } = await run.receive();
    const sink = new MemorySink();
    sink.holdClose = new Promise<void>(() => undefined);
    await receiver.accept({ sink });
    await until(() => receiver.state === 'finalising', 'finalising');
    await clock.advance(STALL_FAILED_MS, 5000);
    expect(said(await receiver.done)).toBe('failed OUTPUT_STALLED');
    expect(await run.sender.done).toMatchObject({ error: { code: 'PEER_FAILED', details: { reason: 'OUTPUT_STALLED' } } });
  });
});

describe('STATUS, and the offer (fake clock)', () => {
  it('credit given and no data for 30 s: the receiver asks STATUS, and keeps the answer, which changes nothing else', async () => {
    const clock = new FakeClock();
    const bytes = patterned(3 * MiB, 54);
    let gate!: () => void;
    const opened = new Promise<void>((resolve) => { gate = resolve; });
    const slow: FileSource = {
      name: 'a.bin', size: bytes.byteLength, type: '',
      read: async (start, end) => {
        if (start >= BLOCK_BYTES) await opened;
        return bytes.slice(start, end);
      },
    };
    const run = await direct([slow], { clock });
    const { receiver } = await run.receive();
    const sink = new MemorySink();
    await receiver.accept({ sink });
    await until(() => sink.writes === 1, 'the first block written');
    expect(receiver.peerStatus).toBeUndefined();
    await clock.advance(NO_PROGRESS_MS + 1000, 1000);
    await until(() => receiver.peerStatus !== undefined, 'the answer');
    expect(receiver.peerStatus).toEqual({ state: STATUS_STATE.TRANSFERRING, held: false, consumed: BLOCK_BYTES });
    expect(receiver.state).toBe('transferring');
    gate();
    const done = Promise.all([receiver.done, run.sender.done]);
    for (let i = 0; i < 400 && (await soon(done, 5)) === 'pending'; i++) await clock.advance(1000);
    expect((await done).map(said)).toEqual(['completed, saved', 'completed, saved']);
    expect(sameAs(sink.bytes, bytes)).toBe('the same');
  });

  it("an offer not accepted within 10 minutes ends both sides TIMED_OUT, the side whose 10 minutes ran out first telling the other", async () => {
    const clock = new FakeClock();
    const run = await direct([memoryFile('a.bin', patterned(10, 55))], { clock });
    const { receiver } = await run.receive();
    await receiver.offer();
    await clock.advance(OFFER_TIMEOUT_MS - 10_000, 10_000);
    expect(await soon(receiver.done)).toBe('pending');
    await clock.advance(10_000, 1000);
    for (const o of [await receiver.done, await run.sender.done]) {
      expect(o).toMatchObject({ state: 'failed', error: { code: 'TIMED_OUT', message: "The offer wasn't accepted within 10 minutes." } });
    }
    await expect(receiver.accept({ sink: new MemorySink() })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('an accepted offer has no 10-minute timer', async () => {
    const clock = new FakeClock();
    const run = await direct([memoryFile('a.bin', patterned(3 * MiB, 56))], { clock });
    const { receiver } = await run.receive();
    await receiver.accept({ sink: new MemorySink() });
    receiver.pause();
    await clock.advance(2 * OFFER_TIMEOUT_MS, 10_000);
    expect(receiver.state).toBe('transferring');
    expect(run.sender.state).toBe('transferring');
  });
});

describe("the set-up's timers (fake clock)", () => {
  /** A link attempt through a mock rendezvous whose relay `relay` sees every frame, and data channels whose relay `dataRelay` sees every message. */
  async function attempt(clock: FakeClock, options: { relay?: (from: Side, message: Uint8Array) => Uint8Array[]; dataRelay?: (from: Side, message: Uint8Array) => Uint8Array[]; code?: boolean } = {}) {
    const rendezvous = new MockRendezvous();
    if (options.relay) rendezvous.relay = () => options.relay;
    const room = await openRoom(provider, { rendezvous: rendezvous.sender, code: options.code });
    const peers = new PeerPair({ dataRelay: options.dataRelay });
    const receiving = options.code
      ? connectByCode(provider, { rendezvous: rendezvous.receiver, code: room.code as string, peer: peers.receiver, timers: clock })
      : connectByLink(provider, { rendezvous: rendezvous.receiver, secret: room.linkSecret() as Uint8Array, peer: peers.receiver, timers: clock });
    receiving.catch(() => undefined);
    const sending = room.accept(await rendezvous.nextAttempt(), { peer: peers.sender, timers: clock });
    sending.catch(() => undefined);
    await sleep(50);
    return { receiving, sending, peers };
  }

  /** Never a success: the attempt's end is a timeout, or the other side's going once it timed out. */
  const neverSucceeds = async (p: Promise<unknown>) => {
    const err = await p.then(() => 'connected', (e: { code: string }) => e.code);
    expect(['TIMED_OUT', 'CONNECTION_LOST']).toContain(err);
  };

  it("a frame the rendezvous drops is a timeout in the right words, never a success: the receiver's offer lost ends it at ICE's 30 s", async () => {
    const clock = new FakeClock();
    const { receiving, sending, peers } = await attempt(clock, { relay: (from, message) => (from === 'receiver' ? [] : [message]) });
    await clock.advance(ICE_TIMEOUT_MS - 1000, 1000);
    expect(await soon(receiving)).toBe('pending');
    await clock.advance(1000);
    await expect(receiving).rejects.toMatchObject({ code: 'TIMED_OUT', message: "Couldn't connect to the other device." });
    await neverSucceeds(sending);
    expect(peers.receiver.closed && peers.sender.closed).toBe(true);
  });

  it("a sender's attempt that hears nothing after it reaches the room ends at the set-up's 90 s, TIMED_OUT", async () => {
    const clock = new FakeClock();
    const room = await openRoom(provider, { rendezvous: new MockRendezvous().sender });
    const silent = pipePair();
    const peer = new PeerPair();
    const sending = room.accept({ by: 'link', pipe: silent.sender }, { peer: peer.sender, timers: clock });
    sending.catch(() => undefined);
    await clock.advance(SETUP_TIMEOUT_MS - 5000, 5000);
    expect(await soon(sending)).toBe('pending');
    await clock.advance(5000);
    await expect(sending).rejects.toMatchObject({ code: 'TIMED_OUT', message: "Couldn't connect to the other device." });
    expect(silent.sender.closed && peer.sender.closed).toBe(true);
  });

  it("a handshake that stalls once the data channel is open ends at 15 s, TIMED_OUT, and never connects", async () => {
    const clock = new FakeClock();
    // Noise's second message never arrives.
    const { receiving, sending, peers } = await attempt(clock, { dataRelay: (from, message) => (from === 'sender' ? [] : [message]) });
    await until(() => peers.data !== undefined, 'the data channel open');
    await sleep(50);
    await clock.advance(HANDSHAKE_TIMEOUT_MS - 1000, 1000);
    expect(await soon(receiving)).toBe('pending');
    expect(await soon(sending)).toBe('pending');
    await clock.advance(1000);
    await expect(receiving).rejects.toMatchObject({ code: 'TIMED_OUT' });
    await neverSucceeds(sending);
  });

  it("a code's exchange whose answer the rendezvous drops ends the receiver at the set-up's 90 s, and never connects", async () => {
    const clock = new FakeClock();
    const { receiving, sending } = await attempt(clock, { code: true, relay: (from, message) => (from === 'sender' ? [] : [message]) });
    await clock.advance(SETUP_TIMEOUT_MS - 5000, 5000);
    expect(await soon(receiving)).toBe('pending');
    await clock.advance(5000);
    await expect(receiving).rejects.toMatchObject({ code: 'TIMED_OUT', message: "Couldn't connect to the other device." });
    await neverSucceeds(sending);
  });

  it('a channel that comes up leaves no set-up timer waiting', async () => {
    const clock = new FakeClock();
    const run = await direct([memoryFile('a.bin', patterned(10, 57))], { clock });
    await run.receive();
    await until(() => run.sender.state === 'offered', 'the sender offering');
    // Only liveness (PING at 5 s, no answer at 15 s, each side) and the offer's 10 minutes, each side's.
    expect(clock.waiting.filter((ms) => ms !== 5000 && ms !== MIN_NO_ANSWER_MS && ms !== OFFER_TIMEOUT_MS)).toEqual([]);
  });
});

describe('CLOSE: one way to end', () => {
  it('a cancel sends CLOSE{USER_CANCELLED} in-band and through the rendezvous, the same both ways, and closes once CLOSE_ACK comes', async () => {
    const { engine, script } = await (async () => {
      const t = await transfer(provider);
      const pair = channels(t);
      return { engine: receiveDirect(provider, pair.receiver), script: new ScriptedSender(provider, pair.sender, [{ name: 'a.txt', bytes: patterned(10, 58) }]) };
    })();
    await script.offer();
    await engine.offer();
    engine.cancel();
    expect(said(await engine.done)).toBe('cancelled by self');
    const inBand = await recordOf(script.channel, 'close');
    const outOfBand = decodeMessage(await script.channel.closeReceived) as Extract<Message, { type: 'close' }>;
    expect(inBand).toMatchObject({ reason: 'USER_CANCELLED' });
    expect(outOfBand).toEqual(inBand);
    await script.send({ type: 'close-ack', operationId: inBand.operationId, finished: false });
    await expect(script.channel.receive()).rejects.toBeDefined();
  });

  it('a CLOSE heard is answered with CLOSE_ACK for its operation; a second, by either path, is ignored', async () => {
    const t = await transfer(provider);
    const pair = channels(t);
    const engine = receiveDirect(provider, pair.receiver);
    const script = new ScriptedSender(provider, pair.sender, [{ name: 'a.txt', bytes: patterned(10, 59) }]);
    await script.offer();
    await engine.offer();
    const first = { type: 'close', operationId: new Uint8Array(16).fill(1), reason: 'USER_CANCELLED' } as const;
    await script.send(first);
    await script.channel.sendClose(encodeMessage({ type: 'close', operationId: new Uint8Array(16).fill(2), reason: 'FAILED', detail: 'SOURCE_UNAVAILABLE' }));
    await script.send({ type: 'close', operationId: new Uint8Array(16).fill(3), reason: 'APP_CLOSED' });
    expect(said(await engine.done)).toBe('cancelled by peer');
    const ack = await recordOf(script.channel, 'close-ack');
    expect(ack).toEqual({ type: 'close-ack', operationId: first.operationId, finished: false });
    const rest: Message[] = [];
    await expect(recordOf(script.channel, 'close-ack', rest)).rejects.toBeDefined();
    expect(rest.filter((m) => m.type === 'close-ack')).toEqual([]);
  });

  it("the out-of-band CLOSE arriving once the data channel has gone ends the receiver as it says, not CONNECTION_LOST", async () => {
    const clock = new FakeClock();
    const run = await direct([memoryFile('a.bin', patterned(6 * MiB, 60))], { clock });
    const { receiver, pair } = await run.receive();
    await receiver.accept({ sink: new MemorySink() });
    await until(() => run.sender.canPause, 'transferring');
    pair.data?.receiver.close();
    await sleep(50);
    await clock.advance(1000);
    expect(await soon(receiver.done)).toBe('pending');
    // The sender's app closes now, its data channel already gone: its CLOSE goes through the rendezvous alone.
    run.sender.appClosed();
    expect(await receiver.done).toMatchObject({ state: 'failed', error: { code: 'PEER_CLOSED', message: 'The sender closed Dropgate before the transfer finished.' } });
    expect(said(await run.sender.done)).toBe('cancelled by self');
  });

  it('with no CLOSE through the rendezvous either, a lost data channel ends CONNECTION_LOST 2 s later', async () => {
    const clock = new FakeClock();
    const run = await direct([memoryFile('a.bin', patterned(6 * MiB, 61))], { clock });
    const { receiver, pair } = await run.receive();
    await receiver.accept({ sink: new MemorySink() });
    await until(() => run.sender.canPause, 'transferring');
    pair.data?.receiver.close();
    await sleep(50);
    await clock.advance(CLOSE_ACK_WAIT_MS - 100);
    expect(await soon(receiver.done)).toBe('pending');
    await clock.advance(100);
    expect((await Promise.all([receiver.done, run.sender.done])).map(said)).toEqual(['failed CONNECTION_LOST', 'failed CONNECTION_LOST']);
  });

  it('an app closing seals its CLOSE and hands it to the rendezvous before appClosed() returns, each side, ahead of anything else', async () => {
    for (const side of ['receiver', 'sender'] as const) {
      const run = await direct([memoryFile('a.bin', patterned(6 * MiB, 64))]);
      const { receiver } = await run.receive();
      // What had gone through the rendezvous when this side did anything else: aborted its sink, told its listeners.
      const atAbort: number[] = [];
      const sink = new MemorySink();
      const abort = sink.abort.bind(sink);
      sink.abort = (reason?: unknown) => { atAbort.push(closesSent(run.rendezvous).receiver); return abort(reason); };
      const atTold: number[] = [];
      run.sender.onChange(() => { if (run.sender.state === 'cancelled') atTold.push(closesSent(run.rendezvous).sender); });
      await receiver.accept({ sink });
      await until(() => run.sender.canPause && receiver.canPause, 'transferring');
      const before = closesSent(run.rendezvous);
      (side === 'sender' ? run.sender : receiver).appClosed();
      // No await in between: the sealed copy went within the call, and before anything else.
      expect(closesSent(run.rendezvous)).toEqual({ ...before, [side]: before[side] + 1 });
      expect(before[side]).toBe(0);
      if (side === 'receiver') expect(atAbort).toEqual([1]);
      else expect(atTold[0]).toBe(1);
      const [r, s] = await Promise.all([receiver.done, run.sender.done]);
      expect(side === 'sender' ? r : s).toMatchObject({ state: 'failed', error: { code: 'PEER_CLOSED' } });
    }
  });

  it("an out-of-band CLOSE that overtakes the records sent before it waits for them: a cancel straight after Download ends the send cancelled, not waiting", async () => {
    const run = await direct([memoryFile('a.bin', patterned(6 * MiB, 65))]);
    const { receiver } = await run.receive();
    await receiver.accept({ sink: new MemorySink() });
    // The ACCEPT is on the data channel; the CLOSE's sealed copy goes through the rendezvous at once and gets there first.
    receiver.cancel();
    expect((await Promise.all([receiver.done, run.sender.done])).map(said)).toEqual(['cancelled by self', 'cancelled by peer']);
  });

  it('an out-of-band CLOSE heard while the data channel is up and nothing follows in-band is acted on after 2 s, or as soon as the data channel goes', async () => {
    for (const end of ['2 s', 'the data channel going'] as const) {
      const clock = new FakeClock();
      const run = await direct([memoryFile('a.bin', patterned(6 * MiB, 66))], { clock });
      const { receiver, pair, channel } = await run.receive();
      await receiver.accept({ sink: new MemorySink() });
      await until(() => run.sender.canPause, 'transferring');
      // Held, so the transfer can't finish in the meantime.
      receiver.pause();
      await until(() => run.sender.pausedBy === 'peer', 'the sender held');
      // Only the rendezvous's copy, as from a page whose in-band CLOSE never got out.
      channel.sendClose(encodeMessage({ type: 'close', operationId: new Uint8Array(16).fill(4), reason: 'APP_CLOSED' }));
      await sleep(50);
      if (end === '2 s') {
        await clock.advance(1900);
        expect(await soon(run.sender.done)).toBe('pending');
        await clock.advance(100);
      } else {
        expect(await soon(run.sender.done)).toBe('pending');
        pair.data?.receiver.close();
      }
      expect(await run.sender.done).toMatchObject({ state: 'failed', error: { code: 'PEER_CLOSED' } });
      receiver.cancel();
      await receiver.done;
    }
  });

  it("a CLOSE once RESULT has gone gets CLOSE_ACK{finished} with the RESULT, and the receive stays completed", async () => {
    const t = await transfer(provider);
    const pair = channels(t);
    const engine = receiveDirect(provider, pair.receiver);
    const script = new ScriptedSender(provider, pair.sender, [{ name: 'a.txt', bytes: patterned(100, 62) }]);
    await script.offer();
    await engine.accept({ sink: new MemorySink() });
    await recordOf(pair.sender, 'accept');
    await script.sendFile(0);
    await script.finish();
    const result = await recordOf(pair.sender, 'result');
    await script.send({ type: 'close', operationId: new Uint8Array(16).fill(4), reason: 'USER_CANCELLED' });
    const ack = await recordOf(pair.sender, 'close-ack');
    expect(ack).toEqual({ type: 'close-ack', operationId: new Uint8Array(16).fill(4), finished: true, result: { commitId: result.commitId, assurance: 'saved', fileCount: 1, totalSize: 100, chain: result.chain } });
    expect(said(await engine.done)).toBe('completed, saved');
  });

  it("a sender's cancel racing the receiver's result: the receiver finishing within 2 s answers with its RESULT, and both are completed", async () => {
    const bytes = patterned(2 * MiB, 63);
    const run = await direct([memoryFile('a.bin', bytes)]);
    const { receiver } = await run.receive();
    const sink = new MemorySink();
    let release!: () => void;
    sink.holdClose = new Promise<void>((resolve) => { release = resolve; });
    await receiver.accept({ sink });
    await until(() => receiver.state === 'finalising' && run.sender.state === 'finalising', 'both finalising');
    run.sender.cancel();
    await sleep(100);
    release();
    expect((await Promise.all([receiver.done, run.sender.done])).map(said)).toEqual(['completed, saved', 'completed, saved']);
    expect(sameAs(sink.bytes, bytes)).toBe('the same');
  });

  it("a sender's cancel the receiver can't answer within 2 s leaves the sender cancelled; the receiver, saving its files after, is completed", async () => {
    const clock = new FakeClock();
    const bytes = patterned(1000, 64);
    const run = await direct([memoryFile('a.bin', bytes)], { clock });
    const { receiver } = await run.receive();
    const sink = new MemorySink();
    let release!: () => void;
    sink.holdClose = new Promise<void>((resolve) => { release = resolve; });
    await receiver.accept({ sink });
    await until(() => receiver.state === 'finalising' && run.sender.state === 'finalising', 'both finalising');
    run.sender.cancel();
    await sleep(50);
    await clock.advance(CLOSE_ACK_WAIT_MS + CLOSE_ACK_WAIT_MS + 100, 100);
    expect(said(await run.sender.done)).toBe('cancelled by self');
    expect(await soon(receiver.done)).toBe('pending');
    // A late cancel can't undo a save.
    release();
    expect(said(await receiver.done)).toBe('completed, saved');
    expect(sameAs(sink.bytes, bytes)).toBe('the same');
  });

  for (const closer of ['sender', 'receiver'] as const) {
    it(`the ${closer}'s app closing: CLOSE{APP_CLOSED}, and the other side fails PEER_CLOSED in its own words`, async () => {
      const run = await direct([memoryFile('a.bin', patterned(6 * MiB, 65))]);
      const { receiver } = await run.receive();
      await receiver.accept({ sink: new MemorySink() });
      await until(() => run.sender.canPause, 'transferring');
      (closer === 'sender' ? run.sender : receiver).appClosed();
      const other = closer === 'sender' ? await receiver.done : await run.sender.done;
      const self = closer === 'sender' ? await run.sender.done : await receiver.done;
      expect(said(self)).toBe('cancelled by self');
      expect(other).toMatchObject({
        state: 'failed', error: { code: 'PEER_CLOSED', origin: 'peer', message: `The ${closer} closed Dropgate before the transfer finished.` },
      });
    });
  }
});

describe('the message set: each record has its one handler', () => {
  /** A receiver mid-offer, its sender played by hand. */
  async function offered() {
    const t = await transfer(provider);
    const pair = channels(t);
    const engine = receiveDirect(provider, pair.receiver);
    const script = new ScriptedSender(provider, pair.sender, [{ name: 'a.txt', bytes: patterned(10, 80) }]);
    await script.offer();
    await engine.offer();
    return { engine, script, sender: pair.sender };
  }

  it('PING is answered with its PONG, a STATUS ask with an answer, as they arrive; a stray PONG, STATUS answer or CLOSE_ACK is passed over', async () => {
    const { engine, script, sender } = await offered();
    await script.send({ type: 'ping', id: 77n });
    expect(await recordOf(sender, 'pong')).toEqual({ type: 'pong', id: 77n });
    await script.send({ type: 'status', kind: 'ask', id: 5n });
    expect(await recordOf(sender, 'status')).toEqual({ type: 'status', kind: 'answer', id: 5n, state: STATUS_STATE.OFFERED, held: false, consumed: 0 });
    await script.send({ type: 'pong', id: 9n });
    await script.send({ type: 'status', kind: 'answer', id: 9n, state: 2, held: true, consumed: 3 });
    await script.send({ type: 'close-ack', operationId: new Uint8Array(16), finished: false });
    await sleep(50);
    expect(engine.state).toBe('offered');
    // The answer to no ask of its own is still kept, as any answer is: it changes nothing else.
    expect(engine.peerStatus).toEqual({ state: 2, held: true, consumed: 3 });
  });

  const refused: Array<[string, Uint8Array]> = [
    ['a record only the receiver sends (ACCEPT)', encodeMessage({ type: 'accept', manifestHash: new Uint8Array(32), resumeSecret: new Uint8Array(32), creditLimit: 1, sink: 'saved' })],
    ['RESUME, reserved for recovery', Uint8Array.of(16)],
    ['RESUME_OK, reserved for recovery', Uint8Array.of(17)],
    ['an unknown type', Uint8Array.of(19, 0, 0)],
    ['type 0', Uint8Array.of(0)],
  ];
  for (const [what, record] of refused) {
    it(`${what} fails explicitly, INVALID_MESSAGE, and the sender is told`, async () => {
      const { engine, sender } = await offered();
      await sender.send(record);
      expect(said(await engine.done)).toBe('failed INVALID_MESSAGE');
      expect(await recordOf(sender, 'close')).toMatchObject({ reason: 'FAILED', detail: 'INVALID_MESSAGE' });
    });
  }
});

/** A provider whose SHA-256 of the first whole block it hashes is wrong: the sender's hash of what it sends then doesn't match. */
function lyingProvider(): CryptoProvider {
  let lied = false;
  return {
    ...provider,
    sha256: async (data: Uint8Array) => {
      const hash = await provider.sha256(data);
      if (!lied && data.byteLength === BLOCK_BYTES) {
        lied = true;
        hash[0] ^= 1;
      }
      return hash;
    },
  };
}

interface Row {
  what: string;
  /** Makes the transfer end; gives each side's outcome as `said()` writes it, and who sent a CLOSE. */
  run(): Promise<{ receiver: string; sender: string; closes?: { receiver: number; sender: number } }>;
  receiver: string;
  sender: string;
  /** The side that sends the one CLOSE, if any. */
  closer?: Side;
}

/** A transfer under way between both engines, with each side's terminal states counted. */
async function underWay(files: FileSource[] = [memoryFile('a.bin', patterned(6 * MiB, 70))], options: Parameters<typeof direct>[1] = {}, sink = new MemorySink(), accept = true) {
  const run = await direct(files, options);
  const r = await run.receive();
  const seen = { sender: terminals(run.sender), receiver: terminals(r.receiver) };
  if (accept) {
    await r.receiver.accept({ sink });
  } else {
    await r.receiver.offer();
  }
  return { ...run, ...r, seen, sink };
}

/** Both outcomes, each side's terminal states seen exactly once, and the CLOSEs each sent. */
async function ended(t: Awaited<ReturnType<typeof underWay>>) {
  const [s, r] = [await t.sender.done, await t.receiver.done];
  await sleep(20);
  expect(t.seen).toEqual({ sender: [s.state], receiver: [r.state] });
  return {
    receiver: describeOutcome(r), sender: describeOutcome(s),
    closes: closesSent(t.rendezvous),
  };
}

const describeOutcome = (o: DirectOutcome) => (o.state === 'failed' ? `failed ${o.error.code}: ${o.error.message}` : said(o));

const ROWS: Row[] = [
  {
    what: 'completed, saved', receiver: 'completed, saved', sender: 'completed, saved',
    run: async () => ended(await underWay()),
  },
  {
    what: 'completed, handed to a browser', receiver: 'completed, handed-off', sender: 'completed, handed-off',
    run: async () => {
      const run = await direct([memoryFile('a.bin', patterned(1000, 71))]);
      const r = await run.receive();
      const seen = { sender: terminals(run.sender), receiver: terminals(r.receiver) };
      await r.receiver.accept({ sink: new MemorySink(), handOff: true });
      return ended({ ...run, ...r, seen, sink: new MemorySink() });
    },
  },
  {
    what: 'the receiver cancels', receiver: 'cancelled by self', sender: 'cancelled by peer', closer: 'receiver',
    run: async () => {
      const t = await underWay();
      await until(() => t.receiver.canPause, 'transferring');
      t.receiver.cancel();
      return ended(t);
    },
  },
  {
    what: 'the sender cancels', receiver: 'cancelled by peer', sender: 'cancelled by self', closer: 'sender',
    run: async () => {
      const t = await underWay();
      await until(() => t.sender.canPause, 'transferring');
      t.sender.cancel();
      return ended(t);
    },
  },
  {
    what: 'the receiver declines', receiver: 'cancelled by self', sender: 'cancelled by peer, declined', closer: 'receiver',
    run: async () => {
      const t = await underWay(undefined, {}, undefined, false);
      t.receiver.decline();
      return ended(t);
    },
  },
  {
    what: "the sender's app closed", receiver: 'failed PEER_CLOSED: The sender closed Dropgate before the transfer finished.', sender: 'cancelled by self', closer: 'sender',
    run: async () => {
      const t = await underWay();
      t.sender.appClosed();
      return ended(t);
    },
  },
  {
    what: "the receiver's app closed", receiver: 'cancelled by self', sender: 'failed PEER_CLOSED: The receiver closed Dropgate before the transfer finished.', closer: 'receiver',
    run: async () => {
      const t = await underWay();
      t.receiver.appClosed();
      return ended(t);
    },
  },
  {
    what: "the receiver's pause limit", receiver: 'failed PAUSE_LIMIT: Your app ended the transfer after a 1-minute pause.',
    sender: "failed PAUSE_LIMIT: The receiver's app ended the transfer after a 1-minute pause.", closer: 'receiver',
    run: async () => {
      const clock = new FakeClock();
      const run = await direct([memoryFile('a.bin', patterned(6 * MiB, 72))], { clock });
      const r = await run.receive({ hello: { pauseLimitSeconds: 60 } });
      const t = { ...run, ...r, seen: { sender: terminals(run.sender), receiver: terminals(r.receiver) }, sink: new MemorySink() };
      await t.receiver.accept({ sink: t.sink });
      t.receiver.pause();
      await clock.advance(61_000, 1000);
      return ended(t);
    },
  },
  {
    what: 'the connection dropped', receiver: "failed CONNECTION_LOST: The connection was lost, so the transfer couldn't continue.",
    sender: "failed CONNECTION_LOST: The connection was lost, so the transfer couldn't continue.",
    run: async () => {
      const clock = new FakeClock();
      const run = await direct([memoryFile('a.bin', patterned(6 * MiB, 73))], { clock });
      const r = await run.receive();
      const t = { ...run, ...r, seen: { sender: terminals(run.sender), receiver: terminals(r.receiver) }, sink: new MemorySink() };
      await t.receiver.accept({ sink: t.sink });
      await until(() => t.sender.canPause, 'transferring');
      t.pair.data?.sender.close();
      await sleep(50);
      await clock.advance(3000, 500);
      return ended(t);
    },
  },
  {
    what: "the receiver's output failed", receiver: "failed OUTPUT_WRITE_FAILED: Received data couldn't be written.", sender: "failed PEER_FAILED: The receiver couldn't save the file.", closer: 'receiver',
    run: async () => {
      const sink = new MemorySink();
      sink.failWrite = 2;
      return ended(await underWay(undefined, {}, sink));
    },
  },
  {
    what: "the receiver's output stalled", receiver: 'failed OUTPUT_STALLED: Saving the received files stopped for 2 minutes, so the transfer ended.',
    sender: "failed PEER_FAILED: The receiver's device stopped saving the file.", closer: 'receiver',
    run: async () => {
      const clock = new FakeClock();
      const sink = new MemorySink();
      sink.holdWrite = (n) => (n === 2 ? new Promise<void>(() => undefined) : undefined);
      const t = await underWay(undefined, { clock }, sink);
      await until(() => sink.writes === 2, 'the second write waiting');
      await clock.advance(STALL_FAILED_MS, 5000);
      return ended(t);
    },
  },
  {
    what: "the sender's file couldn't be read", receiver: "failed PEER_FAILED: The sender's file couldn't be read.", sender: "failed SOURCE_UNAVAILABLE: A file couldn't be read.", closer: 'sender',
    run: async () => ended(await underWay([memoryFile('a.bin', patterned(3 * MiB, 74), { fail: (start) => start >= BLOCK_BYTES })])),
  },
  {
    what: "the sender's file stalled", receiver: "failed PEER_FAILED: The sender's file couldn't be read.",
    sender: 'failed SOURCE_UNAVAILABLE: Reading a file stopped for 2 minutes, so the transfer ended.', closer: 'sender',
    run: async () => {
      const clock = new FakeClock();
      const bytes = patterned(3 * MiB, 75);
      let stuckAt = false;
    const stuck: FileSource = {
      name: 'a.bin', size: bytes.byteLength, type: '',
      read: async (start, end) => {
        if (start < BLOCK_BYTES) return bytes.slice(start, end);
        stuckAt = true;
        return new Promise<never>(() => undefined);
      },
    };
      const t = await underWay([stuck], { clock });
      await until(() => stuckAt, 'the read that never finishes');
      await clock.advance(STALL_FAILED_MS, 5000);
      return ended(t);
    },
  },
  {
    what: "a block didn't match its hash", receiver: "failed INTEGRITY_FAILED: A block of a file didn't match its hash.", sender: "failed PEER_FAILED: The file didn't arrive intact.", closer: 'receiver',
    run: async () => ended(await underWay([memoryFile('a.bin', patterned(3 * MiB, 76))], { senderProvider: lyingProvider() })),
  },
  {
    what: 'a record that isn\'t one', receiver: "failed INVALID_MESSAGE: The other device sent something this version of Dropgate doesn't understand.",
    sender: "failed PEER_FAILED: The receiver's device couldn't understand what this device sent.", closer: 'receiver',
    run: async () => {
      const t = await underWay();
      await until(() => t.receiver.canPause, 'transferring');
      // A record only a receiver sends, as if it came from the sender.
      await t.receiver.deliver({ generation: 0n, record: encodeMessage({ type: 'credit', revision: 1, limit: 1, consumed: 0, filesDone: 0, verifiedFileIndex: 0, verifiedOffset: 0 }) });
      return ended(t);
    },
  },
  {
    what: 'nobody accepted', receiver: "failed TIMED_OUT: The offer wasn't accepted within 10 minutes.", sender: "failed TIMED_OUT: The offer wasn't accepted within 10 minutes.",
    run: async () => {
      const clock = new FakeClock();
      const t = await underWay(undefined, { clock }, undefined, false);
      await clock.advance(OFFER_TIMEOUT_MS, 10_000);
      const out = await ended(t);
      // Whichever 10 minutes ran out first told the other: one CLOSE in all.
      expect(out.closes.receiver + out.closes.sender).toBe(1);
      return { ...out, closes: undefined };
    },
  },
];

describe('every end in the table: exactly one outcome on each side, and at most one CLOSE, from the side that ended it', () => {
  for (const row of ROWS) {
    it(row.what, async () => {
      const out = await row.run();
      expect({ receiver: out.receiver, sender: out.sender }).toEqual({ receiver: row.receiver, sender: row.sender });
      if (out.closes) {
        expect(out.closes).toEqual({ receiver: row.closer === 'receiver' ? 1 : 0, sender: row.closer === 'sender' ? 1 : 0 });
      }
    }, 60_000);
  }

  it('a wrong code: CODE_MISMATCH on both sides, each in its own words, once; the send goes on', async () => {
    const run = await direct([memoryFile('a.bin', patterned(10, 77))], { code: true });
    const ends: string[] = [];
    run.sender.onAttemptEnded((err) => ends.push(`${err.code}: ${err.message}`));
    await expect(run.receive({ byCode: wrongDigit(run.sender.room.code as string) })).rejects.toMatchObject({
      code: 'CODE_MISMATCH', message: "That code didn't match. Ask the sender for the new one.",
    });
    await until(() => ends.length > 0, 'the sender hearing it');
    await sleep(50);
    expect(ends).toEqual(["CODE_MISMATCH: Someone entered the wrong code. Here's a new one."]);
    expect(run.sender.state).toBe('waiting');
    run.sender.cancel();
  });

  it('a security fault: SECURITY_POLICY_MISMATCH on both sides, once, with no CLOSE', async () => {
    const run = await direct([memoryFile('a.bin', patterned(10, 78))]);
    run.rendezvous.relay = () => fingerprintSwapper(provider, { offer: true })(run.sender.room);
    const ends: string[] = [];
    run.sender.onAttemptEnded((err) => ends.push(err.code));
    await expect(run.receive()).rejects.toMatchObject({ code: 'SECURITY_POLICY_MISMATCH' });
    await until(() => ends.length > 0, 'the sender hearing it');
    await sleep(50);
    expect(ends).toEqual(['SECURITY_POLICY_MISMATCH']);
    expect(closesSent(run.rendezvous)).toEqual({ receiver: 0, sender: 0 });
    run.sender.cancel();
  });
});

/** A sender's engine, and its one receiver played by hand over the raw channel: the list of files read whole. */
async function senderAndRaw(files: FileSource[], clock?: FakeClock) {
  const rendezvous = new MockRendezvous();
  const pair = new PeerPair();
  const sender = await sendDirect(provider, { files, rendezvous: rendezvous.sender, peer: () => pair.sender, ...(clock ? { timers: clock } : {}) });
  const raw = await connectByLink(provider, { rendezvous: rendezvous.receiver, secret: sender.room.linkSecret() as Uint8Array, peer: pair.receiver });
  const assembler = new ManifestAssembler(Math.min(raw.maxRecordBytes, raw.peerHello.maxRecord));
  let manifest: Uint8Array | undefined;
  while (!manifest) manifest = assembler.take(await recordOf(raw, 'manifest'));
  const hash = await manifestHash(provider, manifest);
  const accept = () => raw.send(encodeMessage({ type: 'accept', manifestHash: hash, resumeSecret: new Uint8Array(32).fill(7), creditLimit: 4 * MiB, sink: 'saved' }));
  return { sender, raw, accept, rendezvous };
}

/** A link on `channel` doing nothing but staying alive on `clock` (PING, PONG): the CLOSEs it hears. */
function alive(channel: SecureChannel, clock: FakeClock): Array<Extract<Message, { type: 'close' }>> {
  const heard: Array<Extract<Message, { type: 'close' }>> = [];
  new Link(channel, {
    record: async () => undefined,
    ended: () => undefined,
    close: (message) => { heard.push(message); },
    status: () => ({ state: 0, held: false, consumed: 0 }),
    overrun: () => undefined,
  }, clock).start();
  return heard;
}

/** The RESULT a receiver would send for a FINISH. */
const resultFor = (finish: Extract<Message, { type: 'finish' }>) => ({
  commitId: new Uint8Array(16).fill(3), assurance: 'saved' as const, fileCount: finish.fileCount, totalSize: finish.totalSize, chain: finish.chain,
});

/** A receiver's engine over a channel whose sender the test plays, one small file offered, accepted into `sink`, sent, and FINISH sent. */
async function receiverFinishing(sink: MemorySink, seed: number) {
  const pair = channels(await transfer(provider));
  const engine = receiveDirect(provider, pair.receiver);
  const script = new ScriptedSender(provider, pair.sender, [{ name: 'a.txt', bytes: patterned(100, seed) }]);
  await script.offer();
  await engine.accept({ sink });
  await recordOf(pair.sender, 'accept');
  await script.sendFile(0);
  await script.finish();
  return { engine, script, sender: pair.sender };
}

describe('holds, CLOSEs and timers at their edges', () => {
  it('a HOLD before the offer is accepted is passed over: no one holds it, and once accepted it runs', async () => {
    const pair = channels(await transfer(provider));
    const engine = receiveDirect(provider, pair.receiver);
    const script = new ScriptedSender(provider, pair.sender, [{ name: 'a.txt', bytes: patterned(10, 90) }]);
    await script.offer();
    await engine.offer();
    await script.send({ type: 'hold', held: true, reason: 'person' });
    await sleep(50);
    expect(engine.pausedBy).toBe(null);
    await engine.accept({ sink: new MemorySink() });
    await recordOf(pair.sender, 'accept');
    await script.sendFile(0);
    // A file finished is credited at once: no hold holds it back.
    expect(await recordOf(pair.sender, 'credit')).toMatchObject({ consumed: 10 });
  });

  it("while the receiver holds, what's written gives no CREDIT; on its resume the CREDIT held back goes, and the transfer completes", async () => {
    const bytes = patterned(12 * MiB, 91);
    const run = await direct([memoryFile('a.bin', bytes)]);
    const { receiver } = await run.receive();
    const sink = new MemorySink();
    let release!: () => void;
    sink.holdWrite = (n) => (n === 2 ? new Promise<void>((resolve) => { release = resolve; }) : undefined);
    await receiver.accept({ sink });
    await until(() => sink.writes === 2, 'the second write waiting');
    // The sender has sent what its credit allows by now.
    await sleep(300);
    receiver.pause();
    await until(() => run.sender.pausedBy === 'peer', 'the hold heard');
    const credits = run.sent.receiver.filter((n) => n === SEALED_CREDIT).length;
    release();
    await until(() => sink.writes >= 4, 'the blocks already sent written');
    await sleep(300);
    expect(run.sent.receiver.filter((n) => n === SEALED_CREDIT).length).toBe(credits);
    receiver.resume();
    expect((await Promise.all([receiver.done, run.sender.done])).map(said)).toEqual(['completed, saved', 'completed, saved']);
    expect(sameAs(sink.bytes, bytes)).toBe('the same');
  });

  it('no STATUS ask while held, however long: nothing is owed while the transfer is held', async () => {
    const clock = new FakeClock();
    const run = await direct([memoryFile('a.bin', patterned(12 * MiB, 92))], { clock });
    const { receiver } = await run.receive();
    await receiver.accept({ sink: new MemorySink() });
    receiver.pause();
    await until(() => run.sender.pausedBy === 'peer', 'the hold heard');
    const before = run.sent.receiver.length;
    await clock.advance(5 * NO_PROGRESS_MS, 5000);
    // A STATUS ask, sealed, is 10 + 16 bytes: no other record is.
    expect(run.sent.receiver.slice(before).filter((n) => n === 26)).toEqual([]);
  });

  it("a second CLOSE while the files are being finished is ignored: the first is answered, finished, once they're saved", async () => {
    const sink = new MemorySink();
    let release!: () => void;
    sink.holdClose = new Promise<void>((resolve) => { release = resolve; });
    const { engine, script, sender } = await receiverFinishing(sink, 93);
    await until(() => engine.state === 'finalising', 'finalising');
    await script.send({ type: 'close', operationId: new Uint8Array(16).fill(5), reason: 'USER_CANCELLED' });
    await script.send({ type: 'close', operationId: new Uint8Array(16).fill(6), reason: 'USER_CANCELLED' });
    await sleep(50);
    release();
    expect(await recordOf(sender, 'close-ack')).toMatchObject({ operationId: new Uint8Array(16).fill(5), finished: true });
    expect(said(await engine.done)).toBe('completed, saved');
  });

  it("a CLOSE heard while finishing, then the files failing: CLOSE_ACK unfinished, and no CLOSE of the receiver's own", async () => {
    const sink = new MemorySink();
    let fail!: (err: Error) => void;
    sink.holdClose = new Promise<void>((_, reject) => { fail = reject; });
    const { engine, script, sender } = await receiverFinishing(sink, 94);
    await until(() => engine.state === 'finalising', 'finalising');
    await script.send({ type: 'close', operationId: new Uint8Array(16).fill(8), reason: 'USER_CANCELLED' });
    await sleep(50);
    fail(new Error('The disk is full.'));
    expect(said(await engine.done)).toBe('failed OUTPUT_WRITE_FAILED');
    const seen: Message[] = [];
    await expect(recordOf(sender, 'result', seen)).rejects.toBeDefined();
    expect(seen.filter((m) => m.type === 'close-ack')).toEqual([{ type: 'close-ack', operationId: new Uint8Array(16).fill(8), finished: false }]);
    expect(seen.filter((m) => m.type === 'close')).toEqual([]);
  });

  it('a cancel once RESULT has gone completes the receive: the files are saved', async () => {
    const { engine, sender } = await receiverFinishing(new MemorySink(), 95);
    await recordOf(sender, 'result');
    engine.cancel();
    expect(said(await engine.done)).toBe('completed, saved');
  });

  it("the receiver's own 10 minutes: an offer it never answers ends it TIMED_OUT, the sender told", async () => {
    const clock = new FakeClock();
    const pair = channels(await transfer(provider));
    const engine = receiveDirect(provider, pair.receiver, { timers: clock });
    const script = new ScriptedSender(provider, pair.sender, [{ name: 'a.txt', bytes: patterned(10, 96) }]);
    await script.offer();
    await engine.offer();
    // From here the test's sender is only a link on the same clock: it answers PINGs and sends its own, and hears the CLOSE.
    const heard = alive(pair.sender, clock);
    await clock.advance(OFFER_TIMEOUT_MS - 10_000, 5000);
    expect(await soon(engine.done)).toBe('pending');
    await clock.advance(10_000, 5000);
    expect(await engine.done).toMatchObject({ state: 'failed', error: { code: 'TIMED_OUT', origin: 'local' } });
    await until(() => heard.length > 0, 'the CLOSE');
    expect(heard[0]).toMatchObject({ reason: 'FAILED', detail: 'TIMED_OUT' });
  });

  it("the sender's own 10 minutes: an offer no one answers ends the send TIMED_OUT, the receiver told", async () => {
    const clock = new FakeClock();
    const { sender, raw, rendezvous } = await senderAndRaw([memoryFile('a.bin', patterned(10, 97))], clock);
    alive(raw, clock);
    await clock.advance(OFFER_TIMEOUT_MS - 10_000, 5000);
    expect(await soon(sender.done)).toBe('pending');
    await clock.advance(10_000, 5000);
    expect(await sender.done).toMatchObject({ state: 'failed', error: { code: 'TIMED_OUT', origin: 'local', message: "The offer wasn't accepted within 10 minutes." } });
    // The in-band copy went to the test's own reader on this channel; the copy through the rendezvous says the same, and
    // arrives though the sender closes its room as the send ends.
    expect(closesSent(rendezvous)).toEqual({ receiver: 0, sender: 1 });
    expect(decodeMessage(await raw.closeReceived)).toMatchObject({ type: 'close', reason: 'FAILED', detail: 'TIMED_OUT' });
  }, 30_000);

  it("the sender passes over a HOLD once FINISH has gone, and completes on the receiver's RESULT", async () => {
    const { sender, raw, accept } = await senderAndRaw([memoryFile('a.bin', patterned(1000, 98))]);
    await accept();
    const finish = await recordOf(raw, 'finish');
    await raw.send(encodeMessage({ type: 'hold', held: true, reason: 'person' }));
    await sleep(50);
    expect(sender.pausedBy).toBe(null);
    expect(sender.canPause).toBe(false);
    await raw.send(encodeMessage({ type: 'result', ...resultFor(finish) }));
    expect(said(await sender.done)).toBe('completed, saved');
  });

  it("a sender's cancel after FINISH answered by CLOSE_ACK{finished} alone, its RESULT checking out: the send completed, the receiver told RESULT_ACK", async () => {
    const { sender, raw, accept } = await senderAndRaw([memoryFile('a.bin', patterned(1000, 99))]);
    await accept();
    const finish = await recordOf(raw, 'finish');
    sender.cancel();
    const close = await recordOf(raw, 'close');
    expect(close).toMatchObject({ reason: 'USER_CANCELLED' });
    const result = resultFor(finish);
    await raw.send(encodeMessage({ type: 'close-ack', operationId: close.operationId, finished: true, result }));
    expect(said(await sender.done)).toBe('completed, saved');
    expect(await recordOf(raw, 'result-ack')).toEqual({ type: 'result-ack', commitId: result.commitId });
  });

  it("a sender's cancel after FINISH answered by CLOSE_ACK{finished} whose RESULT doesn't check out: cancelled", async () => {
    const { sender, raw, accept } = await senderAndRaw([memoryFile('a.bin', patterned(1000, 100))]);
    await accept();
    const finish = await recordOf(raw, 'finish');
    sender.cancel();
    const close = await recordOf(raw, 'close');
    await raw.send(encodeMessage({ type: 'close-ack', operationId: close.operationId, finished: true, result: { ...resultFor(finish), totalSize: 999 } }));
    expect(said(await sender.done)).toBe('cancelled by self');
  });

  it("the receiver's CLOSE is answered with CLOSE_ACK for its operation, and the send ends as it says", async () => {
    const { sender, raw, accept } = await senderAndRaw([memoryFile('a.bin', patterned(3 * MiB, 101))]);
    await accept();
    await recordOf(raw, 'data');
    await raw.send(encodeMessage({ type: 'close', operationId: new Uint8Array(16).fill(4), reason: 'USER_CANCELLED' }));
    expect(said(await sender.done)).toBe('cancelled by peer');
    expect(await recordOf(raw, 'close-ack')).toEqual({ type: 'close-ack', operationId: new Uint8Array(16).fill(4), finished: false });
  });

  it("the receiver's out-of-band CLOSE arriving once the data channel has gone ends the sender as it says, not CONNECTION_LOST", async () => {
    const clock = new FakeClock();
    const run = await direct([memoryFile('a.bin', patterned(6 * MiB, 102))], { clock });
    const { receiver, pair } = await run.receive();
    await receiver.accept({ sink: new MemorySink() });
    await until(() => run.sender.canPause, 'transferring');
    pair.data?.sender.close();
    await sleep(50);
    // A second of the 2 s it listens for a late CLOSE.
    await clock.advance(1000);
    expect(await soon(run.sender.done)).toBe('pending');
    receiver.appClosed();
    expect(await run.sender.done).toMatchObject({ state: 'failed', error: { code: 'PEER_CLOSED', message: 'The receiver closed Dropgate before the transfer finished.' } });
  });

  it('a send that ends tells each receiver through the rendezvous before it closes its room', async () => {
    const clock = new FakeClock();
    const run = await direct([memoryFile('a.bin', patterned(6 * MiB, 103))], { clock });
    const { receiver, pair } = await run.receive();
    await receiver.accept({ sink: new MemorySink() });
    await until(() => run.sender.canPause, 'transferring');
    // The data channel already gone, so the CLOSE can only go through the rendezvous.
    pair.data?.sender.close();
    await sleep(50);
    run.sender.cancel();
    expect(said(await receiver.done)).toBe('cancelled by peer');
    await until(() => run.rendezvous.senderClosed, 'the room closed');
  });
});
