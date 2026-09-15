const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  type: { type: String, enum: ['file', 'folder'], default: 'file' },
  parentId: { type: String, default: null },
  order: { type: Number, default: 0 },
  isOpen: { type: Boolean, default: false },
  content: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now },
});

const versionSchema = new mongoose.Schema({
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  fileId: { type: String, required: true }, // Optional but good for multiple files
});

const roomMemberSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
    },
    username: {
      type: String,
      default: '',
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    lastVisitedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const roomSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
    unique: true,
  },
  roomName: {
    type: String,
    required: true,
  },
  createdBy: {
    type: String,
    required: true,
  },
  // P0-16 (interim): when true, only the creator and recorded members may
  // join via sockets. This is NOT the Phase 3 role system — just a guard
  // against strangers who guess the room code. Defaults to open.
  isInviteOnly: {
    type: Boolean,
    default: false,
  },
  files: [fileSchema],
  versions: [versionSchema],
  members: {
    type: [roomMemberSchema],
    default: [],
  },
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Room', roomSchema);
