// The rules for core's npm README. npm shows the README a version was
// published with, and only changes it with the next release, so the README is
// short and points into the repository for everything else: once, at the
// docs' contents on master, which list the pages. A list of pages, or a link to
// one or to an #anchor, would go stale on npm whenever a page is renamed or
// split. These take the Markdown as text, so the tests can check them on
// planted mistakes as well as on the real files.
import path from 'node:path';
import { parseMarkdown } from './markdown.mjs';
import { read } from './repo.mjs';

export const README = 'packages/dropgate-core/README.md';
export const DOCS = 'docs/core';
export const CONTENTS = `${DOCS}/README.md`;
export const CONTENTS_URL = `https://github.com/diamonddigitaldev/Dropgate/blob/master/${CONTENTS}`;

// A link to this repository on GitHub, and the address a link to one of its
// files must have: the file on master, with `?raw=true` allowed so an image
// shows. Issues, releases and so on aren't files, so they can be linked as
// they are.
const REPO = /^(?:https?:)?\/\/(?:www\.)?github\.com\/diamonddigitaldev\/Dropgate(?=[/?#]|$)/i;
const RAW = /^(?:https?:)?\/\/raw\.githubusercontent\.com\/diamonddigitaldev\/Dropgate(?=[/?#]|$)/i;
const FILE_VIEWS = new Set(['blob', 'tree', 'raw', 'blame', 'edit', 'commits', 'commit']);
const ON_MASTER = /^https:\/\/github\.com\/diamonddigitaldev\/Dropgate\/blob\/master\/([^?#]+)(?:\?raw=true)?$/;

const hasScheme = (target) => /^[a-z][a-z0-9+.-]*:/i.test(target);

/** Whether a link leads to a file or folder of this repository on GitHub. */
function intoRepo(target) {
    if (RAW.test(target)) return true;
    if (!REPO.test(target)) return false;
    return FILE_VIEWS.has(target.replace(REPO, '').split(/[/?#]/)[1]);
}

/**
 * What's wrong with core's npm README, one line per problem, with its line.
 * @param {string} markdown - The README.
 * @param {{ isFile: (file: string) => boolean }} repo - Whether a path is a file in the repository.
 */
export function readmeProblems(markdown, { isFile }) {
    const problems = [];
    const toContents = [];
    for (const { line, target } of parseMarkdown(markdown).links) {
        const at = `line ${line}: ${target}`;
        if (!hasScheme(target) && !target.startsWith('//')) {
            problems.push(`${at} (a relative link, which npm can't follow: use its full .../blob/master/... address)`);
            continue;
        }
        if (!intoRepo(target)) continue;
        const onMaster = ON_MASTER.exec(target);
        if (!onMaster) {
            problems.push(`${at} (a link into the repository is the file's full .../blob/master/... address, with no #anchor)`);
            continue;
        }
        let file;
        try {
            file = decodeURIComponent(onMaster[1]);
        } catch {
            problems.push(`${at} (not a valid address)`);
            continue;
        }
        if (!isFile(file)) problems.push(`${at} (there's no ${file} in the repository)`);
        else if (target === CONTENTS_URL) toContents.push(at);
        else if (file.startsWith('docs/')) {
            problems.push(`${at} (the only link into docs/ is the docs' contents, ${CONTENTS_URL}: a link to a page goes stale on npm until the next release)`);
        }
    }
    if (toContents.length === 0) problems.push(`no link to the docs' contents, ${CONTENTS_URL}`);
    if (toContents.length > 1) problems.push(`the docs' contents are linked ${toContents.length} times, at ${toContents.join('; ')}: link them once`);
    return problems;
}

/**
 * The pages of the docs that the contents page doesn't link to.
 * @param {string} markdown - docs/core/README.md.
 * @param {string[]} pages - Every Markdown file under docs/core/, from the repository root.
 */
export function unlistedPages(markdown, pages) {
    const listed = new Set();
    for (const { target } of parseMarkdown(markdown).links) {
        if (hasScheme(target) || target.startsWith('//')) continue;
        const file = target.split('#')[0].split('?')[0];
        if (file) listed.add(path.posix.normalize(path.posix.join(DOCS, decodeURIComponent(file))));
    }
    return pages.filter((page) => page !== CONTENTS && !listed.has(page));
}

/** The names a Markdown file's code imports from core, as `{ name, from }`. */
export function importedNames(markdown) {
    const found = [];
    for (const match of markdown.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](@dropgate\/core(?:\/[\w-]+)?)['"]/g)) {
        for (const item of match[1].split(',')) {
            const name = item.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
            if (name) found.push({ name, from: match[2] });
        }
    }
    return found;
}

/**
 * What core's client and helpers have, from core's build as the web UI
 * carries it (core's own tests check that copy is the build): each feature of
 * a client, such as `hosted`, with its calls, and each helper group, such as
 * `lifetime`, with its helpers. Nothing makes a request: a client is only made
 * to look at it.
 */
export async function coreShape() {
    const source = read('server/public/js/dropgate-core.js');
    const core = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    const client = new core.DropgateClient({
        clientVersion: '0.0.0',
        server: 'https://docs.example',
        fetchFn: () => { throw new Error('The docs checks make no requests.'); },
    });
    const groups = (owner) => Object.fromEntries(Object.entries(owner)
        .filter(([, value]) => value && typeof value === 'object' && Object.isFrozen(value) && !Array.isArray(value))
        .map(([name, value]) => [name, Object.keys(value)]));
    return { features: groups(client), helpers: groups(core) };
}

/**
 * The calls a Markdown file names on a client (`client.feature.method()`) or
 * on one of core's helper groups (`group.name()`) that core doesn't have, one
 * line per problem, with its line.
 * @param {string} markdown
 * @param {{ features: Record<string, string[]>, helpers: Record<string, string[]> }} shape - From coreShape().
 */
export function unknownCalls(markdown, { features, helpers }) {
    const problems = [];
    const has = (groups, group, name) => Object.hasOwn(groups, group) && groups[group].includes(name);
    markdown.split(/\r?\n/).forEach((text, i) => {
        const at = `line ${i + 1}`;
        for (const [, feature, method] of text.matchAll(/\bclient\.([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?\s*\(/g)) {
            if (method === undefined) {
                problems.push(`${at}: client.${feature}() (a client's calls are by feature, such as client.hosted.upload(): ${Object.keys(features).join(', ')})`);
            } else if (!has(features, feature, method)) {
                problems.push(`${at}: client.${feature}.${method}() (${Object.hasOwn(features, feature) ? `client.${feature} has ${features[feature].join(', ')}` : `a client has no ${feature}`})`);
            }
        }
        const groupNames = Object.keys(helpers).map((name) => name.replace(/\$/g, '\\$')).join('|');
        if (!groupNames) return;
        for (const [, group, name] of text.matchAll(new RegExp(`(?<![\\w$.])(${groupNames})\\.([A-Za-z_$][\\w$]*)\\s*\\(`, 'g'))) {
            if (!has(helpers, group, name)) problems.push(`${at}: ${group}.${name}() (${group} has ${helpers[group].join(', ')})`);
        }
    });
    return problems;
}

/** The names a TypeScript entry point exports as values, not types. */
export function exportedValues(source) {
    const names = new Set();
    for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
        for (const item of match[1].split(',')) {
            const trimmed = item.trim();
            if (!trimmed || trimmed.startsWith('type ')) continue;
            names.add(trimmed.split(/\s+as\s+/).pop().trim());
        }
    }
    for (const match of source.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(?:class|function\*?|const|let|var)\s+([\w$]+)/g)) names.add(match[1]);
    return names;
}
