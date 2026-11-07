import { getContentText, getFileText, listNodes } from '@synapse/room-doc';
import { MongoDocStore } from '@synapse/ydoc-store';
import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createMongoLegacyRooms } from './legacyRooms.js';
import { migrateAll, migrateRoom, type MigrationDeps } from './migration.js';
import { createMongoRoomAccess } from './roomAccess.js';
import { closeAll, connect, randomRoomId, startServer, tokenFor, waitFor } from './testUtils.js';

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

async function fresh(): Promise<MigrationDeps & { db: Db; store: MongoDocStore }> {
  const db = client.db(`migration_${++dbCounter}`);
  const store = new MongoDocStore(db);
  await store.ensureIndexes();
  return { db, store };
}

const LEGACY_FILES = [
  { id: 'welcome-py', name: 'main.py', type: 'file', parentId: null, order: 0, content: '# Python 3\nprint("Hello, Synapse!")', updatedAt: new Date(1000) },
  { id: 'lib', name: 'lib', type: 'folder', parentId: null, order: 1, content: '', updatedAt: new Date(1000) },
  { id: 'util', name: 'util.py', type: 'file', parentId: 'lib', order: 0, content: 'def helper(): ...', updatedAt: new Date(1000) },
];

async function legacyRoom(db: Db, extra: Record<string, unknown> = {}, roomId = randomRoomId()) {
  await db.collection('rooms').insertOne({
    roomId,
    roomName: 'Legacy',
    createdBy: 'ada',
    members: [{ userId: 'ada' }, { userId: 'bob' }],
    files: LEGACY_FILES,
    ...extra,
  });
  return roomId;
}

const flagOf = async (db: Db, roomId: string) => (await db.collection('rooms').findOne({ roomId }))?.collabVersion ?? null;
const documentOf = async (store: MongoDocStore, roomId: string) => {
  const state = await store.load(roomId);
  if (!state) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
};
/** Each visible file as [path, text], in tree order. */
const shape = (doc: Y.Doc) => {
  const nodes = listNodes(doc);
  const pathOf = (id: string): string => {
    const node = nodes.find((n) => n.id === id)!;
    return node.parentId ? `${pathOf(node.parentId)}/${node.name}` : node.name;
  };
  return nodes
    .filter((n) => n.type === 'file')
    .map((n) => [pathOf(n.id), getFileText(doc, n.id)])
    .sort(([a], [b]) => a.localeCompare(b));
};

describe('migrateRoom', () => {
  it('turns a legacy room into a document with the same files and text, and marks it', async () => {
    const deps = await fresh();
    const roomId = await legacyRoom(deps.db);

    expect(await migrateRoom(deps, roomId)).toBe('migrated');

    expect(shape((await documentOf(deps.store, roomId))!)).toEqual([
      ['lib/util.py', 'def helper(): ...'],
      ['main.py', '# Python 3\nprint("Hello, Synapse!")'],
    ]);
    expect(await flagOf(deps.db, roomId)).toBe(2);
    // Room.files is left as it was: it is only read, and only until P3-06 moves it out.
    expect((await deps.db.collection('rooms').findOne({ roomId }))?.files).toHaveLength(3);
  });

  it('can be run again, and leaves a migrated room alone', async () => {
    const deps = await fresh();
    const roomId = await legacyRoom(deps.db);
    await migrateRoom(deps, roomId);
    const rows = () => deps.db.collection('ydoc_updates').countDocuments({ roomId });
    const before = await rows();

    expect(await migrateRoom(deps, roomId)).toBe('already');
    expect(await rows()).toBe(before);
  });

  it('adopts a room that already has a document, without touching the document', async () => {
    const deps = await fresh();
    const roomId = await legacyRoom(deps.db);
    const doc = new Y.Doc();
    getContentText(doc, 'only-in-collab').insert(0, 'collab text');
    await deps.store.store(roomId, doc);

    expect(await migrateRoom(deps, roomId)).toBe('adopted');
    expect((await documentOf(deps.store, roomId))!.getText('content:only-in-collab').toString()).toBe('collab text');
    expect(await flagOf(deps.db, roomId)).toBe(2);
  });

  it('writes nothing in a dry run, and reports an unknown room', async () => {
    const deps = await fresh();
    const roomId = await legacyRoom(deps.db);
    expect(await migrateRoom(deps, roomId, { dryRun: true })).toBe('migrated');
    expect(await flagOf(deps.db, roomId)).toBeNull();
    expect(await documentOf(deps.store, roomId)).toBeNull();

    expect(await migrateRoom(deps, 'NOSUCHROOM')).toBe('not-found');
  });

  it('migrates a room that an old rollback left with collabVersion 1, from its Room.files', async () => {
    const deps = await fresh();
    const roomId = await legacyRoom(deps.db, { collabVersion: 1 });
    expect(await migrateRoom(deps, roomId)).toBe('migrated');
    expect(shape((await documentOf(deps.store, roomId))!)).toHaveLength(2);
    expect(await flagOf(deps.db, roomId)).toBe(2);
  });

  it('migrates a room with no files to an empty document', async () => {
    const deps = await fresh();
    const roomId = await legacyRoom(deps.db, { files: [] });
    expect(await migrateRoom(deps, roomId)).toBe('migrated');
    expect(await flagOf(deps.db, roomId)).toBe(2);
  });
});

