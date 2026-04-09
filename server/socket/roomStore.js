const Y = require('yjs');

const ROOM_ID_LENGTH = 6;
const CURSOR_COLORS = [
  '#FF5733',
  '#33C1FF',
  '#75FF33',
  '#FF33A8',
  '#FFC733',
];

const DEFAULT_ROOM_FILE = {
  id: 'welcome-py',
  name: 'main.py',
  content:
    'print("Welcome to Synapse collaborative mode!")\nprint("Invite someone to this room and start coding together.")\n',
};

const rooms = new Map();

function generateRoomId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let roomId = '';

  for (let index = 0; index < ROOM_ID_LENGTH; index += 1) {
    roomId += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return roomId;
}

function cloneFiles(files = []) {
  return files.map((file) => ({
    id: file.id,
    name: file.name,
    content: file.content ?? '',
    updatedAt: file.updatedAt ?? Date.now(),
  }));
}

function createSharedDoc(initialContent = '') {
  const doc = new Y.Doc();
  const text = doc.getText('content');

  if (initialContent) {
    text.insert(0, initialContent);
  }

  return doc;
}

function getSharedText(doc) {
  return doc.getText('content');
}

function encodeUpdate(update) {
  return Buffer.from(update).toString('base64');
}

function decodeUpdate(encodedUpdate) {
  return Uint8Array.from(Buffer.from(encodedUpdate, 'base64'));
}

function hashUserId(userId = '') {
  return Array.from(String(userId)).reduce(
    (accumulator, character) => accumulator + character.charCodeAt(0),
    0
  );
}

function pickCursorColor(room, userId) {
  const existingColor = room.userColors.get(userId);
  if (existingColor) {
    return existingColor;
  }

  const activeColors = new Set(
    Array.from(room.participants.values())
      .map((participant) => participant.cursorColor)
      .filter(Boolean)
  );
  const availableColor = CURSOR_COLORS.find((color) => !activeColors.has(color));
  const nextColor =
    availableColor || CURSOR_COLORS[hashUserId(userId) % CURSOR_COLORS.length];

  room.userColors.set(userId, nextColor);
  return nextColor;
}

function createDefaultRoomState() {
  const now = Date.now();

  return {
    files: cloneFiles([{ ...DEFAULT_ROOM_FILE, updatedAt: now }]),
    activeFileId: DEFAULT_ROOM_FILE.id,
    openTabs: [DEFAULT_ROOM_FILE.id],
  };
}

function ensureRoomDocs(room, files = []) {
  const nextFileIds = new Set(files.map((file) => file.id));

  files.forEach((file) => {
    if (!room.sharedDocs.has(file.id)) {
      room.sharedDocs.set(file.id, createSharedDoc(file.content ?? ''));
      return;
    }

    const text = getSharedText(room.sharedDocs.get(file.id));
    if (text.toString() !== (file.content ?? '')) {
      room.sharedDocs.set(file.id, createSharedDoc(file.content ?? ''));
    }
  });

  Array.from(room.sharedDocs.keys()).forEach((fileId) => {
    if (!nextFileIds.has(fileId)) {
      room.sharedDocs.delete(fileId);
    }
  });
}

function getSharedDocsSnapshot(room) {
  const sharedDocs = {};

  room.sharedDocs.forEach((doc, fileId) => {
    sharedDocs[fileId] = encodeUpdate(Y.encodeStateAsUpdate(doc));
  });

  return sharedDocs;
}

function sanitizeRoom(room) {
  return {
    roomId: room.roomId,
    createdBy: room.createdBy,
    createdAt: room.createdAt,
    files: cloneFiles(room.files),
    activeFileId: room.activeFileId,
    openTabs: [...room.openTabs],
    participants: Array.from(room.participants.values()),
    sharedDocs: getSharedDocsSnapshot(room),
  };
}

function createRoom(owner) {
  let roomId = generateRoomId();

  while (rooms.has(roomId)) {
    roomId = generateRoomId();
  }

  const baseState = createDefaultRoomState();
  const room = {
    roomId,
    createdBy: owner.userId,
    createdAt: Date.now(),
    files: baseState.files,
    activeFileId: baseState.activeFileId,
    openTabs: baseState.openTabs,
    participants: new Map(),
    userColors: new Map(),
    sharedDocs: new Map(
      baseState.files.map((file) => [file.id, createSharedDoc(file.content)])
    ),
  };

  rooms.set(roomId, room);
  return sanitizeRoom(room);
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

function getRoomSnapshot(roomId) {
  const room = getRoom(roomId);
  return room ? sanitizeRoom(room) : null;
}

function addParticipant(roomId, participant) {
  const room = getRoom(roomId);
  if (!room) {
    return null;
  }

  Array.from(room.participants.entries()).forEach(([socketId, existingParticipant]) => {
    if (
      existingParticipant.userId === participant.userId &&
      socketId !== participant.socketId
    ) {
      room.participants.delete(socketId);
    }
  });

  const nextParticipant = {
    ...participant,
    cursorColor: pickCursorColor(room, participant.userId),
  };

  room.participants.set(nextParticipant.socketId, nextParticipant);
  return sanitizeRoom(room);
}

function removeParticipant(roomId, socketId) {
  const room = getRoom(roomId);
  if (!room) {
    return null;
  }

  const removedParticipant = room.participants.get(socketId) || null;
  room.participants.delete(socketId);

  return {
    room: sanitizeRoom(room),
    removedParticipant,
  };
}

function updateRoomState(roomId, updater) {
  const room = getRoom(roomId);
  if (!room) {
    return null;
  }

  updater(room);
  ensureRoomDocs(room, room.files);
  return sanitizeRoom(room);
}

function applyDocumentUpdate(roomId, fileId, encodedUpdate) {
  const room = getRoom(roomId);
  if (!room) {
    return null;
  }

  const targetFile = room.files.find((file) => file.id === fileId);
  if (!targetFile) {
    return null;
  }

  if (!room.sharedDocs.has(fileId)) {
    room.sharedDocs.set(fileId, createSharedDoc(targetFile.content));
  }

  const doc = room.sharedDocs.get(fileId);
  Y.applyUpdate(doc, decodeUpdate(encodedUpdate));
  const nextContent = getSharedText(doc).toString();
  targetFile.content = nextContent;
  targetFile.updatedAt = Date.now();

  return {
    fileId,
    content: nextContent,
    updatedAt: targetFile.updatedAt,
  };
}

function getDocumentState(roomId, fileId) {
  const room = getRoom(roomId);
  if (!room) {
    return null;
  }

  const doc = room.sharedDocs.get(fileId);
  if (!doc) {
    return null;
  }

  return encodeUpdate(Y.encodeStateAsUpdate(doc));
}

module.exports = {
  addParticipant,
  applyDocumentUpdate,
  createRoom,
  getDocumentState,
  getRoom,
  getRoomSnapshot,
  removeParticipant,
  updateRoomState,
};
