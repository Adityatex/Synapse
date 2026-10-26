import type { Db } from 'mongodb';

export interface RoomAccessRecord {
  createdBy?: string;
  members?: Array<{ userId?: string }>;
  /** P2-08: when true, members can take exclusive edit locks on files. Off unless the creator turns it on. */
  locksEnabled?: boolean;
  /** P2-10: absent = never migrated, 2 = lives in collab, 1 = pinned to the classic editor. */
  collabVersion?: number | null;
}

/** Per-room settings the api owns and collab only reads. */
export interface RoomSettings {
  locksEnabled: boolean;
  /** P2-10: 1 = pinned to the classic editor, so collab must not keep a document for the room. */
  collabVersion: number | null;
}

/** 'classic': a member, but the room is pinned to the classic editor, so collab does not serve it. */
export type AccessDecision = 'allowed' | 'denied' | 'not-found' | 'classic';

/**
 * Mirrors the api's invite-only rule (server/routes/rooms.js isRoomMember):
 * the creator and listed members may enter; a legacy room with no members is
 * grandfathered. Roles (viewer/editor) arrive with P3-01.
 */
export function decideAccess(room: RoomAccessRecord | null, userId: string): AccessDecision {
  if (!room) return 'not-found';
  const members = Array.isArray(room.members) ? room.members : [];
  const isMember = room.createdBy === userId || members.length === 0 || members.some((m) => m.userId === userId);
  if (!isMember) return 'denied';
  // Only a member is told how the room is set up.
  return room.collabVersion === 1 ? 'classic' : 'allowed';
}

export interface RoomAccess {
  check(roomId: string, userId: string): Promise<AccessDecision>;
  /** Null when the room does not exist. */
  settings(roomId: string): Promise<RoomSettings | null>;
}

/** Reads the `rooms` collection the api owns. Errors propagate: collab fails closed. */
export function createMongoRoomAccess(db: Db): RoomAccess {
  const rooms = db.collection<RoomAccessRecord & { roomId: string }>('rooms');
  return {
    async check(roomId, userId) {
      const room = await rooms.findOne({ roomId }, { projection: { createdBy: 1, members: 1, collabVersion: 1 } });
      return decideAccess(room, userId);
    },
    async settings(roomId) {
      const room = await rooms.findOne({ roomId }, { projection: { locksEnabled: 1, collabVersion: 1 } });
      return room ? { locksEnabled: room.locksEnabled === true, collabVersion: room.collabVersion ?? null } : null;
    },
  };
}
