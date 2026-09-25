'use strict';

let Sentry = null;

function getRelease() {
  if (process.env.APP_RELEASE) return process.env.APP_RELEASE;
  if (process.env.RENDER_GIT_COMMIT) return process.env.RENDER_GIT_COMMIT;
  try {
    // eslint-disable-next-line global-require
    const pkg = require('../package.json');
    return `${pkg.name}@${pkg.version}`;
  } catch {
    return 'server@unknown';
  }
}

function initSentry() {
  const dsn = String(process.env.SENTRY_DSN || '').trim();
  if (!dsn) return null;
  try {
    // eslint-disable-next-line global-require
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      release: getRelease(),
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
    });
    return Sentry;
  } catch (err) {
    // eslint-disable-next-line global-require
    require('./logger').logger.warn({ err: String(err && err.message) }, 'Sentry init failed');
    return null;
  }
}

function captureException(err, context) {
  try {
    if (Sentry) Sentry.captureException(err, context);
  } catch {
    // never throw from error reporting
  }
}

module.exports = { initSentry, captureException, getRelease, getSentry: () => Sentry };
