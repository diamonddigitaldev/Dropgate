// Every link in the repo's Markdown goes somewhere. Relative links and
// anchors are checked against the repository, the way GitHub resolves them.
// Links to other sites are never fetched, so nothing leaves the machine: they
// only have to use https, and whether they still work is part of the release
// proofread.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { anchorsOf, links } from './helpers/docs.mjs';
import { isFile, isFolder, read } from './helpers/repo.mjs';
import { expectNone } from './helpers/report.mjs';

const all = links();

/** A link's scheme, lower-cased, or null for a relative link. */
const schemeOf = (target) => /^([a-z][a-z0-9+.-]*):/i.exec(target)?.[1].toLowerCase() ?? null;

// The links to somewhere in this repository: no scheme, not `//host`, not a
// bare `www.` address.
const relative = all.filter(({ target }) => !schemeOf(target) && !target.startsWith('//') && !/^www\./i.test(target));

/**
 * Where a relative link leads: `{ file, anchor }`, with `file` relative to the
 * repository root (`''` for the root itself) and `anchor` decoded, or
 * `{ problem }`.
 */
function resolve(link) {
    const [beforeHash, ...rest] = link.target.split('#');
    const fragment = rest.length ? rest.join('#') : undefined;
    const pathPart = beforeHash.split('?')[0];
    let decoded;
    let anchor;
    try {
        decoded = decodeURIComponent(pathPart);
        anchor = fragment && decodeURIComponent(fragment);
    } catch {
        return { problem: `${link.at}: ${link.target} (not a valid address)` };
    }
    if (!decoded) return { file: link.file, anchor };
    // GitHub reads a leading / as the repository's root.
    const joined = decoded.startsWith('/')
        ? path.posix.normalize(decoded.slice(1))
        : path.posix.normalize(path.posix.join(path.posix.dirname(link.file), decoded));
    const file = joined.replace(/\/+$/, '').replace(/^\.$/, '');
    if (file === '..' || file.startsWith('../')) return { problem: `${link.at}: ${link.target} (outside the repository)` };
    return { file, anchor };
}

// So a mistake in reading the Markdown can't pass every check below by finding
// nothing to check.
test('the checks find the docs\' links', () => {
    assert.ok(relative.length > 50, `expected the docs' 70 or so relative links, but found ${relative.length}`);
    assert.ok(relative.some((link) => link.target.includes('#')), 'expected some links to anchors');
});

test('every relative link points to a file or folder in the repository', () => {
    const broken = [];
    for (const link of relative) {
        const { file, problem } = resolve(link);
        if (problem) broken.push(problem);
        else if (!isFile(file) && !isFolder(file)) broken.push(`${link.at}: ${link.target} (there's no ${file})`);
    }
    expectNone(broken, 'These links lead nowhere in the repository:');
});

test('every #anchor points to a heading or anchor that exists', () => {
    const broken = [];
    for (const link of relative) {
        // A bad address, or a missing file, fails the test above.
        const { file, anchor, problem } = resolve(link);
        if (problem || !anchor || !isFile(file)) continue;
        if (/\.md$/i.test(file)) {
            if (!anchorsOf(file).has(anchor)) broken.push(`${link.at}: ${link.target} (${file} has no heading or anchor "${anchor}")`);
        } else {
            // GitHub gives code files line anchors, #L12 or #L12-L20.
            const lines = /^L(\d+)(?:-L(\d+))?$/.exec(anchor);
            const count = read(file).split(/\r?\n/).length;
            if (!lines) broken.push(`${link.at}: ${link.target} (only Markdown headings and line numbers, #L12, are anchors)`);
            else if (Number(lines[2] ?? lines[1]) > count) broken.push(`${link.at}: ${link.target} (${file} has ${count} lines)`);
        }
    }
    expectNone(broken, 'These links name an anchor that isn\'t there:');
});

// A plain-HTTP link is fine to this machine, where there's nothing to intercept.
const LOCAL_HOSTS = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|[^/]+\.localhost)(?::\d+)?$/i;

test('every link to another site uses https', () => {
    const insecure = [];
    for (const link of all) {
        const scheme = schemeOf(link.target);
        if (scheme === 'https') continue;
        if (scheme === 'http') {
            const host = link.target.slice('http://'.length).split(/[/?#]/)[0];
            if (!LOCAL_HOSTS.test(host)) insecure.push(`${link.at}: ${link.target}`);
        } else if (link.target.startsWith('//') || /^www\./i.test(link.target)) {
            // GitHub turns a bare www. address into an http:// link.
            insecure.push(`${link.at}: ${link.target}`);
        }
    }
    expectNone(insecure, 'Change these links to https://:');
});
