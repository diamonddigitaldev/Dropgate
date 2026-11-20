import { describe, it, expect } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import { webCryptoProvider } from '../src/crypto/index.js';
import type { SecureChannel } from '../src/dgdtp/channel.js';
import { Link } from '../src/dgdtp/engine.js';
import { encodeMessage, type Message } from '../src/dgdtp/messages.js';
import { channels, transfer } from './helpers/channel-checks.js';
import { FakeClock, tracked, anythingWithin, recordOf } from './helpers/direct.js';

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
