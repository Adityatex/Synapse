const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
    index: true
  },
  senderId: {
    type: String,
    required: true
  },
  senderName: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['user', 'system'],
    default: 'user'
  },
  content: {
    type: String,
    required: true
  },
  // Threaded replies – references parent message
  replyTo: {
    messageId: { type: mongoose.Schema.Types.ObjectId, default: null },
    senderName: { type: String, default: null },
    content: { type: String, default: null }
  },
  // Emoji reactions – map of emoji -> array of { userId, username }
  reactions: {
    type: Map,
    of: [{
      userId: String,
      username: String
    }],
    default: {}
  },
  // Pin support
  pinned: {
    type: Boolean,
    default: false
  },
  // Edit support
  edited: {
    type: Boolean,
    default: false
  },
  // Soft-delete
  deleted: {
    type: Boolean,
    default: false
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Text index for search
messageSchema.index({ content: 'text', senderName: 'text' });

module.exports = mongoose.model('Message', messageSchema);
