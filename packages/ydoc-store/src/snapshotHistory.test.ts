import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { MemoryDocStore, type SnapshotHistory, type SnapshotMeta } from './docStore.js';
import { MongoDocStore } from './mongoDocStore.js';
import { createInProcessScheduler } from './snapshotQueue.js';

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

const meta: SnapshotMeta = { kind: 'restore', userId: 'ada', userName: 'Ada', fileId: 'main', fileName: 'main.py', fromSeq: 2 };
const textOf = (state: Uint8Array | null) => {
  const doc = new Y.Doc();
  if (state) Y.applyUpdate(doc, state);
  return doc.getText('content:main').toString();
};

/** The same behaviour from both stores: the versions of a room's history. */
function describeHistory(name: string, make: () => Promise<SnapshotHistory & { store(roomId: string, doc: Y.Doc): Promise<void> }>) {
  describe(`${name}: snapshot history`, () => {
    it('lists snapshots newest first, loads each one as it was, and keeps them as the room moves on', async () => {
      const store = await make();
      const doc = new Y.Doc();
      const type = (text: string) => doc.getText('content:main').insert(doc.getText('content:main').length, text);

      type('one ');
      await store.store('ROOM01', doc);
      await store.writeSnapshot('ROOM01');
      type('two ');
      await store.store('ROOM01', doc);
      await store.writeSnapshot('ROOM01');
      type('three');
      await store.store('ROOM01', doc);
      await store.writeSnapshot('ROOM01');

      const list = await store.listSnapshots('ROOM01', 10);
      expect(list).toHaveLength(3);
      expect(list.map((s) => s.seq)).toEqual([...list.map((s) => s.seq)].sort((a, b) => b - a));
      expect(list.every((s) => s.createdAt instanceof Date)).toBe(true);
      expect(list.every((s) => !('state' in s))).toBe(true);
      expect(await Promise.all([...list].reverse().map((s) => store.loadSnapshot('ROOM01', s.seq).then(textOf)))).toEqual(['one ', 'one two ', 'one two three']);
    });

    it('limits the list, and answers null for a snapshot or a room that does not exist', async () => {
      const store = await make();
      const doc = new Y.Doc();
      for (const word of ['a', 'b', 'c']) {
        doc.getText('content:main').insert(0, word);
        await store.store('ROOM02', doc);
        await store.writeSnapshot('ROOM02');
      }
      expect(await store.listSnapshots('ROOM02', 2)).toHaveLength(2);
      expect(await store.loadSnapshot('ROOM02', 999)).toBeNull();
      expect(await store.listSnapshots('NOROOM', 10)).toEqual([]);
      expect(await store.loadSnapshot('NOROOM', 1)).toBeNull();
    });

    it('says why a snapshot was taken when it was not compaction, and says nothing otherwise', async () => {
      const store = await make();
      const doc = new Y.Doc();
      doc.getText('content:main').insert(0, 'x');
      await store.store('ROOM03', doc);
      await store.writeSnapshot('ROOM03');
      doc.getText('content:main').insert(0, 'y');
      await store.store('ROOM03', doc);
      await store.writeSnapshot('ROOM03', meta);

      const [newest, oldest] = await store.listSnapshots('ROOM03', 10);
      expect(newest.meta).toEqual(meta);
      expect(oldest.meta).toBeUndefined();
    });

    it('takes no snapshot when nothing is new', async () => {
      const store = await make();
      const doc = new Y.Doc();
      doc.getText('content:main').insert(0, 'x');
      await store.store('ROOM04', doc);
      expect(await store.writeSnapshot('ROOM04')).not.toBeNull();
      expect(await store.writeSnapshot('ROOM04', meta)).toBeNull();
      expect(await store.listSnapshots('ROOM04', 10)).toHaveLength(1);
    });
  });
}

describeHistory('MongoDocStore', async () => {
  const db = client.db(`history_${++dbCounter}`);
  const store = new MongoDocStore(db);
  await store.ensureIndexes();
  return store;
});
describeHistory('MemoryDocStore', async () => new MemoryDocStore());

