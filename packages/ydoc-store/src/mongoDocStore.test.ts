import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MongoDocStore } from './mongoDocStore.js';

let mongod: MongoMemoryServer;
let client: MongoClient;
let dbCounter = 0;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await new MongoClient(mongod.getUri()).connect();
}, 120_000);

afterAll(async () => {
  await client?.close();
  await mongod?.stop();
});

/** A fresh database per test, with the indexes the store expects. */
async function freshDb(): Promise<{ db: Db; newStore: () => MongoDocStore }> {
  const db = client.db(`collab_test_${++dbCounter}`);
  const first = new MongoDocStore(db);
  await first.ensureIndexes();
  // Each store instance stands in for one collab process: it has its own in-memory bookkeeping.
  return { db, newStore: () => new MongoDocStore(db) };
}

// Deterministic PRNG so a failing synthetic stream can be replayed.
function prng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const text = (doc: Y.Doc) => doc.getText('content:main').toString();

function randomEdit(doc: Y.Doc, rand: () => number): void {
  const t = doc.getText('content:main');
  if (t.length > 20 && rand() < 0.3) {
    const at = Math.floor(rand() * (t.length - 5));
    t.delete(at, 1 + Math.floor(rand() * 4));
  } else {
    const at = Math.floor(rand() * (t.length + 1));
    t.insert(at, Math.random().toString(36).slice(2, 2 + 1 + Math.floor(rand() * 8)));
  }
}

async function loadInto(store: MongoDocStore, roomId: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const state = await store.load(roomId);
  if (state) Y.applyUpdate(doc, state);
  return doc;
}

describe('MongoDocStore: append and load', () => {
  it('returns null for a room that was never stored', async () => {
    const { newStore } = await freshDb();
    expect(await newStore().load('NEVERSTORED')).toBeNull();
  });

  it('reproduces a long synthetic edit stream from two writers in a fresh process', async () => {
    const { newStore } = await freshDb();
    const store = newStore();
    const rand = prng(42);
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.on('update', (u: Uint8Array) => Y.applyUpdate(b, u));
    b.on('update', (u: Uint8Array) => Y.applyUpdate(a, u));

    for (let i = 1; i <= 300; i++) {
      randomEdit(rand() < 0.5 ? a : b, rand);
      if (i % 10 === 0) await store.store('SYNTH1', a);
    }
    await store.store('SYNTH1', a);

    expect(text(a)).toBe(text(b));
    // "Restart": a brand-new store instance knows nothing but what is in Mongo.
    const restored = await loadInto(newStore(), 'SYNTH1');
    expect(text(restored)).toBe(text(a));
    expect(text(restored).length).toBeGreaterThan(100);
  });

  it('writes only what changed, and nothing when nothing changed', async () => {
    const { db, newStore } = await freshDb();
    const store = newStore();
    const doc = new Y.Doc();
    doc.getText('content:main').insert(0, 'x'.repeat(5000));

    await store.store('DIFF1', doc);
    await store.store('DIFF1', doc); // unchanged
    expect(await db.collection('ydoc_updates').countDocuments({ roomId: 'DIFF1' })).toBe(1);

    doc.getText('content:main').insert(0, 'y');
    await store.store('DIFF1', doc);
    const updates = await db.collection('ydoc_updates').find({ roomId: 'DIFF1' }).sort({ seq: 1 }).toArray();
    expect(updates.map((u) => u.seq)).toEqual([1, 2]);
    expect(updates[1].update.buffer.length).toBeLessThan(updates[0].update.buffer.length / 10);
  });

  it('does not write for an empty document', async () => {
    const { db, newStore } = await freshDb();
    await newStore().store('EMPTY1', new Y.Doc());
    expect(await db.collection('ydoc_updates').countDocuments({ roomId: 'EMPTY1' })).toBe(0);
  });

  it('tolerates the same change being stored by two replicas', async () => {
    const { db, newStore } = await freshDb();
    const doc = new Y.Doc();
    doc.getText('content:main').insert(0, 'shared edit');

    await Promise.all([newStore().store('DUP1', doc), newStore().store('DUP1', doc)]);

    expect(await db.collection('ydoc_updates').countDocuments({ roomId: 'DUP1' })).toBe(2);
    expect(text(await loadInto(newStore(), 'DUP1'))).toBe('shared edit');
  });

  it('keeps seqs contiguous and loses nothing when replicas write concurrently', async () => {
    const { db, newStore } = await freshDb();
    const replicaOne = newStore();
    const replicaTwo = newStore();
    const docOne = new Y.Doc();
    const docTwo = new Y.Doc();

    const writes: Promise<void>[] = [];
    for (let i = 0; i < 15; i++) {
      docOne.getText('content:main').insert(0, `a${i};`);
      writes.push(replicaOne.store('RACE1', docOne));
      docTwo.getText('content:main').insert(0, `b${i};`);
      writes.push(replicaTwo.store('RACE1', docTwo));
    }
    await Promise.all(writes);

    const seqs = (await db.collection('ydoc_updates').find({ roomId: 'RACE1' }).sort({ seq: 1 }).toArray()).map((u) => u.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));

    const restored = text(await loadInto(newStore(), 'RACE1'));
    for (let i = 0; i < 15; i++) {
      expect(restored).toContain(`a${i};`);
      expect(restored).toContain(`b${i};`);
    }
  });
});

