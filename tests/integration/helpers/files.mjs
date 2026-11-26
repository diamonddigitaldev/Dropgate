// Made-up test files, and ways to compare and unpack what comes back.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

/** Deterministic pseudo-random bytes (xorshift32), so every file is made up but repeatable. */
export function madeUpBytes(size, seed) {
    const bytes = Buffer.alloc(size);
    let x = (seed >>> 0) || 1;
    for (let i = 0; i < size; i++) {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        bytes[i] = x & 0xff;
    }
    return bytes;
}

/** A file for setInputFiles(). */
export const madeUpFile = (name, size, seed) => ({ name, mimeType: 'application/octet-stream', buffer: madeUpBytes(size, seed) });

/**
 * A file on disk of `size` bytes, all zeros, that takes next to no space: a
 * sparse file, so a test can hand over several GB with nothing written. It's
 * made in a new folder of its own in the system's temp folder, not in
 * test-results/, which CI keeps when a test fails; remove() deletes the folder.
 * Windows makes a file sparse only when asked (fsutil, which needs no
 * administrator for it); Linux makes one sparse when it's extended past its
 * end, and that's checked, so a test never fills the disk.
 * @param {string} name
 * @param {number} size
 * @returns {{ dir: string, path: string, remove: () => void }}
 */
export function sparseFile(name, size) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dropgate-sparse-'));
    const remove = () => fs.rmSync(dir, { recursive: true, force: true });
    const file = path.join(dir, name);
    try {
        fs.writeFileSync(file, '');
        if (process.platform === 'win32') execFileSync('fsutil', ['sparse', 'setflag', file], { stdio: 'ignore' });
        fs.truncateSync(file, size);
        const { blocks } = fs.statSync(file);
        if (process.platform !== 'win32' && blocks * 512 > 1024 * 1024) throw new Error(`${file} isn't sparse: ${blocks} blocks on disk.`);
    } catch (err) {
        remove();
        throw err;
    }
    return { dir, path: file, remove };
}

/** Size and SHA-256, so a mismatch reads well in a test failure. */
export const summary = (bytes) => ({ size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });

/**
 * Whether any 32-byte piece of the plaintext, taken every 4 KiB, appears in the
 * haystack. Encrypted output should contain none of them.
 */
export function holdsPlaintext(haystack, plaintext, { piece = 32, every = 4096 } = {}) {
    for (let i = 0; i + piece <= plaintext.length; i += every) {
        if (haystack.includes(plaintext.subarray(i, i + piece))) return true;
    }
    return false;
}

/**
 * Every entry in a ZIP file, as { name, bytes }, read from the central directory.
 * Handles stored and deflated entries, and checks each one's CRC-32.
 */
export function readZip(zip) {
    const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) throw new Error('No end of central directory record: not a ZIP file.');
    const count = zip.readUInt16LE(eocd + 10);
    let at = zip.readUInt32LE(eocd + 16);

    const entries = [];
    for (let n = 0; n < count; n++) {
        if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error(`Bad central directory entry ${n}.`);
        const method = zip.readUInt16LE(at + 10);
        const crc = zip.readUInt32LE(at + 16);
        const compressedSize = zip.readUInt32LE(at + 20);
        const nameLength = zip.readUInt16LE(at + 28);
        const extraLength = zip.readUInt16LE(at + 30);
        const commentLength = zip.readUInt16LE(at + 32);
        const localOffset = zip.readUInt32LE(at + 42);
        const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
        at += 46 + nameLength + extraLength + commentLength;

        if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Bad local header for ${name}.`);
        const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
        const data = zip.subarray(dataStart, dataStart + compressedSize);
        let bytes;
        if (method === 0) bytes = Buffer.from(data);
        else if (method === 8) bytes = zlib.inflateRawSync(data);
        else throw new Error(`${name} uses compression method ${method}.`);
        if (zlib.crc32(bytes) !== crc) throw new Error(`${name} fails its CRC-32 check.`);
        entries.push({ name, bytes });
    }
    return entries;
}
