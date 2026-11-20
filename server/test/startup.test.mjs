// What the server makes of its settings as it starts: what it refuses to start
// with and why, what it only warns about, where it keeps things on disk, and
// what /api/info then says. Sizes count in 1024s.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { startServer, waitFor } from './helpers/harness.mjs';
import { answer, startBody, uploads } from './helpers/dgup4.mjs';

const UPLOADS = { ENABLE_UPLOAD: 'true' };
const MIB = 1024 * 1024;

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

/** Start a server, run a check against it once its startup lines are out, then stop it. */
async function withServer(env, check) {
    const server = await startServer({ env });
    try {
        await waitFor(() => server.output.stdout.includes('is running'), { what: 'the startup log' });
        return await check(server);
    } finally {
        await server.stop();
    }
}

const uploadInfo = async (server) => (await (await fetch(`${server.baseUrl}/api/info`)).json()).capabilities.upload;
/** Starts an unencrypted upload of files of these sizes, without sending them, and gives the start's status. */
const startOf = async (server, sizes) => (await answer(await uploads.start(server, startBody({
    encrypted: false, size: sizes.reduce((a, b) => a + b, 0), files: sizes.map((size, i) => ({ name: `member-${i}.bin`, size })),
})))).status;
const linesNaming = (server, name) => (server.output.stdout + server.output.stderr).split(/\r?\n/).filter((l) => l.includes(name));

test('UPLOAD_BUNDLE_SIZE_MODE=per-file stops the server, saying the setting was removed and the limit is the whole upload\'s', async () => {
    for (const value of ['per-file', ' Per-File ']) {
        const { exitCode, output } = await refusedStart({ ...UPLOADS, UPLOAD_BUNDLE_SIZE_MODE: value });
        assert.equal(exitCode, 1, `with ${JSON.stringify(value)}`);
        assert.match(output, /\[ERROR\] UPLOAD_BUNDLE_SIZE_MODE was removed in Dropgate 4/);
        assert.match(output, /applies to the whole upload/);
    }
});

test('any other UPLOAD_BUNDLE_SIZE_MODE starts the server with one warning that it is ignored', async () => {
    for (const value of ['total', 'per-bundle', '']) {
        await withServer({ ...UPLOADS, UPLOAD_BUNDLE_SIZE_MODE: value }, async (server) => {
            const lines = linesNaming(server, 'UPLOAD_BUNDLE_SIZE_MODE');
            assert.equal(lines.length, 1, `with ${JSON.stringify(value)}: ${lines.join('\n')}`);
            assert.match(lines[0], /\[WARN\] UPLOAD_BUNDLE_SIZE_MODE was removed in Dropgate 4 and is ignored/);
            assert.equal('bundleSizeMode' in await uploadInfo(server), false);
        });
    }
    await withServer(UPLOADS, async (server) => {
        assert.deepEqual(linesNaming(server, 'UPLOAD_BUNDLE_SIZE_MODE'), [], 'unset, it isn\'t mentioned');
    });
});

test('the size limit applies to a bundle as a whole, in 1024s', async () => {
    await withServer({ ...UPLOADS, UPLOAD_MAX_FILE_SIZE_MB: '1', RATE_LIMIT_MAX_REQUESTS: '0' }, async (server) => {
        assert.equal(await startOf(server, [MIB]), 201, 'a file of exactly 1 MB');
        assert.equal(await startOf(server, [MIB + 1]), 413, 'a file a byte over');
        assert.equal(await startOf(server, [MIB / 2, MIB / 2]), 201, 'two files making exactly 1 MB');
        assert.equal(await startOf(server, [MIB / 2, MIB / 2 + 1]), 413, 'two files, each under 1 MB, making a byte over');
    });
});

test('the storage limit counts in 1024s', async () => {
    // A millionth of a GB: 1073.74 bytes in 1024s, where it would be 1000 in 1000s.
    await withServer({ ...UPLOADS, UPLOAD_MAX_STORAGE_GB: '0.000001', RATE_LIMIT_MAX_REQUESTS: '0' }, async (server) => {
        assert.equal(await startOf(server, [1073]), 201);
        assert.equal(await startOf(server, [1]), 507, 'the first upload holds the rest');
    });
});

