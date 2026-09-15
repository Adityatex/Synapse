/**
 * P0 Group 4 regression tests (P0-13 → P0-16).
 *
 * Vitest + Supertest + real socket.io (same patterns as p0-group1/2/3).
 * DB-touching model methods are stubbed — the suite is offline-safe.
 *
 * Run: npm test (server/)
 */
'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-for-p0-group4-1234567890';

import { describe, it, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const express = require('express');
const request = require('supertest');

const REPO_ROOT = path.join(__dirname, '..', '..');

describe('P0-13: always-on backend declaration', () => {
  const renderYaml = fs.readFileSync(path.join(REPO_ROOT, 'render.yaml'), 'utf8');

  it('declares a starter (always-on) plan, not free', () => {
    assert.match(renderYaml, /plan:\s*starter/, 'render.yaml must pin plan: starter');
    assert.doesNotMatch(renderYaml, /plan:\s*free/, 'render.yaml must not use the sleeping free plan');
  });

  it('wires health checks to /api/health with matching server route', () => {
    assert.match(renderYaml, /healthCheckPath:\s*\/api\/health/);
    const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'server', 'server.js'), 'utf8');
    assert.ok(
      serverSrc.includes("app.get('/api/health'"),
      'server.js must expose GET /api/health for the Render health check'
    );
  });

  it('keeps secrets out of the blueprint (dashboard-only)', () => {
    assert.ok(!/JWT_SECRET[\s\S]{0,40}value:\s*\S/.test(renderYaml.replace('sync: false', '')),
      'JWT_SECRET must use sync: false, never a committed value');
    for (const secret of ['JWT_SECRET', 'MONGODB_URI', 'CORS_ORIGIN', 'JUDGE0_API_KEY', 'SENTRY_DSN']) {
      assert.ok(renderYaml.includes(secret), `render.yaml must declare ${secret}`);
    }
  });

  it('health endpoint contract the monitor relies on (200 + status ok)', () => {
    // server.js listens on import, so the contract is asserted statically —
    // same approach as the P0-05/P0-11 static checks.
    const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'server', 'server.js'), 'utf8');
    const healthBlock = serverSrc.slice(serverSrc.indexOf("app.get('/api/health'"));
    assert.ok(healthBlock.includes("status: 'ok'"), 'health body must contain status "ok" (UptimeRobot keyword)');
    assert.ok(healthBlock.includes('res.json('), 'health must answer 200 JSON (no explicit error status)');
  });
});

describe('P0-14: authoritative env docs', () => {
  const serverExample = fs.readFileSync(path.join(REPO_ROOT, 'server', '.env.example'), 'utf8');
  const clientExample = fs.readFileSync(path.join(REPO_ROOT, 'client', '.env.example'), 'utf8');
  const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');

  it('server example lists every production-required variable', () => {
    for (const name of ['JWT_SECRET', 'MONGODB_URI', 'CORS_ORIGIN']) {
      assert.ok(serverExample.includes(name), `server/.env.example must document ${name}`);
    }
    assert.ok(serverExample.includes('32'), 'JWT_SECRET minimum length must be documented');
  });

  it('server example covers observability + email providers', () => {
    for (const name of ['LOG_LEVEL', 'SENTRY_DSN', 'SENTRY_RELEASE', 'BREVO_API_KEY', 'BREVO_SENDER_EMAIL']) {
      assert.ok(serverExample.includes(name), `server/.env.example must document ${name}`);
    }
  });

  it('recommends Brevo and marks Gmail SMTP as legacy', () => {
    assert.ok(/Brevo.*recommended|recommended.*Brevo/i.test(serverExample), 'Brevo must be the recommended path');
    assert.ok(/legacy/i.test(serverExample), 'Gmail SMTP must be marked legacy');
    assert.ok(/brevo/i.test(readme), 'README must point to Brevo, not Gmail-first docs');
  });

  it('client example covers backend URLs and Sentry without secrets', () => {
    for (const name of ['VITE_API_URL', 'VITE_SOCKET_URL', 'VITE_SENTRY_DSN', 'VITE_PUBLIC_APP_URL']) {
      assert.ok(clientExample.includes(name), `client/.env.example must document ${name}`);
    }
    assert.ok(/never put secrets|Never put secrets/i.test(clientExample));
  });

  it('README points at the examples, render.yaml and monitoring doc', () => {
    assert.ok(readme.includes('.env.example'), 'README must reference the .env.example files');
    assert.ok(readme.includes('render.yaml'), 'README must reference render.yaml');
    assert.ok(readme.includes('docs/uptime-monitoring.md'), 'README must reference the monitoring doc');
  });
});

describe('P0-15: uptime monitoring is specified', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'uptime-monitoring.md'), 'utf8');

  it('defines monitors for /api/health (keyword) and the web root', () => {
    assert.ok(doc.includes('/api/health'), 'must monitor the API health endpoint');
    assert.ok(/keyword/i.test(doc), 'API monitor must be keyword-based ("ok")');
    assert.ok(/web root|synapse-web/i.test(doc), 'must monitor the web root');
  });

  it('configures team alerts and an outage-detection test', () => {
    assert.ok(/alert contact/i.test(doc), 'must configure team alert contacts');
    assert.ok(/kill-switch|outage/i.test(doc), 'must define an outage-detection verification');
  });
});

