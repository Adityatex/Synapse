/**
 * P0 Group 2 regression tests (P0-05 → P0-08).
 *
 * Uses Node's built-in test runner (node:test) + supertest.
 * Full Vitest suite lands in P0-12 (Group 3); these are the minimal
 * acceptance tests required by Group 2.
 *
 * Run: npm test (server/)
 */
'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-for-p0-group2-1234567890';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const request = require('supertest');

const requestIdMiddleware = require('../middleware/requestId');

function buildP0_05App() {
  // Mirrors the middleware order in server.js (P0-05): execute declares its
  // own per-ROUTE 2 MB parser (like routes/execute.js) so unrelated /api/*
  // traffic falls through unparsed to the 100 kB default below.
  const app = express();
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );
  app.use(requestIdMiddleware);
  const executeSim = express.Router();
  executeSim.post('/', express.json({ limit: '2mb' }), (req, res) =>
    res.json({ ok: true, requestId: req.id })
  );
  app.use('/api', executeSim);
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/auth/login', (req, res) => res.json({ ok: true }));
  // Body-parser error normalization (same as server.js).
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body too large.', requestId: req.id });
    }
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({ error: 'Invalid JSON body.', requestId: req.id });
    }
    return next(err);
  });
  return app;
}

describe('P0-05: helmet + body limits', () => {
  it('sets security headers on responses', async () => {
    const res = await request(buildP0_05App()).get('/api');
    assert.ok(res.headers['x-content-type-options'] !== undefined, 'X-Content-Type-Options must be present');
    assert.ok(res.headers['x-frame-options'] !== undefined, 'X-Frame-Options must be present');
    assert.ok(res.headers['referrer-policy'] !== undefined, 'Referrer-Policy must be present');
  });

  it('rejects a 1 MB body to a default-budget endpoint with 413 JSON', async () => {
    const bigBody = { data: 'x'.repeat(1024 * 1024) };
    const res = await request(buildP0_05App()).post('/api/auth/login').send(bigBody);
    assert.equal(res.status, 413);
    assert.ok(res.body.error, '413 must carry a JSON error');
  });

  it('accepts a 1 MB body on the 2 MB execute budget', async () => {
    const bigBody = { source_code: 'x'.repeat(1024 * 1024) };
    const res = await request(buildP0_05App()).post('/api').send(bigBody);
    assert.equal(res.status, 200);
  });

  it('every response carries a request ID (header + body)', async () => {
    const app = buildP0_05App();
    const res = await request(app).post('/api').send({ hello: 'world' });
    assert.equal(res.status, 200);
    assert.ok(res.headers['x-request-id'], 'X-Request-Id header must be present');
    assert.equal(res.body.requestId, res.headers['x-request-id'], 'body requestId must match header');
  });

  it('server.js matches the required P0-05 shape (static check)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.ok(src.includes('helmet('), 'server.js must use helmet');
    assert.ok(src.includes("limit: '100kb'"), 'default JSON budget must be 100 kB');
    assert.ok(!src.includes("limit: '5mb'"), 'the old 5 MB global budget must be gone');
    const executeSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'execute.js'), 'utf8');
    assert.ok(executeSrc.includes("limit: '2mb'"), 'execute router must declare its 2 MB budget');
    const socketSrc = fs.readFileSync(path.join(__dirname, '..', 'socket', 'socketManager.js'), 'utf8');
    assert.ok(socketSrc.includes('maxHttpBufferSize'), 'socket server must bound its buffer (sync budget)');
  });
});
