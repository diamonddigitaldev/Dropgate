import { defineConfig } from 'vitest/config';

export default defineConfig({
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
