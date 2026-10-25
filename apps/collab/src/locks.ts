import type { Redis } from '@synapse/redis';

/**
 * Focus locks (P2-08): at most one member holds the edit lock on a file, and a lock that is
 * not renewed expires by itself, so a closed laptop or a crashed tab never strands a file.
 * Locks live in Redis (not in the document) because they are transient and every collab
 * replica must see the same ones.
 */

export interface LockHolder {
  userId: string;
  name: string;
  /** The websocket that took the lock, so closing it can release the lock straight away. */
  connectionId: string;
}

export interface LockEntry extends LockHolder {
  /** Epoch ms, from the store's clock. */
  expiresAt: number;
}

export type AcquireResult = { ok: true; entry: LockEntry } | { ok: false; entry: LockEntry };

export interface LockStore {
  /** Takes the lock, or renews it when `holder.userId` already has it. Fails when someone else does. */
  acquire(roomId: string, fileId: string, holder: LockHolder, ttlMs: number): Promise<AcquireResult>;
  /** Extends a lock `userId` holds. Null when they do not hold it (it expired or was taken). */
  renew(roomId: string, fileId: string, userId: string, ttlMs: number): Promise<LockEntry | null>;
  /** Releases a lock `userId` holds. False when they did not hold it. */
  release(roomId: string, fileId: string, userId: string): Promise<boolean>;
  /** Releases every lock taken through one connection; returns the files freed. */
  releaseConnection(roomId: string, connectionId: string): Promise<string[]>;
  /** Live locks only. */
  list(roomId: string): Promise<Record<string, LockEntry>>;
}

export class MemoryLockStore implements LockStore {
  private readonly rooms = new Map<string, Map<string, LockEntry>>();

  constructor(private readonly now: () => number = Date.now) {}

  private live(roomId: string): Map<string, LockEntry> {
    const locks = this.rooms.get(roomId) ?? new Map<string, LockEntry>();
    this.rooms.set(roomId, locks);
    const now = this.now();
    for (const [fileId, entry] of locks) if (entry.expiresAt <= now) locks.delete(fileId);
    return locks;
  }

  async acquire(roomId: string, fileId: string, holder: LockHolder, ttlMs: number): Promise<AcquireResult> {
    const locks = this.live(roomId);
    const current = locks.get(fileId);
    if (current && current.userId !== holder.userId) return { ok: false, entry: current };
    const entry = { ...holder, expiresAt: this.now() + ttlMs };
    locks.set(fileId, entry);
    return { ok: true, entry };
  }

  async renew(roomId: string, fileId: string, userId: string, ttlMs: number): Promise<LockEntry | null> {
    const locks = this.live(roomId);
    const current = locks.get(fileId);
    if (!current || current.userId !== userId) return null;
    const entry = { ...current, expiresAt: this.now() + ttlMs };
    locks.set(fileId, entry);
    return entry;
  }

  async release(roomId: string, fileId: string, userId: string): Promise<boolean> {
    const locks = this.live(roomId);
    if (locks.get(fileId)?.userId !== userId) return false;
    locks.delete(fileId);
    return true;
  }

  async releaseConnection(roomId: string, connectionId: string): Promise<string[]> {
    const freed: string[] = [];
    for (const [fileId, entry] of this.live(roomId)) {
      if (entry.connectionId === connectionId) {
        this.rooms.get(roomId)?.delete(fileId);
        freed.push(fileId);
      }
    }
    return freed;
  }

  async list(roomId: string): Promise<Record<string, LockEntry>> {
    return Object.fromEntries(this.live(roomId));
  }
}

// Every script reads the clock from Redis itself, so replicas with skewed clocks agree on expiry,
// and each runs atomically, so two replicas cannot both take the same lock.
const NOW = `local t = redis.call('TIME'); local now = t[1] * 1000 + math.floor(t[2] / 1000)`;

const ACQUIRE = `${NOW}
local current = redis.call('HGET', KEYS[1], ARGV[1])
if current then
  local entry = cjson.decode(current)
  if entry.expiresAt > now and entry.userId ~= ARGV[2] then return {0, current} end
end
local entry = cjson.encode({ userId = ARGV[2], name = ARGV[3], connectionId = ARGV[4], expiresAt = now + tonumber(ARGV[5]) })
redis.call('HSET', KEYS[1], ARGV[1], entry)
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[5]) * 4)
return {1, entry}`;

