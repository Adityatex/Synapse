import type { LegacyFile } from '@synapse/room-doc';
import type { Db } from 'mongodb';

/** Where a room's files lived before collab: the api's `Room.files`. */
export interface LegacyRooms {
  loadFiles(roomId: string): Promise<LegacyFile[]>;
  /**
   * Records that the room now lives in collab (`collabVersion: 2`), so a later open knows it was
   * migrated and `migrate --all` skips it.
   */
  markMigrated(roomId: string): Promise<void>;
}

interface RoomWithFiles {
  roomId: string;
  collabVersion?: number | null;
  files?: Array<{
    id: string;
    name: string;
    type?: 'file' | 'folder';
    parentId?: string | null;
    order?: number;
    content?: string;
    updatedAt?: Date;
  }>;
}

export function createMongoLegacyRooms(db: Db): LegacyRooms {
  const rooms = db.collection<RoomWithFiles>('rooms');
  return {
    async loadFiles(roomId) {
      const room = await rooms.findOne({ roomId }, { projection: { files: 1 } });
      return room?.files ?? [];
    },
    async markMigrated(roomId) {
      await rooms.updateOne({ roomId, collabVersion: { $ne: 2 } }, { $set: { collabVersion: 2 } });
    },
  };
}
