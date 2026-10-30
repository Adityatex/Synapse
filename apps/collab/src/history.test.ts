import { createNode, deleteNode, getContentText } from '@synapse/room-doc';
import { createRedisClient } from '@synapse/redis';
import { MemoryDocStore } from '@synapse/ydoc-store';
import type { Server } from '@hocuspocus/server';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { replaceText } from './history.js';
import type { RoomAccessRecord } from './roomAccess.js';
import type { CollabContext } from './server.js';
import { closeAll, connect, fakeAccess, randomRoomId, startServer, tokenFor, waitFor, type Client } from './testUtils.js';

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

const FAST = { ttlMs: 30_000, tickMs: 80, settingsCacheMs: 10, locksCacheMs: 10 };
const textOf = (client: Client, fileId = 'main') => getContentText(client.doc, fileId).toString();
const append = (client: Client, text: string, fileId = 'main') => getContentText(client.doc, fileId).insert(getContentText(client.doc, fileId).length, text);
const send = (client: Client, message: object) => client.provider.sendStateless(JSON.stringify(message));

const http = (server: Server<CollabContext>) => server.webSocketURL.replace(/^ws/, 'http');
async function call(server: Server<CollabContext>, method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${http(server)}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
}

/** A room whose file `main` went through versions "one", "one two" and "one two three", one snapshot each. */
async function roomWithVersions(options: { locksEnabled?: boolean } = {}) {
  const roomId = randomRoomId();
  const record: RoomAccessRecord = { createdBy: 'ada', members: [{ userId: 'ada' }, { userId: 'bob' }], locksEnabled: options.locksEnabled ?? false };
  const store = new MemoryDocStore();
  const server = await startServer({ access: fakeAccess({ [roomId]: record }), store, storeDebounceMs: 20, locks: FAST });
  const ada = connect(server, roomId, tokenFor('ada'));
  await ada.synced;
  createNode(ada.doc, { id: 'main', name: 'main.py', type: 'file', content: 'one' });

  const stored = async (expected: string) => {
    await waitFor(async () => {
      const state = await store.load(roomId);
      if (!state) return false;
      const doc = new Y.Doc();
      Y.applyUpdate(doc, state);
      return doc.getText('content:main').toString() === expected;
    });
    await store.writeSnapshot(roomId);
  };
  await stored('one');
  append(ada, ' two');
  await stored('one two');
  append(ada, ' three');
  await stored('one two three');

  const [newest, middle, oldest] = await store.listSnapshots(roomId, 10);
  return { roomId, server, store, ada, record, seqs: { oldest: oldest.seq, middle: middle.seq, newest: newest.seq } };
}

describe('GET /rooms/:id/history', () => {
  it('lists a file’s versions newest first, each with its time and size', async () => {
    const { roomId, server, seqs } = await roomWithVersions();
    const { status, body } = await call(server, 'GET', `/rooms/${roomId}/history?fileId=main`, tokenFor('bob'));
    expect(status).toBe(200);
    expect(body.versions.map((v: any) => v.seq)).toEqual([seqs.newest, seqs.middle, seqs.oldest]);
    expect(body.versions.map((v: any) => v.chars)).toEqual(['one two three'.length, 'one two'.length, 'one'.length]);
    expect(body.versions.every((v: any) => v.kind === 'auto' && !Number.isNaN(Date.parse(v.at)))).toBe(true);
  });

  it('leaves out versions where the file did not change, and snapshots from before it existed', async () => {
    const { roomId, server, store, ada, seqs } = await roomWithVersions();
    // A snapshot in which only another file changed adds nothing to main's history.
    createNode(ada.doc, { id: 'other', name: 'other.py', type: 'file', content: 'x' });
    await waitFor(async () => (await store.writeSnapshot(roomId)) !== null);

    const { body } = await call(server, 'GET', `/rooms/${roomId}/history?fileId=main`, tokenFor('ada'));
    expect(body.versions.map((v: any) => v.seq)).toEqual([seqs.newest, seqs.middle, seqs.oldest]);
    const other = await call(server, 'GET', `/rooms/${roomId}/history?fileId=other`, tokenFor('ada'));
    expect(other.body.versions).toHaveLength(1); // it exists in the newest snapshot only
    expect((await call(server, 'GET', `/rooms/${roomId}/history?fileId=nothing`, tokenFor('ada'))).body.versions).toEqual([]);
  });

  it('limits the list', async () => {
    const { roomId, server } = await roomWithVersions();
    const { body } = await call(server, 'GET', `/rooms/${roomId}/history?fileId=main&limit=2`, tokenFor('ada'));
    expect(body.versions).toHaveLength(2);
  });

  it('refuses without a token, to a stranger, for an unknown room, and without a fileId', async () => {
    const { roomId, server } = await roomWithVersions();
    expect((await call(server, 'GET', `/rooms/${roomId}/history?fileId=main`)).status).toBe(401);
    expect((await call(server, 'GET', `/rooms/${roomId}/history?fileId=main`, tokenFor('eve'))).status).toBe(403);
    expect((await call(server, 'GET', `/rooms/NOSUCH1/history?fileId=main`, tokenFor('ada'))).status).toBe(404);
    expect((await call(server, 'GET', `/rooms/${roomId}/history`, tokenFor('ada'))).status).toBe(400);
    expect((await call(server, 'POST', `/rooms/${roomId}/history?fileId=main`, tokenFor('ada'), {})).status).toBe(405);
  });
});

