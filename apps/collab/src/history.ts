import type { Hocuspocus } from '@hocuspocus/server';
import { getContentText, getFileText, getFilesMap } from '@synapse/room-doc';
import type { DocStore, SnapshotHistory, SnapshotInfo } from '@synapse/ydoc-store';
import * as Y from 'yjs';
import { documentNameFor } from './auth.js';
import type { LockService } from './lockService.js';
import type { Logger } from './logger.js';

/**
 * A file's version history (P2-15), made from the room's snapshots. A snapshot is the whole room as
 * it was when compaction ran (a few minutes after editing started, or after 500 updates), so a file's
 * versions are its text in each snapshot, leaving out the ones where it did not change.
 *
 * Restoring puts an old text back as an ordinary edit, never by rewriting what is stored: the diff
 * between the live text and the old one is applied to the live document, so people connected see it
 * as they would anyone's typing and their cursors outside the changed span stay where they were.
 * Two snapshots go around it: one of the room as it was just before (so a restore can be undone
 * from the history) and one just after (so the restore itself appears there, with who did it).
 */

/** At most this many snapshots are read to build a list, newest first. */
export const MAX_SCAN = 100;
export const DEFAULT_LIMIT = 50;

export type HistoryErrorCode = 'version-not-found' | 'file-not-in-version' | 'file-deleted' | 'locked';

export class HistoryError extends Error {
  constructor(
    readonly code: HistoryErrorCode,
    message: string,
    readonly status: number,
    readonly holder?: { userId: string; name: string },
  ) {
    super(message);
    this.name = 'HistoryError';
  }
}

export interface HistoryEntry {
  seq: number;
  at: string;
  /** `auto` is ordinary compaction. */
  kind: 'auto' | 'restore-point' | 'restore';
  by?: { userId: string; name: string };
  /** For `restore`: the version whose text was put back. */
  fromSeq?: number;
  chars: number;
}

export interface HistoryVersion extends HistoryEntry {
  name: string;
  content: string;
}

export interface RestoreResult {
  /** False when the file already had that text. */
  changed: boolean;
  /** The snapshot taken after the restore, which is where it shows in the history. */
  seq?: number;
}

interface FileAt {
  exists: boolean;
  name: string;
  content: string;
}

/** What one file was in a stored room state. */
export function readFileFromState(state: Uint8Array, fileId: string): FileAt {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    const node = getFilesMap(doc).get(fileId);
    if (!node || typeof node.get('deletedAt') === 'number' || node.get('type') === 'folder') return { exists: false, name: '', content: '' };
    return { exists: true, name: String(node.get('name') ?? ''), content: getFileText(doc, fileId) };
  } finally {
    doc.destroy();
  }
}

const isHighSurrogate = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

/**
 * Makes `text` read `next` by deleting and inserting only the span that differs, so edits and cursors
 * elsewhere in the file are untouched. It is one transaction, so peers see one change, and it never
 * cuts through a surrogate pair (Yjs would turn the half into U+FFFD).
 */
export function replaceText(text: Y.Text, next: string): void {
  const prev = text.toString();
  const shortest = Math.min(prev.length, next.length);
  let start = 0;
  while (start < shortest && prev[start] === next[start]) start += 1;
  if (start > 0 && isHighSurrogate(prev.charCodeAt(start - 1))) start -= 1;
  let prevEnd = prev.length;
  let nextEnd = next.length;
  while (prevEnd > start && nextEnd > start && prev[prevEnd - 1] === next[nextEnd - 1]) {
    prevEnd -= 1;
    nextEnd -= 1;
  }
  if (prevEnd < prev.length && isLowSurrogate(prev.charCodeAt(prevEnd))) {
    prevEnd += 1;
    nextEnd += 1;
  }
  const apply = () => {
    if (prevEnd > start) text.delete(start, prevEnd - start);
    if (nextEnd > start) text.insert(start, next.slice(start, nextEnd));
  };
  if (text.doc) text.doc.transact(apply);
  else apply();
}

const entryOf = (info: SnapshotInfo, chars: number): HistoryEntry => ({
  seq: info.seq,
  at: info.createdAt.toISOString(),
  kind: info.meta?.kind ?? 'auto',
  ...(info.meta ? { by: { userId: info.meta.userId, name: info.meta.userName } } : {}),
  ...(info.meta?.fromSeq !== undefined ? { fromSeq: info.meta.fromSeq } : {}),
  chars,
});