test('UPLOAD_MAX_PAUSE_MINUTES is 60 unset, takes 0 to 1440, and /api/info gives it', async () => {
    await withServer(UPLOADS, async (server) => {
        assert.equal((await uploadInfo(server)).maxPauseMinutes, 60);
    });
    for (const [value, expected] of [['1', 1], ['1440', 1440], ['0', 0], [' 30 ', 30]]) {
        await withServer({ ...UPLOADS, UPLOAD_MAX_PAUSE_MINUTES: value }, async (server) => {
            assert.equal((await uploadInfo(server)).maxPauseMinutes, expected, `with ${JSON.stringify(value)}`);
            const [line] = linesNaming(server, 'UPLOAD_MAX_PAUSE_MINUTES');
            assert.match(line, expected === 0 ? /\[INFO\] UPLOAD_MAX_PAUSE_MINUTES: 0 \(pausing is off\)/ : /\[INFO\] UPLOAD_MAX_PAUSE_MINUTES: \d+ minutes/);
        });
    }
});

test('any other UPLOAD_MAX_PAUSE_MINUTES stops the server with a clear error', async () => {
    for (const value of ['1441', '-1', '1.5', 'abc', '', '1e3', '0x10']) {
        const { exitCode, output } = await refusedStart({ ...UPLOADS, UPLOAD_MAX_PAUSE_MINUTES: value });
        assert.equal(exitCode, 1, `with ${JSON.stringify(value)}`);
        assert.match(output, /\[ERROR\] Invalid UPLOAD_MAX_PAUSE_MINUTES environment variable\. It must be a whole number of minutes from 1 to 1440, or 0 to turn pausing off\./);
    }
});

test('UPLOAD_ZOMBIE_CLEANUP_INTERVAL_MS is gone: the server starts with any value, even one Dropgate 3 refused, and never mentions it', async () => {
    for (const value of ['100', '0', 'abc']) {
        await withServer({ ...UPLOADS, UPLOAD_ZOMBIE_CLEANUP_INTERVAL_MS: value }, async (server) => {
            assert.deepEqual(linesNaming(server, 'ZOMBIE'), [], `with ${JSON.stringify(value)}`);
        });
    }
});

test('UPLOAD_CHUNK_SIZE_BYTES can be up to 64 MB, and no more', async () => {
    await withServer({ ...UPLOADS, UPLOAD_CHUNK_SIZE_BYTES: String(64 * MIB) }, async (server) => {
        assert.equal((await uploadInfo(server)).chunkSize, 64 * MIB);
    });
    const { exitCode, output } = await refusedStart({ ...UPLOADS, UPLOAD_CHUNK_SIZE_BYTES: String(64 * MIB + 1) });
    assert.equal(exitCode, 1);
    assert.match(output, /\[ERROR\] UPLOAD_CHUNK_SIZE_BYTES must be at most 67108864 \(64 MB\)\./);
});

test('/api/info gives Dropgate 4\'s upload settings, the accounts block, and is never cached', async () => {
    await withServer(UPLOADS, async (server) => {
        const res = await fetch(`${server.baseUrl}/api/info`);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        const { capabilities } = await res.json();
        assert.deepEqual(capabilities.upload, {
            enabled: true,
            e2ee: true,
            maxSizeMB: 100,
            maxLifetimeHours: 24,
            maxFileDownloads: 1,
            chunkSize: 5 * MIB,
            maxPauseMinutes: 60,
            credentialRequired: false,
        });
        assert.deepEqual(capabilities.accounts, { enabled: false });
    });
    await withServer({}, async (server) => {
        const { capabilities } = await (await fetch(`${server.baseUrl}/api/info`)).json();
        assert.deepEqual(capabilities.upload, { enabled: false }, 'with uploads off, nothing more');
        assert.deepEqual(capabilities.accounts, { enabled: false });
    });
});

test('everything the server keeps is in data/: its uploads in data/uploads/, with objects/ and a format marker', async () => {
    for (const env of [UPLOADS, { ...UPLOADS, UPLOAD_PRESERVE_UPLOADS: 'true' }]) {
        await withServer(env, async (server) => {
            assert.equal(server.uploadsDir, path.join(server.dataDir, 'uploads'));
            assert.ok(fs.statSync(path.join(server.uploadsDir, 'objects')).isDirectory());
            assert.deepEqual(JSON.parse(fs.readFileSync(path.join(server.uploadsDir, 'dropgate-storage.json'), 'utf8')), { format: 4 });
            assert.deepEqual(fs.readdirSync(server.dataDir), ['uploads'], 'data/ holds nothing else yet');
            assert.equal(fs.existsSync(path.join(server.dir, 'uploads')), false, 'no uploads/ beside data/');
            assert.deepEqual(server.storedFiles(), []);
        });
    }
    await withServer({}, async (server) => {
        assert.ok(fs.statSync(server.dataDir).isDirectory(), 'with uploads off, data/ is there too');
        assert.equal(fs.existsSync(path.join(server.uploadsDir, 'dropgate-storage.json')), false, 'and no format marker');
    });
});

