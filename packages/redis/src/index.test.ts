import { describe, expect, it } from 'vitest';
import { checkRedisHealth } from './index';

describe('checkRedisHealth', () => {
  it('reports disabled when no client is configured', async () => {
    expect(await checkRedisHealth(null)).toEqual({ status: 'disabled' });
  });

  it('reports ok with latency when ping succeeds', async () => {
    const health = await checkRedisHealth({ ping: async () => 'PONG' });
    expect(health.status).toBe('ok');
  });

  it('reports down with the error when ping rejects', async () => {
    const health = await checkRedisHealth({
      ping: async () => {
        throw new Error('Stream isn\'t writeable');
      },
    });
    expect(health).toEqual({ status: 'down', error: "Stream isn't writeable" });
  });

  it('reports down when ping hangs past the timeout', async () => {
    const health = await checkRedisHealth({ ping: () => new Promise(() => {}) }, 20);
    expect(health.status).toBe('down');
  });
});
