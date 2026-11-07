const { logger } = require('./logger');
const RoomModel = require('../models/Room');

const ROOM_ID_LENGTH = 6;
const ROOM_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// The file a new room starts with. The collab server builds the room's document from `Room.files` the
// first time the room is opened (P2-10), so this is the room's seed and nothing writes it afterwards.
const DEFAULT_ROOM_FILE = {
  id: 'welcome-py',
  name: 'main.py',
  content:
    'print("Welcome to Synapse collaborative mode!")\nprint("Invite someone to this room and start coding together.")\n',
};

function generateRoomId() {
  let roomId = '';
  for (let index = 0; index < ROOM_ID_LENGTH; index += 1) {
    roomId += ROOM_ID_ALPHABET[Math.floor(Math.random() * ROOM_ID_ALPHABET.length)];
  }
  return roomId;
}

/**
 * Creates a room with its creator as the first member (P0-16: invite-only checks pass for them).
 * Returns `{ roomId, roomName, createdBy, createdAt }`; throws if it cannot be saved.
 */
async function createRoom(owner, roomName = 'Untitled Room') {
  const createdAt = Date.now();
  for (let attempt = 0; ; attempt += 1) {
    const roomId = generateRoomId();
    try {
      await RoomModel.create({
        roomId,
        roomName,
        createdBy: owner.userId,
        members: [
          {
            userId: owner.userId,
            username: owner.name || '',
            joinedAt: new Date(createdAt),
            lastVisitedAt: new Date(createdAt),
          },
        ],
        files: [{ id: DEFAULT_ROOM_FILE.id, name: DEFAULT_ROOM_FILE.name, content: DEFAULT_ROOM_FILE.content, updatedAt: createdAt }],
        lastUpdated: createdAt,
        createdAt,
      });
      return { roomId, roomName, createdBy: owner.userId, createdAt };
    } catch (err) {
      // 11000: the id is taken (the unique index on roomId). Draw another.
      if (err?.code === 11000 && attempt < 5) {
        logger.warn({ roomId }, 'Room id collision, drawing another');
        continue;
      }
      throw err;
    }
  }
}

module.exports = { createRoom, generateRoomId, DEFAULT_ROOM_FILE };
