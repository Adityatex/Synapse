import { colorForUser } from '@synapse/room-doc';
import { createRedisClient } from '@synapse/redis';
import { afterEach, describe, expect, it } from 'vitest';
import { guardAwareness, type AwarenessUpdate } from './presence.js';
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

type Awareness = NonNullable<Client['provider']['awareness']>;

afterEach(closeAll);

const members = [{ userId: 'ada' }, { userId: 'bob' }];
const accessFor = (roomId: string) => fakeAccess({ [roomId]: { createdBy: 'ada', members } });

/** What the other client currently sees for the person at `source`, found by identity. */
function seenBy(observer: Client, userId: string) {
  const awareness = observer.provider.awareness as Awareness;
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId !== observer.doc.clientID && state.user?.userId === userId) return state;
  }
  return undefined;
}

describe('guardAwareness', () => {
  const ada = { userId: 'ada', name: 'Ada' };
  const adaConnection = {};
  const bobConnection = {};
  const document = (): AwarenessUpdate['document'] => ({
    connections: new Map([
      [adaConnection, { clients: new Set([111]) }],
      [bobConnection, { clients: new Set([222]) }],
    ]),
  });

  it('stamps the verified identity over whatever the client claims', () => {
    const states = new Map<number, Record<string, unknown>>([[111, { user: { userId: 'bob', name: 'Bob' }, fileId: 'main', typing: true }]]);
    guardAwareness({ states, removedClients: new Set(), context: { user: ada }, connection: adaConnection, document: document() });
    expect(states.get(111)).toMatchObject({ user: { userId: 'ada', name: 'Ada', color: colorForUser('ada') }, fileId: 'main', typing: true });
  });

  it("drops a state for another connection's client, and a forged removal of it", () => {
    const states = new Map<number, Record<string, unknown>>([
      [111, { fileId: 'mine' }],
      [222, { fileId: 'forged' }],
    ]);
    const removedClients = new Set([222]);
    guardAwareness({ states, removedClients, context: { user: ada }, connection: adaConnection, document: document() });
    expect([...states.keys()]).toEqual([111]);
    expect(removedClients.size).toBe(0);
  });

  it('lets a client announce a new awareness client id (a reload gets a fresh one)', () => {
    const states = new Map<number, Record<string, unknown>>([[999, { fileId: 'x' }]]);
    guardAwareness({ states, removedClients: new Set(), context: { user: ada }, connection: adaConnection, document: document() });
    expect(states.get(999)).toMatchObject({ user: { userId: 'ada' } });
  });

  it('leaves server-internal updates alone', () => {
    const states = new Map<number, Record<string, unknown>>([[1, { anything: true }]]);
    guardAwareness({ states, removedClients: new Set(), context: undefined, document: document() });
    expect(states.get(1)).toEqual({ anything: true });
  });
});

describe('presence through the collab server', () => {
  it('relays identity, active file and typing, and ignores a claimed identity', async () => {
    const roomId = randomRoomId();
    const server = await startServer({ access: accessFor(roomId) });
    const ada = connect(server, roomId, tokenFor('ada'));
    const bob = connect(server, roomId, tokenFor('bob'));
    await Promise.all([ada.synced, bob.synced]);

    // Ada lies about who she is and sets a field that is not part of presence.
    ada.provider.awareness!.setLocalState({ user: { userId: 'bob', name: 'Not Ada', color: 'red' }, fileId: 'main', typing: true, extra: 1 });

    await waitFor(() => seenBy(bob, 'ada')?.fileId === 'main');
    const seen = seenBy(bob, 'ada');
    expect(seen).toEqual({
      user: { userId: 'ada', name: 'ada', color: colorForUser('ada'), glyph: 'A' },
      fileId: 'main',
      typing: true,
      selection: null,
    });
    expect(seenBy(bob, 'bob')).toBeUndefined(); // she did not become Bob

    ada.provider.awareness!.setLocalStateField('typing', false);
    await waitFor(() => seenBy(bob, 'ada')?.typing === false);
  });

  it('removes a person from everyone else when they disconnect', async () => {
    const roomId = randomRoomId();
    const server = await startServer({ access: accessFor(roomId) });
    const ada = connect(server, roomId, tokenFor('ada'));
    const bob = connect(server, roomId, tokenFor('bob'));
    await Promise.all([ada.synced, bob.synced]);
    ada.provider.awareness!.setLocalStateField('fileId', 'main');
    await waitFor(() => seenBy(bob, 'ada') !== undefined);

    ada.provider.destroy();
    await waitFor(() => seenBy(bob, 'ada') === undefined);
  });

  it.skipIf(!redisAvailable)('shows presence across collab replicas', async () => {
    const roomId = randomRoomId();
    const access = accessFor(roomId);
    const [one, two] = await Promise.all([
      startServer({ access, redisUrl: REDIS_URL }),
      startServer({ access, redisUrl: REDIS_URL }),
    ]);
    const ada = connect(one, roomId, tokenFor('ada'));
    const bob = connect(two, roomId, tokenFor('bob'));
    await Promise.all([ada.synced, bob.synced]);

    ada.provider.awareness!.setLocalStateField('fileId', 'main');
    bob.provider.awareness!.setLocalStateField('typing', true);

    await waitFor(() => seenBy(bob, 'ada')?.fileId === 'main');
    await waitFor(() => seenBy(ada, 'bob')?.typing === true);
    // The replica that relays it has stamped the identity, not just the origin server.
    expect(seenBy(bob, 'ada')?.user).toMatchObject({ userId: 'ada', color: colorForUser('ada') });
  });
});
