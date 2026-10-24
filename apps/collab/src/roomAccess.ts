import type { Db } from 'mongodb';

export interface RoomAccessRecord {
  createdBy?: string;
  members?: Array<{ userId?: string }>;
}

export type AccessDecision = 'allowed' | 'denied' | 'not-found';

/**
 * Mirrors the api's invite-only rule (server/routes/rooms.js isRoomMember):
 * the creator and listed members may enter; a legacy room with no members is
 * grandfathered. Roles (viewer/editor) arrive with P3-01.
 */
export function decideAccess(room: RoomAccessRecord | null, userId: string): AccessDecision {
  if (!room) return 'not-found';
  if (room.createdBy === userId) return 'allowed';
  const members = Array.isArray(room.members) ? room.members : [];
  if (members.length === 0) return 'allowed';
  return members.some((m) => m.userId === userId) ? 'allowed' : 'denied';
}

export interface RoomAccess {
  check(roomId: string, userId: string): Promise<AccessDecision>;
}

/** Reads the `rooms` collection the api owns. Errors propagate: collab fails closed. */
export function createMongoRoomAccess(db: Db): RoomAccess {
  const rooms = db.collection<RoomAccessRecord & { roomId: string }>('rooms');
  return {
    async check(roomId, userId) {
      const room = await rooms.findOne({ roomId }, { projection: { createdBy: 1, members: 1 } });
      return decideAccess(room, userId);
    },
  };
}
