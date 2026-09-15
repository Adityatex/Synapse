const express = require('express');
const authMiddleware = require('../middleware/auth');
const Room = require('../models/Room');
const logger = require('../config/logger');
const { createRoom, getRoom, getRoomSnapshot } = require('../socket/roomStore');

const router = express.Router();

router.post('/', authMiddleware, async (req, res) => {
  const { roomName, isInviteOnly } = req.body;
  if (!roomName) {
    return res.status(400).json({ error: 'Room name is required.', requestId: req.id });
  }

  try {
    // P0-16: creator may mark the room invite-only at creation.
    const room = await createRoom(req.user, roomName, { isInviteOnly: isInviteOnly === true });
    res.status(201).json({
      room: {
        roomId: room.roomId,
        roomName: room.roomName,
        createdAt: room.createdAt,
        createdBy: room.createdBy,
        isInviteOnly: room.isInviteOnly === true,
        participantCount: room.participants ? room.participants.length : 0,
      },
    });
  } catch (error) {
    logger.error({ requestId: req.id, userId: req.user.userId, err: error }, 'Create room error');
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
    logger.error({ requestId: req.id, userId: req.user.userId, err: error }, 'Fetch recent rooms error');
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
    logger.error({ requestId: req.id, userId: req.user.userId, err: error }, 'Fetch shared rooms error');
    res.status(500).json({ error: 'Failed to fetch shared rooms.', requestId: req.id });
  }
});

router.get('/:roomId', authMiddleware, async (req, res) => {
  const roomId = String(req.params.roomId || '').trim().toUpperCase();

  // Try to find active in-memory room first
  let room = getRoomSnapshot(roomId);

  // If not in memory, check database
  if (!room) {
    try {
      const dbRoom = await Room.findOne({ roomId });
      if (dbRoom) {
        // Return a shape similar to what the previous code expected
        return res.json({
          room: {
            roomId: dbRoom.roomId,
            roomName: dbRoom.roomName,
            createdAt: dbRoom.createdAt,
            createdBy: dbRoom.createdBy,
            isInviteOnly: dbRoom.isInviteOnly === true,
            participantCount: 0,
          },
        });
      }
    } catch (e) {
      logger.error({ requestId: req.id, userId: req.user.userId, roomId, err: e }, 'DB fetch error');
    }
  } else {
    return res.json({
      room: {
        roomId: room.roomId,
        roomName: room.roomName,
        createdAt: room.createdAt,
        createdBy: room.createdBy,
        isInviteOnly: room.isInviteOnly === true,
        participantCount: room.participants ? room.participants.length : 0,
      },
    });
  }

  return res.status(404).json({
    error: 'Room not found.',
    requestId: req.id,
  });
});

// P0-16 (interim): creator-only toggle for the invite-only room setting.
router.patch('/:roomId', authMiddleware, async (req, res) => {
  const roomId = String(req.params.roomId || '').trim().toUpperCase();
  const { isInviteOnly } = req.body;

  if (typeof isInviteOnly !== 'boolean') {
    return res.status(400).json({ error: 'isInviteOnly must be a boolean.', requestId: req.id });
  }

  try {
    const dbRoom = await Room.findOne({ roomId });

    if (!dbRoom) {
      return res.status(404).json({ error: 'Room not found.', requestId: req.id });
    }

    if (dbRoom.createdBy !== req.user.userId) {
      return res.status(403).json({ error: 'Only the room creator can change this setting.', requestId: req.id });
    }

    dbRoom.isInviteOnly = isInviteOnly;
    await dbRoom.save();

    // Keep the live in-memory copy (if any) in sync so the socket guard
    // takes effect immediately without a restart or room reload.
    const liveRoom = getRoom(roomId);
    if (liveRoom) {
      liveRoom.isInviteOnly = isInviteOnly;
    }

    return res.json({ room: { roomId, isInviteOnly } });
  } catch (error) {
    logger.error({ requestId: req.id, userId: req.user.userId, roomId, err: error }, 'Update room settings error');
    return res.status(500).json({ error: 'Failed to update room settings.', requestId: req.id });
  }
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
    logger.error({ requestId: req.id, userId: req.user.userId, roomId, err: error }, 'Delete room error');
    res.status(500).json({ error: 'Failed to delete room.', requestId: req.id });
  }
});

module.exports = router;
