import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createNode, deleteNode, moveNode, renameNode } from './ops.js';
import { projectRoom } from './projection.js';

describe('projectRoom', () => {
  it('is empty for an empty room', () => {
    expect(projectRoom(new Y.Doc())).toEqual({ files: [], content: '' });
  });

  it('lists files with their paths and text, in tree order', () => {
    const doc = new Y.Doc();
    createNode(doc, { id: 'main', name: 'main.py', type: 'file', content: 'print(1)' });
    createNode(doc, { id: 'lib', name: 'lib', type: 'folder' });
    createNode(doc, { id: 'util', name: 'util.py', type: 'file', parentId: 'lib', content: 'def f(): ...' });
    createNode(doc, { id: 'deep', name: 'deep', type: 'folder', parentId: 'lib' });
    createNode(doc, { id: 'x', name: 'x.py', type: 'file', parentId: 'deep', content: 'x = 1' });

    const { files, content } = projectRoom(doc);
    expect(files.map((f) => [f.path, f.content])).toEqual([
      ['main.py', 'print(1)'],
      ['lib/util.py', 'def f(): ...'],
      ['lib/deep/x.py', 'x = 1'],
    ]);
    expect(files.map((f) => f.id)).toEqual(['main', 'util', 'x']);
    expect(content).toBe('--- main.py ---\nprint(1)\n\n--- lib/util.py ---\ndef f(): ...\n\n--- lib/deep/x.py ---\nx = 1');
  });

  it('follows renames, moves and deletes', () => {
    const doc = new Y.Doc();
    createNode(doc, { id: 'a', name: 'a.py', type: 'file', content: 'A' });
    createNode(doc, { id: 'b', name: 'b.py', type: 'file', content: 'B' });
    createNode(doc, { id: 'dir', name: 'dir', type: 'folder' });
    renameNode(doc, 'a', 'renamed.py');
    moveNode(doc, 'b', 'dir', 0);
    expect(projectRoom(doc).files.map((f) => f.path).sort()).toEqual(['dir/b.py', 'renamed.py']);

    deleteNode(doc, 'dir'); // hides the folder's files too
    expect(projectRoom(doc).files.map((f) => f.path)).toEqual(['renamed.py']);
  });

  it('shows text edited in the document, not what was first stored', () => {
    const doc = new Y.Doc();
    createNode(doc, { id: 'a', name: 'a.py', type: 'file', content: 'one' });
    doc.getText('content:a').insert(3, ' two');
    expect(projectRoom(doc).files[0].content).toBe('one two');
  });
});
