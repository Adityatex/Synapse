import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { PRESENCE_COLORS, colorForUser, cssSafeLabel, glyphForName, readPresence, sanitizePresence } from './presence.js';

const ada = { userId: 'user-ada', name: 'Ada Lovelace' };

describe('appearance', () => {
  it('derives the colour from the user id alone', () => {
    expect(colorForUser('user-ada')).toBe(colorForUser('user-ada'));
    expect(PRESENCE_COLORS).toContain(colorForUser('user-ada'));
    // Pinned values: a change here recolours every existing user, so it must be deliberate.
    expect(colorForUser('user-ada')).toBe('#EC4899');
    expect(colorForUser('507f1f77bcf86cd799439011')).toBe('#14B8A6');
  });

  it('spreads users across the palette', () => {
    const used = new Set(Array.from({ length: 400 }, (_, i) => colorForUser(`u${i}`)));
    expect(used.size).toBe(PRESENCE_COLORS.length);
  });

  it('takes the glyph from the first character of the name', () => {
    expect(glyphForName('ada')).toBe('A');
    expect(glyphForName('  émile')).toBe('É');
    expect(glyphForName('😀 smile')).toBe('😀');
    expect(glyphForName('')).toBe('U');
    expect(glyphForName(undefined)).toBe('U');
  });
});

describe('sanitizePresence', () => {
  const doc = new Y.Doc();
  const text = doc.getText('content:main');
  text.insert(0, 'hello');
  const selection = {
    anchor: JSON.parse(JSON.stringify(Y.createRelativePositionFromTypeIndex(text, 1))),
    head: JSON.parse(JSON.stringify(Y.createRelativePositionFromTypeIndex(text, 3))),
  };

  it('keeps the fields a client may set and stamps the identity from the token', () => {
    const state = sanitizePresence({ fileId: 'main', typing: true, selection }, ada);
    expect(state).toEqual({
      user: { userId: 'user-ada', name: 'Ada Lovelace', color: colorForUser('user-ada'), glyph: 'A' },
      fileId: 'main',
      typing: true,
      selection,
    });
    // What a peer's editor does with it still works.
    const anchor = Y.createAbsolutePositionFromRelativePosition(state.selection!.anchor as never, doc);
    expect(anchor?.index).toBe(1);
  });

  it('ignores a claimed identity and any unknown field', () => {
    const state = sanitizePresence(
      { user: { userId: 'someone-else', name: 'Mallory', color: 'red; } body { display: none' }, admin: true, fileId: 'main' },
      ada,
    );
    expect(state.user.userId).toBe('user-ada');
    expect(state.user.name).toBe('Ada Lovelace');
    expect(state.user.color).toBe(colorForUser('user-ada'));
    expect(state).not.toHaveProperty('admin');
  });

  it('falls back to safe defaults for garbage', () => {
    for (const raw of [null, undefined, 42, 'x', [], { fileId: 7, typing: 'yes', selection: 'left' }]) {
      expect(sanitizePresence(raw, ada)).toMatchObject({ fileId: null, typing: false, selection: null });
    }
  });

  it('drops a selection that would break a peer, and one that is too large', () => {
    expect(sanitizePresence({ selection: { anchor: { type: 'nope' }, head: selection.head } }, ada).selection).toBeNull();
    expect(sanitizePresence({ selection: { anchor: { item: { client: 1.5, clock: 0 } }, head: selection.head } }, ada).selection).toBeNull();
    expect(sanitizePresence({ selection: { anchor: selection.anchor, head: { tname: 'x'.repeat(5000) } } }, ada).selection).toBeNull();
    expect(sanitizePresence({ fileId: 'x'.repeat(101) }, ada).fileId).toBeNull();
  });

  it('cleans the display name', () => {
    const state = sanitizePresence({}, { userId: 'u', name: '  Bob\n\t"</style>' + 'x'.repeat(100) });
    expect(state.user.name).not.toMatch(/[\n\t]/);
    expect(Array.from(state.user.name).length).toBeLessThanOrEqual(40);
    expect(sanitizePresence({}, { userId: 'u', name: '   ' }).user.name).toBe('Anonymous');
  });
});

describe('readPresence', () => {
  it('accepts what the server relays', () => {
    const relayed = sanitizePresence({ fileId: 'a', typing: true }, ada);
    expect(readPresence(JSON.parse(JSON.stringify(relayed)))).toEqual(relayed);
  });

  it('re-derives a colour that is not from the palette, so it can be put in CSS safely', () => {
    const read = readPresence({ user: { userId: 'u1', name: 'U', color: 'red; background: url(x)', glyph: 'U' } });
    expect(read?.user.color).toBe(colorForUser('u1'));
  });

  it('rejects states without a usable identity', () => {
    for (const raw of [null, {}, { user: {} }, { user: { userId: '', name: 'x' } }, { user: { userId: 'u', name: 5 } }]) {
      expect(readPresence(raw)).toBeNull();
    }
  });
});

describe('cssSafeLabel', () => {
  it('keeps ordinary names and strips anything that could leave a CSS string', () => {
    expect(cssSafeLabel('Ada Lovelace')).toBe('Ada Lovelace');
    expect(cssSafeLabel('Zoë_O.Neil-2')).toBe('Zoë_O.Neil-2');
    expect(cssSafeLabel('x"; } body { display: none; /*')).toBe('x body display none');
    expect(cssSafeLabel('"""')).toBe('Anonymous');
    expect(Array.from(cssSafeLabel('n'.repeat(60))).length).toBe(24);
  });
});