describe('MongoDocStore: history survives compaction', () => {
  it('keeps old snapshots when the updates they cover are pruned', async () => {
    const db = client.db(`history_${++dbCounter}`);
    const store = new MongoDocStore(db);
    await store.ensureIndexes();
    const doc = new Y.Doc();
    doc.getText('content:main').insert(0, 'first');
    await store.store('KEEP01', doc);
    const first = await store.writeSnapshot('KEEP01');
    await store.pruneCoveredUpdates('KEEP01');
    doc.getText('content:main').insert(0, 'second ');
    await store.store('KEEP01', doc);
    await store.writeSnapshot('KEEP01');
    await store.pruneCoveredUpdates('KEEP01');

    expect(await db.collection('ydoc_updates').countDocuments({ roomId: 'KEEP01' })).toBe(0);
    expect(textOf(await store.loadSnapshot('KEEP01', first!.snapshotSeq))).toBe('first');
    expect(textOf(await store.load('KEEP01'))).toBe('second first');
  });
});

describe('createInProcessScheduler', () => {
  afterEach(() => vi.useRealTimers());

  function fakeStore() {
    const calls: string[] = [];
    return {
      calls,
      store: {
        writeSnapshot: async (roomId: string) => {
          calls.push(`snapshot ${roomId}`);
          return { snapshotSeq: 1, updatesMerged: 1, snapshotBytes: 1 };
        },
        pruneCoveredUpdates: async (roomId: string) => {
          calls.push(`prune ${roomId}`);
          return 1;
        },
      },
    };
  }

  it('compacts a room once its quiet delay has passed, one run however many updates arrived', async () => {
    vi.useFakeTimers();
    const { calls, store } = fakeStore();
    const scheduler = createInProcessScheduler({ store, policy: { quietDelayMs: 1000, updatesThreshold: 500 } });
    for (let i = 1; i <= 20; i += 1) scheduler.noteAppend('ROOM01', i);
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    expect(calls).toEqual(['snapshot ROOM01', 'prune ROOM01']);
    await scheduler.close();
  });

  it('compacts at once when the tail reaches the threshold', async () => {
    vi.useFakeTimers();
    const { calls, store } = fakeStore();
    const scheduler = createInProcessScheduler({ store, policy: { quietDelayMs: 60_000, updatesThreshold: 5 } });
    scheduler.noteAppend('ROOM01', 5);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(['snapshot ROOM01', 'prune ROOM01']);
    await scheduler.close();
  });

  it('keeps rooms apart, schedules again after a run, and reports a failure without throwing', async () => {
    vi.useFakeTimers();
    const { calls, store } = fakeStore();
    const errors: string[] = [];
    let fail = true;
    const flaky = { ...store, writeSnapshot: async (roomId: string) => { if (fail) throw new Error('disk full'); return store.writeSnapshot(roomId); } };
    const scheduler = createInProcessScheduler({ store: flaky, policy: { quietDelayMs: 1000, updatesThreshold: 500 }, onError: (err) => errors.push(err.message) });

    scheduler.noteAppend('A', 1);
    await vi.advanceTimersByTimeAsync(1100);
    expect(errors).toEqual(['disk full']);

    fail = false;
    scheduler.noteAppend('A', 2);
    scheduler.noteAppend('B', 1);
    await vi.advanceTimersByTimeAsync(1100);
    expect(calls.filter((c) => c.startsWith('snapshot')).sort()).toEqual(['snapshot A', 'snapshot B']);
    await scheduler.close();
  });

  it('does nothing after it is closed', async () => {
    vi.useFakeTimers();
    const { calls, store } = fakeStore();
    const scheduler = createInProcessScheduler({ store, policy: { quietDelayMs: 1000, updatesThreshold: 500 } });
    scheduler.noteAppend('ROOM01', 1);
    await scheduler.close();
    scheduler.noteAppend('ROOM01', 600);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toEqual([]);
  });
});
