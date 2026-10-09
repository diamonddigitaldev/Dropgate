// What the server stores and sends back: the privacy floor for data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { startServer } from './helpers/harness.mjs';
import { CLIENT_IP, USER_AGENT, createClient, createRecorder, fixtureFiles, runFixture } from './helpers/fixture.mjs';
import { HOUR_MS, SMALL_CHUNKS, runDownloads, runUploads } from './helpers/dgup4.mjs';

// Every field a stored record may have, for a file and a bundle alike: no path (the ID names the object), no
// creation time. A new field has to be added here deliberately.
const OBJECT_FIELDS = new Set(['encrypted', 'size', 'meta', 'files', 'expiresAt', 'maxDownloads', 'downloadCount', 'manageTokenHash']);

// CSP sources that stay on this server.
const LOCAL_SOURCE = /^('self'|'none'|'unsafe-inline'|data:|blob:|'nonce-[^']+')$/;

describe('what the server stores', () => {
    let server;
    let stored = [];

    before(async () => {
        server = await startServer({ env: { ENABLE_UPLOAD: 'true', UPLOAD_PRESERVE_UPLOADS: 'true' } });
        const { upload } = await createClient(server, createRecorder());
        await upload(fixtureFiles.encrypted(), true);
        await upload(fixtureFiles.plain(), false);
        await upload(fixtureFiles.bundle(), true);
        stored = server.records('objects.sqlite');
    });

    after(() => server?.stop());

    test('every stored record holds only known fields, with no IP, user agent or creation time', () => {
        const problems = [];
        for (const { id, value } of stored) {
            const extra = Object.keys(value).filter((k) => !OBJECT_FIELDS.has(k));
            if (extra.length) problems.push(`record ${id} has unknown field(s): ${extra.join(', ')}`);
            const text = JSON.stringify(value);
            for (const secret of [CLIENT_IP, USER_AGENT, '127.0.0.1']) {
                if (text.includes(secret)) problems.push(`record ${id} contains "${secret}"`);
            }
        }
        assert.equal(stored.length, 3, 'the uploads were stored, the bundle as one');
        assert.deepEqual(problems, []);
    });

    test('an encrypted upload, a bundle\'s included, is one record with no file name or size in it', () => {
        const encrypted = stored.filter((r) => r.value.encrypted);
        assert.equal(encrypted.length, 2, 'the encrypted file and the encrypted bundle');
        for (const { value } of encrypted) {
            assert.equal(value.files, undefined, 'a file list in plain');
            assert.equal(typeof value.meta, 'string', 'the sealed list');
        }
    });
});

describe('what Dropgate 4\'s uploads store, paused and resumed part-way', () => {
    let server;
    let records = [];
    let secrets;
    let finishedBetween;

    before(async () => {
        server = await startServer({
            env: { ENABLE_UPLOAD: 'true', UPLOAD_PRESERVE_UPLOADS: 'true', UPLOAD_CHUNK_SIZE_BYTES: SMALL_CHUNKS, RATE_LIMIT_MAX_REQUESTS: '0' },
        });
        const started = Date.now();
        ({ secrets } = await runUploads(server));
        finishedBetween = [started, Date.now()];
        records = server.records('objects.sqlite');
    });

    after(() => server?.stop());

    test('every record holds only known fields: no address, upload ID, file name of an encrypted upload, or creation time', () => {
        assert.equal(records.length, 2, 'the two finished uploads');
        const problems = [];
        for (const { id, value } of records) {
            const extra = Object.keys(value).filter((k) => !OBJECT_FIELDS.has(k));
            if (extra.length) problems.push(`record ${id} has unknown field(s): ${extra.join(', ')}`);
            const text = JSON.stringify(value);
            const plainName = value.encrypted ? null : value.files?.[0]?.name;
            for (const secret of ['127.0.0.1', '::1', ...secrets]) {
                if (secret !== plainName && secret !== value.manageTokenHash && text.includes(secret)) problems.push(`record ${id} contains "${secret}"`);
            }
        }
        assert.deepEqual(problems, []);
    });

    test('the one time a record keeps is when it expires, an hour after it finished', () => {
        for (const { value } of records) {
            assert.ok(value.expiresAt >= finishedBetween[0] + HOUR_MS && value.expiresAt <= finishedBetween[1] + HOUR_MS);
        }
    });

    test('an encrypted bundle is one record, with its sealed list and no file names or sizes', () => {
        const encrypted = records.filter((r) => r.value.encrypted);
        assert.equal(encrypted.length, 1);
        const [{ value }] = encrypted;
        assert.equal(value.files, undefined);
        assert.match(value.meta, /^[A-Za-z0-9_-]+$/);
        assert.equal(Buffer.from(value.meta, 'base64url').length, 12 + 4096 + 16, 'the sealed list, in its smallest bucket');
        assert.equal(value.downloadCount, 0, 'the server\'s default limit of 1 is counted');
    });
});

