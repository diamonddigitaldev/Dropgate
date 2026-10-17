'use strict';

const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const { READ_PIECE_BYTES } = require('../constants');
// Core's file name rule, for the name a received file is saved under: the
// same code the transfer window runs (the client's copy of core's build).
const { filenames } = require('../dropgate-core.js');

/** A grant's ID: a UUID main made. */
const GRANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The keys each request has, and no others. */
const KEYS = Object.freeze({
    read: ['end', 'handle', 'id', 'op', 'start'],
    open: ['id', 'index', 'name', 'op', 'output', 'size'],
    write: ['bytes', 'id', 'op', 'sink'],
    close: ['id', 'op', 'sink'],
    abort: ['id', 'op', 'sink'],
});

/** How an output may be written: one file (a bundle's files and a ZIP come later). */
const SHAPES = Object.freeze(['file']);

/** The longest name the transfer window may ask for: core refuses one over 255 bytes of UTF-8. */
const MAX_NAME = 255;

/** Why a write failed, for the person: by the system's error code, never with a path. */
function writeFailure(error, doing) {
    switch (error?.code) {
        case 'ENOSPC': return 'There is no space left on the disk.';
        case 'ENAMETOOLONG': return "The folder's path and the file's name are too long together.";
        case 'ENOENT':
        case 'ENOTDIR': return "The folder to save to isn't there any more.";
        case 'EACCES':
        case 'EPERM': return "The folder to save to can't be written to.";
        case 'EROFS': return 'The folder to save to is on a disk that is read-only.';
        default: return `The file couldn't be ${doing}.`;
    }
}

/**
 * The file service's reads and writes: the files main granted it, for the
 * uploads that are running, and the outputs main granted it, for the
 * downloads that are. Everything is in memory only.
 *
 * Reads: the transfer window asks for a range of a file by its grant, never
 * by a path, and only main makes a grant. Like a browser's File, and core's
 * sources.fileHandle(), a file can't be read once it has changed since it was
 * handed over: each read checks its size and modification time through the
 * descriptor it reads from, and answers { changed: true } if they're not what
 * they were, which the transfer window turns into core's SOURCE_UNAVAILABLE.
 * So a file edited while its upload runs, or while it's paused, is never sent
 * part old, part new. The descriptor stays open until the grant is revoked.
 *
 * Writes: main grants an output (a folder, for one download), and the
 * transfer window opens a file in it by the output, with the name the upload
 * gave it, which isn't trusted: it's made safe (core's filenames.sanitize(),
 * the same name on every OS, nothing of a path or a stream left in it) and
 * unique in the folder (filenames.unique(), "report (1).pdf", without regard
 * to case, against the files there and those other downloads are writing
 * there), and the answer says the name it will be saved under. Until it's
 * whole, it's written in the partial folder (the app's profile) under a
 * random name of no meaning, its descriptor open, paused or not. Closed, it's
 * moved into place under its name, never replacing anything: a hard link and
 * the partial unlinked on the same drive, or a copy that fails if the name is
 * taken (onto another), and on a name taken meanwhile, the next unique one.
 * The folder is checked by its real path as the file is opened and again as
 * it's moved, so a folder swapped for a link in between is refused, and a
 * link planted under the name is never followed. A file aborted, or one that
 * can't be finished, is deleted, and nothing is left of it.
 */
class FileService {
    /** @type {Map<string, { path: string, size: number, mtimeMs: number, fd: number | null }>} */
    #grants = new Map();
    /** @type {Map<string, { folder: string, shape: string, sinks: Set<string> }>} */
    #outputs = new Map();
    /** @type {Map<string, { output: string, folder: string, name: string, size: number, written: number, fd: number | null, partial: string, closing: boolean }>} */
    #sinks = new Map();
    #partials;
    #onSaved;

    /**
     * @param {object} [options]
     * @param {string} [options.partials] - The partial folder, where downloads are written until they're whole.
     * @param {(saved: { output: string, path: string }) => void} [options.onSaved] - A download is in place.
     */
    constructor({ partials, onSaved = () => {} } = {}) {
        this.#partials = partials;
        this.#onSaved = onSaved;
    }

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

