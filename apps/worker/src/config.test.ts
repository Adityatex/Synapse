import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = { MONGODB_URI: 'mongodb://localhost/synapse', REDIS_URL: 'redis://localhost:6379' };

describe('worker config', () => {
  it('applies defaults', () => {
    const cfg = loadConfig({ ...base });
    expect(cfg.SNAPSHOT_CONCURRENCY).toBe(4);
    expect(cfg.LOG_LEVEL).toBe('info');
  });

  it('refuses to start without its database or its queue', () => {
    expect(() => loadConfig({ REDIS_URL: base.REDIS_URL })).toThrow(/MONGODB_URI/);
    expect(() => loadConfig({ MONGODB_URI: base.MONGODB_URI })).toThrow(/REDIS_URL/);
    expect(() => loadConfig({ ...base, REDIS_URL: 'http://x' })).toThrow(/REDIS_URL/);
  });

  it('bounds concurrency', () => {
    expect(() => loadConfig({ ...base, SNAPSHOT_CONCURRENCY: '0' })).toThrow(/SNAPSHOT_CONCURRENCY/);
    expect(loadConfig({ ...base, SNAPSHOT_CONCURRENCY: '8' }).SNAPSHOT_CONCURRENCY).toBe(8);
  });
});
