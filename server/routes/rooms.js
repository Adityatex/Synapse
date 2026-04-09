const express = require('express');
const authMiddleware = require('../middleware/auth');
const { createRoom, getRoomSnapshot } = require('../socket/roomStore');

const router = express.Router();

router.post('/', authMiddleware, (req, res) => {
  const room = createRoom(req.user);

  res.status(201).json({
    room,
  });
});

router.get('/:roomId', authMiddleware, (req, res) => {
  const roomId = String(req.params.roomId || '').trim().toUpperCase();
  const room = getRoomSnapshot(roomId);

  if (!room) {
    return res.status(404).json({
      error: 'Room not found.',
    });
  }

  return res.json({
    room: {
      roomId: room.roomId,
      createdAt: room.createdAt,
      createdBy: room.createdBy,
      participantCount: room.participants.length,
    },
  });
});

module.exports = router;
