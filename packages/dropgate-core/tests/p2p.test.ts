import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startP2PReceive, startP2PSend, P2P_PROTOCOL_VERSION } from '../src/p2p/index.js';
import type { P2PReceiveOptions, P2PReceiveSession, P2PSendSession, PeerConstructor } from '../src/p2p/index.js';
import type { FileSource } from '../src/types.js';
import { FakePeer, type FakeConnection } from './helpers/fake-peer.js';
import { settle } from './helpers/known-issue.js';

// Dropgate 3's direct transfer on PeerJS, which runs beside version 4's until
// PeerJS goes. What its receiver and message parser got wrong is tested
// against version 4's engine instead, in engine.test.ts. The receiver here runs
// against the fake PeerJS objects in helpers/fake-peer.ts, with the test
// playing the sender.
//
// The sender's tests are plain ones: its handshake was fixed in v3's engine,
// because Chromium sometimes lost the first message it sent, and sometimes
// reported its data channel open twice.

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


/** A file held in memory, as the sender reads files. */
function memoryFile(name: string, bytes: Uint8Array, type = 'text/plain'): FileSource {
  return {
    name,
    size: bytes.byteLength,
    type,
    slice: (start, end) => memoryFile(name, bytes.slice(start, end), type),
    arrayBuffer: async () => bytes.slice().buffer,
  };
}

describe('P2P sender', () => {
  const sendSessions: P2PSendSession[] = [];

  afterEach(() => {
    for (const session of sendSessions.splice(0)) session.stop();
  });

  it('sends nothing until the receiver says hello, then its own hello and the file details', async () => {
    const starting = startP2PSend({
      file: memoryFile('notes.txt', new Uint8Array([1, 2, 3, 4])),
      Peer: FakePeer as unknown as PeerConstructor,
      codeGenerator: () => 'ABCD-1234',
    });
    FakePeer.latest().simulateOpen('ABCD-1234');
    sendSessions.push(await starting);

    const conn = FakePeer.latest().simulateConnection();
    conn.simulateOpen();
    await settle();
    expect(conn.sent, 'what the sender sent before the receiver said hello').toEqual([]);

    await conn.deliver({ t: 'hello', protocolVersion: P2P_PROTOCOL_VERSION, sessionId: '' });
    await settle();
    expect(conn.sent.map((msg) => (msg as { t?: unknown }).t), 'what the sender sent after it').toEqual(['hello', 'meta']);
  });

  it('starts the transfer once when its connection reports open twice', async () => {
    const starting = startP2PSend({
      file: memoryFile('notes.txt', new Uint8Array([1, 2, 3, 4])),
      Peer: FakePeer as unknown as PeerConstructor,
      codeGenerator: () => 'ABCD-1234',
    });
    FakePeer.latest().simulateOpen('ABCD-1234');
    sendSessions.push(await starting);

    const conn = FakePeer.latest().simulateConnection();
    conn.simulateOpen();
    conn.simulateOpen();
    await conn.deliver({ t: 'hello', protocolVersion: P2P_PROTOCOL_VERSION, sessionId: '' });
    await settle();
    expect(conn.sent.map((msg) => (msg as { t?: unknown }).t), 'what the sender sent').toEqual(['hello', 'meta']);
  });
});

describe('A cancel from the other device', () => {
  const PEER_TEXT = 'Your files are locked. Visit evil.example to unlock them.';

  it("reaches the receiver's onCancel as who cancelled, without the sender's own text", async () => {
    const cancels: unknown[] = [];
    const { conn } = await connectReceiver({ onData: () => {}, onCancel: (evt) => cancels.push(evt) });
    await offerFile(conn, 8);

    await conn.deliver({ t: 'cancelled', reason: PEER_TEXT });

    expect(cancels).toEqual([{ cancelledBy: 'sender' }]);
  });

  it("reaches the sender's onCancel as who cancelled, without the receiver's own text", async () => {
    const cancels: unknown[] = [];
    const starting = startP2PSend({
      file: memoryFile('notes.txt', new Uint8Array([1, 2, 3, 4])),
      Peer: FakePeer as unknown as PeerConstructor,
      codeGenerator: () => 'ABCD-1234',
      onCancel: (evt) => cancels.push(evt),
    });
    FakePeer.latest().simulateOpen('ABCD-1234');
    const session = await starting;
    try {
      const conn = FakePeer.latest().simulateConnection();
      conn.simulateOpen();
      await conn.deliver({ t: 'hello', protocolVersion: P2P_PROTOCOL_VERSION, sessionId: '' });
      await settle();

      await conn.deliver({ t: 'cancelled', reason: PEER_TEXT });

      expect(cancels).toEqual([{ cancelledBy: 'receiver' }]);
    } finally {
      session.stop();
    }
  });
});
