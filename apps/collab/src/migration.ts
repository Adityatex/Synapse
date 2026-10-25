import { buildSeedUpdate, getFileText, listNodes } from '@synapse/room-doc';
import type { MongoDocStore } from '@synapse/ydoc-store';
import type { Db } from 'mongodb';
import * as Y from 'yjs';
import { createMongoLegacyRooms } from './legacyRooms.js';

/**
 * Moving rooms between the classic editor and collab (P2-10). Opening a room in a collab client
 * migrates it by itself (see onLoadDocument); these are for doing it on purpose, in bulk, and for
 * undoing it. `Room.collabVersion`: absent = never migrated, 2 = lives in collab, 1 = pinned to the
 * classic editor.
 */

export interface MigrationDeps {
  db: Db;
  store: MongoDocStore;
}

export type MigrateOutcome =
  /** A document was built from Room.files and the room is now in collab. */
  | 'migrated'
  /** The room already had a document (someone opened it in collab); it is now marked. */
  | 'adopted'
  | 'already'
  /** Pinned to the classic editor, so left alone. */
  | 'pinned'
  | 'not-found';

interface RoomRecord {
  roomId: string;
  collabVersion?: number | null;
  files?: unknown[];
}

const rooms = (db: Db) => db.collection<RoomRecord>('rooms');

export async function migrateRoom({ db, store }: MigrationDeps, roomId: string, { dryRun = false } = {}): Promise<MigrateOutcome> {
  const room = await rooms(db).findOne({ roomId }, { projection: { collabVersion: 1 } });
  if (!room) return 'not-found';
  if (room.collabVersion === 2) return 'already';
  if (room.collabVersion === 1) return 'pinned';

  const hasDocument = (await store.load(roomId)) !== null;
  if (dryRun) return hasDocument ? 'adopted' : 'migrated';

  if (!hasDocument) {
    const files = await createMongoLegacyRooms(db).loadFiles(roomId);
    if (files.length > 0) {
      // The seed is deterministic (fixed Yjs client id), so doing this while a collab replica seeds
      // the same room merges into one copy rather than two.
      const doc = new Y.Doc();
      Y.applyUpdate(doc, buildSeedUpdate(files));
      await store.store(roomId, doc);
    }
  }
  await rooms(db).updateOne({ roomId, collabVersion: { $nin: [1, 2] } }, { $set: { collabVersion: 2 } });
  return hasDocument ? 'adopted' : 'migrated';
}

export interface BulkReport {
  counts: Record<MigrateOutcome | 'failed', number>;
  failures: Array<{ roomId: string; error: string }>;
}

/** Every room that has not been migrated or pinned. Safe to run again: it only touches what is left. */
export async function migrateAll(deps: MigrationDeps, { dryRun = false, onRoom }: { dryRun?: boolean; onRoom?: (roomId: string, outcome: MigrateOutcome | 'failed') => void } = {}): Promise<BulkReport> {
  const report: BulkReport = { counts: { migrated: 0, adopted: 0, already: 0, pinned: 0, 'not-found': 0, failed: 0 }, failures: [] };
  const cursor = rooms(deps.db).find({ collabVersion: { $nin: [1, 2] } }, { projection: { roomId: 1 } });
  for await (const { roomId } of cursor) {
    try {
      const outcome = await migrateRoom(deps, roomId, { dryRun });
      report.counts[outcome]++;
      onRoom?.(roomId, outcome);
    } catch (err) {
      report.counts.failed++;
      report.failures.push({ roomId, error: err instanceof Error ? err.message : String(err) });
      onRoom?.(roomId, 'failed');
    }
  }
  return report;
}

/** Lifts a pin: the room goes back to "never migrated", so the next collab client to open it migrates it again. */
export async function unpinRoom({ db }: Pick<MigrationDeps, 'db'>, roomId: string): Promise<boolean> {
  const result = await rooms(db).updateOne({ roomId, collabVersion: 1 }, { $unset: { collabVersion: '' } });
  return result.modifiedCount === 1;
}

export interface RollbackResult {
  /** Files written back to Room.files (folders included). */
  exported: number;
  /** What was deleted from the document store. */
  purged: { updates: number; snapshots: number };
}

/** A room edited this recently is probably open somewhere, and an open room would write itself back. */
const RECENT_EDIT_MS = 2 * 60_000;

/**
 * Takes a room back to the classic editor: its current text goes back into Room.files, the room is
 * pinned (`collabVersion: 1`, so collab refuses it), and its stored document is deleted so that a
 * later migration starts again from the re-exported text instead of from a stale document.
 * Nobody should have the room open.
 */
export async function rollbackRoom({ db, store }: MigrationDeps, roomId: string, { force = false, now = Date.now() } = {}): Promise<RollbackResult> {
  const room = await rooms(db).findOne({ roomId }, { projection: { collabVersion: 1 } });
  if (!room) throw new Error(`No such room: ${roomId}`);

  const last = await store.lastActivityAt(roomId);
  if (!force && last && now - last.getTime() < RECENT_EDIT_MS) {
    throw new Error(`Room ${roomId} was edited ${Math.round((now - last.getTime()) / 1000)} s ago and may be open. Close it, or pass --force.`);
  }

  const state = await store.load(roomId);
  let files: Array<Record<string, unknown>> | null = null;
  if (state) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    files = listNodes(doc).map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      parentId: node.parentId,
      order: node.order,
      isOpen: false,
      content: node.type === 'file' ? getFileText(doc, node.id) : '',
      updatedAt: new Date(node.updatedAt || Date.now()),
    }));
  }

  // Pin first: collab refuses new connections to the room before its document goes.
  await rooms(db).updateOne(
    { roomId },
    { $set: { collabVersion: 1, ...(files ? { files, lastUpdated: new Date(now) } : {}) } } as never,
  );
  const purged = state ? await store.purge(roomId) : { updates: 0, snapshots: 0 };
  return { exported: files?.length ?? 0, purged };
}
