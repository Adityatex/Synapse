import type * as Y from 'yjs';
import { getFileText } from './ops.js';
import { listNodes } from './tree.js';

/**
 * The room as plain text (P2-09): what to run, what to give the AI as context, what to export.
 * It is derived from the document and never stored, so it cannot drift from what people see.
 */
export interface ProjectedFile {
  id: string;
  name: string;
  /** Slash-separated, from the room root: `lib/util.py`. */
  path: string;
  content: string;
}

export interface RoomProjection {
  /** Every visible file in tree order. Folders appear only in the paths. */
  files: ProjectedFile[];
  /** All files as one text, each under a `--- path ---` line, for use as AI context. */
  content: string;
}

export function projectRoom(doc: Y.Doc): RoomProjection {
  const nodes = listNodes(doc);
  const byId = new Map(nodes.map((node) => [node.id, node]));

  const pathOf = (id: string): string => {
    const segments: string[] = [];
    // `parentId` is already resolved (no cycles, no missing parents); the bound is belt and braces.
    for (let node = byId.get(id), hops = 0; node && hops <= nodes.length; node = node.parentId ? byId.get(node.parentId) : undefined, hops++) {
      segments.unshift(node.name);
    }
    return segments.join('/');
  };

  const files = nodes
    .filter((node) => node.type === 'file')
    .map((node) => ({ id: node.id, name: node.name, path: pathOf(node.id), content: getFileText(doc, node.id) }));

  return { files, content: files.map((file) => `--- ${file.path} ---\n${file.content}`).join('\n\n') };
}
