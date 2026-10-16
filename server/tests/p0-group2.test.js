/**
 * P0 Group 2 regression tests (P0-05 → P0-16, no DB/network required).
 *
 * Run: npm test (server/)
 */
'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-for-p0-01-1234567890';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateEnv } = require('../config/env');
const { requestIdMiddleware } = require('../middleware/requestId');
const authHelpers = require('../routes/auth');
const { isRoomMember } = require('../routes/rooms');
const roomStore = require('../socket/roomStore');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('P0-05: helmet + restricted JSON body', () => {
  it('server.js uses helmet and a restrictive json limit', () => {
    const src = read('server.js');
    assert.ok(src.includes("require('helmet')"), 'helmet must be required');
    assert.ok(src.includes('app.use(helmet('), 'helmet middleware must be used');
    assert.ok(!src.includes("limit: '5mb'"), '5mb body limit must be gone');
    assert.ok(/express\.json\(\{\s*limit:\s*'1mb'\s*\}\)/.test(src), 'json limit should be 1mb');
  });
});

describe('P0-06: boot-time zod env validation', () => {
  it('accepts a valid test env', () => {
    const env = validateEnv({
      ...process.env,
      JWT_SECRET: 'a-very-long-test-secret-1234567890',
      NODE_ENV: 'test',
      MONGODB_URI: '',
      CORS_ORIGIN: 'https://example.com',
    });
    assert.equal(env.JWT_SECRET, 'a-very-long-test-secret-1234567890');
  });

  it('rejects placeholder/short JWT_SECRET', () => {
    assert.throws(() => validateEnv({ ...process.env, JWT_SECRET: 'short', NODE_ENV: 'test' }), /JWT_SECRET/);
    assert.throws(
      () => validateEnv({ ...process.env, JWT_SECRET: 'replace_with_a_secure_secret_and_more_chars_here', NODE_ENV: 'test' }),
      /JWT_SECRET/
    );
  });

  it('requires MONGODB_URI + CORS in production', () => {
    assert.throws(
      () =>
        validateEnv({
          ...process.env,
          NODE_ENV: 'production',
          JWT_SECRET: 'a-very-long-production-secret-1234567890',
          MONGODB_URI: '',
          CORS_ORIGIN: '',
          CLIENT_URL: '',
        }),
      /MONGODB_URI/
    );
  });
});

describe('P0-07: generic errors + correlation ID', () => {
  it('requestId middleware sets req.id + X-Request-Id', () => {
    const req = { headers: {}, id: undefined };
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; } };
    let next = false;
    requestIdMiddleware(req, res, () => { next = true; });
    assert.equal(next, true);
    assert.ok(req.id && req.id.length >= 8);
    assert.equal(res.headers['X-Request-Id'], req.id);
  });

  it('ai chat never leaks upstream details (static check)', () => {
    const src = read('routes/ai.js');
    assert.ok(!src.includes('upstreamMessage'), 'upstream error must not be returned');
    assert.ok(src.includes('Failed to generate AI response. Please try again later.'), 'generic message required');
  });

  it('execute never leaks Judge0 details (static check)', () => {
    const src = read('routes/execute.js');
    assert.ok(!src.includes('error.response?.data?.message ||'), 'Judge0 details must stay server-side');
  });

  it('rate limit 429s include handler with correlation ID (static check)', () => {
    const src = read('middleware/rateLimits.js');
    assert.ok(src.includes('rateLimitHandler'), '429 handler must exist');
    assert.ok(src.includes('requestId: req.id'), '429 must include requestId');
  });
});

describe('P0-08: legacy cleanup + single context dir', () => {
  it('no legacy-code-change handler remains', () => {
    assert.ok(!read('socket/socketManager.js').includes('legacy-code-change'), 'legacy handler must be deleted');
  });

  it('no debug.log writer remains in auth routes', () => {
    const src = read('routes/auth.js');
    assert.ok(!src.includes('debugLog'), 'debugLog must be removed');
    assert.ok(!src.includes('debug.log'), 'debug.log writes must be removed');
  });

  it('client has a single context dir', () => {
    assert.ok(!fs.existsSync(path.join(ROOT, '..', 'client', 'src', 'contexts')), 'client/src/contexts must be gone');
    assert.ok(fs.existsSync(path.join(ROOT, '..', 'client', 'src', 'context', 'FileContext.jsx')), 'FileContext must live in context/');
  });
});

