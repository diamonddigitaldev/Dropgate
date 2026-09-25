import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startP2PReceive, isP2PMessage, P2P_PROTOCOL_VERSION } from '../src/p2p/index.js';
import type { P2PReceiveOptions, P2PReceiveSession, PeerConstructor } from '../src/p2p/index.js';
import { FakePeer, type FakeConnection } from './helpers/fake-peer.js';
import { onlyFailsWith, settle } from './helpers/known-issue.js';

// Known issues in the v3 direct-transfer receiver and message parser. Each test
// states the behaviour the v4 transfer engine must have, and is marked
// `it.fails` until then. The receiver runs against the fake PeerJS objects in
// helpers/fake-peer.ts, with the test playing the sender.

const SESSION_ID = 'session-1';
const sessions: P2PReceiveSession[] = [];

beforeEach(() => {
  FakePeer.reset();
});

afterEach(() => {
  for (const session of sessions.splice(0)) session.stop();
});

/** Starts a receiver and opens its connection to the (fake) sender. */
async function connectReceiver(
  opts: Partial<P2PReceiveOptions> = {}
): Promise<{ session: P2PReceiveSession; conn: FakeConnection }> {
  const session = await startP2PReceive({
    code: 'ABCD-1234',
    Peer: FakePeer as unknown as PeerConstructor,
    watchdogTimeoutMs: 0,
    ...opts,
  });
  sessions.push(session);

  const peer = FakePeer.latest();
  peer.simulateOpen();
  const conn = peer.connections[0];
  conn.simulateOpen();
  return { session, conn };
}

/** Sender's side of the handshake and a single-file offer, which the receiver accepts. */
async function offerFile(conn: FakeConnection, size: number): Promise<void> {
  await conn.deliver({ t: 'hello', protocolVersion: P2P_PROTOCOL_VERSION, sessionId: SESSION_ID });
  await conn.deliver({ t: 'meta', sessionId: SESSION_ID, name: 'notes.txt', size, mime: 'text/plain' });
}

/** Sends one chunk: its header, then the bytes. */
async function sendChunk(conn: FakeConnection, seq: number, offset: number, data: Uint8Array, total: number): Promise<void> {
  await conn.deliver({ t: 'chunk', seq, offset, size: data.byteLength, total });
  await conn.deliver(data);
}

