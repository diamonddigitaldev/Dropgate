// Lists the files a release would attach from one platform's desktop build, and
// checks its update file against them. The release workflow runs it in each
// desktop build, from client/, after electron-builder:
//
//   node ../.github/scripts/desktop-release-files.mjs dist --prerelease false
//
// - Every file electron-builder writes to dist/ is either attached or known not
//   to be. Anything else fails, so nothing new is attached without a decision.
// - Each attached file's name must be one GitHub keeps as it is, because the
//   update file names them.
// - Every release, pre-releases too, also attaches the update file (latest.yml
//   on Windows, latest-linux.yml on Linux), which the desktop app reads to update
//   itself: its Beta and Alpha channels read a pre-release's. It goes up after
//   every other file of the release, so every file it names must be one this
//   build attaches, with the same size and SHA-512. The app's own updater (the
//   kit's) never offers a pre-release on Stable, or anything older than it runs.
//
// Writes the names of the files to attach, and the update file's name and
// contents (base64), to GITHUB_OUTPUT: a release attaches the files straight
// after, and the update file in its last job. It uploads nothing.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

// What electron-builder writes on each platform that a release attaches: one of
// each package (and the installer's blockmap), and the update file.
const PLATFORMS = {
    win32: { name: 'Windows', packages: ['.exe', '.exe.blockmap'], update: 'latest.yml' },
    linux: { name: 'Linux', packages: ['.AppImage', '.deb', '.rpm'], update: 'latest-linux.yml' },
};

// Written for the build's own record, never attached.
const RECORDS = new Set(['builder-debug.yml', 'builder-effective-config.yaml']);

// GitHub renames an asset whose name has anything else in it.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const { values, positionals } = parseArgs({ allowPositionals: true, options: { prerelease: { type: 'string' } } });
const dist = positionals[0];
if (!dist || !['true', 'false'].includes(values.prerelease ?? '')) {
    console.error('Usage: node desktop-release-files.mjs <dist folder> --prerelease true|false');
    process.exit(2);
}
// It changes only what's printed: a pre-release attaches the same files as a stable release.
const prerelease = values.prerelease === 'true';
const platform = PLATFORMS[process.platform];
if (!platform) {
    console.error(`Releases have no desktop build for ${process.platform}.`);
    process.exit(2);
}

// js-yaml comes with electron-builder, so it's in client/node_modules.
const yaml = createRequire(path.resolve('package.json'))('js-yaml');
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));

/**
 * A size as `numfmt --to=iec-i` gives it, such as 109.4 MiB.
 * @param {number} bytes
 * @returns {string}
 */
function readable(bytes) {
    const units = ['B', 'KiB', 'MiB', 'GiB'];
    let size = bytes;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit++;
    }
    return `${size.toFixed(1)} ${units[unit]}`;
}

/**
 * A file's size and hashes: SHA-256 in hex, to list, and SHA-512 in base64, as
 * the update file gives it.
 * @param {string} name
 */
function describe(name) {
    const data = fs.readFileSync(path.join(dist, name));
    return {
        name,
        size: data.length,
        sha256: crypto.createHash('sha256').update(data).digest('hex'),
        sha512: crypto.createHash('sha512').update(data).digest('base64'),
    };
}

const problems = [];
const attached = [];
const updateFiles = [];
const notAttached = [];

for (const entry of fs.readdirSync(dist, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const { name } = entry;
    if (entry.isDirectory()) {
        notAttached.push(`${name}/`);
    } else if (RECORDS.has(name)) {
        notAttached.push(name);
    } else if (name.endsWith('.yml')) {
        updateFiles.push(name);
    } else if (platform.packages.some((ext) => name.endsWith(ext))) {
        attached.push(name);
    } else {
        problems.push(`${name} isn't a file a release attaches, or one it leaves out. Decide which, here.`);
    }
}

for (const ext of platform.packages) {
    const found = attached.filter((name) => name.endsWith(ext));
    if (found.length !== 1) problems.push(`Expected one ${ext} file, found ${found.length}.`);
}
for (const name of attached) {
    if (!SAFE_NAME.test(name)) problems.push(`${name}: GitHub would rename it, so the update file wouldn't name it.`);
    if (!name.includes(version)) problems.push(`${name}: its name doesn't give the version, ${version}.`);
}

const files = attached.map(describe);
const width = Math.max(...files.map((f) => f.name.length), platform.update.length);
const line = (f) => `${f.name.padEnd(width)}  ${String(f.size).padStart(10)} bytes  ${readable(f.size).padStart(10)}  sha256 ${f.sha256}`;

console.log(`A ${prerelease ? 'pre-release' : 'stable release'} would attach these from this build (${platform.name}), in this order:`);
files.forEach((f, i) => console.log(`  ${i + 1}. ${line(f)}`));
console.log();

let update;
if (updateFiles.length !== 1 || updateFiles[0] !== platform.update) {
    problems.push(`A release attaches ${platform.update}, but the build wrote ${updateFiles.length ? updateFiles.join(', ') : 'no update file'}.`);
} else {
    update = describe(platform.update);
    const info = yaml.load(fs.readFileSync(path.join(dist, platform.update), 'utf8'));
    console.log('Then, after every other file of the release, its update file:');
    console.log(`     ${line(update)}`);
    if (info?.version !== version) problems.push(`${platform.update} gives version ${info?.version}, not ${version}.`);
    const named = [...(info?.files ?? []), { url: info?.path, sha512: info?.sha512 }];
    if (!info?.files?.length) problems.push(`${platform.update} names no files.`);
    for (const { url, sha512, size } of named) {
        const file = files.find((f) => f.name === url);
        if (!file) {
            problems.push(`${platform.update} names ${url}, which this build doesn't attach.`);
        } else if (file.sha512 !== sha512 || (size !== undefined && file.size !== size)) {
            problems.push(`${platform.update} gives ${url} a different size or SHA-512.`);
        }
    }
    const names = [...new Set(named.map((n) => n.url))];
    console.log(`     It names ${names.join(', ')}, each with the size and SHA-512 above.`);
}
console.log();
console.log(`Not attached: ${notAttached.join(', ') || 'nothing'}. Nothing was uploaded.`);

if (problems.length) {
    console.error();
    console.error(problems.join('\n'));
    process.exit(1);
}

if (process.env.GITHUB_OUTPUT) {
    const contents = update ? fs.readFileSync(path.join(dist, update.name)).toString('base64') : '';
    fs.appendFileSync(process.env.GITHUB_OUTPUT,
        `attach=${attached.join(' ')}\nupdate-file-name=${update?.name ?? ''}\nupdate-file=${contents}\n`);
}
