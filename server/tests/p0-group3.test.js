/**
 * P0 Group 3 tests, part 1 (P0-09 → P0-10).
 *
 * Uses Node's built-in test runner (node:test) + supertest.
 * Migrated to Vitest in P0-12 (same file, new runner).
 *
 * Run: npm test (server/)
 */
'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-for-p0-group3-1234567890';
process.env.JUDGE0_API_HOST = '127.0.0.1:9';
process.env.JUDGE0_API_KEY = 'p0-test-key';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
