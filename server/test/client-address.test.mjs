// Which address is a client's: the connection's, unless TRUST_PROXY says how
// many reverse proxies are in front, whose X-Forwarded-For hops are then
// believed. The rate limiter and every count by address use it.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { startServer, waitFor } from './helpers/harness.mjs';
import { TYPE, connect, msg } from './helpers/rendezvous.mjs';

/** Start a server that's expected to refuse its settings, and say how it stopped. */
async function refusedStart(env) {
    try {
        const server = await startServer({ env });
        await server.stop();
    } catch (err) {
        if (err.exitCode === undefined) throw err;
        return { exitCode: err.exitCode, output: err.output.stdout + err.output.stderr };
    }
    assert.fail(`the server started with ${JSON.stringify(env)}`);
}

/** Start a server, run a check once its startup lines are out, then stop it. */
async function withServer(env, check) {
    const server = await startServer({ env });
    try {
        await waitFor(() => server.output.stdout.includes('is running'), { what: 'the startup log' });
        return await check(server);
    } finally {
        await server.stop();
    }
}

const linesNaming = (server, name) => (server.output.stdout + server.output.stderr).split(/\r?\n/).filter((l) => l.includes(name));

/** How many of these requests, one after another from this one machine, the rate limiter refuses. */
const refusedOf = async (server, forwardedFors) => {
    let refused = 0;
    for (const forwardedFor of forwardedFors) {
        const headers = forwardedFor === null ? {} : { 'X-Forwarded-For': forwardedFor };
        const res = await fetch(`${server.baseUrl}/api/info`, { headers });
        await res.arrayBuffer();
        if (res.status === 429) refused++;
    }
    return refused;
};

/** How many of these rooms, each asking for a code, from this one machine, are given one. */
const codesGivenOf = async (server, forwardedFors) => {
    const senders = [];
    let given = 0;
    try {
        for (const forwardedFor of forwardedFors) {
            const sender = await connect(server, { headers: { 'X-Forwarded-For': forwardedFor } });
            senders.push(sender);
            sender.send(msg.create({ roomId: randomBytes(16), code: true }));
            const created = await sender.next();
            assert.equal(created[0], TYPE.CREATED);
            if (created[1] > 0) given++;
        }
    } finally {
        for (const sender of senders) sender.close();
        await Promise.all(senders.map((s) => s.closed));
    }
    return given;
};

const each = (n, make) => Array.from({ length: n }, (_, i) => make(i + 1));

test('unset, a client reached directly is counted by its connection: an X-Forwarded-For it makes up is believed by neither the rate limiter nor the count of codes', async () => {
    await withServer({ RATE_LIMIT_MAX_REQUESTS: '2' }, async (server) => {
        assert.equal(await refusedOf(server, each(6, (n) => `198.51.100.${n}`)), 4, 'six requests, each naming another address, are one address\'s');
    });
    // Six code rooms from one machine, each upgrade naming another address: the sixth is past P2P_MAX_CODES_PER_IP's 5.
    await withServer({ RATE_LIMIT_MAX_REQUESTS: '0' }, async (server) => {
        assert.equal(await codesGivenOf(server, each(6, (n) => `203.0.113.${n}`)), 5);
    });
});

test('TRUST_PROXY unset, empty, false or 0 trusts no proxy, and says so at INFO as the server starts', async () => {
    for (const value of [undefined, '', '  ', 'false', 'FALSE', '0', ' 0 ', '00']) {
        const env = { RATE_LIMIT_MAX_REQUESTS: '2', ...(value === undefined ? {} : { TRUST_PROXY: value }) };
        await withServer(env, async (server) => {
            const lines = linesNaming(server, 'TRUST_PROXY:');
            assert.equal(lines.length, 1, `with ${JSON.stringify(value)}: ${lines.join('\n')}`);
            assert.match(lines[0], /\[INFO\] TRUST_PROXY: 0 \(no reverse proxy: each client's address is its connection's\)$/);
            assert.equal(await refusedOf(server, each(3, (n) => `198.51.100.${n}`)), 1, `with ${JSON.stringify(value)}: one address`);
        });
    }
});

