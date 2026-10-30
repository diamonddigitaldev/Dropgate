// Core's version, from its package.json, for the build and the tests to write
// in where src/version.ts reads __DROPGATE_CORE_VERSION__.
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const versionDefine = { __DROPGATE_CORE_VERSION__: JSON.stringify(version) };
