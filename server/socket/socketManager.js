const { logger } = require('../lib/logger');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const {
  getRoom,
  getRoomSnapshot,
  addParticipant,
  applyDocumentUpdate,
  removeParticipant,
  updateRoomState,
  loadRoomFromDB,
} = require('./roomStore');
const RoomModel = require('../models/Room');
const { recordRoomMembership } = require('../lib/roomMembership');
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

function emitParticipants(io, roomId) {
  const snapshot = getRoomSnapshot(roomId);
  if (!snapshot) {
    return;
  }

  io.to(roomId).emit('room-users', snapshot.participants);
}

const FILE_LOCK_TIMEOUT_MS = 45000;
const roomLocks = new Map();

function serializeRoomLocks(roomId) {
  const locks = roomLocks.get(roomId);
  if (!locks) {
    return {};
  }

  return Object.fromEntries(
    Array.from(locks.entries()).map(([fileId, lock]) => [
      fileId,
      {
        fileId,
        userId: lock.userId,
        username: lock.username,
        socketId: lock.socketId,
        lockedAt: lock.lockedAt,
        expiresAt: lock.expiresAt,
      },
    ])
  );
}

function emitRoomLocks(io, roomId) {
  io.to(roomId).emit('file-locks-updated', {
    roomId,
    locks: serializeRoomLocks(roomId),
  });
}

function clearLockTimer(lock) {
  if (lock?.timer) {
    clearTimeout(lock.timer);
  }
}

function deleteRoomLock(io, roomId, fileId) {
  const locks = roomLocks.get(roomId);
  if (!locks || !locks.has(fileId)) {
    return false;
  }

  clearLockTimer(locks.get(fileId));
  locks.delete(fileId);

  if (locks.size === 0) {
    roomLocks.delete(roomId);
  }

  emitRoomLocks(io, roomId);
  return true;
}

function scheduleRoomLockExpiry(io, roomId, fileId) {
  const locks = roomLocks.get(roomId);
  const lock = locks?.get(fileId);
  if (!lock) {
    return;
  }

  clearLockTimer(lock);
  lock.expiresAt = Date.now() + FILE_LOCK_TIMEOUT_MS;
  lock.timer = setTimeout(() => {
    deleteRoomLock(io, roomId, fileId);
  }, FILE_LOCK_TIMEOUT_MS);
}

function upsertRoomLock(io, roomId, fileId, lockDetails) {
  let locks = roomLocks.get(roomId);
  if (!locks) {
    locks = new Map();
    roomLocks.set(roomId, locks);
  }

  const existingLock = locks.get(fileId);
  const nextLock = {
    ...existingLock,
    ...lockDetails,
    lockedAt: existingLock?.lockedAt ?? Date.now(),
  };

  locks.set(fileId, nextLock);
  scheduleRoomLockExpiry(io, roomId, fileId);
  emitRoomLocks(io, roomId);
}

