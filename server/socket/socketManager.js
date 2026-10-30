const { logger } = require('../lib/logger');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const RoomModel = require('../models/Room');
const { recordRoomMembership } = require('../lib/roomMembership');
const { setSocketServer } = require('../lib/livePresence');
const { createChatHandlers, postSystemMessage, escapeRegExp, normalizeRoomId } = require('./chatHandlers');
// P1-05: socket payload validation against @synapse/shared contracts.
const { validateSocketPayload } = require('../middleware/validate');

function denyInvalid(socket, event, result) {
  socket.emit('room-error', {
    message: result.error || 'Invalid payload.',
    event,
  });
  return false;
}

function verifySocketUser(socket, next) {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');

    if (!token) {
      return next(new Error('Authentication required.'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.data.user = {
      userId: decoded.userId,
      name: decoded.name,
      email: decoded.email,
    };

    return next();
  } catch (error) {
    return next(new Error('Invalid or expired token.'));
  }
}

// What this server does for a room: chat, and knowing who is in it. Editing, cursors, presence and
// locks are the collab server's (apps/collab); the files are its document (P2-14 removed the relay).
function createSocketServer(httpServer, { chat: chatOptions } = {}) {
  const allowedOrigins = (process.env.CORS_ORIGIN || process.env.CLIENT_URL || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.use(verifySocketUser);
  setSocketServer(io);

  // P2-11: chat events live in their own module.
  const chat = createChatHandlers(io, chatOptions);

  io.on('connection', (socket) => {
    // P0-03: never trust userId/username from the payload — identity always
    // comes from the verified JWT (socket.data.user).
    socket.on('join-room', async (rawPayload = {}) => {
      // P1-05: validate shape before normalizing.
      const joinCheck = validateSocketPayload('joinRoomSchema', rawPayload);
      if (!joinCheck.ok) {
        denyInvalid(socket, 'join-room', joinCheck);
        return;
      }
      const normalizedRoomId = normalizeRoomId(joinCheck.data.roomId);

      // P0-16: invite-only guard — only creator/members may join.
      // Legacy rooms with an empty members list are grandfathered once.
      let dbRoom = null;
      try {
        dbRoom = await RoomModel.findOne({ roomId: normalizedRoomId }).select({
          roomName: 1,
          createdBy: 1,
          members: 1,
        });
        if (dbRoom) {
          const userId = socket.data.user.userId;
          const isCreator = dbRoom.createdBy === userId;
          const members = Array.isArray(dbRoom.members) ? dbRoom.members : [];
          const isMember = members.some((m) => m.userId === userId);
          if (!isCreator && members.length > 0 && !isMember) {
            socket.emit('room-error', {
              message: 'You are not a member of this room. Ask the creator for an invite.',
            });
            return;
          }
        }
      } catch (err) {
        logger.error({ err: err.message || err }, 'Room join guard DB check failed');
        // Falls through to "not found" below: without the room we cannot tell who may join.
      }
      if (!normalizedRoomId || !dbRoom) {
        socket.emit('room-error', { message: 'Room not found. Check the invite code and try again.' });
        return;
      }

      if (socket.data.roomId && socket.data.roomId !== normalizedRoomId) {
        socket.leave(socket.data.roomId);
      }

      socket.join(normalizedRoomId);
      socket.data.roomId = normalizedRoomId;

      const participant = {
        socketId: socket.id,
        userId: socket.data.user.userId,
        username: socket.data.user.name,
        joinedAt: Date.now(),
      };
      socket.data.participant = participant;

      await recordRoomMembership(normalizedRoomId, participant);

      socket.emit('room-joined', {
        room: { roomId: normalizedRoomId, roomName: dbRoom.roomName || '' },
        participant,
      });

      await postSystemMessage(io, normalizedRoomId, `${participant.username} joined the room.`);
    });

    socket.on('leave-room', async () => {
      const roomId = socket.data.roomId;
      if (!roomId) {
        return;
      }

      const username = socket.data.participant?.username;
      socket.leave(roomId);
      socket.data.roomId = null;
      socket.data.participant = null;

      if (username) {
        void postSystemMessage(io, roomId, `${username} left the room.`);
      }
    });

    chat.register(socket);
  });

  return io;
}

module.exports = { createSocketServer, escapeRegExp };
