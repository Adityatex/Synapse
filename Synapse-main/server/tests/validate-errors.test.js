'use strict';

// P1-05 + P1-08 unit tests (no DB): validation middleware + envelope helpers.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-for-p1-09-1234567890';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateBody, validateSocketPayload } = require('../middleware/validate');
const { AppError, ok, fail } = require('../lib/errors');

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('validateBody', () => {
  it('passes valid bodies and sets req.validatedBody', () => {
    const req = { body: { source_code: 'print(1)', language_id: 71 }, id: 'req-1' };
    const res = mockRes();
    let next = false;
    validateBody('executeSchema')(req, res, () => {
      next = true;
    });
    assert.equal(next, true);
    assert.equal(req.validatedBody.language_id, 71);
  });

  it('rejects invalid bodies with envelope 400 + requestId', () => {
    const req = { body: { source_code: '' }, id: 'req-2' };
    const res = mockRes();
    let next = false;
    validateBody('executeSchema')(req, res, () => {
      next = true;
    });
    assert.equal(next, false);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.requestId, 'req-2');
    assert.ok(res.body.error.message.length > 0);
  });
});

describe('validateSocketPayload', () => {
  it('accepts valid join-room, rejects garbage', () => {
    assert.equal(validateSocketPayload('joinRoomSchema', { roomId: 'ABC123' }).ok, true);
    assert.equal(validateSocketPayload('joinRoomSchema', {}).ok, false);
    assert.equal(validateSocketPayload('joinRoomSchema', { roomId: '!!!' }).ok, false);
  });
});

describe('AppError + envelope', () => {
  it('ok() wraps data with success + requestId', () => {
    const res = mockRes();
    ok(res, { id: 'r1' }, { hello: 'world' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true, data: { hello: 'world' }, requestId: 'r1' });
  });

  it('fail() sanitizes 500s and keeps 4xx messages', () => {
    const res = mockRes();
    fail(res, { id: 'r2' }, new AppError('db exploded', { status: 500, code: 'DB' }));
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.message, 'Something went wrong. Please try again later.');

    const res2 = mockRes();
    fail(res2, { id: 'r3' }, AppError.badRequest('Invalid request body.', [{ path: 'x' }]));
    assert.equal(res2.statusCode, 400);
    assert.equal(res2.body.error.code, 'BAD_REQUEST');
  });
});
