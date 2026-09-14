const logger = require('./logger');

/**
 * P0-10 — Sentry error tracking (server).
 *
 * - Offline-safe: without SENTRY_DSN everything is a no-op (warn once).
 * - Release comes from SENTRY_RELEASE (CI/prod sets it to the git SHA;
 *   P0-14 documents it). Defaults to 'dev'.
 * - tracesSampleRate 0: errors only in P0, no performance tracing.
 * - Per-capture withScope() so concurrent requests never leak user/room
 *   context into each other's events.
 */

let Sentry = null;
let initialized = false;

function getRelease() {
  return process.env.SENTRY_RELEASE || 'dev';
}

function initSentry(overrides) {
  const options = {
    dsn: process.env.SENTRY_DSN,
    release: getRelease(),
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0,
    ...(overrides || {}),
  };

  if (!options.dsn) {
    logger.warn('SENTRY_DSN is not set — server error tracking disabled.');
    return null;
  }

  // Lazy require so the SDK is only loaded when actually enabled.
  Sentry = require('@sentry/node');
  Sentry.init(options);
  initialized = true;
  logger.info({ release: options.release }, 'Sentry error tracking enabled');
  return Sentry;
}

function isEnabled() {
  return initialized && Sentry !== null;
}

/**
 * Sends `err` to Sentry with user/room/request context.
 * Logging stays at the call site — this only reports.
 */
function captureError(err, context) {
  if (!isEnabled()) {
    return;
  }

  const { userId, roomId, requestId, event } = context || {};

  Sentry.withScope((scope) => {
    if (userId) {
      scope.setUser({ id: userId });
    }

    if (requestId) {
      scope.setTag('requestId', requestId);
    }

    if (roomId) {
      scope.setTag('roomId', roomId);
    }

    if (event) {
      scope.setTag('event', event);
    }

    Sentry.captureException(err);
  });
}

async function flushSentry(timeoutMs) {
  if (!isEnabled()) {
    return false;
  }

  return Sentry.flush(timeoutMs === undefined ? 2000 : timeoutMs);
}

async function closeSentry() {
  if (!isEnabled()) {
    return;
  }

  await Sentry.close();
  Sentry = null;
  initialized = false;
}

module.exports = {
  initSentry,
  isEnabled,
  captureError,
  flushSentry,
  closeSentry,
  getRelease,
};
