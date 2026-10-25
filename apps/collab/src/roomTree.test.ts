import { createNode, deleteNode, getContentText, getFileText, listNodes, moveNode, renameNode, type LegacyFile } from '@synapse/room-doc';
import { createRedisClient } from '@synapse/redis';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MemoryDocStore } from './docStore.js';
import type { LegacyRooms } from './legacyRooms.js';
import { closeAll, connect, fakeAccess, randomRoomId, startServer, tokenFor, waitFor } from './testUtils.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
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

afterEach(closeAll);

const members = [{ userId: 'ada' }, { userId: 'bob' }];
const accessFor = (roomId: string) => fakeAccess({ [roomId]: { createdBy: 'ada', members } });
const snapshot = (doc: Y.Doc) => listNodes(doc).map((n) => `${n.parentId ?? '/'}>${n.id}:${n.name}@${n.order}`);
const staticLegacy = (files: LegacyFile[]): LegacyRooms & { calls: number } => {
  const source = { calls: 0, loadFiles: async () => (source.calls++, files) };
  return source;
};

describe('seeding a room from its legacy files', () => {
  const legacyFiles: LegacyFile[] = [
    { id: 'welcome-py', name: 'main.py', content: '# Python 3\nprint("Hello, Synapse!")', updatedAt: 1000 },
    { id: 'lib', name: 'lib', type: 'folder', order: 1, updatedAt: 1000 },
    { id: 'util', name: 'util.py', parentId: 'lib', content: 'def helper(): ...', updatedAt: 1000 },
  ];

  it('gives the first client the legacy tree and text, and only seeds once', async () => {
    const roomId = randomRoomId();
    const legacy = staticLegacy(legacyFiles);
    const server = await startServer({ access: accessFor(roomId), legacy, store: new MemoryDocStore(), storeDebounceMs: 50 });

    const first = connect(server, roomId, tokenFor('ada'));
    await first.synced;
    expect(snapshot(first.doc).sort()).toEqual(['/>lib:lib@1', '/>welcome-py:main.py@0', 'lib>util:util.py@0']);
    expect(getFileText(first.doc, 'util')).toBe('def helper(): ...');

    // Edits persist on top of the seed; a later session must not re-seed over them.
    getContentText(first.doc, 'welcome-py').insert(0, '# edited\n');
    await waitFor(() => first.provider.unsyncedChanges === 0);
    first.provider.destroy();
    await waitFor(() => server.hocuspocus.getDocumentsCount() === 0);

    const second = connect(server, roomId, tokenFor('bob'));
    await second.synced;
    expect(getFileText(second.doc, 'welcome-py')).toBe('# edited\n# Python 3\nprint("Hello, Synapse!")');
    expect(legacy.calls).toBe(1);
  });

  it('leaves a room with no legacy files empty instead of failing', async () => {
    const roomId = randomRoomId();
    const server = await startServer({ access: accessFor(roomId), legacy: staticLegacy([]) });
    const client = connect(server, roomId, tokenFor('ada'));
    await client.synced;
    expect(listNodes(client.doc)).toEqual([]);
  });

  it.skipIf(!redisAvailable)('does not duplicate text when two replicas seed the same room at once', async () => {
    const roomId = randomRoomId();
    const access = accessFor(roomId);
    const legacy = staticLegacy(legacyFiles);
    const [one, two] = await Promise.all([
      startServer({ access, legacy, redisUrl: REDIS_URL, store: new MemoryDocStore() }),
      startServer({ access, legacy, redisUrl: REDIS_URL, store: new MemoryDocStore() }),
    ]);

    // Both clients connect in the same tick, so both replicas load and seed the empty room.
    const a = connect(one, roomId, tokenFor('ada'));
    const b = connect(two, roomId, tokenFor('bob'));
    await Promise.all([a.synced, b.synced]);
    await waitFor(() => snapshot(a.doc).join() === snapshot(b.doc).join());

    expect(getFileText(a.doc, 'welcome-py')).toBe('# Python 3\nprint("Hello, Synapse!")');
    expect(getFileText(b.doc, 'welcome-py')).toBe('# Python 3\nprint("Hello, Synapse!")');
    expect(listNodes(a.doc)).toHaveLength(3);
  });
});

/**
 * P2-06 acceptance: creating, renaming, moving and deleting files by two users
 * at the same time never loses or duplicates entries.
 */
async function runConcurrentTreeEdits(clientOneServer: Awaited<ReturnType<typeof startServer>>, clientTwoServer: Awaited<ReturnType<typeof startServer>>, roomId: string) {
  const a = connect(clientOneServer, roomId, tokenFor('ada'));
  const b = connect(clientTwoServer, roomId, tokenFor('bob'));
  await Promise.all([a.synced, b.synced]);

  // Shared starting point, created by one user and seen by both.
  createNode(a.doc, { id: 'src', name: 'src', type: 'folder' });
  createNode(a.doc, { id: 'old', name: 'old.py', type: 'file', content: 'old' });
  createNode(a.doc, { id: 'rename-me', name: 'before.py', type: 'file', content: 'r' });
  createNode(a.doc, { id: 'move-me', name: 'move.py', type: 'file', content: 'm' });
  await waitFor(() => listNodes(b.doc).length === 4);

  // Everything below happens "at once": both sets of edits are applied locally
  // before either client has seen the other's.
  for (let i = 0; i < 5; i++) createNode(a.doc, { id: `a${i}`, name: `alice${i}.py`, type: 'file', content: `a${i}` });
  for (let i = 0; i < 5; i++) createNode(b.doc, { id: `b${i}`, name: `bob${i}.py`, type: 'file', content: `b${i}` });
  renameNode(a.doc, 'rename-me', 'after.py');
  moveNode(b.doc, 'move-me', 'src', 0);
  deleteNode(a.doc, 'old');
  createNode(b.doc, { id: 'in-src', name: 'in_src.py', type: 'file', parentId: 'src', content: 'x' });
  getContentText(a.doc, 'move-me').insert(0, 'edited while being moved: ');

  await waitFor(() => snapshot(a.doc).join('|') === snapshot(b.doc).join('|') && snapshot(a.doc).length === 4 + 10 + 1 - 1);

  const nodes = listNodes(a.doc);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  expect(nodes.map((n) => n.id).sort()).toEqual(
    ['src', 'rename-me', 'move-me', 'in-src', ...[0, 1, 2, 3, 4].flatMap((i) => [`a${i}`, `b${i}`])].sort(),
  );
  expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length); // no duplicates
  expect(byId.has('old')).toBe(false); // the delete took effect
  expect(byId.get('rename-me')!.name).toBe('after.py');
  expect(byId.get('move-me')!.parentId).toBe('src');
  expect(getFileText(b.doc, 'move-me')).toBe('edited while being moved: m'); // the text edit survived the move
  for (const i of [0, 1, 2, 3, 4]) {
    expect(getFileText(b.doc, `a${i}`)).toBe(`a${i}`);
    expect(getFileText(a.doc, `b${i}`)).toBe(`b${i}`);
  }
}

describe('two headless clients editing the file tree concurrently', () => {
  it('on one collab server', async () => {
    const roomId = randomRoomId();
    const server = await startServer({ access: accessFor(roomId) });
    await runConcurrentTreeEdits(server, server, roomId);
  });

  it.skipIf(!redisAvailable)('across two collab replicas', async () => {
    const roomId = randomRoomId();
    const access = accessFor(roomId);
    const one = await startServer({ access, redisUrl: REDIS_URL });
    const two = await startServer({ access, redisUrl: REDIS_URL });
    await runConcurrentTreeEdits(one, two, roomId);
  });
});
