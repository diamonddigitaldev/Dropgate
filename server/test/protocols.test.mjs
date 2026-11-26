// The protocol versions the server gives in /api/info, which clients check
// before anything else (hard requirement 6). They must be the ones the web
// UI's own copy of core speaks, or the server's own pages couldn't use it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from './helpers/harness.mjs';

test("/api/info gives the server's protocol versions, the ones its own copy of core speaks, and the web UI's core works with it", async (t) => {
    const server = await startServer();
    t.after(server.stop);

    const info = await (await fetch(`${server.baseUrl}/api/info`)).json();
    const { DropgateClient } = await server.loadCore();
    assert.deepEqual(info.protocols, { dgup: { major: 4, minor: 0 }, dgdtp: { major: 4, minor: 0 } });
    assert.deepEqual(info.protocols, JSON.parse(JSON.stringify(DropgateClient.protocols)));

    const connection = await new DropgateClient({ server: server.baseUrl }).server.connect();
    assert.equal(connection.dgup.compatible, true, connection.dgup.message);
    assert.equal(connection.dgdtp.compatible, true, connection.dgdtp.message);
    // Loopback counts as secure, so the server's own address needs no opt-in.
    assert.deepEqual(connection.transport, { secure: true });
});
