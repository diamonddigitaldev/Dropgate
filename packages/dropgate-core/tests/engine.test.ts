import { describe, it, expect } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import { webCryptoProvider } from '../src/crypto/index.js';
import { connectByLink, openRoom, reconnect, type SecureChannel } from '../src/dgdtp/channel.js';
import {
  CREDIT_WINDOW_BYTES, GLOBAL_TIMERS, MAX_UNFINISHED_FILE_ENDS, closeFor, outcomeOfClose, type DirectOutcome, type EngineTimers,
} from '../src/dgdtp/engine.js';
import { DropgateError } from '../src/errors.js';
import {
  BLOCK_BYTES, ManifestAssembler, dataBytes, decodeManifest, encodeManifest, encodeMessage, manifestHash, type Message,
} from '../src/dgdtp/messages.js';
import { receiveDirect, type DirectReceiver } from '../src/dgdtp/receive.js';
import { SenderSession, sendDirect, type SessionHost } from '../src/dgdtp/send.js';
import type { FileSource } from '../src/source.js';
import { channels, transfer } from './helpers/channel-checks.js';
import {
  MemorySink, ScriptedSender, anythingWithin, memoryFile, patterned, recordOf, sameAs, sinksByFile,
} from './helpers/direct.js';
import { MockRendezvous, PeerPair, pipePair, type FakePeer } from './helpers/fake-channel.js';
import { readZip } from './helpers/zip-reader.js';

// The direct-transfer engine (src/dgdtp/engine.ts, send.ts, receive.ts) over
// the real secure channel, in memory: the channel's own handshake over a mock
// rendezvous and fake peer connections (tests/helpers/fake-channel.ts). Either
// side runs the engine while the test plays the other record by record, or
// both run it. Over WebRTC through a real server, tests/direct.test.ts.
//
// The first describe holds what Dropgate 3's direct transfer got wrong, each
// reproduced against it once, now each a plain test of the engine.

const provider = webCryptoProvider(globalThis.crypto);
const MiB = 1048576;
const ascii = (text: string) => new TextEncoder().encode(text);

