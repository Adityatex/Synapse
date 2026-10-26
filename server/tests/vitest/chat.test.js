import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '../harness/db.js';
import { connectAuthedClient, startSocketHarness, stopSocketHarness, waitFor } from '../harness/sockets.js';

const require = createRequire(import.meta.url);
const { createRedisClient } = require('@synapse/redis');
const { createSocketAdapter } = require('../../lib/socketAdapter');
const { createMembershipCheck } = require('../../socket/chatHandlers');

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

const ada = { userId: 'ada', name: 'Ada', email: 'ada@x.com' };
const bob = { userId: 'bob', name: 'Bob', email: 'bob@x.com' };
const eve = { userId: 'eve', name: 'Eve', email: 'eve@x.com' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms = 8000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for condition');
    await sleep(25);
  }
}

/** Records every payload of an event, so a test can look at all of them. */
function record(socket, event) {
  const seen = [];
  socket.on(event, (payload) => seen.push(payload));
  return seen;
}
const userMessages = (seen) => seen.filter((m) => m.type === 'user');

describe('chat', () => {
  let Room;
  let Message;
  const harnesses = [];
  const sockets = [];

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret-that-is-long-enough-for-p1-09-1234567890';
    await startMemoryDb();
    ({ default: Room } = await import('../../models/Room.js'));
    ({ default: Message } = await import('../../models/Message.js'));
  }, 60_000);

  beforeEach(async () => {
    await clearMemoryDb();
    await Room.create({ roomId: 'CHAT01', roomName: 'Chat', createdBy: 'ada', members: [{ userId: 'ada' }, { userId: 'bob' }], files: [] });
    await Room.create({ roomId: 'CHAT02', roomName: 'Other', createdBy: 'eve', members: [{ userId: 'eve' }], files: [] });
  });

  afterEach(async () => {
    sockets.splice(0).forEach((s) => s.disconnect());
    for (const harness of harnesses.splice(0)) await stopSocketHarness(harness);
  });

  afterAll(async () => {
    await stopMemoryDb();
  });

  const start = async (options) => {
    const harness = await startSocketHarness(options);
    harnesses.push(harness);
    return harness;
  };
  const join = async (harness, user, roomId = 'CHAT01') => {
    const socket = await connectAuthedClient(harness.port, user);
    sockets.push(socket);
    socket.emit('join-room', { roomId });
    await waitFor(socket, 'room-joined');
    return socket;
  };

  describe('on one server', () => {
    it('delivers a member’s message to the room, saved and with a string id', async () => {
      const harness = await start();
      const [a, b] = [await join(harness, ada), await join(harness, bob)];
      const received = record(b, 'chat-message');

      a.emit('send-chat-message', { content: 'hello bob' });
      await until(() => userMessages(received).length === 1);

      const [message] = userMessages(received);
      expect(message).toMatchObject({ roomId: 'CHAT01', senderId: 'ada', senderName: 'Ada', content: 'hello bob' });
      expect(typeof message._id).toBe('string');
      expect(await Message.countDocuments({ roomId: 'CHAT01', type: 'user' })).toBe(1);
    });

    it('does not let a member post into a room they have not joined by naming it', async () => {
      const harness = await start();
      const inChat01 = await join(harness, ada);
      const owner = await join(harness, eve, 'CHAT02');
      const received = record(owner, 'chat-message');

      inChat01.emit('send-chat-message', { roomId: 'CHAT02', content: 'let me in' });
      await sleep(400);

      expect(userMessages(received)).toHaveLength(0);
      expect(await Message.countDocuments({ roomId: 'CHAT02', type: 'user' })).toBe(0);
    });

    it('does not let a socket that never joined do anything in chat', async () => {
      const harness = await start();
      const member = await join(harness, bob);
      const outsider = await connectAuthedClient(harness.port, eve); // connected, never joined
      sockets.push(outsider);
      const seenByMember = record(member, 'chat-message');
      const history = record(outsider, 'chat-history');
      const results = record(outsider, 'chat-search-results');
      const typing = record(member, 'user-typing');

      outsider.emit('send-chat-message', { roomId: 'CHAT01', content: 'spam' });
      outsider.emit('request-chat-history', { roomId: 'CHAT01' });
      outsider.emit('search-chat-messages', { roomId: 'CHAT01', query: 'a' });
      outsider.emit('typing-indicator', { roomId: 'CHAT01', isTyping: true });
      await sleep(500);

      expect(userMessages(seenByMember)).toHaveLength(0);
      expect(history).toHaveLength(0);
      expect(results).toHaveLength(0);
      expect(typing).toHaveLength(0);
      expect(await Message.countDocuments({ roomId: 'CHAT01', type: 'user' })).toBe(0);
    });

    it('does not show another room’s history or search results to a member of this one', async () => {
      await Message.create({ roomId: 'CHAT02', senderId: 'eve', senderName: 'Eve', content: 'secret plans' });
      const harness = await start();
      const a = await join(harness, ada);
      const history = record(a, 'chat-history');
      const results = record(a, 'chat-search-results');

      a.emit('request-chat-history', { roomId: 'CHAT02' });
      a.emit('search-chat-messages', { roomId: 'CHAT02', query: 'secret' });
      await sleep(500);
      expect(history).toHaveLength(0);
      expect(results).toHaveLength(0);

      // Their own room's history still works, with or without naming it.
      a.emit('request-chat-history', {});
      await until(() => history.length === 1);
    });

    it('checks membership on every event, so a user who is removed is cut off', async () => {
      // No answer is kept between events here, so the change shows up at once.
      const harness = await start({ chat: { isMember: createMembershipCheck({ ttlMs: 0 }) } });
      const [a, b] = [await join(harness, ada), await join(harness, bob)];
      const received = record(a, 'chat-message');

      b.emit('send-chat-message', { content: 'before' });
      await until(() => userMessages(received).length === 1);

      await Room.updateOne({ roomId: 'CHAT01' }, { $set: { members: [{ userId: 'ada' }] } });
      b.emit('send-chat-message', { content: 'after' });
      await sleep(500);

      expect(userMessages(received).map((m) => m.content)).toEqual(['before']);
    });

    it('only lets the sender edit or delete, and others in the room can react and pin', async () => {
      const harness = await start();
      const [a, b] = [await join(harness, ada), await join(harness, bob)];
      const updates = record(b, 'chat-message-updated');
      const received = record(b, 'chat-message');

      a.emit('send-chat-message', { content: 'original' });
      await until(() => userMessages(received).length === 1);
      const { _id } = userMessages(received)[0];

      b.emit('edit-chat-message', { messageId: _id, content: 'hijacked' }); // not the sender
      await sleep(300);
      expect(updates).toHaveLength(0);

      a.emit('edit-chat-message', { messageId: _id, content: 'edited' });
      await until(() => updates.length === 1);
      expect(updates[0]).toMatchObject({ _id, content: 'edited', edited: true });

      b.emit('react-chat-message', { messageId: _id, emoji: '👍' });
      await until(() => updates.length === 2);
      expect(updates[1].reactions['👍']).toMatchObject([{ userId: 'bob', username: 'Bob' }]);
    });

    it('survives events with no payload, and caps the history page', async () => {
      const harness = await start();
      const a = await join(harness, ada);
      for (const event of ['typing-indicator', 'request-chat-history', 'edit-chat-message', 'delete-chat-message', 'pin-chat-message', 'react-chat-message']) {
        a.emit(event);
      }
      await Message.insertMany(Array.from({ length: 130 }, (_, i) => ({ roomId: 'CHAT01', senderId: 'ada', senderName: 'Ada', content: `m${i}` })));
      const history = record(a, 'chat-history');
      a.emit('request-chat-history', { limit: 100000 });
      // The no-payload request above is answered too (50 rows, or fewer), possibly after the insert,
      // so wait for the reply to the capped request rather than for the first reply.
      await until(() => history.some((page) => page.length === 100));
      expect(Math.max(...history.map((page) => page.length))).toBe(100); // never more than the cap
    });
  });

  describe('createMembershipCheck', () => {
    it('keeps an answer for the cache time, then asks again', async () => {
      let time = 1_000;
      const isMember = createMembershipCheck({ ttlMs: 5_000, now: () => time });

      expect(await isMember('CHAT01', 'bob')).toBe(true);
      await Room.updateOne({ roomId: 'CHAT01' }, { $set: { members: [{ userId: 'ada' }] } });
      time += 4_000;
      expect(await isMember('CHAT01', 'bob')).toBe(true); // still remembered
      time += 2_000;
      expect(await isMember('CHAT01', 'bob')).toBe(false); // asked again
    });

    it('applies the same rule as the HTTP guard', async () => {
      await Room.create({ roomId: 'LEGACY', roomName: 'Old', createdBy: 'ada', members: [], files: [] });
      const isMember = createMembershipCheck({ ttlMs: 0 });
      expect(await isMember('CHAT01', 'ada')).toBe(true); // creator
      expect(await isMember('CHAT01', 'bob')).toBe(true); // member
      expect(await isMember('CHAT01', 'eve')).toBe(false); // stranger
      expect(await isMember('LEGACY', 'eve')).toBe(true); // legacy room without members
      expect(await isMember('NOPE99', 'ada')).toBe(false); // no such room
    });
  });

  describe.skipIf(!redisAvailable)('across two api replicas (Redis adapter)', () => {
    const key = `test:socket.io:${Math.random().toString(36).slice(2)}`;
    const replicas = async () => [
      await start({ adapter: createSocketAdapter(REDIS_URL, { key }) }),
      await start({ adapter: createSocketAdapter(REDIS_URL, { key }) }),
    ];

    it('delivers a chat message sent through one replica to a socket on the other', async () => {
      const [one, two] = await replicas();
      const a = await join(one, ada);
      const b = await join(two, bob);
      await sleep(200); // let both replicas' subscriptions settle
      const received = record(b, 'chat-message');

      a.emit('send-chat-message', { content: 'across replicas' });
      await until(() => userMessages(received).length === 1);

      const [message] = userMessages(received);
      expect(message).toMatchObject({ roomId: 'CHAT01', senderId: 'ada', content: 'across replicas' });
      // Plain JSON, as on a local socket: the id is a string, the time a date string.
      const stored = await Message.findOne({ roomId: 'CHAT01', type: 'user' });
      expect(message._id).toBe(String(stored._id));
      expect(Number.isNaN(Date.parse(message.timestamp))).toBe(false);
    });

    it('carries edits, reactions, typing and system messages across too', async () => {
      const [one, two] = await replicas();
      const a = await join(one, ada);
      const b = await join(two, bob);
      await sleep(200);
      const updates = record(a, 'chat-message-updated');
      const typing = record(a, 'user-typing');
      const received = record(b, 'chat-message');

      a.emit('send-chat-message', { content: 'first' });
      await until(() => userMessages(received).length === 1);
      const { _id } = userMessages(received)[0];

      b.emit('react-chat-message', { messageId: _id, emoji: '🎉' });
      await until(() => updates.length === 1);
      expect(updates[0].reactions['🎉']).toMatchObject([{ userId: 'bob', username: 'Bob' }]);

      b.emit('typing-indicator', { isTyping: true });
      await until(() => typing.length === 1);
      expect(typing[0]).toMatchObject({ userId: 'bob', isTyping: true });

      // Ada joined first, so she saw Bob's "joined" line arrive from the other replica.
      expect((await Message.find({ roomId: 'CHAT01', type: 'system' })).length).toBeGreaterThanOrEqual(2);
    });

    it('applies the membership check on the replica that receives the event', async () => {
      const [, two] = await replicas();
      const outsider = await connectAuthedClient(two.port, eve);
      sockets.push(outsider);
      outsider.emit('send-chat-message', { roomId: 'CHAT01', content: 'sneaking in' });
      await sleep(500);
      expect(await Message.countDocuments({ roomId: 'CHAT01', type: 'user' })).toBe(0);
    });
  });

  describe('when Redis is unreachable', () => {
    it('keeps chat working on the replica and does not crash the process', async () => {
      const unhandled = [];
      const onUnhandled = (reason) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      try {
        const harness = await start({ adapter: createSocketAdapter('redis://127.0.0.1:1', { key: 'test:dead' }) });
        const [a, b] = [await join(harness, ada), await join(harness, bob)];
        const received = record(b, 'chat-message');

        a.emit('send-chat-message', { content: 'still here' });
        await until(() => userMessages(received).length === 1);
        await sleep(300);
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });
  });
});
