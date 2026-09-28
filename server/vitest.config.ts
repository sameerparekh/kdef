import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    // Each test file gets its own freshly-migrated database (test/helpers/testDb.ts).
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
