import { createRequire } from 'node:module';
import { colorForUser as collabColor, glyphForName } from '@synapse/room-doc';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { colorForUser, buildParticipantAppearance } = require('../../socket/roomStore');

// The legacy relay colours cursors on the server; collab-mode clients colour them from
// @synapse/room-doc. A person must look the same on either path.
describe('participant appearance', () => {
  it('matches the collab presence palette for any user id', () => {
    const ids = ['user-ada', '507f1f77bcf86cd799439011', '', 'ünïcode-ıd', ...Array.from({ length: 500 }, (_, i) => `u${i}`)];
    for (const id of ids) expect(colorForUser(id)).toBe(collabColor(id));
  });

  it('derives colour and glyph from the user alone, not from who else is in the room', () => {
    expect(buildParticipantAppearance('user-ada', 'Ada')).toEqual({ cursorColor: collabColor('user-ada'), avatarGlyph: 'A' });
    expect(buildParticipantAppearance('user-ada', 'Ada')).toEqual(buildParticipantAppearance('user-ada', 'Ada'));
    for (const name of ['émile', '😀 smile', '  bob', '']) {
      expect(buildParticipantAppearance('u', name).avatarGlyph).toBe(glyphForName(name));
    }
  });
});
