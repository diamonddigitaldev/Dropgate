// The third-party code compiled into core's builds, and its licence notice:
// @noble/curves, @noble/hashes and @noble/ciphers, all MIT. tsup.config.ts puts
// the notice at the top of every build (and so in the web UI's and the desktop
// app's copies), THIRD-PARTY-NOTICES.md holds each package's licence in full,
// and tests/build.test.ts holds both to the installed packages' own LICENSE
// files and to the exact pins.
import { readFileSync } from 'node:fs';

/** The packages compiled in. */
export const NOBLE = ['@noble/curves', '@noble/hashes', '@noble/ciphers'];

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** The version each is pinned to in package.json. */
export const versionOf = (name) => pkg.devDependencies[name];

/** A package's LICENSE file, as installed, its line endings LF. */
export const licenceOf = (name) =>
  readFileSync(new URL(`../node_modules/${name}/LICENSE`, import.meta.url), 'utf8').replace(/\r\n/g, '\n').trimEnd();

/** A licence's copyright lines, and the rest of it (the permission notice and disclaimer). */
function split(licence) {
  const lines = licence.split('\n');
  return {
    copyrights: lines.filter((line) => /^Copyright \(c\)/.test(line)),
    terms: lines.filter((line) => !/^Copyright \(c\)/.test(line) && !/^The MIT License/.test(line)).join('\n').trim(),
  };
}

/**
 * The notice every build starts with: what's compiled in, its copyright
 * lines, and the MIT License's permission notice and disclaimer, which the
 * licence asks to go with every copy. It fails the build if the three
 * packages' terms ever differ, so a package sweep that changes one gets looked at.
 */
export function buildBanner() {
  const parts = NOBLE.map((name) => split(licenceOf(name)));
  const terms = parts[0].terms;
  for (const [i, part] of parts.entries()) {
    if (part.terms !== terms) throw new Error(`${NOBLE[i]}'s licence terms differ from ${NOBLE[0]}'s: write its notice out on its own.`);
  }
  const copyrights = [...new Set(parts.flatMap((part) => part.copyrights))];
  const [curves, hashes, ciphers] = NOBLE.map((name) => `${name} ${versionOf(name)}`);
  const body = [
    `@dropgate/core has compiled into it ${curves}, ${hashes} and`,
    `${ciphers} (https://paulmillr.com/noble/), licensed under the MIT License:`,
    '',
    ...copyrights,
    '',
    ...terms.split('\n'),
  ];
  return `/*!\n${body.map((line) => (line ? ` * ${line}` : ' *')).join('\n')}\n */`;
}

/** THIRD-PARTY-NOTICES.md, as it should be. */
export function noticesFile() {
  const sections = NOBLE.map((name) => [
    `## ${name} ${versionOf(name)}`,
    '',
    `https://github.com/paulmillr/noble-${name.slice('@noble/'.length)}`,
    '',
    '```',
    licenceOf(name),
    '```',
  ].join('\n'));
  return [
    '# Third-party notices',
    '',
    "@dropgate/core's builds (`dist/`, and the copies the Dropgate Server's Web UI and the Dropgate Client load) have this",
    "code compiled into them. It's used under the licences below, each the package's own LICENSE file. `npm run notices`",
    'writes this file from the installed packages, and core\'s tests fail if it differs from them.',
    '',
    ...sections.flatMap((section) => [section, '']),
  ].join('\n');
}
