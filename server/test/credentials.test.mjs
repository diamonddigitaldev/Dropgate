// The credential boundary against the real server: until accounts
// come (#91, phase 12), the server asks no credential for anything, so a
// client with an auth provider is never asked for one and sends none, and no
// credential reaches the server's output or storage (the privacy tests check
// the fixture's token with its other secrets).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from './helpers/harness.mjs';
import { CREDENTIAL_TOKEN, runFixture } from './helpers/fixture.mjs';
import { SMALL_CHUNKS, answer, contentDigest, fileBytes, plainObject, startBody } from './helpers/dgup4.mjs';

test('the server asks no credential, and a client with an auth provider sends none', async (t) => {
    const server = await startServer({ env: { ENABLE_UPLOAD: 'true' } });
    t.after(server.stop);

    const info = await (await fetch(`${server.baseUrl}/api/info`)).json();
    assert.equal(info.capabilities.upload.credentialRequired, false);

    const run = await runFixture(server);
    assert.ok(run.responses.length > 10, 'the fixture made its requests');
    assert.deepEqual(run.credentialRequests, []);
    assert.deepEqual(run.authorized, []);
});

test('every Dropgate 4 upload route takes an upload with no credential, and answers the same with one, which is never written', async (t) => {
    const server = await startServer({ env: { ENABLE_UPLOAD: 'true', UPLOAD_CHUNK_SIZE_BYTES: SMALL_CHUNKS, LOG_LEVEL: 'DEBUG' } });
    t.after(server.stop);
    const object = plainObject({ files: [{ name: 'credential.bin', bytes: fileBytes(70_000) }] });

    // The same upload, once with no credential and once with one on every request.
    const statuses = [];
    for (const authorization of [undefined, `Bearer ${CREDENTIAL_TOKEN}`]) {
        const headers = authorization ? { Authorization: authorization } : {};
        const call = (route, init = {}) => fetch(server.baseUrl + route, { ...init, headers: { ...init.headers, ...headers } });
        const started = await answer(await call('/api/v4/uploads', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(startBody(object)),
        }));
        const naming = { 'Dropgate-Upload': started.body.uploadId };
        const seen = [started.status];
        for (const [index, bytes] of object.chunks.entries()) {
            seen.push((await call(`/api/v4/upload/chunks/${index}`, {
                method: 'PUT', body: bytes,
                headers: { ...naming, 'Content-Type': 'application/octet-stream', 'Content-Digest': contentDigest(bytes) },
            })).status);
        }
        for (const [route, method] of [['/api/v4/upload', 'GET'], ['/api/v4/upload/pause', 'POST'], ['/api/v4/upload/resume', 'POST'], ['/api/v4/upload/complete', 'POST']]) {
            seen.push((await call(route, { method, headers: naming })).status);
        }
        const cancelled = await answer(await call('/api/v4/uploads', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(startBody(object)),
        }));
        seen.push((await call('/api/v4/upload', { method: 'DELETE', headers: { 'Dropgate-Upload': cancelled.body.uploadId } })).status);
        statuses.push(seen);
    }
    assert.deepEqual(statuses[0], [201, 200, 200, 200, 200, 200, 201, 204]);
    assert.deepEqual(statuses[1], statuses[0]);
    assert.ok(!(server.output.stdout + server.output.stderr).includes(CREDENTIAL_TOKEN), 'the credential was written');
});
