'use strict';

const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * The files main has handed a window, as opaque handles: a window holds a
 * file's handle, name and size, never its path, and a handle works only for
 * the window it was handed to. Each keeps the file's size and modification
 * time as it was then, so the file service can tell a file changed since.
 * A file handed to the same window again keeps its handle, and is taken as it
 * is now. Main keeps all of it in memory only.
 */
class Handles {
    /** @type {Map<string, { owner: number, path: string, name: string, size: number, mtimeMs: number }>} */
    #byHandle = new Map();

    /**
     * A file on disk, handed to a window: from now on it may upload it, as it
     * is now. Throws if the file can't be read.
     * @param {number} owner - The window's webContents id.
     * @param {string} filePath
     * @returns {{ handle: string, name: string, size: number }}
     */
    add(owner, filePath) {
        const { size, mtimeMs } = fs.statSync(filePath);
        let handle = [...this.#byHandle].find(([, held]) => held.owner === owner && held.path === filePath)?.[0];
        handle ??= randomUUID();
        const name = path.basename(filePath);
        this.#byHandle.set(handle, { owner, path: filePath, name, size, mtimeMs });
        return { handle, name, size };
    }

    /**
     * A handle's file, if that window holds it.
     * @param {number} owner
     * @param {unknown} handle
     */
    get(owner, handle) {
        const held = typeof handle === 'string' ? this.#byHandle.get(handle) : undefined;
        return held && held.owner === owner ? { ...held } : null;
    }

    /** The window is done with a file. */
    revoke(owner, handle) {
        if (this.get(owner, handle)) this.#byHandle.delete(handle);
    }

    /** A window has gone: every file it held goes with it. */
    dropOwner(owner) {
        for (const [handle, held] of this.#byHandle) {
            if (held.owner === owner) this.#byHandle.delete(handle);
        }
    }
}

module.exports = { Handles };
