import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/vitest/**/*.test.js'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 15_000,
    pool: 'forks',
  },
});
