import { Binary, type Collection, type Db } from 'mongodb';
import * as Y from 'yjs';
import type { DocStore } from './docStore.js';

/**
 * MongoDB persistence for room documents (P2-04).
 *
 *   ydoc_updates   { roomId, seq, update, createdAt }   append-only Yjs diffs
 *   ydoc_snapshots { roomId, seq, state,  createdAt }   merged state through `seq`
 *
 * Invariants everything below relies on:
 *  - Per room, committed update seqs are contiguous. A writer inserts
 *    (highest seq it can see) + 1 and the unique index rejects a collision, in
 *    which case it re-reads and retries. So a late writer can never land at or
 *    below a seq a snapshot already claims to cover.
 *  - A snapshot at seq N contains every update with seq <= N.
 *  - Yjs updates are idempotent and commutative, so storing the same change
 *    twice (two replicas, or a retry) is harmless.
 *
 * Load = newest snapshot + the updates after it. Compaction (snapshot, then
 * prune covered updates) is scheduled by the worker in P2-05.
 */

interface UpdateDoc {
  roomId: string;
  seq: number;
  update: Binary;
  createdAt: Date;
}

interface SnapshotDoc {
  roomId: string;
  seq: number;
  state: Binary;
  createdAt: Date;
}

// Each collision means another writer got that seq, so attempts needed <= concurrent writers.
const MAX_APPEND_ATTEMPTS = 50;
const MAX_LOAD_ATTEMPTS = 3;

const bytes = (b: Binary): Uint8Array => new Uint8Array(b.buffer);

// An update that adds nothing encodes as two zero bytes (no structs, empty delete set).
const isEmptyUpdate = (u: Uint8Array): boolean => u.length === 2 && u[0] === 0 && u[1] === 0;

const isDuplicateKey = (err: unknown): boolean => typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;

export interface CompactionResult {
  snapshotSeq: number;
  updatesMerged: number;
  snapshotBytes: number;
}

export interface AppendInfo {
  seq: number;
  /** Updates written since the newest snapshot, including this one (the length of the tail a load must merge). */
  updatesSinceSnapshot: number;
}

export interface MongoDocStoreOptions {
  /** Called after each update is appended; the collab server uses it to schedule compaction. */
  onAppend?: (roomId: string, info: AppendInfo) => void;
}

export class MongoDocStore implements DocStore {
  private readonly updates: Collection<UpdateDoc>;
  private readonly snapshots: Collection<SnapshotDoc>;
  /** State vector this process last persisted (or loaded) per room, so writes are diffs. */
  private readonly persisted = new Map<string, Uint8Array>();

  private readonly onAppend?: MongoDocStoreOptions['onAppend'];

  constructor(db: Db, options: MongoDocStoreOptions = {}) {
    this.onAppend = options.onAppend;
    this.updates = db.collection<UpdateDoc>('ydoc_updates');
    this.snapshots = db.collection<SnapshotDoc>('ydoc_snapshots');
  }

  async ensureIndexes(): Promise<void> {
    await this.updates.createIndex({ roomId: 1, seq: 1 }, { unique: true });
    await this.snapshots.createIndex({ roomId: 1, seq: -1 }, { unique: true });
  }

  async load(roomId: string): Promise<Uint8Array | null> {
    for (let attempt = 0; attempt < MAX_LOAD_ATTEMPTS; attempt++) {
      const snapshot = await this.snapshots.find({ roomId }).sort({ seq: -1 }).limit(1).next();
      const base = snapshot?.seq ?? 0;
      const tail = await this.updates
        .find({ roomId, seq: { $gt: base } })
        .sort({ seq: 1 })
        .toArray();

      // A compaction may have pruned the tail between the two reads above; the
      // seqs would no longer line up with the snapshot we hold, so read again.
      if (!isContiguousFrom(base, tail)) continue;

      if (!snapshot && tail.length === 0) {
        this.persisted.delete(roomId);
        return null;
      }
      const parts = [...(snapshot ? [bytes(snapshot.state)] : []), ...tail.map((u) => bytes(u.update))];
      const merged = parts.length === 1 ? parts[0] : Y.mergeUpdates(parts);
      this.persisted.set(roomId, Y.encodeStateVectorFromUpdate(merged));
      return merged;
    }
    throw new Error(`Could not read a consistent state for room ${roomId}`);
  }