/** `check` true within `ms`, polled. */
async function until(check: () => boolean, what: string, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.`);
    await sleep(5);
  }
}

const said = (o: DirectOutcome) => (o.state === 'failed' ? `failed ${o.error.code}` : o.state === 'cancelled' ? `cancelled by ${o.by}${o.declined ? ', declined' : ''}` : `completed, ${o.assurance}`);

/** The receiver's engine over a channel whose other end the test plays as the sender. */
async function receiverAndScript(files: Array<{ name: string; bytes: Uint8Array }>) {
  const t = await transfer(provider);
  const { receiver, sender } = channels(t);
  const engine = receiveDirect(provider, receiver);
  const script = new ScriptedSender(provider, sender, files);
  return { t, engine, script };
}

/** Everything the receiver sends until it ends or goes quiet for `ms`. */
async function recordsUntilQuiet(channel: SecureChannel, ms = 150): Promise<Array<Message | 'closed'>> {
  const out: Array<Message | 'closed'> = [];
  for (;;) {
    const m = await anythingWithin(channel, ms);
    if (m === undefined) return out;
    out.push(m);
    if (m === 'closed') return out;
  }
}

/** The receiver's CLOSE as the test hears it, then the channel ending. */
async function closeHeard(channel: SecureChannel): Promise<string> {
  const records = await recordsUntilQuiet(channel, 500);
  const close = records.find((m): m is Extract<Message, { type: 'close' }> => m !== 'closed' && m.type === 'close');
  return close ? `${close.reason}${close.detail ? ` ${close.detail}` : ''}` : `no CLOSE: ${records.map((m) => (m === 'closed' ? m : m.type)).join(', ')}`;
}

/** A timer source whose timers never fire: what's checked must happen without them. */
const NEVER: EngineTimers = { setTimeout: () => 0, clearTimeout: () => undefined };

/** A whole send, and receivers by its link, all over the in-memory channel. */
async function directInMemory(
  files: FileSource[],
  options: { code?: boolean; senderHello?: { major?: number }; maxMessageBytes?: { receiver?: number; sender?: number }; receiverTimers?: EngineTimers } = {},
) {
  const rendezvous = new MockRendezvous();
  const waiting: FakePeer[] = [];
  const pairs: PeerPair[] = [];
  const sender = await sendDirect(provider, {
    files, rendezvous: rendezvous.sender, peer: () => waiting.shift() as FakePeer, code: options.code, hello: options.senderHello,
  });
  const receive = async (hello?: { major?: number }): Promise<{ pair: PeerPair; receiver: DirectReceiver }> => {
    const pair = new PeerPair({ maxMessageBytes: options.maxMessageBytes });
    pairs.push(pair);
    waiting.push(pair.sender);
    const channel = await connectByLink(provider, { rendezvous: rendezvous.receiver, secret: sender.room.linkSecret() as Uint8Array, peer: pair.receiver, hello });
    return { pair, receiver: receiveDirect(provider, channel, { timers: options.receiverTimers }) };
  };
  return { sender, receive, pairs, rendezvous };
}

/** A sender's session over a channel whose other end the test plays as the receiver. */
async function sessionAndReceiver(files: FileSource[], options: { channels?: { sender: SecureChannel; receiver: SecureChannel }; accepted?: () => boolean } = {}) {
  const pair = options.channels ?? channels(await transfer(provider));
  const manifest = encodeManifest(files.map((f) => ({ name: f.name, size: f.size, type: f.type ?? '' })));
  const hash = await manifestHash(provider, manifest);
  const outcomes: DirectOutcome[] = [];
  const sizes = files.map((f) => f.size);
  const host: SessionHost = {
    provider, files, sizes, totalSize: sizes.reduce((a, b) => a + b, 0), manifest, manifestHash: hash, timers: GLOBAL_TIMERS,
    accepted: options.accepted ?? (() => true), moved: () => undefined, ended: (_s, o) => { outcomes.push(o); },
  };
  const session = new SenderSession(host, pair.sender);
  session.start();
  const raw = pair.receiver;
  /** Reads the offer, then accepts it with `creditLimit`. */
  const accept = async (creditLimit = CREDIT_WINDOW_BYTES) => {
    const assembler = new ManifestAssembler(Math.min(raw.maxRecordBytes, raw.peerHello.maxRecord));
    let bytes: Uint8Array | undefined;
    while (!bytes) bytes = assembler.take(await recordOf(raw, 'manifest'));
    decodeManifest(bytes);
    await raw.send(encodeMessage({ type: 'accept', manifestHash: hash, resumeSecret: new Uint8Array(32).fill(9), creditLimit, sink: 'saved' }));
  };
  return { session, raw, outcomes, hash, accept };
}

/** Both sides' channels at generation 1, as a resume makes them. */
async function resumedChannels(): Promise<{ sender: SecureChannel; receiver: SecureChannel }> {
  const rendezvous = new MockRendezvous();
  const room = await openRoom(provider, { rendezvous: rendezvous.sender });
  const pipe = pipePair();
  const peers = new PeerPair();
  const resumeSecret = new Uint8Array(32).fill(5);
  const [sender, receiver] = await Promise.all([
    room.accept({ by: 'resume', pipe: pipe.sender, resumeSecret, previousGeneration: 0n }, { peer: peers.sender }),
    reconnect(provider, { pipe: pipe.receiver, roomNonce: room.roomNonce, resumeSecret, previousGeneration: 0n, peer: peers.receiver }),
  ]);
  expect(sender.generation).toBe(1n);
  return { sender, receiver };
}

describe("what Dropgate 3's direct transfer got wrong, each now a plain test of the engine", () => {
  it('a sender whose hello says another major is VERSION_UNSUPPORTED on both sides, and nothing is offered or transferred', async () => {
    const run = await directInMemory([memoryFile('notes.txt', ascii('four'))], { senderHello: { major: 5 } });
    const attempts: string[] = [];
    run.sender.onAttemptEnded((err) => attempts.push(`${err.code}: ${err.message}`));
    await expect(run.receive()).rejects.toMatchObject({
      code: 'VERSION_UNSUPPORTED', message: 'Update required: the sender is using a newer version of Dropgate. Update this app to receive from them.',
    });
    await until(() => attempts.length === 1, "the sender's attempt ending");
    expect(attempts).toEqual(['VERSION_UNSUPPORTED: Update required: the receiver is using an older version of Dropgate. They need to update.']);
    // Noise's two messages and BIND, nothing more: no list of files, no data.
    const data = run.pairs[0].data as NonNullable<PeerPair['data']>;
    expect(data.sent.receiver.map((m) => m.byteLength)).toEqual([48, 67]);
    expect(data.sent.sender).toHaveLength(1);
    expect(run.sender.state).toBe('waiting');
    run.sender.cancel();
  });

  it('the data channel closing mid-transfer is CONNECTION_LOST on both sides, never a cancel', async () => {
    // More than the credit, so the sender is still sending when it closes.
    const bytes = patterned(8 * MiB, 2);
    const run = await directInMemory([memoryFile('big.bin', bytes)]);
    const { pair, receiver } = await run.receive();
    const sink = new MemorySink();
    let release!: () => void;
    sink.holdWrite = (n) => (n === 2 ? new Promise<void>((resolve) => { release = resolve; }) : undefined);
    await receiver.accept({ sink });
    await until(() => sink.writes === 2, 'the second block being written');
    (pair.data as NonNullable<PeerPair['data']>).sender.close();
    release();
    const [r, s] = await Promise.all([receiver.done, run.sender.done]);
    expect(`${said(r)} / ${said(s)}`).toBe('failed CONNECTION_LOST / failed CONNECTION_LOST');
    expect(sink.closed).toBe(false);
    expect(sink.aborted).toBeTruthy();
  });

  it('DATA before ACCEPT is INVALID_MESSAGE: nothing is written, and the sender is told', async () => {
    const { engine, script } = await receiverAndScript([{ name: 'notes.txt', bytes: ascii('four') }]);
    await script.offer();
    await engine.offer();
    await script.send({ type: 'data', fileIndex: 0, offset: 0, bytes: ascii('four') });
    const outcome = await engine.done;
    expect(said(outcome)).toBe('failed INVALID_MESSAGE');
    expect(await closeHeard(script.channel)).toBe('FAILED INVALID_MESSAGE');
  });

  it("file bytes sent with no record around them are INVALID_MESSAGE, and none of them is written", async () => {
    const { engine, script } = await receiverAndScript([{ name: 'notes.txt', bytes: ascii('four') }]);
    await script.offer();
    const sink = new MemorySink();
    await engine.accept({ sink });
    await recordOf(script.channel, 'accept');
    await script.channel.send(Uint8Array.of(1, 2, 3, 4));
    expect(said(await engine.done)).toBe('failed INVALID_MESSAGE');
    expect(await closeHeard(script.channel)).toBe('FAILED INVALID_MESSAGE');
    expect(sink.writes).toBe(0);
    expect(sink.closed).toBe(false);
    expect(sink.aborted).toBeTruthy();
  });

  it('with nowhere to write the files there is no ACCEPT and no completion', async () => {
    const { engine, script } = await receiverAndScript([{ name: 'notes.txt', bytes: ascii('four') }]);
    await script.offer();
    for (const options of [undefined, {}, { sink: undefined }, { sink: {} }, { sink: { write() {} } }]) {
      await expect(engine.accept(options as never)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    // Nothing went to the sender, and the offer still waits.
    expect(await anythingWithin(script.channel, 100)).toBeUndefined();
    expect(engine.state).toBe('offered');
    // The sender carries on as if accepted: refused, never completed.
    await script.sendFile(0).catch(() => undefined);
    expect(said(await engine.done)).toBe('failed INVALID_MESSAGE');
    expect(await closeHeard(script.channel)).toBe('FAILED INVALID_MESSAGE');
  });

  it('RESULT only once the sink has closed: the files are finished before the sender is told', async () => {
    const bytes = patterned(MiB + 1, 3);
    const { engine, script } = await receiverAndScript([{ name: 'notes.bin', bytes }]);
    await script.offer();
    const sink = new MemorySink();
    let close!: () => void;
    sink.holdClose = new Promise<void>((resolve) => { close = resolve; });
    await engine.accept({ sink });
    await recordOf(script.channel, 'accept');
    await script.sendFile(0);
    await script.finish();
    const seen = await recordsUntilQuiet(script.channel, 200);
    expect(seen.map((m) => (m === 'closed' ? m : m.type)).filter((t) => t !== 'credit')).toEqual([]);
    expect(engine.state).toBe('finalising');
    close();
    const result = await recordOf(script.channel, 'result');
    expect(sink.closed).toBe(true);
    expect(result).toMatchObject({ assurance: 'saved', fileCount: 1, totalSize: MiB + 1 });
    await script.send({ type: 'result-ack', commitId: result.commitId });
    expect(said(await engine.done)).toBe('completed, saved');
    expect(sameAs(sink.bytes, bytes)).toBe('the same');
  });

  it('nothing is written after a cancel, even a write that was already waiting its turn', async () => {
    const bytes = patterned(2 * MiB + 5, 4);
    const { engine, script } = await receiverAndScript([{ name: 'notes.bin', bytes }]);
    await script.offer();
    const sink = new MemorySink();
    let release!: () => void;
    sink.holdWrite = (n) => (n === 1 ? new Promise<void>((resolve) => { release = resolve; }) : undefined);
    await engine.accept({ sink });
    await recordOf(script.channel, 'accept');
    void script.sendFile(0).catch(() => undefined);
    await until(() => sink.writes === 1, 'the first write');
    engine.cancel();
    release();
    await sleep(100);
    expect(said(await engine.done)).toBe('cancelled by self');
    expect(sink.writes).toBe(1);
    expect(sink.closed).toBe(false);
    expect(sink.aborted).toBeTruthy();
  });

  it("a FILE_END whose size isn't the list of files' is INTEGRITY_FAILED, and the file is never acknowledged", async () => {
    const { engine, script } = await receiverAndScript([{ name: 'first.txt', bytes: ascii('four') }, { name: 'second.txt', bytes: ascii('1') }]);
    await script.offer();
    const { sink, files } = sinksByFile();
    await engine.accept({ sink });
    await recordOf(script.channel, 'accept');
    await script.sendFile(0, (end) => ({ ...end, size: 2 }));
    expect(said(await engine.done)).toBe('failed INTEGRITY_FAILED');
    const seen = await recordsUntilQuiet(script.channel, 300);
    expect(seen.some((m) => m !== 'closed' && m.type === 'credit' && m.filesDone > 0)).toBe(false);
    expect(seen.find((m) => m !== 'closed' && m.type === 'close')).toMatchObject({ reason: 'FAILED', detail: 'INTEGRITY_FAILED' });
    expect(files.get(0)?.sink.closed).toBe(false);
    expect(files.get(0)?.sink.aborted).toBeTruthy();
  });

  it('a file sent shorter than declared is refused at its first short record, INVALID_MESSAGE, never acknowledged', async () => {
    const { engine, script } = await receiverAndScript([{ name: 'first.txt', bytes: ascii('four') }]);
    await script.offer();
    const sink = new MemorySink();
    await engine.accept({ sink });
    await recordOf(script.channel, 'accept');
    await script.send({ type: 'data', fileIndex: 0, offset: 0, bytes: ascii('fo') });
    expect(said(await engine.done)).toBe('failed INVALID_MESSAGE');
    expect(sink.writes).toBe(0);
  });

  it('a malformed record is INVALID_MESSAGE: one a byte short or long, a flag no version sets, a field out of range, or one only the receiver sends', async () => {
    const fileEnd = encodeMessage({ type: 'file-end', fileIndex: 0, size: 4, blockCount: 1, chain: new Uint8Array(32) });
    const data = encodeMessage({ type: 'data', fileIndex: 0, offset: 0, bytes: ascii('four') });
    const flagged = data.slice();
    flagged[1] = 1;
    const blockEnd = encodeMessage({ type: 'block-end', fileIndex: 0, blockIndex: 0, length: 4, hash: new Uint8Array(32) });
    const tooLong = blockEnd.slice();
    tooLong.set([0, 0x10, 0, 1], 13);
    for (const [what, record] of [
      ['FILE_END a byte short', fileEnd.slice(0, -1)],
      ['FILE_END a byte long', Uint8Array.of(...fileEnd, 0)],
      ['DATA with a flag set', flagged],
      ['BLOCK_END over 1 MiB', tooLong],
      ['a CREDIT, the receiver\'s to send', encodeMessage({ type: 'credit', revision: 1, limit: 1, consumed: 0, filesDone: 0, verifiedFileIndex: 0, verifiedOffset: 0 })],
      ['a reserved type, RESUME', Uint8Array.of(16)],
      ['an empty record', new Uint8Array(0)],
    ] as Array<[string, Uint8Array]>) {
      const { engine, script } = await receiverAndScript([{ name: 'notes.txt', bytes: ascii('four') }]);
      await script.offer();
      const sink = new MemorySink();
      await engine.accept({ sink });
      await recordOf(script.channel, 'accept');
      await script.channel.send(record);
      expect(said(await engine.done), what).toBe('failed INVALID_MESSAGE');
      expect(await closeHeard(script.channel), what).toBe('FAILED INVALID_MESSAGE');
      expect(sink.writes, what).toBe(0);
    }
  });
});

describe('generation fencing: an effect from another generation touches nothing', () => {
  it("the receiver, at generation 1: generation 0's DATA is never written and its CLOSE ends nothing; then generation 1's transfer completes", async () => {
    const { sender, receiver } = await resumedChannels();
    const engine = receiveDirect(provider, receiver);
    const bytes = patterned(MiB + 3, 6);
    const script = new ScriptedSender(provider, sender, [{ name: 'a.bin', bytes }]);
    await script.offer();
    const sink = new MemorySink();
    await engine.accept({ sink });
    await recordOf(sender, 'accept');
    const most = dataBytes(script.recordBytes);
    await engine.deliver({ generation: 0n, record: encodeMessage({ type: 'data', fileIndex: 0, offset: 0, bytes: bytes.subarray(0, most) }) });
    await engine.deliver({ generation: 0n, record: encodeMessage({ type: 'close', operationId: new Uint8Array(16), reason: 'USER_CANCELLED' }) });
    await engine.deliver({ generation: 2n, record: encodeMessage({ type: 'close', operationId: new Uint8Array(16), reason: 'USER_CANCELLED' }) });
    expect(engine.state).toBe('transferring');
    expect(sink.writes).toBe(0);
    await script.sendFile(0);
    await script.finish();
    const result = await recordOf(sender, 'result');
    await script.send({ type: 'result-ack', commitId: result.commitId });
    expect(said(await engine.done)).toBe('completed, saved');
    expect(sameAs(sink.bytes, bytes)).toBe('the same');
    // And after the end, the current generation's own records touch nothing either.
    await engine.deliver({ generation: 1n, record: encodeMessage({ type: 'data', fileIndex: 0, offset: 0, bytes: bytes.subarray(0, most) }) });
    expect(sink.writes).toBe(2);
  });

  it("the sender, at generation 1: generation 0's CREDIT moves nothing, its CLOSE ends nothing and its RESULT completes nothing", async () => {
    const pair = await resumedChannels();
    const bytes = patterned(2 * MiB, 7);
    const { session, raw, outcomes, accept } = await sessionAndReceiver([memoryFile('a.bin', bytes)], { channels: pair });
    const most = dataBytes(Math.min(raw.maxRecordBytes, raw.peerHello.maxRecord));
    await accept(most);
    const first = await recordOf(raw, 'data');
    expect(first.bytes.byteLength).toBe(most);
    await session.deliver({ generation: 0n, record: encodeMessage({ type: 'credit', revision: 1, limit: 4 * MiB, consumed: 0, filesDone: 0, verifiedFileIndex: 0, verifiedOffset: 0 }) });
    await session.deliver({ generation: 0n, record: encodeMessage({ type: 'close', operationId: new Uint8Array(16), reason: 'USER_CANCELLED' }) });
    expect(await anythingWithin(raw, 150)).toBeUndefined();
    expect(outcomes).toEqual([]);
    // Generation 1's credit lets the rest go.
    await raw.send(encodeMessage({ type: 'credit', revision: 1, limit: 2 * MiB, consumed: 0, filesDone: 0, verifiedFileIndex: 0, verifiedOffset: 0 }));
    const finish = await recordOf(raw, 'finish');
    const result = { commitId: new Uint8Array(16).fill(1), assurance: 'saved' as const, fileCount: 1, totalSize: 2 * MiB, chain: finish.chain };
    await session.deliver({ generation: 0n, record: encodeMessage({ type: 'result', ...result }) });
    await sleep(50);
    expect(outcomes).toEqual([]);
    await raw.send(encodeMessage({ type: 'result', ...result }));
    expect(await recordOf(raw, 'result-ack')).toMatchObject({ commitId: result.commitId });
    await until(() => outcomes.length === 1, 'the session ending');
    expect(said(outcomes[0])).toBe('completed, saved');
    expect(session.phase).toBe('ended');
  });
});

describe('one transfer end to end, in memory', () => {
  it('sends one file of 0, 1 and 1 MiB + 1 bytes byte for byte, each side completing with the receiver\'s assurance', async () => {
    for (const size of [0, 1, MiB + 1]) {
      const bytes = patterned(size, size + 11);
      const run = await directInMemory([memoryFile('one.bin', bytes)]);
      const { receiver } = await run.receive();
      const offer = await receiver.offer();
      expect(offer).toEqual({ files: [{ name: 'one.bin', size, type: 'application/octet-stream' }], totalSize: size });
      const sink = new MemorySink();
      await receiver.accept({ sink, handOff: size === 1 });
      const [r, s] = await Promise.all([receiver.done, run.sender.done]);
      const assurance = size === 1 ? 'handed-off' : 'saved';
      expect(`${said(r)} / ${said(s)}`, `${size} bytes`).toBe(`completed, ${assurance} / completed, ${assurance}`);
      expect(sameAs(sink.bytes, bytes), `${size} bytes`).toBe('the same');
      expect(sink.closed).toBe(true);
    }
  });

  it('many files, empty ones among them, each to its own sink and all into one ZIP', async () => {
    const sizes = [0, 5, 0, MiB, 0, 3 * MiB + 7, 0, 0, 1, 0, 0, 2];
    const contents = sizes.map((size, i) => patterned(size, 100 + i));
    const files = () => contents.map((bytes, i) => memoryFile(`file ${i}.bin`, bytes));
    {
      const run = await directInMemory(files());
      const { receiver } = await run.receive();
      const { sink, files: got } = sinksByFile();
      await receiver.accept({ sink });
      expect(said(await receiver.done)).toBe('completed, saved');
      expect(said(await run.sender.done)).toBe('completed, saved');
      contents.forEach((bytes, i) => {
        expect(got.get(i)?.info).toEqual({ name: `file ${i}.bin`, size: bytes.byteLength, index: i });
        expect(sameAs((got.get(i)?.sink as MemorySink).bytes, bytes), `file ${i}`).toBe('the same');
        expect(got.get(i)?.sink.closed, `file ${i}`).toBe(true);
      });
    }
    {
      const run = await directInMemory(files());
      const { receiver } = await run.receive();
      const sink = new MemorySink();
      await receiver.accept({ sink, asZip: true });
      expect(said(await receiver.done)).toBe('completed, saved');
      const zip = readZip([{ bytes: sink.bytes }]);
      expect(zip.entries.map((e) => e.name)).toEqual(contents.map((_, i) => `file ${i}.bin`));
      zip.entries.forEach((entry, i) => expect(sameAs(zip.bytesOf(entry), contents[i]), entry.name).toBe('the same'));
      expect(sink.closed).toBe(true);
    }
  });

  it('the first ACCEPT wins: the room is locked, the other receiver offered too is told TAKEN and ends REQUEST_REJECTED', async () => {
    const bytes = patterned(1000, 8);
    const run = await directInMemory([memoryFile('a.bin', bytes)]);
    const a = await run.receive();
    const b = await run.receive();
    await Promise.all([a.receiver.offer(), b.receiver.offer()]);
    expect(run.sender.state).toBe('offered');
    const sink = new MemorySink();
    await a.receiver.accept({ sink });
    const lost = await b.receiver.done;
    expect(lost).toMatchObject({ state: 'failed', error: { code: 'REQUEST_REJECTED', message: 'This transfer is already going to someone else.' } });
    await expect(b.receiver.accept({ sink: new MemorySink() })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(said(await a.receiver.done)).toBe('completed, saved');
    expect(said(await run.sender.done)).toBe('completed, saved');
    expect(sameAs(sink.bytes, bytes)).toBe('the same');
    // Nobody else gets in once it's locked.
    await expect(run.receive()).rejects.toThrow();
  });

  it("an ACCEPT that comes once another receiver has it is answered TAKEN, and that receiver's session ends", async () => {
    const { session, raw, outcomes, accept } = await sessionAndReceiver([memoryFile('a.bin', ascii('four'))], { accepted: () => false });
    await accept();
    expect(await closeHeard(raw)).toBe('TAKEN');
    await until(() => outcomes.length === 1, 'the session ending');
    expect(said(outcomes[0])).toBe('failed REQUEST_REJECTED');
    expect(session.phase).toBe('ended');
  });

  it('a receiver that declines ends the send: cancelled by the peer, declined; the receiver cancelled by itself', async () => {
    const run = await directInMemory([memoryFile('a.bin', ascii('four'))]);
    const { receiver } = await run.receive();
    await receiver.offer();
    receiver.decline();
    expect(said(await receiver.done)).toBe('cancelled by self');
    expect(said(await run.sender.done)).toBe('cancelled by peer, declined');
    expect(run.sender.state).toBe('cancelled');
  });

  it("a sink that can't be written fails the receive OUTPUT_WRITE_FAILED, and the sender hears the receiver couldn't save it", async () => {
    const run = await directInMemory([memoryFile('a.bin', patterned(2 * MiB, 9))]);
    const { receiver } = await run.receive();
    const sink = new MemorySink();
    sink.failWrite = 2;
    await receiver.accept({ sink });
    expect(said(await receiver.done)).toBe('failed OUTPUT_WRITE_FAILED');
    const s = await run.sender.done;
    expect(s).toMatchObject({ state: 'failed', error: { code: 'PEER_FAILED', message: "The receiver couldn't save the file.", details: { reason: 'OUTPUT_WRITE_FAILED' } } });
    expect(sink.aborted).toBeTruthy();
  });

  it("a sink that can't be had fails the receive before anything is accepted", async () => {
    const { engine, script } = await receiverAndScript([{ name: 'a.txt', bytes: ascii('four') }]);
    await script.offer();
    await expect(engine.accept({ sink: () => { throw new Error('No folder.'); } })).rejects.toMatchObject({ code: 'OUTPUT_WRITE_FAILED' });
    expect(said(await engine.done)).toBe('failed OUTPUT_WRITE_FAILED');
    const seen = await recordsUntilQuiet(script.channel, 300);
    expect(seen.map((m) => (m === 'closed' ? m : m.type))).toEqual(['close', 'closed']);
  });

  it("a file that can't be read fails the send SOURCE_UNAVAILABLE, and the receiver hears the sender's file couldn't be read", async () => {
    const run = await directInMemory([memoryFile('a.bin', patterned(3 * MiB, 10), { fail: (start) => start >= MiB })]);
    const { receiver } = await run.receive();
    const sink = new MemorySink();
    await receiver.accept({ sink });
    expect(said(await run.sender.done)).toBe('failed SOURCE_UNAVAILABLE');
    expect(await receiver.done).toMatchObject({
      state: 'failed', error: { code: 'PEER_FAILED', message: "The sender's file couldn't be read.", details: { reason: 'SOURCE_UNAVAILABLE' } },
    });
    expect(sink.closed).toBe(false);
  });

  it("a block that doesn't match its hash is INTEGRITY_FAILED, never written, and the sender is told", async () => {
    const bytes = patterned(MiB + 10, 12);
    const { engine, script } = await receiverAndScript([{ name: 'a.bin', bytes }]);
    await script.offer();
    const sink = new MemorySink();
    await engine.accept({ sink });
    await recordOf(script.channel, 'accept');
    script.files[0].bytes = bytes.slice();
    const send = script.send.bind(script);
    script.send = (m) => (m.type === 'block-end' ? send({ ...m, hash: new Uint8Array(32) }) : send(m));
    await script.sendFile(0).catch(() => undefined);
    expect(said(await engine.done)).toBe('failed INTEGRITY_FAILED');
    expect(sink.writes).toBe(0);
    expect(await closeHeard(script.channel)).toBe('FAILED INTEGRITY_FAILED');
  });
});

describe("the sender's stream: credit, records and the pump", () => {
  it('sends no more than the credit given, every DATA record exactly the most a record holds or the rest of its block, then the rest on more credit', async () => {
    const bytes = patterned(6 * MiB + 100, 13);
    const { raw, outcomes, accept } = await sessionAndReceiver([memoryFile('a.bin', bytes)]);
    const most = dataBytes(Math.min(raw.maxRecordBytes, raw.peerHello.maxRecord));
    expect(most).toBe(65505);
    await accept();
    const sizes: number[] = [];
    for (;;) {
      const m = await anythingWithin(raw, 200);
      if (m === undefined || m === 'closed') break;
      if (m.type === 'data') sizes.push(m.bytes.byteLength);
    }
    // Four whole blocks, each 16 records of 65,505 and one of 496: exactly the 4 MiB given.
    const block = [...Array(16).fill(most), BLOCK_BYTES - 16 * most];
    expect(sizes).toEqual([...block, ...block, ...block, ...block]);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(CREDIT_WINDOW_BYTES);
    await raw.send(encodeMessage({ type: 'credit', revision: 1, limit: 8 * MiB, consumed: 4 * MiB, filesDone: 0, verifiedFileIndex: 0, verifiedOffset: 4 * MiB }));
    const finish = await recordOf(raw, 'finish');
    await raw.send(encodeMessage({ type: 'result', commitId: new Uint8Array(16), assurance: 'saved', fileCount: 1, totalSize: bytes.byteLength, chain: finish.chain }));
    await until(() => outcomes.length === 1, 'the send completing');
    expect(said(outcomes[0])).toBe('completed, saved');
  });

  it('a CREDIT that lowers anything, or gives more than 4 MiB ahead, is INVALID_MESSAGE, and the receiver is told', async () => {
    for (const [what, credit] of [
      ['a revision that doesn\'t rise', { revision: 0, limit: 4 * MiB, consumed: 0 }],
      ['more than 4 MiB ahead', { revision: 1, limit: 4 * MiB + 1, consumed: 0 }],
      ['a limit lower than before', { revision: 1, limit: MiB, consumed: 0 }],
      ['more written than was sent', { revision: 1, limit: 8 * MiB, consumed: 5 * MiB }],
    ] as const) {
      const { raw, outcomes, accept } = await sessionAndReceiver([memoryFile('a.bin', patterned(6 * MiB, 14))]);
      await accept();
      await recordOf(raw, 'data');
      await raw.send(encodeMessage({ type: 'credit', filesDone: 0, verifiedFileIndex: 0, verifiedOffset: 0, ...credit }));
      expect(await closeHeard(raw), what).toBe('FAILED INVALID_MESSAGE');
      expect(outcomes.map(said), what).toEqual(['failed INVALID_MESSAGE']);
    }
  });

  it('sends at most 8 file ends ahead of the files the receiver has finished', async () => {
    const files = Array.from({ length: 12 }, (_, i) => memoryFile(`e${i}`, new Uint8Array(0)));
    const { raw, accept } = await sessionAndReceiver(files);
    await accept();
    const ends = async () => {
      let n = 0;
      for (;;) {
        const m = await anythingWithin(raw, 150);
        if (m === undefined || m === 'closed') return n;
        if (m.type === 'file-end') n += 1;
      }
    };
    expect(await ends()).toBe(MAX_UNFINISHED_FILE_ENDS);
    await raw.send(encodeMessage({ type: 'credit', revision: 1, limit: 4 * MiB, consumed: 0, filesDone: 4, verifiedFileIndex: 4, verifiedOffset: 0 }));
    expect(await ends()).toBe(4);
  });

  it("stops while about 1 MiB waits in the data channel's buffer, and goes on once it drains", async () => {
    const bytes = patterned(4 * MiB, 15);
    const run = await directInMemory([memoryFile('a.bin', bytes)]);
    const { pair, receiver } = await run.receive();
    await receiver.offer();
    const data = pair.data as NonNullable<PeerPair['data']>;
    data.sender.bufferedAmount = 2 * MiB;
    const before = data.sent.sender.length;
    const sink = new MemorySink();
    await receiver.accept({ sink });
    await sleep(200);
    const sent = data.sent.sender.slice(before).reduce((n, m) => n + m.byteLength, 0);
    // What went before the buffer was looked at: at most the high-water mark's worth.
    expect(sent).toBeLessThanOrEqual(MiB);
    expect(sent).toBeGreaterThan(0);
    expect(receiver.state).toBe('transferring');
    data.sender.bufferedAmount = 0;
    expect(said(await receiver.done)).toBe('completed, saved');
    expect(sameAs(sink.bytes, bytes)).toBe('the same');
  });
});

describe("the receiver's checks", () => {
  it('DATA past the credit given is refused as it arrives, INVALID_MESSAGE, even while the sink is still writing', async () => {
    const bytes = patterned(5 * MiB + 1, 20);
    const { engine, script } = await receiverAndScript([{ name: 'a.bin', bytes }]);
    await script.offer();
    const sink = new MemorySink();
    // The first block's write never finishes: nothing is written, so no more credit is given.
    sink.holdWrite = (n) => (n === 1 ? new Promise<void>(() => undefined) : undefined);
    await engine.accept({ sink });
    await recordOf(script.channel, 'accept');
    void script.sendFile(0).catch(() => undefined);
    expect(said(await engine.done)).toBe('failed INVALID_MESSAGE');
    expect(await closeHeard(script.channel)).toBe('FAILED INVALID_MESSAGE');
    expect(sink.aborted).toBeTruthy();
  });

  for (const [what, run, ending] of [
    ["a FILE_END before its file's bytes", async (s: ScriptedSender) => {
      await s.send({ type: 'file-end', fileIndex: 0, size: 4, blockCount: 1, chain: new Uint8Array(32) });
    }, 'failed INVALID_MESSAGE'],
    ["a FILE_END whose checkpoint doesn't match", async (s: ScriptedSender) => {
      await s.sendFile(0, (end) => ({ ...end, chain: new Uint8Array(32) }));
    }, 'failed INTEGRITY_FAILED'],
    ['a FINISH before every file has ended', async (s: ScriptedSender) => { await s.finish(); }, 'failed INVALID_MESSAGE'],
    ["a FINISH whose total doesn't match", async (s: ScriptedSender) => {
      await s.sendFile(0);
      await s.send({ type: 'finish', fileCount: 1, totalSize: 5, manifestHash: s.hash, chain: s.chain });
    }, 'failed INTEGRITY_FAILED'],
    ["a FINISH whose chain doesn't match", async (s: ScriptedSender) => {
      await s.sendFile(0);
      await s.send({ type: 'finish', fileCount: 1, totalSize: 4, manifestHash: s.hash, chain: new Uint8Array(32) });
    }, 'failed INTEGRITY_FAILED'],
    ["a FINISH whose manifest hash doesn't match", async (s: ScriptedSender) => {
      await s.sendFile(0);
      await s.send({ type: 'finish', fileCount: 1, totalSize: 4, manifestHash: new Uint8Array(32), chain: s.chain });
    }, 'failed INTEGRITY_FAILED'],
    ['a RESULT_ACK before any RESULT', async (s: ScriptedSender) => {
      await s.send({ type: 'result-ack', commitId: new Uint8Array(16) });
    }, 'failed INVALID_MESSAGE'],
    ['a DATA record at an offset other than the next', async (s: ScriptedSender) => {
      await s.send({ type: 'data', fileIndex: 0, offset: 1, bytes: ascii('four') });
    }, 'failed INVALID_MESSAGE'],
    ["a BLOCK_END before its block's bytes", async (s: ScriptedSender) => {
      await s.send({ type: 'block-end', fileIndex: 0, blockIndex: 0, length: 4, hash: await s.provider.sha256(ascii('four')) });
    }, 'failed INVALID_MESSAGE'],
    ["a BLOCK_END whose length isn't its block's", async (s: ScriptedSender) => {
      await s.send({ type: 'data', fileIndex: 0, offset: 0, bytes: ascii('four') });
      await s.send({ type: 'block-end', fileIndex: 0, blockIndex: 0, length: 3, hash: await s.provider.sha256(ascii('four')) });
    }, 'failed INVALID_MESSAGE'],
    ['a MANIFEST once the offer is whole', async (s: ScriptedSender) => {
      await s.send({ type: 'manifest', total: 1, offset: 0, fragment: Uint8Array.of(1) });
    }, 'failed INVALID_MANIFEST'],
  ] as Array<[string, (s: ScriptedSender) => Promise<void>, string]>) {
    it(`${what} ends the receive, ${ending.slice(7)}, and the sender is told`, async () => {
      const { engine, script } = await receiverAndScript([{ name: 'a.txt', bytes: ascii('four') }]);
      await script.offer();
      const sink = new MemorySink();
      await engine.accept({ sink });
      await recordOf(script.channel, 'accept');
      await run(script).catch(() => undefined);
      expect(said(await engine.done)).toBe(ending);
      expect(await closeHeard(script.channel)).toBe(`FAILED ${ending.slice(7)}`);
      expect(sink.closed).toBe(false);
    });
  }

  it('several files into one sink without a ZIP are refused before anything is sent, INVALID_ARGUMENT', async () => {
    const { engine, script } = await receiverAndScript([{ name: 'a.txt', bytes: ascii('a') }, { name: 'b.txt', bytes: ascii('b') }]);
    await script.offer();
    await expect(engine.accept({ sink: new MemorySink() })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(await anythingWithin(script.channel, 100)).toBeUndefined();
    expect(engine.state).toBe('offered');
  });

  it('a PING, PONG, HOLD or STATUS mid-transfer is passed over for now, and the transfer completes', async () => {
    const bytes = patterned(MiB + 9, 21);
    const { engine, script } = await receiverAndScript([{ name: 'a.bin', bytes }]);
    await script.offer();
    const sink = new MemorySink();
    await engine.accept({ sink });
    await recordOf(script.channel, 'accept');
    await script.send({ type: 'ping', id: 1n });
    await script.send({ type: 'pong', id: 2n });
    await script.send({ type: 'hold', held: true, reason: 'person' });
    await script.send({ type: 'status', kind: 'ask', id: 3n });
    await script.sendFile(0);
    await script.finish();
    const result = await recordOf(script.channel, 'result');
    await script.send({ type: 'result-ack', commitId: result.commitId });
    expect(said(await engine.done)).toBe('completed, saved');
    expect(sameAs(sink.bytes, bytes)).toBe('the same');
  });

  it('once RESULT has gone: a RESULT_ACK for another commit is passed over, the right one completes it, with no timer needed', async () => {
    const t = await transfer(provider);
    const { receiver, sender } = channels(t);
    const engine = receiveDirect(provider, receiver, { timers: NEVER });
    const script = new ScriptedSender(provider, sender, [{ name: 'a.txt', bytes: ascii('four') }]);
    await script.offer();
    await engine.accept({ sink: new MemorySink() });
    await recordOf(sender, 'accept');
    await script.sendFile(0);
    await script.finish();
    const result = await recordOf(sender, 'result');
    await script.send({ type: 'result-ack', commitId: new Uint8Array(16).fill(0xee) });
    await sleep(100);
    expect(engine.state).toBe('finalising');
    await script.send({ type: 'result-ack', commitId: result.commitId });
    expect(said(await engine.done)).toBe('completed, saved');
  });

  for (const [what, after] of [
    ['a CLOSE after it', (s: ScriptedSender) => s.send({ type: 'close', operationId: new Uint8Array(16), reason: 'USER_CANCELLED' })],
    ['the channel closing after it', async (s: ScriptedSender) => { s.channel.close(); }],
  ] as Array<[string, (s: ScriptedSender) => Promise<void>]>) {
    it(`once RESULT has gone the files are saved: ${what} leaves the receive completed`, async () => {
      const t = await transfer(provider);
      const { receiver, sender } = channels(t);
      const engine = receiveDirect(provider, receiver, { timers: NEVER });
      const script = new ScriptedSender(provider, sender, [{ name: 'a.txt', bytes: ascii('four') }]);
      await script.offer();
      const sink = new MemorySink();
      await engine.accept({ sink });
      await recordOf(sender, 'accept');
      await script.sendFile(0);
      await script.finish();
      await recordOf(sender, 'result');
      await after(script);
      expect(said(await engine.done)).toBe('completed, saved');
      expect(sink.closed).toBe(true);
      expect(sink.aborted).toBeUndefined();
    });
  }

  it("a finished file is credited at once: twelve empty files, eight file ends at most ahead, complete with the receiver's timers never firing", async () => {
    const run = await directInMemory(Array.from({ length: 12 }, (_, i) => memoryFile(`e${i}`, new Uint8Array(0))), { receiverTimers: NEVER });
    const { receiver } = await run.receive();
    const { sink, files } = sinksByFile();
    await receiver.accept({ sink });
    expect(said(await receiver.done)).toBe('completed, saved');
    expect(said(await run.sender.done)).toBe('completed, saved');
    expect([...files.values()].every((f) => f.sink.closed)).toBe(true);
  });

  it('records are the size the smaller hello allows: a receiver whose data channel takes 20,000 bytes is sent none larger', async () => {
    const bytes = patterned(MiB + 77, 22);
    const run = await directInMemory([memoryFile('a.bin', bytes)], { maxMessageBytes: { receiver: 20000 } });
    const { pair, receiver } = await run.receive();
    const sink = new MemorySink();
    await receiver.accept({ sink });
    expect(said(await receiver.done)).toBe('completed, saved');
    expect(sameAs(sink.bytes, bytes)).toBe('the same');
    const sizes = (pair.data as NonNullable<PeerPair['data']>).sent.sender.map((m) => m.byteLength);
    expect(Math.max(...sizes)).toBe(20000);
  });
});

describe('what comes in order', () => {
  it('a CLOSE that comes just before the channel closes is heard, even while a write was still going', async () => {
    const bytes = patterned(2 * MiB, 30);
    const { engine, script } = await receiverAndScript([{ name: 'a.bin', bytes }]);
    await script.offer();
    const sink = new MemorySink();
    let release!: () => void;
    sink.holdWrite = (n) => (n === 1 ? new Promise<void>((resolve) => { release = resolve; }) : undefined);
    await engine.accept({ sink });
    await recordOf(script.channel, 'accept');
    await script.sendFile(0);
    await until(() => sink.writes === 1, 'the first write');
    await script.send({ type: 'close', operationId: new Uint8Array(16), reason: 'USER_CANCELLED' });
    script.channel.close();
    await sleep(50);
    release();
    expect(said(await engine.done)).toBe('cancelled by peer');
  });

  it('a ZIP whose output is still writing gives no more credit: a sender going on regardless is refused', async () => {
    const bytes = patterned(6 * MiB, 31);
    const { engine, script } = await receiverAndScript([{ name: 'a.bin', bytes }]);
    await script.offer();
    const sink = new MemorySink();
    // The archive's second piece (the first block's bytes, after the member's header) never finishes.
    sink.holdWrite = (n) => (n === 2 ? new Promise<void>(() => undefined) : undefined);
    await engine.accept({ sink, asZip: true });
    await recordOf(script.channel, 'accept');
    void script.sendFile(0).catch(() => undefined);
    expect(said(await engine.done)).toBe('failed INVALID_MESSAGE');
  });

  it("completes 2 s after RESULT if no RESULT_ACK comes: the files are saved either way", async () => {
    const pending: Array<{ run: () => void; ms: number }> = [];
    const timers: EngineTimers = { setTimeout: (run, ms) => pending.push({ run, ms }), clearTimeout: () => undefined };
    const t = await transfer(provider);
    const { receiver, sender } = channels(t);
    const engine = receiveDirect(provider, receiver, { timers });
    const script = new ScriptedSender(provider, sender, [{ name: 'a.txt', bytes: ascii('four') }]);
    await script.offer();
    await engine.accept({ sink: new MemorySink() });
    await recordOf(sender, 'accept');
    await script.sendFile(0);
    await script.finish();
    await recordOf(sender, 'result');
    expect(engine.state).toBe('finalising');
    const wait = pending.find((p) => p.ms === 2000);
    expect(wait).toBeDefined();
    wait?.run();
    expect(said(await engine.done)).toBe('completed, saved');
  });

  it("the sender's state runs offered, transferring, finalising, completed", async () => {
    const run = await directInMemory([memoryFile('a.bin', patterned(2 * MiB, 32))]);
    const states: string[] = [run.sender.state];
    run.sender.onChange(() => states.push(run.sender.state));
    const { receiver } = await run.receive();
    await receiver.accept({ sink: new MemorySink() });
    await run.sender.done;
    expect(states).toEqual(['waiting', 'offered', 'transferring', 'finalising', 'completed']);
  });

  it('a receiver that reaches the room once another is chosen is never offered', async () => {
    const run = await directInMemory([memoryFile('a.bin', patterned(8 * MiB, 33))]);
    const a = await run.receive();
    const sink = new MemorySink();
    let release!: () => void;
    sink.holdWrite = (n) => (n === 1 ? new Promise<void>((resolve) => { release = resolve; }) : undefined);
    await a.receiver.accept({ sink });
    await until(() => sink.writes === 1, 'the chosen receiver writing');
    // The mock rendezvous still lets it join (the real one says BUSY): the sender closes it.
    const late = await run.receive();
    await expect(late.receiver.offer()).rejects.toMatchObject({ code: 'CONNECTION_LOST' });
    release();
    expect(said(await a.receiver.done)).toBe('completed, saved');
  });

  it("a sender whose data channel takes 20,000 bytes says so in its hello: the list of files and the data come in its size", async () => {
    const files = Array.from({ length: 600 }, (_, i) => memoryFile(`a rather long file name, number ${String(i).padStart(4, '0')}.txt`, patterned(i % 3, i)));
    files.push(memoryFile('big.bin', patterned(MiB + 5, 34)));
    const run = await directInMemory(files, { maxMessageBytes: { sender: 20000 } });
    const { pair, receiver } = await run.receive();
    const { sink, files: got } = sinksByFile();
    await receiver.accept({ sink });
    expect(said(await receiver.done)).toBe('completed, saved');
    expect(sameAs((got.get(600)?.sink as MemorySink).bytes, patterned(MiB + 5, 34))).toBe('the same');
    const sizes = (pair.data as NonNullable<PeerPair['data']>).sent.sender.map((m) => m.byteLength);
    expect(Math.max(...sizes)).toBe(20000);
  });
});

describe("the sender's checks", () => {
  for (const [what, accept] of [
    ["a manifest hash that isn't the offer's", { manifestHash: new Uint8Array(32) }],
    ['more than 4 MiB of credit', { creditLimit: CREDIT_WINDOW_BYTES + 1 }],
  ] as Array<[string, Partial<Extract<Message, { type: 'accept' }>>]>) {
    it(`an ACCEPT with ${what} is INVALID_MESSAGE, and the receiver is told`, async () => {
      const files = [memoryFile('a.bin', ascii('four'))];
      const { raw, outcomes, hash } = await sessionAndReceiver(files);
      await recordOf(raw, 'manifest');
      await raw.send(encodeMessage({ type: 'accept', manifestHash: hash, resumeSecret: new Uint8Array(32), creditLimit: CREDIT_WINDOW_BYTES, sink: 'saved', ...accept }));
      expect(await closeHeard(raw)).toBe('FAILED INVALID_MESSAGE');
      expect(outcomes.map(said)).toEqual(['failed INVALID_MESSAGE']);
    });
  }

  it('a CREDIT before ACCEPT is INVALID_MESSAGE', async () => {
    const { raw, outcomes } = await sessionAndReceiver([memoryFile('a.bin', ascii('four'))]);
    await recordOf(raw, 'manifest');
    await raw.send(encodeMessage({ type: 'credit', revision: 1, limit: 4 * MiB, consumed: 0, filesDone: 0, verifiedFileIndex: 0, verifiedOffset: 0 }));
    expect(await closeHeard(raw)).toBe('FAILED INVALID_MESSAGE');
    expect(outcomes.map(said)).toEqual(['failed INVALID_MESSAGE']);
  });

  it('a second ACCEPT mid-transfer is INVALID_MESSAGE', async () => {
    const { raw, outcomes, accept, hash } = await sessionAndReceiver([memoryFile('a.bin', patterned(6 * MiB, 23))]);
    await accept();
    await recordOf(raw, 'data');
    await raw.send(encodeMessage({ type: 'accept', manifestHash: hash, resumeSecret: new Uint8Array(32), creditLimit: CREDIT_WINDOW_BYTES, sink: 'saved' }));
    expect(await closeHeard(raw)).toBe('FAILED INVALID_MESSAGE');
    expect(outcomes.map(said)).toEqual(['failed INVALID_MESSAGE']);
  });

  it('a RESULT before FINISH is INVALID_MESSAGE', async () => {
    const { raw, outcomes, accept } = await sessionAndReceiver([memoryFile('a.bin', patterned(6 * MiB, 24))]);
    await accept();
    await recordOf(raw, 'data');
    await raw.send(encodeMessage({ type: 'result', commitId: new Uint8Array(16), assurance: 'saved', fileCount: 1, totalSize: 6 * MiB, chain: new Uint8Array(32) }));
    expect(await closeHeard(raw)).toBe('FAILED INVALID_MESSAGE');
    expect(outcomes.map(said)).toEqual(['failed INVALID_MESSAGE']);
  });

  for (const [what, change] of [
    ['a chain', { chain: new Uint8Array(32).fill(1) }],
    ['a file count', { fileCount: 2 }],
    ['a total', { totalSize: 5 }],
    ['an assurance', { assurance: 'handed-off' }],
  ] as Array<[string, Record<string, unknown>]>) {
    it(`a RESULT with ${what} other than what was sent and accepted is INVALID_MESSAGE, never completed`, async () => {
      const { raw, outcomes, accept } = await sessionAndReceiver([memoryFile('a.bin', ascii('four'))]);
      await accept();
      const finish = await recordOf(raw, 'finish');
      await raw.send(encodeMessage({ type: 'result', commitId: new Uint8Array(16), assurance: 'saved', fileCount: 1, totalSize: 4, chain: finish.chain, ...change } as Message));
      expect(await closeHeard(raw)).toBe('FAILED INVALID_MESSAGE');
      expect(outcomes.map(said)).toEqual(['failed INVALID_MESSAGE']);
    });
  }

  it('a CREDIT whose consumed or files done go down, or that says more files done than ended, is INVALID_MESSAGE', async () => {
    const files = Array.from({ length: 3 }, (_, i) => memoryFile(`f${i}`, i === 2 ? patterned(6 * MiB, 25) : ascii('xy')));
    for (const [what, second] of [
      // The first CREDIT keeps ACCEPT's limit, so only consumed going down is wrong in the first case.
      ['consumed going down', { revision: 2, limit: 4 * MiB, consumed: 2, filesDone: 1 }],
      ['files done going down', { revision: 2, limit: 4 * MiB + 4, consumed: 4, filesDone: 0 }],
      ['more files done than ended', { revision: 2, limit: 4 * MiB + 4, consumed: 4, filesDone: 3 }],
    ] as const) {
      const { raw, outcomes, accept } = await sessionAndReceiver(files);
      await accept();
      await recordOf(raw, 'file-end');
      await recordOf(raw, 'file-end');
      await raw.send(encodeMessage({ type: 'credit', revision: 1, limit: 4 * MiB, consumed: 4, filesDone: 1, verifiedFileIndex: 2, verifiedOffset: 0 }));
      await raw.send(encodeMessage({ type: 'credit', verifiedFileIndex: 2, verifiedOffset: 0, ...second }));
      expect(await closeHeard(raw), what).toBe('FAILED INVALID_MESSAGE');
      expect(outcomes.map(said), what).toEqual(['failed INVALID_MESSAGE']);
    }
  });

  it('reads a file at most 2 blocks ahead of what it has sent', async () => {
    const file = memoryFile('a.bin', patterned(10 * MiB, 26));
    const { raw, accept } = await sessionAndReceiver([file]);
    await accept(dataBytes(Math.min(raw.maxRecordBytes, raw.peerHello.maxRecord)));
    await recordOf(raw, 'data');
    await sleep(150);
    expect(file.reads).toEqual([[0, MiB], [MiB, 2 * MiB]]);
  });

  it("refuses files it can't offer before anything reaches the rendezvous: INVALID_FILENAME, INVALID_ARGUMENT", async () => {
    const rendezvous = new MockRendezvous();
    const peer = () => new PeerPair().sender;
    await expect(sendDirect(provider, { files: [memoryFile('a/b.txt', ascii('x'))], rendezvous: rendezvous.sender, peer })).rejects.toMatchObject({ code: 'INVALID_FILENAME' });
    await expect(sendDirect(provider, { files: [], rendezvous: rendezvous.sender, peer })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(sendDirect(provider, { files: [{} as never], rendezvous: rendezvous.sender, peer })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(sendDirect(provider, { files: [memoryFile('a.txt', ascii('x'))], rendezvous: rendezvous.sender, peer: undefined as never })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(rendezvous.records).toEqual([]);
  });

  it('goes back to waiting when the only receiver offered leaves', async () => {
    const run = await directInMemory([memoryFile('a.bin', ascii('four'))]);
    const { receiver } = await run.receive();
    await receiver.offer();
    expect(run.sender.state).toBe('offered');
    receiver.cancel();
    await until(() => run.sender.state === 'waiting', 'the sender waiting again');
    run.sender.cancel();
    expect(said(await run.sender.done)).toBe('cancelled by self');
  });
});

describe("a CLOSE's words", () => {
  it("each reason and detail heard as the table says, in each side's words, never the other device's", () => {
    const heard = (close: Parameters<typeof outcomeOfClose>[0], side: 'sender' | 'receiver') => {
      const o = outcomeOfClose(close, side);
      return o.state === 'failed' ? `${o.error.code}${o.error.details ? ` ${String(o.error.details.reason)}` : ''}: ${o.error.message}` : said(o);
    };
    expect(heard({ reason: 'USER_CANCELLED' }, 'receiver')).toBe('cancelled by peer');
    expect(heard({ reason: 'USER_DECLINED' }, 'sender')).toBe('cancelled by peer, declined');
    expect(heard({ reason: 'USER_DECLINED' }, 'receiver')).toBe('cancelled by peer');
    expect(heard({ reason: 'TAKEN' }, 'receiver')).toBe('REQUEST_REJECTED: This transfer is already going to someone else.');
    expect(heard({ reason: 'TAKEN' }, 'sender')).toBe("PEER_FAILED: The receiver's device reported an error.");
    expect(heard({ reason: 'FAILED', detail: 'TIMED_OUT' }, 'receiver')).toBe("TIMED_OUT: The offer wasn't accepted within 10 minutes.");
    expect(heard({ reason: 'FAILED', detail: 'SOURCE_UNAVAILABLE' }, 'receiver')).toBe("PEER_FAILED SOURCE_UNAVAILABLE: The sender's file couldn't be read.");
    expect(heard({ reason: 'FAILED', detail: 'OUTPUT_STALLED' }, 'sender')).toBe("PEER_FAILED OUTPUT_STALLED: The receiver's device stopped saving the file.");
    expect(heard({ reason: 'FAILED', detail: 'INTEGRITY_FAILED' }, 'sender')).toBe("PEER_FAILED INTEGRITY_FAILED: The file didn't arrive intact.");
    expect(heard({ reason: 'FAILED', detail: 'INVALID_MANIFEST' }, 'sender')).toBe("PEER_FAILED INVALID_MANIFEST: The receiver couldn't read the list of files.");
    expect(heard({ reason: 'FAILED', detail: 'INVALID_MESSAGE' }, 'receiver')).toBe("PEER_FAILED INVALID_MESSAGE: The sender's device couldn't understand what this device sent.");
    expect(heard({ reason: 'FAILED', detail: 'INVALID_MESSAGE' }, 'sender')).toBe("PEER_FAILED INVALID_MESSAGE: The receiver's device couldn't understand what this device sent.");
    expect(heard({ reason: 'APP_CLOSED' }, 'receiver')).toBe('PEER_FAILED APP_CLOSED: The sender closed Dropgate before the transfer finished.');
    expect(heard({ reason: 'APP_CLOSED' }, 'sender')).toBe('PEER_FAILED APP_CLOSED: The receiver closed Dropgate before the transfer finished.');
    expect(heard({ reason: 'PAUSE_LIMIT' }, 'sender')).toBe("PEER_FAILED PAUSE_LIMIT: The receiver's app ended the transfer after a pause.");
    expect(heard({ reason: 'FAILED' }, 'receiver')).toBe("PEER_FAILED: The sender's device reported an error.");
    expect(heard({ reason: 'FAILED', detail: 'CAPABILITY_UNSUPPORTED' }, 'receiver')).toBe("PEER_FAILED CAPABILITY_UNSUPPORTED: The sender's device reported an error.");
  });

  it('a failure is told as FAILED with its detail; a lost or refused channel, or a cancel, sends no CLOSE', () => {
    const told = (code: ConstructorParameters<typeof DropgateError>[0]['code']) => closeFor(new DropgateError({ code }));
    expect(told('OUTPUT_WRITE_FAILED')).toEqual({ reason: 'FAILED', detail: 'OUTPUT_WRITE_FAILED' });
    expect(told('SOURCE_UNAVAILABLE')).toEqual({ reason: 'FAILED', detail: 'SOURCE_UNAVAILABLE' });
    expect(told('INVALID_MANIFEST')).toEqual({ reason: 'FAILED', detail: 'INVALID_MANIFEST' });
    expect(told('UNEXPECTED_ERROR')).toEqual({ reason: 'FAILED' });
    for (const code of ['CONNECTION_LOST', 'SECURITY_POLICY_MISMATCH', 'OPERATION_CANCELLED'] as const) expect(told(code)).toBeUndefined();
  });
});
