/**
 * P0 Group 3 tests, part 1 (P0-09 → P0-10).
 *
 * Uses Vitest + Supertest (migrated from node:test in P0-12).
 *
 * Run: npm test (server/)
 */
'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-for-p0-group3-1234567890';
process.env.JUDGE0_API_HOST = '127.0.0.1:9';
process.env.JUDGE0_API_KEY = 'p0-test-key';

import { describe, it, beforeAll, afterEach, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const express = require('express');
const pino = require('pino');
const pinoHttp = require('pino-http');
const request = require('supertest');

const requestIdMiddleware = require('../middleware/requestId');

const SERVER_ROOT = path.join(__dirname, '..');

describe('P0-09: structured JSON logging with request IDs', () => {
  function buildLoggedApp(stream) {
    const testLogger = pino({ level: 'info' }, stream);
    const app = express();
    app.use(requestIdMiddleware);
    // Same wiring as server.js.
    app.use(
      pinoHttp({
        logger: testLogger,
        genReqId: (req) => req.id,
        customProps: (req) => ({
          requestId: req.id,
          userId: req.user ? req.user.userId : undefined,
        }),
      })
    );
    app.get('/ping', (req, res) => res.json({ ok: true }));
    return app;
  }

  it('emits a JSON access log whose requestId matches the header and body', async () => {
    const lines = [];
    const stream = { write: (chunk) => void lines.push(chunk.toString()) };
    const res = await request(buildLoggedApp(stream)).get('/ping');
    assert.equal(res.status, 200);
    assert.ok(res.headers['x-request-id'], 'X-Request-Id header must be present');

    const accessLog = lines.map((line) => JSON.parse(line)).find((obj) => obj.req);
    assert.ok(accessLog, 'pino-http must emit an access log line');
    assert.equal(accessLog.requestId, res.headers['x-request-id']);
    assert.equal(accessLog.req.method, 'GET');
    assert.equal(accessLog.res.statusCode, 200);
  });

  it('socket log context carries event/roomId/userId/requestId', () => {
    const { socketLogContext } = require('../socket/socketManager');
    const socket = { data: { requestId: 'req-1', user: { userId: 'u-1' }, roomId: 'ABC123' } };
    assert.deepEqual(socketLogContext(socket, 'join-room'), {
      event: 'join-room',
      requestId: 'req-1',
      userId: 'u-1',
      roomId: 'ABC123',
    });

    const noRoom = { data: { requestId: 'req-2', user: { userId: 'u-2' } } };
    const ctx = socketLogContext(noRoom, 'socket-connected', { socketId: 's-1' });
    assert.equal(ctx.event, 'socket-connected');
    assert.equal(ctx.requestId, 'req-2');
    assert.equal(ctx.roomId, undefined);
  });

  it('lifecycle events are logged (static check)', () => {
    const src = fs.readFileSync(path.join(SERVER_ROOT, 'socket', 'socketManager.js'), 'utf8');
    for (const event of ['socket-connected', 'join-room', 'leave-room', 'socket-disconnected', 'code-change']) {
      assert.ok(src.includes(`'${event}'`), `socketManager must log ${event}`);
    }
    assert.ok(src.includes('socketLogContext(socket'), 'logs must use the shared context helper');
  });

  it('no unstructured console logging remains in runtime code', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'tests') continue;
          walk(full);
        } else if (full.endsWith('.js')) {
          const src = fs.readFileSync(full, 'utf8');
          // config/env.js keeps human-readable boot diagnostics by design
          // (covered by its own redaction test in P0-06).
          if (full.endsWith(`${path.sep}config${path.sep}env.js`)) continue;
          if (/console\.(log|warn|error|info|debug|table)\(/.test(src)) {
            offenders.push(path.relative(SERVER_ROOT, full));
          }
        }
      }
    };
    walk(SERVER_ROOT);
    assert.deepEqual(offenders, [], `unstructured logging in: ${offenders.join(', ')}`);
  });
});

