// Checks what publishing core to npm with provenance, through npm's trusted
// publishing, needs, as far as it can without a token. The release workflow's npm
// job runs it from packages/dropgate-core, before npm publish:
//
//   node ../../.github/scripts/check-npm-provenance.mjs
//
// npm's own dry run skips provenance, so this checks what it will need:
// - npm 11.5.1 or later, which publishes with a GitHub Actions ID token, and the
//   Node it needs, 22.14 or later;
// - the package's repository.url names this repository, and its
//   repository.directory this folder, which npm checks against the provenance;
// - the repository is public, since npm only takes provenance from a public one;
// - the package is public on npm, read with no credentials. Trusted publishing is
//   set up for a package that's already there;
// - it runs in release.yml, the workflow npm's trusted publisher names.
//
// It asks for no token, and publishes nothing. It only runs in GitHub Actions.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REGISTRY = 'https://registry.npmjs.org/';
const WORKFLOW = '.github/workflows/release.yml';

const { GITHUB_REPOSITORY, GITHUB_WORKFLOW_REF, GITHUB_EVENT_PATH } = process.env;
if (!GITHUB_REPOSITORY || !GITHUB_WORKFLOW_REF || !GITHUB_EVENT_PATH) {
    console.error('This checks a GitHub Actions run: GITHUB_REPOSITORY, GITHUB_WORKFLOW_REF and GITHUB_EVENT_PATH must be set.');
    process.exit(2);
}

/**
 * Whether version a is at least version b, both MAJOR.MINOR.PATCH.
 * @param {string} a
 * @param {string} b
 */
function atLeast(a, b) {
    const [x, y] = [a, b].map((v) => v.replace(/^v/, '').split(/[.-]/).slice(0, 3).map(Number));
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
    return true;
}

/**
 * A repository URL as npm compares it: no git+ in front, no .git at the end.
 * @param {string | undefined} url
 */
function plain(url) {
    return (url ?? '').replace(/^git\+/, '').replace(/\.git$/, '').replace(/\/$/, '').toLowerCase();
}

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const here = path.relative(ROOT, process.cwd()).split(path.sep).join('/');
const event = JSON.parse(fs.readFileSync(GITHUB_EVENT_PATH, 'utf8'));
const npm = execSync('npm --version', { encoding: 'utf8' }).trim();

const checks = [
    [atLeast(npm, '11.5.1'), `npm ${npm}: 11.5.1 or later, which publishes with an ID token.`],
    [atLeast(process.version, '22.14.0'), `Node ${process.version}: 22.14 or later, which that npm needs.`],
    [plain(pkg.repository?.url) === plain(`https://github.com/${GITHUB_REPOSITORY}`),
        `repository.url: ${pkg.repository?.url ?? '(none)'}, which must name ${GITHUB_REPOSITORY}.`],
    [pkg.repository?.directory === here, `repository.directory: ${pkg.repository?.directory ?? '(none)'}, which must be ${here}.`],
    [pkg.private !== true, `${pkg.name} isn't marked private.`],
    [event.repository?.private === false, `${GITHUB_REPOSITORY} is ${event.repository?.visibility ?? 'of unknown visibility'}, and must be public.`],
    [GITHUB_WORKFLOW_REF.startsWith(`${GITHUB_REPOSITORY}/${WORKFLOW}@`),
        `The workflow is ${GITHUB_WORKFLOW_REF}, which must be ${WORKFLOW}, as npm's trusted publisher names it.`],
];

// Read with no credentials: a restricted package answers 404, as a missing one does.
const response = await fetch(new URL(pkg.name.replace('/', '%2f'), REGISTRY), {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
});
checks.push([response.status === 200, response.status === 200
    ? `${pkg.name} is public on npm, read with no credentials.`
    : `${pkg.name} answered ${response.status} on npm with no credentials. It must be there, and public.`]);

for (const [ok, what] of checks) console.log(`${ok ? 'ok  ' : 'NO  '} ${what}`);
// Not process.exit(): on Windows it can abort while fetch's connection closes.
if (checks.some(([ok]) => !ok)) process.exitCode = 1;
else console.log(`\nAll ${checks.length} hold. No token was asked for.`);
