import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startMemoryDb, clearMemoryDb, stopMemoryDb } from '../harness/db.js';
import {
  startSocketHarness,
  connectAuthedClient,
  waitFor,
  stopSocketHarness,
} from '../harness/sockets.js';

// P1-09: end-to-end socket harness — real server + real DB.
describe('socket join guard (harness)', () => {
  let harness;
  const creator = { userId: 'creator-1', name: 'Creator', email: 'c@x.com' };
  const stranger = { userId: 'stranger-9', name: 'Stranger', email: 's@x.com' };

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret-that-is-long-enough-for-p1-09-1234567890';
    await startMemoryDb();
    harness = await startSocketHarness();
  }, 60_000);

  beforeEach(async () => {
    await clearMemoryDb();
    const { default: Room } = await import('../../models/Room.js');
    await Room.create({
      roomId: 'SOCK01',
      roomName: 'Socket Room',
      createdBy: creator.userId,
      members: [{ userId: creator.userId, username: creator.name }],
      files: [],
    });
  });

  afterAll(async () => {
    if (harness) await stopSocketHarness(harness);
    await stopMemoryDb();
  });

  it('denies strangers with room-error', async () => {
    const socket = await connectAuthedClient(harness.port, stranger);
    try {
      socket.emit('join-room', { roomId: 'SOCK01' });
      const err = await waitFor(socket, 'room-error');
      expect(String(err.message)).toMatch(/not a member/i);
    } finally {
      socket.disconnect();
    }
  });

  it('admits creator with room-joined', async () => {
    const socket = await connectAuthedClient(harness.port, creator);
    try {
      socket.emit('join-room', { roomId: 'SOCK01' });
      const joined = await waitFor(socket, 'room-joined');
      expect(joined.room.roomId).toBe('SOCK01');
    } finally {
      socket.disconnect();
    }
  });
});