const p2pInfo = async (server) => (await (await fetch(`${server.baseUrl}/api/info`)).json()).capabilities.p2p;
const CLOUDFLARE_STUN = 'stun:stun.cloudflare.com:3478';

test("/api/info gives direct transfer's ICE servers and code letters, with no credential asked for, and nothing of PeerJS", async () => {
    await withServer({}, async (server) => {
        assert.deepEqual(await p2pInfo(server), {
            enabled: true,
            iceServers: [{ urls: [CLOUDFLARE_STUN] }],
            codeLetters: 2,
            credentialRequired: false,
        });
    });
    await withServer({ ...UPLOADS, ENABLE_P2P: 'false' }, async (server) => {
        assert.deepEqual(await p2pInfo(server), { enabled: false }, 'with direct transfer off, nothing more');
    });
});

test('P2P_STUN_SERVERS unset offers Cloudflare\'s STUN server; none offers no ICE servers at all; a list offers each STUN address on it', async () => {
    await withServer({}, async (server) => {
        assert.deepEqual((await p2pInfo(server)).iceServers, [{ urls: [CLOUDFLARE_STUN] }]);
        assert.match(linesNaming(server, 'P2P_STUN_SERVERS')[0], /\[INFO\] P2P_STUN_SERVERS: stun:stun\.cloudflare\.com:3478$/);
    });
    for (const value of ['none', ' NONE ', 'None']) {
        await withServer({ P2P_STUN_SERVERS: value }, async (server) => {
            assert.deepEqual((await p2pInfo(server)).iceServers, [], `with ${JSON.stringify(value)}`);
            assert.match(linesNaming(server, 'P2P_STUN_SERVERS')[0], /\[INFO\] P2P_STUN_SERVERS: none \(no STUN server is offered\)$/);
        });
    }
    const list = ['stun:stun.example.com:3478', 'stuns:stun.example.net', 'stun:127.0.0.1:19302', 'stun:[::1]:3478', 'STUN:Upper.Example', 'stun:localhost'];
    await withServer({ P2P_STUN_SERVERS: `${list[0]}, ${list[1]} ${list[2]},${list[3]}\n${list[4]} ${list[5]}` }, async (server) => {
        assert.deepEqual((await p2pInfo(server)).iceServers, [{ urls: list }], 'commas, spaces or both between them');
    });
});

test('P2P_STUN_SERVERS set to nothing, a TURN server, or anything but STUN addresses stops the server with a clear error', async () => {
    const cases = {
        '': /\[ERROR\] P2P_STUN_SERVERS is set, but to nothing\. Set it to none to offer browsers no STUN server/,
        '   ': /\[ERROR\] P2P_STUN_SERVERS is set, but to nothing\./,
        ',': /\[ERROR\] P2P_STUN_SERVERS is set, but to nothing\./,
        'turn:turn.example.com:3478': /\[ERROR\] P2P_STUN_SERVERS lists a TURN server \(turn:turn\.example\.com:3478\)\. Dropgate doesn't relay direct transfers through TURN/,
        'stun:stun.example.com turns:turn.example.com': /\[ERROR\] P2P_STUN_SERVERS lists a TURN server \(turns:turn\.example\.com\)/,
    };
    for (const bad of ['stun:', 'stun://stun.example.com', 'http://stun.example.com', 'stun.example.com:3478', 'stun:stun.example.com:0',
        'stun:stun.example.com:65536', 'stun:stun.example.com:port', 'stun:[not-ipv6]', 'stun:::1', 'stun:under_score.example',
        'stun:-dash.example', 'stun:stun.example.com?transport=udp', 'stun:user@stun.example.com', 'none,stun:stun.example.com']) {
        cases[bad] = new RegExp(String.raw`\[ERROR\] P2P_STUN_SERVERS lists "[^"]*", which isn't a STUN server's address\. Each must be stun: or stuns:, a host and an optional port`);
    }
    for (const [value, expected] of Object.entries(cases)) {
        const { exitCode, output } = await refusedStart({ P2P_STUN_SERVERS: value });
        assert.equal(exitCode, 1, `with ${JSON.stringify(value)}`);
        assert.match(output, expected, `with ${JSON.stringify(value)}`);
    }
});

