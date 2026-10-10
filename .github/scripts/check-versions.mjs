// Checks that core, the server and the desktop client share one version.
//
// They're released together, from one tag, so each one's package.json, its
// package-lock.json and the version badge in its README must all give the same
// version. It's set by hand, in one commit; this only checks it. CI runs it on
// every push and pull request, and the release workflow runs it first.
//
// For a release, also pass its tag and whether it's a pre-release:
//
//   node .github/scripts/check-versions.mjs --tag 4.0.0-alpha.1 --prerelease true
//
// The tag must be the version itself, and a release must be a pre-release
// exactly when the version has a pre-release part (4.0.0-alpha.1). So an alpha
// can never be published as the latest release, and a stable version never as
// a pre-release.
//
// Plain Node, with nothing to install. It reads files and runs nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const PACKAGES = [
    { name: 'core', dir: 'packages/dropgate-core' },
    { name: 'server', dir: 'server' },
    { name: 'client', dir: 'client' },
];

// A version as npm and electron-builder take it: MAJOR.MINOR.PATCH, and an optional
// pre-release part after a hyphen. No "v" in front, and no build part after a "+".
const IDENTIFIER = '(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)';
const VERSION = new RegExp(`^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-${IDENTIFIER}(?:\\.${IDENTIFIER})*)?$`);

/**
 * The version a README's badge shows. The badge is a shields.io static badge,
 * `https://img.shields.io/badge/version-<version>-<colour>`, where a hyphen in the
 * version is written as two.
 * @param {string} text - The README.
 * @returns {string | undefined}
 */
function badgeVersion(text) {
    const url = /!\[version\]\((https:\/\/img\.shields\.io\/badge\/[^)\s?]+)/.exec(text)?.[1];
    if (!url) return undefined;
    const parts = url.slice(url.indexOf('/badge/') + '/badge/'.length).replaceAll('--', '\0').split('-');
    if (parts.length !== 3 || parts[0] !== 'version') return undefined;
    return parts[1].replaceAll('\0', '-');
}

/**
 * Every place a package gives its version, and what each says.
 * @returns {{ where: string, version: string | undefined }[]}
 */
function versions() {
    const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
    return PACKAGES.flatMap(({ dir }) => {
        const lock = JSON.parse(read(`${dir}/package-lock.json`));
        return [
            { where: `${dir}/package.json`, version: JSON.parse(read(`${dir}/package.json`)).version },
            { where: `${dir}/package-lock.json`, version: lock.version },
            { where: `${dir}/package-lock.json (packages[""])`, version: lock.packages?.['']?.version },
            { where: `${dir}/README.md (version badge)`, version: badgeVersion(read(`${dir}/README.md`)) },
        ];
    });
}

const { values } = parseArgs({ options: { tag: { type: 'string' }, prerelease: { type: 'string' } } });
if ((values.tag === undefined) !== (values.prerelease === undefined)) {
    console.error('Give both --tag and --prerelease for a release, or neither.');
    process.exit(2);
}
if (values.prerelease !== undefined && !['true', 'false'].includes(values.prerelease)) {
    console.error(`--prerelease is true or false, not "${values.prerelease}".`);
    process.exit(2);
}

const found = versions();
const width = Math.max(...found.map(({ where }) => where.length));
for (const { where, version } of found) console.log(`${where.padEnd(width)}  ${version ?? '(none)'}`);
console.log();

const problems = [];
const version = found[0].version;
const differ = found.filter((f) => f.version !== version);
if (differ.length) {
    problems.push(`These don't give ${found[0].where}'s version, ${version ?? '(none)'}:`);
    for (const { where, version: v } of differ) problems.push(`  ${where}: ${v ?? 'no version found'}`);
    problems.push('Core, the server and the client share one version. Change it everywhere above, in one commit.');
} else if (!VERSION.test(version ?? '')) {
    problems.push(`${version} isn't a version npm and the desktop builds take (for example 4.0.0, or 4.0.0-alpha.1 for a pre-release).`);
}

if (values.tag !== undefined && !differ.length) {
    const prerelease = values.prerelease === 'true';
    if (values.tag !== version) {
        problems.push(`The release's tag is ${values.tag}, but the version is ${version}. Tag a release with its version, as it is.`);
    }
    const hasPrereleasePart = (version ?? '').includes('-');
    if (prerelease && !hasPrereleasePart) {
        problems.push(`The release is marked as a pre-release, but ${version} is a stable version. Publish it as a full release, or give the packages a pre-release version.`);
    } else if (!prerelease && hasPrereleasePart) {
        problems.push(`${version} is a pre-release version, but the release isn't marked as a pre-release. Mark it as one, so it doesn't become the latest release.`);
    }
}

if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
}
console.log(values.tag === undefined
    ? `All ${found.length} give ${version}.`
    : `All ${found.length} give ${version}, which is the release's tag, and it's ${values.prerelease === 'true' ? 'a pre-release' : 'a stable release'}.`);
