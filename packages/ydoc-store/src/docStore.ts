import * as Y from 'yjs';

/**
 * Where room documents live between sessions.
 *
 * `store` receives the live Y.Doc rather than a state blob so an implementation
 * can persist only what changed since its previous write.
 */
export interface DocStore {
  /** Merged persisted state, or null for a room that has never been stored. */
  load(roomId: string): Promise<Uint8Array | null>;
  store(roomId: string, document: Y.Doc): Promise<void>;
  /** The room's document was unloaded from this process; drop per-room bookkeeping. */
  release?(roomId: string): void;
}

export interface CompactionResult {
  snapshotSeq: number;
  updatesMerged: number;
  snapshotBytes: number;
}

/**
 * Why a snapshot was taken, when it was not just compaction (P2-15). A restore takes two: the state
 * the room was in just before (`restore-point`, so the restore can be undone) and the state right
 * after it (`restore`), and both say who did it to which file.
 */
export interface SnapshotMeta {
  kind: 'restore-point' | 'restore';
  userId: string;
  userName: string;
  fileId: string;
  fileName: string;
  /** For `restore`: the snapshot whose text was put back. */
  fromSeq?: number;
}

export interface SnapshotInfo {
  seq: number;
  createdAt: Date;
  meta?: SnapshotMeta;
}

/** A room's snapshots: the versions its history is made of (P2-15). They are kept; only updates are pruned. */
export interface SnapshotHistory {
  /** Newest first, without their state. */
  listSnapshots(roomId: string, limit: number): Promise<SnapshotInfo[]>;
  loadSnapshot(roomId: string, seq: number): Promise<Uint8Array | null>;
  /** Merges everything stored so far into a snapshot. Null if nothing is new since the last one. */
  writeSnapshot(roomId: string, meta?: SnapshotMeta): Promise<CompactionResult | null>;
}

/** Test double: keeps a room across reconnects but not across a process restart. */
export class MemoryDocStore implements DocStore, SnapshotHistory {
  private readonly states = new Map<string, Uint8Array>();
  private readonly snapshots = new Map<string, Array<SnapshotInfo & { state: Uint8Array }>>();

  async load(roomId: string): Promise<Uint8Array | null> {
    return this.states.get(roomId) ?? null;
  }

  async store(roomId: string, document: Y.Doc): Promise<void> {
    this.states.set(roomId, Y.encodeStateAsUpdate(document));
  }

  async listSnapshots(roomId: string, limit: number): Promise<SnapshotInfo[]> {
    return [...(this.snapshots.get(roomId) ?? [])]
      .reverse()
      .slice(0, limit)
      .map(({ seq, createdAt, meta }) => ({ seq, createdAt, ...(meta ? { meta } : {}) }));
  }

  async loadSnapshot(roomId: string, seq: number): Promise<Uint8Array | null> {
    return this.snapshots.get(roomId)?.find((snapshot) => snapshot.seq === seq)?.state ?? null;
  }

  async writeSnapshot(roomId: string, meta?: SnapshotMeta): Promise<CompactionResult | null> {
    const state = this.states.get(roomId);
    if (!state) return null;
    const list = this.snapshots.get(roomId) ?? [];
    const last = list[list.length - 1];
    if (last && last.state.length === state.length && last.state.every((byte, i) => byte === state[i])) return null;
    const seq = (last?.seq ?? 0) + 1;
    list.push({ seq, createdAt: new Date(), state, ...(meta ? { meta } : {}) });
    this.snapshots.set(roomId, list);
    return { snapshotSeq: seq, updatesMerged: 1, snapshotBytes: state.length };
  }
}