export interface HistoryOptions {
  store: DocStore & SnapshotHistory;
  locks: Pick<LockService, 'heldByOther'>;
  logger: Logger;
  /** With Redis: after opening a room that is not loaded here, how long other replicas get to answer its sync. */
  syncWaitMs?: number;
  /** Whether other replicas share rooms with this one (Redis). */
  syncs?: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createHistoryService(options: HistoryOptions) {
  const { store, locks, logger, syncWaitMs = 150, syncs = false } = options;

  async function versionOf(roomId: string, seq: number, fileId: string): Promise<{ state: Uint8Array; file: FileAt }> {
    const state = await store.loadSnapshot(roomId, seq);
    if (!state) throw new HistoryError('version-not-found', 'That version does not exist.', 404);
    const file = readFileFromState(state, fileId);
    if (!file.exists) throw new HistoryError('file-not-in-version', 'The file did not exist in that version.', 404);
    return { state, file };
  }

  return {
    /**
     * The versions of one file, newest first: those where its text differs from the version before,
     * and the ones a restore made (they say who did what, even if nothing else changed).
     */
    async list(roomId: string, fileId: string, limit = DEFAULT_LIMIT): Promise<HistoryEntry[]> {
      const infos = await store.listSnapshots(roomId, MAX_SCAN);
      const reads: Array<{ info: SnapshotInfo; file: FileAt }> = [];
      for (const info of infos) {
        const state = await store.loadSnapshot(roomId, info.seq);
        if (state) reads.push({ info, file: readFileFromState(state, fileId) });
      }
      const entries: HistoryEntry[] = [];
      reads.forEach(({ info, file }, i) => {
        if (!file.exists) return;
        const older = reads[i + 1]?.file;
        const changed = !older || !older.exists || older.content !== file.content;
        if (changed || info.meta) entries.push(entryOf(info, file.content.length));
      });
      return entries.slice(0, Math.max(1, Math.min(limit, MAX_SCAN)));
    },

    async preview(roomId: string, seq: number, fileId: string): Promise<HistoryVersion> {
      // Versions are the ones a list shows, so a snapshot beyond the scan window is not one.
      const info = (await store.listSnapshots(roomId, MAX_SCAN)).find((candidate) => candidate.seq === seq);
      if (!info) throw new HistoryError('version-not-found', 'That version does not exist.', 404);
      const { file } = await versionOf(roomId, seq, fileId);
      return { ...entryOf(info, file.content.length), name: file.name, content: file.content };
    },

    async restore(
      instance: Hocuspocus,
      roomId: string,
      seq: number,
      fileId: string,
      user: { userId: string; name: string },
    ): Promise<RestoreResult> {
      const { file: target } = await versionOf(roomId, seq, fileId);

      const name = documentNameFor(roomId);
      const wasLoaded = instance.documents.has(name);
      const connection = await instance.openDirectConnection(name, { history: true });
      try {
        // Loading asked the other replicas for their state; give them a moment to answer.
        if (!wasLoaded && syncs) await sleep(syncWaitMs);
        const doc = connection.document!;

        const node = getFilesMap(doc).get(fileId);
        if (!node || typeof node.get('deletedAt') === 'number') {
          throw new HistoryError('file-deleted', 'The file has been deleted, so it cannot be restored.', 409);
        }
        const holder = await locks.heldByOther(roomId, fileId, user.userId);
        if (holder) throw new HistoryError('locked', `${holder.name} has this file locked.`, 409, holder);

        const text = getContentText(doc, fileId);
        if (text.toString() === target.content) return { changed: false };

        const meta = { userId: user.userId, userName: user.name, fileId, fileName: target.name };
        // The room as it is now, so this restore can itself be undone.
        await store.store(roomId, doc);
        await store.writeSnapshot(roomId, { kind: 'restore-point', ...meta });

        await connection.transact((d) => replaceText(getContentText(d, fileId), target.content));

        await store.store(roomId, doc);
        const after = await store.writeSnapshot(roomId, { kind: 'restore', ...meta, fromSeq: seq });
        logger.info({ event: 'collab.history.restore', roomId, userId: user.userId, fileId, fromSeq: seq, seq: after?.snapshotSeq }, 'file restored');
        return { changed: true, ...(after ? { seq: after.snapshotSeq } : {}) };
      } finally {
        await connection.disconnect();
      }
    },
  };
}

export type HistoryService = ReturnType<typeof createHistoryService>;
