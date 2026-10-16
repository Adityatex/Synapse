import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startMemoryDb, clearMemoryDb, stopMemoryDb } from '../harness/db.js';

// P1-09: proves the mongo-memory harness works against the real Room model.
describe('Room model (mongodb-memory-server)', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret-that-is-long-enough-for-p1-09-1234567890';
    await startMemoryDb();
  }, 60_000);

  beforeEach(async () => {
    await clearMemoryDb();
  });

  afterAll(async () => {
    await stopMemoryDb();
  });

  it('creates + finds rooms with members', async () => {
    const { default: Room } = await import('../../models/Room.js');
    await Room.create({
      roomId: 'VIT001',
      roomName: 'Vitest Room',
      createdBy: 'creator-1',
      members: [{ userId: 'creator-1', username: 'Creator' }],
      files: [],
    });
    const found = await Room.findOne({ roomId: 'VIT001' });
    expect(found).not.toBeNull();
    expect(found.members.map((m) => m.userId)).toContain('creator-1');
  });

  it('enforces invite-only lookup semantics', async () => {
    const { default: Room } = await import('../../models/Room.js');
    const { isRoomMember } = await import('../../routes/rooms.js');
    await Room.create({
      roomId: 'VIT002',
      roomName: 'Private',
      createdBy: 'creator-1',
      members: [{ userId: 'creator-1', username: 'C' }],
      files: [],
    });
    const room = await Room.findOne({ roomId: 'VIT002' });
    expect(isRoomMember(room, 'creator-1')).toBe(true);
    expect(isRoomMember(room, 'stranger-9')).toBe(false);
  });
});