describe('P0-16: invite-only join guard — pure decision helper', () => {
  const { isInviteOnlyJoinAllowed } = require('../socket/roomStore');

  it('open rooms admit everyone (default, flag absent)', () => {
    assert.deepEqual(
      isInviteOnlyJoinAllowed({ room: { createdBy: 'creator-1' }, userId: 'stranger-9', memberUserIds: [] }),
      { allowed: true }
    );
    assert.deepEqual(
      isInviteOnlyJoinAllowed({ room: { isInviteOnly: false, createdBy: 'creator-1' }, userId: 'stranger-9', memberUserIds: [] }),
      { allowed: true }
    );
  });

  it('invite-only rooms admit the creator without any DB check', () => {
    assert.deepEqual(
      isInviteOnlyJoinAllowed({ room: { isInviteOnly: true, createdBy: 'creator-1' }, userId: 'creator-1', memberUserIds: null }),
      { allowed: true, via: 'creator' }
    );
  });

  it('invite-only rooms admit recorded members', () => {
    assert.deepEqual(
      isInviteOnlyJoinAllowed({ room: { isInviteOnly: true, createdBy: 'creator-1' }, userId: 'member-2', memberUserIds: ['member-2', 'member-3'] }),
      { allowed: true, via: 'member' }
    );
  });

  it('invite-only rooms deny strangers', () => {
    assert.deepEqual(
      isInviteOnlyJoinAllowed({ room: { isInviteOnly: true, createdBy: 'creator-1' }, userId: 'stranger-9', memberUserIds: ['member-2'] }),
      { allowed: false }
    );
  });

  it('denies when membership cannot be verified (fail closed, DB down)', () => {
    assert.deepEqual(
      isInviteOnlyJoinAllowed({ room: { isInviteOnly: true, createdBy: 'creator-1' }, userId: 'stranger-9', memberUserIds: null }),
      { allowed: false }
    );
    assert.deepEqual(
      isInviteOnlyJoinAllowed({ room: { isInviteOnly: true, createdBy: 'creator-1' }, userId: 'stranger-9', memberUserIds: undefined }),
      { allowed: false }
    );
  });
});

describe('P0-16: room model + creation carry the flag', () => {
  const RoomModel = require('../models/Room');
  const roomStore = require('../socket/roomStore');

  it('schema defaults isInviteOnly to false', () => {
    const schemaPath = RoomModel.schema.path('isInviteOnly');
    assert.ok(schemaPath, 'Room schema must define isInviteOnly');
    assert.equal(schemaPath.instance, 'Boolean');
    assert.equal(schemaPath.defaultValue, false);
  });

  it('createRoom persists the flag and exposes it in snapshots', async () => {
    const created = [];
    const originalCreate = RoomModel.create;
    RoomModel.create = async (doc) => {
      created.push(doc);
      return doc;
    };

    try {
      const open = await roomStore.createRoom({ userId: 'creator-1' }, 'Open Room');
      assert.equal(open.isInviteOnly, false);
      assert.equal(created[created.length - 1].isInviteOnly, false);

      const locked = await roomStore.createRoom({ userId: 'creator-1' }, 'Locked Room', { isInviteOnly: true });
      assert.equal(locked.isInviteOnly, true);
      assert.equal(created[created.length - 1].isInviteOnly, true);
    } finally {
      RoomModel.create = originalCreate;
    }
  });
});

