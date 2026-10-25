import { createNode, getContentText, type LegacyFile } from '@synapse/room-doc';
import { createRedisClient } from '@synapse/redis';
import type { Server } from '@hocuspocus/server';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MemoryDocStore } from '@synapse/ydoc-store';
import type { LegacyRooms } from './legacyRooms.js';
import type { CollabContext } from './server.js';
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

async function getFiles(server: Server<CollabContext>, roomId: string, token?: string, query = '') {
  const res = await fetch(`${server.webSocketURL.replace(/^ws/, 'http')}/rooms/${roomId}/files${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: (await res.json()) as any };
}

/** A tiny stand-in for Redis: values with an expiry. */
function fakeCache() {
  const values = new Map<string, { value: string; until: number }>();
  const calls = { get: 0, set: 0 };
  return {
    calls,
    client: {
      get: async (key: string) => {
        calls.get++;
        const hit = values.get(key);
        return hit && hit.until > Date.now() ? hit.value : null;
      },
      set: async (key: string, value: string, _mode: 'PX', ms: number) => {
        calls.set++;
        values.set(key, { value, until: Date.now() + ms });
        return 'OK' as const;
      },
      disconnect: () => undefined,
    },
  };
}

async function roomWith(roomId: string, server: Server<CollabContext>, content: string) {
  const ada = connect(server, roomId, tokenFor('ada'));
  await ada.synced;
  createNode(ada.doc, { id: 'main', name: 'main.py', type: 'file', content });
  await waitFor(() => ada.provider.unsyncedChanges === 0);
  return ada;
}

describe('GET /rooms/:id/files', () => {
  it('refuses a request without a valid token, from a non-member, or for an unknown room', async () => {
    const roomId = randomRoomId();
    const server = await startServer({ access: accessFor(roomId) });
    expect((await getFiles(server, roomId)).status).toBe(401);
    expect((await getFiles(server, roomId, 'not-a-token')).status).toBe(401);
    expect((await getFiles(server, roomId, tokenFor('eve'))).status).toBe(403);
    expect((await getFiles(server, 'NOSUCHROOM', tokenFor('ada'))).status).toBe(404);
    expect((await getFiles(server, roomId, tokenFor('bob'))).status).toBe(200);
  });

  it('returns the live text, including what has not been saved yet', async () => {
    const roomId = randomRoomId();
    // Saving waits 10 s here, so anything the endpoint returns came from the live document.
    const server = await startServer({ access: accessFor(roomId), storeDebounceMs: 10_000 });
    const ada = await roomWith(roomId, server, 'print(1)');
    getContentText(ada.doc, 'main').insert(8, '\nprint(2)');
    await waitFor(() => ada.provider.unsyncedChanges === 0);

    const { status, body } = await getFiles(server, roomId, tokenFor('bob'));
    expect(status).toBe(200);
    expect(body.source).toBe('live');
    expect(body.files).toEqual([{ id: 'main', name: 'main.py', path: 'main.py', content: 'print(1)\nprint(2)' }]);
    expect(body.content).toBe('--- main.py ---\nprint(1)\nprint(2)');
  });

  it('reads a room nobody has open from its stored state, then lets it unload', async () => {
    const roomId = randomRoomId();
    const store = new MemoryDocStore();
    const server = await startServer({ access: accessFor(roomId), store, storeDebounceMs: 20 });
    const ada = await roomWith(roomId, server, 'saved text');
    await waitFor(async () => (await store.load(roomId)) !== null);
    ada.provider.destroy();
    await waitFor(() => server.hocuspocus.getDocumentsCount() === 0);

    const { body } = await getFiles(server, roomId, tokenFor('ada'));
    expect(body.files.map((f: { content: string }) => f.content)).toEqual(['saved text']);
    await waitFor(() => server.hocuspocus.getDocumentsCount() === 0); // the read did not keep it loaded
  });

  it('does not turn a legacy room into a collab room by reading it', async () => {
    const roomId = randomRoomId();
    const legacyFiles: LegacyFile[] = [{ id: 'welcome-py', name: 'main.py', content: 'legacy text', updatedAt: 1 }];
    const legacy: LegacyRooms & { calls: number } = { calls: 0, loadFiles: async () => (legacy.calls++, legacyFiles) };
    // Like the Mongo store, this one does not persist a document that has nothing in it.
    const store = new (class extends MemoryDocStore {
      override async store(room: string, document: Y.Doc) {
        if (Y.encodeStateAsUpdate(document).length > 2) await super.store(room, document);
      }
    })();
    const server = await startServer({ access: accessFor(roomId), legacy, store });

    const { body } = await getFiles(server, roomId, tokenFor('ada'));
    expect(body.files).toEqual([]); // the caller falls back to what the client has
    expect(legacy.calls).toBe(0);

    // A real client opening the room still seeds it.
    const ada = connect(server, roomId, tokenFor('ada'));
    await ada.synced;
    expect(legacy.calls).toBe(1);
    expect(getContentText(ada.doc, 'welcome-py').toString()).toBe('legacy text');
  });

  it('reuses a recent projection and skips it when asked for a fresh one', async () => {
    const roomId = randomRoomId();
    const cache = fakeCache();
    const server = await startServer({ access: accessFor(roomId), projection: { client: cache.client, cacheMs: 60_000 } });
    const ada = await roomWith(roomId, server, 'v1');

    const first = await getFiles(server, roomId, tokenFor('bob'));
    expect(first.body.source).toBe('live');

    getContentText(ada.doc, 'main').insert(2, '-edited');
    await waitFor(() => ada.provider.unsyncedChanges === 0);

    const second = await getFiles(server, roomId, tokenFor('bob'));
    expect(second.body.source).toBe('cache');
    expect(second.body.files[0].content).toBe('v1'); // up to 5 s old by design

    const fresh = await getFiles(server, roomId, tokenFor('bob'), '?fresh=1');
    expect(fresh.body.source).toBe('live');
    expect(fresh.body.files[0].content).toBe('v1-edited');

    // The fresh read replaced the cached copy for the next caller.
    expect((await getFiles(server, roomId, tokenFor('bob'))).body.files[0].content).toBe('v1-edited');
  });

  it('checks membership before looking at the cache', async () => {
    const roomId = randomRoomId();
    const cache = fakeCache();
    const server = await startServer({ access: accessFor(roomId), projection: { client: cache.client, cacheMs: 60_000 } });
    await roomWith(roomId, server, 'private');
    await getFiles(server, roomId, tokenFor('bob')); // fills the cache

    const { status, body } = await getFiles(server, roomId, tokenFor('eve'));
    expect(status).toBe(403);
    expect(JSON.stringify(body)).not.toContain('private');
  });

  it('still answers when the cache is broken', async () => {
    const roomId = randomRoomId();
    const broken = {
      get: async () => {
        throw new Error('redis down');
      },
      set: async () => {
        throw new Error('redis down');
      },
      disconnect: () => undefined,
    } as never;
    const server = await startServer({ access: accessFor(roomId), projection: { client: broken } });
    await roomWith(roomId, server, 'still here');
    const { status, body } = await getFiles(server, roomId, tokenFor('ada'));
    expect(status).toBe(200);
    expect(body.files[0].content).toBe('still here');
  });

  it.skipIf(!redisAvailable)('reads the live text through a replica that does not have the room open', async () => {
    const roomId = randomRoomId();
    const access = accessFor(roomId);
    const [one, two] = await Promise.all([
      startServer({ access, redisUrl: REDIS_URL, store: new MemoryDocStore(), storeDebounceMs: 10_000, projection: { syncWaitMs: 400 } }),
      startServer({ access, redisUrl: REDIS_URL, store: new MemoryDocStore(), storeDebounceMs: 10_000, projection: { syncWaitMs: 400 } }),
    ]);
    // The editor is on replica one, which has not saved anything; replica two has never seen the room.
    const ada = await roomWith(roomId, one, 'typed on replica one');
    expect(two.hocuspocus.documents.size).toBe(0);

    const { body } = await getFiles(two, roomId, tokenFor('bob'), '?fresh=1');
    expect(body.files.map((f: { content: string }) => f.content)).toEqual(['typed on replica one']);
    ada.provider.destroy();
  });
});
