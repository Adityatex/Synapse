import * as Y from 'yjs';

/**
 * Room document layout (one Y.Doc per room):
 *
 *   files            Y.Map<fileId, Y.Map>   one entry per file or folder
 *   content:<fileId> Y.Text                 the text of each file
 *
 * Tabs, the active file and folder open/closed state are per-user UI state and
 * deliberately NOT stored here.
 *
 * A node never leaves `files`: deleting sets `deletedAt` (a tombstone). A peer
 * editing a file while someone deletes it therefore never targets a missing
 * entry, and the text stays recoverable.
 */

export type NodeType = 'file' | 'folder';

export interface FileNode {
  id: string;
  name: string;
  type: NodeType;
  /** Effective parent: already resolved for orphans and cycles (see listNodes). */
  parentId: string | null;
  order: number;
  updatedAt: number;
}

export const FILES_KEY = 'files';
export const contentKey = (fileId: string): string => `content:${fileId}`;

export function getFilesMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(FILES_KEY);
}

export function getContentText(doc: Y.Doc, fileId: string): Y.Text {
  return doc.getText(contentKey(fileId));
}

/** Raw node fields as stored, before the tree is resolved. */
export interface RawNode {
  id: string;
  name: string;
  type: NodeType;
  parentId: string | null;
  order: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export function readRawNode(id: string, map: Y.Map<unknown>): RawNode {
  const type = map.get('type') === 'folder' ? 'folder' : 'file';
  const parentId = map.get('parentId');
  const order = map.get('order');
  const deletedAt = map.get('deletedAt');
  return {
    id,
    name: String(map.get('name') ?? ''),
    type,
    parentId: typeof parentId === 'string' && parentId ? parentId : null,
    order: typeof order === 'number' ? order : 0,
    createdAt: Number(map.get('createdAt') ?? 0),
    updatedAt: Number(map.get('updatedAt') ?? 0),
    deletedAt: typeof deletedAt === 'number' ? deletedAt : null,
  };
}
