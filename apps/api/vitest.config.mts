import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // async-mutex (dep of mongodb-memory-server) needs tslib at runtime;
      // pnpm's strict isolation prevents it from finding it, so we resolve it here.
      tslib: resolve(import.meta.dirname, 'node_modules/tslib'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    setupFiles: ['src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**', 'src/index.ts'],
    },
    // Integration tests spin up mongodb-memory-server, which is slow to boot.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
