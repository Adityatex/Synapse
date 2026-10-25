import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createNode } from './ops.js';
import { touchedFileIds } from './touched.js';

/** Records the updates a document produces itself, in order (not the ones applied to it with origin 'remote'). */
function recorder(doc: Y.Doc): Uint8Array[] {
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') updates.push(update);
  });
  return updates;
}

const text = (doc: Y.Doc, fileId: string) => doc.getText(`content:${fileId}`);

/** Ground truth: apply the update to a copy of the room and see which file texts changed. */
function actuallyChanged(room: Y.Doc, update: Uint8Array): Set<string> {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(room));
  const changed = new Set<string>();
  copy.on('afterTransaction', (transaction: Y.Transaction) => {
    for (const type of transaction.changed.keys()) {
      if (type._item !== null) continue; // nested types (a node's map) are not file text
      const key = Y.findRootTypeKey(type);
      if (key.startsWith('content:')) changed.add(key.slice('content:'.length));
    }
  });
  Y.applyUpdate(copy, update);
  return changed;
}

describe('touchedFileIds', () => {
  it('attributes inserts to the file they land in, first insert and later ones alike', () => {
    const room = new Y.Doc();
    const updates = recorder(room);
    text(room, 'a').insert(0, 'hello'); // first item carries the type name
    text(room, 'a').insert(5, ' world'); // later items point at a neighbour
    text(room, 'b').insert(0, 'x');

    const other = new Y.Doc();
    const seen: string[] = [];
    for (const update of updates) {
      seen.push([...touchedFileIds(other, update).fileIds].join());
      Y.applyUpdate(other, update);
    }
    expect(seen).toEqual(['a', 'a', 'b']);
  });

  it('attributes a delete to the file it removes text from', () => {
    const room = new Y.Doc();
    text(room, 'a').insert(0, 'hello');
    text(room, 'b').insert(0, 'bye');
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(room));

    const updates = recorder(room);
    text(room, 'b').delete(0, 2);
    expect(touchedFileIds(peer, updates[0])).toEqual({ fileIds: new Set(['b']), unresolved: false });
  });

  it('finds every file when one delete range spans several', () => {
    const room = new Y.Doc();
    // Consecutive clocks of one client: the delete set merges them into a single range.
    text(room, 'a').insert(0, 'aaa');
    text(room, 'b').insert(0, 'bbb');
    text(room, 'c').insert(0, 'ccc');
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(room));

    const updates = recorder(room);
    room.transact(() => {
      text(room, 'a').delete(0, 3);
      text(room, 'b').delete(0, 3);
      text(room, 'c').delete(0, 3);
    });
    expect(touchedFileIds(peer, updates[0]).fileIds).toEqual(new Set(['a', 'b', 'c']));
  });

  it('does not count tree operations as text edits', () => {
    const room = new Y.Doc();
    const peer = new Y.Doc();
    const updates = recorder(room);
    createNode(room, { id: 'n1', name: 'main.py', type: 'file' });
    for (const update of updates) {
      expect(touchedFileIds(peer, update)).toEqual({ fileIds: new Set(), unresolved: false });
      Y.applyUpdate(peer, update);
    }
  });

  it('attributes the text of a file created together with its content', () => {
    const room = new Y.Doc();
    const peer = new Y.Doc();
    const updates = recorder(room);
    createNode(room, { id: 'n1', name: 'main.py', type: 'file', content: 'print(1)' });
    const touched = updates.map((u) => touchedFileIds(peer, u));
    expect(touched.some((t) => t.fileIds.has('n1'))).toBe(true);
  });

  it('flags an update that depends on content the room does not have', () => {
    const room = new Y.Doc();
    const updates = recorder(room);
    text(room, 'a').insert(0, 'one');
    text(room, 'a').insert(3, 'two'); // points at "one", which the receiver never saw
    const stranger = new Y.Doc();
    expect(touchedFileIds(stranger, updates[1]).unresolved).toBe(true);
  });

  it('flags bytes that are not an update', () => {
    expect(touchedFileIds(new Y.Doc(), new Uint8Array([255, 255, 255, 1, 2, 3])).unresolved).toBe(true);
  });

  it('reports exactly the files each user edited, across random concurrent edits by three users', () => {
    for (let seed = 1; seed <= 40; seed++) {
      let state = seed * 2654435761;
      const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
      const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];

      const files = ['f1', 'f2', 'f3'];
      const users = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
      const feeds = users.map(recorder);

      // Everyone starts from a shared state with some text in each file.
      for (const file of files) text(users[0], file).insert(0, `${file}:` + 'abcdefghij');
      for (const user of users.slice(1)) Y.applyUpdate(user, Y.encodeStateAsUpdate(users[0]), 'remote');
      feeds.forEach((feed) => feed.splice(0));

      for (let round = 0; round < 12; round++) {
        // Each user edits offline for a few operations, then everyone exchanges what they did.
        const edited = users.map(() => new Set<string>());
        for (const [index, user] of users.entries()) {
          for (let op = 0; op < 1 + Math.floor(random() * 4); op++) {
            const file = pick(files);
            const target = text(user, file);
            edited[index].add(file);
            if (target.length > 2 && random() < 0.4) target.delete(Math.floor(random() * (target.length - 1)), 1 + Math.floor(random() * 2));
            else target.insert(Math.floor(random() * (target.length + 1)), pick(['x', 'yz', '\n']));
          }
          if (random() < 0.3) {
            user.transact(() => files.forEach((file) => text(user, file).delete(0, 1)));
            files.forEach((file) => edited[index].add(file));
          }
        }

        for (const [from, feed] of feeds.entries()) {
          const batch = Y.mergeUpdates(feed.splice(0));
          for (const [to, receiver] of users.entries()) {
            if (to === from) continue;
            const where = `seed ${seed} round ${round}`;
            const touched = touchedFileIds(receiver, batch);
            expect(touched.unresolved, where).toBe(false);
            // Exactly what the author wrote to, including a delete that changes nothing for this receiver...
            expect([...touched.fileIds].sort(), where).toEqual([...edited[from]].sort());
            // ...and never less than what really changed.
            for (const file of actuallyChanged(receiver, batch)) expect(touched.fileIds.has(file), where).toBe(true);
            Y.applyUpdate(receiver, batch, 'remote');
          }
        }
      }
    }
  });
});
