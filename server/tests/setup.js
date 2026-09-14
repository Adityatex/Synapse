'use strict';

/**
 * P0-12 — Shared Vitest setup.
 *
 * Silence the shared pino logger so passing suites stay readable.
 * (P0-09's JSON-log test uses its own pino instance and is unaffected.)
 */
try {
  const logger = require('../config/logger');
  logger.level = 'silent';
} catch {
  // Logger optional — tests that need output configure their own instance.
}
