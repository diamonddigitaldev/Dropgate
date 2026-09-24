import { defineConfig } from 'tsup';

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
    noExternal: ['fflate'],
    platform: 'browser',
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
    noExternal: ['fflate'],
    platform: 'browser',
  },
  // Browser bundle (IIFE)
  {
    entry: ['src/index.ts'],
    format: ['iife'],
    globalName: 'DropgateCore',
    outDir: 'dist',
    outExtension: () => ({ js: '.browser.js' }),
    minify: true,
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
