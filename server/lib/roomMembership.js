const RoomModel = require('../models/Room');
const { logger } = require('./logger');

// Adds the user to the room's members (or refreshes username/lastVisitedAt).
// Shared by socket join-room and the HTTP invite-accept route.
async function recordRoomMembership(roomId, participant) {
  const userId = String(participant?.userId || '').trim();
  if (!roomId || !userId) {
    return;
  }

  const username = String(participant?.username || '').trim();
  const now = new Date();

  try {
    const updateResult = await RoomModel.updateOne(
      {
        roomId,
        'members.userId': userId,
      },
      {
        $set: {
          'members.$.username': username,
          'members.$.lastVisitedAt': now,
        },
      }
    );

    if (updateResult.matchedCount > 0) {
      return;
    }

    await RoomModel.updateOne(
      {
        roomId,
        'members.userId': { $ne: userId },
      },
      {
        $push: {
          members: {
            userId,
            username,
            joinedAt: now,
            lastVisitedAt: now,
          },
        },
      }
    );
  } catch (error) {
    logger.error({ err: error.message || error }, 'Failed to record room membership:');
  }
}

module.exports = { recordRoomMembership };
