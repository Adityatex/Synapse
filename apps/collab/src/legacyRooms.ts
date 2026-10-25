import type { LegacyFile } from '@synapse/room-doc';
import type { Db } from 'mongodb';

/** Where a room's files lived before collab: the api's `Room.files`. */
export interface LegacyRooms {
  loadFiles(roomId: string): Promise<LegacyFile[]>;
}

interface RoomWithFiles {
  roomId: string;
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
  };
}
