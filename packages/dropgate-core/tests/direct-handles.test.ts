import { afterAll, afterEach, beforeAll, describe, it, expect, vi } from 'vitest';
import { inspect } from 'node:util';
import { DropgateClient, DropgateError } from '../src/index.js';
import type {
  DirectPeerConnectionClass, DirectReceiveHandle, DirectReceiveSnapshot, DirectSendHandle, DirectSendSnapshot, Outcome, DirectResult,
} from '../src/index.js';
import { DEFAULT_DIRECT_SETTINGS, directSettings, helloOf } from '../src/client/direct.js';
import { MemorySink, memoryFile, patterned, sameAs, sinksByFile } from './helpers/direct.js';
import { Loopback, LoopbackPeerConnection, certificates, newCertificate, useLoopback } from './helpers/werift-loopback.js';
// The server suite's own harness: the real server.js, in a throwaway folder, on a free port.
import { startServer } from '../../../server/test/helpers/harness.mjs';

// client.direct on handles, Node to Node through a real Dropgate server's
// rendezvous over werift (on ::1 alone, a certificate each:
// tests/helpers/werift-loopback.ts): a send's handle with share() for its
// link and code, a receive's with offer(), accept() and decline(); their
// snapshots and outcomes; pausing, cancelling each way, declining;
// client.operations; the direct option, client-wide and per transfer; the
// credential's one place; and nothing of the link, the code, its secret or a
// file's name in any snapshot, error, server log line or request.

const MiB = 1048576;

/** Each test's peer connections at most. */
useLoopback(12);

interface Server {
  baseUrl: string;
  output: { stdout: string; stderr: string };
  requests(): Array<{ method: string; url: string; headers: Record<string, string>; body?: string }>;
  stop(): Promise<void>;
}

const Peer = Loopback as unknown as DirectPeerConnectionClass;

/** A client of `server` on werift, with any other options. */
function clientOf(server: Server, options: Partial<ConstructorParameters<typeof DropgateClient>[0]> = {}): DropgateClient {
  return new DropgateClient({ server: server.baseUrl, RTCPeerConnection: Peer, ...options });
}

