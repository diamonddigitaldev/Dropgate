import { describe, it, expect } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import { webCryptoProvider } from '../src/crypto/index.js';
import type { SecureChannel } from '../src/dgdtp/channel.js';
import { Link } from '../src/dgdtp/engine.js';
import { decodeMessage, encodeMessage, type Message } from '../src/dgdtp/messages.js';
import { channels, transfer } from './helpers/channel-checks.js';
import { FakeClock, tracked, anythingWithin, countingReads, recordOf } from './helpers/direct.js';

// The engine's liveness (src/dgdtp/engine.ts' Link): one Link over the real
// secure channel in memory, the test playing the other device record by
// record, every timer on a clock the test moves. A PING goes only when this
// side has sent nothing for 5 s; the PONGs' round trips make a smoothed RTT
// (each new one an eighth of it); and nothing heard for max(15 s, 6 × that)
// ends the link CONNECTION_LOST.

// Tracked, so the fake clock waits for exactly the crypto each timer starts.
const provider = tracked(webCryptoProvider(globalThis.crypto));
// As the spec gives them, not read from the code under test.
const PING_INTERVAL_MS = 5000;
const MIN_NO_ANSWER_MS = 15_000;

/** A Link on the sender's channel, on `clock`, with the receiver's channel left for the test: how it ended, if it has. */
async function linkAndOther(clock: FakeClock) {
  const pair = channels(await transfer(provider));
  const ended: string[] = [];
  const link = new Link(pair.sender, {
    record: async () => undefined,
    ended: (err) => { ended.push(err.code); },
    close: () => undefined,
    status: () => ({ state: 0, held: false, consumed: 0 }),
    overrun: () => undefined,
  }, clock);
  link.start();
  return { link, other: pair.receiver as SecureChannel, ended };
}

const send = (channel: SecureChannel, message: Message) => channel.send(encodeMessage(message));

describe("the engine's liveness (fake clock)", () => {
  it('the smoothed round trip: each PONG counts for an eighth, and six of them past 15 s widen the no-answer window', async () => {
    const clock = new FakeClock();
    const { link, other, ended } = await linkAndOther(clock);
    await clock.advance(PING_INTERVAL_MS);
    const first = (await recordOf(other, 'ping')) as Extract<Message, { type: 'ping' | 'pong' }>;
    // The first answer takes 4 s: the round trip is 4 s.
    await clock.advance(4000);
    await send(other, { type: 'pong', id: first.id });
    for (let i = 0; i < 200 && link.srtt === undefined; i++) await sleep(2);
    expect(link.srtt).toBe(4000);
    expect(link.noAnswerMs).toBe(24_000);
    // The next PING goes 5 s after the first, and its PONG comes back at once: 7/8 of 4 s.
    await clock.advance(PING_INTERVAL_MS - 4000);
    const second = (await recordOf(other, 'ping')) as Extract<Message, { type: 'ping' | 'pong' }>;
    await send(other, { type: 'pong', id: second.id });
    for (let i = 0; i < 200 && link.srtt === 4000; i++) await sleep(2);
    expect(link.srtt).toBe(3500);
    expect(link.noAnswerMs).toBe(21_000);
    // A PONG for no PING of this side's changes nothing.
    await send(other, { type: 'pong', id: 999n });
    await sleep(20);
    expect(link.srtt).toBe(3500);
    // Then silence: still up at 20 s, lost at 21 s, never at 15 s.
    await clock.advance(20_000, 1000);
    expect(ended).toEqual([]);
    await clock.advance(1000, 500);
    expect(ended).toEqual(['CONNECTION_LOST']);
    expect(link.closed).toBe(true);
  });

  it("with no round trip yet, nothing heard for 15 s ends it; every record heard puts that off", async () => {
    const clock = new FakeClock();
    const { other, ended } = await linkAndOther(clock);
    for (let i = 0; i < 6; i++) {
      await clock.advance(10_000, 1000);
      await send(other, { type: 'hold', held: false, reason: 'person' });
      await sleep(20);
    }
    expect(ended).toEqual([]);
    await clock.advance(MIN_NO_ANSWER_MS - 1000, 1000);
    expect(ended).toEqual([]);
    await clock.advance(1000);
    expect(ended).toEqual(['CONNECTION_LOST']);
  });

  it('no PING while this side is sending anything else; one 5 s after it last sent', async () => {
    const clock = new FakeClock();
    const { link, other } = await linkAndOther(clock);
    const seen: string[] = [];
    for (let i = 0; i < 20; i++) {
      link.send({ type: 'hold', held: false, reason: 'person' });
      // The other side keeps talking too, so the link stays up.
      await send(other, { type: 'hold', held: false, reason: 'person' });
      await clock.advance(1000);
      for (let m = await anythingWithin(other, 10); m !== undefined && m !== 'closed'; m = await anythingWithin(other, 10)) seen.push(m.type);
    }
    expect(seen.filter((type) => type !== 'hold')).toEqual([]);
    // The last record now; then nothing for 5 s, and only then a PING.
    link.send({ type: 'hold', held: false, reason: 'person' });
    expect(await recordOf(other, 'hold')).toMatchObject({ type: 'hold' });
    await clock.advance(PING_INTERVAL_MS - 1);
    expect(await anythingWithin(other, 50)).toBeUndefined();
    await clock.advance(1);
    expect(await recordOf(other, 'ping')).toMatchObject({ type: 'ping' });
  }, 20_000);
});

