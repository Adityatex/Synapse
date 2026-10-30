const express = require('express');
const authMiddleware = require('../middleware/auth');
const { logger } = require('../lib/logger');
const { captureException } = require('../lib/sentry');
const { validateBody } = require('../middleware/validate');
const Room = require('../models/Room');
const User = require('../models/User');
const { createRoom } = require('../lib/createRoom');
const { liveParticipantsByRoom } = require('../lib/livePresence');
const { recordRoomMembership, isRoomMember } = require('../lib/roomMembership');
const { signRoomInvite, verifyRoomInvite } = require('../lib/roomInvites');

const router = express.Router();

// Who is in each room right now (from the connected sockets), for the dashboard.
async function withLivePresence(rooms) {
  const live = await liveParticipantsByRoom();
  return rooms.map((doc) => {
    const room = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    room.live = live.get(room.roomId) || [];
    return room;
  });
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
        participantCount: 0,
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
    res.json(await withLivePresence(rooms));
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

    res.json(await withLivePresence(rooms));
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

// Signed invite links: any member can mint one; opening it while logged in
// makes the holder a member, which then passes the P0-16 join guard.
router.post('/:roomId/invite-link', authMiddleware, async (req, res) => {
  const roomId = String(req.params.roomId || '').trim().toUpperCase();
  try {
    const dbRoom = await Room.findOne({ roomId }).select({ createdBy: 1, members: 1 });
    if (!dbRoom) {
      return res.status(404).json({ error: 'Room not found.', requestId: req.id });
    }
    if (!isRoomMember(dbRoom, req.user.userId)) {
      return res.status(403).json({ error: 'You are not a member of this room.', requestId: req.id });
    }
    return res.json({ roomId, inviteToken: signRoomInvite(roomId, req.user.userId) });
  } catch (error) {
    logger.error({ err: error.message || error, requestId: req.id }, 'Create invite link error');
    return res.status(500).json({ error: 'Failed to create invite link.', requestId: req.id });
  }
});

router.post('/:roomId/join', authMiddleware, validateBody('joinRoomInviteSchema'), async (req, res) => {
  const roomId = String(req.params.roomId || '').trim().toUpperCase();
  try {
    verifyRoomInvite(req.body.inviteToken, roomId);
  } catch {
    return res.status(403).json({ error: 'This invite link is invalid or has expired. Ask for a new one.', requestId: req.id });
  }
  try {
    const exists = await Room.exists({ roomId });
    if (!exists) {
      return res.status(404).json({ error: 'Room not found.', requestId: req.id });
    }
    await recordRoomMembership(roomId, { userId: req.user.userId, username: req.user.name || '' });
    return res.json({ roomId, joined: true });
  } catch (error) {
    logger.error({ err: error.message || error, requestId: req.id }, 'Join via invite error');
    return res.status(500).json({ error: 'Failed to join room.', requestId: req.id });
  }
});

router.get('/:roomId', authMiddleware, async (req, res) => {
  const roomId = String(req.params.roomId || '').trim().toUpperCase();

  try {
    const dbRoom = await Room.findOne({ roomId });
    if (!dbRoom) {
      return res.status(404).json({ error: 'Room not found.', requestId: req.id });
    }
    // P0-16: enforce invite-only access.
    if (!isRoomMember(dbRoom, req.user.userId)) {
      return res.status(403).json({ error: 'You are not a member of this room.', requestId: req.id });
    }
    return res.json({
      room: {
        roomId: dbRoom.roomId,
        roomName: dbRoom.roomName,
        createdAt: dbRoom.createdAt,
        createdBy: dbRoom.createdBy,
        locksEnabled: dbRoom.locksEnabled === true,
        participantCount: 0,
      },
    });
  } catch (e) {
    logger.error({ err: e.message || e, requestId: req.id }, 'DB fetch error');
    return res.status(500).json({ error: 'Failed to fetch room.', requestId: req.id });
  }
});

// P2-08: the creator switches focus locks on or off for the room. The collab server reads the
// flag from the same collection, so the change reaches editors within a couple of seconds.
router.patch('/:roomId/settings', authMiddleware, validateBody('updateRoomSettingsSchema'), async (req, res) => {
  const roomId = String(req.params.roomId || '').trim().toUpperCase();

  try {
    const room = await Room.findOne({ roomId }).select({ createdBy: 1 });
    if (!room) {
      return res.status(404).json({ error: 'Room not found.', requestId: req.id });
    }
    if (room.createdBy !== req.user.userId) {
      return res.status(403).json({ error: 'Only the room creator can change room settings.', requestId: req.id });
    }

    // validateBody lets a request through when it cannot find the schema, so check here as well.
    const { locksEnabled } = req.validatedBody ?? req.body ?? {};
    if (typeof locksEnabled !== 'boolean') {
      return res.status(400).json({ error: 'locksEnabled must be true or false.', requestId: req.id });
    }
    await Room.updateOne({ roomId }, { $set: { locksEnabled } });
    return res.json({ roomId, locksEnabled });
  } catch (error) {
    logger.error({ err: error.message || error, requestId: req.id }, 'Update room settings error');
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
    logger.error({ err: error.message || error, requestId: req.id }, 'Delete room error');
    res.status(500).json({ error: 'Failed to delete room.', requestId: req.id });
  }
});

module.exports = router;
module.exports.isRoomMember = isRoomMember;
