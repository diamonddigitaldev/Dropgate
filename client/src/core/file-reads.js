'use strict';

const fs = require('fs');
const path = require('path');

/**
 * The files the page may read ranges of: those main handed it, from Open
 * File, a drop, or Share with Dropgate, each with its size and modification
 * time when it was handed over.
 *
 * Like a browser's File, and core's sources.fileHandle(), a file can't be read
 * once it has changed since: each read checks its size and modification time
 * are still what they were, and answers { changed: true } if not, which the
 * page's LazyFile turns into core's SOURCE_UNAVAILABLE. So a file edited while
 * its upload runs, or while it's paused, is never sent part old, part new (v3
 * sent it mixed). Main keeps all of it in memory only.
 */
class FileReads {
    /** @type {Map<string, { size: number, mtimeMs: number }>} */
    #handedOver = new Map();

    /**
     * A file on disk, handed to the page: it may read it from now on, as it is now.
     * @param {string} filePath
     * @returns {{ name: string, size: number, filePath: string }}
     */
    handOver(filePath) {
        const { size, mtimeMs } = fs.statSync(filePath);
        this.#handedOver.set(filePath, { size, mtimeMs });
        return { name: path.basename(filePath), size, filePath };
    }

    /** The page is done with a file. */
    revoke(filePath) {
        this.#handedOver.delete(filePath);
    }

    /**
     * Bytes `start` to `end` of a file handed over, or { changed: true } if it
     * has changed since. Near the end of the file it gives what there is.
     * @param {string} filePath
     * @param {number} start
     * @param {number} end
     * @returns {Buffer | { changed: true }}
     */
    read(filePath, start, end) {
        const handed = this.#handedOver.get(filePath);
        if (!handed) throw new Error('File access not authorized.');
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
            throw new Error('Expected a range of bytes.');
        }

        const fd = fs.openSync(filePath, 'r');
        try {
            // The file now, through the descriptor read from, so it can't be swapped in between.
            const now = fs.fstatSync(fd);
            if (now.size !== handed.size || now.mtimeMs !== handed.mtimeMs) return { changed: true };
            const length = end - start;
            const buffer = Buffer.alloc(length);
            const bytesRead = fs.readSync(fd, buffer, 0, length, start);
            return bytesRead < length ? buffer.subarray(0, bytesRead) : buffer;
        } finally {
            fs.closeSync(fd);
        }
    }
}

module.exports = { FileReads };
