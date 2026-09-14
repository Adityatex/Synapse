const { defineConfig } = require('vitest/config');

/**
 * P0-12 — Vitest for the server test suite.
 * Node environment, per-file isolation, shared setup (see tests/setup.js).
 */
module.exports = defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 15000,
    setupFiles: ['./tests/setup.js'],
  },
});
