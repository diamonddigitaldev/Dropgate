// The harness that starts a copy of the server for each test, which the
// integration tests use too.
//
// Tests run side by side, so another test's server can take the free port this
// one was about to listen on. This one then fails to start, and the other
// answers on the port, so without care a test would run against someone
// else's server. It happened once in CI: a direct transfer test was offered
// another test's STUN server.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from './helpers/harness.mjs';

test('a test gets its own server, even when another server already has the port it found', async (t) => {
    const first = await startServer({ env: { SERVER_NAME: 'First Server' } });
    t.after(first.stop);
    const taken = Number(new URL(first.baseUrl).port);

    const second = await startServer({ env: { SERVER_NAME: 'Second Server' }, port: taken });
    t.after(second.stop);

    assert.notEqual(second.baseUrl, first.baseUrl, 'the second server was handed the first server\'s address');
    const info = await (await fetch(`${second.baseUrl}/api/info`)).json();
    assert.equal(info.name, 'Second Server');
});