    /**
     * An output main has granted: a download may write its file into this
     * folder from now on.
     * @param {{ output: string, folder: string, shape: string }} grant
     */
    grantOutput({ output, folder, shape } = {}) {
        if (typeof output !== 'string' || !GRANT_ID.test(output)) throw new Error('Expected an output.');
        if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new Error('Expected a folder.');
        if (!SHAPES.includes(shape)) throw new Error('Expected how the download is saved.');
        if (typeof this.#partials !== 'string' || !path.isAbsolute(this.#partials)) throw new Error('Expected the partial folder.');
        this.revokeOutput(output);
        this.#outputs.set(output, { folder, shape, sinks: new Set() });
    }

    /** The upload is done with a file: its descriptor is closed, and it can't be read again. */
    revoke(handle) {
        const grant = this.#grants.get(handle);
        if (!grant) return;
        this.#grants.delete(handle);
        if (grant.fd !== null) fs.closeSync(grant.fd);
    }

    /** The download is done with its output: a file still being written there is deleted, and nothing more can be. */
    revokeOutput(output) {
        const granted = this.#outputs.get(output);
        if (!granted) return;
        this.#outputs.delete(output);
        for (const sink of granted.sinks) this.#discard(sink);
    }

    /** Every grant and output revoked, as the service stops: nothing partial is left. */
    revokeAll() {
        for (const handle of [...this.#grants.keys()]) this.revoke(handle);
        for (const output of [...this.#outputs.keys()]) this.revokeOutput(output);
    }

    /**
     * The answer to one of the transfer window's requests, or a promise of it
     * (a close, which can copy a whole file). Each gives `{ id, … }`:
     * - `read { handle, start, end }`: `{ bytes }`, bytes `start` to `end` of a
     *   granted file, at most READ_PIECE_BYTES and never past its end;
     *   `{ changed: true }` if it has changed since it was handed over;
     *   `{ gone: true }` if it can't be opened any more;
     * - `open { output, name, size, index }`: `{ sink, name }`, the file's
     *   sink and the name it will be saved under;
     * - `write { sink, bytes }`: `{ ok: true }`, never past the size it was opened with;
     * - `close { sink }`: `{ ok: true, name }`, the file whole and in place, under that name;
     * - `abort { sink }`: `{ ok: true }`, the file deleted;
     * - `{ failed }` with the reason, for the person, when a file couldn't be
     *   written or put in place (and then nothing of it is left);
     * - `{ error }` for a request refused: one of the wrong shape, an unknown
     *   grant, output or sink (a path is never one), a revoked one, or a
     *   range or size that isn't whole numbers inside the file.
     * @param {unknown} request
     */
    answer(request) {
        const id = Number.isSafeInteger(request?.id) && request.id >= 0 ? request.id : null;
        const refuse = (why) => ({ id, error: `Refused: ${why}` });
        const keys = typeof request === 'object' && request !== null && typeof request.op === 'string' && Object.hasOwn(KEYS, request.op) ? KEYS[request.op] : null;
        if (id === null || !keys || Object.keys(request).sort().join() !== keys.join()) return refuse('not a request.');
        switch (request.op) {
            case 'read': return this.#read(request, refuse);
            case 'open': return this.#open(request, refuse);
            case 'write': return this.#write(request, refuse);
            case 'close': return this.#close(request, refuse);
            default: return this.#abort(request, refuse);
        }
    }

    #read({ id, handle, start, end }, refuse) {
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

    #open({ id, output, name, size, index }, refuse) {
        const granted = typeof output === 'string' ? this.#outputs.get(output) : undefined;
        if (!granted) return refuse('not an output this download may write.');
        if (typeof name !== 'string' || name.length === 0 || name.length > MAX_NAME || !Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(index) || index < 0) {
            return refuse('not a file to save.');
        }
        if (granted.shape === 'file' && granted.sinks.size > 0) return refuse('this output saves one file.');

        let folder;
        try {
            folder = fs.realpathSync(granted.folder);
            if (!fs.statSync(folder).isDirectory()) return { id, failed: "The folder to save to isn't there any more." };
        } catch (error) {
            return { id, failed: writeFailure(error, 'saved') };
        }
        const safe = this.#uniqueIn(folder, filenames.sanitize(name));
        const partial = path.join(this.#partials, randomUUID());
        let fd;
        try {
            fs.mkdirSync(this.#partials, { recursive: true });
            // Never one there already: a new file, readable by this user alone.
            fd = fs.openSync(partial, 'wx', 0o600);
        } catch (error) {
            return { id, failed: writeFailure(error, 'written') };
        }
        const sink = randomUUID();
        this.#sinks.set(sink, { output, folder, name: safe, size, written: 0, fd, partial, closing: false });
        granted.sinks.add(sink);
        return { id, sink, name: safe };
    }

    #write({ id, sink, bytes }, refuse) {
        const open = typeof sink === 'string' ? this.#sinks.get(sink) : undefined;
        if (!open || open.closing) return refuse('not a file being written.');
        if (!(bytes instanceof Uint8Array) || open.written + bytes.byteLength > open.size) return refuse('not bytes of the file.');
        try {
            let at = 0;
            while (at < bytes.byteLength) at += fs.writeSync(open.fd, bytes, at, bytes.byteLength - at);
        } catch (error) {
            this.#discard(sink);
            return { id, failed: writeFailure(error, 'written') };
        }
        open.written += bytes.byteLength;
        return { id, ok: true };
    }

    async #close({ id, sink }, refuse) {
        const open = typeof sink === 'string' ? this.#sinks.get(sink) : undefined;
        if (!open || open.closing) return refuse('not a file being written.');
        if (open.written !== open.size) {
            this.#discard(sink);
            return { id, failed: 'The download ended before the whole file came.' };
        }
        open.closing = true;
        let saved;
        try {
            fs.fsyncSync(open.fd);
            fs.closeSync(open.fd);
            open.fd = null;
            saved = await this.#moveIntoPlace(open);
        } catch (error) {
            this.#discard(sink);
            return { id, failed: writeFailure(error, 'saved') };
        }
        this.#forget(sink);
        this.#onSaved({ output: open.output, path: saved });
        return { id, ok: true, name: path.basename(saved) };
    }

    #abort({ id, sink }, refuse) {
        if (typeof sink !== 'string' || !this.#sinks.has(sink)) return refuse('not a file being written.');
        this.#discard(sink);
        return { id, ok: true };
    }

    /**
     * The partial file, moved into its folder under its name, replacing
     * nothing: a hard link on the same drive, a copy onto another, each of
     * which fails if the name is taken, and then the next unique name is
     * tried. The folder must still be the one the file was opened for (by its
     * real path), and the file lands directly in it. Gives its path.
     */
    async #moveIntoPlace(open) {
        if (fs.realpathSync(open.folder) !== open.folder) throw Object.assign(new Error('The folder changed.'), { code: 'EPERM' });
        let copying = false;
        for (;;) {
            const target = path.join(open.folder, open.name);
            if (path.dirname(target) !== open.folder) throw Object.assign(new Error('Not in the folder.'), { code: 'EPERM' });
            try {
                if (copying) await fs.promises.copyFile(open.partial, target, fs.constants.COPYFILE_EXCL);
                else fs.linkSync(open.partial, target);
                fs.rmSync(open.partial, { force: true });
                return target;
            } catch (error) {
                if (error?.code === 'EEXIST') {
                    open.name = this.#uniqueIn(open.folder, open.name, open);
                } else if (!copying && ['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EINVAL', 'ENOSYS', 'EMLINK'].includes(error?.code)) {
                    // Another drive, or one that has no hard links (FAT, exFAT, a share): a copy instead.
                    copying = true;
                } else {
                    // A copy that got part-way leaves nothing behind.
                    if (copying) fs.rmSync(target, { force: true });
                    throw error;
                }
            }
        }
    }

    /**
     * A made-safe name, made unique in a folder: against what's there, and
     * the names other downloads are writing there, without regard to case.
     */
    #uniqueIn(folder, name, except = null) {
        const writing = [...this.#sinks.values()].filter((other) => other !== except && other.folder === folder).map((other) => other.name.toLowerCase());
        let there;
        try {
            there = new Set(fs.readdirSync(folder).map((entry) => entry.toLowerCase()));
        } catch {
            there = new Set();
        }
        const taken = new Set([...there, ...writing]);
        // A name taken by the folder's own listing, or by one that appeared since (lstat: a link counts, followed or not).
        return filenames.unique(name, (candidate) => taken.has(candidate.toLowerCase()) || exists(path.join(folder, candidate)));
    }

    /** A sink's file deleted, and the sink forgotten. */
    #discard(sink) {
        const open = this.#sinks.get(sink);
        if (!open) return;
        try {
            if (open.fd !== null) fs.closeSync(open.fd);
        } catch {
            // Closed already.
        }
        open.fd = null;
        fs.rmSync(open.partial, { force: true });
        this.#forget(sink);
    }

    #forget(sink) {
        const open = this.#sinks.get(sink);
        this.#sinks.delete(sink);
        if (open) this.#outputs.get(open.output)?.sinks.delete(sink);
    }
}

/** Whether anything is at a path, a link (even one to nothing) included. */
function exists(target) {
    try {
        fs.lstatSync(target);
        return true;
    } catch {
        return false;
    }
}

module.exports = { FileService, GRANT_ID };
