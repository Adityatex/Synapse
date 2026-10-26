import { createRequire } from 'node:module';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '../harness/db.js';
import { connectAuthedClient, startSocketHarness, stopSocketHarness, waitFor } from '../harness/sockets.js';

const require = createRequire(import.meta.url);

// P2-10: Room.collabVersion decides which editor owns a room's files.
describe('collabVersion (classic editor side)', () => {
  let Room;
  let app;
  let harness;
  const sockets = [];
  const ada = { userId: 'ada', name: 'Ada', email: 'ada@x.com' };
  const token = () => jwt.sign(ada, process.env.JWT_SECRET);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const files = [{ id: 'main', name: 'main.py', type: 'file', parentId: null, order: 0, content: 'print("original")' }];
  const makeRoom = (roomId, extra = {}) =>
    Room.create({ roomId, roomName: roomId, createdBy: 'ada', members: [{ userId: 'ada', username: 'Ada' }], files, ...extra });
  const filesOf = async (roomId) => (await Room.findOne({ roomId })).files.map((f) => f.content);

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

  it('reports the flag with the room: null until migrated, then 2, or 1 when pinned', async () => {
    await makeRoom('NEVER1');
    await makeRoom('MOVED1', { collabVersion: 2 });
    await makeRoom('PINNED');
    await Room.updateOne({ roomId: 'PINNED' }, { $set: { collabVersion: 1 } });
    const get = async (id) => (await request(app).get(`/api/rooms/${id}`).set('Authorization', `Bearer ${token()}`)).body.room.collabVersion;
    expect(await get('NEVER1')).toBeNull();
    expect(await get('MOVED1')).toBe(2);
    expect(await get('PINNED')).toBe(1);
  });

  it('only accepts 1 or 2 for the flag', async () => {
    await expect(makeRoom('BAD001', { collabVersion: 3 })).rejects.toThrow();
  });

  it('lets the classic editor open a room that was never migrated or is pinned', async () => {
    await makeRoom('NEVER2');
    await makeRoom('PINNED2');
    await Room.updateOne({ roomId: 'PINNED2' }, { $set: { collabVersion: 1 } });
    for (const roomId of ['NEVER2', 'PINNED2']) {
      const socket = await connectAuthedClient(harness.port, ada);
      sockets.push(socket);
      socket.emit('join-room', { roomId });
      expect((await waitFor(socket, 'room-joined')).room.roomId).toBe(roomId);
    }
  });

  it('refuses to open a room that has moved to the collab server', async () => {
    await makeRoom('MOVED2', { collabVersion: 2 });
    const socket = await connectAuthedClient(harness.port, ada);
    sockets.push(socket);
    socket.emit('join-room', { roomId: 'MOVED2' });
    const error = await waitFor(socket, 'room-error');
    expect(error).toMatchObject({ code: 'room-migrated' });
    expect(error.message).toMatch(/new editor/i);
  });

  it('lets a collab client join a migrated room for chat, without loading the room’s files into this process', async () => {
    await makeRoom('MOVED3', { collabVersion: 2 });
    const { getRoom } = require('../../socket/roomStore');
    const socket = await connectAuthedClient(harness.port, ada);
    sockets.push(socket);
    const messages = [];
    socket.on('chat-message', (m) => messages.push(m));
    socket.emit('join-room', { roomId: 'MOVED3', collab: true });
    const joined = await waitFor(socket, 'room-joined');
    expect(joined.room).toMatchObject({ roomId: 'MOVED3', roomName: 'MOVED3', files: [] });
    expect(joined.participant).toMatchObject({ userId: 'ada', username: 'Ada' });

    // Chat works from here, and nothing about the files is held in memory.
    socket.emit('send-chat-message', { content: 'hello from a collab client' });
    await sleep(500);
    expect(messages.map((m) => m.content)).toContain('hello from a collab client');
    expect(getRoom('MOVED3')).toBeFalsy();
  });

  it('still checks membership for a chat-only join, and for a room that does not exist', async () => {
    await makeRoom('PRIV01', { collabVersion: 2 });
    const eve = { userId: 'eve', name: 'Eve', email: 'eve@x.com' };
    const stranger = await connectAuthedClient(harness.port, eve);
    sockets.push(stranger);
    stranger.emit('join-room', { roomId: 'PRIV01', collab: true });
    expect((await waitFor(stranger, 'room-error')).message).toMatch(/not a member/i);

    const member = await connectAuthedClient(harness.port, ada);
    sockets.push(member);
    member.emit('join-room', { roomId: 'NOSUCH', collab: true });
    expect((await waitFor(member, 'room-error')).message).toMatch(/not found/i);
  });

  it('cannot overwrite the files of a room that migrated while it was open', async () => {
    await makeRoom('LIVE01');
    const socket = await connectAuthedClient(harness.port, ada);
    sockets.push(socket);
    socket.emit('join-room', { roomId: 'LIVE01' });
    await waitFor(socket, 'room-joined');

    // Another tab opens the room in collab, which migrates it.
    await Room.updateOne({ roomId: 'LIVE01' }, { $set: { collabVersion: 2 } });

    // The classic client keeps going: neither its full sync nor its autosave may reach Room.files.
    socket.emit('sync-room-state', { files: [{ id: 'main', name: 'main.py', content: 'print("stale classic text")' }], activeFileId: 'main', openTabs: ['main'] });
    socket.emit('autosave', { roomId: 'LIVE01', fileId: 'main', content: 'print("stale autosave")' });
    await sleep(500);
    expect(await filesOf('LIVE01')).toEqual(['print("original")']);
  });

  it('still saves a classic room that has not migrated', async () => {
    await makeRoom('CLASS1');
    const socket = await connectAuthedClient(harness.port, ada);
    sockets.push(socket);
    socket.emit('join-room', { roomId: 'CLASS1' });
    await waitFor(socket, 'room-joined');

    socket.emit('autosave', { roomId: 'CLASS1', fileId: 'main', content: 'print("saved")' });
    await sleep(500);
    expect(await filesOf('CLASS1')).toEqual(['print("saved")']);
  });
});
