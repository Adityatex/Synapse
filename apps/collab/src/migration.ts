import { buildSeedUpdate } from '@synapse/room-doc';
import type { MongoDocStore } from '@synapse/ydoc-store';
import type { Db } from 'mongodb';
import * as Y from 'yjs';
import { createMongoLegacyRooms } from './legacyRooms.js';

/**
 * Moving rooms that were made before collab into it (P2-10). Opening a room in a collab client
 * migrates it by itself (see onLoadDocument); this is for doing it on purpose and in bulk.
 * `Room.collabVersion`: 2 = lives in collab; anything else (absent, or the 1 that a rollback used to
 * leave) = not migrated yet. There is no way back: the classic editor is gone (P2-14).
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
  await rooms(db).updateOne({ roomId, collabVersion: { $ne: 2 } }, { $set: { collabVersion: 2 } });
  return hasDocument ? 'adopted' : 'migrated';
}

export interface BulkReport {
  counts: Record<MigrateOutcome | 'failed', number>;
  failures: Array<{ roomId: string; error: string }>;
}

/** Every room that has not been migrated. Safe to run again: it only touches what is left. */
export async function migrateAll(deps: MigrationDeps, { dryRun = false, onRoom }: { dryRun?: boolean; onRoom?: (roomId: string, outcome: MigrateOutcome | 'failed') => void } = {}): Promise<BulkReport> {
  const report: BulkReport = { counts: { migrated: 0, adopted: 0, already: 0, 'not-found': 0, failed: 0 }, failures: [] };
  const cursor = rooms(deps.db).find({ collabVersion: { $ne: 2 } }, { projection: { roomId: 1 } });
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
