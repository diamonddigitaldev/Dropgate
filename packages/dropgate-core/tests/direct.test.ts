import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { webCryptoProvider } from '../src/crypto/index.js';
import { connectByCode, connectByLink, type SecureChannel } from '../src/dgdtp/channel.js';
import type { DirectOutcome } from '../src/dgdtp/engine.js';
import { receiveDirect } from '../src/dgdtp/receive.js';
import { receiverRendezvous, rendezvousUrl, senderRendezvous, type WebSocketClass } from '../src/dgdtp/rendezvous.js';
import { sendDirect } from '../src/dgdtp/send.js';
import { webRtcPeer } from '../src/dgdtp/webrtc.js';
import type { FileSource } from '../src/source.js';
import { MemorySink, memoryFile, patterned, sameAs, sinksByFile } from './helpers/direct.js';
import { Loopback, useLoopback } from './helpers/werift-loopback.js';
import { readZip } from './helpers/zip-reader.js';
// The server suite's own harness: the real server.js, in a throwaway folder, on a free port.
import { startServer } from '../../../server/test/helpers/harness.mjs';

// The direct-transfer engine end to end: a sender's room on a real Dropgate
// server's rendezvous, a receiver by its link or its code, the secure channel
// over werift's WebRTC in Node (on ::1 alone, a certificate each:
// tests/helpers/werift-loopback.ts), then the list of files, ACCEPT, the data
// under credit, blocks and the chain, FINISH, the sink, RESULT and RESULT_ACK.
// Every file arrives byte for byte, at the sizes where blocks and records
// turn, as many files with empty ones among them, into a ZIP, and one large
// enough to run the credit and the pump for a while (werift carries about
// 7.5 MiB/s on loopback). Nothing the server relays holds a file's name.

const provider = webCryptoProvider(globalThis.crypto);
const MiB = 1048576;

/** Each test's peer connections at most: two for each transfer. */
useLoopback(10);

interface Server {
  baseUrl: string;
  stop(): Promise<void>;
}

const said = (o: DirectOutcome) => (o.state === 'failed' ? `failed ${o.error.code}` : o.state === 'cancelled' ? `cancelled by ${o.by}` : `completed, ${o.assurance}`);

/** The global WebSocket, keeping every message each socket sent. */
function recordingWebSocket(sent: Uint8Array[]): WebSocketClass {
  const Base = globalThis.WebSocket;
  return class extends Base {
    send(data: Uint8Array): void {
      sent.push(new Uint8Array(data));
      super.send(data);
    }
  } as unknown as WebSocketClass;
}

