import { IncomingMessage } from '@hocuspocus/server';
import { createRedisClient } from '@synapse/redis';
import { afterEach, describe, expect, it } from 'vitest';
import { documentNameFor } from './auth.js';
import { UpdateRedis } from './redisSync.js';
import { closeAll, connect, fakeAccess, randomRoomId, startServer, tokenFor, waitFor } from './testUtils.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// These need a real Redis; they are skipped (not failed) without one.
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

const watchers: Array<{ disconnect(): void }> = [];
afterEach(async () => {
  await closeAll();
  for (const w of watchers.splice(0)) w.disconnect();
});

type Kind = 'step1' | 'step2' | 'update' | 'other';
interface Seen {
  kind: Kind;
  bytes: number;
}

/** Everything replicas publish on a room's channel, classified by its y-protocols message type. */
async function watchChannel(roomId: string): Promise<Seen[]> {
  const seen: Seen[] = [];
  const client = createRedisClient(REDIS_URL, { redis: { enableOfflineQueue: true } });
  watchers.push(client);
  client.on('messageBuffer', (_channel: Buffer, data: Buffer) => {
    const message = new IncomingMessage(data.subarray(1 + data[0]!)); // the sender's identifier comes first
    message.readVarString(); // document name
    const type = message.readVarUint();
    let kind: Kind = 'other';
    if (type === 0 || type === 4) kind = (['step1', 'step2', 'update'] as const)[message.readVarUint()] ?? 'other'; // Sync, SyncReply
    seen.push({ kind, bytes: data.length });
  });
  await client.subscribe(`synapse:hocuspocus:${documentNameFor(roomId)}`);
  return seen;
}

const redisOf = (server: Awaited<ReturnType<typeof startServer>>): UpdateRedis => {
  const ext = server.hocuspocus.configuration.extensions.find((e) => e instanceof UpdateRedis);
  if (!ext) throw new Error('no UpdateRedis extension');
  return ext as UpdateRedis;
};

