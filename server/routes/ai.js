const express = require('express');
const mongoose = require('mongoose');
const authMiddleware = require('../middleware/auth');
const { requestGroqChat } = require('../services/groqService');
const Conversation = require('../models/Conversation');
const AIMessage = require('../models/AIMessage');

const router = express.Router();

function ensureDatabaseReady(res) {
  if (mongoose.connection.readyState === 1) {
    return true;
  }

  res.status(503).json({
    error: 'AI chat is temporarily unavailable because the database is disconnected.',
  });
  return false;
}

function normalizeMessage(message) {
  return String(message || '').trim();
}

function buildConversationTitle(message) {
  const normalized = normalizeMessage(message).replace(/\s+/g, ' ');
  if (!normalized) {
    return 'New Chat';
  }

  return normalized.slice(0, 48);
}

async function getOwnedConversation(conversationId, userId) {
  if (!mongoose.Types.ObjectId.isValid(conversationId)) {
    return null;
  }

  return Conversation.findOne({
    _id: conversationId,
    userId,
  });
}

router.use(authMiddleware);

router.post('/new', async (req, res) => {
  try {
    if (!ensureDatabaseReady(res)) {
      return;
    }

    const conversation = await Conversation.create({
      userId: req.user.userId,
      title: 'New Chat',
    });

    return res.status(201).json(conversation);
  } catch (error) {
    console.error('Create conversation error:', error);
    return res.status(500).json({
      error: 'Failed to create a new conversation.',
    });
  }
});

router.get('/history', async (req, res) => {
  try {
    if (!ensureDatabaseReady(res)) {
      return;
    }

    const conversations = await Conversation.find({
      userId: req.user.userId,
    })
      .sort({ updatedAt: -1 })
      .limit(50);

    return res.json(conversations);
  } catch (error) {
    console.error('Fetch conversation history error:', error);
    return res.status(500).json({
      error: 'Failed to load conversation history.',
    });
  }
});

router.get('/conversation/:conversationId', async (req, res) => {
  try {
    if (!ensureDatabaseReady(res)) {
      return;
    }

    const conversation = await getOwnedConversation(
      req.params.conversationId,
      req.user.userId
    );

    if (!conversation) {
      return res.status(404).json({
        error: 'Conversation not found.',
      });
    }

    const messages = await AIMessage.find({
      conversationId: conversation._id,
    }).sort({ createdAt: 1 });

    return res.json({
      conversation,
      messages,
    });
  } catch (error) {
    console.error('Load conversation error:', error);
    return res.status(500).json({
      error: 'Failed to load conversation messages.',
    });
  }
});

router.delete('/conversation/:conversationId', async (req, res) => {
  try {
    if (!ensureDatabaseReady(res)) {
      return;
    }

    const conversation = await getOwnedConversation(
      req.params.conversationId,
      req.user.userId
    );

    if (!conversation) {
      return res.status(404).json({
        error: 'Conversation not found.',
      });
    }

    await AIMessage.deleteMany({ conversationId: conversation._id });
    await Conversation.deleteOne({ _id: conversation._id });

    return res.json({ success: true });
  } catch (error) {
    console.error('Delete conversation error:', error);
    return res.status(500).json({
      error: 'Failed to delete conversation.',
    });
  }
});

router.post('/message', async (req, res) => {
  try {
    if (!ensureDatabaseReady(res)) {
      return;
    }

    const { conversationId, role, content } = req.body || {};
    const normalizedContent = normalizeMessage(content);

    if (!normalizedContent) {
      return res.status(400).json({
        error: 'Message content is required.',
      });
    }

    if (!['user', 'assistant', 'system'].includes(role)) {
      return res.status(400).json({
        error: 'A valid message role is required.',
      });
    }

    const conversation = await getOwnedConversation(conversationId, req.user.userId);
    if (!conversation) {
      return res.status(404).json({
        error: 'Conversation not found.',
      });
    }

    const existingMessageCount = await AIMessage.countDocuments({
      conversationId: conversation._id,
    });

    const message = await AIMessage.create({
      conversationId: conversation._id,
      role,
      content: normalizedContent,
    });

    if (role === 'user' && existingMessageCount === 0) {
      conversation.title = buildConversationTitle(normalizedContent);
    }

    conversation.updatedAt = new Date();
    await conversation.save();

    return res.status(201).json({
      conversation,
      message,
    });
  } catch (error) {
    console.error('Save conversation message error:', error);
    return res.status(500).json({
      error: 'Failed to save the conversation message.',
    });
  }
});

router.post('/chat', async (req, res) => {
  try {
    if (!ensureDatabaseReady(res)) {
      return;
    }

    const { message, conversationId, history = [], context = {} } = req.body || {};
    const normalizedMessage = normalizeMessage(message);

    if (!normalizedMessage) {
      return res.status(400).json({
        error: 'A message is required.',
      });
    }

    let conversation = null;

    if (conversationId) {
      conversation = await getOwnedConversation(conversationId, req.user.userId);

      if (!conversation) {
        return res.status(404).json({
          error: 'Conversation not found.',
        });
      }
    } else {
      conversation = await Conversation.create({
        userId: req.user.userId,
        title: buildConversationTitle(normalizedMessage),
      });
    }

    const persistedHistory = await AIMessage.find({
      conversationId: conversation._id,
    })
      .sort({ createdAt: 1 })
      .select({ role: 1, content: 1, _id: 0 });

    const reply = await requestGroqChat({
      message: normalizedMessage,
      history: persistedHistory.length > 0 ? persistedHistory : history,
      context,
    });

    const existingMessageCount = await AIMessage.countDocuments({
      conversationId: conversation._id,
    });

    const [userMessage, assistantMessage] = await AIMessage.create([
      {
        conversationId: conversation._id,
        role: 'user',
        content: normalizedMessage,
      },
      {
        conversationId: conversation._id,
        role: 'assistant',
        content: reply,
      },
    ]);

    if (existingMessageCount === 0) {
      conversation.title = buildConversationTitle(normalizedMessage);
    }

    conversation.updatedAt = new Date();
    await conversation.save();

    return res.json({
      reply,
      conversation,
      conversationId: conversation._id,
      userMessage,
      assistantMessage,
    });
  } catch (error) {
    console.error('AI chat error:', error.response?.data || error.message);

    const upstreamMessage =
      error.response?.data?.error?.message ||
      error.response?.data?.message ||
      error.message;

    const statusCode =
      error.response?.status && error.response.status >= 400 && error.response.status < 600
        ? error.response.status
        : 500;

    return res.status(statusCode).json({
      error: upstreamMessage || 'Failed to generate AI response.',
    });
  }
});

module.exports = router;
