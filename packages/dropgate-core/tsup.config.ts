import { defineConfig } from 'tsup';
import { buildBanner } from './scripts/third-party.mjs';
import { testBuildDefine } from './scripts/test-build-define.mjs';
import { versionDefine } from './scripts/version-define.mjs';

// @noble's MIT notice, at the top of every build, as its licence asks
// (scripts/third-party.mjs); THIRD-PARTY-NOTICES.md has each licence in full.
const banner = { js: buildBanner() };

// Never a test build (scripts/test-build-define.mjs).
const define = { ...versionDefine, ...testBuildDefine(false) };

export default defineConfig([
  // Main entry - ESM and CJS
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
    sourcemap: true,
    clean: true,
    target: 'es2020',
    splitting: false,
    platform: 'browser',
    define,
    banner,
  },
  // Browser bundle (IIFE)
  {
    entry: ['src/index.ts'],
    format: ['iife'],
    globalName: 'DropgateCore',
    outDir: 'dist',
    outExtension: () => ({ js: '.browser.js' }),
    minify: true,
    define,
    banner,
    sourcemap: true,
    target: 'es2020',
    esbuildOptions(options) {
      options.footer = {
        js: 'if(typeof window!=="undefined"){window.DropgateCore=DropgateCore;}',
      };
    },
  },
]);
