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
    // Every integration file boots its own mongodb-memory-server and drives
    // the app through supertest's ephemeral listeners. With one fork per file
    // all at once, that combination flakes under load — rotating single-file
    // failures that never reproduce solo, including responses the failing
    // file's own app never logged. Capping concurrent workers removes the
    // stampede without serialising the suite.
    maxWorkers: 4,
  },
});
