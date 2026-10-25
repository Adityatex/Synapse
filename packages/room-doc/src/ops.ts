import * as Y from 'yjs';
import { getContentText, getFilesMap, type FileNode, type NodeType } from './schema.js';
import { listNodes } from './tree.js';

export interface NewNode {
  id: string;
  name: string;
  type: NodeType;
  parentId?: string | null;
  /** Position among siblings; defaults to the end. */
  order?: number;
  /** Initial text for a file. */
  content?: string;
  /** Overrides the clock so seeding can be deterministic. */
  now?: number;
}

export class RoomDocError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoomDocError';
  }
}

const childrenOf = (nodes: FileNode[], parentId: string | null): FileNode[] =>
  nodes.filter((n) => n.parentId === parentId);

function requireLive(doc: Y.Doc, id: string): FileNode {
  const node = listNodes(doc).find((n) => n.id === id);
  if (!node) throw new RoomDocError(`No such file or folder: ${id}`);
  return node;
}

function requireFolderOrRoot(nodes: FileNode[], parentId: string | null): void {
  if (parentId === null) return;
  const parent = nodes.find((n) => n.id === parentId);
  if (!parent || parent.type !== 'folder') throw new RoomDocError(`Not a folder: ${parentId}`);
}

export function createNode(doc: Y.Doc, node: NewNode, origin?: unknown): void {
  const files = getFilesMap(doc);
  if (files.has(node.id)) throw new RoomDocError(`Already exists: ${node.id}`);
  const parentId = node.parentId ?? null;
  const live = listNodes(doc);
  requireFolderOrRoot(live, parentId);

  const now = node.now ?? Date.now();
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set('name', node.name);
    map.set('type', node.type);
    map.set('parentId', parentId);
    map.set('order', node.order ?? childrenOf(live, parentId).length);
    map.set('createdAt', now);
    map.set('updatedAt', now);
    map.set('deletedAt', null);
    files.set(node.id, map);
    if (node.type === 'file' && node.content) getContentText(doc, node.id).insert(0, node.content);
  }, origin);
}

export function renameNode(doc: Y.Doc, id: string, name: string, origin?: unknown): void {
  requireLive(doc, id);
  doc.transact(() => {
    const map = getFilesMap(doc).get(id)!;
    map.set('name', name);
    map.set('updatedAt', Date.now());
  }, origin);
}

/**
 * Moves a node under `newParentId` (null = root) at `newIndex` among its new
 * siblings, renumbering only the siblings whose position actually changes.
 * Refuses to move a folder into itself or its own descendants.
 */
export function moveNode(doc: Y.Doc, id: string, newParentId: string | null, newIndex: number, origin?: unknown): void {
  const nodes = listNodes(doc);
  const node = nodes.find((n) => n.id === id);
  if (!node) throw new RoomDocError(`No such file or folder: ${id}`);
  requireFolderOrRoot(nodes, newParentId);

  for (let ancestor = newParentId; ancestor; ) {
    if (ancestor === id) throw new RoomDocError('Cannot move a folder into itself');
    ancestor = nodes.find((n) => n.id === ancestor)?.parentId ?? null;
  }

  const siblings = childrenOf(nodes, newParentId).filter((n) => n.id !== id);
  siblings.splice(Math.max(0, Math.min(newIndex, siblings.length)), 0, node);

  const files = getFilesMap(doc);
  doc.transact(() => {
    const moved = files.get(id)!;
    if (moved.get('parentId') !== newParentId) moved.set('parentId', newParentId);
    moved.set('updatedAt', Date.now());
    siblings.forEach((sibling, index) => {
      const map = files.get(sibling.id)!;
      if (map.get('order') !== index) map.set('order', index);
    });
  }, origin);
}

/** Tombstones the node and everything below it. The text is kept. */
export function deleteNode(doc: Y.Doc, id: string, origin?: unknown): void {
  const nodes = listNodes(doc);
  if (!nodes.some((n) => n.id === id)) throw new RoomDocError(`No such file or folder: ${id}`);

  const doomed: string[] = [];
  const collect = (nodeId: string) => {
    doomed.push(nodeId);
    childrenOf(nodes, nodeId).forEach((child) => collect(child.id));
  };
  collect(id);

  const files = getFilesMap(doc);
  const now = Date.now();
  doc.transact(() => {
    for (const nodeId of doomed) {
      const map = files.get(nodeId)!;
      map.set('deletedAt', now);
      map.set('updatedAt', now);
    }
  }, origin);
}

export function getFileText(doc: Y.Doc, id: string): string {
  return getContentText(doc, id).toString();
}