describe('P0-10: Sentry error tracking', () => {
  const REPO_ROOT = path.join(__dirname, '..', '..');
  const CLIENT_SRC = path.join(REPO_ROOT, 'client', 'src');

  it('is a safe no-op without SENTRY_DSN', () => {
    delete process.env.SENTRY_DSN;
    const sentry = require('../config/sentry');
    assert.equal(sentry.initSentry(), null);
    assert.equal(sentry.isEnabled(), false);
    // Must never throw when disabled.
    sentry.captureError(new Error('boom'), { userId: 'u' });
  });

  it('captures a route-style error with release + user/request context', async () => {
    const sentry = require('../config/sentry');
    const captured = [];
    process.env.SENTRY_RELEASE = 'p0-10-test-release';

    try {
      sentry.initSentry({
        dsn: 'https://testkey@sentry.io/12345',
        // Intercept offline: record the event, drop it (no network).
        beforeSend: (event) => {
          captured.push(event);
          return null;
        },
      });
      assert.equal(sentry.isEnabled(), true);

      sentry.captureError(new Error('route boom'), {
        userId: 'u-1',
        roomId: 'ROOM1',
        requestId: 'req-1',
      });
      await sentry.flushSentry(5000);

      assert.equal(captured.length, 1);
      const event = captured[0];
      assert.equal(event.release, 'p0-10-test-release');
      assert.equal(event.exception.values[0].value, 'route boom');
      assert.equal(event.user.id, 'u-1');
      assert.equal(event.tags.requestId, 'req-1');
      assert.equal(event.tags.roomId, 'ROOM1');
    } finally {
      delete process.env.SENTRY_RELEASE;
      await sentry.closeSentry();
    }
  });

  it('server wires init + safety net (static check)', () => {
    const serverSrc = fs.readFileSync(path.join(SERVER_ROOT, 'server.js'), 'utf8');
    assert.ok(serverSrc.includes('initSentry()'), 'server must init Sentry at boot');
    assert.ok(serverSrc.includes("require('./config/sentry')"), 'server must use config/sentry');
    assert.ok(serverSrc.includes('captureError(err, {})'), 'process-level handlers must report');

    const executeSrc = fs.readFileSync(path.join(SERVER_ROOT, 'routes', 'execute.js'), 'utf8');
    assert.ok(executeSrc.includes('captureError(error'), 'execute 500 must report to Sentry');

    const aiSrc = fs.readFileSync(path.join(SERVER_ROOT, 'routes', 'ai.js'), 'utf8');
    assert.ok(aiSrc.includes('captureError(error'), 'AI chat 500 must report to Sentry');
  });

  it('client wires init, boundary and user context from env only (static check)', () => {
    const mainSrc = fs.readFileSync(path.join(CLIENT_SRC, 'main.jsx'), 'utf8');
    assert.ok(mainSrc.includes('initSentry'), 'main.jsx must init Sentry');

    const appSrc = fs.readFileSync(path.join(CLIENT_SRC, 'App.jsx'), 'utf8');
    assert.ok(appSrc.includes('ErrorBoundary'), 'App must wrap routes in an error boundary');

    const authSrc = fs.readFileSync(path.join(CLIENT_SRC, 'contexts', 'AuthContext.jsx'), 'utf8');
    assert.ok(authSrc.includes('setSentryUser'), 'auth must attach the user to reports');

    const sentrySrc = fs.readFileSync(path.join(CLIENT_SRC, 'config', 'sentry.js'), 'utf8');
    assert.ok(sentrySrc.includes('VITE_SENTRY_DSN'), 'DSN must come from env');
    assert.ok(sentrySrc.includes('VITE_SENTRY_RELEASE'), 'release must come from env');

    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(js|jsx)$/.test(entry.name)) {
          if (/sentry\.io/.test(fs.readFileSync(full, 'utf8'))) {
            offenders.push(path.relative(CLIENT_SRC, full));
          }
        }
      }
    };
    walk(CLIENT_SRC);
    assert.deepEqual(offenders, [], `hardcoded Sentry DSN in: ${offenders.join(', ')}`);
  });
});

