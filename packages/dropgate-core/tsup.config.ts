import { defineConfig } from 'tsup';
import { buildBanner } from './scripts/third-party.mjs';
import { versionDefine } from './scripts/version-define.mjs';

// @noble's MIT notice, at the top of every build, as its licence asks
// (scripts/third-party.mjs); THIRD-PARTY-NOTICES.md has each licence in full.
const banner = { js: buildBanner() };

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
    external: ['peerjs'],
    platform: 'browser',
    define: versionDefine,
    banner,
  },
  // P2P submodule - ESM and CJS
  {
    entry: { 'p2p/index': 'src/p2p/index.ts' },
    format: ['esm', 'cjs'],
    dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
    sourcemap: true,
    target: 'es2020',
    splitting: false,
    external: ['peerjs'],
    platform: 'browser',
    define: versionDefine,
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
    define: versionDefine,
    banner,
    sourcemap: true,
    target: 'es2020',
    external: ['peerjs'],
    esbuildOptions(options) {
      options.footer = {
        js: 'if(typeof window!=="undefined"){window.DropgateCore=DropgateCore;}',
      };
    },
  },
]);
