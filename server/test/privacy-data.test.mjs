// What the server stores and sends back: the privacy floor for data.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startServer } from './helpers/harness.mjs';
import { CLIENT_IP, USER_AGENT, createClient, createRecorder, fixtureFiles, runFixture } from './helpers/fixture.mjs';

// Every field a stored record may have. A new field has to be added here deliberately.
const FILE_FIELDS = new Set(['name', 'path', 'expiresAt', 'isEncrypted', 'maxDownloads', 'downloadCount', 'bundleId']);
const BUNDLE_FIELDS = new Set(['encryptedManifest', 'files', 'isEncrypted', 'sealed', 'expiresAt', 'maxDownloads', 'downloadCount']);

// CSP sources that stay on this server.
const LOCAL_SOURCE = /^('self'|'none'|'unsafe-inline'|data:|blob:|'nonce-[^']+')$/;

describe('what the server stores', () => {
    let server;
    const stored = [];
    let bundleRecords = [];

    before(async () => {
        server = await startServer({ env: { ENABLE_UPLOAD: 'true', UPLOAD_PRESERVE_UPLOADS: 'true' } });
        const { upload } = await createClient(server, createRecorder());
        await upload(fixtureFiles.encrypted(), true);
        await upload(fixtureFiles.plain(), false);

        const all = () => [
            ...server.records('file-database.sqlite').map((r) => ({ ...r, db: 'file' })),
            ...server.records('bundle-database.sqlite').map((r) => ({ ...r, db: 'bundle' })),
        ];
        const beforeBundle = new Set(all().map((r) => r.id));
        await upload(fixtureFiles.bundle(), true);
        stored.push(...all());
        bundleRecords = stored.filter((r) => !beforeBundle.has(r.id));
    });

    after(() => server?.stop());

    test('every stored record holds only known fields, with no IP, user agent or creation time', () => {
        const problems = [];
        for (const { db, id, value } of stored) {
            const allowed = db === 'file' ? FILE_FIELDS : BUNDLE_FIELDS;
            const extra = Object.keys(value).filter((k) => !allowed.has(k));
            if (extra.length) problems.push(`${db} record ${id} has unknown field(s): ${extra.join(', ')}`);
            const text = JSON.stringify(value);
            for (const secret of [CLIENT_IP, USER_AGENT, '127.0.0.1']) {
                if (text.includes(secret)) problems.push(`${db} record ${id} contains "${secret}"`);
            }
        }
        assert.ok(stored.length >= 3, 'the uploads were stored');
        assert.deepEqual(problems, []);
    });

    test('an encrypted bundle is stored as one record, with no per-file names or sizes', {
        expectFailure: {
            label: 'known issue until the v4 server rewrite: each member file gets its own record, with its encrypted name and size',
            match: /per-file/,
        },
    }, () => {
        const perFile = bundleRecords.filter((r) => r.db === 'file');
        assert.equal(perFile.length, 0, `the bundle added ${perFile.length} per-file record(s) with a name and size`);
        assert.equal(bundleRecords.length, 1, `the bundle added ${bundleRecords.length} records`);
        assert.equal(bundleRecords[0].value.files, undefined, 'the bundle record lists per-file names and sizes');
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

    test('an encrypted bundle can no longer be fetched once its download limit is reached', {
        expectFailure: {
            label: 'known issue until the v4 server rewrite: member files stay downloadable until they expire',
            match: /still downloadable/,
        },
    }, async () => {
        const { bundle } = fixture.uploads;
        assert.equal((await fetch(`${server.baseUrl}/api/bundle/${bundle.bundleId}/meta`)).status, 404, 'the bundle is gone');
        const reachable = [];
        for (const { fileId } of bundle.files) {
            const res = await fetch(`${server.baseUrl}/api/file/${fileId}`);
            await res.arrayBuffer();
            if (res.status !== 404) reachable.push(fileId);
        }
        assert.deepEqual(reachable, [], `${reachable.length} member file(s) still downloadable after the limit`);
    });
});
