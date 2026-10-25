import * as Y from 'yjs';
import { createNode } from './ops.js';
import type { NodeType } from './schema.js';

/** A file as the legacy relay stored it in `Room.files`. */
export interface LegacyFile {
  id: string;
  name: string;
  type?: NodeType;
  parentId?: string | null;
  order?: number;
  content?: string;
  updatedAt?: number | Date | null;
}

/**
 * Reserved Yjs client id for seeding. Seeding from the same legacy files always
 * produces byte-identical updates under this id, and Yjs de-duplicates updates
 * by (client, clock). So two collab replicas that both see a room with no
 * stored document, and both seed it, merge into ONE copy instead of doubling
 * every file's text.
 */
export const SEED_CLIENT_ID = 1_935_000_001;

const toMillis = (value: LegacyFile['updatedAt']): number => {
  if (value instanceof Date) return value.getTime();
  return typeof value === 'number' ? value : 0;
};

export function buildSeedUpdate(files: LegacyFile[]): Uint8Array {
  const doc = new Y.Doc();
  doc.clientID = SEED_CLIENT_ID;

  // Parents before children, otherwise by the legacy order. Sorting by id
  // last keeps the result independent of the order Mongo returned the files in.
  const depth = (file: LegacyFile, seen = new Set<string>()): number => {
    const parent = files.find((f) => f.id === file.parentId);
    if (!parent || seen.has(parent.id)) return 0;
    seen.add(parent.id);
    return 1 + depth(parent, seen);
  };
  const ordered = [...files].sort(
    (a, b) => depth(a) - depth(b) || (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const known = new Set<string>();
  for (const file of ordered) {
    if (known.has(file.id)) continue; // legacy data should not repeat ids, but never throw on it
    const parentId = file.parentId && known.has(file.parentId) ? file.parentId : null;
    createNode(doc, {
      id: file.id,
      name: file.name,
      type: file.type === 'folder' ? 'folder' : 'file',
      parentId,
      order: file.order ?? 0,
      content: file.content ?? '',
      now: toMillis(file.updatedAt),
    });
    known.add(file.id);
  }
  return Y.encodeStateAsUpdate(doc);
}
