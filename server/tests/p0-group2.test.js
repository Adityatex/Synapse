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
const { execFileSync } = require('node:child_process');
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

describe('P0-06: boot-time env validation', () => {
  const { validateEnv, loadEnvOrExit, logConfigTable } = require('../config/env');
  const LONG_SECRET = 'test-secret-that-is-long-enough-for-p0-06-1234567890';

  it('rejects a missing JWT_SECRET', () => {
    const result = validateEnv({ NODE_ENV: 'test' });
    assert.equal(result.success, false);
    assert.ok(result.error.issues.some((i) => i.path.includes('JWT_SECRET')));
  });

  it('rejects a short JWT_SECRET (< 32 chars)', () => {
    const result = validateEnv({ NODE_ENV: 'test', JWT_SECRET: 'too-short' });
    assert.equal(result.success, false);
    assert.ok(result.error.issues.some((i) => i.path.includes('JWT_SECRET')));
  });

  it('allows dev/test without MONGODB_URI or CORS_ORIGIN (warn-only)', () => {
    const result = validateEnv({ NODE_ENV: 'test', JWT_SECRET: LONG_SECRET });
    assert.equal(result.success, true);
  });

  it('requires MONGODB_URI and CORS_ORIGIN in production', () => {
    const missingBoth = validateEnv({ NODE_ENV: 'production', JWT_SECRET: LONG_SECRET });
    assert.equal(missingBoth.success, false);
    const paths = missingBoth.error.issues.map((i) => i.path.join('.'));
    assert.ok(paths.includes('MONGODB_URI'));
    assert.ok(paths.includes('CORS_ORIGIN'));

    const complete = validateEnv({
      NODE_ENV: 'production',
      JWT_SECRET: LONG_SECRET,
      MONGODB_URI: 'mongodb://localhost:27017/synapse',
      CORS_ORIGIN: 'https://app.example.com',
    });
    assert.equal(complete.success, true);
  });

  it('missing JWT_SECRET exits 1 with a clear message BEFORE listening', () => {
    const serverDir = path.join(__dirname, '..');
    const childEnv = { ...process.env, NODE_ENV: 'test' };
    delete childEnv.JWT_SECRET;

    let output = '';
    let status = 0;
    try {
      output = execFileSync(
        process.execPath,
        ['-e', "require('./config/env').loadEnvOrExit()"],
        { cwd: serverDir, env: childEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch (err) {
      status = err.status;
      output = `${err.stdout || ''}${err.stderr || ''}`;
    }

    assert.equal(status, 1, 'must exit with code 1');
    assert.ok(output.includes('JWT_SECRET'), 'message must name the missing variable');
    assert.ok(!output.includes('Synapse server running'), 'must exit before listen()');
  });

  it('never prints secret values in the config log', () => {
    const fakeSecret = `p0-06-supersecret-${Date.now()}`;
    let captured = '';
    const origLog = console.log;
    const origTable = console.table;
    const origWarn = console.warn;
    console.log = (...args) => {
      captured += `${args.join(' ')}\n`;
    };
    console.table = (rows) => {
      captured += JSON.stringify(rows);
    };
    console.warn = () => {};
    try {
      logConfigTable({
        NODE_ENV: 'test',
        PORT: 5000,
        JWT_SECRET: fakeSecret,
        MONGODB_URI: 'mongodb://localhost:27017/synapse',
        CORS_ORIGIN: 'https://app.example.com',
      });
    } finally {
      console.log = origLog;
      console.table = origTable;
      console.warn = origWarn;
    }
    assert.ok(!captured.includes(fakeSecret), 'secret value must be redacted');
    assert.ok(captured.includes('JWT_SECRET'), 'setting name must still be listed');
  });

  it('server.js validates env before anything else (static check)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const validateAt = src.indexOf('loadEnvOrExit()');
    const listenAt = src.indexOf('server.listen(');
    assert.ok(validateAt > 0, 'server.js must call loadEnvOrExit');
    assert.ok(validateAt < listenAt, 'validation must run before listen()');
  });
});
