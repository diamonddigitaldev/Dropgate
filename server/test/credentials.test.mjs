// The credential boundary against the real server (09 14.9): until accounts
// come (#91, phase 12), the server asks no credential for anything, so a
// client with an auth provider is never asked for one and sends none, and no
// credential reaches the server's output or storage (the privacy tests check
// the fixture's token with its other secrets).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from './helpers/harness.mjs';
import { runFixture } from './helpers/fixture.mjs';

test('the server asks no credential, and a client with an auth provider sends none', async (t) => {
    const server = await startServer({ env: { ENABLE_UPLOAD: 'true' } });
    t.after(server.stop);

    const info = await (await fetch(`${server.baseUrl}/api/info`)).json();
    assert.equal(info.capabilities.upload.credentialRequired, undefined);

    const run = await runFixture(server);
    assert.ok(run.responses.length > 10, 'the fixture made its requests');
    assert.deepEqual(run.credentialRequests, []);
    assert.deepEqual(run.authorized, []);
});
