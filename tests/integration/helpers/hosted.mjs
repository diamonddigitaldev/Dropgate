// An upload to the test's server made here, in Node, with the client's own
// copy of core (the build the desktop app and its transfer window run), so a
// desktop test has a link to download: any number of bytes, under names no
// file on disk could have (CON.txt, a:b, a trailing dot), end-to-end
// encrypted or not.
import { DropgateClient } from '../../../client/src/dropgate-core.js';

/** A file core can upload: its name, its size, and its bytes by range. */
const sourceOf = ({ name, buffer }) => ({
    name,
    size: buffer.length,
    read: async (start, end) => new Uint8Array(buffer.subarray(start, end)),
});

/**
 * Upload files to the server as one upload, and give its link and ID.
 * @param {{ baseUrl: string }} server - The test's server (plain HTTP, on this machine).
 * @param {{ name: string, buffer: Buffer }[]} files
 * @param {object} [opts]
 * @param {boolean} [opts.encrypt] - End-to-end encrypted (default), or not.
 * @param {number} [opts.maxDownloads]
 * @returns {Promise<{ link: string, id: string }>}
 */
export async function uploadWithCore(server, files, { encrypt = true, maxDownloads = 1 } = {}) {
    const client = new DropgateClient({ server: server.baseUrl, allowInsecure: true, fetchFn: fetch });
    const sources = files.map(sourceOf);
    const upload = client.hosted.upload({ files: sources.length === 1 ? sources[0] : sources, lifetimeMs: 3_600_000, maxDownloads, encrypt });
    const outcome = await upload.result;
    if (outcome.status !== 'completed') throw new Error(`The test's upload didn't complete: ${outcome.status} ${outcome.error?.code ?? ''} ${outcome.error?.message ?? ''}`);
    return { link: outcome.value.downloadUrl, id: outcome.value.id };
}
