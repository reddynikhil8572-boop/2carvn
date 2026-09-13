import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/setupEnv.ts'],
    // These tests share one Postgres database and create fixtures with fixed
    // identifiers. Running files in parallel would have them clobber each
    // other, so serialise — correctness matters more than a few seconds here.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