async function twoReplicas(options: { repairIntervalMs?: number } = {}) {
  const roomId = randomRoomId();
  const access = fakeAccess({ [roomId]: { createdBy: 'ada', members: [{ userId: 'ada' }, { userId: 'bob' }] } });
  const replicaOne = await startServer({ access, redisUrl: REDIS_URL, redisRepairIntervalMs: options.repairIntervalMs ?? 0 });
  const replicaTwo = await startServer({ access, redisUrl: REDIS_URL, redisRepairIntervalMs: options.repairIntervalMs ?? 0 });
  const seen = await watchChannel(roomId);
  const a = connect(replicaOne, roomId, tokenFor('ada'));
  const b = connect(replicaTwo, roomId, tokenFor('bob'));
  await Promise.all([a.synced, b.synced]);
  const textOf = (c: typeof a) => c.doc.getText('content:main');
  return { roomId, replicaOne, replicaTwo, a, b, seen, textOf };
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!redisAvailable)('replicas share changes as updates (P2-13)', () => {
  it('publishes an edit as an update, never as a state vector to be answered', async () => {
    const { a, b, seen, textOf } = await twoReplicas();
    await tick(200); // let the initial sync on load settle
    const from = seen.length;

    for (let i = 0; i < 20; i++) {
      textOf(a).insert(i, String.fromCharCode(97 + i));
      await tick(15);
    }
    await waitFor(() => textOf(b).toString() === 'abcdefghijklmnopqrst');
    await tick(200);

    const after = seen.slice(from).filter((s) => s.kind !== 'other');
    expect(after.filter((s) => s.kind === 'step1')).toEqual([]);
    expect(after.filter((s) => s.kind === 'step2')).toEqual([]);
    expect(after.filter((s) => s.kind === 'update').length).toBeGreaterThan(0);
  });

  it('costs the size of the edit, however much history the room has', async () => {
    const { a, b, seen, textOf } = await twoReplicas();

    // A long history with many deleted ranges: what made the state-vector exchange grow.
    a.doc.transact(() => {
      const text = textOf(a);
      for (let i = 0; i < 3000; i++) text.insert(Math.floor(Math.random() * (text.length + 1)), 'x');
      for (let i = 0; i < 900; i++) text.delete(Math.floor(Math.random() * (text.length - 1)), 1);
    });
    await waitFor(() => textOf(b).toString() === textOf(a).toString() && textOf(b).length > 2000);
    await tick(300);

    const from = seen.length;
    textOf(a).insert(0, 'y');
    await waitFor(() => textOf(b).toString().startsWith('y'));
    await tick(200);

    const sent = seen.slice(from).filter((s) => s.kind !== 'other');
    expect(sent.map((s) => s.kind)).toEqual(['update']);
    // A one-character edit is 60 to 90 bytes (the random client id and the clock are varints); the delete set of
    // this history alone is over a kilobyte, and it is what every state-vector answer used to carry.
    expect(sent[0]!.bytes).toBeLessThan(200);
  });

  it('converges when both sides insert and delete at once', async () => {
    const { a, b, textOf } = await twoReplicas();
    textOf(a).insert(0, 'the quick brown fox jumps over the lazy dog');
    await waitFor(() => textOf(b).toString() === textOf(a).toString());

    for (let i = 0; i < 40; i++) {
      for (const [client, ch] of [[a, 'A'], [b, 'B']] as const) {
        const t = textOf(client);
        t.insert(Math.floor(Math.random() * (t.length + 1)), ch);
        if (i % 3 === 0 && t.length > 3) t.delete(Math.floor(Math.random() * (t.length - 1)), 1);
      }
      await tick(5);
    }
    await waitFor(() => textOf(a).toString() === textOf(b).toString());
    expect(textOf(a).toString().length).toBeGreaterThan(40);
  });

  it('merges the updates of one turn into one message', async () => {
    const { a, b, seen, textOf } = await twoReplicas();
    await tick(200);
    const from = seen.length;
    for (let i = 0; i < 30; i++) a.doc.transact(() => textOf(a).insert(i, 'z')); // 30 transactions, in one go
    await waitFor(() => textOf(b).toString() === 'z'.repeat(30));
    await tick(200);
    const updates = seen.slice(from).filter((s) => s.kind === 'update');
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.length).toBeLessThan(30);
  });

  it('asks for what it missed, so a lost message is repaired', async () => {
    const { roomId, replicaTwo, a, b, seen, textOf } = await twoReplicas({ repairIntervalMs: 300 });
    textOf(a).insert(0, 'before');
    await waitFor(() => textOf(b).toString() === 'before');

    // Replica two stops hearing the room for a moment (what a dropped subscriber connection does).
    const channel = `synapse:hocuspocus:${documentNameFor(roomId)}`;
    const sub = redisOf(replicaTwo).sub;
    await sub.unsubscribe(channel);
    const from = seen.length;
    textOf(a).insert(6, ' and after');
    await waitFor(() => seen.slice(from).some((s) => s.kind === 'update'));
    await sub.subscribe(channel);

    expect(textOf(b).toString()).toBe('before'); // the update is gone
    await waitFor(() => textOf(b).toString() === 'before and after', 4000);
  });

  it('asks for what it missed when its subscriber reconnects', async () => {
    const { roomId, replicaTwo, a, b, seen, textOf } = await twoReplicas(); // no periodic ask
    textOf(a).insert(0, 'before');
    await waitFor(() => textOf(b).toString() === 'before');

    const channel = `synapse:hocuspocus:${documentNameFor(roomId)}`;
    const sub = redisOf(replicaTwo).sub;
    await sub.unsubscribe(channel);
    const from = seen.length;
    textOf(a).insert(6, ' and after');
    await waitFor(() => seen.slice(from).some((s) => s.kind === 'update'));
    await sub.subscribe(channel);
    await tick(600);
    expect(textOf(b).toString()).toBe('before'); // nothing asks: the periodic ask is off

    sub.emit('ready'); // the subscriber coming back up
    await waitFor(() => textOf(b).toString() === 'before and after', 4000);
  });
});
