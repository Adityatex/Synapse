const { z } = require('zod');

/**
 * P0-06 — Boot-time environment validation.
 *
 * Roadmap: JWT_SECRET (≥ 32 chars), MONGODB_URI and CORS_ORIGIN are required
 * in production. JWT_SECRET is required in every environment (auth cannot work
 * without it — see F15). MONGODB_URI / CORS_ORIGIN are warnings in development
 * (local dev without Atlas is still supported) but fatal in production.
 *
 * The server calls loadEnvOrExit() before doing anything else, so a
 * misconfigured deploy exits with code 1 BEFORE listen() instead of failing
 * on the first login.
 */

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(5000),
    JWT_SECRET: z
      .string('JWT_SECRET is missing. Set a random value ≥ 32 characters in server/.env.')
      .min(32, 'JWT_SECRET must be at least 32 characters long.'),
    MONGODB_URI: z.string().optional(),
    CORS_ORIGIN: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.NODE_ENV !== 'production') {
      return;
    }

    if (!val.MONGODB_URI) {
      ctx.addIssue({
        code: 'custom',
        path: ['MONGODB_URI'],
        message: 'MONGODB_URI is required in production.',
      });
    }

    if (!val.CORS_ORIGIN) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGIN'],
        message: 'CORS_ORIGIN is required in production.',
      });
    }
  });

/**
 * Pure validation — safe to use in tests. Returns the zod safeParse result.
 */
function validateEnv(source) {
  return envSchema.safeParse(source || {});
}

function redactSecret(value) {
  if (!value) {
    return '(not set)';
  }

  return `(set, ${String(value).length} chars)`;
}

/**
 * Logs the loaded configuration with secrets redacted. Never prints values.
 */
function logConfigTable(env) {
  const rows = [
    { setting: 'NODE_ENV', value: env.NODE_ENV },
    { setting: 'PORT', value: String(env.PORT) },
    { setting: 'JWT_SECRET', value: redactSecret(env.JWT_SECRET) },
    { setting: 'MONGODB_URI', value: env.MONGODB_URI ? '(set)' : '(not set)' },
    { setting: 'CORS_ORIGIN', value: env.CORS_ORIGIN || '(not set — permissive CORS)' },
  ];

  console.log('Loaded configuration:');
  console.table(rows);
}

/**
 * Validates process.env and exits(1) with a clear message on failure.
 * Call this at the very top of server.js, before listen() or DB connects.
 */
function loadEnvOrExit(source) {
  const envSource = source || process.env;
  const result = validateEnv(envSource);

  if (!result.success) {
    console.error('Invalid server configuration — refusing to boot:');

    for (const issue of result.error.issues) {
      const name = issue.path.length > 0 ? issue.path.join('.') : 'config';
      console.error(`  - ${name}: ${issue.message}`);
    }

    console.error('Fix server/.env (see server/.env.example) and restart.');
    process.exit(1);
  }

  const env = result.data;

  if (env.NODE_ENV !== 'production') {
    if (!env.MONGODB_URI) {
      console.warn('Warning: MONGODB_URI is not set — auth and persistence will be unavailable.');
    }

    if (!env.CORS_ORIGIN) {
      console.warn('Warning: CORS_ORIGIN is not set — CORS is permissive.');
    }
  }

  logConfigTable(env);
  return env;
}

module.exports = { envSchema, validateEnv, loadEnvOrExit, logConfigTable };
