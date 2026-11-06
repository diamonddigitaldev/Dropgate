// What the web UI's and the desktop app's copies of this package hold, and where
// they are. A copy is a header saying where it comes from, then the ESM build. The
// build's source map isn't copied with it, so its comment pointing at one is left out.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const header = [
  "// Built from packages/dropgate-core by `npm run build` there. Don't edit this file:",
  "// change core's source and build it again. CI fails if this doesn't match the build.",
].join('\n');

/** The repository's root, when this package is its packages/dropgate-core. */
export const ROOT = new URL('../../../', import.meta.url);

/**
 * The contents of a copy, given the build (dist/index.js).
 * @param {string} build
 * @returns {string}
 */
export function copyContents(build) {
  return `${header}\n${build.replace(/\n\/\/# sourceMappingURL=\S+\s*$/, '')}\n`;
}

/**
 * Whether this package is the repository's packages/dropgate-core. Unpacked on its
 * own, from a release's source archive, it has no copies to write or check.
 * @returns {boolean}
 */
export function inRepository() {
  const here = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
  try {
    return realpathSync(fileURLToPath(new URL('packages/dropgate-core/', ROOT))) === here;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}
