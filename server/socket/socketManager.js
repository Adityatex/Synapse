const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const {
  getRoom,
  getRoomSnapshot,
  addParticipant,
  applyDocumentUpdate,
  removeParticipant,
  updateRoomState,
} = require('./roomStore');

function normalizeRoomId(roomId) {
  return String(roomId || '').trim().toUpperCase();
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

function emitParticipants(io, roomId) {
  const snapshot = getRoomSnapshot(roomId);
  if (!snapshot) {
    return;
  }

  io.to(roomId).emit('room-users', snapshot.participants);
}

function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.use(verifySocketUser);

  io.on('connection', (socket) => {
    socket.on('join-room', ({ roomId, username, userId }) => {
      const normalizedRoomId = normalizeRoomId(roomId);
      const room = getRoom(normalizedRoomId);

      if (!normalizedRoomId || !room) {
        socket.emit('room-error', {
          message: 'Room not found. Check the invite code and try again.',
        });
        return;
      }

      if (socket.data.roomId && socket.data.roomId !== normalizedRoomId) {
        socket.leave(socket.data.roomId);
        removeParticipant(socket.data.roomId, socket.id);
        emitParticipants(io, socket.data.roomId);
      }

      socket.join(normalizedRoomId);
      socket.data.roomId = normalizedRoomId;

      const participant = {
        socketId: socket.id,
        userId: userId || socket.data.user.userId,
        username: username || socket.data.user.name,
        joinedAt: Date.now(),
      };

      const snapshot = addParticipant(normalizedRoomId, participant);
      const currentParticipant = snapshot.participants.find(
        (nextParticipant) => nextParticipant.socketId === socket.id
      );
      socket.data.participant = currentParticipant;

      socket.emit('room-joined', {
        room: {
          roomId: snapshot.roomId,
          files: snapshot.files,
          activeFileId: snapshot.activeFileId,
          openTabs: snapshot.openTabs,
        },
        sharedDocs: snapshot.sharedDocs,
        participant: currentParticipant,
      });

      socket.to(normalizedRoomId).emit('user-joined', {
        userId: currentParticipant.userId,
        username: currentParticipant.username,
        cursorColor: currentParticipant.cursorColor,
      });
      emitParticipants(io, normalizedRoomId);
    });

    socket.on('leave-room', () => {
      const roomId = socket.data.roomId;
      if (!roomId) {
        return;
      }

      socket.leave(roomId);
      socket.data.roomId = null;
      const removal = removeParticipant(roomId, socket.id);
      socket.data.participant = null;
      socket.to(roomId).emit('user-left', {
        socketId: socket.id,
        userId: removal?.removedParticipant?.userId,
        username: removal?.removedParticipant?.username,
      });
      emitParticipants(io, roomId);
    });

    socket.on('sync-room-state', (payload = {}) => {
      const roomId = socket.data.roomId;
      if (!roomId) {
        return;
      }

      const snapshot = updateRoomState(roomId, (room) => {
        room.files = Array.isArray(payload.files)
          ? payload.files.map((file) => ({
              id: file.id,
              name: file.name,
              content: file.content ?? '',
              updatedAt: file.updatedAt ?? Date.now(),
            }))
          : room.files;
        room.activeFileId = payload.activeFileId || room.activeFileId;
        room.openTabs = Array.isArray(payload.openTabs)
          ? payload.openTabs
          : room.openTabs;
      });

      if (!snapshot) {
        socket.emit('room-error', { message: 'Unable to sync room state.' });
        return;
      }

      // Broadcast to ALL sockets in the room, including the sender.
      // The sender needs this echo so newly created files get their server-side
      // Yjs state applied back. suppressStructureSyncRef on the client prevents
      // an infinite loop.
      io.to(roomId).emit('room-state-updated', {
        files: snapshot.files,
        activeFileId: snapshot.activeFileId,
        openTabs: snapshot.openTabs,
        sharedDocs: snapshot.sharedDocs,
      });
    });

    socket.on('code-change', ({ roomId, fileId, changes, userId } = {}) => {
      const activeRoomId = normalizeRoomId(roomId || socket.data.roomId);
      if (!activeRoomId || !fileId || !changes) {
        return;
      }

      const nextState = applyDocumentUpdate(activeRoomId, fileId, changes);
      if (!nextState) {
        return;
      }

      const senderId = userId || socket.data.user.userId;
      const senderName = socket.data.user.name;
      const senderColor = socket.data.participant?.cursorColor;

      // Broadcast the Yjs update to all other peers in the room
      socket.to(activeRoomId).emit('remote-code-change', {
        fileId,
        changes,
        userId: senderId,
        username: senderName,
        cursorColor: senderColor,
        updatedAt: nextState.updatedAt,
      });

      // Also emit a lightweight "who is typing" event so the UI can show
      // live editing indicators without waiting for cursor-move events
      socket.to(activeRoomId).emit('user-editing', {
        userId: senderId,
        username: senderName,
        cursorColor: senderColor,
        fileId,
      });
    });

    socket.on('legacy-code-change', ({ fileId, content, updatedAt } = {}) => {
      const roomId = socket.data.roomId;
      if (!roomId || !fileId) {
        return;
      }

      const nextUpdatedAt = updatedAt ?? Date.now();
      updateRoomState(roomId, (room) => {
        room.files = room.files.map((file) =>
          file.id === fileId
            ? {
                ...file,
                content: content ?? '',
                updatedAt: nextUpdatedAt,
              }
            : file
        );
      });

      socket.to(roomId).emit('code-change', {
        fileId,
        content: content ?? '',
        updatedAt: nextUpdatedAt,
      });
    });

    socket.on('cursor-move', ({ roomId, userId, username, position } = {}) => {
      const activeRoomId = normalizeRoomId(roomId || socket.data.roomId);
      if (!activeRoomId || !position) {
        return;
      }

      socket.to(activeRoomId).emit('cursor-update', {
        userId: userId || socket.data.user.userId,
        username: username || socket.data.user.name,
        position,
        cursorColor: socket.data.participant?.cursorColor,
        socketId: socket.id,
      });
    });

    socket.on('selection-change', ({ roomId, userId, username, selectionRange } = {}) => {
      const activeRoomId = normalizeRoomId(roomId || socket.data.roomId);
      if (!activeRoomId || !selectionRange) {
        return;
      }

      socket.to(activeRoomId).emit('selection-update', {
        userId: userId || socket.data.user.userId,
        username: username || socket.data.user.name,
        selectionRange,
        cursorColor: socket.data.participant?.cursorColor,
        socketId: socket.id,
      });
    });

    socket.on('disconnect', () => {
      const roomId = socket.data.roomId;
      if (!roomId) {
        return;
      }

      const removal = removeParticipant(roomId, socket.id);
      socket.to(roomId).emit('user-left', {
        socketId: socket.id,
        userId: removal?.removedParticipant?.userId,
        username: removal?.removedParticipant?.username,
      });
      emitParticipants(io, roomId);
    });
  });

  return io;
}

module.exports = { createSocketServer };