describe('P0-12: OTP consume logic', () => {
  const crypto = require('node:crypto');
  const OtpVerification = require('../models/OtpVerification');
  const { consumeValidOtp } = require('../routes/auth');

  const realFindOne = OtpVerification.findOne;
  const realDeleteOne = OtpVerification.deleteOne;

  afterEach(() => {
    OtpVerification.findOne = realFindOne;
    OtpVerification.deleteOne = realDeleteOne;
  });

  function sha(otp) {
    return crypto.createHash('sha256').update(String(otp)).digest('hex');
  }

  function stubDb(record) {
    const deleted = [];
    OtpVerification.findOne = async () => record;
    OtpVerification.deleteOne = async (filter) => {
      deleted.push(filter);
      return {};
    };
    return deleted;
  }

  function liveRecord(overrides = {}) {
    return {
      _id: 'otp-id-1',
      email: 'otp@example.com',
      purpose: 'login',
      otpHash: sha('123456'),
      expiresAt: new Date(Date.now() + 60000),
      attempts: 0,
      loginUserId: 'user-1',
      savedAttempts: null,
      save: async function save() {
        this.savedAttempts = this.attempts;
      },
      ...overrides,
    };
  }

  it('rejects when no OTP was requested', async () => {
    stubDb(null);
    const result = await consumeValidOtp({ email: 'otp@example.com', purpose: 'login', otp: '123456' });
    assert.ok(/No active OTP/.test(result.error));
  });

  it('rejects expired OTPs and deletes them', async () => {
    const deleted = stubDb(liveRecord({ expiresAt: new Date(Date.now() - 1000) }));
    const result = await consumeValidOtp({ email: 'otp@example.com', purpose: 'login', otp: '123456' });
    assert.ok(/expired/.test(result.error));
    assert.equal(deleted.length, 1);
  });

  it('rejects after too many attempts and deletes the record', async () => {
    const deleted = stubDb(liveRecord({ attempts: 5 }));
    const result = await consumeValidOtp({ email: 'otp@example.com', purpose: 'login', otp: '123456' });
    assert.ok(/Too many/.test(result.error));
    assert.equal(deleted.length, 1);
  });

  it('rejects a wrong OTP and increments attempts', async () => {
    const record = liveRecord();
    stubDb(record);
    const result = await consumeValidOtp({ email: 'otp@example.com', purpose: 'login', otp: '000000' });
    assert.ok(/Invalid OTP/.test(result.error));
    assert.equal(record.savedAttempts, 1);
  });

  it('consumes a correct OTP and deletes it', async () => {
    const record = liveRecord();
    const deleted = stubDb(record);
    const result = await consumeValidOtp({ email: 'otp@example.com', purpose: 'login', otp: '123456' });
    assert.ok(!result.error);
    assert.equal(result.record, record);
    assert.deepEqual(deleted, [{ _id: 'otp-id-1' }]);
  });
});

describe('P0-12: roomStore.applyDocumentUpdate', () => {
  const Y = require('yjs');
  const RoomModel = require('../models/Room');
  const roomStore = require('../socket/roomStore');

  beforeAll(() => {
    // Pure in-memory behaviour — never touch the database.
    RoomModel.create = async () => ({});
    RoomModel.updateOne = async () => ({});
    RoomModel.findOne = async () => null;
  });

  function yUpdateFor(text) {
    const doc = new Y.Doc();
    doc.getText('content').insert(0, text);
    return Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
  }

  it('merges a remote Yjs update into the file (no overwrite)', async () => {
    const room = await roomStore.createRoom({ userId: 'u-room-1' }, 'P0-12 Room');
    const fileId = room.files[0].id;
    const originalHead = room.files[0].content.slice(0, 20);

    const result = roomStore.applyDocumentUpdate(room.roomId, fileId, yUpdateFor('hello-p0-12'));
    assert.ok(result);
    assert.ok(result.content.includes('hello-p0-12'), 'remote insert must be present');
    assert.ok(result.content.includes(originalHead), 'original content must survive (CRDT merge)');
  });

  it('returns null for an unknown room', () => {
    assert.equal(roomStore.applyDocumentUpdate('NOPE00', 'whatever', yUpdateFor('x')), null);
  });

  it('returns null for an unknown file', async () => {
    const room = await roomStore.createRoom({ userId: 'u-room-2' }, 'P0-12 Room 2');
    assert.equal(roomStore.applyDocumentUpdate(room.roomId, 'no-such-file', yUpdateFor('x')), null);
  });

  it('two sequential updates converge in one document', async () => {
    const room = await roomStore.createRoom({ userId: 'u-room-3' }, 'P0-12 Room 3');
    const fileId = room.files[0].id;
    roomStore.applyDocumentUpdate(room.roomId, fileId, yUpdateFor('alpha'));
    const result = roomStore.applyDocumentUpdate(room.roomId, fileId, yUpdateFor('beta'));
    assert.ok(result.content.includes('alpha'));
    assert.ok(result.content.includes('beta'));
  });
});

