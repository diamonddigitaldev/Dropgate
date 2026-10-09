// What a Dropgate 4 server does with Dropgate 3: a Dropgate 3 client's requests
// are told to update, and a persistent Dropgate 3 server's uploads, which
// Dropgate 4 can't serve, are deleted as it starts, with nothing else touched.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { startServer, waitFor } from './helpers/harness.mjs';
import { answer, downloads, startBody, uploads } from './helpers/dgup4.mjs';

const UPDATE = { code: 'VERSION_UNSUPPORTED', error: 'This server runs Dropgate 4. Update the app to use it.' };
const ORIGIN = 'https://integrator.example';

/** Every request Dropgate 3's clients made, as they made them. */
function dropgate3Requests() {
    const id = randomUUID();
    const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return [
        ['/upload/init', json({ filename: 'report.pdf', lifetime: 3_600_000, isEncrypted: false, totalSize: 1000, totalChunks: 1 })],
        ['/upload/init-bundle', json({ fileCount: 2, isEncrypted: false, lifetime: 3_600_000, files: [] })],
        ['/upload/chunk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream', 'X-Upload-ID': id, 'X-Chunk-Index': '0', 'X-Chunk-Hash': '0'.repeat(64) },
            body: new Uint8Array(1000),
        }],
        ['/upload/complete', json({ uploadId: id })],
        ['/upload/complete-bundle', json({ bundleUploadId: id, encryptedManifest: 'AAAA' })],
        ['/upload/cancel', json({ uploadId: id })],
        // A body that doesn't parse is told the same: the body isn't read.
        ['/upload/init', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"filename": ' }],
        [`/api/file/${id}/meta`, {}],
        [`/api/file/${id}`, {}],
        [`/api/bundle/${id}/meta`, {}],
        [`/api/bundle/${id}/downloaded`, { method: 'POST' }],
    ];
}

describe("a Dropgate 3 client's requests", () => {
    for (const [what, env] of [['uploads on', { ENABLE_UPLOAD: 'true' }], ['uploads off', {}]]) {
        describe(`with ${what}`, () => {
            let server;
            before(async () => {
                server = await startServer({ env: { ...env, RATE_LIMIT_MAX_REQUESTS: '0' } });
            });
            after(() => server?.stop());

            test('every one of its API paths answers 410 VERSION_UNSUPPORTED in JSON, saying to update, uncached', async () => {
                for (const [route, init] of dropgate3Requests()) {
                    const res = await fetch(server.baseUrl + route, init);
                    const where = `${init.method ?? 'GET'} ${route}`;
                    assert.match(res.headers.get('content-type') ?? '', /^application\/json/, where);
                    assert.equal(res.headers.get('cache-control'), 'no-store', where);
                    assert.deepEqual(await answer(res), { status: 410, body: UPDATE }, where);
                }
            });

            test('a cross-origin client, such as the Dropgate 3 desktop app, can read that answer', async () => {
                for (const route of ['/upload/init', `/api/file/${randomUUID()}`]) {
                    const preflight = await fetch(server.baseUrl + route, {
                        method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
                    });
                    assert.equal(preflight.headers.get('access-control-allow-origin'), '*', `preflight, ${route}`);
                    const res = await fetch(server.baseUrl + route, { method: 'POST', headers: { Origin: ORIGIN } });
                    assert.equal(res.status, 410, route);
                    assert.equal(res.headers.get('access-control-allow-origin'), '*', route);
                }
            });

            test('/api/resolve is gone, and every other path under /api is a JSON 404, as every API error is', async () => {
                for (const [route, method] of [['/api/resolve', 'POST'], ['/api/resolve', 'GET'], ['/api', 'GET'], ['/api/nothing-here', 'GET']]) {
                    const res = await fetch(server.baseUrl + route, {
                        method, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: '{"value":"ABCD-1234"}' } : {}),
                    });
                    assert.equal(res.headers.get('cache-control'), 'no-store', `${method} ${route}`);
                    assert.deepEqual(await answer(res), { status: 404, body: { code: 'NOT_FOUND', error: 'There is nothing here.' } }, `${method} ${route}`);
                }
            });

            test('/api/info is where every version of a client looks, and says this server speaks version 4', async () => {
                const res = await fetch(`${server.baseUrl}/api/info`);
                assert.equal(res.status, 200);
                assert.deepEqual((await res.json()).protocols, { dgup: { major: 4, minor: 0 }, dgdtp: { major: 4, minor: 0 } });
            });
        });
    }
});

