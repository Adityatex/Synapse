import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoDocStore } from '@synapse/ydoc-store';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { closeAll, connect, fakeAccess, randomRoomId, startServer, stopServer, tokenFor, waitFor } from './testUtils.js';

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

afterEach(closeAll);

/** A fresh database per test, with the indexes the store expects. */
async function freshDb(): Promise<{ db: Db; newStore: () => MongoDocStore }> {
  const db = client.db(`collab_restart_${++dbCounter}`);
  await new MongoDocStore(db).ensureIndexes();
  // Each store instance stands in for one collab process: it has its own in-memory bookkeeping.
  return { db, newStore: () => new MongoDocStore(db) };
}

const text = (doc: Y.Doc) => doc.getText('content:main').toString();

describe('collab restart (acceptance: reconnecting client sees identical content)', () => {
  const members = [{ userId: 'ada' }, { userId: 'bob' }];

  it('survives a graceful restart of the collab server', async () => {
    const { newStore } = await freshDb();
    const roomId = randomRoomId();
    const access = fakeAccess({ [roomId]: { createdBy: 'ada', members } });

    const first = await startServer({ access, store: newStore(), storeDebounceMs: 50 });
    const a = connect(first, roomId, tokenFor('ada'));
    const b = connect(first, roomId, tokenFor('bob'));
    await Promise.all([a.synced, b.synced]);
    a.doc.getText('content:main').insert(0, 'def main():\n');
    b.doc.getText('content:main').insert(0, '# bob was here\n');
    await waitFor(() => text(a.doc) === text(b.doc) && a.provider.unsyncedChanges === 0 && b.provider.unsyncedChanges === 0);
    const before = text(a.doc);
    a.provider.destroy();
    b.provider.destroy();
    await stopServer(first);

    const second = await startServer({ access, store: newStore(), storeDebounceMs: 50 });
    const returning = connect(second, roomId, tokenFor('ada'));
    await returning.synced;
    expect(text(returning.doc)).toBe(before);
  });

  it('keeps edits made mid-session when a second instance takes over without the first flushing', async () => {
    const { db, newStore } = await freshDb();
    const roomId = randomRoomId();
    const access = fakeAccess({ [roomId]: { createdBy: 'ada', members } });

    const first = await startServer({ access, store: newStore(), storeDebounceMs: 50 });
    const a = connect(first, roomId, tokenFor('ada'));
    await a.synced;
    a.doc.getText('content:main').insert(0, 'written mid-session');
    // Persisted by the debounce alone: the session is still open and nothing has been shut down.
    await waitFor(async () => (await db.collection('ydoc_updates').countDocuments({ roomId })) > 0);

    const second = await startServer({ access, store: newStore(), storeDebounceMs: 50 });
    const takeover = connect(second, roomId, tokenFor('bob'));
    await takeover.synced;
    expect(text(takeover.doc)).toBe('written mid-session');
  });
});

describe('reading a room that nobody has open (P2-09 projection)', () => {
  it('does not write anything to the store', async () => {
    const { db, newStore } = await freshDb();
    const roomId = randomRoomId();
    const access = fakeAccess({ [roomId]: { createdBy: 'ada', members: [{ userId: 'ada' }] } });

    const server = await startServer({ access, store: newStore(), storeDebounceMs: 20 });
    const a = connect(server, roomId, tokenFor('ada'));
    await a.synced;
    a.doc.getText('content:main').insert(0, 'kept');
    await waitFor(() => a.provider.unsyncedChanges === 0);
    a.provider.destroy();
    await waitFor(() => server.hocuspocus.getDocumentsCount() === 0);
    const rows = () => db.collection('ydoc_updates').countDocuments({ roomId });
    const before = await rows();
    expect(before).toBeGreaterThan(0);

    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${server.webSocketURL.replace(/^ws/, 'http')}/rooms/${roomId}/files?fresh=1`, {
        headers: { Authorization: `Bearer ${tokenFor('ada')}` },
      });
      expect(res.status).toBe(200);
    }
    await waitFor(() => server.hocuspocus.getDocumentsCount() === 0);
    expect(await rows()).toBe(before); // three reads, no new rows
  });
});
