// Raw DGUP calls, for tests that need to stop part-way through an upload.
import { createHash } from 'node:crypto';

export const HOUR_MS = 60 * 60 * 1000;
// Upload sessions expire 2 minutes after their last activity.
export const PAST_SESSION_EXPIRY_MS = 3 * 60 * 1000;

export const postJson = (server, route, body) => fetch(server.baseUrl + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

export const sendChunk = (server, uploadId, index, bytes) => fetch(`${server.baseUrl}/upload/chunk`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/octet-stream',
        'X-Upload-ID': uploadId,
        'X-Chunk-Index': String(index),
        'X-Chunk-Hash': createHash('sha256').update(bytes).digest('hex'),
    },
    body: bytes,
});

/**
 * A Dropgate 3 bundle, sent on Dropgate 3's routes as Dropgate 3's client sent
 * one: each file its own upload, finished on its own, then the bundle. Its
 * names are sent as they are, or, encrypted, as stand-ins for the encrypted
 * names, and a sealed one gets a stand-in for its encrypted list. No client
 * makes one now; these routes go with the rest of Dropgate 3's.
 */
export async function uploadV3Bundle(server, { encrypted = false, sealed = false, sizes = [1000, 2000, 3000], lifetime = HOUR_MS, maxDownloads } = {}) {
    const names = sizes.map((_, i) => (encrypted ? `c2VhbGVkLW5hbWUt${i}` : `v3-member-${i}.txt`));
    const init = await postJson(server, '/upload/init-bundle', {
        fileCount: sizes.length, isEncrypted: encrypted, lifetime,
        ...(maxDownloads !== undefined ? { maxDownloads } : {}),
        files: sizes.map((size, i) => ({ filename: names[i], totalSize: size, totalChunks: 1 })),
    });
    if (!init.ok) throw new Error(`init-bundle answered ${init.status}`);
    const { bundleUploadId, fileUploadIds } = await init.json();
    const memberIds = [];
    for (const [i, uploadId] of fileUploadIds.entries()) {
        const sent = await sendChunk(server, uploadId, 0, new Uint8Array(sizes[i]).fill(i + 1));
        if (!sent.ok) throw new Error(`a chunk answered ${sent.status}`);
        memberIds.push((await (await postJson(server, '/upload/complete', { uploadId })).json()).id);
    }
    const done = await postJson(server, '/upload/complete-bundle', {
        bundleUploadId, ...(sealed ? { encryptedManifest: Buffer.alloc(64, 9).toString('base64') } : {}),
    });
    if (!done.ok) throw new Error(`complete-bundle answered ${done.status}`);
    return { bundleId: (await done.json()).bundleId, memberIds, names };
}

export const initUpload = async (server, totalSize, totalChunks, { lifetime = HOUR_MS, isEncrypted = false } = {}) => {
    const res = await postJson(server, '/upload/init', {
        filename: 'cleanup-test.bin', lifetime, isEncrypted, totalSize, totalChunks,
    });
    return { status: res.status, uploadId: res.ok ? (await res.json()).uploadId : null };
};
