// The repository's files, as git sees them. The checks only read files: they
// run nothing from the repo and fetch nothing.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Every file git tracks, plus new ones it would track (untracked but not
 * ignored), so a doc you haven't added yet is checked too. Paths use `/`, and
 * keep git's exact case: GitHub's links are case-sensitive even where your disk
 * isn't. CI checks out only what's committed, so there it's the committed files.
 */
export const files = (() => {
    let out;
    try {
        out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
            cwd: ROOT,
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
        });
    } catch (err) {
        throw new Error(`The docs checks need git and a clone of the repository to list its files: ${err.message}`);
    }
    // A file deleted but not yet staged is still in git's index.
    return [...new Set(out.split('\0').filter(Boolean))]
        .filter((file) => existsSync(path.join(ROOT, file)))
        .sort();
})();

/** Every folder that holds at least one of those files, as `a/b`. */
export const folders = (() => {
    const set = new Set();
    for (const file of files) {
        for (let dir = path.posix.dirname(file); dir !== '.'; dir = path.posix.dirname(dir)) set.add(dir);
    }
    return set;
})();

const fileSet = new Set(files);

export const isFile = (file) => fileSet.has(file);
export const isFolder = (dir) => dir === '' || folders.has(dir);

/** A file's text, read from the repository root. */
export function read(file) {
    return readFileSync(path.join(ROOT, file), 'utf8');
}

/** Every Markdown file in the repository. */
export const markdownFiles = files.filter((file) => /\.md$/i.test(file));
