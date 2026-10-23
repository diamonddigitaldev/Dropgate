// What the desktop app leaves in its profile: every file under it, searched
// for a text in each way the app or Chromium would write it, for any part of
// a file's bytes, and for a 32-byte secret known only by its hash (an
// upload's manage token). desktop/profile.spec.mjs, desktop/tray.spec.mjs,
// desktop/delete-upload.spec.mjs, desktop/nothing-kept.spec.mjs and
// desktop/servers.spec.mjs scan the whole profile with it after a run.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { holdsPlaintext } from './files.mjs';

/** Every file under a folder, with its bytes. */
function filesUnder(dir) {
    return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(entry.parentPath, entry.name))
        .map((file) => ({ file, bytes: fs.readFileSync(file) }));
}

/** Each way a text could be written: as it is, URL-encoded, JSON-escaped, with / for \, in UTF-8 and UTF-16. */
function forms(text) {
    const texts = new Set([text, encodeURIComponent(text), JSON.stringify(text).slice(1, -1), text.replaceAll('\\', '/')]);
    return [...texts].flatMap((t) => [Buffer.from(t, 'utf8'), Buffer.from(t, 'utf16le')]);
}

/**
 * The files in the profile holding any of the texts, or any part of the bytes.
 * @param {string} profile
 * @param {{ texts: string[], bytes: Buffer[] }} what
 * @returns {string[]} each file, relative to the profile, and what it holds
 */
export function heldIn(profile, { texts, bytes }) {
    const found = [];
    for (const { file, bytes: held } of filesUnder(profile)) {
        const name = path.relative(profile, file);
        for (const text of texts) {
            if (forms(text).some((form) => held.includes(form))) found.push(`${name}: "${text}"`);
        }
        for (const plaintext of bytes) {
            // A piece every 64 KiB: a cache of any of it would hold one.
            if (holdsPlaintext(held, plaintext, { every: 65_536 })) found.push(`${name}: the file's bytes`);
        }
    }
    return found;
}

/**
 * Whether a text holds a 32-byte secret, in base64url, whose SHA-256 is
 * `hash` (base64url): every 43 characters in a row that base64url can hold,
 * hashed. An upload's manage token is known to its server only by that hash,
 * so it can be found this way where it was never sent.
 * @param {string} text
 * @param {string} hash
 */
export function holdsSecretHashed(text, hash) {
    for (const [run] of text.matchAll(/[A-Za-z0-9_-]{43,}/g)) {
        for (let i = 0; i + 43 <= run.length; i++) {
            if (createHash('sha256').update(Buffer.from(run.slice(i, i + 43), 'base64url')).digest('base64url') === hash) return true;
        }
    }
    return false;
}

/**
 * The files in the profile holding a 32-byte secret by its hash, written as
 * base64url text, in UTF-8 or UTF-16 (holdsSecretHashed()).
 * @param {string} profile
 * @param {string} hash
 * @returns {string[]} each file, relative to the profile
 */
export function secretHashedIn(profile, hash) {
    return filesUnder(profile)
        .filter(({ bytes }) => [bytes.toString('latin1'), bytes.toString('utf16le'), bytes.subarray(1).toString('utf16le')].some((text) => holdsSecretHashed(text, hash)))
        .map(({ file }) => path.relative(profile, file));
}
