'use strict';

// P1-09: contract tests for @synapse/shared (no DB).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-for-p1-09-1234567890';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const shared = require('@synapse/shared');

describe('shared HTTP contracts', () => {
  it('executeSchema accepts valid code, rejects empty', () => {
    assert.equal(shared.executeSchema.safeParse({ source_code: 'print(1)', language_id: 71 }).success, true);
    assert.equal(shared.executeSchema.safeParse({ source_code: '', language_id: 71 }).success, false);
    assert.equal(shared.executeSchema.safeParse({ source_code: 'x' }).success, false);
  });

  it('OTP contracts enforce email + pin shape', () => {
    assert.equal(
      shared.signupRequestOtpSchema.safeParse({ name: 'A', email: 'a@x.com', password: 'secret12' }).success,
      true
    );
    assert.equal(shared.signupVerifyOtpSchema.safeParse({ email: 'a@x.com', otp: '12' }).success, false);
    assert.equal(shared.loginVerifyOtpSchema.safeParse({ email: 'not-an-email', otp: '123456' }).success, false);
  });

  it('aiChatSchema requires a message and bounds history', () => {
    assert.equal(shared.aiChatSchema.safeParse({ message: 'hello' }).success, true);
    assert.equal(shared.aiChatSchema.safeParse({ message: '' }).success, false);
    const big = Array.from({ length: 25 }, (_, i) => ({ role: 'user', content: `m${i}` }));
    assert.equal(shared.aiChatSchema.safeParse({ message: 'hi', history: big }).success, false);
  });

  it('inviteMemberSchema requires userId or email', () => {
    assert.equal(shared.inviteMemberSchema.safeParse({ userId: 'u1' }).success, true);
    assert.equal(shared.inviteMemberSchema.safeParse({ email: 'a@x.com' }).success, true);
    assert.equal(shared.inviteMemberSchema.safeParse({}).success, false);
  });
});

describe('shared socket contracts', () => {
  it('joinRoomSchema + codeChangeSchema shapes', () => {
    assert.equal(shared.joinRoomSchema.safeParse({ roomId: 'ABC123' }).success, true);
    assert.equal(shared.joinRoomSchema.safeParse({}).success, false);
    assert.equal(
      shared.codeChangeSchema.safeParse({ fileId: 'f', changes: 'QUJD' }).success,
      true
    );
    assert.equal(shared.codeChangeSchema.safeParse({ fileId: 'f' }).success, false);
  });

  it('chat + search bounds', () => {
    assert.equal(shared.chatMessageSchema.safeParse({ content: 'hi' }).success, true);
    assert.equal(shared.searchChatMessagesSchema.safeParse({ query: '' }).success, false);
    assert.equal(shared.searchChatMessagesSchema.safeParse({ query: 'x'.repeat(201) }).success, false);
  });
});
