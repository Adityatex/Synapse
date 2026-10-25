import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MONGODB_URI: z.string().trim().regex(/^mongodb(\+srv)?:\/\//, 'MONGODB_URI must start with mongodb:// or mongodb+srv://'),
  REDIS_URL: z.string().trim().regex(/^rediss?:\/\//, 'REDIS_URL must start with redis:// or rediss://'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** How many rooms are compacted at once. */
  SNAPSHOT_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
});

export type WorkerConfig = z.infer<typeof schema>;

/** Fails fast: the worker must not start without both its database and its queue. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}