describe('MongoDocStore: snapshots and compaction', () => {
  async function storeEdits(store: MongoDocStore, roomId: string, doc: Y.Doc, count: number, label: string) {
    for (let i = 0; i < count; i++) {
      doc.getText('content:main').insert(doc.getText('content:main').length, `${label}${i} `);
      await store.store(roomId, doc);
    }
  }

  it('loads snapshot + tail to the same state as the full stream', async () => {
    const { db, newStore } = await freshDb();
    const store = newStore();
    const doc = new Y.Doc();

    await storeEdits(store, 'SNAP1', doc, 30, 'before');
    const result = await store.writeSnapshot('SNAP1');
    expect(result).toMatchObject({ snapshotSeq: 30, updatesMerged: 30 });
    await storeEdits(store, 'SNAP1', doc, 10, 'after');

    expect(text(await loadInto(newStore(), 'SNAP1'))).toBe(text(doc));

    // Pruning the covered updates must not change what loads.
    expect(await store.pruneCoveredUpdates('SNAP1')).toBe(30);
    expect(await db.collection('ydoc_updates').countDocuments({ roomId: 'SNAP1' })).toBe(10);
    expect(text(await loadInto(newStore(), 'SNAP1'))).toBe(text(doc));
  });

  it('snapshots incrementally and does nothing when nothing is new', async () => {
    const { db, newStore } = await freshDb();
    const store = newStore();
    const doc = new Y.Doc();

    await storeEdits(store, 'SNAP2', doc, 5, 'a');
    expect(await store.writeSnapshot('SNAP2')).toMatchObject({ snapshotSeq: 5 });
    expect(await store.writeSnapshot('SNAP2')).toBeNull();
    await storeEdits(store, 'SNAP2', doc, 3, 'b');
    expect(await store.writeSnapshot('SNAP2')).toMatchObject({ snapshotSeq: 8, updatesMerged: 3 });

    expect(await db.collection('ydoc_snapshots').countDocuments({ roomId: 'SNAP2' })).toBe(2);
    expect(text(await loadInto(newStore(), 'SNAP2'))).toBe(text(doc));
  });

  it('never reuses a seq below the newest snapshot, even after every update is pruned', async () => {
    const { db, newStore } = await freshDb();
    const store = newStore();
    const doc = new Y.Doc();

    await storeEdits(store, 'SNAP3', doc, 4, 'x');
    await store.writeSnapshot('SNAP3');
    await store.pruneCoveredUpdates('SNAP3');
    expect(await db.collection('ydoc_updates').countDocuments({ roomId: 'SNAP3' })).toBe(0);

    await storeEdits(store, 'SNAP3', doc, 1, 'later');
    const [next] = await db.collection('ydoc_updates').find({ roomId: 'SNAP3' }).toArray();
    expect(next.seq).toBe(5);
    expect(text(await loadInto(newStore(), 'SNAP3'))).toBe(text(doc));
  });

  it('refuses to load a room whose update sequence has a gap instead of returning partial data', async () => {
    const { db, newStore } = await freshDb();
    const store = newStore();
    const doc = new Y.Doc();

    await storeEdits(store, 'GAP1', doc, 5, 'g');
    await db.collection('ydoc_updates').deleteOne({ roomId: 'GAP1', seq: 3 });

    await expect(newStore().load('GAP1')).rejects.toThrow(/consistent state/);
  });
});