test('TRUST_PROXY true or 1 believes the address the one reverse proxy adds, the last in X-Forwarded-For', async () => {
    for (const value of ['true', 'True', '1', ' 1 ']) {
        await withServer({ RATE_LIMIT_MAX_REQUESTS: '2', TRUST_PROXY: value }, async (server) => {
            const lines = linesNaming(server, 'TRUST_PROXY:');
            assert.equal(lines.length, 1);
            assert.match(lines[0], /\[INFO\] TRUST_PROXY: 1 \(the client's address is the one the reverse proxy adds to X-Forwarded-For\)$/);
            assert.equal(await refusedOf(server, each(6, (n) => `198.51.100.${n}`)), 0, `with ${JSON.stringify(value)}: each its own address`);
            assert.equal(await refusedOf(server, each(3, (n) => `192.0.2.${n}, 203.0.113.9`)), 1, 'only the last hop is believed');
        });
    }
});

test('TRUST_PROXY 2 believes the hop the first of two proxies adds, the one before the last', async () => {
    await withServer({ RATE_LIMIT_MAX_REQUESTS: '2', TRUST_PROXY: '2' }, async (server) => {
        assert.match(linesNaming(server, 'TRUST_PROXY:')[0], /\[INFO\] TRUST_PROXY: 2 \(the client's address is the one the first of 2 reverse proxies adds to X-Forwarded-For\)$/);
        assert.equal(await refusedOf(server, each(6, (n) => `198.51.100.${n}, 192.0.2.1`)), 0, 'each its own address');
        assert.equal(await refusedOf(server, each(3, (n) => `203.0.113.9, 192.0.2.${n}`)), 1, 'the inner proxy\'s hop isn\'t the client');
        assert.equal(await refusedOf(server, each(3, (n) => `192.0.2.${n}, 203.0.113.8, 192.0.2.1`)), 1, 'nor is one before them');
    });
});

test('any other TRUST_PROXY stops the server with a clear error', async () => {
    for (const value of ['yes', 'no', '-1', '1.5', '+1', '0x1', '1e1', '1000', 'loopback', '10.0.0.1', '1,2']) {
        const { exitCode, output } = await refusedStart({ TRUST_PROXY: value });
        assert.equal(exitCode, 1, `with ${JSON.stringify(value)}`);
        assert.match(output, /\[ERROR\] Invalid TRUST_PROXY environment variable\. It must be how many reverse proxies are in front of the server: 1 behind one/, `with ${JSON.stringify(value)}`);
    }
});

test('the rendezvous counts unused codes by the address TRUST_PROXY gives', async () => {
    await withServer({ RATE_LIMIT_MAX_REQUESTS: '0', TRUST_PROXY: '1' }, async (server) => {
        assert.equal(await codesGivenOf(server, each(6, (n) => `203.0.113.${n}`)), 6, 'six addresses behind one proxy, a code each');
        assert.equal(await codesGivenOf(server, each(6, (n) => `192.0.2.${n}, 198.51.100.7`)), 5, 'one address, whatever comes before its hop');
    });
    await withServer({ RATE_LIMIT_MAX_REQUESTS: '0', TRUST_PROXY: '2' }, async (server) => {
        assert.equal(await codesGivenOf(server, each(6, (n) => `203.0.113.${n}, 192.0.2.1`)), 6, 'six addresses behind two proxies');
        assert.equal(await codesGivenOf(server, each(6, (n) => `198.51.100.7, 192.0.2.${n}`)), 5, 'one address, whichever inner proxy it came through');
    });
});

test('with no proxy trusted, a request with X-Forwarded-For is warned of once, saying how to set TRUST_PROXY, with no address; with one trusted, it isn\'t', async () => {
    await withServer({}, async (server) => {
        await refusedOf(server, ['203.0.113.44', '203.0.113.45', null]);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const lines = linesNaming(server, 'A request came with X-Forwarded-For');
        assert.equal(lines.length, 1, lines.join('\n'));
        assert.match(lines[0], /\[WARN\] A request came with X-Forwarded-For, which isn't believed while TRUST_PROXY is 0\. Behind a reverse proxy, set TRUST_PROXY=1, or every client shares the proxy's address/);
        const written = server.output.stdout + server.output.stderr;
        assert.ok(!written.includes('203.0.113.4'), 'an address was written');
    });
    await withServer({ TRUST_PROXY: '1' }, async (server) => {
        await refusedOf(server, ['203.0.113.44']);
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.deepEqual(linesNaming(server, 'A request came with X-Forwarded-For'), []);
    });
});
