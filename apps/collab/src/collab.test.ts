import { createRedisClient } from '@synapse/redis';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryDocStore } from './docStore.js';
import { closeAll, connect, fakeAccess, randomRoomId, startServer, tokenFor, waitFor } from './testUtils.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// The multi-replica test needs a real Redis; it is skipped (not failed) without one.
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

describe('authentication and room access', () => {
  it('lets a member in and syncs their document', async () => {
    const roomId = randomRoomId();
    const server = await startServer({ access: fakeAccess({ [roomId]: { createdBy: 'ada', members: [{ userId: 'ada' }] } }) });
    const client = connect(server, roomId, tokenFor('ada'));
    await client.synced;
    expect(client.provider.isAuthenticated).toBe(true);
  });

  it('rejects a token for a user who is not a member', async () => {
    const roomId = randomRoomId();
    const server = await startServer({ access: fakeAccess({ [roomId]: { createdBy: 'ada', members: [{ userId: 'ada' }] } }) });
    const client = connect(server, roomId, tokenFor('mallory'));
    expect(await client.denied).toBe('You are not a member of this room.');
  });

  it('rejects a missing token, a forged token and an unknown room', async () => {
    const roomId = randomRoomId();
    const server = await startServer({ access: fakeAccess({ [roomId]: { createdBy: 'ada', members: [{ userId: 'ada' }] } }) });

    expect(await connect(server, roomId).denied).toBe('Authentication required.');
    expect(await connect(server, roomId, jwt.sign({ userId: 'ada' }, 'wrong-secret-wrong-secret-1234')).denied).toBe('Invalid or expired token.');
    expect(await connect(server, 'NOSUCHROOM', tokenFor('ada')).denied).toBe('Room not found.');
  });

  it('rejects a non-canonical document name so one room cannot become two documents', async () => {
    const roomId = randomRoomId();
    const server = await startServer({ access: fakeAccess({ [roomId]: { createdBy: 'ada', members: [{ userId: 'ada' }] } }) });
    const client = connect(server, roomId, tokenFor('ada'), `room:${roomId.toLowerCase()}`);
    expect(await client.denied).toBe('Unknown document.');
  });

  it('fails closed when the access check throws', async () => {
    const server = await startServer({
      access: {
        check: async () => {
          throw new Error('mongo down');
        },
      },
    });
    const client = connect(server, randomRoomId(), tokenFor('ada'));
    expect(await client.denied).toBe('Could not verify room access. Try again.');
  });
});

describe('document sync and persistence', () => {
  it('converges two members editing the same room', async () => {
    const roomId = randomRoomId();
    const members = [{ userId: 'ada' }, { userId: 'bob' }];
    const server = await startServer({ access: fakeAccess({ [roomId]: { createdBy: 'ada', members } }) });
    const a = connect(server, roomId, tokenFor('ada'));
    const b = connect(server, roomId, tokenFor('bob'));
    await Promise.all([a.synced, b.synced]);

    a.doc.getText('content:main').insert(0, 'hello ');
    b.doc.getText('content:main').insert(0, 'world');
    await waitFor(() => a.doc.getText('content:main').toString() === b.doc.getText('content:main').toString());
    expect(a.doc.getText('content:main').toString()).toHaveLength('hello world'.length);
  });

  it('stores the document so a later session sees it', async () => {
    const roomId = randomRoomId();
    const store = new MemoryDocStore();
    const server = await startServer({ store, access: fakeAccess({ [roomId]: { createdBy: 'ada', members: [{ userId: 'ada' }] } }) });

    const first = connect(server, roomId, tokenFor('ada'));
    await first.synced;
    first.doc.getText('content:main').insert(0, 'persist me');
    await waitFor(() => first.provider.unsyncedChanges === 0);
    first.provider.destroy();
    await waitFor(() => server.hocuspocus.getDocumentsCount() === 0);

    const second = connect(server, roomId, tokenFor('ada'));
    await second.synced;
    expect(second.doc.getText('content:main').toString()).toBe('persist me');
  });
});

describe('health endpoint', () => {
  it('reports status without a Redis dependency', async () => {
    const server = await startServer({ access: fakeAccess({}) });
    const res = await fetch(`${server.httpURL}/health`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: 'ok', service: 'collab', redis: { status: 'disabled' } });
  });
});

describe.skipIf(!redisAvailable)('two replicas behind Redis', () => {
  it('shares one document between clients connected to different instances', async () => {
    const roomId = randomRoomId();
    const access = fakeAccess({ [roomId]: { createdBy: 'ada', members: [{ userId: 'ada' }, { userId: 'bob' }] } });
    const replicaOne = await startServer({ access, redisUrl: REDIS_URL });
    const replicaTwo = await startServer({ access, redisUrl: REDIS_URL });

    const a = connect(replicaOne, roomId, tokenFor('ada'));
    const b = connect(replicaTwo, roomId, tokenFor('bob'));
    await Promise.all([a.synced, b.synced]);

    a.doc.getText('content:main').insert(0, 'from replica one');
    await waitFor(() => b.doc.getText('content:main').toString() === 'from replica one');

    b.doc.getText('content:main').insert(0, '>> ');
    await waitFor(() => a.doc.getText('content:main').toString() === '>> from replica one');

    const health = await (await fetch(`${replicaOne.httpURL}/health`)).json();
    expect(health.redis.status).toBe('ok');
  });
});
