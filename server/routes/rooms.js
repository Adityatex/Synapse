const express = require('express');
const authMiddleware = require('../middleware/auth');
const Room = require('../models/Room');
const { createRoom, getRoomSnapshot } = require('../socket/roomStore');

const router = express.Router();

router.post('/', authMiddleware, async (req, res) => {
  const { roomName } = req.body;
  if (!roomName) {
    return res.status(400).json({ error: 'Room name is required.' });
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
    console.error('Create room error:', error);
    res.status(500).json({ error: 'Failed to create room.' });
  }
});

router.get('/recent/:userId', authMiddleware, async (req, res) => {
  try {
    const rooms = await Room.find({ createdBy: req.params.userId })
                            .sort({ lastUpdated: -1 })
                            .limit(20);
    res.json(rooms);
  } catch (error) {
    console.error('Fetch recent rooms error:', error);
    res.status(500).json({ error: 'Failed to fetch recent rooms.' });
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
            participantCount: 0,
          },
        });
      }
    } catch (e) {
      console.error('DB fetch error:', e);
    }
  } else {
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
  });
});

router.delete('/:roomId', authMiddleware, async (req, res) => {
  const roomId = String(req.params.roomId || '').trim().toUpperCase();

  try {
    const room = await Room.findOne({ roomId });

    if (!room) {
      return res.status(404).json({ error: 'Room not found.' });
    }

    // Only the creator can delete
    if (room.createdBy !== req.user.userId) {
      return res.status(403).json({ error: 'Only the room creator can delete this room.' });
    }

    await Room.deleteOne({ roomId });
    res.json({ message: 'Room deleted successfully.' });
  } catch (error) {
    console.error('Delete room error:', error);
    res.status(500).json({ error: 'Failed to delete room.' });
  }
});

module.exports = router;
