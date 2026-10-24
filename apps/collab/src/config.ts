import { z } from 'zod';

const placeholder = /replace_with|your_.+_here|^changeme$|^secret$/i;

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(5001),
    JWT_SECRET: z
      .string()
      .min(16, 'JWT_SECRET must be at least 16 characters')
      .refine((v) => !placeholder.test(v), 'JWT_SECRET is still a placeholder'),
    MONGODB_URI: z.string().trim().regex(/^mongodb(\+srv)?:\/\//, 'MONGODB_URI must start with mongodb:// or mongodb+srv://'),
    REDIS_URL: z
      .string()
      .trim()
      .default('')
      .refine((v) => !v || /^rediss?:\/\//.test(v), 'REDIS_URL must start with redis:// or rediss://'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    APP_RELEASE: z.string().trim().default(''),
    /** Per-IP websocket connections allowed per minute before a short ban. */
    COLLAB_CONNECTIONS_PER_MIN: z.coerce.number().int().min(1).default(300),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.JWT_SECRET.length < 32) {
      ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'JWT_SECRET must be at least 32 characters in production' });
    }
  });

export type CollabConfig = z.infer<typeof schema>;

/** Fails fast (P0-06 style): the process must not listen with a bad config. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): CollabConfig {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}
