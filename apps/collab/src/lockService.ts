import { getFilesMap, touchedFileIds } from '@synapse/room-doc';
import type * as Y from 'yjs';
import { z } from 'zod';
import type { LockEntry, LockStore } from './locks.js';
import type { RoomSettings } from './roomAccess.js';

/**
 * Focus locks as a policy (P2-08). With `locksEnabled` on for a room, a member can take the
 * lock on a file: for as long as they hold it, edits to that file's text from anyone else are
 * dropped by the server. Files nobody has locked stay open to everyone, and edits merge as usual.
 *
 * Failure policy: if the lock state cannot be read (Redis or Mongo down) edits are allowed, because
 * losing exclusivity for a while is better than freezing every room. If the state can be read but an
 * update cannot be attributed to a file, it is refused whenever somebody else holds a lock.
 */

export const LOCK_TTL_MS = 45_000;
export const MAX_LOCKS_PER_USER = 5;

const fileId = z.string().min(1).max(100);

/** What a client may send (as a Hocuspocus stateless message). */
export const lockRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('locks.acquire'), fileId }),
  z.object({ type: z.literal('locks.renew'), fileId }),
  z.object({ type: z.literal('locks.release'), fileId }),
  z.object({ type: z.literal('locks.sync') }),
]);
export type LockRequest = z.infer<typeof lockRequestSchema>;

export interface PublicLock {
  userId: string;
  name: string;
  expiresAt: number;
}

export interface LockSnapshot {
  /** Whether the room has locks switched on. */
  enabled: boolean;
  locks: Record<string, PublicLock>;
}

export type DeniedReason = 'held' | 'disabled' | 'unknown-file' | 'limit' | 'expired' | 'unavailable';

/** What the server sends. */
export type LockMessage =
  | ({ type: 'locks.snapshot' } & LockSnapshot)
  | { type: 'locks.denied'; fileId: string; reason: DeniedReason; holder?: { userId: string; name: string } }
  /** An edit was dropped: its author does not hold the lock. */
  | { type: 'locks.rejected'; fileIds: string[]; holders: Array<{ userId: string; name: string }> };

export interface LockServiceOptions {
  store: LockStore;
  settings: (roomId: string) => Promise<RoomSettings | null>;
  ttlMs?: number;
  /** How long a room's `locksEnabled` is trusted. The api changes it, and a change is noticed this fast. */
  settingsCacheMs?: number;
  /** How long a room's lock list is trusted when checking edits (actions refresh it at once). */
  locksCacheMs?: number;
  onProblem?: (err: unknown, what: string) => void;
}

export interface LockActor {
  roomId: string;
  user: { userId: string; name: string };
  connectionId: string;
  document: Y.Doc;
}

export interface LockOutcome {
  /** For the connection that asked. */
  reply?: LockMessage;
  /** For everyone in the room, when the set of locks changed. */
  broadcast?: LockMessage;
}

const publicLock = (entry: LockEntry): PublicLock => ({ userId: entry.userId, name: entry.name, expiresAt: entry.expiresAt });

/** The part of a snapshot that clients show: who holds what. Renewals alone do not change it. */
export function snapshotSignature(snapshot: LockSnapshot): string {
  return JSON.stringify([snapshot.enabled, Object.entries(snapshot.locks).map(([id, lock]) => [id, lock.userId]).sort()]);
}

export class LockService {
  private readonly ttlMs: number;
  private readonly settingsCacheMs: number;
  private readonly locksCacheMs: number;
  private readonly enabledCache = new Map<string, { at: number; enabled: boolean }>();
  private readonly locksCache = new Map<string, { at: number; locks: Record<string, LockEntry> }>();

  constructor(private readonly options: LockServiceOptions) {
    this.ttlMs = options.ttlMs ?? LOCK_TTL_MS;
    this.settingsCacheMs = options.settingsCacheMs ?? 2_000;
    this.locksCacheMs = options.locksCacheMs ?? 300;
  }

  private async isEnabled(roomId: string, maxAgeMs = this.settingsCacheMs): Promise<boolean> {
    const cached = this.enabledCache.get(roomId);
    if (cached && Date.now() - cached.at <= maxAgeMs) return cached.enabled;
    const settings = await this.options.settings(roomId);
    const enabled = settings?.locksEnabled === true;
    this.enabledCache.set(roomId, { at: Date.now(), enabled });
    return enabled;
  }

  private async liveLocks(roomId: string, maxAgeMs = this.locksCacheMs): Promise<Record<string, LockEntry>> {
    const cached = this.locksCache.get(roomId);
    if (cached && Date.now() - cached.at <= maxAgeMs) return cached.locks;
    const locks = await this.options.store.list(roomId);
    this.locksCache.set(roomId, { at: Date.now(), locks });
    return locks;
  }

