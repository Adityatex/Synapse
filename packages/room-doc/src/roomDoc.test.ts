import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  buildSeedUpdate,
  createNode,
  deleteNode,
  getContentText,
  getFileText,
  listNodes,
  moveNode,
  renameNode,
  RoomDocError,
  type FileNode,
} from './index.js';

const names = (doc: Y.Doc) => listNodes(doc).map((n) => n.name);
/** Depth-first rendering of the visible tree, so expectations read like a file explorer. */
function tree(doc: Y.Doc): string[] {
  const nodes = listNodes(doc);
  const lines: string[] = [];
  const walk = (parentId: string | null) => {
    for (const n of nodes.filter((x) => x.parentId === parentId)) {
      lines.push(`${parentId ?? '/'}>${n.id}:${n.name}@${n.order}`);
      if (n.type === 'folder') walk(n.id);
    }
  };
  walk(null);
  return lines;
}

/** Exchanges every update between the docs until they agree (full sync in both directions). */
function sync(...docs: Y.Doc[]): void {
  for (let round = 0; round < 2; round++) {
    for (const from of docs) {
      for (const to of docs) {
        if (from !== to) Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
      }
    }
  }
}

/** Two replicas that start from the same state but then edit while disconnected. */
function twoPeers(setup?: (doc: Y.Doc) => void): [Y.Doc, Y.Doc] {
  const a = new Y.Doc();
  setup?.(a);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  return [a, b];
}

describe('operations on one document', () => {
  it('creates, lists, renames and deletes files and folders', () => {
    const doc = new Y.Doc();
    createNode(doc, { id: 'src', name: 'src', type: 'folder' });
    createNode(doc, { id: 'main', name: 'main.py', type: 'file', parentId: 'src', content: 'print(1)' });
    expect(tree(doc)).toEqual(['/>src:src@0', 'src>main:main.py@0']);
    expect(getFileText(doc, 'main')).toBe('print(1)');

    renameNode(doc, 'main', 'app.py');
    expect(names(doc)).toContain('app.py');

    deleteNode(doc, 'src');
    expect(listNodes(doc)).toEqual([]);
  });

  it('keeps file text outside the tree and keeps it after a delete', () => {
    const doc = new Y.Doc();
    createNode(doc, { id: 'f', name: 'f.py', type: 'file', content: 'keep me' });
    deleteNode(doc, 'f');
    expect(getContentText(doc, 'f').toString()).toBe('keep me');
  });

  it('puts new nodes at the end and renumbers only what moved', () => {
    const doc = new Y.Doc();
    for (const id of ['a', 'b', 'c']) createNode(doc, { id, name: id, type: 'file' });
    moveNode(doc, 'c', null, 0);
    expect(listNodes(doc).map((n) => n.id)).toEqual(['c', 'a', 'b']);
    expect(listNodes(doc).map((n) => n.order)).toEqual([0, 1, 2]);
  });

  it('moves into a folder and back out', () => {
    const doc = new Y.Doc();
    createNode(doc, { id: 'dir', name: 'dir', type: 'folder' });
    createNode(doc, { id: 'f', name: 'f', type: 'file' });
    moveNode(doc, 'f', 'dir', 0);
    expect(tree(doc)).toContain('dir>f:f@0');
    moveNode(doc, 'f', null, 5);
    expect(listNodes(doc).find((n) => n.id === 'f')!.parentId).toBeNull();
  });

  it('refuses invalid operations instead of corrupting the tree', () => {
    const doc = new Y.Doc();
    createNode(doc, { id: 'outer', name: 'outer', type: 'folder' });
    createNode(doc, { id: 'inner', name: 'inner', type: 'folder', parentId: 'outer' });
    createNode(doc, { id: 'file', name: 'file', type: 'file' });

    expect(() => moveNode(doc, 'outer', 'inner', 0)).toThrow(RoomDocError); // into its own descendant
    expect(() => moveNode(doc, 'outer', 'outer', 0)).toThrow(RoomDocError); // into itself
    expect(() => moveNode(doc, 'inner', 'file', 0)).toThrow(RoomDocError); // a file is not a folder
    expect(() => createNode(doc, { id: 'file', name: 'dup', type: 'file' })).toThrow(RoomDocError);
    expect(() => renameNode(doc, 'ghost', 'x')).toThrow(RoomDocError);
    expect(() => deleteNode(doc, 'ghost')).toThrow(RoomDocError);
  });

  it('hides everything below a deleted folder', () => {
    const doc = new Y.Doc();
    createNode(doc, { id: 'dir', name: 'dir', type: 'folder' });
    createNode(doc, { id: 'sub', name: 'sub', type: 'folder', parentId: 'dir' });
    createNode(doc, { id: 'f', name: 'f', type: 'file', parentId: 'sub' });
    createNode(doc, { id: 'keep', name: 'keep', type: 'file' });
    deleteNode(doc, 'dir');
    expect(listNodes(doc).map((n) => n.id)).toEqual(['keep']);
  });
});