// ===== A persistent Dropgate 3 server's leftovers =====

const PERSISTENT = { ENABLE_UPLOAD: 'true', UPLOAD_PRESERVE_UPLOADS: 'true', RATE_LIMIT_MAX_REQUESTS: '0' };
const V3_DATABASES = ['file-database.sqlite', 'bundle-database.sqlite'];

/**
 * Dropgate 3's layout in `uploadsDir`, as a persistent v3 server left it: its
 * two quick.db databases, each holding a record per upload, with SQLite's own
 * -wal, -shm and -journal files beside them (as a server stopped mid-write
 * leaves them), and three stored files named by their IDs. Gives the IDs and
 * the names its records hold.
 */
function writeV3Layout(server) {
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const names = ['zq7-v3-report.pdf', 'zq7-v3-photo.jpg', 'zq7-v3-notes.txt'];
    for (const [i, id] of ids.entries()) fs.writeFileSync(path.join(server.uploadsDir, id), Buffer.alloc(2000 + i, i + 1));
    const Database = createRequire(path.join(server.dir, 'server.js'))('better-sqlite3');
    for (const database of V3_DATABASES) {
        const file = path.join(server.uploadsDir, 'db', database);
        const db = new Database(file);
        db.exec('CREATE TABLE IF NOT EXISTS json (ID TEXT, json TEXT)');
        for (const [i, id] of ids.entries()) {
            db.prepare('INSERT INTO json (ID, json) VALUES (?, ?)').run(id, JSON.stringify({ name: names[i], path: path.join(server.uploadsDir, id) }));
        }
        db.close();
        for (const suffix of ['-wal', '-shm', '-journal']) fs.writeFileSync(file + suffix, Buffer.alloc(32, 7));
    }
    return { ids, names };
}

/** What else an operator might have in uploads/, none of it Dropgate 3's layout. Gives the paths, relative to it. */
function writeOtherThings(server) {
    const things = {
        // More than the storage limit below, on its own.
        'notes.txt': 'not an upload. '.repeat(400),
        [`${randomUUID()}.txt`]: 'a UUID with an extension',
        [randomUUID().toUpperCase()]: 'a UUID in capitals, which Dropgate 3 never made',
        'db/other.sqlite': 'another database',
        [`${randomUUID()}/inside.txt`]: 'a folder named by a UUID',
    };
    for (const [name, text] of Object.entries(things)) {
        fs.mkdirSync(path.dirname(path.join(server.uploadsDir, name)), { recursive: true });
        fs.writeFileSync(path.join(server.uploadsDir, name), text);
    }
    return Object.keys(things);
}

const exists = (server, name) => fs.existsSync(path.join(server.uploadsDir, name));
const ownLines = (output) => (output.stdout + output.stderr).split(/\r?\n/).filter((l) => /^\[[^\]]+\] \[(ERROR|WARN|INFO|DEBUG)\]/.test(l));

