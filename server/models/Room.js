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
  // P2-10: which editor owns this room's files. Absent: never migrated, and the first collab client
  // to open it migrates it. 2: the room lives in the collab server (Room.files is no longer written).
  // 1: pinned to the classic Socket.IO editor (what a rollback sets); collab refuses the room.
  collabVersion: {
    type: Number,
    enum: [1, 2],
  },
  // P2-08: when on, members can take exclusive edit locks on files (enforced by the collab server).
  locksEnabled: {
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

module.exports = mongoose.models.Room || mongoose.model('Room', roomSchema);
