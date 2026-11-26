// Writes THIRD-PARTY-NOTICES.md from the installed @noble packages' LICENSE
// files (scripts/third-party.mjs). Run it after a package sweep: npm run notices.
import { writeFileSync } from 'node:fs';
import { noticesFile } from './third-party.mjs';

writeFileSync(new URL('../THIRD-PARTY-NOTICES.md', import.meta.url), noticesFile());
console.log('THIRD-PARTY-NOTICES.md written.');