  async store(roomId: string, document: Y.Doc): Promise<void> {
    const previous = this.persisted.get(roomId);
    // Both are taken synchronously so edits that land during the write are
    // still picked up by the next diff.
    const update = previous ? Y.encodeStateAsUpdate(document, previous) : Y.encodeStateAsUpdate(document);
    const stateVector = Y.encodeStateVector(document);

    if (!isEmptyUpdate(update)) await this.append(roomId, update);
    this.persisted.set(roomId, stateVector);
  }

  release(roomId: string): void {
    this.persisted.delete(roomId);
  }

  /** Merges the newest snapshot and the updates after it into a new snapshot. Null if nothing is new. */
  async writeSnapshot(roomId: string): Promise<CompactionResult | null> {
    const snapshot = await this.snapshots.find({ roomId }).sort({ seq: -1 }).limit(1).next();
    const base = snapshot?.seq ?? 0;
    const tail = await this.updates
      .find({ roomId, seq: { $gt: base } })
      .sort({ seq: 1 })
      .toArray();
    if (tail.length === 0) return null;
    if (!isContiguousFrom(base, tail)) throw new Error(`Update sequence for room ${roomId} is not contiguous`);

    const through = tail[tail.length - 1].seq;
    const state = Y.mergeUpdates([...(snapshot ? [bytes(snapshot.state)] : []), ...tail.map((u) => bytes(u.update))]);
    try {
      await this.snapshots.insertOne({ roomId, seq: through, state: new Binary(state), createdAt: new Date() });
    } catch (err) {
      if (isDuplicateKey(err)) return null; // another worker snapshotted the same point
      throw err;
    }
    return { snapshotSeq: through, updatesMerged: tail.length, snapshotBytes: state.length };
  }

  /** Deletes updates already covered by the newest snapshot. Snapshots are kept (version history, P2-15). */
  async pruneCoveredUpdates(roomId: string): Promise<number> {
    const snapshot = await this.snapshots.find({ roomId }).sort({ seq: -1 }).limit(1).next();
    if (!snapshot) return 0;
    const { deletedCount } = await this.updates.deleteMany({ roomId, seq: { $lte: snapshot.seq } });
    return deletedCount;
  }

  private async append(roomId: string, update: Uint8Array): Promise<void> {
    for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt++) {
      const { seq, snapshotSeq } = await this.nextSeq(roomId);
      try {
        await this.updates.insertOne({ roomId, seq, update: new Binary(update), createdAt: new Date() });
        this.notifyAppend(roomId, { seq, updatesSinceSnapshot: seq - snapshotSeq });
        return;
      } catch (err) {
        if (!isDuplicateKey(err)) throw err; // lost the race for this seq; re-read and retry
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
      }
    }
    throw new Error(`Could not append an update for room ${roomId} after ${MAX_APPEND_ATTEMPTS} attempts`);
  }

  /**
   * Updates are read before snapshots on purpose: if a compaction prunes the
   * updates in between, the snapshot read afterwards is guaranteed to be at
   * least as new, so the next seq can never fall inside a covered range.
   */
  private async nextSeq(roomId: string): Promise<{ seq: number; snapshotSeq: number }> {
    const lastUpdate = await this.updates.find({ roomId }).sort({ seq: -1 }).limit(1).next();
    const lastSnapshot = await this.snapshots.find({ roomId }).sort({ seq: -1 }).limit(1).next();
    const snapshotSeq = lastSnapshot?.seq ?? 0;
    return { seq: Math.max(lastUpdate?.seq ?? 0, snapshotSeq) + 1, snapshotSeq };
  }

  /** A failing hook must never fail the write it is observing. */
  private notifyAppend(roomId: string, info: AppendInfo): void {
    try {
      this.onAppend?.(roomId, info);
    } catch {
      // scheduling is best effort; the next append reschedules
    }
  }
}

function isContiguousFrom(base: number, updates: UpdateDoc[]): boolean {
  return updates.every((u, i) => u.seq === base + 1 + i);
}
