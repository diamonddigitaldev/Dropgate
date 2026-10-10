'use strict';

const fs = require('fs');
const path = require('path');
const { READ_PIECE_BYTES } = require('../constants');

/** A grant's ID: a UUID main made. */
const GRANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The keys a read request has, and no others. */
const READ_KEYS = ['end', 'handle', 'id', 'op', 'start'];

/**
 * The file service's reads: the files main granted it, for the uploads that
 * are running, each with the size and modification time the file had when it
 * was handed over.
 *
 * The transfer window asks for a range of one of them by its grant, never by
 * a path, and only main makes a grant. Like a browser's File, and core's
 * sources.fileHandle(), a file can't be read once it has changed since it was
 * handed over: each read checks its size and modification time through the
 * descriptor it reads from, and answers { changed: true } if they're not what
 * they were, which the transfer window turns into core's SOURCE_UNAVAILABLE.
 * So a file edited while its upload runs, or while it's paused, is never sent
 * part old, part new. The descriptor stays open until the grant is revoked.
 * Everything is in memory only.
 */
class FileService {
    /** @type {Map<string, { path: string, size: number, mtimeMs: number, fd: number | null }>} */
    #grants = new Map();

    /**
     * A file main has granted: its uploader may read it from now on, as it
     * was when it was handed over.
     * @param {{ handle: string, path: string, size: number, mtimeMs: number }} grant
     */
    grantRead({ handle, path: filePath, size, mtimeMs } = {}) {
        if (typeof handle !== 'string' || !GRANT_ID.test(handle)) throw new Error('Expected a grant.');
        if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Expected a file.');
        if (!Number.isSafeInteger(size) || size < 0 || !Number.isFinite(mtimeMs)) throw new Error('Expected the file as it was handed over.');
        this.revoke(handle);
        this.#grants.set(handle, { path: filePath, size, mtimeMs, fd: null });
    }

    /** The upload is done with a file: its descriptor is closed, and it can't be read again. */
    revoke(handle) {
        const grant = this.#grants.get(handle);
        if (!grant) return;
        this.#grants.delete(handle);
        if (grant.fd !== null) fs.closeSync(grant.fd);
    }

    /** Every grant revoked, as the service stops. */
    revokeAll() {
        for (const handle of [...this.#grants.keys()]) this.revoke(handle);
    }

    /**
     * The answer to one of the transfer window's requests: `{ id, op: 'read',
     * handle, start, end }` gives `{ id, bytes }`, bytes `start` to `end` of a
     * granted file, at most READ_PIECE_BYTES and never past its end; `{ id,
     * changed: true }` if the file has changed since it was handed over; `{ id,
     * gone: true }` if it can't be opened any more; and `{ id, error }` for a
     * request refused: an unknown handle (a path is never one), a revoked one,
     * or a range that isn't whole numbers inside the file.
     * @param {unknown} request
     */
    answer(request) {
        const id = Number.isSafeInteger(request?.id) && request.id >= 0 ? request.id : null;
        const refuse = (why) => ({ id, error: `Refused: ${why}` });
        if (id === null || typeof request !== 'object' || Object.keys(request).sort().join() !== READ_KEYS.join() || request.op !== 'read') {
            return refuse('not a read request.');
        }
        const { handle, start, end } = request;
        const grant = typeof handle === 'string' ? this.#grants.get(handle) : undefined;
        if (!grant) return refuse('not a file this upload may read.');
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > grant.size || end - start > READ_PIECE_BYTES) {
            return refuse('not a range of the file.');
        }

        if (grant.fd === null) {
            try {
                grant.fd = fs.openSync(grant.path, 'r');
            } catch {
                return { id, gone: true };
            }
        }
        // The file now, through the descriptor read from, so it can't be swapped in between.
        const now = fs.fstatSync(grant.fd);
        if (now.size !== grant.size || now.mtimeMs !== grant.mtimeMs) return { id, changed: true };
        const length = end - start;
        const bytes = Buffer.alloc(length);
        let read = 0;
        while (read < length) {
            const got = fs.readSync(grant.fd, bytes, read, length - read, start + read);
            if (got === 0) return { id, changed: true };
            read += got;
        }
        return { id, bytes };
    }
}

module.exports = { FileService, GRANT_ID };
