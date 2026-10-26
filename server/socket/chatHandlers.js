'use strict';

const { logger } = require('../lib/logger');
const MessageModel = require('../models/Message');
const RoomModel = require('../models/Room');
const { isRoomMember } = require('../lib/roomMembership');
// P1-05: socket payload validation against @synapse/shared contracts.
const { validateSocketPayload } = require('../middleware/validate');

const MEMBERSHIP_CACHE_MS = 10_000;
const MEMBERSHIP_CACHE_MAX = 5_000;
const MAX_HISTORY_PAGE = 100;

function normalizeRoomId(roomId) {
  return String(roomId || '').trim().toUpperCase();
}

// escape user input before $regex so patterns like ".*" or "(a+)+$"
// are matched literally and cannot cause regex injection / ReDoS.
function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * What goes on the wire. With the Redis adapter (P2-11) an emit is encoded for the other replicas
 * as well as for local sockets, and a Mongoose document encodes differently in each (ObjectIds
 * would arrive as buffers). Going through JSON gives every socket the same plain object.
 */
function toWire(message) {
  return JSON.parse(JSON.stringify(message));
}

/**
 * Whether `userId` may use the room's chat: the same rule as the HTTP guard (creator, listed
 * members, or a legacy room with no members), read from the database so that it holds on every
 * replica. Answers are kept for a few seconds so typing indicators do not cost a query each.
 */
function createMembershipCheck({ ttlMs = MEMBERSHIP_CACHE_MS, now = Date.now } = {}) {
  const answers = new Map();
  return async function isMember(roomId, userId) {
    const key = `${roomId}:${userId}`;
    const known = answers.get(key);
    if (known && now() - known.at < ttlMs) return known.allowed;

    const room = await RoomModel.findOne({ roomId }).select({ createdBy: 1, members: 1 }).lean();
    const allowed = Boolean(room) && isRoomMember(room, userId);

    if (answers.size >= MEMBERSHIP_CACHE_MAX) answers.clear();
    answers.set(key, { at: now(), allowed });
    return allowed;
  };
}

/** A line in the room's chat that nobody wrote: someone joined, left or pinned a message. */
async function postSystemMessage(io, roomId, content) {
  try {
    const message = await MessageModel.create({
      roomId,
      senderId: 'system',
      senderName: 'System',
      type: 'system',
      content,
    });
    io.to(roomId).emit('chat-message', toWire(message));
  } catch (err) {
    logger.error({ err: err.message || err }, 'Error creating system chat message');
  }
}

/**
 * Chat events (P2-11), moved out of socketManager. Every event first asks `authorize`:
 *
 *  - the socket speaks only in the room it joined through `join-room` (whose guard checked
 *    membership), never in a room named by the payload, and
 *  - the user must still be a member when the event arrives.
 *
 * Anything else is dropped and logged. Chat needs the database anyway, so if membership cannot be
 * checked the event is dropped rather than let through.
 */
