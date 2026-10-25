/**
 * Presence (P2-07): who is in the room, where their cursor is, what they are typing.
 * It travels as Yjs awareness, never through the document, so it is not persisted.
 *
 * Clients cannot be trusted to say who they are: the collab server rewrites every
 * awareness update with `sanitizePresence`, stamping the identity from the verified
 * token and dropping anything that is not part of this shape.
 */

/** Same palette the Socket.IO relay used, so users keep the colours they know. */
export const PRESENCE_COLORS = [
  '#FF6B6B',
  '#4ECDC4',
  '#45B7D1',
  '#F7B32B',
  '#7C3AED',
  '#10B981',
  '#F97316',
  '#EC4899',
  '#3B82F6',
  '#84CC16',
  '#EF4444',
  '#14B8A6',
] as const;

const MAX_NAME_LENGTH = 40;
const MAX_FILE_ID_LENGTH = 100;
const MAX_STATE_BYTES = 2048;

/** FNV-1a: stable across runtimes and releases, which a colour that must never change needs. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** The same user gets the same colour in every room, on every device, with no server state. */
export function colorForUser(userId: string): string {
  return PRESENCE_COLORS[hashString(String(userId)) % PRESENCE_COLORS.length];
}

export function cleanDisplayName(name: unknown): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join('');
}

/** A display name reduced to characters that are safe inside a quoted CSS string (cursor labels). */
export function cssSafeLabel(name: unknown): string {
  const safe = cleanDisplayName(name).replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/ +/g, ' ').trim();
  return Array.from(safe).slice(0, 24).join('') || 'Anonymous';
}

export function glyphForName(name: unknown): string {
  return Array.from(cleanDisplayName(name))[0]?.toUpperCase() ?? 'U';
}

export interface PresenceUser {
  userId: string;
  name: string;
  color: string;
  glyph: string;
}

/** A Yjs relative position as it appears in JSON (see `Y.createRelativePositionFromJSON`). */
export interface RelativePositionJSON {
  type?: { client: number; clock: number } | null;
  tname?: string | null;
  item?: { client: number; clock: number } | null;
  assoc?: number | null;
}

export interface PresenceSelection {
  anchor: RelativePositionJSON;
  head: RelativePositionJSON;
}

export interface PresenceState {
  user: PresenceUser;
  /** The file this person has open. */
  fileId: string | null;
  /** Written by y-monaco: positions inside that file's text, so they follow concurrent edits. */
  selection: PresenceSelection | null;
  /** True from a keystroke until about two seconds of quiet. */
  typing: boolean;
}

export function identityFor(user: { userId: string; name: string }): PresenceUser {
  const name = cleanDisplayName(user.name) || 'Anonymous';
  return { userId: user.userId, name, color: colorForUser(user.userId), glyph: glyphForName(name) };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isId = (value: unknown): boolean =>
  value == null || (isRecord(value) && Number.isSafeInteger(value.client) && Number.isSafeInteger(value.clock));

/** A malformed position would throw inside every peer's editor, so it is checked field by field. */
export function isRelativePosition(value: unknown): value is RelativePositionJSON {
  if (!isRecord(value)) return false;
  if (!isId(value.type) || !isId(value.item)) return false;
  if (value.tname != null && (typeof value.tname !== 'string' || value.tname.length > MAX_FILE_ID_LENGTH + 20)) return false;
  if (value.assoc != null && typeof value.assoc !== 'number') return false;
  return true;
}

function pick(value: unknown): { selection: PresenceSelection | null; fileId: string | null; typing: boolean } {
  const raw = isRecord(value) ? value : {};
  const selection =
    isRecord(raw.selection) && isRelativePosition(raw.selection.anchor) && isRelativePosition(raw.selection.head)
      ? { anchor: raw.selection.anchor, head: raw.selection.head }
      : null;
  const fileId = typeof raw.fileId === 'string' && raw.fileId.length > 0 && raw.fileId.length <= MAX_FILE_ID_LENGTH ? raw.fileId : null;
  return { selection, fileId, typing: raw.typing === true };
}

/**
 * Builds the presence state the server will relay: identity from the verified token,
 * the rest from the client but reduced to known fields of the expected shape and size.
 */
export function sanitizePresence(raw: unknown, user: { userId: string; name: string }): PresenceState {
  const state: PresenceState = { user: identityFor(user), ...pick(raw) };
  // A client that sends something enormous gets only its identity relayed.
  if (JSON.stringify(state).length > MAX_STATE_BYTES) {
    return { user: state.user, fileId: state.fileId, selection: null, typing: state.typing };
  }
  return state;
}

/** Reads a relayed awareness state defensively; null when it is not a usable presence state. */
export function readPresence(raw: unknown): PresenceState | null {
  if (!isRecord(raw) || !isRecord(raw.user)) return null;
  const { userId, name, color, glyph } = raw.user;
  if (typeof userId !== 'string' || userId === '' || typeof name !== 'string') return null;
  return {
    // The colour is re-derived rather than read: it ends up inside generated CSS.
    user: {
      userId,
      name: cleanDisplayName(name) || 'Anonymous',
      color: typeof color === 'string' && (PRESENCE_COLORS as readonly string[]).includes(color) ? color : colorForUser(userId),
      glyph: typeof glyph === 'string' && glyph ? Array.from(glyph)[0] : glyphForName(name),
    },
    ...pick(raw),
  };
}
