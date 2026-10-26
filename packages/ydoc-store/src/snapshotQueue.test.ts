import { createRedisClient } from '@synapse/redis';
import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MongoDocStore } from './mongoDocStore.js';
import {
  compactRoom,
  connectionFromUrl,
  createSnapshotScheduler,
  createSnapshotWorker,
  type CompactionOutcome,
  type SnapshotScheduler,
} from './snapshotQueue.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// BullMQ needs a real Redis; these tests are skipped (not failed) without one.
const redisAvailable = await (async () => {
  const probe = createRedisClient(REDIS_URL, { redis: { enableOfflineQueue: true, retryStrategy: () => null, connectTimeout: 800 } });
  try {
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
})();

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

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function freshDb(): Promise<Db> {
  const db = client.db(`snapshot_queue_${++dbCounter}`);
  await new MongoDocStore(db).ensureIndexes();
  return db;
}

const uniqueQueue = () => `test-${Math.random().toString(36).slice(2, 10)}`;
const text = (doc: Y.Doc) => doc.getText('content:main').toString();

async function waitFor(check: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function loadText(db: Db, roomId: string): Promise<string> {
  const doc = new Y.Doc();
  const state = await new MongoDocStore(db).load(roomId);
  if (state) Y.applyUpdate(doc, state);
  return text(doc);
}

describe('compactRoom', () => {
  it('snapshots, prunes the covered updates, and leaves the loaded state unchanged', async () => {
    const db = await freshDb();
    const store = new MongoDocStore(db);
    const doc = new Y.Doc();
    for (let i = 0; i < 20; i++) {
      doc.getText('content:main').insert(doc.getText('content:main').length, `line ${i}\n`);
      await store.store('COMPACT1', doc);
    }

    const outcome = await compactRoom(store, 'COMPACT1');
    expect(outcome.snapshot).toMatchObject({ snapshotSeq: 20, updatesMerged: 20 });
    expect(outcome.prunedUpdates).toBe(20);
    expect(await db.collection('ydoc_updates').countDocuments({ roomId: 'COMPACT1' })).toBe(0);
    expect(await loadText(db, 'COMPACT1')).toBe(text(doc));

    // Running it again with nothing new is a no-op, not an error.
    const again = await compactRoom(store, 'COMPACT1');
    expect(again).toMatchObject({ snapshot: null, prunedUpdates: 0 });
  });
});

describe.skipIf(!redisAvailable)('compaction through the queue', () => {
  function startPipeline(db: Db, policy: Parameters<typeof createSnapshotScheduler>[0]['policy']) {
    const queueName = uniqueQueue();
    const connection = connectionFromUrl(REDIS_URL);
    const scheduler: SnapshotScheduler = createSnapshotScheduler({ connection, queueName, policy });
    const outcomes: CompactionOutcome[] = [];
    const failures: Array<{ roomId?: string; attemptsMade: number }> = [];
    const workerStore = new MongoDocStore(db);
    return { queueName, connection, scheduler, outcomes, failures, workerStore };
  }

  it('keeps the updates collection bounded under a sustained write load (soak)', async () => {
    const db = await freshDb();
    const { scheduler, connection, queueName, outcomes, failures, workerStore } = startPipeline(db, {
      updatesThreshold: 500,
      quietDelayMs: 60_000,
    });
    const worker = createSnapshotWorker({
      connection,
      queueName,
      store: workerStore,
      concurrency: 2,
      onCompleted: (o) => outcomes.push(o),
      onFailed: (roomId, _err, attemptsMade) => failures.push({ roomId, attemptsMade }),
    });
    cleanups.push(() => worker.close(), () => scheduler.close());

    // Two collab replicas writing to one room: each has its own store instance and document,
    // and every change reaches both, as it would through Redis.
    const writer = (doc: Y.Doc) =>
      new MongoDocStore(db, { onAppend: (roomId, info) => scheduler.noteAppend(roomId, info.updatesSinceSnapshot) });
    const [storeA, storeB] = [writer(new Y.Doc()), writer(new Y.Doc())];
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    docA.on('update', (u: Uint8Array) => Y.applyUpdate(docB, u));
    docB.on('update', (u: Uint8Array) => Y.applyUpdate(docA, u));

    const TOTAL = 3000;
    let peak = 0;
    for (let i = 0; i < TOTAL; i++) {
      const [doc, store] = i % 2 === 0 ? [docA, storeA] : [docB, storeB];
      doc.getText('content:main').insert(doc.getText('content:main').length, `edit ${i};`);
      await store.store('SOAK1', doc);
      if (i % 25 === 0) peak = Math.max(peak, await db.collection('ydoc_updates').countDocuments({ roomId: 'SOAK1' }));
    }

    // Let the queue drain, then check nothing was lost along the way.
    await waitFor(async () => (await db.collection('ydoc_updates').countDocuments({ roomId: 'SOAK1' })) <= 500);

    console.info(`soak: ${TOTAL} edits, peak updates in collection = ${peak}, compactions = ${outcomes.length}`);
    expect(failures).toEqual([]);
    expect(outcomes.length).toBeGreaterThanOrEqual(3);
    expect(peak).toBeLessThanOrEqual(1000);
    expect(await db.collection('ydoc_snapshots').countDocuments({ roomId: 'SOAK1' })).toBeGreaterThanOrEqual(3);
    expect(await loadText(db, 'SOAK1')).toBe(text(docA));
    expect(text(docA)).toBe(text(docB));
    expect(text(docA).split(';').length - 1).toBe(TOTAL); // every one of the 3000 edits is present exactly once
  }, 120_000);

  it('compacts a quiet room after the delay even if it never reaches the threshold', async () => {
    const db = await freshDb();
    const { scheduler, connection, queueName, outcomes, workerStore } = startPipeline(db, { updatesThreshold: 500, quietDelayMs: 300 });
    const worker = createSnapshotWorker({ connection, queueName, store: workerStore, onCompleted: (o) => outcomes.push(o) });
    cleanups.push(() => worker.close(), () => scheduler.close());

    const store = new MongoDocStore(db, { onAppend: (roomId, info) => scheduler.noteAppend(roomId, info.updatesSinceSnapshot) });
    const doc = new Y.Doc();
    for (let i = 0; i < 5; i++) {
      doc.getText('content:main').insert(doc.getText('content:main').length, `quiet ${i};`);
      await store.store('QUIET1', doc);
    }

    await waitFor(async () => (await db.collection('ydoc_snapshots').countDocuments({ roomId: 'QUIET1' })) === 1);
    await waitFor(async () => (await db.collection('ydoc_updates').countDocuments({ roomId: 'QUIET1' })) === 0);
    expect(await loadText(db, 'QUIET1')).toBe(text(doc));
    await waitFor(() => outcomes.length >= 1); // the worker reports after the prune is done
    expect(outcomes[0]).toMatchObject({ roomId: 'QUIET1', prunedUpdates: 5 });
  });

  it('retries a failed job with backoff and then succeeds', async () => {
    const db = await freshDb();
    const { scheduler, connection, queueName, outcomes, failures, workerStore } = startPipeline(db, {
      updatesThreshold: 3,
      quietDelayMs: 60_000,
      backoffMs: 50,
      attempts: 3,
    });
    let calls = 0;
    const flaky = {
      writeSnapshot: async (roomId: string) => {
        if (++calls === 1) throw new Error('mongo hiccup');
        return workerStore.writeSnapshot(roomId);
      },
      pruneCoveredUpdates: (roomId: string) => workerStore.pruneCoveredUpdates(roomId),
    };
    const worker = createSnapshotWorker({
      connection,
      queueName,
      store: flaky,
      onCompleted: (o) => outcomes.push(o),
      onFailed: (roomId, _err, attemptsMade) => failures.push({ roomId, attemptsMade }),
    });
    cleanups.push(() => worker.close(), () => scheduler.close());

    const store = new MongoDocStore(db, { onAppend: (roomId, info) => scheduler.noteAppend(roomId, info.updatesSinceSnapshot) });
    const doc = new Y.Doc();
    for (let i = 0; i < 4; i++) {
      doc.getText('content:main').insert(doc.getText('content:main').length, `r${i};`);
      await store.store('RETRY1', doc);
    }

    await waitFor(() => outcomes.length >= 1);
    expect(failures).toEqual([{ roomId: 'RETRY1', attemptsMade: 1 }]);
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(await loadText(db, 'RETRY1')).toBe(text(doc));
  });
});

describe('connectionFromUrl', () => {
  it('maps a Redis URL to BullMQ connection options', () => {
    expect(connectionFromUrl('redis://localhost:6380/2')).toMatchObject({ host: 'localhost', port: 6380, db: 2, maxRetriesPerRequest: null });
    expect(connectionFromUrl('rediss://default:p%40ss@x.upstash.io:6379')).toMatchObject({
      host: 'x.upstash.io',
      username: 'default',
      password: 'p@ss',
      tls: {},
    });
  });
});
