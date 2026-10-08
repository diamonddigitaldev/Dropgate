// The privacy fixture: a realistic run of hosted transfers through the web UI's
// own client, recording every identifier, name and key it produces so tests can
// check none of them reaches the server's output or storage.
import fs from 'node:fs';
import path from 'node:path';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export const P2P_CODE = 'ABCD-1234';
// Placed where a JSON parser error message would quote it.
export const BODY_MARKER = 'zq7BODY';
// Sent on every request, as a browser behind a reverse proxy would.
export const CLIENT_IP = '203.0.113.77';
export const USER_AGENT = 'DropgateTestAgent/1.0';
// What the client's auth provider would give, if the server ever asked it for a credential.
export const CREDENTIAL_TOKEN = 'zq7CREDENTIALtoken';

const mkFile = (name, size, fill) => new File([new Uint8Array(size).fill(fill)], name);

/**
 * A fetch that adds the client headers, records every response, and collects
 * the identifiers the server hands out.
 */
export function createRecorder() {
    const secrets = new Set([P2P_CODE, CLIENT_IP, USER_AGENT, CREDENTIAL_TOKEN, '127.0.0.1', '::1']);
    const responses = [];
    // Every request that carried a credential, by URL.
    const authorized = [];
    // The ID of each file of a bundle, as the server gave it when the file was finished.
    const memberIds = [];
    const note = (value) => { if (typeof value === 'string' && value.length >= 4) secrets.add(value); };

    const recordingFetch = async (url, init = {}) => {
        const headers = new Headers(init.headers);
        if (headers.has('Authorization')) authorized.push(String(url));
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
                if (new URL(String(url)).pathname === '/upload/complete' && json.id) memberIds.push(json.id);
            } catch { /* not JSON after all */ }
        }
        return res;
    };

    return { fetch: recordingFetch, secrets, responses, note, authorized, memberIds };
}

/** The value of an operation's completed outcome. Any other outcome fails the test, with its error. */
export function completed(outcome) {
    if (outcome.status !== 'completed') throw outcome.error ?? new Error(`The operation was ${outcome.status}.`);
    return outcome.value;
}

/**
 * A client on the web UI's own copy of dropgate-core, plus an upload helper. It
 * has an auth provider, as an app with accounts would: the server needs no
 * credential, so it must never be asked, and nothing must be sent.
 */
export async function createClient(server, recorder) {
    const { DropgateClient } = await server.loadCore();
    const credentialRequests = [];
    const auth = async (request) => {
        credentialRequests.push(request.operation);
        return { token: CREDENTIAL_TOKEN };
    };
    const client = new DropgateClient({ server: server.baseUrl, fetchFn: recorder.fetch, auth });
    const upload = async (files, encrypt) => {
        for (const f of [files].flat()) recorder.note(f.name);
        const handle = client.hosted.upload({ files, encrypt, lifetimeMs: 60 * 60 * 1000, maxDownloads: 1 });
        const result = completed(await handle.result);
        // The link's secret (or a bundle's key), after its #.
        const secret = new URL(result.downloadUrl).hash.slice(1) || undefined;
        for (const value of [result.id, result.downloadUrl, result.manageToken, secret]) recorder.note(value);
        return { ...result, secret };
    };
    return { client, upload, credentialRequests };
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
    const { client, upload, credentialRequests } = await createClient(server, recorder);

    const encrypted = await upload(fixtureFiles.encrypted(), true);
    const plain = await upload(fixtureFiles.plain(), false);
    const bundle = await upload(fixtureFiles.bundle(), true);

    // A pasted link, fragment and all, as someone would paste it.
    await client.links.resolve(encrypted.downloadUrl);

    for (const page of ['/', `/${encrypted.id}`, `/${plain.id}`, `/b/${bundle.id}`, `/p2p/${P2P_CODE}`]) {
        await (await recorder.fetch(server.baseUrl + page)).arrayBuffer();
    }

    // Downloads up to each limit. The bundle counts only as a whole ("Download All as ZIP").
    const sink = () => ({ write: () => {}, close: () => {} });
    completed(await client.hosted.download({ id: encrypted.id, secret: encrypted.secret, sink: sink() }).result);
    completed(await client.hosted.download({ id: plain.id, sink: sink() }).result);
    completed(await client.hosted.download({ bundleId: bundle.id, keyB64: bundle.secret, asZip: true, sink: sink() }).result);

    if (faults) {
        await recorder.fetch(`${server.baseUrl}/api/resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: `{"value": ${BODY_MARKER}}`,
        });
        recorder.note(BODY_MARKER);

        // A record whose stored object has gone, as when expiry races a download.
        const orphan = await upload(mkFile('about-to-go-missing.txt', 1_000, 6), false);
        fs.rmSync(path.join(server.uploadsDir, 'objects', orphan.id));
        const { lease } = await (await recorder.fetch(`${server.baseUrl}/api/v4/objects/${orphan.id}/leases`, { method: 'POST' })).json();
        recorder.note(lease);
        await (await recorder.fetch(`${server.baseUrl}/api/v4/objects/${orphan.id}/content`, { headers: { 'Dropgate-Lease': lease } })
            .catch(() => new Response())).arrayBuffer();
    }

    return {
        secrets: recorder.secrets, responses: recorder.responses, uploads: { encrypted, plain, bundle }, fetch: recorder.fetch,
        credentialRequests, authorized: recorder.authorized, memberIds: recorder.memberIds,
    };
}
