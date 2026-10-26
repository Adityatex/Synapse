import { defineConfig } from 'vitest/config';

export default defineConfig({
  // These tests start an in-memory MongoDB and a Redis queue; a busy machine needs more than 5 s.
  test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 30_000, hookTimeout: 30_000 },
});
