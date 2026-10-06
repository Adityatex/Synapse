'use strict';

const { z } = require('zod');

const PLACEHOLDER_PATTERNS = [
  /replace_with/i,
  /your_.+_here/i,
  /^your[-_]/i,
  /^changeme$/i,
  /^secret$/i,
  /^test$/i,
  /^12345/,
];

function isPlaceholder(value) {
  if (!value) return true;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(String(value)));
}

const commaSeparatedOrigins = z
  .string()
  .trim()
  .refine(
    (val) => {
      if (!val) return true;
      return val.split(',').every((origin) => {
        const o = origin.trim();
        if (!o) return true;
        if (o === '*') return false;
        try {
          const url = new URL(o);
          return url.protocol === 'http:' || url.protocol === 'https:';
        } catch {
          return false;
        }
      });
    },
    { message: 'CORS_ORIGIN/CLIENT_URL must be comma-separated http(s) URLs' }
  )
  .optional()
  .default('');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    JWT_SECRET: z
      .string()
      .min(16, { message: 'JWT_SECRET must be at least 16 characters' })
      .refine((v) => !isPlaceholder(v), {
        message: 'JWT_SECRET is still a placeholder — set a strong random value',
      }),
    MONGODB_URI: z
      .string()
      .trim()
      .optional()
      .default('')
      .refine((v) => !v || /^mongodb(\+srv)?:\/\//.test(v), {
        message: 'MONGODB_URI must start with mongodb:// or mongodb+srv://',
      }),
    CORS_ORIGIN: commaSeparatedOrigins,
    CLIENT_URL: commaSeparatedOrigins,
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    APP_RELEASE: z.string().trim().optional().default(''),
    SENTRY_DSN: z.string().trim().optional().default(''),
  })
  .superRefine((val, ctx) => {
    if (val.NODE_ENV === 'production') {
      if (!val.MONGODB_URI) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['MONGODB_URI'],
          message: 'MONGODB_URI is required in production',
        });
      }
      if (!val.CORS_ORIGIN && !val.CLIENT_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGIN'],
          message: 'CORS_ORIGIN (or CLIENT_URL) is required in production',
        });
      }
      if (String(val.JWT_SECRET || '').length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_SECRET'],
          message: 'JWT_SECRET must be at least 32 characters in production',
        });
      }
    }
  });

function validateEnv(source = process.env) {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    const err = new Error(`Invalid environment configuration: ${details}`);
    err.name = 'EnvValidationError';
    err.details = parsed.error.issues;
    throw err;
  }
  return parsed.data;
}

module.exports = { envSchema, validateEnv };