  /** The room's current lock state as clients see it. `fresh` skips the caches. */
  async snapshot(roomId: string, fresh = false): Promise<LockSnapshot> {
    const enabled = await this.isEnabled(roomId, fresh ? 0 : this.settingsCacheMs);
    const locks = enabled ? await this.liveLocks(roomId, fresh ? 0 : this.locksCacheMs) : {};
    return { enabled, locks: Object.fromEntries(Object.entries(locks).map(([id, entry]) => [id, publicLock(entry)])) };
  }

  /** Forget what is cached for a room that is no longer loaded. */
  forget(roomId: string): void {
    this.enabledCache.delete(roomId);
    this.locksCache.delete(roomId);
  }

  async handle(actor: LockActor, request: LockRequest): Promise<LockOutcome> {
    try {
      return await this.apply(actor, request);
    } catch (err) {
      this.options.onProblem?.(err, `locks.${request.type}`);
      return request.type === 'locks.sync'
        ? {}
        : { reply: { type: 'locks.denied', fileId: 'fileId' in request ? request.fileId : '', reason: 'unavailable' } };
    }
  }

  private async apply(actor: LockActor, request: LockRequest): Promise<LockOutcome> {
    const { roomId, user, connectionId } = actor;
    const { store } = this.options;

    if (request.type === 'locks.sync') {
      return { reply: { type: 'locks.snapshot', ...(await this.snapshot(roomId, true)) } };
    }
    const { fileId: target } = request;

    if (request.type === 'locks.acquire') {
      if (!(await this.isEnabled(roomId, 0))) return { reply: { type: 'locks.denied', fileId: target, reason: 'disabled' } };
      const node = getFilesMap(actor.document).get(target);
      if (!node || typeof node.get('deletedAt') === 'number') {
        return { reply: { type: 'locks.denied', fileId: target, reason: 'unknown-file' } };
      }
      const held = await store.list(roomId);
      const mine = Object.entries(held).filter(([id, lock]) => lock.userId === user.userId && id !== target).length;
      if (mine >= MAX_LOCKS_PER_USER) return { reply: { type: 'locks.denied', fileId: target, reason: 'limit' } };

      const result = await store.acquire(roomId, target, { userId: user.userId, name: user.name, connectionId }, this.ttlMs);
      if (!result.ok) {
        return { reply: { type: 'locks.denied', fileId: target, reason: 'held', holder: { userId: result.entry.userId, name: result.entry.name } } };
      }
      const wasMine = held[target]?.userId === user.userId;
      this.locksCache.set(roomId, { at: Date.now(), locks: { ...held, [target]: result.entry } });
      // Taking the lock again (a refresh from the same member) tells nobody anything new.
      return wasMine ? {} : { broadcast: { type: 'locks.snapshot', ...(await this.snapshot(roomId)) } };
    }

    if (request.type === 'locks.renew') {
      const entry = await store.renew(roomId, target, user.userId, this.ttlMs);
      if (!entry) return { reply: { type: 'locks.denied', fileId: target, reason: 'expired' } };
      const cached = this.locksCache.get(roomId);
      if (cached) cached.locks = { ...cached.locks, [target]: entry };
      return {};
    }

    // release
    const released = await store.release(roomId, target, user.userId);
    if (!released) return {};
    this.locksCache.delete(roomId);
    return { broadcast: { type: 'locks.snapshot', ...(await this.snapshot(roomId, true)) } };
  }

  /** A connection closed: its locks go at once instead of lingering until they expire. */
  async releaseConnection(roomId: string, connectionId: string): Promise<LockOutcome> {
    try {
      const freed = await this.options.store.releaseConnection(roomId, connectionId);
      if (freed.length === 0) return {};
      this.locksCache.delete(roomId);
      return { broadcast: { type: 'locks.snapshot', ...(await this.snapshot(roomId, true)) } };
    } catch (err) {
      this.options.onProblem?.(err, 'locks.releaseConnection');
      return {};
    }
  }

  /**
   * Should this update from `userId` be dropped? Returns the files it writes to that someone else
   * has locked, or null to let it through.
   */
  async rejects(roomId: string, userId: string, document: Y.Doc, update: Uint8Array): Promise<LockMessage | null> {
    try {
      if (!(await this.isEnabled(roomId))) return null;
      const locks = await this.liveLocks(roomId);
      const foreign = Object.entries(locks).filter(([, lock]) => lock.userId !== userId);
      if (foreign.length === 0) return null;

      const touched = touchedFileIds(document, update);
      const blocked = foreign.filter(([id]) => touched.fileIds.has(id));
      if (blocked.length === 0 && !touched.unresolved) return null;

      // Unattributable (see the failure policy above): name every lock that could be in the way.
      const culprits = blocked.length > 0 ? blocked : foreign;
      return {
        type: 'locks.rejected',
        fileIds: culprits.map(([id]) => id),
        holders: [...new Map(culprits.map(([, lock]) => [lock.userId, { userId: lock.userId, name: lock.name }])).values()],
      };
    } catch (err) {
      this.options.onProblem?.(err, 'locks.check');
      return null;
    }
  }
}
