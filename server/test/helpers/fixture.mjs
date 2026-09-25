// The privacy fixture: a realistic run of hosted transfers through the web UI's
// own client, recording every identifier, name and key it produces so tests can
// check none of them reaches the server's output.
import fs from 'node:fs';
import path from 'node:path';
import { serverVersion } from './harness.mjs';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export const P2P_CODE = 'ABCD-1234';
// Placed where a JSON parser error message would quote it.
export const BODY_MARKER = 'zq7BODY';

const mkFile = (name, size, fill) => new File([new Uint8Array(size).fill(fill)], name);

/**
 * Run the fixture against a started server.
 * @param {Awaited<ReturnType<import('./harness.mjs').startServer>>} server
 * @param {object} [opts]
 * @param {boolean} [opts.faults] - Also send a malformed JSON body and request a stored file that has gone missing.
 * @returns {Promise<Set<string>>} Every value that must never appear in the server's output.
 */
export async function runFixture(server, { faults = false } = {}) {
    const secrets = new Set([P2P_CODE, '127.0.0.1', '::1']);
    const note = (value) => { if (typeof value === 'string' && value.length >= 4) secrets.add(value); };

    const recordingFetch = async (url, init) => {
        const res = await fetch(url, init);
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

    const { DropgateClient } = await server.loadCore();
    const client = new DropgateClient({ clientVersion: serverVersion, server: server.baseUrl, fetchFn: recordingFetch });
    const upload = async (files, encrypt) => {
        for (const f of [files].flat()) note(f.name);
        const session = await client.uploadFiles({ files, encrypt, lifetimeMs: 60 * 60 * 1000, maxDownloads: 1 });
        const result = await session.result;
        for (const value of [result.fileId, result.bundleId, result.uploadId, result.keyB64, result.downloadUrl]) note(value);
        for (const f of result.files || []) note(f.fileId);
        return result;
    };

    const encrypted = await upload(mkFile('Secret Report ünïcode.pdf', 300_000, 1), true);
    const plain = await upload(mkFile('plain-name-visible.txt', 5_000, 2), false);
    const bundle = await upload([
        mkFile('a.txt', 1_000, 3),
        mkFile('holiday photos (private).zip', 200_000, 4),
        mkFile('tax return 2025.xlsx', 50_000, 5),
    ], true);

    // A pasted link, fragment and all (the v3 web UI sends it as-is).
    await client.resolveShareTarget(encrypted.downloadUrl);

    for (const page of ['/', `/${encrypted.fileId}`, `/${plain.fileId}`, `/b/${bundle.bundleId}`, `/p2p/${P2P_CODE}`]) {
        await (await fetch(server.baseUrl + page)).arrayBuffer();
    }

    // Downloads up to each limit. The bundle counts only as a whole ("Download All as ZIP").
    await client.downloadFiles({ fileId: encrypted.fileId, keyB64: encrypted.keyB64, onData: () => {} });
    await client.downloadFiles({ fileId: plain.fileId, onData: () => {} });
    await client.downloadFiles({ bundleId: bundle.bundleId, keyB64: bundle.keyB64, asZip: true, onData: () => {} });

    if (faults) {
        await fetch(`${server.baseUrl}/api/resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: `{"value": ${BODY_MARKER}}`,
        });
        note(BODY_MARKER);

        // A record whose stored file has gone, as when expiry races a download.
        const orphan = await upload(mkFile('about-to-go-missing.txt', 1_000, 6), false);
        fs.rmSync(path.join(server.uploadsDir, orphan.fileId));
        await (await fetch(`${server.baseUrl}/api/file/${orphan.fileId}`).catch(() => new Response())).arrayBuffer();
    }

    return secrets;
}