describe('P0-09: pino structured logging + request logging', () => {
  it('server wires pino-http after requestId', () => {
    const src = read('server.js');
    assert.ok(src.includes('pino-http'), 'pino-http required');
    assert.ok(src.includes('requestIdMiddleware'), 'requestId required');
    assert.ok(src.indexOf('app.use(requestIdMiddleware)') < src.indexOf('pinoHttp({'), 'requestId must run before logging');
  });

  it('logger module exists with redaction', () => {
    const src = read('lib/logger.js');
    assert.ok(src.includes('pino('), 'pino logger required');
    assert.ok(src.includes('redact'), 'sensitive fields must be redacted');
  });
});

describe('P0-10: Sentry with release tagging', () => {
  it('server sentry helper exists and server.js inits it', () => {
    assert.ok(read('lib/sentry.js').includes('SENTRY_DSN'), 'server sentry helper required');
    assert.ok(read('server.js').includes('initSentry()'), 'server must init sentry');
  });

  it('client main.jsx inits sentry with release', () => {
    const src = fs.readFileSync(path.join(ROOT, '..', 'client', 'src', 'main.jsx'), 'utf8');
    assert.ok(src.includes('@sentry/react'), 'client sentry required');
    assert.ok(src.includes('VITE_SENTRY_DSN'), 'DSN-gated init required');
    assert.ok(src.includes('release'), 'release tagging required');
  });
});

describe('P0-12: OTP helpers', () => {
  it('hashOtp is deterministic and distinguishes codes', () => {
    const a = authHelpers.hashOtp('123456');
    assert.equal(a, authHelpers.hashOtp('123456'));
    assert.notEqual(a, authHelpers.hashOtp('654321'));
    assert.equal(a.length, 64);
  });

  it('generateOtpCode emits 6 digits', () => {
    for (let i = 0; i < 20; i += 1) {
      assert.match(authHelpers.generateOtpCode(), /^\d{6}$/);
    }
  });

  it('normalizeEmail lowercases/trims', () => {
    assert.equal(authHelpers.normalizeEmail('  Test@Example.COM '), 'test@example.com');
  });
});

describe('P0-12/P0-16: roomStore + invite guard (no DB)', () => {
  it('unknown rooms return null without throwing', () => {
    assert.equal(roomStore.getRoomSnapshot('NOPEXX'), null);
    assert.equal(roomStore.addParticipant('NOPEXX', { socketId: 's', userId: 'u' }), null);
    assert.equal(roomStore.applyDocumentUpdate('NOPEXX', 'f', 'AAAA'), null);
    assert.equal(roomStore.removeParticipant('NOPEXX', 's'), null);
  });

  it('isRoomMember: creator and members pass, strangers fail', () => {
    const room = { createdBy: 'creator-1', members: [{ userId: 'member-2' }] };
    assert.equal(isRoomMember(room, 'creator-1'), true);
    assert.equal(isRoomMember(room, 'member-2'), true);
    assert.equal(isRoomMember(room, 'stranger-9'), false);
  });

  it('isRoomMember grandfathers legacy rooms with empty members', () => {
    assert.equal(isRoomMember({ createdBy: 'c', members: [] }, 'anyone'), true);
  });

  it('rooms router exposes invite endpoint + socket guard exists (static check)', () => {
    const routesSrc = read('routes/rooms.js');
    assert.ok(routesSrc.includes('/invite'), 'invite endpoint required');
    assert.ok(routesSrc.includes('Only the room creator can invite'), 'invite must be creator-only');
    const socketSrc = read('socket/socketManager.js');
    assert.ok(socketSrc.includes('invite-only guard'), 'socket join guard required');
    assert.ok(socketSrc.includes('You are not a member of this room'), 'socket must deny strangers');
  });
});