describe('two users editing the tree at the same time', () => {
  it('keeps every file when both create files concurrently', () => {
    const [a, b] = twoPeers();
    createNode(a, { id: 'a1', name: 'test1.py', type: 'file', content: 'one' });
    createNode(b, { id: 'b1', name: 'test2.py', type: 'file', content: 'two' });
    createNode(b, { id: 'b2', name: 'test3.py', type: 'file' });
    sync(a, b);

    expect(names(a).sort()).toEqual(['test1.py', 'test2.py', 'test3.py']);
    expect(tree(a)).toEqual(tree(b));
    expect(getFileText(b, 'a1')).toBe('one');
    expect(getFileText(a, 'b1')).toBe('two');
  });

  it('converges on one name when both rename the same file', () => {
    const [a, b] = twoPeers((d) => createNode(d, { id: 'f', name: 'old.py', type: 'file' }));
    renameNode(a, 'f', 'alice.py');
    renameNode(b, 'f', 'bob.py');
    sync(a, b);
    expect(names(a)).toHaveLength(1);
    expect(names(a)).toEqual(names(b));
  });

  it('lets a delete win over a concurrent rename, with no resurrected entry', () => {
    const [a, b] = twoPeers((d) => createNode(d, { id: 'f', name: 'f.py', type: 'file' }));
    deleteNode(a, 'f');
    renameNode(b, 'f', 'renamed.py');
    sync(a, b);
    expect(listNodes(a)).toEqual([]);
    expect(listNodes(b)).toEqual([]);
  });

  it('converges when both move the same file to different folders', () => {
    const [a, b] = twoPeers((d) => {
      createNode(d, { id: 'x', name: 'x', type: 'folder' });
      createNode(d, { id: 'y', name: 'y', type: 'folder' });
      createNode(d, { id: 'f', name: 'f', type: 'file' });
    });
    moveNode(a, 'f', 'x', 0);
    moveNode(b, 'f', 'y', 0);
    sync(a, b);
    expect(listNodes(a).filter((n) => n.id === 'f')).toHaveLength(1);
    expect(tree(a)).toEqual(tree(b));
  });

  it('does not lose a file created inside a folder that someone else deleted (it goes with the folder)', () => {
    const [a, b] = twoPeers((d) => createNode(d, { id: 'dir', name: 'dir', type: 'folder' }));
    deleteNode(a, 'dir');
    createNode(b, { id: 'inside', name: 'inside.py', type: 'file', parentId: 'dir', content: 'hello' });
    sync(a, b);
    expect(listNodes(a)).toEqual([]);
    expect(tree(a)).toEqual(tree(b));
    expect(getFileText(a, 'inside')).toBe('hello'); // text is still recoverable
  });

  it('survives opposite moves that would form a cycle: no node disappears, no cycle remains', () => {
    const [a, b] = twoPeers((d) => {
      createNode(d, { id: 'p', name: 'p', type: 'folder' });
      createNode(d, { id: 'q', name: 'q', type: 'folder' });
      createNode(d, { id: 'leaf', name: 'leaf', type: 'file', parentId: 'q' });
    });
    moveNode(a, 'p', 'q', 0); // a: p inside q
    moveNode(b, 'q', 'p', 0); // b: q inside p
    sync(a, b);

    const nodes = listNodes(a);
    expect(nodes.map((n) => n.id).sort()).toEqual(['leaf', 'p', 'q']);
    expect(tree(a)).toEqual(tree(b));
    // Following parents from any node must terminate at the root.
    for (const node of nodes) {
      const seen = new Set<string>();
      for (let cur: FileNode | undefined = node; cur; cur = nodes.find((n) => n.id === cur!.parentId)) {
        expect(seen.has(cur.id)).toBe(false);
        seen.add(cur.id);
      }
    }
  });

  it('resolves concurrent inserts at the same position to the same order on both sides', () => {
    const [a, b] = twoPeers((d) => createNode(d, { id: 'base', name: 'base', type: 'file' }));
    createNode(a, { id: 'a', name: 'a', type: 'file' }); // both get order 1
    createNode(b, { id: 'b', name: 'b', type: 'file' });
    sync(a, b);
    expect(tree(a)).toEqual(tree(b));
    expect(listNodes(a)).toHaveLength(3);
  });

  it('keeps concurrent text edits to the same file from both users', () => {
    const [a, b] = twoPeers((d) => createNode(d, { id: 'f', name: 'f.py', type: 'file', content: 'x = 1\n' }));
    getContentText(a, 'f').insert(0, '# alice\n');
    getContentText(b, 'f').insert(6, 'y = 2\n');
    sync(a, b);
    expect(getFileText(a, 'f')).toBe(getFileText(b, 'f'));
    expect(getFileText(a, 'f')).toContain('# alice');
    expect(getFileText(a, 'f')).toContain('y = 2');
  });
});

