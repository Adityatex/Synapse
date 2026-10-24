import Redis, { type RedisOptions } from 'ioredis';

export type { Redis };

export type RedisHealth =
  | { status: 'disabled' }
  | { status: 'ok'; latencyMs: number }
  | { status: 'down'; error: string };

export interface CreateRedisOptions {
  /** Shown in logs so replicas/services can be told apart. */
  name?: string;
  /** Called for connection errors; the client keeps retrying on its own. */
  onError?: (err: Error) => void;
  /** Overrides for ioredis (BullMQ, for instance, needs maxRetriesPerRequest: null). */
  redis?: RedisOptions;
}

/**
 * One place that decides how every Synapse service talks to Redis.
 *
 * Commands fail fast while disconnected (no offline queue) so a Redis outage
 * degrades the feature that needs it instead of hanging requests, and the
 * client reconnects with capped backoff.
 */
export function createRedisClient(url: string, opts: CreateRedisOptions = {}): Redis {
  const client = new Redis(url, {
    connectionName: opts.name,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
    ...opts.redis,
  });
  // Without a listener ioredis prints every error; we route them to the caller.
  client.on('error', (err) => opts.onError?.(err));
  return client;
}

/**
 * Reports Redis state for /api/health. A missing client means Redis is not
 * configured for this process, which is not an error (principle 7).
 */
export async function checkRedisHealth(
  client: { ping(): Promise<unknown> } | null | undefined,
  timeoutMs = 1000,
): Promise<RedisHealth> {
  if (!client) return { status: 'disabled' };

  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`ping timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    await Promise.race([client.ping(), timeout]);
    return { status: 'ok', latencyMs: Date.now() - started };
  } catch (err) {
    return { status: 'down', error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