describe('GET /rooms/:id/history/:seq', () => {
  it('returns the file as it was in that version', async () => {
    const { roomId, server, seqs } = await roomWithVersions();
    const { status, body } = await call(server, 'GET', `/rooms/${roomId}/history/${seqs.middle}?fileId=main`, tokenFor('bob'));
    expect(status).toBe(200);
    expect(body.version).toMatchObject({ seq: seqs.middle, kind: 'auto', name: 'main.py', content: 'one two' });
  });

  it('says so when the version or the file in it does not exist', async () => {
    const { roomId, server, ada, store, seqs } = await roomWithVersions();
    expect((await call(server, 'GET', `/rooms/${roomId}/history/9999?fileId=main`, tokenFor('ada'))).body.code).toBe('version-not-found');
    expect((await call(server, 'GET', `/rooms/${roomId}/history/${seqs.oldest}?fileId=later`, tokenFor('ada'))).body.code).toBe('file-not-in-version');
    createNode(ada.doc, { id: 'later', name: 'later.py', type: 'file', content: 'y' });
    await waitFor(async () => (await store.writeSnapshot(roomId)) !== null);
    const res = await call(server, 'GET', `/rooms/${roomId}/history/${seqs.oldest}?fileId=later`, tokenFor('ada'));
    expect(res.status).toBe(404);
  });
});