describe('randomised convergence', () => {
  // Deterministic PRNG so a failure can be replayed from its seed.
  const prng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`three users making arbitrary tree edits end up identical (seed ${seed})`, () => {
      const rand = prng(seed);
      const docs = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
      let counter = 0;
      const pick = <T>(items: T[]): T => items[Math.floor(rand() * items.length)];

      for (let step = 0; step < 120; step++) {
        const doc = pick(docs);
        const nodes = listNodes(doc);
        const roll = rand();
        try {
          if (roll < 0.35 || nodes.length === 0) {
            const folders = nodes.filter((n) => n.type === 'folder');
            createNode(doc, {
              id: `n${counter++}`,
              name: `name${counter}`,
              type: rand() < 0.3 ? 'folder' : 'file',
              parentId: folders.length && rand() < 0.5 ? pick(folders).id : null,
              content: 'seed text',
            });
          } else if (roll < 0.55) {
            renameNode(doc, pick(nodes).id, `renamed${step}`);
          } else if (roll < 0.8) {
            const folders = nodes.filter((n) => n.type === 'folder');
            moveNode(doc, pick(nodes).id, folders.length && rand() < 0.7 ? pick(folders).id : null, Math.floor(rand() * 4));
          } else if (roll < 0.9) {
            deleteNode(doc, pick(nodes).id);
          } else {
            const files = nodes.filter((n) => n.type === 'file');
            if (files.length) getContentText(doc, pick(files).id).insert(0, `t${step}`);
          }
        } catch (err) {
          if (!(err instanceof RoomDocError)) throw err; // invalid local ops are fine; anything else is a bug
        }
        if (rand() < 0.2) sync(pick(docs), pick(docs)); // partial, random syncing
      }

      sync(...docs);
      expect(tree(docs[1])).toEqual(tree(docs[0]));
      expect(tree(docs[2])).toEqual(tree(docs[0]));
      for (const node of listNodes(docs[0]).filter((n) => n.type === 'file')) {
        expect(getFileText(docs[1], node.id)).toBe(getFileText(docs[0], node.id));
        expect(getFileText(docs[2], node.id)).toBe(getFileText(docs[0], node.id));
      }

      // Every node reaches the root: no cycles survive resolution.
      const resolved = listNodes(docs[0]);
      for (const node of resolved) {
        const seen = new Set<string>();
        for (let cur: FileNode | undefined = node; cur; cur = resolved.find((n) => n.id === cur!.parentId)) {
          expect(seen.has(cur.id)).toBe(false);
          seen.add(cur.id);
        }
      }
    });
  }
});

describe('seeding from legacy rooms', () => {
  const legacy = [
    { id: 'readme', name: 'README.md', type: 'file' as const, parentId: 'docs', order: 0, content: '# hi', updatedAt: 1000 },
    { id: 'docs', name: 'docs', type: 'folder' as const, parentId: null, order: 1, updatedAt: 900 },
    { id: 'main', name: 'main.py', parentId: null, order: 0, content: 'print("hello")', updatedAt: new Date(2000) },
  ];

  it('builds a document with the legacy tree and text', () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, buildSeedUpdate(legacy));
    expect(tree(doc)).toEqual(['/>main:main.py@0', '/>docs:docs@1', 'docs>readme:README.md@0']);
    expect(getFileText(doc, 'main')).toBe('print("hello")');
  });

  it('is byte-for-byte deterministic whatever order the files arrive in', () => {
    const forward = buildSeedUpdate(legacy);
    const reversed = buildSeedUpdate([...legacy].reverse());
    expect(Buffer.from(forward).equals(Buffer.from(reversed))).toBe(true);
  });

  it('merges to ONE copy when two replicas seed the same room independently', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    Y.applyUpdate(a, buildSeedUpdate(legacy));
    Y.applyUpdate(b, buildSeedUpdate(legacy));
    sync(a, b);
    expect(getFileText(a, 'main')).toBe('print("hello")'); // not doubled
    expect(getFileText(b, 'readme')).toBe('# hi');
    expect(listNodes(a)).toHaveLength(3);
  });

  it('tolerates a missing parent, a duplicate id and an empty list', () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, buildSeedUpdate([{ id: 'orphan', name: 'o.py', parentId: 'gone', content: 'x' }, { id: 'orphan', name: 'dup.py' }]));
    expect(tree(doc)).toEqual(['/>orphan:o.py@0']);
    const empty = new Y.Doc();
    Y.applyUpdate(empty, buildSeedUpdate([]));
    expect(listNodes(empty)).toEqual([]);
  });
});
