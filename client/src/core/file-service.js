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

/**
 * How an output may be written: one file, straight into its folder; a
 * bundle's files, into a new folder of their own in it, all of them or none;
 * or a bundle as one ZIP, straight into its folder.
 */
const SHAPES = Object.freeze(['file', 'files', 'zip']);

/** The most files one bundle's output may save: as many as one request may name (core/payloads.js). */
const MOST_FILES = 10_000;

/** The longest name the transfer window may ask for: core refuses one over 255 bytes of UTF-8. */
const MAX_NAME = 255;

/**
 * Windows' Mark of the Web, as a saved file's Zone.Identifier stream: the
 * Internet zone, and nothing else (no HostUrl or ReferrerUrl, so nothing
 * says where it came from), so SmartScreen checks a program before it runs
 * and Office opens a document in Protected View.
 */
const ZONE_IDENTIFIER = '[ZoneTransfer]\r\nZoneId=3\r\n';

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

/** Two digits. */
const two = (n) => String(n).padStart(2, '0');

/**
 * The name of a bundle's folder, or a ZIP's (with .zip), for when it's saved,
 * in local time: "dropgate-bundle-20261010-143205" (YYYYMMDD-HHMMSS), as the web
 * UI names its ZIPs. It says nothing of the files or where they came from.
 * @param {Date} at
 */
