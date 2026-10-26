import { createRedisClient, type Redis } from '@synapse/redis';
import { afterAll, describe, expect, it } from 'vitest';
import { MemoryLockStore, RedisLockStore, type LockHolder, type LockStore } from './locks.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const redis: Redis | null = await (async () => {
  const client = createRedisClient(REDIS_URL, { redis: { enableOfflineQueue: true, retryStrategy: () => null, connectTimeout: 800 } });
  try {
    await client.ping();
    return client;
  } catch {
    client.disconnect();
    return null;
  }
})();
afterAll(() => redis?.disconnect());

const ada: LockHolder = { userId: 'ada', name: 'Ada', connectionId: 'ada-1' };
const bob: LockHolder = { userId: 'bob', name: 'Bob', connectionId: 'bob-1' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const room = () => `ROOM${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

// The same behaviour is required of the in-memory store (single instance, tests) and the Redis one.
const stores: Array<[string, (() => LockStore) | null]> = [
  ['MemoryLockStore', () => new MemoryLockStore()],
  ['RedisLockStore', redis ? () => new RedisLockStore(redis, `test:locks:${Math.random().toString(36).slice(2)}`) : null],
];

describe.each(stores)('%s', (_name, make) => {
  const it_ = make ? it : it.skip;

  it_('gives a free lock to the first member and refuses the second', async () => {
    const store = make!();
    const roomId = room();
    const first = await store.acquire(roomId, 'f1', ada, 5000);
    expect(first.ok).toBe(true);
    const second = await store.acquire(roomId, 'f1', bob, 5000);
    expect(second.ok).toBe(false);
    expect(second.entry).toMatchObject({ userId: 'ada', name: 'Ada', connectionId: 'ada-1' });
    expect(Object.keys(await store.list(roomId))).toEqual(['f1']);
  });

  it_('lets the holder take the lock again, from another tab, and keeps the others out', async () => {
    const store = make!();
    const roomId = room();
    await store.acquire(roomId, 'f1', ada, 5000);
    const again = await store.acquire(roomId, 'f1', { ...ada, connectionId: 'ada-2' }, 5000);
    expect(again.ok).toBe(true);
    expect(again.entry.connectionId).toBe('ada-2');
    expect((await store.acquire(roomId, 'f1', bob, 5000)).ok).toBe(false);
  });

  it_('locks files independently, per room', async () => {
    const store = make!();
    const [one, two] = [room(), room()];
    await store.acquire(one, 'f1', ada, 5000);
    expect((await store.acquire(one, 'f2', bob, 5000)).ok).toBe(true);
    expect((await store.acquire(two, 'f1', bob, 5000)).ok).toBe(true);
  });

  it_('renews only for the holder', async () => {
    const store = make!();
    const roomId = room();
    const taken = await store.acquire(roomId, 'f1', ada, 1000);
    const renewed = await store.renew(roomId, 'f1', 'ada', 5000);
    expect(renewed!.expiresAt).toBeGreaterThan(taken.entry.expiresAt + 3000);
    expect(await store.renew(roomId, 'f1', 'bob', 5000)).toBeNull();
    expect(await store.renew(roomId, 'nope', 'ada', 5000)).toBeNull();
  });

  it_('releases only for the holder, and then the file is free', async () => {
    const store = make!();
    const roomId = room();
    await store.acquire(roomId, 'f1', ada, 5000);
    expect(await store.release(roomId, 'f1', 'bob')).toBe(false);
    expect(await store.release(roomId, 'f1', 'ada')).toBe(true);
    expect(await store.release(roomId, 'f1', 'ada')).toBe(false);
    expect((await store.acquire(roomId, 'f1', bob, 5000)).ok).toBe(true);
  });

  it_('expires a lock that is not renewed', async () => {
    const store = make!();
    const roomId = room();
    await store.acquire(roomId, 'f1', ada, 150);
    expect(Object.keys(await store.list(roomId))).toEqual(['f1']);
    await sleep(300);
    expect(await store.list(roomId)).toEqual({});
    expect(await store.renew(roomId, 'f1', 'ada', 5000)).toBeNull(); // too late: it is gone
    expect((await store.acquire(roomId, 'f1', bob, 5000)).ok).toBe(true);
  });

  it_('keeps a lock alive for as long as it is renewed', async () => {
    const store = make!();
    const roomId = room();
    await store.acquire(roomId, 'f1', ada, 200);
    for (let i = 0; i < 4; i++) {
      await sleep(100);
      expect(await store.renew(roomId, 'f1', 'ada', 200)).not.toBeNull();
    }
    expect((await store.acquire(roomId, 'f1', bob, 200)).ok).toBe(false);
  });

  it_('frees every lock taken through a closed connection and no others', async () => {
    const store = make!();
    const roomId = room();
    await store.acquire(roomId, 'f1', ada, 5000);
    await store.acquire(roomId, 'f2', ada, 5000);
    await store.acquire(roomId, 'f3', { ...ada, connectionId: 'ada-2' }, 5000);
    await store.acquire(roomId, 'f4', bob, 5000);
    expect((await store.releaseConnection(roomId, 'ada-1')).sort()).toEqual(['f1', 'f2']);
    expect(Object.keys(await store.list(roomId)).sort()).toEqual(['f3', 'f4']);
    expect(await store.releaseConnection(roomId, 'ada-1')).toEqual([]);
  });
});