describe('P2P receiver', () => {
  it.fails(
    'rejects a sender on an unsupported protocol version (known issue until the v4 transfer engine)',
    onlyFailsWith(/accepted a sender on protocol version 999/, async () => {
      const { session, conn } = await connectReceiver({ onData: () => {} });

      await conn.deliver({ t: 'hello', protocolVersion: 999, sessionId: SESSION_ID });
      await conn.deliver({ t: 'meta', sessionId: SESSION_ID, name: 'notes.txt', size: 4, mime: 'text/plain' });

      expect(conn.sentOfType('ready'), 'the receiver accepted a sender on protocol version 999').toEqual([]);
      expect(session.getStatus()).not.toBe('transferring');
    })
  );

  it.fails(
    'does not report a dropped connection as the sender cancelling (known issue until the v4 transfer engine)',
    onlyFailsWith(/dropped connection was reported as the sender cancelling/, async () => {
      const cancels: unknown[] = [];
      const { conn } = await connectReceiver({ onData: () => {}, onCancel: (evt) => cancels.push(evt) });
      await offerFile(conn, 8);
      await sendChunk(conn, 0, 0, new Uint8Array(4), 8);
      await settle();

      conn.simulateClose();

      expect(cancels, 'a dropped connection was reported as the sender cancelling').toEqual([]);
    })
  );

  it.fails(
    'treats file data with no chunk header as a framing error (known issue until the v4 transfer engine)',
    onlyFailsWith(/accepted file data that had no chunk header/, async () => {
      const written: number[] = [];
      const errors: Error[] = [];
      const { conn } = await connectReceiver({
        onData: (chunk) => { written.push(chunk.byteLength); },
        onError: (err) => errors.push(err),
      });
      await offerFile(conn, 4);

      await conn.deliver(new Uint8Array([1, 2, 3, 4]));
      await settle();

      expect(written, 'the receiver accepted file data that had no chunk header').toEqual([]);
      expect(errors).toHaveLength(1);
    })
  );

  it.fails(
    'does not complete when there is nowhere to write the data (known issue until the v4 transfer engine)',
    onlyFailsWith(/confirmed the transfer with nowhere to write the data/, async () => {
      const completions: unknown[] = [];
      const { conn } = await connectReceiver({ onComplete: (evt) => completions.push(evt) });
      await offerFile(conn, 4);
      await sendChunk(conn, 0, 0, new Uint8Array([1, 2, 3, 4]), 4);

      await conn.deliver({ t: 'end' });

      expect(conn.sentOfType('end_ack'), 'the receiver confirmed the transfer with nowhere to write the data').toEqual([]);
      expect(completions).toEqual([]);
    })
  );

  it.fails(
    'waits for the file to be finalised before confirming the transfer (known issue until the v4 transfer engine)',
    onlyFailsWith(/confirmed the transfer while the file was still being finalised/, async () => {
      let finishFinalising!: () => void;
      const finalising = new Promise<void>((resolve) => { finishFinalising = resolve; });
      const { session, conn } = await connectReceiver({ onData: () => {}, onComplete: () => finalising });
      await offerFile(conn, 4);
      await sendChunk(conn, 0, 0, new Uint8Array([1, 2, 3, 4]), 4);

      // Not awaited: a receiver that waits for finalisation won't settle this yet.
      const ending = conn.deliver({ t: 'end' });
      await settle();

      try {
        expect(conn.sentOfType('end_ack'), 'the receiver confirmed the transfer while the file was still being finalised').toEqual([]);
        expect(session.getStatus()).not.toBe('completed');
      } finally {
        finishFinalising();
        await ending;
      }
    })
  );

  it.fails(
    'runs no queued writes after stop() (known issue until the v4 transfer engine)',
    onlyFailsWith(/a queued write still ran after stop\(\)/, async () => {
      let releaseFirstWrite!: () => void;
      const firstWrite = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
      let writes = 0;
      const { session, conn } = await connectReceiver({
        onData: () => {
          writes += 1;
          return writes === 1 ? firstWrite : undefined;
        },
      });
      await offerFile(conn, 8);
      await sendChunk(conn, 0, 0, new Uint8Array(4), 8);
      await sendChunk(conn, 1, 4, new Uint8Array(4), 8);
      await settle();
      expect(writes, 'the first write should be in progress').toBe(1);

      session.stop();
      releaseFirstWrite();
      await settle();

      expect(writes, 'a queued write still ran after stop()').toBe(1);
    })
  );

  it.fails(
    'does not acknowledge a file that is shorter than declared (known issue until the v4 transfer engine)',
    onlyFailsWith(/acknowledged a 4-byte file after 2 bytes/, async () => {
      const { conn } = await connectReceiver({ onData: () => {} });
      await conn.deliver({ t: 'hello', protocolVersion: P2P_PROTOCOL_VERSION, sessionId: SESSION_ID });
      await conn.deliver({
        t: 'file_list',
        fileCount: 2,
        files: [
          { name: 'first.txt', size: 4, mime: 'text/plain' },
          { name: 'second.txt', size: 1, mime: 'text/plain' },
        ],
        totalSize: 5,
      });
      await conn.deliver({ t: 'meta', sessionId: SESSION_ID, name: 'first.txt', size: 4, mime: 'text/plain', fileIndex: 0 });
      await sendChunk(conn, 0, 0, new Uint8Array([1, 2]), 4);

      await conn.deliver({ t: 'file_end', fileIndex: 0 });

      expect(conn.sentOfType('file_end_ack'), 'the receiver acknowledged a 4-byte file after 2 bytes').toEqual([]);
    })
  );
});

describe('P2P message parser', () => {
  it.fails(
    'isP2PMessage() rejects a chunk with a string sequence and a negative size (known issue until the v4 transfer engine)',
    onlyFailsWith(/accepted a chunk with a string sequence and a negative size/, () => {
      const chunk = { t: 'chunk', seq: '0', offset: 0, size: -1, total: 4 };

      expect(isP2PMessage(chunk), 'isP2PMessage() accepted a chunk with a string sequence and a negative size').toBe(false);
    })
  );
});
