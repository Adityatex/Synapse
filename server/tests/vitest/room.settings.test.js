import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '../harness/db.js';

// P2-08: the room creator switches focus locks on or off; the collab server reads the flag.
describe('room settings (locksEnabled)', () => {
  let app;
  let Room;
  const tokenFor = (userId) => jwt.sign({ userId, name: userId, email: `${userId}@example.test` }, process.env.JWT_SECRET);
  const as = (userId) => ({ Authorization: `Bearer ${tokenFor(userId)}` });

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret-that-is-long-enough-for-p1-09-1234567890';
    await startMemoryDb();
    ({ default: Room } = await import('../../models/Room.js'));
    const { default: rooms } = await import('../../routes/rooms.js');
    app = express();
    app.use(express.json());
    app.use('/api/rooms', rooms);
  }, 60_000);

  beforeEach(async () => {
    await clearMemoryDb();
    await Room.create({
      roomId: 'LOCK01',
      roomName: 'Locks',
      createdBy: 'creator',
      members: [
        { userId: 'creator', username: 'creator' },
        { userId: 'member', username: 'member' },
      ],
      files: [],
    });
  });

  afterAll(async () => {
    await stopMemoryDb();
  });

  it('is off for a new room', async () => {
    expect((await Room.findOne({ roomId: 'LOCK01' })).locksEnabled).toBe(false);
    const res = await request(app).get('/api/rooms/LOCK01').set(as('member'));
    expect(res.status).toBe(200);
    expect(res.body.room.locksEnabled).toBe(false);
  });

  it('lets the creator turn it on and off, and members see the setting', async () => {
    const on = await request(app).patch('/api/rooms/LOCK01/settings').set(as('creator')).send({ locksEnabled: true });
    expect(on.status).toBe(200);
    expect(on.body).toEqual({ roomId: 'LOCK01', locksEnabled: true });
    expect((await request(app).get('/api/rooms/LOCK01').set(as('member'))).body.room.locksEnabled).toBe(true);

    const off = await request(app).patch('/api/rooms/lock01/settings').set(as('creator')).send({ locksEnabled: false });
    expect(off.body.locksEnabled).toBe(false);
    expect((await Room.findOne({ roomId: 'LOCK01' })).locksEnabled).toBe(false);
  });

  it('refuses a member who is not the creator, and anyone not signed in', async () => {
    const member = await request(app).patch('/api/rooms/LOCK01/settings').set(as('member')).send({ locksEnabled: true });
    expect(member.status).toBe(403);
    expect((await Room.findOne({ roomId: 'LOCK01' })).locksEnabled).toBe(false);

    const anonymous = await request(app).patch('/api/rooms/LOCK01/settings').send({ locksEnabled: true });
    expect(anonymous.status).toBe(401);
  });

  it('rejects a body that is not a boolean, and an unknown room', async () => {
    for (const body of [{}, { locksEnabled: 'yes' }, { locksEnabled: 1 }]) {
      const res = await request(app).patch('/api/rooms/LOCK01/settings').set(as('creator')).send(body);
      expect(res.status).toBe(400);
    }
    const missing = await request(app).patch('/api/rooms/NOPE99/settings').set(as('creator')).send({ locksEnabled: true });
    expect(missing.status).toBe(404);
  });
});