describe('POST /rooms/:id/history/:seq/restore', () => {
  it('puts the old text back for everyone connected, and records the restore with who did it', async () => {
    const { roomId, server, ada, seqs } = await roomWithVersions();
    const bob = connect(server, roomId, tokenFor('bob'));
    await bob.synced;
    expect(textOf(bob)).toBe('one two three');

    const { status, body } = await call(server, 'POST', `/rooms/${roomId}/history/${seqs.middle}/restore`, tokenFor('bob'), { fileId: 'main' });
    expect(status).toBe(200);
    expect(body).toMatchObject({ changed: true });
    await waitFor(() => textOf(ada) === 'one two' && textOf(bob) === 'one two');

    const history = await call(server, 'GET', `/rooms/${roomId}/history?fileId=main`, tokenFor('ada'));
    // Newest first: the restore itself, then the three versions that were there. The room had just been
    // snapshotted, so the newest of those already is the state before the restore: no extra restore point.
    expect(history.body.versions.map((v: any) => v.kind)).toEqual(['restore', 'auto', 'auto', 'auto']);
    const [restore] = history.body.versions;
    expect(restore).toMatchObject({ seq: body.seq, by: { userId: 'bob', name: 'bob' }, fromSeq: seqs.middle });

    // History is not rewritten: the version before the restore is still there, and the restore is a version of its own.
    const before = await call(server, 'GET', `/rooms/${roomId}/history/${seqs.newest}?fileId=main`, tokenFor('ada'));
    expect(before.body.version.content).toBe('one two three');
    const after = await call(server, 'GET', `/rooms/${roomId}/history/${restore.seq}?fileId=main`, tokenFor('ada'));
    expect(after.body.version.content).toBe('one two');
  });

  it('first saves what was typed since the last snapshot as a restore point, so nothing is lost by restoring', async () => {
    const { roomId, server, store, ada, seqs } = await roomWithVersions();
    append(ada, ' four'); // typed after the last snapshot, so in no version yet
    await waitFor(async () => {
      const state = await store.load(roomId);
      const doc = new Y.Doc();
      if (state) Y.applyUpdate(doc, state);
      return doc.getText('content:main').toString() === 'one two three four';
    });

    await call(server, 'POST', `/rooms/${roomId}/history/${seqs.oldest}/restore`, tokenFor('ada'), { fileId: 'main' });
    await waitFor(() => textOf(ada) === 'one');

    const list = await call(server, 'GET', `/rooms/${roomId}/history?fileId=main`, tokenFor('ada'));
    expect(list.body.versions.map((v: any) => v.kind)).toEqual(['restore', 'restore-point', 'auto', 'auto', 'auto']);
    const point = list.body.versions[1];
    expect(point.by.userId).toBe('ada');
    const saved = await call(server, 'GET', `/rooms/${roomId}/history/${point.seq}?fileId=main`, tokenFor('ada'));
    expect(saved.body.version.content).toBe('one two three four');

    // And the restore can be undone from there.
    await call(server, 'POST', `/rooms/${roomId}/history/${point.seq}/restore`, tokenFor('ada'), { fileId: 'main' });
    await waitFor(() => textOf(ada) === 'one two three four');
  });

  it('can be undone from the history', async () => {
    const { roomId, server, ada, seqs } = await roomWithVersions();
    await call(server, 'POST', `/rooms/${roomId}/history/${seqs.oldest}/restore`, tokenFor('ada'), { fileId: 'main' });
    await waitFor(() => textOf(ada) === 'one');
    await call(server, 'POST', `/rooms/${roomId}/history/${seqs.newest}/restore`, tokenFor('ada'), { fileId: 'main' });
    await waitFor(() => textOf(ada) === 'one two three');
  });

  it('does nothing, and adds nothing to the history, when the file already has that text', async () => {
    const { roomId, server, seqs } = await roomWithVersions();
    const { body } = await call(server, 'POST', `/rooms/${roomId}/history/${seqs.newest}/restore`, tokenFor('ada'), { fileId: 'main' });
    expect(body).toEqual({ roomId, fileId: 'main', changed: false });
    const list = await call(server, 'GET', `/rooms/${roomId}/history?fileId=main`, tokenFor('ada'));
    expect(list.body.versions).toHaveLength(3);
  });

  it('restores a room nobody has open, from what is stored, and the work is saved', async () => {
    const { roomId, server, store, ada, seqs } = await roomWithVersions();
    ada.provider.destroy();
    await waitFor(async () => server.hocuspocus.getConnectionsCount() === 0);

    const { status } = await call(server, 'POST', `/rooms/${roomId}/history/${seqs.oldest}/restore`, tokenFor('bob'), { fileId: 'main' });
    expect(status).toBe(200);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, (await store.load(roomId))!);
    expect(doc.getText('content:main').toString()).toBe('one');

    const later = connect(server, roomId, tokenFor('ada'));
    await later.synced;
    expect(textOf(later)).toBe('one');
  });

  it('leaves other people’s typing in the rest of the file alone', async () => {
    const roomId = randomRoomId();
    const store = new MemoryDocStore();
    const server = await startServer({ access: fakeAccess({ [roomId]: { createdBy: 'ada', members: [{ userId: 'ada' }, { userId: 'bob' }] } }), store, storeDebounceMs: 20 });
    const ada = connect(server, roomId, tokenFor('ada'));
    await ada.synced;
    createNode(ada.doc, { id: 'main', name: 'main.py', type: 'file', content: 'head\nbody\ntail\n' });
    await waitFor(async () => (await store.load(roomId)) !== null);
    await store.writeSnapshot(roomId);
    const [{ seq }] = await store.listSnapshots(roomId, 1);

    // Later, the middle line changes and a line is added at the end.
    const text = getContentText(ada.doc, 'main');
    text.delete(5, 4);
    text.insert(5, 'BODY');
    text.insert(text.length, 'more\n');
    await waitFor(async () => (await store.writeSnapshot(roomId)) !== null);

    await call(server, 'POST', `/rooms/${roomId}/history/${seq}/restore`, tokenFor('ada'), { fileId: 'main' });
    await waitFor(() => textOf(ada) === 'head\nbody\ntail\n');
  });

  it('refuses a file someone else has locked, and allows the holder', async () => {
    const { roomId, server, ada, seqs } = await roomWithVersions({ locksEnabled: true });
    const bob = connect(server, roomId, tokenFor('bob'));
    await bob.synced;
    send(bob, { type: 'locks.acquire', fileId: 'main' });
    await waitFor(() => bob.messages.some((m) => m.type === 'locks.snapshot' && m.locks?.main?.userId === 'bob'));

    const refused = await call(server, 'POST', `/rooms/${roomId}/history/${seqs.oldest}/restore`, tokenFor('ada'), { fileId: 'main' });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'locked', holder: { userId: 'bob' } });
    expect(textOf(ada)).toBe('one two three');

    const allowed = await call(server, 'POST', `/rooms/${roomId}/history/${seqs.oldest}/restore`, tokenFor('bob'), { fileId: 'main' });
    expect(allowed.status).toBe(200);
    await waitFor(() => textOf(ada) === 'one');
  });

  it('refuses a file that has since been deleted, a stranger, and a request with no fileId', async () => {
    const { roomId, server, ada, seqs } = await roomWithVersions();
    expect((await call(server, 'POST', `/rooms/${roomId}/history/${seqs.oldest}/restore`, tokenFor('eve'), { fileId: 'main' })).status).toBe(403);
    expect((await call(server, 'POST', `/rooms/${roomId}/history/${seqs.oldest}/restore`, tokenFor('ada'), {})).status).toBe(400);
    expect((await call(server, 'GET', `/rooms/${roomId}/history/${seqs.oldest}/restore?fileId=main`, tokenFor('ada'))).status).toBe(405);

    deleteNode(ada.doc, 'main');
    const res = await call(server, 'POST', `/rooms/${roomId}/history/${seqs.oldest}/restore`, tokenFor('ada'), { fileId: 'main' });
    expect(res).toMatchObject({ status: 409, body: { code: 'file-deleted' } });
  });
});

