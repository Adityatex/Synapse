const pino = require('pino');

/**
 * P0-09 — Shared structured logger.
 *
 * Every runtime log line is JSON. Request logs additionally carry `requestId`
 * (see middleware/requestId.js, reused by pino-http via genReqId) and, when
 * known, the authenticated `userId`.
 *
 * Secrets are redacted at the serializer level so `logger.info({ req })`
 * can never leak Authorization headers, cookies, passwords or tokens.
 *
 * Level via LOG_LEVEL (default info). Tests silence it via `logger.level`.
 */
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: {
    service: 'synapse-api',
    env: process.env.NODE_ENV || 'development',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.otp',
      '*.token',
      '*.otpHash',
    ],
    censor: '[REDACTED]',
  },
});

module.exports = logger;
