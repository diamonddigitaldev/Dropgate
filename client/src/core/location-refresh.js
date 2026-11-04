'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');
const { BASE_URL, DATABASES, DOWNLOAD_MS, MAX_PACKED_BYTES, checkDatabase, unpack, urlOf } = require('./location');

// The monthly refresh of the location data, with no Electron: only with its
// switch on, only when main says (once a launch, when the data held is from an
// earlier month than this one), the network service downloads that month's two
// files from DB-IP, as the build does, and keeps them in the profile only if
// both are DB-IP's of that month, checked as the build checks its own
// (location.js' checkDatabase()). Neither is written until both are good.
//
// Each connection is opened as the service says (route): with an adapter
// chosen, from its address, to the address the name was looked up as through
// it (and on Linux, its route checked); with none, as the OS routes it. Only
// HTTPS, and a redirect only to HTTPS. db-ip.com sees the IP it came from, and
// that it was downloaded: nothing else is sent, and nothing of the person is
// in what's kept, which is public data.

/** The most redirects followed for one file. */
const MAX_REDIRECTS = 3;

/** Why a refresh kept nothing: the files couldn't be had, or weren't DB-IP's. */
const refused = (error) => Object.assign(error, { refused: true });

/** A lookup that answers with the address already found, however Node asks it. */
const answering = ({ address, family }) => (_name, options, callback) => (options?.all ? callback(null, [{ address, family }]) : callback(null, address, family));

/**
 * One answer: the body of a 200 (MAX_PACKED_BYTES at most), or where a redirect points.
 * @param {URL} url
 * @param {{ address: string, family: 4 | 6, local?: string } | null} via
 * @param {AbortSignal} signal
 * @param {typeof https.request} request
 * @returns {Promise<{ body: Buffer } | { location: string }>}
 */
function getOnce(url, via, signal, request) {
    return new Promise((resolve, reject) => {
        const options = {
            method: 'GET',
            signal,
            agent: false,
            headers: { 'Accept-Encoding': 'identity' },
            ...(via ? { family: via.family, lookup: answering(via), ...(via.local ? { localAddress: via.local } : {}) } : {}),
        };
        const asked = request(url, options, (response) => {
            const { statusCode, headers } = response;
            if (statusCode >= 300 && statusCode < 400 && headers.location) {
                response.resume();
                resolve({ location: headers.location });
                return;
            }
            if (statusCode !== 200) {
                response.resume();
                reject(Object.assign(new Error(`${url.origin}${url.pathname} answered ${statusCode}.`), { status: statusCode }));
                return;
            }
            const chunks = [];
            let length = 0;
            response.on('data', (chunk) => {
                length += chunk.length;
                if (length > MAX_PACKED_BYTES) {
                    asked.destroy(refused(new Error(`${url.origin}${url.pathname} is more than ${MAX_PACKED_BYTES} bytes, far more than it should be.`)));
                    return;
                }
                chunks.push(chunk);
            });
            response.on('end', () => resolve({ body: Buffer.concat(chunks) }));
            response.on('error', reject);
        });
        asked.on('error', reject);
        asked.end();
    });
}

/**
 * One file's bytes, as DB-IP sends them, following a few redirects, each to HTTPS.
 * @param {string} url
 * @param {object} options
 * @param {(host: string) => Promise<{ address: string, family: 4 | 6, local?: string } | null>} options.route - How to connect to a host: null, as the OS routes it.
 * @param {AbortSignal} options.signal
 * @param {typeof https.request} [options.request]
 * @returns {Promise<Buffer>}
 */
async function getFile(url, { route, signal, request = https.request }) {
    let next = new URL(url);
    for (let redirects = 0; ; redirects++) {
        if (next.protocol !== 'https:') throw refused(new Error(`${next.origin} isn't HTTPS.`));
        const answer = await getOnce(next, await route(next.hostname), signal, request);
        if (answer.body) return answer.body;
        if (redirects === MAX_REDIRECTS) throw new Error(`${url} redirected more than ${MAX_REDIRECTS} times.`);
        next = new URL(answer.location, next);
    }
}

/**
 * Download a month's two files, check both, then keep both, in place of any
 * there: none is written unless both are DB-IP's of that month.
 * @param {object} options
 * @param {string} options.month - As 2026-11.
 * @param {string} options.folder - Where they're kept.
 * @param {(host: string) => Promise<{ address: string, family: 4 | 6, local?: string } | null>} options.route
 * @param {AbortSignal} options.signal
 * @param {typeof https.request} [options.request]
 * @param {string} [options.base] - DB-IP's address for them.
 * @param {number} [options.minNodes]
 * @returns {Promise<string>} The month kept. A failure says whether the files were had and refused (`refused`).
 */
async function refreshLocation({ month, folder, route, signal, request, base = BASE_URL, minNodes }) {
    const taken = [];
    for (const [kind, { file }] of Object.entries(DATABASES)) {
        const url = urlOf(kind, month, base);
        const packed = await getFile(url, { route, signal: AbortSignal.any([signal, AbortSignal.timeout(DOWNLOAD_MS)]), request });
        try {
            const bytes = await unpack(packed);
            checkDatabase(kind, bytes, { month, minNodes });
            taken.push({ file, bytes });
        } catch (error) {
            throw refused(new Error(`${url}: ${error.message}`, { cause: error }));
        }
    }
    if (signal.aborted) throw signal.reason;
    await fs.promises.mkdir(folder, { recursive: true });
    const places = taken.map(({ file }) => path.join(folder, file));
    try {
        for (const [index, { bytes }] of taken.entries()) await fs.promises.writeFile(`${places[index]}.next`, bytes);
        for (const place of places) await fs.promises.rename(`${place}.next`, place);
    } finally {
        await Promise.all(places.map((place) => fs.promises.rm(`${place}.next`, { force: true })));
    }
    return month;
}

module.exports = { MAX_REDIRECTS, getFile, refreshLocation };