function releaseLocksForSocket(io, socket) {
  const socketUserId = socket.data.participant?.userId || socket.data.user?.userId;
  if (!socketUserId) {
    return;
  }

  roomLocks.forEach((locks, roomId) => {
    const lockedFileIds = Array.from(locks.entries())
      .filter(([, lock]) => lock.userId === socketUserId || lock.socketId === socket.id)
      .map(([fileId]) => fileId);

    lockedFileIds.forEach((fileId) => {
      deleteRoomLock(io, roomId, fileId);
    });
  });
}

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

  // P2-11: chat events live in their own module.
  const chat = createChatHandlers(io, chatOptions);

  io.on('connection', (socket) => {
    // P0-03: never trust userId/username from the payload — identity always
    // comes from the verified JWT (socket.data.user).
    socket.on('join-room', async ({ roomId, collab } = {}) => {
      // P1-05: validate shape before normalizing.
      const joinCheck = validateSocketPayload('joinRoomSchema', { roomId, collab });
      if (!joinCheck.ok) {
        denyInvalid(socket, 'join-room', joinCheck);
        return;
      }
      const normalizedRoomId = normalizeRoomId(joinCheck.data.roomId);
      // P2-10: a client that edits through the collab server joins only for chat. It must not load the
      // room's files into this process (that copy would go stale), and it may join a migrated room.
      const viaCollab = joinCheck.data.collab === true;
      let room = viaCollab ? null : getRoom(normalizedRoomId);

      if (!room && !viaCollab) {
        room = await loadRoomFromDB(normalizedRoomId);
      }

      if (!normalizedRoomId || (!room && !viaCollab)) {
        socket.emit('room-error', {
          message: 'Room not found. Check the invite code and try again.',
        });
        return;
      }

      // P0-16: invite-only guard — only creator/members may join.
      // Legacy rooms with an empty members list are grandfathered once.
      let dbRoom = null;
      try {
        dbRoom = await RoomModel.findOne({ roomId: normalizedRoomId }).select({
          roomName: 1,
          createdBy: 1,
          members: 1,
          collabVersion: 1,
        });
        // P2-10: a migrated room's files live in the collab server; the classic editor must not open it.
        if (!viaCollab && dbRoom?.collabVersion === 2) {
          socket.emit('room-error', {
            message: 'This room has moved to the new editor. Reload the page to open it.',
            code: 'room-migrated',
          });
          return;
        }
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
        // Fail open on DB error to avoid locking out users during outages;
        // HTTP guard remains the enforcement point.
      }
      if (viaCollab && !dbRoom) {
        socket.emit('room-error', { message: 'Room not found. Check the invite code and try again.' });
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
        userId: socket.data.user.userId,
        username: socket.data.user.name,
        joinedAt: Date.now(),
      };

      const snapshot = viaCollab ? null : addParticipant(normalizedRoomId, participant);
      const currentParticipant = snapshot
        ? snapshot.participants.find((nextParticipant) => nextParticipant.socketId === socket.id)
        : participant;
      socket.data.participant = currentParticipant;

      await recordRoomMembership(normalizedRoomId, currentParticipant);

      socket.emit('room-joined', {
        room: snapshot
          ? {
              roomId: snapshot.roomId,
              roomName: snapshot.roomName,
              files: snapshot.files,
              activeFileId: snapshot.activeFileId,
              openTabs: snapshot.openTabs,
            }
          : { roomId: normalizedRoomId, roomName: dbRoom.roomName || '', files: [], activeFileId: null, openTabs: [] },
        sharedDocs: snapshot ? snapshot.sharedDocs : {},
        fileLocks: viaCollab ? {} : serializeRoomLocks(normalizedRoomId),
        participant: currentParticipant,
      });

      socket.to(normalizedRoomId).emit('user-joined', {
        userId: currentParticipant.userId,
        username: currentParticipant.username,
        cursorColor: currentParticipant.cursorColor,
        avatarGlyph: currentParticipant.avatarGlyph,
      });
      emitParticipants(io, normalizedRoomId);

      await postSystemMessage(io, normalizedRoomId, `${currentParticipant.username} joined the room.`);
    });

    socket.on('leave-room', async () => {
      const roomId = socket.data.roomId;
      if (!roomId) {
        return;
      }

      releaseLocksForSocket(io, socket);

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

      if (removal?.removedParticipant?.username) {
        void postSystemMessage(io, roomId, `${removal.removedParticipant.username} left the room.`);
      }
    });

    chat.register(socket);

    socket.on('sync-room-state', async (rawPayload = {}) => {
      const roomId = socket.data.roomId;
      if (!roomId) {
        return;
      }

      // P1-05: bound sync payloads; fall back to raw on shape drift (client
      // versions may send extra fields — schema is permissive by design).
      const syncCheck = validateSocketPayload('syncRoomStateSchema', rawPayload);
      const payload = syncCheck.ok ? syncCheck.data : rawPayload;
      const snapshot = updateRoomState(roomId, (room) => {
        room.files = Array.isArray(payload.files)
          ? payload.files.map((file) => ({
              id: file.id,
              name: file.name,
              type: file.type || 'file',
              parentId: file.parentId || null,
              order: typeof file.order === 'number' ? file.order : 0,
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

      const validFileIds = new Set(snapshot.files.map((file) => file.id));
      const locks = roomLocks.get(roomId);
      if (locks) {
        Array.from(locks.keys()).forEach((fileId) => {
          if (!validFileIds.has(fileId)) {
            deleteRoomLock(io, roomId, fileId);
          }
        });
      }

      try {
        await RoomModel.updateOne(
          // P2-10: never overwrite the files of a room that has moved to the collab server.
          { roomId, collabVersion: { $ne: 2 } },
          {
            $set: { 
              files: snapshot.files.map(f => ({ 
                id: f.id, 
                name: f.name, 
                type: f.type || 'file', 
                parentId: f.parentId || null, 
                order: typeof f.order === 'number' ? f.order : 0, 
                content: f.content, 
                updatedAt: f.updatedAt 
              })),
              lastUpdated: Date.now()
            }
          }
        );
      } catch (err) {
        logger.error({ err: err.message || err }, 'sync-room-state DB update error');
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

    socket.on('autosave', async (payload = {}) => {
      const check = validateSocketPayload('autosaveSchema', payload);
      if (!check.ok) return;
      const { roomId, fileId, content } = check.data;
      const activeRoomId = normalizeRoomId(roomId || socket.data.roomId);
      if (!activeRoomId || !fileId || content === undefined) return;

      try {
        await RoomModel.updateOne(
          { roomId: activeRoomId, collabVersion: { $ne: 2 }, "files.id": fileId },
          {
            $set: {
              "files.$.content": content,
              "files.$.updatedAt": Date.now(),
              lastUpdated: Date.now()
            }
          }
        );
      } catch (err) {
        logger.error({ err: err.message || err }, 'Autosave Error:');
      }
    });

    socket.on('save-version', async (payload = {}) => {
      const check = validateSocketPayload('saveVersionSchema', payload);
      if (!check.ok) return;
      const { roomId, fileId, content } = check.data;
      const activeRoomId = normalizeRoomId(roomId || socket.data.roomId);
      if (!activeRoomId || !fileId || content === undefined) return;

      try {
        await RoomModel.updateOne(
          { roomId: activeRoomId },
          {
            $push: {
              versions: {
                content,
                fileId,
                timestamp: Date.now()
              }
            }
          }
        );
      } catch (err) {
        logger.error({ err: err.message || err }, 'Save Version Error:');
      }
    });

    socket.on('request-file-lock', (payload = {}) => {
      const check = validateSocketPayload('fileLockSchema', payload);
      if (!check.ok) return;
      const { roomId, fileId } = check.data;
      const activeRoomId = normalizeRoomId(roomId || socket.data.roomId);
      const participant = socket.data.participant;
      const ownerUserId = participant?.userId || socket.data.user?.userId;
      const ownerName = participant?.username || socket.data.user?.name;

      if (!activeRoomId || !fileId || !ownerUserId) {
        return;
      }

      const existingLock = roomLocks.get(activeRoomId)?.get(fileId);
      if (existingLock && existingLock.userId !== ownerUserId) {
        socket.emit('lock-denied', {
          fileId,
          lockedBy: {
            userId: existingLock.userId,
            username: existingLock.username,
            socketId: existingLock.socketId,
            expiresAt: existingLock.expiresAt,
          },
        });
        return;
      }

      upsertRoomLock(io, activeRoomId, fileId, {
        userId: ownerUserId,
        username: ownerName,
        socketId: socket.id,
      });
    });

    socket.on('release-file-lock', ({ roomId, fileId } = {}) => {
      const activeRoomId = normalizeRoomId(roomId || socket.data.roomId);
      const requesterUserId = socket.data.participant?.userId || socket.data.user?.userId;
      if (!activeRoomId || !fileId || !requesterUserId) {
        return;
      }

      const existingLock = roomLocks.get(activeRoomId)?.get(fileId);
      if (!existingLock || existingLock.userId !== requesterUserId) {
        return;
      }

      deleteRoomLock(io, activeRoomId, fileId);
    });

    socket.on('renew-file-lock', ({ roomId, fileId } = {}) => {
      const activeRoomId = normalizeRoomId(roomId || socket.data.roomId);
      const requesterUserId = socket.data.participant?.userId || socket.data.user?.userId;
      if (!activeRoomId || !fileId || !requesterUserId) {
        return;
      }

      const existingLock = roomLocks.get(activeRoomId)?.get(fileId);
      if (!existingLock || existingLock.userId !== requesterUserId) {
        return;
      }

      upsertRoomLock(io, activeRoomId, fileId, {
        userId: requesterUserId,
        username: existingLock.username,
        socketId: socket.id,
        lockedAt: existingLock.lockedAt,
      });
    });

    socket.on('code-change', (payload = {}) => {
      const check = validateSocketPayload('codeChangeSchema', payload);
      if (!check.ok) return;
      const { roomId, fileId, changes } = check.data;
      const activeRoomId = normalizeRoomId(roomId || socket.data.roomId);
      if (!activeRoomId || !fileId || !changes) {
        return;
      }

      // P0-03: sender identity comes from the verified token only.
      const senderId = socket.data.user.userId;
      const activeLock = roomLocks.get(activeRoomId)?.get(fileId);
      if (activeLock && activeLock.userId !== senderId) {
        socket.emit('lock-denied', {
          fileId,
          lockedBy: {
            userId: activeLock.userId,
            username: activeLock.username,
            socketId: activeLock.socketId,
            expiresAt: activeLock.expiresAt,
          },
        });
        return;
      }

      const nextState = applyDocumentUpdate(activeRoomId, fileId, changes);
      if (!nextState) {
        return;
      }

      const senderName = socket.data.user.name;
      const senderColor = socket.data.participant?.cursorColor;
      const senderAvatarGlyph = socket.data.participant?.avatarGlyph;

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
        avatarGlyph: senderAvatarGlyph,
        fileId,
      });
    });

    socket.on('cursor-move', (payload = {}) => {
      const check = validateSocketPayload('cursorMoveSchema', payload);
      if (!check.ok) return;
      const { roomId, position } = check.data;
      const activeRoomId = normalizeRoomId(roomId || socket.data.roomId);
      if (!activeRoomId || !position) {
        return;
      }

      socket.to(activeRoomId).emit('cursor-update', {
        userId: socket.data.user.userId,
        username: socket.data.user.name,
        position,
        cursorColor: socket.data.participant?.cursorColor,
        avatarGlyph: socket.data.participant?.avatarGlyph,
        socketId: socket.id,
      });
    });

    socket.on('selection-change', (payload = {}) => {
      const check = validateSocketPayload('selectionChangeSchema', payload);
      if (!check.ok) return;
      const { roomId, selectionRange } = check.data;
      const activeRoomId = normalizeRoomId(roomId || socket.data.roomId);
      if (!activeRoomId || !selectionRange) {
        return;
      }

      socket.to(activeRoomId).emit('selection-update', {
        userId: socket.data.user.userId,
        username: socket.data.user.name,
        selectionRange,
        cursorColor: socket.data.participant?.cursorColor,
        avatarGlyph: socket.data.participant?.avatarGlyph,
        socketId: socket.id,
      });
    });

    socket.on('disconnect', () => {
      const roomId = socket.data.roomId;
      releaseLocksForSocket(io, socket);
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

module.exports = { createSocketServer, escapeRegExp };
