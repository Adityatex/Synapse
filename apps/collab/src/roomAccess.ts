import type { Db } from 'mongodb';

export interface RoomAccessRecord {
  createdBy?: string;
  members?: Array<{ userId?: string }>;
  /** P2-08: when true, members can take exclusive edit locks on files. Off unless the creator turns it on. */
  locksEnabled?: boolean;
}

/** Per-room settings the api owns and collab only reads. */
export interface RoomSettings {
  locksEnabled: boolean;
}

export type AccessDecision = 'allowed' | 'denied' | 'not-found';

/**
 * Mirrors the api's invite-only rule (server/routes/rooms.js isRoomMember):
 * the creator and listed members may enter; a legacy room with no members is
 * grandfathered. Roles (viewer/editor) arrive with P3-01.
 */
export function decideAccess(room: RoomAccessRecord | null, userId: string): AccessDecision {
  if (!room) return 'not-found';
  const members = Array.isArray(room.members) ? room.members : [];
  const isMember = room.createdBy === userId || members.length === 0 || members.some((m) => m.userId === userId);
  return isMember ? 'allowed' : 'denied';
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
      const room = await rooms.findOne({ roomId }, { projection: { createdBy: 1, members: 1 } });
      return decideAccess(room, userId);
    },
    async settings(roomId) {
      const room = await rooms.findOne({ roomId }, { projection: { locksEnabled: 1 } });
      return room ? { locksEnabled: room.locksEnabled === true } : null;
    },
  };
}
