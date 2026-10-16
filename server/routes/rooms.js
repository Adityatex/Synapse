const express = require('express');
const authMiddleware = require('../middleware/auth');
const { logger } = require('../lib/logger');
const { captureException } = require('../lib/sentry');
const { validateBody } = require('../middleware/validate');
const Room = require('../models/Room');
const User = require('../models/User');
const { createRoom, getRoomSnapshot } = require('../socket/roomStore');

const router = express.Router();

// P0-16: invite-only guard. Creator + recorded members may access.
// Legacy rooms with an empty members list are grandfathered (any authed user
// may join once, which records membership for subsequent joins).
function isRoomMember(dbRoom, userId) {
  if (!dbRoom || !userId) return false;
  if (dbRoom.createdBy === userId) return true;
  if (!Array.isArray(dbRoom.members) || dbRoom.members.length === 0) return true;
  return dbRoom.members.some((m) => m.userId === userId);
}

router.post('/', authMiddleware, validateBody('createRoomSchema'), async (req, res) => {
  const { roomName } = req.body;
  if (!roomName) {
    return res.status(400).json({ error: 'Room name is required.', requestId: req.id });
  }

  try {
    const room = await createRoom(req.user, roomName);
    res.status(201).json({
      room: {
        roomId: room.roomId,
        roomName: room.roomName,
        createdAt: room.createdAt,
        createdBy: room.createdBy,
        participantCount: room.participants ? room.participants.length : 0,
      },
    });
  } catch (error) {
    logger.error({ err: error.message || error, requestId: req.id }, 'Create room error');
    captureException(error, { extra: { requestId: req.id } });
    res.status(500).json({ error: 'Failed to create room.', requestId: req.id });
  }
});

router.get('/recent/:userId', authMiddleware, async (req, res) => {
  if (req.user.userId !== req.params.userId) {
    return res.status(403).json({ error: 'You can only view your own rooms.', requestId: req.id });
  }

  try {
    const rooms = await Room.find({ createdBy: req.params.userId })
      .sort({ lastUpdated: -1 })
      .limit(20);
    res.json(rooms);
  } catch (error) {
    logger.error({ err: error.message || error, requestId: req.id }, 'Fetch recent rooms error');
    res.status(500).json({ error: 'Failed to fetch recent rooms.', requestId: req.id });
  }
});

router.get('/shared/:userId', authMiddleware, async (req, res) => {
  if (req.user.userId !== req.params.userId) {
    return res.status(403).json({ error: 'You can only view rooms shared with you.', requestId: req.id });
  }

  try {
    const rooms = await Room.find({
      createdBy: { $ne: req.params.userId },
      members: {
        $elemMatch: { userId: req.params.userId },
      },
    }).sort({ lastUpdated: -1 });

    res.json(rooms);
  } catch (error) {
    logger.error({ err: error.message || error, requestId: req.id }, 'Fetch shared rooms error');
    res.status(500).json({ error: 'Failed to fetch shared rooms.', requestId: req.id });
  }
});

// P0-16: creator/members-only invite endpoint. Only the creator can invite.
router.post('/:roomId/invite', authMiddleware, validateBody('inviteMemberSchema'), async (req, res) => {
  const roomId = String(req.params.roomId || '').trim().toUpperCase();
  const { userId, email, username } = req.body || {};

  try {
    const room = await Room.findOne({ roomId });
    if (!room) {
      return res.status(404).json({ error: 'Room not found.', requestId: req.id });
    }
    if (room.createdBy !== req.user.userId) {
      return res.status(403).json({ error: 'Only the room creator can invite members.', requestId: req.id });
    }

    let inviteUserId = String(userId || '').trim();
    let inviteUsername = String(username || '').trim();

    if (!inviteUserId && email) {
      const user = await User.findOne({ email: String(email).toLowerCase().trim() });
      if (!user) {
        return res.status(404).json({ error: 'No user found for that email.', requestId: req.id });
      }
      inviteUserId = user._id.toString();
      inviteUsername = inviteUsername || user.name || '';
    }

    if (!inviteUserId) {
      return res.status(400).json({ error: 'userId or email is required.', requestId: req.id });
    }

    const already = (room.members || []).some((m) => m.userId === inviteUserId);
    if (!already) {
      room.members.push({
        userId: inviteUserId,
        username: inviteUsername,
        joinedAt: new Date(),
        lastVisitedAt: new Date(),
      });
      await room.save();
    }

    return res.status(201).json({ message: 'Member invited.', roomId, userId: inviteUserId });
  } catch (error) {
    logger.error({ err: error.message || error, requestId: req.id }, 'Invite member error');
    return res.status(500).json({ error: 'Failed to invite member.', requestId: req.id });
  }
});

router.get('/:roomId', authMiddleware, async (req, res) => {
  const roomId = String(req.params.roomId || '').trim().toUpperCase();

  // Try to find active in-memory room first
  const room = getRoomSnapshot(roomId);

  if (!room) {
    try {
      const dbRoom = await Room.findOne({ roomId });
      if (dbRoom) {
        // P0-16: enforce invite-only access on DB rooms.
        if (!isRoomMember(dbRoom, req.user.userId)) {
          return res.status(403).json({ error: 'You are not a member of this room.', requestId: req.id });
        }
        return res.json({
          room: {
            roomId: dbRoom.roomId,
            roomName: dbRoom.roomName,
            createdAt: dbRoom.createdAt,
            createdBy: dbRoom.createdBy,
            participantCount: 0,
          },
        });
      }
    } catch (e) {
      logger.error({ err: e.message || e, requestId: req.id }, 'DB fetch error');
      return res.status(500).json({ error: 'Failed to fetch room.', requestId: req.id });
    }
  } else {
    try {
      const dbRoom = await Room.findOne({ roomId });
      if (dbRoom && !isRoomMember(dbRoom, req.user.userId)) {
        return res.status(403).json({ error: 'You are not a member of this room.', requestId: req.id });
      }
    } catch (e) {
      logger.error({ err: e.message || e, requestId: req.id }, 'DB fetch error');
    }
    return res.json({
      room: {
        roomId: room.roomId,
        roomName: room.roomName,
        createdAt: room.createdAt,
        createdBy: room.createdBy,
        participantCount: room.participants ? room.participants.length : 0,
      },
    });
  }

  return res.status(404).json({
    error: 'Room not found.',
    requestId: req.id,
  });
});

router.delete('/:roomId', authMiddleware, async (req, res) => {
  const roomId = String(req.params.roomId || '').trim().toUpperCase();

  try {
    const room = await Room.findOne({ roomId });

    if (!room) {
      return res.status(404).json({ error: 'Room not found.', requestId: req.id });
    }

    // Only the creator can delete
    if (room.createdBy !== req.user.userId) {
      return res.status(403).json({ error: 'Only the room creator can delete this room.', requestId: req.id });
    }

    await Room.deleteOne({ roomId });
    res.json({ message: 'Room deleted successfully.' });
  } catch (error) {
    logger.error({ err: error.message || error, requestId: req.id }, 'Delete room error');
    res.status(500).json({ error: 'Failed to delete room.', requestId: req.id });
  }
});

module.exports = router;
module.exports.isRoomMember = isRoomMember;
