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
