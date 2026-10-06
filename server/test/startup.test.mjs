// What the server makes of its settings as it starts: what it refuses to start
// with and why, what it only warns about, where it keeps things on disk, and
// what /api/info then says. Sizes count in 1024s.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { startServer, waitFor } from './helpers/harness.mjs';
import { HOUR_MS, initUpload, postJson } from './helpers/uploads.mjs';

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
        assert.equal((await initUpload(server, MIB, 1)).status, 200, 'a file of exactly 1 MB');
        assert.equal((await initUpload(server, MIB + 1, 1)).status, 413, 'a file a byte over');

        const bundle = (sizes) => postJson(server, '/upload/init-bundle', {
            fileCount: sizes.length, isEncrypted: false, lifetime: HOUR_MS,
            files: sizes.map((size, i) => ({ filename: `member-${i}.bin`, totalSize: size, totalChunks: 1 })),
        });
        assert.equal((await bundle([MIB / 2, MIB / 2])).status, 200, 'two files making exactly 1 MB');
        assert.equal((await bundle([MIB / 2, MIB / 2 + 1])).status, 413, 'two files, each under 1 MB, making a byte over');
    });
});

test('the storage limit counts in 1024s', async () => {
    // A millionth of a GB: 1073.74 bytes in 1024s, where it would be 1000 in 1000s.
    await withServer({ ...UPLOADS, UPLOAD_MAX_STORAGE_GB: '0.000001', RATE_LIMIT_MAX_REQUESTS: '0' }, async (server) => {
        assert.equal((await initUpload(server, 1073, 1)).status, 200);
        assert.equal((await initUpload(server, 1, 1)).status, 507, 'the first upload holds the rest');
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