describe('P0-16: PATCH /api/rooms/:roomId toggles the setting (creator-only)', () => {
  const jwt = require('jsonwebtoken');
  const RoomModel = require('../models/Room');
  const roomStore = require('../socket/roomStore');
  const roomsRouter = require('../routes/rooms');

  const creator = { userId: 'creator-1', name: 'Creator', email: 'creator@example.com' };
  const stranger = { userId: 'stranger-9', name: 'Stranger', email: 'stranger@example.com' };

  function sign(user) {
    return jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '1h' });
  }

  function buildApp() {
    const app = express();
    app.use(express.json({ limit: '100kb' }));
    app.use((req, res, next) => {
      req.id = 'p0-16-test';
      next();
    });
    app.use('/api/rooms', roomsRouter);
    return app;
  }

  function fakeDbRoom() {
    return {
      roomId: 'LOCKME',
      createdBy: creator.userId,
      isInviteOnly: false,
      saved: false,
      async save() {
        this.saved = true;
      },
    };
  }

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(buildApp()).patch('/api/rooms/LOCKME').send({ isInviteOnly: true });
    assert.equal(res.status, 401);
  });

  it('rejects non-boolean payloads with 400', async () => {
    const res = await request(buildApp())
      .patch('/api/rooms/LOCKME')
      .set('Authorization', `Bearer ${sign(creator)}`)
      .send({ isInviteOnly: 'yes' });
    assert.equal(res.status, 400);
  });

  it('lets the creator toggle the flag and syncs live memory', async () => {
    const originalCreate = RoomModel.create;
    const originalFindOne = RoomModel.findOne;
    RoomModel.create = async () => ({});
    const dbRoom = fakeDbRoom();
    RoomModel.findOne = async () => dbRoom;

    try {
      // Seed live in-memory state for the same room id.
      const live = await roomStore.createRoom({ userId: creator.userId }, 'Live Room');

      // Point the fake DB record at a real in-memory room so sync is observable.
      dbRoom.roomId = live.roomId;

      const res = await request(buildApp())
        .patch(`/api/rooms/${live.roomId}`)
        .set('Authorization', `Bearer ${sign(creator)}`)
        .send({ isInviteOnly: true });

      assert.equal(res.status, 200);
      assert.equal(res.body.room.isInviteOnly, true);
      assert.equal(dbRoom.saved, true);
      assert.equal(roomStore.getRoom(live.roomId).isInviteOnly, true);
    } finally {
      RoomModel.create = originalCreate;
      RoomModel.findOne = originalFindOne;
    }
  });

  it('forbids non-creators with 403 and returns 404 for unknown rooms', async () => {
    const originalFindOne = RoomModel.findOne;
    const dbRoom = fakeDbRoom();
    RoomModel.findOne = async () => dbRoom;

    try {
      const forbidden = await request(buildApp())
        .patch('/api/rooms/LOCKME')
        .set('Authorization', `Bearer ${sign(stranger)}`)
        .send({ isInviteOnly: true });
      assert.equal(forbidden.status, 403);

      RoomModel.findOne = async () => null;
      const missing = await request(buildApp())
        .patch('/api/rooms/NOPE01')
        .set('Authorization', `Bearer ${sign(creator)}`)
        .send({ isInviteOnly: true });
      assert.equal(missing.status, 404);
    } finally {
      RoomModel.findOne = originalFindOne;
    }
  });
});

describe('P0-16: socket join guard end-to-end', () => {
  const http = require('node:http');
  const jwt = require('jsonwebtoken');
  const { io: ioClient } = require('socket.io-client');
  const { createSocketServer } = require('../socket/socketManager');
  const RoomModel = require('../models/Room');
  const MessageModel = require('../models/Message');
  const roomStore = require('../socket/roomStore');

  const creator = { userId: 'creator-1', name: 'Creator', email: 'creator@example.com' };
  const member = { userId: 'member-2', name: 'Member', email: 'member@example.com' };
  const stranger = { userId: 'stranger-9', name: 'Stranger', email: 'stranger@example.com' };

  let httpServer;
  let io;
  let url;
  let roomId;

  function sign(user) {
    return jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '1h' });
  }

  function waitFor(socket, event, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
      socket.once(event, (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  function connectAs(user) {
    const socket = ioClient(url, { auth: { token: sign(user) } });
    return socket;
  }

  beforeAll(async () => {
    RoomModel.create = async () => ({});
    RoomModel.updateOne = async () => ({});
    // No recorded members yet: only the creator may join.
    // (Mimics the Mongoose query chain used by the guard.)
    RoomModel.findOne = () => ({ select: () => ({ lean: async () => ({ members: [] }) }) });
    MessageModel.create = async (doc) => ({ _id: 'mock-msg', ...doc });

    const room = await roomStore.createRoom({ userId: creator.userId }, 'Invite Room', { isInviteOnly: true });
    roomId = room.roomId;
    assert.equal(room.isInviteOnly, true);

    httpServer = http.createServer();
    io = createSocketServer(httpServer);
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://127.0.0.1:${httpServer.address().port}`;
  }, 15000);

  afterAll(async () => {
    io?.close();
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }
  });

  it('admits the creator to an invite-only room', async () => {
    const socket = connectAs(creator);
    try {
      socket.emit('join-room', { roomId });
      const joined = await waitFor(socket, 'room-joined');
      assert.equal(joined.room.roomId, roomId);
    } finally {
      socket.disconnect();
    }
  });

  it('rejects a non-member stranger with room-error', async () => {
    const socket = connectAs(stranger);
    try {
      socket.emit('join-room', { roomId });
      const err = await waitFor(socket, 'room-error');
      assert.match(err.message, /invite-only/i);
    } finally {
      socket.disconnect();
    }
  });

  it('admits a recorded member', async () => {
    RoomModel.findOne = () => ({
      select: () => ({ lean: async () => ({ members: [{ userId: member.userId, username: member.name }] }) }),
    });
    const socket = connectAs(member);
    try {
      socket.emit('join-room', { roomId });
      const joined = await waitFor(socket, 'room-joined');
      assert.equal(joined.room.roomId, roomId);
    } finally {
      socket.disconnect();
    }
  });

  it('leaves open rooms unaffected (stranger joins freely)', async () => {
    RoomModel.findOne = () => ({ select: () => ({ lean: async () => ({ members: [] }) }) });
    const open = await roomStore.createRoom({ userId: creator.userId }, 'Open Room');
    const socket = connectAs(stranger);
    try {
      socket.emit('join-room', { roomId: open.roomId });
      const joined = await waitFor(socket, 'room-joined');
      assert.equal(joined.room.roomId, open.roomId);
    } finally {
      socket.disconnect();
    }
  });
});