describe('what Dropgate 4\'s downloads leave, with a download limit of 1', () => {
    let server;
    let run;

    before(async () => {
        server = await startServer({
            env: { ENABLE_UPLOAD: 'true', UPLOAD_PRESERVE_UPLOADS: 'true', UPLOAD_CHUNK_SIZE_BYTES: SMALL_CHUNKS, RATE_LIMIT_MAX_REQUESTS: '0' },
        });
        run = await runDownloads(server);
    });

    after(() => server?.stop());

    test('an encrypted bundle downloaded once can\'t be fetched at all afterwards, and nothing of it is stored', async () => {
        const { id, lease } = run.bundle;
        assert.equal((await fetch(`${server.baseUrl}/api/v4/objects/${id}`)).status, 404, 'its metadata');
        assert.equal((await fetch(`${server.baseUrl}/api/v4/objects/${id}/leases`, { method: 'POST' })).status, 404, 'a new lease');
        const content = await fetch(`${server.baseUrl}/api/v4/objects/${id}/content`, { headers: { 'Dropgate-Lease': lease, Range: 'bytes=0-' } });
        assert.equal(content.status, 404, 'its bytes, under the lease that downloaded it');
        await content.arrayBuffer();
        assert.deepEqual(server.storedFiles(), [], 'nothing on disk');
        assert.deepEqual(server.records('objects.sqlite'), [], 'no record');
    });

    test('no stored byte holds a lease, a manage token, an ID, a name or an address', () => {
        const dbDir = path.join(server.uploadsDir, 'db');
        const problems = [];
        for (const file of fs.readdirSync(dbDir)) {
            const text = fs.readFileSync(path.join(dbDir, file)).toString('latin1');
            const utf8 = fs.readFileSync(path.join(dbDir, file)).toString('utf8');
            for (const secret of ['127.0.0.1', '::1', ...run.secrets]) {
                if (text.includes(secret) || utf8.includes(secret)) problems.push(`${file} holds "${secret}"`);
            }
        }
        assert.deepEqual(problems, []);
    });

    test('a lease holds only its upload\'s ID, its own, how far it has got and its deadline: nothing from the request', () => {
        // The server makes every lease in one place, from the upload's ID alone.
        const source = fs.readFileSync(path.join(server.dir, 'server.js'), 'utf8');
        const made = /const newLease = \((\w*)\) => \(\{([\s\S]*?)\n\}\);/.exec(source);
        assert.ok(made, 'newLease() is where the server makes a lease');
        assert.equal(made[1], 'objectId', 'it\'s made from the upload\'s ID alone');
        const fields = [...made[2].matchAll(/^\s{4}(\w+)[:,]/gm)].map((m) => m[1]);
        assert.deepEqual(fields, ['id', 'objectId', 'served', 'paused', 'deadline', 'timer', 'sending']);
        assert.equal(source.match(/\bnewLease\(/g).length, 1, 'and it\'s called in one place');
        assert.match(source, /const lease = newLease\(id\);/, 'with the upload\'s ID');
    });
});

describe('responses, and what is left after the download limit', () => {
    let server;
    let fixture;

    before(async () => {
        server = await startServer({ env: { ENABLE_UPLOAD: 'true' } });
        fixture = await runFixture(server);
        for (const route of ['/js/theme.js', '/vendor/bootstrap/bootstrap.min.css', '/vendor/streamsaver/mitm.html', '/peerjs/peerjs/id', '/no-such-page']) {
            await (await fixture.fetch(server.baseUrl + route)).arrayBuffer();
        }
    });

    after(() => server?.stop());

    test('every response sends no referrer, sets no cookie, and names no third-party origin in its CSP', () => {
        const problems = [];
        for (const { method, url, headers } of fixture.responses) {
            const where = `${method} ${new URL(url).pathname}`;
            if (headers.get('referrer-policy') !== 'no-referrer') problems.push(`${where}: Referrer-Policy is ${headers.get('referrer-policy')}`);
            if (headers.get('set-cookie')) problems.push(`${where}: sets a cookie`);
            const csp = headers.get('content-security-policy');
            if (!csp) {
                if ((headers.get('content-type') || '').includes('text/html')) problems.push(`${where}: HTML with no CSP`);
                continue;
            }
            for (const directive of csp.split(';')) {
                const [name, ...sources] = directive.trim().split(/\s+/);
                const foreign = sources.filter((s) => !LOCAL_SOURCE.test(s));
                if (foreign.length) problems.push(`${where}: CSP ${name} allows ${foreign.join(' ')}`);
            }
        }
        assert.ok(fixture.responses.length > 20, 'the fixture made its requests');
        assert.deepEqual(problems, []);
    });

    test('an encrypted bundle can no longer be fetched once its download limit is reached', async () => {
        const { bundle } = fixture.uploads;
        assert.equal((await fetch(`${server.baseUrl}/api/v4/objects/${bundle.id}`)).status, 404, 'the bundle is gone');
        assert.equal((await fetch(`${server.baseUrl}/api/v4/objects/${bundle.id}/leases`, { method: 'POST' })).status, 404, 'and no lease is given');
        assert.equal(fs.existsSync(path.join(server.uploadsDir, 'objects', bundle.id)), false, 'and none of it is stored');
    });
});
