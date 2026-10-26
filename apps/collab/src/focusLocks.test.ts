import { createNode, getContentText, listNodes } from '@synapse/room-doc';
import { createRedisClient } from '@synapse/redis';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoomAccessRecord } from './roomAccess.js';
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

// Quick propagation, but long-lived locks: a test that is slow on a busy machine must not lose its lock.
const FAST = { ttlMs: 30_000, tickMs: 80, settingsCacheMs: 30, locksCacheMs: 10 };
// For the two tests about expiry itself.
const SHORT_LIVED = { ...FAST, ttlMs: 800 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const send = (client: Client, message: object) => client.provider.sendStateless(JSON.stringify(message));
const lastSnapshot = (client: Client) => [...client.messages].reverse().find((m) => m.type === 'locks.snapshot');
const holderOf = (client: Client, fileId: string) => lastSnapshot(client)?.locks?.[fileId]?.userId;
const received = (client: Client, type: string) => client.messages.filter((m) => m.type === type);
const text = (client: Client, fileId: string) => getContentText(client.doc, fileId).toString();

/** A room of two members with files `a` and `b`, both connected and in sync. */
async function setup(options: { locksEnabled?: boolean; redis?: boolean; locks?: typeof FAST } = {}) {
  const roomId = randomRoomId();
  const record: RoomAccessRecord = {
    createdBy: 'ada',
    members: [{ userId: 'ada' }, { userId: 'bob' }],
    locksEnabled: options.locksEnabled ?? true,
  };
  const access = fakeAccess({ [roomId]: record });
  const locks = options.locks ?? FAST;
  const servers = options.redis
    ? [await startServer({ access, redisUrl: REDIS_URL, locks }), await startServer({ access, redisUrl: REDIS_URL, locks })]
    : [await startServer({ access, locks })];

  const ada = connect(servers[0], roomId, tokenFor('ada'));
  const bob = connect(servers[servers.length - 1], roomId, tokenFor('bob'));
  await Promise.all([ada.synced, bob.synced]);
  createNode(ada.doc, { id: 'a', name: 'a.py', type: 'file' });
  createNode(ada.doc, { id: 'b', name: 'b.py', type: 'file' });
  await waitFor(() => listNodes(bob.doc).length === 2);
  return { roomId, record, servers, ada, bob };
}

describe('focus locks', () => {
  it('tells a new connection the lock state, and that locks are on', async () => {
    const { ada } = await setup();
    await waitFor(() => lastSnapshot(ada) !== undefined);
    expect(lastSnapshot(ada)).toMatchObject({ enabled: true, locks: {} });
  });

  it('drops a second member’s edits to a locked file and tells them which file', async () => {
    const { roomId, servers, ada, bob } = await setup();
    send(ada, { type: 'locks.acquire', fileId: 'a' });
    await waitFor(() => holderOf(bob, 'a') === 'ada'); // everyone is told

    getContentText(bob.doc, 'a').insert(0, 'BOB');
    await waitFor(() => received(bob, 'locks.rejected').length === 1);
    expect(received(bob, 'locks.rejected')[0]).toMatchObject({ fileIds: ['a'], holders: [{ userId: 'ada', name: 'ada' }] });

    // The holder edits freely, and nothing of Bob's reached the room.
    getContentText(ada.doc, 'a').insert(0, 'ADA');
    const serverDoc = servers[0].hocuspocus.documents.get(`room:${roomId}`)!;
    await waitFor(() => serverDoc.getText('content:a').toString() === 'ADA');
    expect(text(ada, 'a')).toBe('ADA');

    // The connection is not left read-only: the override lasted for that one message.
    expect([...serverDoc.connections.keys()].every((connection) => !connection.readOnly)).toBe(true);
  });

  it('cannot apply anything more from a client whose edit was dropped, so that client must start over', async () => {
    const { roomId, servers, ada, bob } = await setup();
    send(ada, { type: 'locks.acquire', fileId: 'a' });
    await waitFor(() => holderOf(bob, 'a') === 'ada');
    getContentText(bob.doc, 'a').insert(0, 'BOB');
    await waitFor(() => received(bob, 'locks.rejected').length === 1);

    // Yjs applies a client's changes in order, so what Bob types next, even to another file, waits
    // forever behind the dropped edit. The client therefore resets after a rejection (CollabRoom).
    getContentText(bob.doc, 'b').insert(0, 'stuck');
    await sleep(300);
    expect(text(ada, 'b')).toBe('');

    // A fresh start (new document, new client id) works at once, while the lock still stands.
    const bobAgain = connect(servers[0], roomId, tokenFor('bob'));
    await bobAgain.synced;
    getContentText(bobAgain.doc, 'b').insert(0, 'fine');
    await waitFor(() => text(ada, 'b') === 'fine');
    getContentText(bobAgain.doc, 'a').insert(0, 'still no');
    await waitFor(() => received(bobAgain, 'locks.rejected').length === 1);
  });

  it('refuses a lock that is held, one on a file that does not exist, and one when locks are off', async () => {
    const { record, ada, bob } = await setup();
    send(ada, { type: 'locks.acquire', fileId: 'a' });
    await waitFor(() => holderOf(bob, 'a') === 'ada');

    send(bob, { type: 'locks.acquire', fileId: 'a' });
    await waitFor(() => received(bob, 'locks.denied').length === 1);
    expect(received(bob, 'locks.denied')[0]).toMatchObject({ fileId: 'a', reason: 'held', holder: { userId: 'ada' } });

    send(bob, { type: 'locks.acquire', fileId: 'no-such-file' });
    await waitFor(() => received(bob, 'locks.denied').length === 2);
    expect(received(bob, 'locks.denied')[1]).toMatchObject({ reason: 'unknown-file' });

    record.locksEnabled = false;
    await sleep(100);
    send(bob, { type: 'locks.acquire', fileId: 'b' });
    await waitFor(() => received(bob, 'locks.denied').length === 3);
    expect(received(bob, 'locks.denied')[2]).toMatchObject({ fileId: 'b', reason: 'disabled' });
  });

  it('does not restrict anyone while the room has locks off, even if a lock exists', async () => {
    const { record, ada, bob } = await setup();
    send(ada, { type: 'locks.acquire', fileId: 'a' });
    await waitFor(() => holderOf(bob, 'a') === 'ada');

    record.locksEnabled = false;
    // The switch is announced to clients (they stop showing locks) and enforcement stops.
    await waitFor(() => lastSnapshot(bob)?.enabled === false);
    getContentText(bob.doc, 'a').insert(0, 'bob was here');
    await waitFor(() => text(ada, 'a') === 'bob was here');
    expect(received(bob, 'locks.rejected')).toHaveLength(0);
  });

  it('frees the file when the holder releases it', async () => {
    const { ada, bob } = await setup();
    send(ada, { type: 'locks.acquire', fileId: 'a' });
    await waitFor(() => holderOf(bob, 'a') === 'ada');
    send(ada, { type: 'locks.release', fileId: 'a' });
    await waitFor(() => holderOf(bob, 'a') === undefined);

    getContentText(bob.doc, 'a').insert(0, 'mine now');
    await waitFor(() => text(ada, 'a') === 'mine now');
    expect(received(bob, 'locks.rejected')).toHaveLength(0);
  });

  it('only lets the holder release, and ignores a release for a lock nobody holds', async () => {
    const { ada, bob } = await setup();
    send(ada, { type: 'locks.acquire', fileId: 'a' });
    await waitFor(() => holderOf(bob, 'a') === 'ada');
    send(bob, { type: 'locks.release', fileId: 'a' });
    send(bob, { type: 'locks.release', fileId: 'b' });
    await sleep(250);
    expect(holderOf(bob, 'a')).toBe('ada');
  });

  it('expires a lock 45 s (here 0.8 s) after its last renewal', async () => {
    const { ada, bob } = await setup({ locks: SHORT_LIVED });
    send(ada, { type: 'locks.acquire', fileId: 'a' });
    await waitFor(() => holderOf(bob, 'a') === 'ada');

    await sleep(1300); // never renewed
    await waitFor(() => holderOf(bob, 'a') === undefined); // clients are told it lapsed
    getContentText(bob.doc, 'a').insert(0, 'after expiry');
    await waitFor(() => text(ada, 'a') === 'after expiry');
    expect(received(bob, 'locks.rejected')).toHaveLength(0);

    // The late holder is told it is gone when they try to renew.
    send(ada, { type: 'locks.renew', fileId: 'a' });
    await waitFor(() => received(ada, 'locks.denied').some((m) => m.reason === 'expired'));
  });

  it('keeps a lock for as long as the holder renews it', async () => {
    const { ada, bob } = await setup({ locks: SHORT_LIVED });
    send(ada, { type: 'locks.acquire', fileId: 'a' });
    await waitFor(() => holderOf(bob, 'a') === 'ada');

    for (let i = 0; i < 8; i++) {
      await sleep(150); // 1.2 s in all, past the 0.8 s expiry
      send(ada, { type: 'locks.renew', fileId: 'a' });
    }
    expect(holderOf(bob, 'a')).toBe('ada');
    getContentText(bob.doc, 'a').insert(0, 'nope');
    await waitFor(() => received(bob, 'locks.rejected').length === 1);
  });

  it('releases a member’s locks as soon as their connection closes', async () => {
    const { ada, bob } = await setup();
    send(ada, { type: 'locks.acquire', fileId: 'a' });
    await waitFor(() => holderOf(bob, 'a') === 'ada');

    ada.provider.destroy();
    await waitFor(() => holderOf(bob, 'a') === undefined, 3000); // far sooner than the 30 s expiry
  });

  it('ignores messages that are not lock requests', async () => {
    const { ada, bob } = await setup();
    ada.provider.sendStateless('not json');
    send(ada, { type: 'locks.acquire' }); // no file
    send(ada, { type: 'locks.acquire', fileId: 'x'.repeat(500) });
    send(ada, { type: 'something.else' });
    await sleep(150);
    send(ada, { type: 'locks.acquire', fileId: 'a' });
    await waitFor(() => holderOf(bob, 'a') === 'ada'); // still working
  });

  it.skipIf(!redisAvailable)('enforces a lock taken on one replica against a member connected to another', async () => {
    const { ada, bob } = await setup({ redis: true });
    send(ada, { type: 'locks.acquire', fileId: 'a' });
    await waitFor(() => holderOf(bob, 'a') === 'ada', 5000); // the other replica's clients are told too

    getContentText(bob.doc, 'a').insert(0, 'across replicas');
    await waitFor(() => received(bob, 'locks.rejected').length === 1, 5000);
    expect(text(ada, 'a')).toBe('');

    // And a lock cannot be taken twice by racing replicas.
    send(bob, { type: 'locks.acquire', fileId: 'a' });
    await waitFor(() => received(bob, 'locks.denied').some((m) => m.reason === 'held'), 5000);
  });
});
