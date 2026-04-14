const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      default: 'New Chat',
      trim: true,
      maxlength: 120,
    },
  },
  {
    timestamps: true,
    collection: 'ai_conversations',
  }
);

module.exports = mongoose.model('Conversation', conversationSchema);
