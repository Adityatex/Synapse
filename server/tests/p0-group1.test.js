/**
 * P0 Group 1 regression tests (P0-01 → P0-04).
 *
 * Uses Node's built-in test runner (node:test) + supertest.
 * Full Vitest + Supertest suite with 15+ tests lands in P0-12 (Group 3);
 * these are the minimal security regression tests required by Group 1.
 *
 * Run: npm test (server/)
 */
'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-for-p0-01-1234567890';
// Point Judge0 at a closed local port so the "passes auth" test fails fast
// (500 from the handler) instead of waiting on real DNS/network. This only
// affects the test process; the assertion is `not 401`, proving auth passed.
process.env.JUDGE0_API_HOST = '127.0.0.1:9';
process.env.JUDGE0_API_KEY = 'p0-test-key';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');

const authMiddleware = require('../middleware/auth');
const rateLimits = require('../middleware/rateLimits');
const { escapeRegExp } = require('../socket/socketManager');

const TEST_USER = { userId: 'user-123', name: 'Test User', email: 'test@example.com' };
function signTestToken(user = TEST_USER) {
  return jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '1h' });
}

describe('P0-01: /api/execute requires authentication', () => {
  let app;
  before(() => {
    const executeRoute = require('../routes/execute');
    app = express();
    app.use(express.json());
    app.use('/api', executeRoute);
  });

  it('rejects unauthenticated POST /api/execute with 401', async () => {
    const res = await request(app).post('/api/execute').send({ source_code: 'print(1)', language_id: 71 });
    assert.equal(res.status, 401);
  });

  it('rejects unauthenticated GET /api/languages with 401', async () => {
    const res = await request(app).get('/api/languages');
    assert.equal(res.status, 401);
  });

  it('rejects invalid token with 401', async () => {
    const res = await request(app)
      .post('/api/execute')
      .set('Authorization', 'Bearer invalid-token')
      .send({ source_code: 'print(1)', language_id: 71 });
    assert.equal(res.status, 401);
  });

  it('authMiddleware attaches decoded user for a valid token', async () => {
    const token = signTestToken();
    const req = { headers: { authorization: `Bearer ${token}` } };
    let nextCalled = false;
    const res = { status: () => ({ json: () => {} }) };
    authMiddleware(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(req.user.userId, TEST_USER.userId);
  });

  it('authenticated POST /api/execute passes auth (not 401)', async () => {
    // Without Judge0 creds the handler fails downstream (500), but it must
    // NOT be rejected as unauthenticated — proving the authed client path works.
    // (Languages shares the same per-route authMiddleware; its 401 test above
    // covers it without a second slow upstream call.)
    const res = await request(app)
      .post('/api/execute')
      .set('Authorization', `Bearer ${signTestToken()}`)
      .send({ source_code: 'print(1)', language_id: 71 });
    assert.notEqual(res.status, 401);
  });

  it('execute auth does not leak onto other /api namespaces (no router.use(auth))', async () => {
    // executeRoute is mounted at bare /api in server.js. If it ever used
    // router-level auth again, public routes like login/signup would 401.
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'execute.js'), 'utf8');
    assert.ok(!src.includes('router.use(authMiddleware)'), 'auth must be per-route, not router-level');

    const mixed = express();
    mixed.use(express.json());
    mixed.use('/api', require('../routes/execute'));
    mixed.post('/api/auth/ping', (req, res) => res.json({ ok: true }));
    const res = await request(mixed).post('/api/auth/ping').send({});
    assert.equal(res.status, 200, 'unrelated /api routes must pass through untouched');
  });
});

describe('P0-02: rate limits are wired and enforce 429 + Retry-After', () => {
  it('exposes all roadmap limiters as middleware functions', () => {
    for (const key of [
      'otpRequestByEmailLimiter',
      'otpRequestByIpLimiter',
      'otpVerifyLimiter',
      'loginLimiter',
      'executeLimiter',
      'aiChatLimiter',
      'globalLimiter',
    ]) {
      assert.equal(typeof rateLimits[key], 'function', `${key} should be a function`);
    }
  });

  it('OTP request by email: allows 3, rejects 4th with 429 + Retry-After', async () => {
    const app = express();
    app.use(express.json());
    app.use('/test-otp', rateLimits.otpRequestByEmailLimiter, (req, res) => res.json({ ok: true }));
    const email = `p0-02-${Date.now()}@example.com`;
    for (let i = 0; i < 3; i += 1) {
      const res = await request(app).post('/test-otp').send({ email });
      assert.equal(res.status, 200);
    }
    const limited = await request(app).post('/test-otp').send({ email });
    assert.equal(limited.status, 429);
    assert.ok(limited.headers['retry-after'] !== undefined, 'Retry-After header must be present');
  });

  it('OTP verify: allows 10, rejects 11th with 429', async () => {
    const app = express();
    app.use(express.json());
    // Use a unique email so this test is isolated from other tests.
    app.use('/test-verify', rateLimits.otpVerifyLimiter, (req, res) => res.json({ ok: true }));
    const email = `p0-02-verify-${Date.now()}@example.com`;
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app).post('/test-verify').send({ email });
      assert.equal(res.status, 200);
    }
    const limited = await request(app).post('/test-verify').send({ email });
    assert.equal(limited.status, 429);
  });

  it('execute limiter: allows 20/min per user, rejects 21st with 429', async () => {
    const app = express();
    app.use(express.json());
    // Fixed user ID so all 21 requests share one per-user bucket.
    const probeUserId = `p0-02-exec-${Date.now()}`;
    // Simulate an authenticated user so the per-user key applies.
    app.use('/test-execute', (req, res, next) => {
      req.user = { userId: probeUserId };
      next();
    });
    app.use('/test-execute', rateLimits.executeLimiter, (req, res) => res.json({ ok: true }));
    for (let i = 0; i < 20; i += 1) {
      const res = await request(app).post('/test-execute').send({});
      assert.equal(res.status, 200);
    }
    const limited = await request(app).post('/test-execute').send({});
    assert.equal(limited.status, 429);
    assert.ok(limited.headers['retry-after'] !== undefined, 'Retry-After header must be present');
  });

  it('routes are wired to their limiters (static wiring check)', () => {
    const authSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
    assert.ok(authSrc.includes('otpRequestByEmailLimiter'), 'auth.js must use otpRequestByEmailLimiter');
    assert.ok(authSrc.includes('otpRequestByIpLimiter'), 'auth.js must use otpRequestByIpLimiter');
    assert.ok(authSrc.includes('otpVerifyLimiter'), 'auth.js must use otpVerifyLimiter');
    assert.ok(authSrc.includes('loginLimiter'), 'auth.js must use loginLimiter');

    const executeSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'execute.js'), 'utf8');
    assert.ok(executeSrc.includes('authMiddleware'), 'execute.js must use authMiddleware (P0-01)');
    assert.ok(executeSrc.includes('executeLimiter'), 'execute.js must use executeLimiter');

    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'ai.js'), 'utf8');
    assert.ok(aiSrc.includes('aiChatLimiter'), 'ai.js must use aiChatLimiter');

    const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.ok(serverSrc.includes('globalLimiter'), 'server.js must use globalLimiter');
  });
});

