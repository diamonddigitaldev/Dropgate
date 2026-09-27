// What the web UI's and the desktop app's copies of this package hold: a header
// saying where they come from, then the ESM build. The build's source map isn't
// copied with it, so its comment pointing at one is left out.

const header = [
  "// Built from packages/dropgate-core by `npm run build` there. Don't edit this file:",
  "// change core's source and build it again. CI fails if this doesn't match the build.",
].join('\n');

/**
 * The contents of a copy, given the build (dist/index.js).
 * @param {string} build
 * @returns {string}
 */
export function copyContents(build) {
  return `${header}\n${build.replace(/\n\/\/# sourceMappingURL=\S+\s*$/, '')}\n`;
}
