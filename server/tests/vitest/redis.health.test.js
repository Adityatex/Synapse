import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-for-p2-02-1234567890';

describe('P2-02: /api/health reports Redis', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('reports redis as disabled when REDIS_URL is not configured', async () => {
    const request = require('supertest');
    const { app } = require('../../server');

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.redis).toEqual({ status: 'disabled' });
  });

  it('stays healthy and reports down when Redis is unreachable', async () => {
    const request = require('supertest');
    const { app } = require('../../server');
    const { initRedis, closeRedis } = require('../../lib/redis');

    // Nothing listens on this port, so every command fails fast.
    initRedis('redis://127.0.0.1:1');
    try {
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.redis.status).toBe('down');
    } finally {
      await closeRedis();
    }
  });
});

describe('P2-02: REDIS_URL validation', () => {
  it('accepts redis:// and rediss:// and an empty value', () => {
    const { validateEnv } = require('../../config/env');
    const base = { ...process.env, NODE_ENV: 'test' };
    expect(validateEnv({ ...base, REDIS_URL: 'redis://localhost:6379' }).REDIS_URL).toBe('redis://localhost:6379');
    expect(validateEnv({ ...base, REDIS_URL: 'rediss://default:pw@x.upstash.io:6379' }).REDIS_URL).toMatch(/^rediss:/);
    expect(validateEnv({ ...base, REDIS_URL: '' }).REDIS_URL).toBe('');
  });

  it('rejects other schemes', () => {
    const { validateEnv } = require('../../config/env');
    expect(() => validateEnv({ ...process.env, NODE_ENV: 'test', REDIS_URL: 'http://localhost:6379' })).toThrow(/REDIS_URL/);
  });
});
