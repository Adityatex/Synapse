const crypto = require('crypto');

/**
 * P0-05/P0-07 — Minimal request/correlation ID middleware.
 *
 * - Reuses an incoming `X-Request-Id` header when it looks sane (alphanumeric,
 *   `-`/`_`, max 64 chars) so callers can trace a request end-to-end.
 * - Otherwise generates a UUID v4.
 * - Attaches it as `req.id` and echoes it back as `X-Request-Id`.
 * - P0-09 will add pino structured logging on top of this same ID.
 */
function isSaneRequestId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function requestIdMiddleware(req, res, next) {
  const incoming = req.headers['x-request-id'];
  const requestId = isSaneRequestId(incoming) ? incoming : crypto.randomUUID();

  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

module.exports = requestIdMiddleware;