describe('migrateAll', () => {
  it('migrates what is left, skips migrated rooms, and reports failures without stopping', async () => {
    const deps = await fresh();
    const [a, b, c] = [await legacyRoom(deps.db), await legacyRoom(deps.db), await legacyRoom(deps.db)];
    const done = await legacyRoom(deps.db, { collabVersion: 2 });

    // One room's save fails; the others must still be migrated.
    const flaky = { ...deps, store: Object.assign(Object.create(deps.store), { store: async (id: string, doc: Y.Doc) => { if (id === b) throw new Error('disk full'); return deps.store.store(id, doc); } }) } as MigrationDeps;
    const report = await migrateAll(flaky);

    expect(report.counts).toMatchObject({ migrated: 2, failed: 1 });
    expect(report.failures).toEqual([{ roomId: b, error: 'disk full' }]);
    expect(await flagOf(deps.db, a)).toBe(2);
    expect(await flagOf(deps.db, c)).toBe(2);
    expect(await flagOf(deps.db, b)).toBeNull(); // not marked, so a later run picks it up
    expect(await flagOf(deps.db, done)).toBe(2);

    const second = await migrateAll(deps);
    expect(second.counts).toMatchObject({ migrated: 1, failed: 0 });
    expect(await flagOf(deps.db, b)).toBe(2);
  });

  it('changes nothing in a dry run', async () => {
    const deps = await fresh();
    const roomId = await legacyRoom(deps.db);
    const report = await migrateAll(deps, { dryRun: true });
    expect(report.counts.migrated).toBe(1);
    expect(await flagOf(deps.db, roomId)).toBeNull();
    expect(await documentOf(deps.store, roomId)).toBeNull();
  });
});

describe('collab and the flag', () => {
  async function serverFor(deps: MigrationDeps) {
    return startServer({
      access: createMongoRoomAccess(deps.db),
      legacy: createMongoLegacyRooms(deps.db),
      store: deps.store,
      storeDebounceMs: 50,
    });
  }

  it('migrates a legacy room the first time a collab client opens it, and shows the same content', async () => {
    const deps = await fresh();
    const roomId = await legacyRoom(deps.db);
    expect(await flagOf(deps.db, roomId)).toBeNull();

    const server = await serverFor(deps);
    const ada = connect(server, roomId, tokenFor('ada'));
    await ada.synced;

    expect(shape(ada.doc)).toEqual([
      ['lib/util.py', 'def helper(): ...'],
      ['main.py', '# Python 3\nprint("Hello, Synapse!")'],
    ]);
    await waitFor(async () => (await flagOf(deps.db, roomId)) === 2);
  });

  it('marks a room with a document but no flag (a crash between the two steps) on its next open', async () => {
    const deps = await fresh();
    const roomId = await legacyRoom(deps.db);
    const seeded = new Y.Doc();
    getContentText(seeded, 'welcome-py').insert(0, 'already in collab');
    await deps.store.store(roomId, seeded);

    const server = await serverFor(deps);
    const ada = connect(server, roomId, tokenFor('ada'));
    await ada.synced;
    expect(getContentText(ada.doc, 'welcome-py').toString()).toBe('already in collab');
    await waitFor(async () => (await flagOf(deps.db, roomId)) === 2);
  });

  it('opens a room that an old rollback pinned with collabVersion 1, from its Room.files, and marks it', async () => {
    const deps = await fresh();
    const roomId = await legacyRoom(deps.db, { collabVersion: 1 });

    const server = await serverFor(deps);
    const ada = connect(server, roomId, tokenFor('ada'));
    await ada.synced;
    expect(shape(ada.doc)).toHaveLength(2);
    await waitFor(async () => (await flagOf(deps.db, roomId)) === 2);

    // A stranger is still turned away.
    const eve = connect(server, roomId, tokenFor('eve'));
    expect(await eve.denied).toMatch(/not a member/i);
  });
});