/** Whether `needle` appears anywhere in `haystack`. */
function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.byteLength <= haystack.byteLength; i++) {
    for (let j = 0; j < needle.byteLength; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

describe('a direct transfer end to end through the real server, over werift', () => {
  let server: Server;
  let url: string;
  let codeLetters: number;

  beforeAll(async () => {
    server = (await startServer({ env: { RATE_LIMIT_MAX_REQUESTS: '0', P2P_STUN_SERVERS: 'none' } })) as Server;
    url = rendezvousUrl(server.baseUrl);
    const info = await (await fetch(`${server.baseUrl}/api/info`)).json() as { capabilities: { p2p: { codeLetters: number } } };
    codeLetters = info.capabilities.p2p.codeLetters;
  }, 30_000);

  afterAll(async () => {
    await server?.stop();
  });

  /** A send of `files`, and one receiver by its link (or its code): the receiver's engine, once its channel is up. */
  async function direct(files: FileSource[], options: { byCode?: boolean; sent?: Uint8Array[] } = {}) {
    const ws = options.sent ? { WebSocket: recordingWebSocket(options.sent) } : {};
    const sender = await sendDirect(provider, {
      files, rendezvous: senderRendezvous({ url, codeLetters: codeLetters as 2, ...ws }), code: options.byCode === true,
      letters: codeLetters as 2, peer: () => webRtcPeer({ RTCPeerConnection: Loopback, role: 'sender' }),
    });
    const rendezvous = receiverRendezvous({ url, codeLetters: codeLetters as 2, ...ws });
    const peer = webRtcPeer({ RTCPeerConnection: Loopback, role: 'receiver' });
    let channel: SecureChannel;
    if (options.byCode) {
      channel = await connectByCode(provider, { rendezvous, code: sender.room.code as string, letters: codeLetters as 2, peer });
    } else {
      channel = await connectByLink(provider, { rendezvous, secret: sender.room.linkSecret() as Uint8Array, peer });
    }
    return { sender, receiver: receiveDirect(provider, channel) };
  }

  it('one file of 0, 1, 1 MiB - 1, 1 MiB and 1 MiB + 1 bytes, each byte for byte, both sides completed', async () => {
    for (const size of [0, 1, MiB - 1, MiB, MiB + 1]) {
      const bytes = patterned(size, size + 1);
      const { sender, receiver } = await direct([memoryFile('one.bin', bytes)]);
      expect((await receiver.offer()).files).toEqual([{ name: 'one.bin', size, type: 'application/octet-stream' }]);
      const sink = new MemorySink();
      await receiver.accept({ sink });
      const [r, s] = await Promise.all([receiver.done, sender.done]);
      expect(`${said(r)} / ${said(s)}`, `${size} bytes`).toBe('completed, saved / completed, saved');
      expect(sameAs(sink.bytes, bytes), `${size} bytes`).toBe('the same');
      expect(sink.closed, `${size} bytes`).toBe(true);
    }
  }, 60_000);

  it('many files, empty ones among them, by code, each to its own sink; nothing the server relayed holds a name', async () => {
    const sizes = [0, 7, 0, 0, MiB + 1, 0, 3, 0, 0, 0, 2 * MiB - 1, 0];
    const contents = sizes.map((size, i) => patterned(size, 200 + i));
    const names = sizes.map((_, i) => `report-${i}-quarterly.txt`);
    const sent: Uint8Array[] = [];
    const { sender, receiver } = await direct(contents.map((bytes, i) => memoryFile(names[i], bytes)), { byCode: true, sent });
    const offer = await receiver.offer();
    expect(offer.files.map((f) => f.name)).toEqual(names);
    expect(offer.totalSize).toBe(sizes.reduce((a, b) => a + b, 0));
    const { sink, files } = sinksByFile();
    await receiver.accept({ sink });
    expect(`${said(await receiver.done)} / ${said(await sender.done)}`).toBe('completed, saved / completed, saved');
    contents.forEach((bytes, i) => {
      expect(sameAs((files.get(i)?.sink as MemorySink).bytes, bytes), names[i]).toBe('the same');
      expect(files.get(i)?.sink.closed, names[i]).toBe(true);
    });
    expect(sent.length).toBeGreaterThan(0);
    for (const name of names) for (const message of sent) expect(contains(message, new TextEncoder().encode(name))).toBe(false);
  }, 60_000);

  it('the same files into one ZIP, each member byte for byte', async () => {
    const sizes = [0, 7, 0, MiB + 1, 0, 3, 0, 0, 2 * MiB - 1, 0];
    const contents = sizes.map((size, i) => patterned(size, 300 + i));
    const { sender, receiver } = await direct(contents.map((bytes, i) => memoryFile(`f${i}.bin`, bytes)));
    const sink = new MemorySink();
    await receiver.accept({ sink, asZip: true });
    expect(`${said(await receiver.done)} / ${said(await sender.done)}`).toBe('completed, saved / completed, saved');
    const zip = readZip([{ bytes: sink.bytes }]);
    expect(zip.entries.map((e) => e.name)).toEqual(contents.map((_, i) => `f${i}.bin`));
    zip.entries.forEach((entry, i) => {
      expect(sameAs(zip.bytesOf(entry), contents[i]), entry.name).toBe('the same');
      expect(zip.crcOf(entry), entry.name).toBe(entry.crc);
    });
  }, 60_000);

  it("once a receiver is chosen the room is locked: another joining by the link is refused REQUEST_REJECTED, and the transfer goes on", async () => {
    const bytes = patterned(3 * MiB, 7);
    const { sender, receiver } = await direct([memoryFile('a.bin', bytes)]);
    const sink = new MemorySink();
    let release!: () => void;
    sink.holdWrite = (n) => (n === 1 ? new Promise<void>((resolve) => { release = resolve; }) : undefined);
    await receiver.accept({ sink });
    const deadline = Date.now() + 5000;
    while (sink.writes < 1 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    const another = connectByLink(provider, {
      rendezvous: receiverRendezvous({ url, codeLetters: codeLetters as 2 }), secret: sender.room.linkSecret() as Uint8Array,
      peer: webRtcPeer({ RTCPeerConnection: Loopback, role: 'receiver' }),
    });
    await expect(another).rejects.toMatchObject({ code: 'REQUEST_REJECTED', message: 'This transfer is already going to someone else.' });
    release();
    expect(`${said(await receiver.done)} / ${said(await sender.done)}`).toBe('completed, saved / completed, saved');
    expect(sameAs(sink.bytes, bytes)).toBe('the same');
  }, 60_000);

  it("the sender's connection to the rendezvous lost before anyone accepts fails the send CONNECTION_LOST", async () => {
    const sockets: WebSocket[] = [];
    const Base = globalThis.WebSocket;
    const Kept = class extends Base {
      constructor(address: string) {
        super(address);
        sockets.push(this);
      }
    } as unknown as WebSocketClass;
    const sender = await sendDirect(provider, {
      files: [memoryFile('a.bin', patterned(10, 1))], rendezvous: senderRendezvous({ url, codeLetters: codeLetters as 2, WebSocket: Kept }),
      peer: () => webRtcPeer({ RTCPeerConnection: Loopback, role: 'sender' }),
    });
    expect(sender.state).toBe('waiting');
    sockets[0].close();
    expect(said(await sender.done)).toBe('failed CONNECTION_LOST');
  }, 30_000);

  it('a hold mid-transfer: the receiver pauses, nothing more arrives while it holds, each side says who holds it, then it resumes and completes byte for byte', async () => {
    const bytes = patterned(20 * MiB + 3, 98);
    const { sender, receiver } = await direct([memoryFile('held.bin', bytes)]);
    const sink = new MemorySink();
    await receiver.accept({ sink });
    const wait = async (check: () => boolean, what: string) => {
      const deadline = Date.now() + 10_000;
      while (!check()) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    await wait(() => sink.bytes.byteLength >= 2 * MiB, 'some of the file');
    receiver.pause();
    await wait(() => sender.pausedBy === 'peer', 'the sender hearing the hold');
    expect(receiver.pausedBy).toBe('self');
    expect(sender.canPause).toBe(true);
    // What was on its way lands; then nothing more.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const held = sink.bytes.byteLength;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(sink.bytes.byteLength).toBe(held);
    expect(held).toBeLessThan(bytes.byteLength);
    receiver.resume();
    expect(`${said(await receiver.done)} / ${said(await sender.done)}`).toBe('completed, saved / completed, saved');
    expect(sameAs(sink.bytes, bytes)).toBe('the same');
  }, 60_000);

  it("a cancel mid-transfer is told with CLOSE: the receiver cancelled by the sender, its sink aborted", async () => {
    const { sender, receiver } = await direct([memoryFile('a.bin', patterned(20 * MiB, 97))]);
    const sink = new MemorySink();
    await receiver.accept({ sink });
    const deadline = Date.now() + 10_000;
    while (sink.writes < 1 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    sender.cancel();
    expect(`${said(await receiver.done)} / ${said(await sender.done)}`).toBe('cancelled by peer / cancelled by self');
    expect(sink.aborted).toBeTruthy();
  }, 30_000);

  it('a large file, 20 MiB + 7 bytes, byte for byte: many rounds of credit and the pump', async () => {
    const bytes = patterned(20 * MiB + 7, 99);
    const { sender, receiver } = await direct([memoryFile('large.bin', bytes)]);
    const sink = new MemorySink();
    await receiver.accept({ sink });
    expect(`${said(await receiver.done)} / ${said(await sender.done)}`).toBe('completed, saved / completed, saved');
    expect(sameAs(sink.bytes, bytes)).toBe('the same');
  }, 60_000);
});
