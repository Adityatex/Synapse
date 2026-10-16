'use strict';

const pino = require('pino');

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const release = process.env.APP_RELEASE || process.env.RENDER_GIT_COMMIT || '';

const logger = pino({
  level,
  base: release ? { pid: process.pid, release } : undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.otp',
      '*.token',
      '*.JWT_SECRET',
      '*.GMAIL_APP_PASSWORD',
      '*.BREVO_API_KEY',
      '*.GROQ_API_KEY',
      '*.JUDGE0_API_KEY',
    ],
    censor: '[Redacted]',
  },
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } },
});

module.exports = { logger };
