const Y = require('yjs');
const RoomModel = require('../models/Room');

const ROOM_ID_LENGTH = 6;
const CURSOR_COLORS = [
  '#FF6B6B',
  '#4ECDC4',
  '#45B7D1',
  '#F7B32B',
  '#7C3AED',
  '#10B981',
  '#F97316',
  '#EC4899',
  '#3B82F6',
  '#84CC16',
  '#EF4444',
  '#14B8A6',
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
    type: file.type || 'file',
    parentId: file.parentId || null,
    order: typeof file.order === 'number' ? file.order : 0,
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
    (accumulator, character, index) => accumulator + character.charCodeAt(0) * (index + 1),
    0
  );
}

function findFirstAvailable(items, usedItems) {
  return items.find((item) => !usedItems.has(item)) || null;
}

function buildParticipantAppearance(room, userId, username = '') {
  const existingAppearance = room.userAppearance.get(userId);
  if (existingAppearance) {
    return existingAppearance;
  }

  const activeColors = new Set(
    Array.from(room.participants.values())
      .map((participant) => participant.cursorColor)
      .filter(Boolean)
  );
  const hash = hashUserId(`${userId}:${username}`);
  const fallbackColor = CURSOR_COLORS[hash % CURSOR_COLORS.length];
  const normalizedName = String(username || '').trim();
  const nextAppearance = {
    cursorColor: findFirstAvailable(CURSOR_COLORS, activeColors) || fallbackColor,
    avatarGlyph: normalizedName.charAt(0).toUpperCase() || 'U',
  };

  room.userAppearance.set(userId, nextAppearance);
  return nextAppearance;
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
    roomName: room.roomName || 'Untitled Room',
    createdBy: room.createdBy,
    createdAt: room.createdAt,
    files: cloneFiles(room.files),
    activeFileId: room.activeFileId,
    openTabs: [...room.openTabs],
    participants: Array.from(room.participants.values()),
    sharedDocs: getSharedDocsSnapshot(room),
  };
}

async function createRoom(owner, roomName = 'Untitled Room') {
  let roomId = generateRoomId();

  while (rooms.has(roomId)) {
    roomId = generateRoomId();
  }

  const baseState = createDefaultRoomState();
  const room = {
    roomId,
    roomName,
    createdBy: owner.userId,
    createdAt: Date.now(),
    files: baseState.files,
    activeFileId: baseState.activeFileId,
    openTabs: baseState.openTabs,
    participants: new Map(),
    userAppearance: new Map(),
    sharedDocs: new Map(
      baseState.files.map((file) => [file.id, createSharedDoc(file.content)])
    ),
  };

  rooms.set(roomId, room);

  try {
    await RoomModel.create({
      roomId: room.roomId,
      roomName: room.roomName,
      createdBy: room.createdBy,
      files: baseState.files.map(f => ({ id: f.id, name: f.name, content: f.content, updatedAt: f.updatedAt })),
      lastUpdated: room.createdAt,
      createdAt: room.createdAt
    });
  } catch (err) {
    console.error('Failed to save room to DB:', err);
  }

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
    ...buildParticipantAppearance(room, participant.userId, participant.username),
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

async function loadRoomFromDB(roomId) {
  if (rooms.has(roomId)) return rooms.get(roomId);

  try {
    const dbRoom = await RoomModel.findOne({ roomId });
    if (!dbRoom) return null;

    const files = dbRoom.files && dbRoom.files.length > 0 ? dbRoom.files.map(f => ({
      id: f.id,
      name: f.name,
      type: f.type || 'file',
      parentId: f.parentId || null,
      order: typeof f.order === 'number' ? f.order : 0,
      content: f.content || '',
      updatedAt: f.updatedAt ? new Date(f.updatedAt).getTime() : Date.now()
    })) : cloneFiles([{ ...DEFAULT_ROOM_FILE, updatedAt: Date.now() }]);

    const room = {
      roomId: dbRoom.roomId,
      roomName: dbRoom.roomName || 'Untitled Room',
      createdBy: dbRoom.createdBy,
      createdAt: dbRoom.createdAt ? new Date(dbRoom.createdAt).getTime() : Date.now(),
      files: files,
      activeFileId: files[0].id,
      openTabs: files.map(f => f.id),
      participants: new Map(),
      userAppearance: new Map(),
      sharedDocs: new Map(
        files.map((file) => [file.id, createSharedDoc(file.content)])
      ),
    };

    rooms.set(roomId, room);
    return room;
  } catch (err) {
    console.error('Failed to load room from DB', err);
    return null;
  }
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
  loadRoomFromDB,
};
