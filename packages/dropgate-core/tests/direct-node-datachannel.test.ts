import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { RTCPeerConnection } from 'node-datachannel/polyfill';
import { DropgateClient } from '../src/index.js';
import type { DirectPeerConnectionClass } from '../src/index.js';
import { MemorySink, memoryFile, patterned, sameAs } from './helpers/direct.js';
// The server suite's own harness: the real server.js, in a throwaway folder, on a free port.
import { startServer } from '../../../server/test/helpers/harness.mjs';

// One direct transfer on node-datachannel's RTCPeerConnection, given as the
// client's option, Node to Node through a real Dropgate Server's rendezvous:
// the other Node library core's docs name, beside werift, which the rest of
// the suite runs on. With no ICE servers node-datachannel asks no STUN server
// and gathers this machine's own addresses only.

const MiB = 1048576;

interface Server {
  baseUrl: string;
  stop(): Promise<void>;
}

describe('a direct transfer on node-datachannel', () => {
  let server: Server;

  beforeAll(async () => {
    server = (await startServer({ env: { RATE_LIMIT_MAX_REQUESTS: '0', P2P_STUN_SERVERS: 'none' } })) as Server;
  }, 30_000);

  afterAll(async () => {
    await server?.stop();
  });

  it('by code, a file of 32 MiB + 5 bytes, byte for byte, both sides completed', async () => {
    const options = { server: server.baseUrl, RTCPeerConnection: RTCPeerConnection as unknown as DirectPeerConnectionClass };
    const bytes = patterned(32 * MiB + 5, 41);
    const send = await new DropgateClient(options).direct.send({ files: memoryFile('large.bin', bytes) });
    const receive = await new DropgateClient(options).direct.receive({ code: send.share().code as string });
    expect(await receive.offer()).toEqual({ files: [{ name: 'large.bin', size: 32 * MiB + 5, type: 'application/octet-stream' }], totalSize: 32 * MiB + 5 });
    const sink = new MemorySink();
    await receive.accept({ sink });
    const [r, s] = await Promise.all([receive.result, send.result]);
    expect(r).toMatchObject({ status: 'completed', value: { assurance: 'saved', files: 1, totalBytes: 32 * MiB + 5 } });
    expect(s).toMatchObject({ status: 'completed', value: { assurance: 'saved', files: 1, totalBytes: 32 * MiB + 5 } });
    expect(sameAs(sink.bytes, bytes)).toBe('the same');
    expect(sink.closed).toBe(true);
  }, 60_000);
});
