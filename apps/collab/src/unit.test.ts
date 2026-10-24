import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { AuthError, documentNameFor, parseDocumentName, verifyAccessToken } from './auth.js';
import { loadConfig } from './config.js';
import { decideAccess } from './roomAccess.js';

const SECRET = 'unit-test-secret-long-enough-1234567890';

describe('verifyAccessToken', () => {
  it('returns the identity from a valid token', () => {
    const token = jwt.sign({ userId: 'u1', name: 'Ada', email: 'a@x.io' }, SECRET);
    expect(verifyAccessToken(token, SECRET)).toMatchObject({ userId: 'u1', name: 'Ada' });
  });

  it('rejects missing, forged and expired tokens', () => {
    expect(() => verifyAccessToken(undefined, SECRET)).toThrow(AuthError);
    expect(() => verifyAccessToken(jwt.sign({ userId: 'u1' }, 'another-secret-entirely-1234567'), SECRET)).toThrow(AuthError);
    expect(() => verifyAccessToken(jwt.sign({ userId: 'u1' }, SECRET, { expiresIn: -10 }), SECRET)).toThrow(AuthError);
  });

  it('rejects a validly signed token that carries no userId', () => {
    expect(() => verifyAccessToken(jwt.sign({ name: 'no id' }, SECRET), SECRET)).toThrow(AuthError);
  });
});

describe('document names', () => {
  it('round-trips a room id', () => {
    expect(parseDocumentName(documentNameFor('AB12CD'))).toBe('AB12CD');
  });

  it('normalises case and refuses anything that is not a room document', () => {
    expect(parseDocumentName('room:ab12cd')).toBe('AB12CD');
    expect(parseDocumentName('AB12CD')).toBeNull();
    expect(parseDocumentName('room:')).toBeNull();
    expect(parseDocumentName('room:../etc')).toBeNull();
    expect(parseDocumentName('user:AB12CD')).toBeNull();
  });
});

describe('decideAccess (mirrors the api invite-only rule)', () => {
  it('allows the creator and listed members, denies everyone else', () => {
    const room = { createdBy: 'owner', members: [{ userId: 'owner' }, { userId: 'guest' }] };
    expect(decideAccess(room, 'owner')).toBe('allowed');
    expect(decideAccess(room, 'guest')).toBe('allowed');
    expect(decideAccess(room, 'stranger')).toBe('denied');
  });

  it('reports a missing room', () => {
    expect(decideAccess(null, 'u1')).toBe('not-found');
  });

  it('grandfathers a legacy room with no members', () => {
    expect(decideAccess({ createdBy: 'owner', members: [] }, 'anyone')).toBe('allowed');
  });
});

describe('loadConfig', () => {
  const base = { JWT_SECRET: SECRET, MONGODB_URI: 'mongodb://localhost/synapse' };

  it('applies defaults', () => {
    const cfg = loadConfig({ ...base, NODE_ENV: 'test' });
    expect(cfg.PORT).toBe(5001);
    expect(cfg.REDIS_URL).toBe('');
  });

  it('fails fast on a missing secret, bad Redis URL, or short production secret', () => {
    expect(() => loadConfig({ MONGODB_URI: base.MONGODB_URI })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ ...base, REDIS_URL: 'http://x' })).toThrow(/REDIS_URL/);
    expect(() => loadConfig({ ...base, JWT_SECRET: 'x'.repeat(20), NODE_ENV: 'production' })).toThrow(/32/);
  });
});