const RENEW = `${NOW}
local current = redis.call('HGET', KEYS[1], ARGV[1])
if not current then return false end
local entry = cjson.decode(current)
if entry.expiresAt <= now or entry.userId ~= ARGV[2] then return false end
entry.expiresAt = now + tonumber(ARGV[3])
local encoded = cjson.encode(entry)
redis.call('HSET', KEYS[1], ARGV[1], encoded)
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]) * 4)
return encoded`;

const RELEASE = `local current = redis.call('HGET', KEYS[1], ARGV[1])
if not current then return 0 end
if cjson.decode(current).userId ~= ARGV[2] then return 0 end
redis.call('HDEL', KEYS[1], ARGV[1])
return 1`;

const RELEASE_CONNECTION = `local freed = {}
local all = redis.call('HGETALL', KEYS[1])
for i = 1, #all, 2 do
  if cjson.decode(all[i + 1]).connectionId == ARGV[1] then
    redis.call('HDEL', KEYS[1], all[i])
    freed[#freed + 1] = all[i]
  end
end
return freed`;

// Expired entries are dropped here, as they are noticed.
const LIST = `${NOW}
local out = {}
local all = redis.call('HGETALL', KEYS[1])
for i = 1, #all, 2 do
  if cjson.decode(all[i + 1]).expiresAt <= now then
    redis.call('HDEL', KEYS[1], all[i])
  else
    out[#out + 1] = all[i]
    out[#out + 1] = all[i + 1]
  end
end
return out`;

type Scripts = {
  lockAcquire(key: string, ...args: string[]): Promise<[number, string]>;
  lockRenew(key: string, ...args: string[]): Promise<string | null>;
  lockRelease(key: string, ...args: string[]): Promise<number>;
  lockReleaseConnection(key: string, ...args: string[]): Promise<string[]>;
  lockList(key: string): Promise<string[]>;
};

export class RedisLockStore implements LockStore {
  private readonly scripts: Scripts;

  constructor(
    client: Redis,
    private readonly prefix = 'synapse:locks',
  ) {
    for (const [name, lua] of Object.entries({
      lockAcquire: ACQUIRE,
      lockRenew: RENEW,
      lockRelease: RELEASE,
      lockReleaseConnection: RELEASE_CONNECTION,
      lockList: LIST,
    })) {
      client.defineCommand(name, { numberOfKeys: 1, lua });
    }
    this.scripts = client as unknown as Scripts;
  }

  private key(roomId: string): string {
    return `${this.prefix}:${roomId}`;
  }

  async acquire(roomId: string, fileId: string, holder: LockHolder, ttlMs: number): Promise<AcquireResult> {
    const [ok, entry] = await this.scripts.lockAcquire(this.key(roomId), fileId, holder.userId, holder.name, holder.connectionId, String(ttlMs));
    return { ok: ok === 1, entry: JSON.parse(entry) as LockEntry };
  }

  async renew(roomId: string, fileId: string, userId: string, ttlMs: number): Promise<LockEntry | null> {
    const entry = await this.scripts.lockRenew(this.key(roomId), fileId, userId, String(ttlMs));
    return entry ? (JSON.parse(entry) as LockEntry) : null;
  }

  async release(roomId: string, fileId: string, userId: string): Promise<boolean> {
    return (await this.scripts.lockRelease(this.key(roomId), fileId, userId)) === 1;
  }

  async releaseConnection(roomId: string, connectionId: string): Promise<string[]> {
    return this.scripts.lockReleaseConnection(this.key(roomId), connectionId);
  }

  async list(roomId: string): Promise<Record<string, LockEntry>> {
    const flat = await this.scripts.lockList(this.key(roomId));
    const locks: Record<string, LockEntry> = {};
    for (let i = 0; i < flat.length; i += 2) locks[flat[i]] = JSON.parse(flat[i + 1]) as LockEntry;
    return locks;
  }
}