/** Waits until `check` passes, or fails naming `what`. */
async function until(check: () => boolean, what: string, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Every snapshot a handle gives, from the one it has now. */
function recorded<S>(handle: { snapshot: S; subscribe(listener: (s: S) => void): () => void }): S[] {
  const seen = [handle.snapshot];
  handle.subscribe((s) => seen.push(s));
  return seen;
}

/** The statuses in order, each once where it repeats. */
const statuses = (seen: Array<{ status: string }>) => seen.map((s) => s.status).filter((s, i, all) => i === 0 || all[i - 1] !== s);

const said = (o: Outcome<DirectResult>) => (o.status === 'completed'
  ? `completed, ${o.value.assurance}`
  : o.status === 'cancelled'
    ? `cancelled by ${o.cancellation.by}${o.cancellation.declined ? ', declined' : ''}`
    : `failed ${o.error.code}`);

describe('client.direct on handles, through the real server over werift', () => {
  let server: Server;

  beforeAll(async () => {
    server = (await startServer({ env: { RATE_LIMIT_MAX_REQUESTS: '0', P2P_STUN_SERVERS: 'none' } })) as Server;
  }, 30_000);

  afterAll(async () => {
    await server?.stop();
  });

  it("by link: share()'s link is the server's /p2p# and 32 bytes of URL-safe base64 with no code in it; offer() names the files; both complete; client.operations lists each while it runs", async () => {
    const sending = clientOf(server);
    const receiving = clientOf(server);
    const contents = [patterned(MiB + 1, 1), patterned(0, 2), patterned(7, 3)];
    const send = await sending.direct.send({ files: contents.map((bytes, i) => memoryFile(`photo-${i}.jpg`, bytes, { type: 'image/jpeg' })) });
    expect(send.kind).toBe('direct.send');
    expect(sending.operations.list()).toEqual([{ id: send.id, kind: 'direct.send' }]);
    expect(sending.operations.get(send.id)).toBe(send);
    const { link, code } = send.share();
    expect(link).toMatch(new RegExp(`^${server.baseUrl.replace(/\./g, '\\.')}/p2p#[A-Za-z0-9_-]{43}$`));
    const secret = Buffer.from((link as string).split('#')[1], 'base64url');
    expect(secret.byteLength).toBe(32);
    expect(code).toMatch(/^[A-HJ-NP-Z]{4}-\d{4}$/);
    expect(link).not.toContain((code as string).replace('-', ''));
    expect(send.snapshot).toMatchObject({ status: 'waiting', code: 'ready', canPause: false, pausedBy: null, totalBytes: MiB + 8, totalFiles: 3 });

    const receive = await receiving.direct.receive({ link: link as string });
    expect(receive.kind).toBe('direct.receive');
    expect(receive.snapshot.status).toBe('connecting');
    expect(receiving.operations.list()).toEqual([{ id: receive.id, kind: 'direct.receive' }]);
    const offer = await receive.offer();
    expect(offer).toEqual({
      files: [
        { name: 'photo-0.jpg', size: MiB + 1, type: 'image/jpeg' }, { name: 'photo-1.jpg', size: 0, type: 'image/jpeg' },
        { name: 'photo-2.jpg', size: 7, type: 'image/jpeg' },
      ],
      totalSize: MiB + 8,
    });
    expect(receive.snapshot).toMatchObject({ status: 'offered', totalBytes: MiB + 8, totalFiles: 3 });
    await until(() => send.snapshot.status === 'offered', 'the sender offered');
    const { sink, files } = sinksByFile();
    const received = recorded<DirectReceiveSnapshot>(receive);
    await receive.accept({ sink });
    const [r, s] = await Promise.all([receive.result, send.result]);
    // The receiver's progress, file by file, while it ran: the first file's first block, then the last file.
    expect(received.some((x) => x.status === 'transferring' && x.fileIndex === 0 && x.processedBytes === MiB && x.percent === 99)).toBe(true);
    expect(received.some((x) => x.status !== 'completed' && x.fileIndex === 2)).toBe(true);
    expect(r).toEqual({ status: 'completed', value: { assurance: 'saved', files: 3, totalBytes: MiB + 8, transport: { secure: true } }, transport: { secure: true } });
    expect(s).toEqual({ status: 'completed', value: { assurance: 'saved', files: 3, totalBytes: MiB + 8, transport: { secure: true } }, transport: { secure: true } });
    contents.forEach((bytes, i) => expect(sameAs((files.get(i)?.sink as MemorySink).bytes, bytes)).toBe('the same'));
    expect(send.snapshot).toMatchObject({ status: 'completed', text: 'The receiver has the files.', percent: 100, processedBytes: MiB + 8 });
    expect(receive.snapshot).toMatchObject({ status: 'completed', text: 'The files are saved.', percent: 100, processedBytes: MiB + 8 });
    expect(sending.operations.list()).toEqual([]);
    expect(receiving.operations.list()).toEqual([]);
    // Once it has ended, there's nothing to share.
    expect(send.share()).toEqual({ link: null, code: null });
  }, 60_000);

  it('by code: the snapshots run in order on both sides, and share() gives nothing once a receiver has accepted', async () => {
    const sending = clientOf(server);
    const receiving = clientOf(server);
    const bytes = patterned(3 * MiB, 4);
    const send = await sending.direct.send({ files: memoryFile('a.bin', bytes) });
    const sent = recorded<DirectSendSnapshot>(send);
    const receive = await receiving.direct.receive({ code: (send.share().code as string).toLowerCase().replace('-', ' ') });
    const received = recorded<DirectReceiveSnapshot>(receive);
    await receive.offer();
    expect(send.share().link).not.toBeNull();
    await receive.accept({ sink: new MemorySink() });
    // Once the sender has the acceptance, the transfer is that receiver's alone.
    await until(() => send.snapshot.status !== 'offered', 'the sender hearing the acceptance');
    expect(send.share()).toEqual({ link: null, code: null });
    expect(said(await receive.result)).toBe('completed, saved');
    expect(said(await send.result)).toBe('completed, saved');
    expect(statuses(sent)).toEqual(['waiting', 'connecting', 'offered', 'transferring', 'finalising', 'completed']);
    expect(statuses(received)).toEqual(['connecting', 'offered', 'transferring', 'finalising', 'completed']);
    // Only the last snapshot has the outcome's status.
    for (const seen of [sent, received]) expect(seen.filter((s) => s.status === 'completed')).toHaveLength(1);
    // The sender's progress is the receiver's, as each CREDIT tells it.
    expect(sent.some((s) => s.status === 'transferring' && s.processedBytes === MiB && s.percent === 33)).toBe(true);
    // Progress only rises, and every snapshot says how the server is reached.
    for (const seen of [sent, received]) {
      const bytesSeen = seen.map((s) => s.processedBytes);
      expect(bytesSeen).toEqual([...bytesSeen].sort((a, b) => a - b));
      for (const s of seen) expect(s.transport).toEqual({ secure: true });
    }
    expect(received.some((s) => s.status === 'transferring' && s.processedBytes === MiB && s.percent === 33)).toBe(true);
  }, 60_000);

  it('a wrong code fails that receive CODE_MISMATCH; the sender shows no code until the next one comes (share() null meanwhile), and the new code connects', async () => {
    const sending = clientOf(server);
    const send = await sending.direct.send({ files: memoryFile('a.bin', patterned(10, 5)) });
    const first = send.share().code as string;
    const codeStates: Array<{ state: string; shared: string | null }> = [];
    send.subscribe((s) => codeStates.push({ state: s.code, shared: send.share().code }));
    // The same locator, another password: the server finds the room, the code doesn't match.
    const wrong = `${first.slice(0, 2)}${first[2] === 'A' ? 'B' : 'A'}${first.slice(3)}`;
    const failed = await clientOf(server).direct.receive({ code: wrong });
    const outcome = await failed.result;
    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'CODE_MISMATCH', message: "That code didn't match. Ask the sender for the new one." } });
    await expect(failed.offer()).rejects.toMatchObject({ code: 'CODE_MISMATCH' });
    await until(() => send.snapshot.code === 'ready' && send.share().code !== first, 'a new code');
    expect(codeStates.some((c) => c.state === 'unavailable' && c.shared === null)).toBe(true);
    for (const c of codeStates) expect(c.state === 'ready').toBe(c.shared !== null);
    const receive = await clientOf(server).direct.receive({ code: send.share().code as string });
    await receive.accept({ sink: new MemorySink() });
    expect(`${said(await receive.result)} / ${said(await send.result)}`).toBe('completed, saved / completed, saved');
  }, 60_000);

  it('pause and resume through the handles: both paused, each saying who; the other side can\'t resume it; the deadline is the per-transfer pause limit over the client\'s', async () => {
    const sending = clientOf(server, { direct: { pauseLimitMs: 3_600_000 } });
    const receiving = clientOf(server);
    const bytes = patterned(20 * MiB + 3, 6);
    const send = await sending.direct.send({ files: memoryFile('held.bin', bytes), direct: { pauseLimitMs: 120_000 } });
    const receive = await receiving.direct.receive({ link: send.share().link as string });
    const sink = new MemorySink();
    await receive.accept({ sink });
    await until(() => receive.snapshot.canPause && sink.bytes.byteLength >= 2 * MiB, 'some of the file');
    expect(send.snapshot.canPause).toBe(true);
    const before = Date.now();
    await receive.pause();
    await until(() => send.snapshot.status === 'paused', 'the sender hearing the hold');
    expect(receive.snapshot).toMatchObject({ status: 'paused', pausedBy: 'self', text: 'You paused the transfer.' });
    expect(send.snapshot).toMatchObject({ status: 'paused', pausedBy: 'peer', text: 'The receiver paused the transfer.' });
    // The sender's own 2 minutes, not its client's hour; the receiver, with no limit, shows the same.
    for (const deadline of [send.snapshot.deadline, receive.snapshot.deadline]) {
      expect(deadline).toBeGreaterThanOrEqual(before + 120_000 - 1000);
      expect(deadline).toBeLessThanOrEqual(Date.now() + 120_000 + 1000);
    }
    await expect(send.resume()).rejects.toMatchObject({ code: 'PAUSE_UNAVAILABLE', transport: { secure: true } });
    await send.pause();
    await until(() => receive.snapshot.pausedBy === 'both', 'both holding');
    expect(send.snapshot).toMatchObject({ pausedBy: 'both', text: 'Paused by both of you.' });
    await receive.resume();
    await until(() => receive.snapshot.pausedBy === 'peer', 'the receiver letting go');
    expect(receive.snapshot.status).toBe('paused');
    await send.resume();
    expect(`${said(await receive.result)} / ${said(await send.result)}`).toBe('completed, saved / completed, saved');
    expect(sameAs(sink.bytes, bytes)).toBe('the same');
    await expect(receive.pause()).rejects.toMatchObject({ code: 'PAUSE_UNAVAILABLE' });
  }, 60_000);

  it("a client's pause limit applies when the transfer gives none", async () => {
    const sending = clientOf(server, { direct: { pauseLimitMs: 3_600_000 } });
    const send = await sending.direct.send({ files: memoryFile('held.bin', patterned(20 * MiB, 7)) });
    const receive = await clientOf(server).direct.receive({ link: send.share().link as string });
    const sink = new MemorySink();
    await receive.accept({ sink });
    await until(() => receive.snapshot.canPause && sink.bytes.byteLength >= MiB, 'some of the file');
    const before = Date.now();
    await send.pause();
    await until(() => receive.snapshot.status === 'paused', 'the receiver hearing the hold');
    expect(receive.snapshot.deadline).toBeGreaterThanOrEqual(before + 3_600_000 - 1000);
    expect(receive.snapshot.deadline).toBeLessThanOrEqual(Date.now() + 3_600_000 + 1000);
    // The sender's hold is the sender's to let go.
    await expect(receive.resume()).rejects.toMatchObject({ code: 'PAUSE_UNAVAILABLE' });
    expect(receive.snapshot.pausedBy).toBe('peer');
    send.cancel();
    expect(`${said(await receive.result)} / ${said(await send.result)}`).toBe('cancelled by peer / cancelled by self');
  }, 60_000);

  it('a cancel each way: the other side is cancelled by the peer, in its words, and the receiver\'s sink is aborted', async () => {
    for (const who of ['sender', 'receiver'] as const) {
      const send = await clientOf(server).direct.send({ files: memoryFile('a.bin', patterned(20 * MiB, 8)) });
      const receive = await clientOf(server).direct.receive({ link: send.share().link as string });
      const sink = new MemorySink();
      await receive.accept({ sink });
      await until(() => sink.writes >= 1, 'a write');
      (who === 'sender' ? send : receive).cancel();
      const [r, s] = await Promise.all([receive.result, send.result]);
      if (who === 'sender') {
        expect(`${said(r)} / ${said(s)}`).toBe('cancelled by peer / cancelled by self');
        expect(receive.snapshot.text).toBe('The sender cancelled the transfer.');
      } else {
        expect(`${said(r)} / ${said(s)}`).toBe('cancelled by self / cancelled by peer');
        expect(send.snapshot.text).toBe('The receiver cancelled the transfer.');
      }
      expect(r).toMatchObject({ cancellation: { source: 'direct.receive' } });
      expect(s).toMatchObject({ cancellation: { source: 'direct.send' } });
      expect(sink.aborted).toBeTruthy();
    }
  }, 60_000);

  it("client.direct.appClosing() each way mid-transfer: that side cancelled by itself, the other failed PEER_CLOSED in its words; it returns at once, and the client goes on", async () => {
    for (const who of ['sender', 'receiver'] as const) {
      const sending = clientOf(server);
      const receiving = clientOf(server);
      const send = await sending.direct.send({ files: memoryFile('a.bin', patterned(20 * MiB, 15)) });
      const receive = await receiving.direct.receive({ link: send.share().link as string });
      const sink = new MemorySink();
      await receive.accept({ sink });
      await until(() => sink.writes >= 1, 'a write');
      const closing = who === 'sender' ? sending : receiving;
      const sends = vi.spyOn(WebSocket.prototype, 'send');
      expect(closing.direct.appClosing()).toBeUndefined();
      // It returns before anything is done; the transfer ends in the microtask straight after the caller's code, and its
      // sealed CLOSE is on that side's rendezvous socket by then (a frame of 550 bytes, after the sender's 2-byte SEND
      // header or the receiver's 1-byte one), with no timer or other task in between: a closing page has no more.
      expect(sends).not.toHaveBeenCalled();
      await null;
      expect(sends.mock.calls.map(([data]) => (data as Uint8Array).byteLength)).toEqual([who === 'sender' ? 552 : 551]);
      sends.mockRestore();
      const [r, s] = await Promise.all([receive.result, send.result]);
      if (who === 'sender') {
        expect(`${said(r)} / ${said(s)}`).toBe('failed PEER_CLOSED / cancelled by self');
        expect(receive.snapshot.text).toBe('The sender closed Dropgate before the transfer finished.');
      } else {
        expect(`${said(r)} / ${said(s)}`).toBe('cancelled by self / failed PEER_CLOSED');
        expect(send.snapshot.text).toBe('The receiver closed Dropgate before the transfer finished.');
      }
      expect(sink.aborted).toBeTruthy();
      expect(closing.operations.list()).toEqual([]);
      // Nothing is left to close: a second call does nothing, and the client still sends.
      closing.direct.appClosing();
      const next = await closing.direct.send({ files: memoryFile('b.bin', patterned(10, 16)) });
      expect(next.snapshot.status).toBe('waiting');
      next.cancel();
      await next.result;
    }
  }, 60_000);

  it('client.direct.appClosing() ends every direct transfer the client runs, a send waiting and a receive still connecting among them, and nothing of another client', async () => {
    const client = clientOf(server);
    const other = clientOf(server);
    const waiting = await client.direct.send({ files: memoryFile('a.bin', patterned(10, 17)) });
    const othersSend = await other.direct.send({ files: memoryFile('a.bin', patterned(10, 18)) });
    class Stalled extends LoopbackPeerConnection {
      createOffer(): never { return new Promise(() => undefined) as never; }
    }
    const stalled = new DropgateClient({ server: server.baseUrl, RTCPeerConnection: Stalled as unknown as DirectPeerConnectionClass });
    const connecting = await stalled.direct.receive({ link: othersSend.share().link as string });
    const offered = await other.direct.send({ files: memoryFile('a.bin', patterned(10, 19)) });
    const receive = await client.direct.receive({ link: offered.share().link as string });
    await receive.offer();
    await until(() => othersSend.snapshot.status === 'connecting', 'the other send connecting the stalled attempt');

    client.direct.appClosing();
    stalled.direct.appClosing();
    const started = Date.now();
    expect(said(await waiting.result)).toBe('cancelled by self');
    expect(said(await receive.result)).toBe('cancelled by self');
    // Still connecting, the receive had nobody to tell: it's cancelled at once.
    expect(said(await connecting.result)).toBe('cancelled by self');
    expect(Date.now() - started).toBeLessThan(2000);
    // Neither receiver had accepted, so each send waits again for another: its link still works.
    await until(() => othersSend.snapshot.status === 'waiting' && offered.snapshot.status === 'waiting', 'the other sends waiting again', 3000);
    expect(other.operations.list().map((o) => o.kind)).toEqual(['direct.send', 'direct.send']);
    other.operations.cancelAll();
    await Promise.all([othersSend.result, offered.result]);
  }, 60_000);

  it('a send whose room is still opening when the app closes rejects OPERATION_CANCELLED', async () => {
    const client = clientOf(server);
    const opening = client.direct.send({ files: memoryFile('a.bin', patterned(10, 20)) });
    client.direct.appClosing();
    await expect(opening).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' });
    expect(client.operations.list()).toEqual([]);
  }, 30_000);

  it('a decline: the receiver cancelled by itself, the sender by the peer, declined; nothing is written', async () => {
    const send = await clientOf(server).direct.send({ files: memoryFile('a.bin', patterned(10, 9)) });
    const receive = await clientOf(server).direct.receive({ link: send.share().link as string });
    await receive.decline();
    const [r, s] = await Promise.all([receive.result, send.result]);
    expect(`${said(r)} / ${said(s)}`).toBe('cancelled by self / cancelled by peer, declined');
    expect(send.snapshot.text).toBe('The receiver declined the transfer.');
    await expect(receive.accept({ sink: new MemorySink() })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  }, 60_000);

  it('client.operations.cancelAll() cancels every direct handle, by its parent; a signal cancels by signal; a cancel while connecting ends at once', async () => {
    const client = clientOf(server);
    const send = await client.direct.send({ files: memoryFile('a.bin', patterned(10, 10)) });
    const receive = await client.direct.receive({ link: send.share().link as string });
    await receive.offer();
    expect(client.operations.list().map((o) => o.kind).sort()).toEqual(['direct.receive', 'direct.send']);
    client.operations.cancelAll();
    const [r, s] = await Promise.all([receive.result, send.result]);
    expect(r).toMatchObject({ status: 'cancelled', cancellation: { by: 'parent', source: 'client' } });
    expect(s).toMatchObject({ status: 'cancelled', cancellation: { by: 'parent', source: 'client' } });
    expect(client.operations.list()).toEqual([]);

    const controller = new AbortController();
    const signalled = await client.direct.send({ files: memoryFile('a.bin', patterned(10, 11)), signal: controller.signal });
    controller.abort();
    expect(await signalled.result).toMatchObject({ status: 'cancelled', cancellation: { by: 'signal', source: 'direct.send' } });

    // A receive cancelled before it has connected: no wait for the connection.
    const waiting = await client.direct.send({ files: memoryFile('a.bin', patterned(10, 12)) });
    const early = await client.direct.receive({ link: waiting.share().link as string });
    early.cancel();
    const started = Date.now();
    expect(await early.result).toMatchObject({ status: 'cancelled', cancellation: { by: 'self' } });
    expect(Date.now() - started).toBeLessThan(2000);
    await expect(early.offer()).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' });
    waiting.cancel();
    expect(said(await waiting.result)).toBe('cancelled by self');

    // A receive cancelled while its attempt is being set up (its peer connection never makes its offer): the attempt is
    // closed at once, so the sender, which was connecting it, is waiting again in a moment, not after the set-up's 90 s.
    class Stalled extends LoopbackPeerConnection {
      createOffer(): never { return new Promise(() => undefined) as never; }
    }
    const sender = await client.direct.send({ files: memoryFile('a.bin', patterned(10, 13)) });
    const stalled = new DropgateClient({ server: server.baseUrl, RTCPeerConnection: Stalled as unknown as DirectPeerConnectionClass });
    const midway = await stalled.direct.receive({ link: sender.share().link as string });
    await until(() => sender.snapshot.status === 'connecting', 'the sender connecting the attempt');
    midway.cancel();
    expect(await midway.result).toMatchObject({ status: 'cancelled', cancellation: { by: 'self' } });
    await until(() => sender.snapshot.status === 'waiting', 'the sender waiting again', 3000);
    sender.cancel();
    await sender.result;
  }, 60_000);

  it('accept() without a usable sink, a second answer, and any answer after the end are INVALID_ARGUMENT', async () => {
    const send = await clientOf(server).direct.send({ files: [memoryFile('a.bin', patterned(5, 13)), memoryFile('b.bin', patterned(5, 14))] });
    const receive = await clientOf(server).direct.receive({ link: send.share().link as string });
    await receive.offer();
    for (const bad of [undefined, {}, { sink: null }, { sink: { write() {} } }, { sink: () => new MemorySink(), asZip: true }, { sink: new MemorySink(), asZip: 'yes' }]) {
      await expect(receive.accept(bad as never), JSON.stringify(bad)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', transport: { secure: true } });
    }
    // Two files apart into one sink: refused, nothing sent, the offer still waiting.
    await expect(receive.accept({ sink: new MemorySink() })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(receive.snapshot.status).toBe('offered');
    const zip = new MemorySink();
    const sent = recorded<DirectSendSnapshot>(send);
    const accepting = receive.accept({ sink: zip, asZip: true });
    await expect(receive.accept({ sink: new MemorySink(), asZip: true })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(receive.decline()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await accepting;
    expect(`${said(await receive.result)} / ${said(await send.result)}`).toBe('completed, saved / completed, saved');
    // A ZIP's receiver counts every file done, the last too: the sender still never points past the last file.
    for (const s of sent) expect(s.fileIndex, s.status).toBeLessThan(2);
    await expect(receive.accept({ sink: new MemorySink(), asZip: true })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: 'This transfer has ended.' });
    await expect(receive.decline()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  }, 60_000);

  it('the first answer wins even when it comes before the offer: an accept() made while connecting, then a decline(), which is refused', async () => {
    const send = await clientOf(server).direct.send({ files: memoryFile('a.bin', patterned(10, 16)) });
    const receive = await clientOf(server).direct.receive({ link: send.share().link as string });
    const sink = new MemorySink();
    const accepting = receive.accept({ sink });
    await expect(receive.decline()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: 'The offer has already been accepted or declined.' });
    await accepting;
    expect(`${said(await receive.result)} / ${said(await send.result)}`).toBe('completed, saved / completed, saved');
    expect(sink.closed).toBe(true);
  }, 60_000);

  it('an empty file: both complete at 100%; with code: false a send has no code on a server that gives them', async () => {
    const send = await clientOf(server).direct.send({ files: memoryFile('empty.txt', new Uint8Array(0)), code: false });
    expect(send.snapshot.code).toBe('off');
    expect(send.share().code).toBeNull();
    expect(send.share().link).not.toBeNull();
    const receive = await clientOf(server).direct.receive({ link: send.share().link as string });
    await receive.accept({ sink: new MemorySink() });
    expect(`${said(await receive.result)} / ${said(await send.result)}`).toBe('completed, saved / completed, saved');
    for (const s of [send.snapshot, receive.snapshot]) expect(s).toMatchObject({ percent: 100, processedBytes: 0, totalBytes: 0 });
  }, 60_000);

  it('a send cancelled while its transfer is being opened rejects OPERATION_CANCELLED, and its socket to the server is closed once it opens', async () => {
    const controller = new AbortController();
    const sockets: WebSocket[] = [];
    const Base = globalThis.WebSocket;
    vi.stubGlobal('WebSocket', class extends Base {
      constructor(url: string) {
        super(url);
        sockets.push(this);
        // Cancelled as the room is being opened, before the server has answered.
        controller.abort();
      }
    });
    try {
      const client = clientOf(server);
      await expect(client.direct.send({ files: memoryFile('a.bin', patterned(10, 17)), signal: controller.signal }))
        .rejects.toMatchObject({ code: 'OPERATION_CANCELLED', transport: { secure: true } });
      expect(sockets).toHaveLength(1);
      await until(() => sockets[0].readyState === 3, 'the socket closed');
      expect(client.operations.list()).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  }, 30_000);

  it('a hand-off sink makes both results handed-off, in each side\'s words', async () => {
    const send = await clientOf(server).direct.send({ files: memoryFile('a.bin', patterned(10, 15)) });
    const receive = await clientOf(server).direct.receive({ link: send.share().link as string });
    await receive.accept({ sink: new MemorySink(), handOff: true });
    expect(`${said(await receive.result)} / ${said(await send.result)}`).toBe('completed, handed-off / completed, handed-off');
    expect(receive.snapshot.text).toBe('Handed to your browser. Check your downloads.');
    expect(send.snapshot.text).toBe("Delivered to the receiver's browser.");
  }, 60_000);

  it("a link from another server, or one that isn't a direct link, is refused before anything is sent; so is a code that isn't one", async () => {
    const client = clientOf(server);
    const port = Number(new URL(server.baseUrl).port);
    const secret = Buffer.alloc(32, 7).toString('base64url');
    for (const link of [
      `http://127.0.0.1:${port + 1}/p2p#${secret}`, `https://other.example/p2p#${secret}`,
    ]) {
      await expect(client.direct.receive({ link })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: 'URL must be from this server.' });
    }
    for (const link of [
      `${server.baseUrl}/p2p`, `${server.baseUrl}/p2p#${secret.slice(1)}`, `${server.baseUrl}/p2p#${secret}A`, `${server.baseUrl}/p2p/#${secret}`,
      `${server.baseUrl}/p2p?x=1#${secret}`, `${server.baseUrl}/p2p/ABCD-1234`, 'not a link', `ftp://127.0.0.1:${port}/p2p#${secret}`,
    ]) {
      const refused = await client.direct.receive({ link }).then(() => undefined, (err: unknown) => err);
      expect(refused, link).toMatchObject({ code: 'INVALID_ARGUMENT' });
      // Never quoted back: a link holds its secret.
      expect(String((refused as Error).message)).not.toContain(secret);
    }
    await expect(client.direct.receive({ code: 'ABCI-1234' })).rejects.toMatchObject({ code: 'INVALID_CODE' });
    await expect(client.direct.receive({} as never)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(client.direct.receive({ link: `${server.baseUrl}/p2p#${secret}`, code: 'ABCD-1234' } as never)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(client.operations.list()).toEqual([]);
  });
});

describe('the direct option and the runtime', () => {
  it('each setting is checked where it is given: the client, a send or a receive; anything outside its range is INVALID_ARGUMENT', async () => {
    const bad = [
      { pauseLimitMs: 59_000 }, { pauseLimitMs: 604_801_000 }, { pauseLimitMs: 90_500 }, { pauseLimitMs: '60000' }, { pauseLimitMs: 0 },
      { pauseLimitMs: Number.NaN }, { reconnectWindowMs: 9_000 }, { reconnectWindowMs: 3_601_000 }, { reconnectWindowMs: null },
      { reconnectWindowMs: 10_000.5 }, { stun: 'no' }, { stun: null }, { pauselimitMs: 60_000 }, null, 'none', [],
    ];
    for (const direct of bad) {
      expect(() => new DropgateClient({ server: 'https://files.example', direct: direct as never }), JSON.stringify(direct))
        .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT', transport: { secure: true } }));
    }
    const client = new DropgateClient({ server: 'https://files.example', RTCPeerConnection: Peer, fetchFn: async () => { throw new Error('No request should be made.'); } });
    for (const direct of bad) {
      await expect(client.direct.send({ files: memoryFile('a.bin', patterned(1, 1)), direct: direct as never }), JSON.stringify(direct))
        .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(client.direct.receive({ code: 'ABCD-1234', direct: direct as never }), JSON.stringify(direct))
        .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    for (const good of [
      { pauseLimitMs: null }, { pauseLimitMs: 60_000 }, { pauseLimitMs: 604_800_000 }, { reconnectWindowMs: 10_000 }, { reconnectWindowMs: 3_600_000 },
      { stun: false }, {},
    ]) {
      expect(() => new DropgateClient({ server: 'https://files.example', direct: good })).not.toThrow();
    }
    expect(() => new DropgateClient({ server: 'https://files.example', RTCPeerConnection: 'werift' as never }))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('no files, or a code that isn\'t true or false, is INVALID_ARGUMENT before any request', async () => {
    let requests = 0;
    const client = new DropgateClient({ server: 'https://files.example', RTCPeerConnection: Peer, fetchFn: async () => { requests++; throw new Error('none'); } });
    await expect(client.direct.send({ files: [] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: 'At least one file is required.' });
    await expect(client.direct.send({ files: memoryFile('a.bin', patterned(1, 1)), code: 'yes' as never })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(client.direct.send({ files: [undefined] as never })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(requests).toBe(0);
  });

  it('a server with direct transfers off is CAPABILITY_UNSUPPORTED, and one whose codeLetters can\'t be is INVALID_RESPONSE, with nothing opened', async () => {
    const serverSaying = (p2p: Record<string, unknown>) => async () => new Response(JSON.stringify({
      version: '4.0.0', protocols: { dgup: { major: 4, minor: 0 }, dgdtp: { major: 4, minor: 0 } }, capabilities: { p2p },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    let sockets = 0;
    const Base = globalThis.WebSocket;
    vi.stubGlobal('WebSocket', class extends Base { constructor(url: string) { super(url); sockets++; } });
    try {
      const off = new DropgateClient({ server: 'https://files.example', RTCPeerConnection: Peer, fetchFn: serverSaying({ enabled: false }) });
      await expect(off.direct.send({ files: memoryFile('a.bin', patterned(1, 1)) })).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' });
      expect(await (await off.direct.receive({ code: 'ABCD-1234' })).result).toMatchObject({ status: 'failed', error: { code: 'CAPABILITY_UNSUPPORTED' } });
      for (const codeLetters of [4, 1, '2', undefined]) {
        const odd = new DropgateClient({ server: 'https://files.example', RTCPeerConnection: Peer, fetchFn: serverSaying({ enabled: true, iceServers: [], codeLetters }) });
        await expect(odd.direct.send({ files: memoryFile('a.bin', patterned(1, 1)) }), String(codeLetters)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
        expect(await (await odd.direct.receive({ code: 'ABCD-1234' })).result, String(codeLetters)).toMatchObject({ status: 'failed', error: { code: 'INVALID_RESPONSE' } });
      }
      expect(sockets).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a transfer\'s settings win over the client\'s, one by one, and travel in the hello in whole seconds', () => {
    const client = directSettings({ pauseLimitMs: 3_600_000, stun: false }, DEFAULT_DIRECT_SETTINGS);
    expect(client).toEqual({ pauseLimitMs: 3_600_000, reconnectWindowMs: 120_000, stun: false });
    const transfer = directSettings({ reconnectWindowMs: 30_000, pauseLimitMs: null }, client);
    expect(transfer).toEqual({ pauseLimitMs: null, reconnectWindowMs: 30_000, stun: false });
    expect(helloOf(transfer)).toEqual({ pauseLimitSeconds: 0, reconnectWindowSeconds: 30 });
    expect(helloOf(client)).toEqual({ pauseLimitSeconds: 3600, reconnectWindowSeconds: 120 });
    expect(helloOf(DEFAULT_DIRECT_SETTINGS)).toEqual({ pauseLimitSeconds: 0, reconnectWindowSeconds: 120 });
    expect(helloOf(directSettings({ pauseLimitMs: 604_800_000, reconnectWindowMs: 3_600_000 }, DEFAULT_DIRECT_SETTINGS)))
      .toEqual({ pauseLimitSeconds: 604_800, reconnectWindowSeconds: 3600 });
  });

  it('with no RTCPeerConnection given and none global, a direct call is RUNTIME_UNSUPPORTED before anything is sent', async () => {
    expect((globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection).toBeUndefined();
    let requests = 0;
    const client = new DropgateClient({ server: 'https://files.example', fetchFn: async () => { requests++; throw new Error('none'); } });
    await expect(client.direct.send({ files: memoryFile('a.bin', patterned(1, 1)) })).rejects.toMatchObject({ code: 'RUNTIME_UNSUPPORTED', transport: { secure: true } });
    await expect(client.direct.receive({ code: 'ABCD-1234' })).rejects.toMatchObject({ code: 'RUNTIME_UNSUPPORTED' });
    expect(requests).toBe(0);
  });

  it('with no WebSocket here, a direct call is RUNTIME_UNSUPPORTED', async () => {
    vi.stubGlobal('WebSocket', undefined);
    try {
      const client = new DropgateClient({ server: 'https://files.example', RTCPeerConnection: Peer, fetchFn: async () => { throw new Error('none'); } });
      await expect(client.direct.send({ files: memoryFile('a.bin', patterned(1, 1)) })).rejects.toMatchObject({ code: 'RUNTIME_UNSUPPORTED' });
      await expect(client.direct.receive({ code: 'ABCD-1234' })).rejects.toMatchObject({ code: 'RUNTIME_UNSUPPORTED' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('STUN: the server\'s servers by default, none with "no STUN"', () => {
  let server: Server;
  /** Each peer connection's configuration, as core gave it; werift is then given none (nothing listens there). */
  const configs: Array<{ iceServers: unknown[] }> = [];
  class Recording extends LoopbackPeerConnection {
    constructor(config: { iceServers: unknown[] }) {
      configs.push(structuredClone(config));
      super({ ...config, iceServers: [] });
    }
  }

  beforeAll(async () => {
    server = (await startServer({ env: { RATE_LIMIT_MAX_REQUESTS: '0', P2P_STUN_SERVERS: 'stun:127.0.0.1:3478' } })) as Server;
  }, 30_000);
  afterAll(async () => { await server?.stop(); });
  afterEach(() => { configs.length = 0; });

  it("the client's setting, then each transfer's over it: the peer connection gets the server's STUN server, or no ICE servers at all", async () => {
    const offered = [{ urls: ['stun:127.0.0.1:3478'] }];
    const run = async (sender: DropgateClient, receiver: DropgateClient, overrides: { send?: boolean; receive?: boolean }) => {
      configs.length = 0;
      const send = await sender.direct.send({ files: memoryFile('a.bin', patterned(10, 1)), ...(overrides.send !== undefined ? { direct: { stun: overrides.send } } : {}) });
      const receive = await receiver.direct.receive({ link: send.share().link as string, ...(overrides.receive !== undefined ? { direct: { stun: overrides.receive } } : {}) });
      await receive.accept({ sink: new MemorySink() });
      expect(`${said(await receive.result)} / ${said(await send.result)}`).toBe('completed, saved / completed, saved');
      // The receiver's peer connection is made first (it joins), then the sender's for that attempt.
      return configs.map((c) => c.iceServers);
    };
    const on = new DropgateClient({ server: server.baseUrl, RTCPeerConnection: Recording as unknown as DirectPeerConnectionClass });
    const off = new DropgateClient({ server: server.baseUrl, RTCPeerConnection: Recording as unknown as DirectPeerConnectionClass, direct: { stun: false } });
    expect(await run(on, on, {})).toEqual([offered, offered]);
    expect(await run(off, off, {})).toEqual([[], []]);
    expect(await run(on, on, { send: false, receive: false })).toEqual([[], []]);
    expect(await run(off, off, { send: true, receive: true })).toEqual([offered, offered]);
    expect(await run(on, off, {})).toEqual([[], offered]);
  }, 60_000);

  it("only STUN servers are taken from what the server lists, with no username or credential: a TURN relay, and anything that isn't an address, is left out", async () => {
    /** The real server, but with its `/api/info` listing `iceServers` instead of its own. */
    const listing = (iceServers: unknown) => async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await fetch(input, init);
      if (new URL(String(input)).pathname !== '/api/info') return res;
      const info = await res.json();
      info.capabilities.p2p.iceServers = iceServers;
      return new Response(JSON.stringify(info), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const transferListing = async (iceServers: unknown) => {
      configs.length = 0;
      const client = new DropgateClient({ server: server.baseUrl, RTCPeerConnection: Recording as unknown as DirectPeerConnectionClass, fetchFn: listing(iceServers) });
      const send = await client.direct.send({ files: memoryFile('a.bin', patterned(10, 1)) });
      const receive = await client.direct.receive({ link: send.share().link as string });
      await receive.accept({ sink: new MemorySink() });
      expect(`${said(await receive.result)} / ${said(await send.result)}`).toBe('completed, saved / completed, saved');
      return configs.map((c) => c.iceServers);
    };
    const relay = { username: 'someone', credential: 'their password' };
    const kept = [{ urls: ['stun:127.0.0.1:3478'] }, { urls: ['STUNS:127.0.0.1:5349'] }];
    expect(await transferListing([
      { urls: ['turn:relay.example:443?transport=tcp', 'stun:127.0.0.1:3478'], ...relay },
      { urls: 'turns:relay.example:5349', ...relay },
      { urls: 'STUNS:127.0.0.1:5349', ...relay },
      { urls: [42, null, 'http://127.0.0.1/', ' stun:127.0.0.1'] },
      'stun:127.0.0.1:3478',
      null,
    ])).toEqual([kept, kept]);
    // A list of relays alone leaves no STUN server at all, as does one that isn't a list.
    expect(await transferListing([{ urls: ['turn:relay.example:3478'], ...relay }])).toEqual([[], []]);
    expect(await transferListing({ urls: 'stun:127.0.0.1:3478' })).toEqual([[], []]);
  }, 60_000);
});

describe("a direct send's credential", () => {
  let server: Server;
  beforeAll(async () => {
    server = (await startServer({ env: { RATE_LIMIT_MAX_REQUESTS: '0', P2P_STUN_SERVERS: 'none' } })) as Server;
  }, 30_000);
  afterAll(async () => { await server?.stop(); });

  /** The server's own answers, but saying a direct send needs a credential when `required`. */
  const fetchSaying = (required: boolean) => async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await fetch(input, init);
    if (new URL(String(input)).pathname !== '/api/info') return res;
    const info = await res.json() as { capabilities: { p2p: Record<string, unknown> } };
    info.capabilities.p2p.credentialRequired = required;
    return new Response(JSON.stringify(info), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  it('is asked only when the server says a send needs one, for direct.send, and goes in the message that opens the transfer and nowhere else; receiving never asks', async () => {
    const sent: Uint8Array[] = [];
    const Base = globalThis.WebSocket;
    vi.stubGlobal('WebSocket', class extends Base {
      send(data: Uint8Array): void {
        sent.push(new Uint8Array(data));
        super.send(data);
      }
    });
    try {
      const token = 'direct-send-token.ABC~123';
      const asked: Array<{ operation: string; reason: string; baseUrl: string }> = [];
      const auth = ({ operation, reason, baseUrl }: { operation: string; reason: string; baseUrl: string }) => {
        asked.push({ operation, reason, baseUrl });
        return { token };
      };
      const sender = new DropgateClient({ server: server.baseUrl, RTCPeerConnection: Peer, auth, fetchFn: fetchSaying(true) });
      const receiver = new DropgateClient({ server: server.baseUrl, RTCPeerConnection: Peer, auth, fetchFn: fetchSaying(true) });
      const send = await sender.direct.send({ files: memoryFile('a.bin', patterned(10, 1)) });
      const receive = await receiver.direct.receive({ link: send.share().link as string });
      await receive.accept({ sink: new MemorySink() });
      expect(`${said(await receive.result)} / ${said(await send.result)}`).toBe('completed, saved / completed, saved');
      expect(asked).toEqual([{ operation: 'direct.send', reason: 'required', baseUrl: server.baseUrl }]);
      const bytes = new TextEncoder().encode(token);
      const holding = sent.filter((m) => Buffer.from(m).includes(Buffer.from(bytes)));
      expect(holding).toHaveLength(1);
      // CREATE, the first message the sender's socket sent.
      expect(holding[0][0]).toBe(sent[0][0]);
      expect(Buffer.from(sent[0]).includes(Buffer.from(bytes))).toBe(true);
      for (const [label, value] of [['snapshots', JSON.stringify([send.snapshot, receive.snapshot])], ['client', inspect(sender, { depth: 5 })]] as const) {
        expect(value, label).not.toContain(token);
      }

      // With no provider, a server that asks refuses the send before anything is sent.
      const before = sent.length;
      const none = new DropgateClient({ server: server.baseUrl, RTCPeerConnection: Peer, fetchFn: fetchSaying(true) });
      await expect(none.direct.send({ files: memoryFile('a.bin', patterned(10, 1)) })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
      expect(sent.length).toBe(before);

      // A server that doesn't ask is never asked for one, and is sent none.
      asked.length = 0;
      const unasked = new DropgateClient({ server: server.baseUrl, RTCPeerConnection: Peer, auth, fetchFn: fetchSaying(false) });
      const plain = await unasked.direct.send({ files: memoryFile('a.bin', patterned(10, 1)) });
      plain.cancel();
      await plain.result;
      expect(asked).toEqual([]);
      expect(sent.slice(before).filter((m) => Buffer.from(m).includes(Buffer.from(bytes)))).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  }, 60_000);
});

describe('tries by code, through the real server: each network has at most 5 that prove wrong in 10 minutes', () => {
  /** More certificates for this test's peer connections, past the 12 each test is given. */
  const morePeers = async (count: number) => {
    certificates.push(...await Promise.all(Array.from({ length: count }, newCertificate)));
  };

  it('receiving by the right code is never held back, however often one device does it: a right code is no wrong try', async () => {
    const server = (await startServer({ env: { RATE_LIMIT_MAX_REQUESTS: '0', P2P_STUN_SERVERS: 'none' } })) as Server;
    try {
      await morePeers(4);
      for (let n = 1; n <= 7; n++) {
        const send = await clientOf(server).direct.send({ files: memoryFile('a.bin', patterned(100, n)) });
        const receive = await clientOf(server).direct.receive({ code: send.share().code as string });
        await receive.accept({ sink: new MemorySink() });
        expect(`${n}: ${said(await receive.result)} / ${said(await send.result)}`).toBe(`${n}: completed, saved / completed, saved`);
      }
    } finally {
      await server.stop();
    }
  }, 120_000);

  it("after 5 wrong codes from one network, a sixth receive by code is told to wait, in its words, before it reaches the sender, whose code is left as it was", async () => {
    const server = (await startServer({ env: { RATE_LIMIT_MAX_REQUESTS: '0', P2P_STUN_SERVERS: 'none' } })) as Server;
    try {
      await morePeers(8);
      const send = await clientOf(server).direct.send({ files: memoryFile('a.bin', patterned(10, 6)) });
      for (let n = 1; n <= 5; n++) {
        await until(() => send.snapshot.code === 'ready' && send.share().code !== null, `code ${n}`);
        const code = send.share().code as string;
        const wrong = `${code.slice(0, 2)}${code[2] === 'A' ? 'B' : 'A'}${code.slice(3)}`;
        const failed = await clientOf(server).direct.receive({ code: wrong });
        expect(`${n}: ${said(await failed.result)}`).toBe(`${n}: failed CODE_MISMATCH`);
        await until(() => send.snapshot.code === 'ready' && send.share().code !== code, `a new code after try ${n}`);
      }
      const right = send.share().code as string;
      const refused = await clientOf(server).direct.receive({ code: right });
      // Ended before anything is offered, or, were it let through, offered the files.
      const outcome = await Promise.race([refused.result, refused.offer().then(() => 'offered', () => refused.result)]);
      expect(outcome).toMatchObject({
        status: 'failed',
        error: { code: 'RATE_LIMITED', origin: 'server', message: 'Too many codes have been tried from this network. Wait a few minutes, then try again.' },
      });
      // The sender never heard of it: the same code, still unused, and nothing under way.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(send.share().code).toBe(right);
      expect(send.snapshot).toMatchObject({ status: 'waiting', code: 'ready' });
      send.cancel();
      await send.result;
    } finally {
      await server.stop();
    }
  }, 120_000);
});

describe('on a server set for 3 locator letters, and on one with codes off', () => {
  it('3 letters: a code made and typed with no other change', async () => {
    const server = (await startServer({ env: { RATE_LIMIT_MAX_REQUESTS: '0', P2P_STUN_SERVERS: 'none', P2P_LOCATOR_LETTERS: '3' } })) as Server;
    try {
      const send = await clientOf(server).direct.send({ files: memoryFile('a.bin', patterned(1000, 1)) });
      const code = send.share().code as string;
      expect(code).toMatch(/^[A-HJ-NP-Z]{4}-\d{4}$/);
      const receive = await clientOf(server).direct.receive({ code });
      await receive.accept({ sink: new MemorySink() });
      expect(`${said(await receive.result)} / ${said(await send.result)}`).toBe('completed, saved / completed, saved');
    } finally {
      await server.stop();
    }
  }, 60_000);

  it('codes off: a send has its code off and its link works; a receive by code is CAPABILITY_UNSUPPORTED', async () => {
    const server = (await startServer({ env: { RATE_LIMIT_MAX_REQUESTS: '0', P2P_STUN_SERVERS: 'none', P2P_MAX_CODES_PER_IP: '0' } })) as Server;
    try {
      const send = await clientOf(server).direct.send({ files: memoryFile('a.bin', patterned(10, 1)) });
      expect(send.snapshot.code).toBe('off');
      expect(send.share().code).toBeNull();
      const byCode = await clientOf(server).direct.receive({ code: 'ABCD-1234' });
      expect(await byCode.result).toMatchObject({ status: 'failed', error: { code: 'CAPABILITY_UNSUPPORTED' } });
      const receive = await clientOf(server).direct.receive({ link: send.share().link as string });
      await receive.accept({ sink: new MemorySink() });
      expect(`${said(await receive.result)} / ${said(await send.result)}`).toBe('completed, saved / completed, saved');
      // Asked for no code: off on any server.
      const linkOnly = await clientOf(server).direct.send({ files: memoryFile('a.bin', patterned(10, 1)), code: false });
      expect(linkOnly.snapshot.code).toBe('off');
      linkOnly.cancel();
      await linkOnly.result;
    } finally {
      await server.stop();
    }
  }, 60_000);
});

describe('links.resolve() for direct links', () => {
  let server: Server;
  beforeAll(async () => {
    server = (await startServer({ env: { RATE_LIMIT_MAX_REQUESTS: '0', P2P_STUN_SERVERS: 'none' } })) as Server;
  }, 30_000);
  afterAll(async () => { await server?.stop(); });

  it('a direct link opens its receive page with the secret after the #, and a typed code with the code after it; another server\'s is refused; an older link keeps its path', async () => {
    const client = new DropgateClient({ server: server.baseUrl });
    const secret = Buffer.alloc(32, 9).toString('base64url');
    expect(await client.links.resolve(` ${server.baseUrl}/p2p#${secret} `)).toEqual({ valid: true, type: 'p2p', target: `/p2p#${secret}`, transport: { secure: true } });
    expect(await client.links.resolve(`https://other.example/p2p#${secret}`)).toMatchObject({ valid: false, reason: 'URL must be from this server.' });
    for (const bad of [`${server.baseUrl}/p2p#${secret.slice(2)}`, `${server.baseUrl}/p2p`, `${server.baseUrl}/p2p?a=1#${secret}`]) {
      expect(await client.links.resolve(bad), bad).toMatchObject({ valid: false, reason: 'Unrecognised sharing link.' });
    }
    // A typed code, however it's typed, opens the receive page with the code after the #.
    for (const typed of ['abcd-1234', 'ABCD1234', ' abcd 1234 ', 'AbCd-1234']) {
      expect(await client.links.resolve(typed), typed).toMatchObject({ valid: true, type: 'p2p', target: '/p2p#ABCD-1234' });
    }
    // I and O are never in a code.
    for (const typed of ['ABCI-1234', 'OBCD-1234', 'ABCD-123', 'ABCD-12345']) {
      expect(await client.links.resolve(typed), typed).toMatchObject({ valid: false, reason: 'Unrecognised sharing code.' });
    }
    expect(await client.links.resolve(`${server.baseUrl}/p2p/ABCD-1234`)).toMatchObject({ valid: true, type: 'p2p', target: '/p2p/ABCD-1234' });
  });
});

describe("Dropgate 3's direct transfers: none of its codes, links or calls works", () => {
  let server: Server;
  beforeAll(async () => {
    server = (await startServer({ env: { RATE_LIMIT_MAX_REQUESTS: '0', P2P_STUN_SERVERS: 'none' }, requests: true })) as Server;
  }, 30_000);
  afterAll(async () => { await server?.stop(); });

  it("a call made Dropgate 3's way, passing a Peer class, is refused INVALID_ARGUMENT, saying what changed, with nothing made or sent", async () => {
    const made: unknown[] = [];
    class V3Peer {
      constructor(...args: unknown[]) {
        made.push(args);
      }
    }
    const client = clientOf(server);
    const before = server.requests().length;
    const words = "Dropgate 4's direct transfers take no Peer option: use the handle that send() or receive() gives.";
    for (const call of [
      () => client.direct.send({ file: memoryFile('a.bin', patterned(3, 1)), Peer: V3Peer, onCode: () => {} } as never),
      () => client.direct.send({ files: memoryFile('a.bin', patterned(3, 1)), Peer: V3Peer } as never),
      () => client.direct.receive({ code: 'ABCD-1234', Peer: V3Peer, onMeta: () => {} } as never),
      () => client.direct.receive({ code: 'ABCD-1234', Peer: undefined } as never),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: words, transport: { secure: true } });
    }
    expect(made, 'Peer made').toEqual([]);
    expect(client.operations.list()).toEqual([]);
    expect(server.requests().slice(before), 'what reached the server').toEqual([]);
  });

  it("a Dropgate 3 sender's code finds nothing: Dropgate 4's rendezvous knows only its own, so the receive fails NOT_FOUND", async () => {
    // A Dropgate 3 code has the same look as a Dropgate 4 one: four letters, four digits.
    const receive = await clientOf(server).direct.receive({ code: 'WXYZ-4821' });
    const outcome = await receive.result;
    expect(outcome.status === 'failed' && [outcome.error.code, outcome.error.message])
      .toEqual(['NOT_FOUND', 'No transfer has that code or link. It may have ended, or the code was used.']);
  });

  it("a Dropgate 3 sender's link (/p2p/<code>) isn't a direct link: receive() refuses it before anything is sent, and links.resolve() gives the older-version page's path", async () => {
    const client = clientOf(server);
    const before = server.requests().length;
    for (const link of [`${server.baseUrl}/p2p/WXYZ-4821`, `${server.baseUrl}/p2p/WXYZ-4821#key`]) {
      await expect(client.direct.receive({ link }), link).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    expect(server.requests().slice(before), 'what reached the server').toEqual([]);
    expect(await client.links.resolve(`${server.baseUrl}/p2p/WXYZ-4821`)).toMatchObject({ valid: true, type: 'p2p', target: '/p2p/WXYZ-4821' });
  });
});

describe('nothing of the link, the code or a name leaves the handles, and none reaches the server but the locator', () => {
  let server: Server;
  beforeAll(async () => {
    server = (await startServer({ env: { RATE_LIMIT_MAX_REQUESTS: '0', P2P_STUN_SERVERS: 'none', LOG_LEVEL: 'DEBUG' }, requests: true })) as Server;
  }, 30_000);
  afterAll(async () => { await server?.stop(); });

  it('every snapshot, outcome and error (as String, stack, JSON and inspect), every server log line and request, and every WebSocket message', async () => {
    const sent: Uint8Array[] = [];
    const Base = globalThis.WebSocket;
    vi.stubGlobal('WebSocket', class extends Base {
      send(data: Uint8Array): void {
        sent.push(new Uint8Array(data));
        super.send(data);
      }
    });
    const seen: unknown[] = [];
    const errors: unknown[] = [];
    const secrets: string[] = [];
    const names = ['quarterly-report-final.pdf', 'holiday photo 07.jpg'];
    const watch = <S>(handle: { snapshot: S; subscribe(l: (s: S) => void): () => void; result: Promise<unknown> }) => {
      seen.push(handle.snapshot);
      handle.subscribe((s) => seen.push(s));
      void handle.result.then((o) => {
        seen.push(o);
        if ((o as { error?: unknown }).error) errors.push((o as { error: unknown }).error);
      });
    };
    const keep = (link: string | null, code: string | null) => {
      if (link) {
        const secret = link.split('#')[1];
        secrets.push(link, secret, Buffer.from(secret, 'base64url').toString('hex'), Buffer.from(secret, 'base64url').toString('base64'));
      }
      if (code) secrets.push(code, code.replace('-', ''), code.slice(2).replace('-', ''), code.slice(3).replace('-', ''));
    };
    try {
      const files = () => names.map((name, i) => memoryFile(name, patterned(MiB + i, i)));
      // A transfer by code that completes, after a wrong code; one by link that's paused, then cancelled; one declined.
      const send = await clientOf(server).direct.send({ files: files() });
      watch(send);
      keep(send.share().link, send.share().code);
      const first = send.share().code as string;
      const wrong = await clientOf(server).direct.receive({ code: `${first.slice(0, 2)}${first[2] === 'A' ? 'B' : 'A'}${first.slice(3)}` });
      watch(wrong);
      await wrong.result;
      await until(() => send.snapshot.code === 'ready' && send.share().code !== first, 'a new code');
      keep(send.share().link, send.share().code);
      const receive = await clientOf(server).direct.receive({ code: send.share().code as string });
      watch(receive);
      await receive.accept({ sink: new MemorySink(), asZip: true });
      await Promise.all([send.result, receive.result]);

      const held = await clientOf(server).direct.send({ files: memoryFile(names[0], patterned(20 * MiB, 3)) });
      watch(held);
      keep(held.share().link, held.share().code);
      const holding = await clientOf(server).direct.receive({ link: held.share().link as string });
      watch(holding);
      const sink = new MemorySink();
      await holding.accept({ sink });
      await until(() => holding.snapshot.canPause && sink.writes >= 1, 'a write');
      await holding.pause();
      await until(() => held.snapshot.status === 'paused', 'the hold heard');
      await held.resume().catch((err: unknown) => errors.push(err));
      held.cancel();
      await Promise.all([held.result, holding.result]);

      const declined = await clientOf(server).direct.send({ files: files() });
      watch(declined);
      keep(declined.share().link, declined.share().code);
      const declining = await clientOf(server).direct.receive({ link: declined.share().link as string });
      watch(declining);
      await declining.offer();
      await declining.decline();
      await declining.accept({ sink: new MemorySink() }).catch((err: unknown) => errors.push(err));
      await Promise.all([declined.result, declining.result]);
      await clientOf(server).direct.receive({ link: `${declined.share().link ?? `${server.baseUrl}/p2p#${'A'.repeat(43)}`}x` }).catch((err: unknown) => errors.push(err));
      // Let the server write its last log lines.
      await new Promise((resolve) => setTimeout(resolve, 300));
    } finally {
      vi.unstubAllGlobals();
    }
    expect(errors.length).toBeGreaterThanOrEqual(4);
    expect(secrets.length).toBeGreaterThan(10);
    const texts: Array<[string, string]> = [
      ['snapshots and outcomes', JSON.stringify(seen) + inspect(seen, { depth: 10 })],
      ...errors.map((err, i): [string, string] => [`error ${i}`, `${String(err)}\n${(err as Error).stack}\n${JSON.stringify(err)}\n${inspect(err, { depth: 10 })}`]),
      ['server log', server.output.stdout + server.output.stderr],
      ['requests', JSON.stringify(server.requests())],
    ];
    for (const [label, text] of texts) {
      for (const secret of [...secrets, ...names]) expect(text.includes(secret), `${label} holds ${secret.length > 12 ? 'a secret or name' : secret}`).toBe(false);
    }
    expect(server.output.stdout).toContain('DEBUG');
    for (const message of sent) {
      const bytes = Buffer.from(message);
      for (const secret of [...secrets, ...names]) expect(bytes.includes(Buffer.from(secret)), 'a WebSocket message').toBe(false);
    }
    for (const err of errors) expect(err).toBeInstanceOf(DropgateError);
    // Every snapshot is one of the handle's, with the fields it promises.
    for (const s of seen.filter((x): x is DirectSendSnapshot => typeof (x as { status?: unknown }).status === 'string' && 'canPause' in (x as object))) {
      expect(Object.keys(s).sort()).toEqual(expect.arrayContaining(['canPause', 'deadline', 'fileIndex', 'pausedBy', 'percent', 'processedBytes', 'stalled', 'status', 'text', 'totalBytes', 'totalFiles', 'transport']));
    }
  }, 90_000);
});

// A type check: the handles' extra methods are on their types.
export function typesHold(send: DirectSendHandle, receive: DirectReceiveHandle): void {
  void send.share().link;
  void receive.offer();
}
