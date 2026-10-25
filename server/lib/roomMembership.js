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

// P0-16: invite-only guard. Creator + recorded members may access.
// Legacy rooms with an empty members list are grandfathered (any authed user
// may join once, which records membership for subsequent joins).
function isRoomMember(dbRoom, userId) {
  if (!dbRoom || !userId) return false;
  if (dbRoom.createdBy === userId) return true;
  if (!Array.isArray(dbRoom.members) || dbRoom.members.length === 0) return true;
  return dbRoom.members.some((m) => m.userId === userId);
}

module.exports = { recordRoomMembership, isRoomMember };
