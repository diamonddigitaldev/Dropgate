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

export const initUpload = async (server, totalSize, totalChunks) => {
    const res = await postJson(server, '/upload/init', {
        filename: 'cleanup-test.bin', lifetime: HOUR_MS, isEncrypted: false, totalSize, totalChunks,
    });
    return { status: res.status, uploadId: res.ok ? (await res.json()).uploadId : null };
};
