// What the desktop app leaves in its profile: every file under it, searched
// for a text in each way the app or Chromium would write it, and for any part
// of a file's bytes. desktop/profile.spec.mjs and desktop/tray.spec.mjs scan
// with it after a run (09 13.10's whole-profile scan).
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
