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
  files: [fileSchema],
  versions: [versionSchema],
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
