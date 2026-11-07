import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '../harness/db.js';
import { connectAuthedClient, startSocketHarness, stopSocketHarness, waitFor } from '../harness/sockets.js';

// P2-14: the api creates rooms and carries their chat; editing is the collab server's.
describe('room lifecycle on the api', () => {
  let Room;
  let app;
  let harness;
  const sockets = [];
  const ada = { userId: 'ada', name: 'Ada', email: 'ada@x.com' };
  const eve = { userId: 'eve', name: 'Eve', email: 'eve@x.com' };
  const as = (user) => ({ Authorization: `Bearer ${jwt.sign(user, process.env.JWT_SECRET)}` });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const connect = async (user) => {
    const socket = await connectAuthedClient(harness.port, user);
    sockets.push(socket);
    return socket;
  };

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret-that-is-long-enough-for-p1-09-1234567890';
    await startMemoryDb();
    ({ default: Room } = await import('../../models/Room.js'));
    const { default: rooms } = await import('../../routes/rooms.js');
    app = express();
    app.use(express.json());
    app.use('/api/rooms', rooms);
    harness = await startSocketHarness();
  }, 60_000);

  beforeEach(async () => {
    await clearMemoryDb();
  });

  afterEach(() => {
    sockets.splice(0).forEach((s) => s.disconnect());
  });

  afterAll(async () => {
    await stopSocketHarness(harness);
    await stopMemoryDb();
  });

  describe('creating a room', () => {
    it('stores the creator as the first member, with the starter file the collab server seeds from', async () => {
      const res = await request(app).post('/api/rooms').set(as(ada)).send({ roomName: 'Pair session' });
      expect(res.status).toBe(201);
      expect(res.body.room).toMatchObject({ roomName: 'Pair session', createdBy: 'ada', participantCount: 0 });
      expect(res.body.room.roomId).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

      const saved = await Room.findOne({ roomId: res.body.room.roomId });
      expect(saved.members.map((m) => m.userId)).toEqual(['ada']);
      expect(saved.files).toHaveLength(1);
      expect(saved.files[0]).toMatchObject({ id: 'welcome-py', name: 'main.py' });
      expect(saved.collabVersion).toBeUndefined();
    });

    it('gives each room its own id', async () => {
      const ids = new Set();
      for (let i = 0; i < 20; i += 1) {
        const res = await request(app).post('/api/rooms').set(as(ada)).send({ roomName: `room ${i}` });
        ids.add(res.body.room.roomId);
      }
      expect(ids.size).toBe(20);
    });
  });

  describe('reading a room', () => {
    it('is for members only, and a room that does not exist is a 404', async () => {
      await Room.create({ roomId: 'READ01', roomName: 'Read', createdBy: 'ada', members: [{ userId: 'ada', username: 'Ada' }] });
      expect((await request(app).get('/api/rooms/read01').set(as(ada))).body.room).toMatchObject({ roomId: 'READ01', locksEnabled: false });
      expect((await request(app).get('/api/rooms/READ01').set(as(eve))).status).toBe(403);
      expect((await request(app).get('/api/rooms/NOSUCH').set(as(ada))).status).toBe(404);
    });
  });

  describe('joining a room over Socket.IO (chat only)', () => {
    const makeRoom = (roomId, extra = {}) =>
      Room.create({ roomId, roomName: roomId, createdBy: 'ada', members: [{ userId: 'ada', username: 'Ada' }], ...extra });

    it('joins any room the person belongs to, migrated or not, and chat works', async () => {
      await makeRoom('MOVED1', { collabVersion: 2 });
      await makeRoom('OLD001');
      for (const roomId of ['MOVED1', 'OLD001']) {
        const socket = await connect(ada);
        const messages = [];
        socket.on('chat-message', (m) => messages.push(m));
        socket.emit('join-room', { roomId });
        const joined = await waitFor(socket, 'room-joined');
        expect(joined.room).toEqual({ roomId, roomName: roomId });
        expect(joined.participant).toMatchObject({ userId: 'ada', username: 'Ada' });

        socket.emit('send-chat-message', { content: `hello ${roomId}` });
        await sleep(400);
        expect(messages.map((m) => m.content)).toContain(`hello ${roomId}`);
      }
    });

    it('refuses a stranger and a room that does not exist', async () => {
      await makeRoom('PRIV01');
      const stranger = await connect(eve);
      stranger.emit('join-room', { roomId: 'PRIV01' });
      expect((await waitFor(stranger, 'room-error')).message).toMatch(/not a member/i);

      const member = await connect(ada);
      member.emit('join-room', { roomId: 'NOSUCH' });
      expect((await waitFor(member, 'room-error')).message).toMatch(/not found/i);
    });

    it('no longer answers the editing events of the old relay', async () => {
      await makeRoom('RELAY1');
      const socket = await connect(ada);
      socket.emit('join-room', { roomId: 'RELAY1' });
      await waitFor(socket, 'room-joined');

      const heard = [];
      for (const event of ['remote-code-change', 'room-state-updated', 'file-locks-updated', 'cursor-update']) socket.on(event, () => heard.push(event));
      socket.emit('code-change', { fileId: 'main', changes: 'QUJD' });
      socket.emit('sync-room-state', { files: [{ id: 'main', name: 'main.py', content: 'x' }] });
      socket.emit('autosave', { roomId: 'RELAY1', fileId: 'welcome-py', content: 'print("stale")' });
      socket.emit('request-file-lock', { roomId: 'RELAY1', fileId: 'welcome-py' });
      await sleep(400);
      expect(heard).toEqual([]);
      expect((await Room.findOne({ roomId: 'RELAY1' })).files).toHaveLength(0);
    });
  });

  describe('who is in a room right now (dashboard)', () => {
    it('lists each person once, for the room their socket joined, and drops them when they leave', async () => {
      await Room.create({
        roomId: 'LIVE01',
        roomName: 'Live',
        createdBy: 'ada',
        members: [
          { userId: 'ada', username: 'Ada' },
          { userId: 'eve', username: 'Eve' },
        ],
      });
      const liveOf = async () => (await request(app).get('/api/rooms/recent/ada').set(as(ada))).body[0].live;
      expect(await liveOf()).toEqual([]);

      const first = await connect(ada);
      first.emit('join-room', { roomId: 'LIVE01' });
      await waitFor(first, 'room-joined');
      const second = await connect(ada); // a second tab of the same person
      second.emit('join-room', { roomId: 'LIVE01' });
      await waitFor(second, 'room-joined');
      const other = await connect(eve);
      other.emit('join-room', { roomId: 'LIVE01' });
      await waitFor(other, 'room-joined');

      const live = await liveOf();
      expect(live.map((p) => p.userId).sort()).toEqual(['ada', 'eve']);
      expect(live.find((p) => p.userId === 'eve')).toEqual({ userId: 'eve', username: 'Eve' });

      other.emit('leave-room');
      await sleep(300);
      expect((await liveOf()).map((p) => p.userId)).toEqual(['ada']);
    });
  });
});
