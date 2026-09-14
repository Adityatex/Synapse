import * as Sentry from '@sentry/react';

/**
 * P0-10 — Client error tracking.
 *
 * - Offline-safe: without VITE_SENTRY_DSN nothing is initialized.
 * - Release comes from VITE_SENTRY_RELEASE (CI sets it to the git SHA;
 *   P0-14 documents it). Defaults to 'dev'.
 * - tracesSampleRate 0: errors only in P0, no performance tracing.
 */
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;

  if (!dsn) {
    return;
  }

  Sentry.init({
    dsn,
    release: import.meta.env.VITE_SENTRY_RELEASE || 'dev',
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
  });
}

export function setSentryUser(user) {
  Sentry.setUser(
    user
      ? {
          id: user.userId,
          email: user.email,
          username: user.name || user.username,
        }
      : null
  );
}

export { Sentry };