function savedName(at) {
    const date = `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}`;
    return `dropgate-bundle-${date}-${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}`;
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
 *
 * A bundle's output saves several files, each its own sink: as each is
 * whole it's closed and kept in the partial folder, and once the last is,
 * a new folder is made in the output's folder, named for when it's saved
 * ("dropgate-bundle-20261010-143205", made unique), and every file is moved into
 * it. All of it or none: a bundle cancelled, failed or revoked part-way
 * leaves no file and no folder. A bundle as one ZIP is one sink whose bytes
 * are core's ZIP writer's, saved straight into the folder as
 * "dropgate-bundle-20261010-143205.zip"; core makes its members' names safe.
 *
 * On Windows, each file saved, a ZIP and every file of a bundle, gets the
 * Mark of the Web (ZONE_IDENTIFIER) as it's put in place, and no other
 * stream; elsewhere, nothing.
 */
class FileService {
    /** @type {Map<string, { path: string, size: number, mtimeMs: number, fd: number | null }>} */
    #grants = new Map();
    /** @type {Map<string, { folder: string, shape: string, count: number, opened: number, sinks: Set<string>, staged: string[] }>} */
    #outputs = new Map();
    /**
     * Each file being written: its output; the folder it's saved in (null for
     * a bundle's, until its own folder is made) and the folder it was opened
     * for (by its real path); its name; its size (null for a ZIP's, which core
     * writes as it goes); and whether it's being closed, or is whole and kept
     * for the rest of its bundle.
     * @type {Map<string, { output: string, folder: string | null, parent: string, name: string, size: number | null, written: number, fd: number | null, partial: string, closing: boolean }>}
     */
    #sinks = new Map();
    #partials;
    #onSaved;
    #markOfTheWeb;
    #now;

    /**
     * @param {object} [options]
     * @param {string} [options.partials] - The partial folder, where downloads are written until they're whole.
     * @param {(saved: { output: string, path: string }) => void} [options.onSaved] - A download is in place (a bundle's: its folder).
     * @param {boolean} [options.markOfTheWeb] - Whether each file saved gets Windows' Mark of the Web: on Windows only.
     * @param {() => Date} [options.now] - The time, for a bundle's or a ZIP's name.
     */
    constructor({ partials, onSaved = () => {}, markOfTheWeb = process.platform === 'win32', now = () => new Date() } = {}) {
        this.#partials = partials;
        this.#onSaved = onSaved;
        this.#markOfTheWeb = markOfTheWeb;
        this.#now = now;
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
     * An output main has granted: a download may write into this folder from
     * now on, as one file, a bundle's `count` files, or one ZIP.
     * @param {{ output: string, folder: string, shape: string, count?: number }} grant
     */
    grantOutput({ output, folder, shape, count } = {}) {
        if (typeof output !== 'string' || !GRANT_ID.test(output)) throw new Error('Expected an output.');
        if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new Error('Expected a folder.');
        if (!SHAPES.includes(shape)) throw new Error('Expected how the download is saved.');
        const counted = shape === 'files' ? Number.isSafeInteger(count) && count >= 2 && count <= MOST_FILES : count === undefined;
        if (!counted) throw new Error('Expected how many files the bundle saves.');
        if (typeof this.#partials !== 'string' || !path.isAbsolute(this.#partials)) throw new Error('Expected the partial folder.');
        this.revokeOutput(output);
        this.#outputs.set(output, { folder, shape, count: count ?? 1, opened: 0, sinks: new Set(), staged: [] });
    }

    /** The upload is done with a file: its descriptor is closed, and it can't be read again. */
    revoke(handle) {
        const grant = this.#grants.get(handle);
        if (!grant) return;
        this.#grants.delete(handle);
        if (grant.fd !== null) fs.closeSync(grant.fd);
    }

    /** The download is done with its output: a file still being written there is deleted, so are a bundle's kept so far, and nothing more can be. */
    revokeOutput(output) {
        if (!this.#outputs.has(output)) return;
        this.#discardAll(output);
        this.#outputs.delete(output);
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
     *   sink and the name it will be saved under (a ZIP's is named for when
     *   it's saved, so its name may change by then);
     * - `write { sink, bytes }`: `{ ok: true }`, never past the size it was opened with;
     * - `close { sink }`: `{ ok: true, name }`, the file whole and in place, under that name (a
     *   bundle's: whole and kept until the last is, then all of them in place in their folder);
     * - `abort { sink }`: `{ ok: true }`, the file deleted (a bundle's: all of them);
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
        // A ZIP's name is the file service's own: core gives it none.
        const named = typeof name === 'string' && name.length <= MAX_NAME && (name.length > 0 || granted.shape === 'zip');
        if (!named || !Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(index) || index < 0) {
            return refuse('not a file to save.');
        }
        // Each file once: an output saves as many as it was granted, and no more, even once they're in place.
        if (granted.opened >= granted.count) return refuse(granted.count === 1 ? 'this output saves one file.' : 'this output saves no more files.');

        let folder;
        try {
            folder = fs.realpathSync(granted.folder);
            if (!fs.statSync(folder).isDirectory()) return { id, failed: "The folder to save to isn't there any more." };
        } catch (error) {
            return { id, failed: writeFailure(error, 'saved') };
        }
        let safe;
        if (granted.shape === 'files') {
            // A bundle's file is named against the bundle's others alone: its folder is made new.
            const others = new Set([...granted.sinks].map((other) => this.#sinks.get(other).name.toLowerCase()));
            safe = filenames.unique(filenames.sanitize(name), (candidate) => others.has(candidate.toLowerCase()));
        } else {
            safe = this.#uniqueIn(folder, granted.shape === 'zip' ? `${savedName(this.#now())}.zip` : filenames.sanitize(name));
        }
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
        this.#sinks.set(sink, {
            output,
            folder: granted.shape === 'files' ? null : folder,
            parent: folder,
            name: safe,
            size: granted.shape === 'zip' ? null : size,
            written: 0,
            fd,
            partial,
            closing: false,
        });
        granted.sinks.add(sink);
        granted.opened++;
        return { id, sink, name: safe };
    }

    #write({ id, sink, bytes }, refuse) {
        const open = typeof sink === 'string' ? this.#sinks.get(sink) : undefined;
        if (!open || open.closing) return refuse('not a file being written.');
        if (!(bytes instanceof Uint8Array) || (open.size !== null && open.written + bytes.byteLength > open.size)) return refuse('not bytes of the file.');
        try {
            let at = 0;
            while (at < bytes.byteLength) at += fs.writeSync(open.fd, bytes, at, bytes.byteLength - at);
        } catch (error) {
            this.#failed(sink);
            return { id, failed: writeFailure(error, 'written') };
        }
        open.written += bytes.byteLength;
        return { id, ok: true };
    }

    async #close({ id, sink }, refuse) {
        const open = typeof sink === 'string' ? this.#sinks.get(sink) : undefined;
        if (!open || open.closing) return refuse('not a file being written.');
        if (open.size !== null && open.written !== open.size) {
            this.#failed(sink);
            return { id, failed: 'The download ended before the whole file came.' };
        }
        open.closing = true;
        const granted = this.#outputs.get(open.output);
        let saved;
        try {
            fs.fsyncSync(open.fd);
            fs.closeSync(open.fd);
            open.fd = null;
            if (granted.shape === 'files') {
                // Kept whole in the partial folder until the bundle's last file is.
                granted.staged.push(sink);
                if (granted.staged.length < granted.count) return { id, ok: true, name: open.name };
                saved = await this.#putBundleInPlace(granted);
            } else {
                // A ZIP is named for when it's saved.
                if (granted.shape === 'zip') open.name = this.#uniqueIn(open.folder, `${savedName(this.#now())}.zip`, open);
                saved = await this.#moveIntoPlace(open);
            }
        } catch (error) {
            this.#failed(sink);
            return { id, failed: writeFailure(error, 'saved') };
        }
        for (const done of granted.shape === 'files' ? [...granted.staged] : [sink]) this.#forget(done);
        this.#onSaved({ output: open.output, path: saved });
        return { id, ok: true, name: open.name };
    }

    #abort({ id, sink }, refuse) {
        if (typeof sink !== 'string' || !this.#sinks.has(sink)) return refuse('not a file being written.');
        this.#failed(sink);
        return { id, ok: true };
    }

    /**
     * The partial file, moved into its folder under its name, replacing
     * nothing: a hard link on the same drive, a copy onto another, each of
     * which fails if the name is taken, and then the next unique name is
     * tried. The folder must still be the one the file was opened for (by its
     * real path), and the file lands directly in it, with its mark on Windows.
     * Gives its path.
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
                this.#mark(target);
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
     * A bundle's files, all whole, moved into a new folder of their own in
     * the output's folder, named for when it's saved and made unique there.
     * The folder must still be the one the files were opened for (by its real
     * path). If any can't be put in place, those that were are deleted, and so
     * is the folder: nothing of the bundle is left. Gives the folder's path.
     */
    async #putBundleInPlace(granted) {
        const { parent } = this.#sinks.get(granted.staged[0]);
        if (fs.realpathSync(granted.folder) !== parent) throw Object.assign(new Error('The folder changed.'), { code: 'EPERM' });
        let made = null;
        while (!made) {
            const target = path.join(parent, this.#uniqueIn(parent, savedName(this.#now()), null, { asFolder: true }));
            try {
                fs.mkdirSync(target);
                made = target;
            } catch (error) {
                // Taken since it was named: the next one.
                if (error?.code !== 'EEXIST') throw error;
            }
        }
        const placed = [];
        try {
            for (const sink of granted.staged) {
                const open = this.#sinks.get(sink);
                open.folder = made;
                placed.push(await this.#moveIntoPlace(open));
            }
        } catch (error) {
            // Only what was put there, then the folder, if nothing else is in it.
            for (const file of placed) fs.rmSync(file, { force: true });
            try {
                fs.rmdirSync(made);
            } catch {
                // Something else was put in it meanwhile, which stays.
            }
            throw error;
        }
        return made;
    }

    /**
     * Windows' Mark of the Web on a file just put in place: its
     * Zone.Identifier stream, holding the Internet zone and nothing else. A
     * drive that can't hold streams (FAT, exFAT, some shares) can't hold the
     * mark either, as for Windows' own downloads: the file is saved unmarked.
     */
    #mark(target) {
        if (!this.#markOfTheWeb) return;
        try {
            fs.writeFileSync(`${target}:Zone.Identifier`, ZONE_IDENTIFIER);
        } catch {
            // No streams on this drive.
        }
    }

    /**
     * A made-safe name, made unique in a folder: against what's there, and
     * the names other downloads are writing there, without regard to case.
     */
    #uniqueIn(folder, name, except = null, { asFolder = false } = {}) {
        const writing = [...this.#sinks.values()].filter((other) => other !== except && other.folder === folder).map((other) => other.name.toLowerCase());
        let there;
        try {
            there = new Set(fs.readdirSync(folder).map((entry) => entry.toLowerCase()));
        } catch {
            there = new Set();
        }
        const taken = new Set([...there, ...writing]);
        // A name taken by the folder's own listing, or by one that appeared since (lstat: a link counts, followed or not).
        const isTaken = (candidate) => taken.has(candidate.toLowerCase()) || exists(path.join(folder, candidate));
        if (!asFolder) return filenames.unique(name, isTaken);
        // A folder's name has no extension: anything after a dot in it is part of its name, before the "(1)".
        let candidate = name;
        for (let n = 1; isTaken(candidate); n++) candidate = `${name} (${n})`;
        return candidate;
    }

    /** A file that won't be saved: deleted, and for a bundle's, every other of the bundle too (all of it or none). */
    #failed(sink) {
        const { output } = this.#sinks.get(sink);
        if (this.#outputs.get(output)?.shape === 'files') this.#discardAll(output);
        else this.#discard(sink);
    }

    /** Every file of an output deleted: one being written, and a bundle's kept so far. */
    #discardAll(output) {
        for (const sink of [...(this.#outputs.get(output)?.sinks ?? [])]) this.#discard(sink);
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
        if (!open) return;
        const granted = this.#outputs.get(open.output);
        if (!granted) return;
        granted.sinks.delete(sink);
        granted.staged = granted.staged.filter((kept) => kept !== sink);
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

module.exports = { FileService, GRANT_ID, ZONE_IDENTIFIER, savedName };