test("a persistent server deletes exactly Dropgate 3's layout as it starts, logging one line with the count and no ID or name", async (t) => {
    // About 5 KB of storage, less than the leftovers and the other files together.
    const server = await startServer({ env: { ...PERSISTENT, UPLOAD_MAX_STORAGE_GB: '0.000005' } });
    t.after(server.stop);
    const { ids, names } = writeV3Layout(server);
    const others = writeOtherThings(server);

    const mark = server.mark();
    await server.restart();
    await waitFor(() => server.since(mark).stdout.includes('is running'), { what: 'the startup log' });

    for (const id of ids) assert.equal(exists(server, id), false, 'a stored file of Dropgate 3\'s');
    for (const database of V3_DATABASES) {
        for (const suffix of ['', '-wal', '-shm', '-journal']) assert.equal(exists(server, `db/${database}${suffix}`), false, `${database}${suffix}`);
    }
    for (const name of others) assert.equal(exists(server, name), true, `${name} was touched`);
    assert.equal(exists(server, 'db/objects.sqlite'), true, 'Dropgate 4\'s database');
    assert.equal(exists(server, 'dropgate-storage.json'), true, 'the format marker');

    const lines = ownLines(server.since(mark)).filter((l) => l.includes('Dropgate 3'));
    assert.equal(lines.length, 1, lines.join('\n'));
    assert.match(lines[0], /\[INFO\] Removed 3 uploads left by Dropgate 3\. Dropgate 4 can't serve them, and their links stopped working when it started\.$/);
    const written = server.since(mark).stdout + server.since(mark).stderr;
    for (const secret of [...ids, ...names]) assert.ok(!written.includes(secret), `the output holds ${secret}`);

    // Storage used is the stored objects only: the other files, which are more than the limit, don't count.
    const start = await uploads.start(server, startBody({ encrypted: false, size: 4000, files: [{ name: 'fits.bin', size: 4000 }] }));
    assert.equal(start.status, 201, 'nothing else in uploads/ counts as storage');

    // Nothing of Dropgate 3's is ever served.
    for (const id of ids) {
        assert.equal((await downloads.metadata(server, id)).status, 404);
        assert.equal((await fetch(`${server.baseUrl}/${id}`)).status, 404);
        assert.equal((await fetch(`${server.baseUrl}/api/file/${id}`)).status, 410);
    }
});

test('the next start finds nothing left and logs nothing about it; at NONE, the first logs nothing at all', async (t) => {
    const server = await startServer({ env: PERSISTENT });
    t.after(server.stop);
    writeV3Layout(server);

    const quiet = server.mark();
    await server.restart({ env: { LOG_LEVEL: 'NONE' } });
    assert.deepEqual(server.since(quiet), { stdout: '', stderr: '' });
    assert.deepEqual(fs.readdirSync(server.uploadsDir).filter((f) => /^[0-9a-f-]{36}$/.test(f)), [], 'deleted at NONE too');

    const again = server.mark();
    await server.restart({ env: { LOG_LEVEL: 'INFO' } });
    await waitFor(() => server.since(again).stdout.includes('is running'), { what: 'the startup log' });
    assert.deepEqual(ownLines(server.since(again)).filter((l) => l.includes('Dropgate 3')), []);
});

test('one upload is "1 upload"; databases alone are deleted too, as "0 uploads"', async (t) => {
    const server = await startServer({ env: PERSISTENT });
    t.after(server.stop);
    const { ids } = writeV3Layout(server);
    for (const id of ids.slice(1)) fs.rmSync(path.join(server.uploadsDir, id));

    let mark = server.mark();
    await server.restart();
    await waitFor(() => server.since(mark).stdout.includes('is running'), { what: 'the startup log' });
    assert.match(server.since(mark).stdout, /\[INFO\] Removed 1 upload left by Dropgate 3\. /);

    writeV3Layout(server);
    for (const f of fs.readdirSync(server.uploadsDir).filter((f) => /^[0-9a-f-]{36}$/.test(f))) fs.rmSync(path.join(server.uploadsDir, f));
    mark = server.mark();
    await server.restart();
    await waitFor(() => server.since(mark).stdout.includes('is running'), { what: 'the startup log' });
    assert.match(server.since(mark).stdout, /\[INFO\] Removed 0 uploads left by Dropgate 3\. /);
    for (const database of V3_DATABASES) assert.equal(exists(server, `db/${database}`), false, database);
});

test('in default mode, the start clears uploads/ whole, Dropgate 3\'s layout with everything else, as it always has', async (t) => {
    const server = await startServer({ env: PERSISTENT });
    t.after(server.stop);
    const { ids } = writeV3Layout(server);
    writeOtherThings(server);

    const mark = server.mark();
    await server.restart({ env: { UPLOAD_PRESERVE_UPLOADS: 'false' } });
    await waitFor(() => server.since(mark).stdout.includes('is running'), { what: 'the startup log' });
    assert.deepEqual(fs.readdirSync(server.uploadsDir).sort(), ['dropgate-storage.json', 'objects', 'tmp']);
    for (const id of ids) assert.equal((await downloads.metadata(server, id)).status, 404);
    assert.deepEqual(ownLines(server.since(mark)).filter((l) => l.includes('Dropgate 3')), [], 'no line about Dropgate 3: the wipe is the usual one');
});
