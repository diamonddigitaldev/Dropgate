// Writes this package's ESM build into the web UI and the desktop app, which load
// it as their own dropgate-core.js. `npm run build` runs this after tsup.
import { readFileSync, writeFileSync } from 'node:fs';
import { copyContents } from './copy-contents.mjs';

const root = new URL('../../../', import.meta.url);
const copies = ['server/public/js/dropgate-core.js', 'client/src/dropgate-core.js'];

const contents = copyContents(readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8'));

for (const copy of copies) {
  const file = new URL(copy, root);
  let current;
  try {
    // Git may check a copy out with CRLF line endings, which is still the same file.
    current = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (current === contents) {
    console.log(`${copy}: unchanged`);
    continue;
  }
  writeFileSync(file, contents);
  console.log(`${copy}: updated`);
}
