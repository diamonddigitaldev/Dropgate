// The privacy fixture: a realistic run of hosted transfers through the web UI's
// own client, recording every identifier, name and key it produces so tests can
// check none of them reaches the server's output or storage.
import fs from 'node:fs';
import path from 'node:path';
import { serverVersion } from './harness.mjs';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export const P2P_CODE = 'ABCD-1234';
// Placed where a JSON parser error message would quote it.
export const BODY_MARKER = 'zq7BODY';
// Sent on every request, as a browser behind a reverse proxy would.
export const CLIENT_IP = '203.0.113.77';
export const USER_AGENT = 'DropgateTestAgent/1.0';

const mkFile = (name, size, fill) => new File([new Uint8Array(size).fill(fill)], name);

/**
 * A fetch that adds the client headers, records every response, and collects
 * the identifiers the server hands out.
 */
export function createRecorder() {
    const secrets = new Set([P2P_CODE, CLIENT_IP, USER_AGENT, '127.0.0.1', '::1']);
    const responses = [];
    const note = (value) => { if (typeof value === 'string' && value.length >= 4) secrets.add(value); };

    const recordingFetch = async (url, init = {}) => {
        const headers = new Headers(init.headers);
        headers.set('User-Agent', USER_AGENT);
        headers.set('X-Forwarded-For', CLIENT_IP);
        const res = await fetch(url, { ...init, headers });
        responses.push({ url: String(url), method: init.method || 'GET', status: res.status, headers: res.headers });
        if ((res.headers.get('content-type') || '').includes('application/json')) {
            const text = await res.clone().text();
            for (const [id] of text.matchAll(UUID_RE)) note(id);
            try {
                const json = JSON.parse(text);
                note(json.encryptedFilename);
                note(json.encryptedManifest);
            } catch { /* not JSON after all */ }
        }
        return res;
    };

    return { fetch: recordingFetch, secrets, responses, note };
}

/** A client on the web UI's own copy of dropgate-core, plus an upload helper. */
export async function createClient(server, recorder) {
    const { DropgateClient } = await server.loadCore();
    const client = new DropgateClient({ clientVersion: serverVersion, server: server.baseUrl, fetchFn: recorder.fetch });
    const upload = async (files, encrypt) => {
        for (const f of [files].flat()) recorder.note(f.name);
        const session = await client.uploadFiles({ files, encrypt, lifetimeMs: 60 * 60 * 1000, maxDownloads: 1 });
        const result = await session.result;
        for (const value of [result.fileId, result.bundleId, result.uploadId, result.keyB64, result.downloadUrl]) recorder.note(value);
        for (const f of result.files || []) recorder.note(f.fileId);
        return result;
    };
    return { client, upload };
}

export const fixtureFiles = {
    encrypted: () => mkFile('Secret Report ünïcode.pdf', 300_000, 1),
    plain: () => mkFile('plain-name-visible.txt', 5_000, 2),
    bundle: () => [
        mkFile('a.txt', 1_000, 3),
        mkFile('holiday photos (private).zip', 200_000, 4),
        mkFile('tax return 2025.xlsx', 50_000, 5),
    ],
};

/**
 * Run the fixture against a started server.
 * @param {Awaited<ReturnType<import('./harness.mjs').startServer>>} server
 * @param {object} [opts]
 * @param {boolean} [opts.faults] - Also send a malformed JSON body and request a stored file that has gone missing.
 */
export async function runFixture(server, { faults = false } = {}) {
    const recorder = createRecorder();
    const { client, upload } = await createClient(server, recorder);

    const encrypted = await upload(fixtureFiles.encrypted(), true);
    const plain = await upload(fixtureFiles.plain(), false);
    const bundle = await upload(fixtureFiles.bundle(), true);

    // A pasted link, fragment and all (the v3 web UI sends it as-is).
    await client.resolveShareTarget(encrypted.downloadUrl);

    for (const page of ['/', `/${encrypted.fileId}`, `/${plain.fileId}`, `/b/${bundle.bundleId}`, `/p2p/${P2P_CODE}`]) {
        await (await recorder.fetch(server.baseUrl + page)).arrayBuffer();
    }

    // Downloads up to each limit. The bundle counts only as a whole ("Download All as ZIP").
    await client.downloadFiles({ fileId: encrypted.fileId, keyB64: encrypted.keyB64, onData: () => {} });
    await client.downloadFiles({ fileId: plain.fileId, onData: () => {} });
    await client.downloadFiles({ bundleId: bundle.bundleId, keyB64: bundle.keyB64, asZip: true, onData: () => {} });

    if (faults) {
        await recorder.fetch(`${server.baseUrl}/api/resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: `{"value": ${BODY_MARKER}}`,
        });
        recorder.note(BODY_MARKER);

        // A record whose stored file has gone, as when expiry races a download.
        const orphan = await upload(mkFile('about-to-go-missing.txt', 1_000, 6), false);
        fs.rmSync(path.join(server.uploadsDir, orphan.fileId));
        await (await recorder.fetch(`${server.baseUrl}/api/file/${orphan.fileId}`).catch(() => new Response())).arrayBuffer();
    }

    return { secrets: recorder.secrets, responses: recorder.responses, uploads: { encrypted, plain, bundle }, fetch: recorder.fetch };
}