function createChatHandlers(io, { isMember = createMembershipCheck() } = {}) {
  async function authorize(socket, event, requestedRoomId) {
    const joined = socket.data.roomId;
    const roomId = normalizeRoomId(requestedRoomId || joined);
    const userId = socket.data.user?.userId;
    if (!roomId || !userId || roomId !== joined) {
      logger.warn({ event, userId, requested: roomId, joined: joined || null }, 'chat event for a room the socket has not joined');
      return null;
    }
    try {
      if (await isMember(roomId, userId)) return roomId;
      logger.warn({ event, userId, roomId }, 'chat event from a user who is not a member');
    } catch (err) {
      logger.error({ err: err.message || err, event, roomId }, 'chat membership check failed');
    }
    return null;
  }

  function register(socket) {
    const senderId = () => socket.data.user.userId || socket.data.participant?.userId;
    const senderName = () => socket.data.participant?.username || socket.data.user?.name || 'Unknown User';

    socket.on('send-chat-message', async (payload = {}) => {
      const check = validateSocketPayload('chatMessageSchema', payload);
      if (!check.ok) return;
      const { roomId, content, type = 'user', replyTo } = check.data;
      const activeRoomId = await authorize(socket, 'send-chat-message', roomId);
      if (!activeRoomId || !content) return;

      try {
        const msgData = {
          roomId: activeRoomId,
          senderId: senderId() || 'unknown-id',
          senderName: senderName(),
          type,
          content,
        };
        if (replyTo && replyTo.messageId) {
          msgData.replyTo = {
            messageId: replyTo.messageId,
            senderName: replyTo.senderName || '',
            content: replyTo.content || '',
          };
        }
        const newMessage = await MessageModel.create(msgData);
        io.to(activeRoomId).emit('chat-message', toWire(newMessage));
      } catch (err) {
        logger.error({ err: err.message || err }, 'Error saving chat message:');
      }
    });

    socket.on('typing-indicator', async ({ roomId, isTyping } = {}) => {
      const activeRoomId = await authorize(socket, 'typing-indicator', roomId);
      if (!activeRoomId) return;

      socket.to(activeRoomId).emit('user-typing', {
        userId: socket.data.user.userId,
        username: socket.data.user.name,
        isTyping: isTyping === true,
      });
    });

    socket.on('request-chat-history', async ({ roomId, limit = 50, beforeTimestamp } = {}) => {
      const activeRoomId = await authorize(socket, 'request-chat-history', roomId);
      if (!activeRoomId) return;

      try {
        const query = { roomId: activeRoomId };
        if (beforeTimestamp) {
          query.timestamp = { $lt: new Date(beforeTimestamp) };
        }
        const pageSize = Math.min(Math.max(Number(limit) || 50, 1), MAX_HISTORY_PAGE);
        const history = await MessageModel.find(query).sort({ timestamp: -1 }).limit(pageSize);

        socket.emit('chat-history', toWire(history.reverse()));
      } catch (err) {
        logger.error({ err: err.message || err }, 'Error fetching chat history:');
      }
    });

    // ─── EDIT MESSAGE ────────────────────────────────────────────────────────────

    socket.on('edit-chat-message', async ({ messageId, content } = {}) => {
      const activeRoomId = await authorize(socket, 'edit-chat-message');
      if (!activeRoomId || !messageId || !content) return;
      try {
        const msg = await MessageModel.findById(messageId);
        if (!msg || msg.roomId !== activeRoomId) return;
        // Only the sender can edit
        if (msg.senderId !== senderId()) return;
        msg.content = content;
        msg.edited = true;
        await msg.save();
        io.to(activeRoomId).emit('chat-message-updated', toWire(msg));
      } catch (err) {
        logger.error({ err: err.message || err }, 'Error editing message:');
      }
    });

    // ─── DELETE MESSAGE ──────────────────────────────────────────────────────────

    socket.on('delete-chat-message', async ({ messageId } = {}) => {
      const activeRoomId = await authorize(socket, 'delete-chat-message');
      if (!activeRoomId || !messageId) return;
      try {
        const msg = await MessageModel.findById(messageId);
        if (!msg || msg.roomId !== activeRoomId) return;
        if (msg.senderId !== senderId()) return;
        msg.deleted = true;
        msg.content = 'This message was deleted.';
        await msg.save();
        io.to(activeRoomId).emit('chat-message-updated', toWire(msg));
      } catch (err) {
        logger.error({ err: err.message || err }, 'Error deleting message:');
      }
    });

    // ─── PIN MESSAGE ─────────────────────────────────────────────────────────────

    socket.on('pin-chat-message', async ({ messageId } = {}) => {
      const activeRoomId = await authorize(socket, 'pin-chat-message');
      if (!activeRoomId || !messageId) return;
      try {
        const msg = await MessageModel.findById(messageId);
        if (!msg || msg.roomId !== activeRoomId) return;
        msg.pinned = !msg.pinned;
        await msg.save();
        io.to(activeRoomId).emit('chat-message-updated', toWire(msg));
        // Broadcast system notification
        const action = msg.pinned ? 'pinned' : 'unpinned';
        const sysName = socket.data.participant?.username || socket.data.user?.name || 'Someone';
        await postSystemMessage(io, activeRoomId, `${sysName} ${action} a message.`);
      } catch (err) {
        logger.error({ err: err.message || err }, 'Error pinning message:');
      }
    });

    // ─── REACT TO MESSAGE ────────────────────────────────────────────────────────

    socket.on('react-chat-message', async ({ messageId, emoji } = {}) => {
      const activeRoomId = await authorize(socket, 'react-chat-message');
      if (!activeRoomId || !messageId || !emoji) return;
      try {
        const msg = await MessageModel.findById(messageId);
        if (!msg || msg.roomId !== activeRoomId) return;
        const userId = senderId();
        const username = socket.data.participant?.username || socket.data.user?.name || 'Unknown';
        if (!msg.reactions) msg.reactions = new Map();
        const existing = msg.reactions.get(emoji) || [];
        const alreadyReacted = existing.findIndex((r) => r.userId === userId);
        if (alreadyReacted >= 0) {
          existing.splice(alreadyReacted, 1);
          if (existing.length === 0) msg.reactions.delete(emoji);
          else msg.reactions.set(emoji, existing);
        } else {
          existing.push({ userId, username });
          msg.reactions.set(emoji, existing);
        }
        msg.markModified('reactions');
        await msg.save();
        io.to(activeRoomId).emit('chat-message-updated', toWire(msg));
      } catch (err) {
        logger.error({ err: err.message || err }, 'Error reacting to message:');
      }
    });

    // ─── SEARCH MESSAGES ─────────────────────────────────────────────────────────

    socket.on('search-chat-messages', async (payload = {}) => {
      const check = validateSocketPayload('searchChatMessagesSchema', payload);
      if (!check.ok) return;
      const { roomId, query } = check.data;
      const activeRoomId = await authorize(socket, 'search-chat-messages', roomId);
      if (!activeRoomId || !query) return;
      try {
        // P0-04: treat the query as literal text (cap length to bound regex work).
        const safeQuery = escapeRegExp(String(query).slice(0, 200));
        const results = await MessageModel.find({
          roomId: activeRoomId,
          deleted: { $ne: true },
          $or: [
            { content: { $regex: safeQuery, $options: 'i' } },
            { senderName: { $regex: safeQuery, $options: 'i' } },
          ],
        })
          .sort({ timestamp: -1 })
          .limit(50);
        socket.emit('chat-search-results', toWire(results.reverse()));
      } catch (err) {
        logger.error({ err: err.message || err }, 'Error searching messages:');
      }
    });
  }

  return { register };
}

module.exports = { createChatHandlers, createMembershipCheck, postSystemMessage, escapeRegExp, normalizeRoomId };
