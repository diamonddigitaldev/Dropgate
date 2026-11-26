import { defineConfig } from 'vitest/config';
import { testBuildDefine } from './scripts/test-build-define.mjs';
import { versionDefine } from './scripts/version-define.mjs';

export default defineConfig({
  // A test build: Noise's known-answer tests may pin its ephemerals and lower its rekey interval.
  define: { ...versionDefine, ...testBuildDefine(true) },
  test: {
    // Plain Node, with no browser environment. The web UI and the desktop app are
    // tested in real browsers and Electron by the integration tests.
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/tests/**', '**/scripts/**', '**/*.config.*'],
    },
  },
});
