import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { ROOT, copyContents, inRepository } from '../scripts/copy-contents.mjs';

// The web UI and the desktop app load this package's ESM build as their own
// dropgate-core.js, which `npm run build` writes. CI builds before it tests, so
// these fail if a copy was edited by hand, or not built again after a change to
// core. The copies are listed here as well as in scripts/copy-build.mjs, so a
// copy the script stops writing is still checked. Unpacked on its own, from a
// release's source archive, the package has no copies, so these are skipped.

const BUILD = new URL('../dist/index.js', import.meta.url);

const COPIES = [
  { name: "the web UI's copy", path: 'server/public/js/dropgate-core.js' },
  { name: "the desktop app's copy", path: 'client/src/dropgate-core.js' },
];

// Skipping them must never hide a copy in the repository, so this always runs.
it('counts as in the repository exactly when the web UI and the desktop app are there', () => {
  const copiesThere = COPIES.every(({ path }) => existsSync(new URL(path, ROOT)));
  expect(inRepository()).toBe(copiesThere);
});

describe.skipIf(!inRepository())('Copies of the build (in the repository only)', () => {
  for (const { name, path } of COPIES) {
    it(`${name} is this build`, () => {
      expect(existsSync(BUILD), 'dist/index.js is missing: run npm run build first').toBe(true);
      const expected = copyContents(readFileSync(BUILD, 'utf8'));
      // Git may check a copy out with CRLF line endings, which is still the same file.
      const actual = readFileSync(new URL(path, ROOT), 'utf8').replace(/\r\n/g, '\n');
      // Compared as a boolean, so a failure names the file instead of printing both.
      expect(
        actual === expected,
        `${path} isn't the build in dist/: run npm run build in packages/dropgate-core, and commit the copy if it changes`,
      ).toBe(true);
    });
  }
});