describe('P0-12: socket lock enforcement end-to-end (P0-03 regression)', () => {
  const http = require('node:http');
  const jwt = require('jsonwebtoken');
  const { io: ioClient } = require('socket.io-client');
  const { createSocketServer } = require('../socket/socketManager');
  const RoomModel = require('../models/Room');
  const MessageModel = require('../models/Message');
  const roomStore = require('../socket/roomStore');
  const Y = require('yjs');

  const victim = { userId: 'victim-1', name: 'Victim', email: 'victim@example.com' };
  const attacker = { userId: 'attacker-9', name: 'Attacker', email: 'attacker@example.com' };

  let httpServer;
  let io;
  let url;
  let roomId;
  let fileId;
  let victimSocket;
  let attackerSocket;

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

  beforeAll(async () => {
    RoomModel.create = async () => ({});
    RoomModel.updateOne = async () => ({});
    RoomModel.findOne = async () => null;
    MessageModel.create = async (doc) => ({ _id: 'mock-msg', ...doc });

    const room = await roomStore.createRoom({ userId: victim.userId }, 'Lock Room');
    roomId = room.roomId;
    fileId = room.files[0].id;

    httpServer = http.createServer();
    io = createSocketServer(httpServer);
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://127.0.0.1:${httpServer.address().port}`;

    victimSocket = ioClient(url, { auth: { token: sign(victim) } });
    attackerSocket = ioClient(url, { auth: { token: sign(attacker) } });

    victimSocket.emit('join-room', { roomId });
    attackerSocket.emit('join-room', { roomId });
    await waitFor(victimSocket, 'room-joined');
    await waitFor(attackerSocket, 'room-joined');

    victimSocket.emit('request-file-lock', { roomId, fileId });
    // The lock broadcast is the signal the lock is held.
    await waitFor(victimSocket, 'file-locks-updated');
  }, 15000);

  afterAll(async () => {
    victimSocket?.disconnect();
    attackerSocket?.disconnect();
    io?.close();
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }
  });

  it("a second user's edit to a locked file is denied (no bypass)", async () => {
    const noLeak = new Promise((resolve) => {
      const timer = setTimeout(() => resolve('none'), 500);
      victimSocket.once('remote-code-change', (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

    attackerSocket.emit('code-change', { roomId, fileId, changes: 'bogus-update' });
    const denial = await waitFor(attackerSocket, 'lock-denied');
    assert.equal(denial.fileId, fileId);
    assert.equal(denial.lockedBy.userId, victim.userId);

    assert.equal(await noLeak, 'none', 'locked edit must not propagate to peers');
  });

  it('the lock owner can still edit (channel is alive)', async () => {
    const doc = new Y.Doc();
    doc.getText('content').insert(0, 'owner-edit-p0-12');
    const changes = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');

    victimSocket.emit('code-change', { roomId, fileId, changes });
    const remote = await waitFor(attackerSocket, 'remote-code-change');
    assert.equal(remote.fileId, fileId);
  });
});

describe('P0-11: CI pipeline', () => {
  const REPO_ROOT = path.join(__dirname, '..', '..');
  const WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');

  it('defines install, lint, test and build checks', () => {
    assert.ok(fs.existsSync(WORKFLOW), '.github/workflows/ci.yml must exist');
    const workflow = fs.readFileSync(WORKFLOW, 'utf8');

    assert.ok(workflow.includes('pull_request'), 'CI must run on every PR');
    assert.ok(workflow.includes('node-version: 20'), 'CI must pin Node 20');
    assert.ok(workflow.includes('npm ci'), 'CI must do clean installs');

    // Server job: lint + test.
    assert.ok(workflow.includes('npm run lint'), 'CI must lint');
    assert.ok(workflow.includes('npm test'), 'CI must run server tests');

    // Client job: build.
    assert.ok(workflow.includes('npm run build'), 'CI must build the client');

    // Both services are covered.
    assert.ok(workflow.includes('working-directory: server'), 'CI must cover the server');
    assert.ok(workflow.includes('working-directory: client'), 'CI must cover the client');
  });

  it('required npm scripts exist on both sides', () => {
    const serverPkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'server', 'package.json'), 'utf8')
    );
    assert.ok(serverPkg.scripts.lint, 'server needs a lint script');
    assert.ok(serverPkg.scripts.test, 'server needs a test script');

    const clientPkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'client', 'package.json'), 'utf8')
    );
    assert.ok(clientPkg.scripts.lint, 'client needs a lint script');
    assert.ok(clientPkg.scripts.build, 'client needs a build script');
  });
});