/**
 * A Link whose data channel's buffer is full: about 1 MiB has gone (the
 * filler records) and the buffer stays over the low-water mark until the test
 * lets it drain, so the pump waits. What the other side sends is counted as
 * it's read.
 */
async function linkWithFullBuffer(status: () => { state: number; held: boolean; consumed: number }) {
  const t = await transfer(provider);
  const pair = channels(t);
  const data = t.peers.data as NonNullable<typeof t.peers.data>;
  const counted = countingReads(pair.sender);
  const link = new Link(counted.channel, {
    record: async () => undefined,
    ended: () => undefined,
    close: () => undefined,
    status,
    overrun: () => undefined,
  }, new FakeClock());
  link.start();
  data.sender.bufferedAmount = 2 * MiB;
  for (let i = 0; i < FILLER_RECORDS; i++) link.sendRecord(new Uint8Array(FILLER_BYTES));
  await link.flush();
  /** Every record the other side gets once the buffer drains, the filler left out. */
  const drained = async () => {
    data.sender.bufferedAmount = 0;
    const out: Message[] = [];
    for (;;) {
      const item = await rawWithin(pair.receiver, 300);
      if (item === undefined) return out;
      if (item.byteLength !== FILLER_BYTES) out.push(decodeMessage(item));
    }
  };
  return { link, other: pair.receiver as SecureChannel, counted, drained };
}

const MiB = 1048576;
// 14 records of 60,000 bytes: past 1 MiB − 256 KiB, so the pump looks at the buffer before its next record.
const FILLER_RECORDS = 14;
const FILLER_BYTES = 60_000;
const ASKS = 5000;

/** The next record's bytes on `channel`, undecoded; undefined if none comes within `ms` or it has ended. */
async function rawWithin(channel: SecureChannel, ms: number): Promise<Uint8Array | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => { timer = setTimeout(resolve, ms); });
  const next = rawReaders.get(channel) ?? channel.receive().catch(() => undefined);
  const record = await Promise.race([next, late]);
  clearTimeout(timer);
  if (record === undefined) rawReaders.set(channel, next);
  else rawReaders.delete(channel);
  return record;
}
const rawReaders = new WeakMap<SecureChannel, Promise<Uint8Array | undefined>>();

describe("the engine's answers while its data channel's buffer is full", () => {
  it('5,000 PINGs leave one PONG waiting, the newest, not one each; it goes once the buffer drains', async () => {
    const { other, counted, drained } = await linkWithFullBuffer(() => ({ state: 0, held: false, consumed: 0 }));
    for (let id = 1; id <= ASKS; id++) await send(other, { type: 'ping', id: BigInt(id) });
    for (let i = 0; i < 2000 && counted.read < ASKS; i++) await sleep(5);
    expect(counted.read).toBe(ASKS);
    const pongs = (await drained()).map((m) => (m.type === 'pong' ? m.id : m.type));
    // The first PONG may already have been taken when the pump stopped; besides it, the one waiting answers the last PING.
    expect(pongs.length).toBeGreaterThan(0);
    expect(pongs.length).toBeLessThanOrEqual(2);
    expect(pongs.at(-1)).toBe(BigInt(ASKS));
  }, 30_000);

  it("5,000 STATUS asks leave one answer waiting: the newest ask's, with where this side stands as it came", async () => {
    let asked = 0;
    const { other, counted, drained } = await linkWithFullBuffer(() => {
      asked += 1;
      return { state: 2, held: false, consumed: asked };
    });
    for (let id = 1; id <= ASKS; id++) await send(other, { type: 'status', kind: 'ask', id: BigInt(id) });
    for (let i = 0; i < 2000 && counted.read < ASKS; i++) await sleep(5);
    expect(counted.read).toBe(ASKS);
    const answers = (await drained()).map((m) => (m.type === 'status' && m.kind === 'answer' ? [m.id, m.consumed] : m.type));
    expect(answers.length).toBeGreaterThan(0);
    expect(answers.length).toBeLessThanOrEqual(2);
    expect(answers.at(-1)).toEqual([BigInt(ASKS), ASKS]);
  }, 30_000);

  it("PINGs and STATUS asks together: one answer of each waits, and this side's own record queued after them goes after them", async () => {
    const { link, other, counted, drained } = await linkWithFullBuffer(() => ({ state: 0, held: false, consumed: 0 }));
    for (let id = 1; id <= 500; id++) {
      await send(other, { type: 'ping', id: BigInt(id) });
      await send(other, { type: 'status', kind: 'ask', id: BigInt(id) });
    }
    for (let i = 0; i < 2000 && counted.read < 1000; i++) await sleep(5);
    // This side's own record, queued after them, still goes after them.
    link.send({ type: 'hold', held: true, reason: 'person' });
    const types = (await drained()).map((m) => m.type);
    expect(types.filter((type) => type === 'pong').length).toBeLessThanOrEqual(2);
    expect(types.filter((type) => type === 'status').length).toBeLessThanOrEqual(2);
    expect(types.at(-1)).toBe('hold');
  }, 30_000);
});