test('P2P_LOCATOR_LETTERS is 2 unset, takes 2 or 3, and /api/info gives it as codeLetters; anything else stops the server', async () => {
    for (const [env, letters, codes] of [[{}, 2, '576'], [{ P2P_LOCATOR_LETTERS: '2' }, 2, '576'], [{ P2P_LOCATOR_LETTERS: ' 3 ' }, 3, '13,824']]) {
        await withServer(env, async (server) => {
            assert.equal((await p2pInfo(server)).codeLetters, letters, JSON.stringify(env));
            assert.match(linesNaming(server, 'P2P_LOCATOR_LETTERS')[0], new RegExp(String.raw`\[INFO\] P2P_LOCATOR_LETTERS: ${letters} \(${codes} codes at once\)$`));
        });
    }
    for (const value of ['1', '4', '', 'two', '2.0', '02', '3a']) {
        const { exitCode, output } = await refusedStart({ P2P_LOCATOR_LETTERS: value });
        assert.equal(exitCode, 1, `with ${JSON.stringify(value)}`);
        assert.match(output, /\[ERROR\] Invalid P2P_LOCATOR_LETTERS environment variable\. It must be 2 \(576 codes at once\) or 3 \(13,824\)\./);
    }
});

test('P2P_MAX_CODES_PER_IP is 5 unset and takes a whole number; 0 turns codes off, and /api/info gives codeLetters 0; anything else stops the server', async () => {
    for (const [value, logged] of [[undefined, '5'], ['7', '7'], [' 1 ', '1'], ['0', '0 \\(codes are off: direct transfers go by link only\\)']]) {
        await withServer(value === undefined ? {} : { P2P_MAX_CODES_PER_IP: value, P2P_LOCATOR_LETTERS: '3' }, async (server) => {
            assert.equal((await p2pInfo(server)).codeLetters, value === '0' ? 0 : (value === undefined ? 2 : 3), `with ${JSON.stringify(value)}`);
            assert.match(linesNaming(server, 'P2P_MAX_CODES_PER_IP')[0], new RegExp(String.raw`\[INFO\] P2P_MAX_CODES_PER_IP: ${logged}$`));
        });
    }
    for (const value of ['', '-1', '1.5', 'abc', '1e3', '0x10', '99999999999999999999']) {
        const { exitCode, output } = await refusedStart({ P2P_MAX_CODES_PER_IP: value });
        assert.equal(exitCode, 1, `with ${JSON.stringify(value)}`);
        assert.match(output, /\[ERROR\] Invalid P2P_MAX_CODES_PER_IP environment variable\. It must be a whole number: the most unused codes one address can hold at once, or 0 to turn codes off\./);
    }
});

test("with direct transfer off, its settings aren't read, so none of them stops the server", async () => {
    await withServer({ ...UPLOADS, ENABLE_P2P: 'false', P2P_STUN_SERVERS: '', P2P_LOCATOR_LETTERS: '9', P2P_MAX_CODES_PER_IP: 'x' }, async (server) => {
        assert.deepEqual(await p2pInfo(server), { enabled: false });
    });
});

test('PEERJS_DEBUG set to anything starts the server with one warning that it was removed, and nothing else about it', async () => {
    for (const value of ['true', 'false', '']) {
        await withServer({ PEERJS_DEBUG: value }, async (server) => {
            const lines = [...linesNaming(server, 'PEERJS_DEBUG'), ...linesNaming(server, 'PeerJS Debug')];
            assert.deepEqual(lines.map((l) => l.replace(/^\[[^\]]*\] /, '')), ['[WARN] PEERJS_DEBUG was removed in Dropgate 4 and is ignored.'], `with ${JSON.stringify(value)}`);
            assert.equal('peerjsDebugLogging' in await p2pInfo(server), false);
        });
    }
    await withServer({}, async (server) => {
        assert.deepEqual([...linesNaming(server, 'PEERJS_DEBUG'), ...linesNaming(server, 'PeerJS Debug')], [], 'unset, it isn\'t mentioned');
    });
});
