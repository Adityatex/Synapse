import * as Y from 'yjs';
import { getFilesMap, readRawNode, type FileNode, type RawNode } from './schema.js';

/**
 * Resolves the stored nodes into the tree users see. Concurrent edits can leave
 * the raw data in states no single user produced, so this has to be a pure
 * function of the document: every client computes the same result.
 *
 *  - deleted nodes, and everything below a deleted folder, are hidden;
 *  - a parent that is missing, deleted-then-gone, or not a folder makes the node
 *    root-level instead of losing it;
 *  - if two users concurrently move folders into each other, the parent links
 *    form a cycle. The member with the smallest id is lifted to the root so
 *    nothing disappears and the rest of the structure is kept.
 */
export function resolveTree(rawNodes: RawNode[]): FileNode[] {
  const byId = new Map(rawNodes.map((n) => [n.id, n]));

  const parentOf = (n: RawNode): string | null => {
    if (!n.parentId) return null;
    const parent = byId.get(n.parentId);
    return parent && parent.type === 'folder' ? parent.id : null;
  };

  // Break cycles. Each node has at most one parent, so walking up either
  // reaches a root or revisits a node on the current path.
  const liftedToRoot = new Set<string>();
  const state = new Map<string, 'visiting' | 'done'>();
  for (const start of rawNodes) {
    if (state.has(start.id)) continue;
    const path: string[] = [];
    let current: RawNode | undefined = start;
    while (current && !state.has(current.id)) {
      state.set(current.id, 'visiting');
      path.push(current.id);
      const parentId = parentOf(current);
      current = parentId ? byId.get(parentId) : undefined;
    }
    if (current && state.get(current.id) === 'visiting') {
      const cycle = path.slice(path.indexOf(current.id));
      liftedToRoot.add(cycle.reduce((min, id) => (id < min ? id : min)));
    }
    for (const id of path) state.set(id, 'done');
  }

  const effectiveParent = (n: RawNode): string | null => (liftedToRoot.has(n.id) ? null : parentOf(n));

  const hidden = new Map<string, boolean>();
  const isHidden = (n: RawNode): boolean => {
    const cached = hidden.get(n.id);
    if (cached !== undefined) return cached;
    hidden.set(n.id, false); // guards against re-entry; cycles were already broken above
    let result = n.deletedAt !== null;
    if (!result) {
      const parentId = effectiveParent(n);
      const parent = parentId ? byId.get(parentId) : undefined;
      result = parent ? isHidden(parent) : false;
    }
    hidden.set(n.id, result);
    return result;
  };

  return rawNodes
    .filter((n) => !isHidden(n))
    .map<FileNode>((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      parentId: effectiveParent(n),
      order: n.order,
      updatedAt: n.updatedAt,
    }))
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function readRawNodes(doc: Y.Doc): RawNode[] {
  const nodes: RawNode[] = [];
  getFilesMap(doc).forEach((map, id) => nodes.push(readRawNode(id, map)));
  return nodes;
}

/** The files and folders a user sees, in a stable order (siblings by `order`, then id). */
export function listNodes(doc: Y.Doc): FileNode[] {
  return resolveTree(readRawNodes(doc));
}