describe.skipIf(!redisAvailable)('restore across replicas (Redis)', () => {
  it('reaches people connected to another replica, whichever replica took the request', async () => {
    const roomId = randomRoomId();
    const store = new MemoryDocStore(); // shared, like Mongo
    const access = fakeAccess({ [roomId]: { createdBy: 'ada', members: [{ userId: 'ada' }, { userId: 'bob' }] } });
    const one = await startServer({ access, store, redisUrl: REDIS_URL, storeDebounceMs: 20 });
    const two = await startServer({ access, store, redisUrl: REDIS_URL, storeDebounceMs: 20 });
    const ada = connect(one, roomId, tokenFor('ada'));
    const bob = connect(two, roomId, tokenFor('bob'));
    await Promise.all([ada.synced, bob.synced]);
    createNode(ada.doc, { id: 'main', name: 'main.py', type: 'file', content: 'one' });
    await waitFor(() => textOf(bob) === 'one');
    await waitFor(async () => (await store.writeSnapshot(roomId)) !== null);
    append(ada, ' two');
    await waitFor(() => textOf(bob) === 'one two');
    await waitFor(async () => (await store.writeSnapshot(roomId)) !== null);
    const versions = (await call(one, 'GET', `/rooms/${roomId}/history?fileId=main`, tokenFor('ada'))).body.versions;
    const oldest = versions[versions.length - 1].seq;

    // The request lands on the replica where only ada is connected; bob is on the other one.
    const res = await call(one, 'POST', `/rooms/${roomId}/history/${oldest}/restore`, tokenFor('ada'), { fileId: 'main' });
    expect(res.body.changed).toBe(true);
    await waitFor(() => textOf(ada) === 'one' && textOf(bob) === 'one');
  });
});

describe('replaceText', () => {
  it('makes the text read the new string, changing only the span that differs', () => {
    const doc = new Y.Doc();
    const text = doc.getText('t');
    text.insert(0, 'the quick brown fox');
    const changes: Array<{ insert?: unknown; delete?: number; retain?: number }> = [];
    text.observe((event) => changes.push(...event.delta));
    replaceText(text, 'the slow brown fox');
    expect(text.toString()).toBe('the slow brown fox');
    expect(changes).toEqual([{ retain: 4 }, { delete: 5 }, { insert: 'slow' }]);
  });

  it('handles empty strings, appends, deletions and identical text', () => {
    const run = (from: string, to: string) => {
      const text = new Y.Doc().getText('t');
      text.insert(0, from);
      replaceText(text, to);
      return text.toString();
    };
    expect(run('', 'new')).toBe('new');
    expect(run('old', '')).toBe('');
    expect(run('abc', 'abcdef')).toBe('abcdef');
    expect(run('abcdef', 'abc')).toBe('abc');
    expect(run('same', 'same')).toBe('same');
    expect(run('aaaa', 'aa')).toBe('aa');
    expect(run('a😀b', 'a😀😀b')).toBe('a😀😀b');
  });

  it('is right for any pair of strings', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const alphabet = ['a', 'b', '\n', '😀', '😁'];
    const word = () => Array.from({ length: Math.floor(rand() * 12) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join('');
    for (let i = 0; i < 300; i += 1) {
      const [from, to] = [word(), word()];
      const text = new Y.Doc().getText('t');
      text.insert(0, from);
      replaceText(text, to);
      expect(text.toString()).toBe(to);
    }
  });
});