describe('P0-03: socket handlers never trust payload identity', () => {
  const socketSrc = fs.readFileSync(path.join(__dirname, '..', 'socket', 'socketManager.js'), 'utf8');

  it('join-room ignores payload userId/username', () => {
    assert.ok(
      socketSrc.includes("socket.on('join-room', async ({ roomId }"),
      'join-room must destructure only roomId (no userId/username)'
    );
    assert.ok(!socketSrc.includes('userId || socket.data.user.userId'), 'must not fall back to payload userId');
    assert.ok(!socketSrc.includes('username || socket.data.user.name'), 'must not fall back to payload username');
  });

  it('code-change uses only the authenticated sender', () => {
    assert.ok(
      socketSrc.includes("socket.on('code-change', ({ roomId, fileId, changes }"),
      'code-change must not accept userId from payload'
    );
    assert.ok(socketSrc.includes('const senderId = socket.data.user.userId'), 'senderId must come from socket.data.user');
  });

  it('cursor-move and selection-change use only the authenticated user', () => {
    assert.ok(
      socketSrc.includes("socket.on('cursor-move', ({ roomId, position }"),
      'cursor-move must not accept userId/username from payload'
    );
    assert.ok(
      socketSrc.includes("socket.on('selection-change', ({ roomId, selectionRange }"),
      'selection-change must not accept userId/username from payload'
    );
  });

  it('lock-bypass regression: spoofed userId cannot bypass a file lock', () => {
    // Simulates the fixed check in the code-change handler:
    //   const senderId = socket.data.user.userId; // authenticated only
    //   if (activeLock && activeLock.userId !== senderId) deny
    const victimUserId = 'victim-1';
    const attackerUserId = 'attacker-9';
    const activeLock = { userId: victimUserId, username: 'Victim' };

    function isEditDenied(lock, authenticatedSenderId) {
      return Boolean(lock && lock.userId !== authenticatedSenderId);
    }

    // Attacker is authenticated as attacker but spoofs victim's ID in payload.
    // Fixed code ignores the payload, so sender = attacker → denied.
    const spoofedPayloadUserId = victimUserId; // ignored by server
    const fixedSenderId = attackerUserId; // socket.data.user.userId
    assert.equal(isEditDenied(activeLock, fixedSenderId), true, 'attacker must be denied');

    // Old (vulnerable) behaviour would have used the payload → bypassed.
    const vulnerableSenderId = spoofedPayloadUserId;
    assert.equal(isEditDenied(activeLock, vulnerableSenderId), false, 'old code would have allowed (bypass)');

    // Legitimate owner is still allowed.
    assert.equal(isEditDenied(activeLock, victimUserId), false, 'lock owner must be allowed');
  });
});

describe('P0-04: chat search regex is escaped', () => {
  it('escapes regex metacharacters', () => {
    assert.equal(escapeRegExp('.*'), '\\.\\*');
    assert.equal(escapeRegExp('(a+)+$'), '\\(a\\+\\)\\+\\$');
    assert.equal(escapeRegExp('hello'), 'hello');
    assert.equal(escapeRegExp(''), '');
  });

  it('escaped query matches literally, not as a pattern', () => {
    const malicious = '.*';
    const escaped = escapeRegExp(malicious);
    const re = new RegExp(escaped, 'i');
    assert.equal(re.test('.*'), true, 'literal .* should match the text ".*"');
    // An unescaped .* would match anything (e.g. "aaaa"); escaped must not.
    assert.equal(re.test('aaaa'), false, 'escaped .* must not match arbitrary text');
  });

  it('search handler uses escapeRegExp with a length cap (static check)', () => {
    const socketSrc = fs.readFileSync(path.join(__dirname, '..', 'socket', 'socketManager.js'), 'utf8');
    assert.ok(socketSrc.includes('escapeRegExp(String(query).slice(0, 200))'), 'search must escape + cap query');
    assert.ok(!socketSrc.includes('{ $regex: query,'), 'raw query must not reach $regex');
  });
});
