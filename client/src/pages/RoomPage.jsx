import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import throttle from 'lodash.throttle';
import debounce from 'lodash.debounce';
import { useCallback } from 'react';
import { FileProvider, useFiles } from '../context/FileContext';
import { useAuth } from '../context/useAuth';
// P1-10: RoomPage chrome state lives in Zustand + hooks (see stores/roomUiStore).
import { useRoomUiStore } from '../stores/roomUiStore';
import { useRoomTheme } from '../hooks/useRoomTheme';
import { useLockNotice } from '../hooks/useLockNotice';
import { useInviteLink } from '../hooks/useInviteLink';
import Sidebar from '../components/Sidebar';
import TabBar from '../components/TabBar';
import EditorPanel from '../components/EditorPanel';
import Toolbar from '../components/Toolbar';
import OutputPanel from '../components/OutputPanel';
import StatusBar from '../components/StatusBar';
import NeuraPanel from '../components/NeuraPanel';
import { getThemeClasses } from '../utils/theme';
import { createCollaborationSocket } from '../services/socket';
import { getRoom, updateRoomSettings } from '../services/roomService';
import { RoomYjsManager } from '../services/yjsRoom';
import { getContentText, getFileText, identityFor } from '@synapse/room-doc';
import { CollabFileProvider } from '../context/CollabFileProvider';
import { useRoomCollab } from '../hooks/useRoomCollab';
import { useLocalPresence, usePeers } from '../hooks/usePresence';
import { useRoomMode } from '../hooks/useRoomMode';
import ConnectionBanner from '../components/ConnectionBanner';
import { connectionBannerState } from '../utils/connectionState';
import { rememberReturnTo } from '../utils/returnTo';
import { COLLAB_ENABLED } from '../config/apiConfig';

const FILE_LOCK_RENEW_INTERVAL_MS = 15000;
const EDIT_REJECTED_NOTICE_MS = 6000;

function lockDeniedMessage(reason, fileName, holderName) {
  switch (reason) {
    case 'held':
      return `${fileName} is locked by ${holderName || 'another member'}`;
    case 'disabled':
      return 'Edit locks are off for this room';
    case 'limit':
      return 'Release a lock before taking another';
    case 'expired':
      return `Your lock on ${fileName} expired`;
    case 'unknown-file':
      return `${fileName} no longer exists`;
    default:
      return 'Locks are unavailable right now. Try again in a moment.';
  }
}

function getStructureSignature({ files = [] }) {
  return JSON.stringify({
    files: files.map((file) => ({
      id: file.id,
      name: file.name,
      type: file.type,
      parentId: file.parentId,
      order: file.order,
    })),
  });
}

// `collab` is set when the room edits through the collab server (P2-06): the shared
// Y.Doc is then the source of truth for files and text, and the legacy relay is only
// used for chat, presence and cursors. With `collab` null this is the legacy path.
function RoomSession({ roomId, collab }) {
  const navigate = useNavigate();
  const collabDoc = collab?.doc ?? null;
  const isCollab = collabDoc !== null;
  const { user, logout } = useAuth();
  const { files, activeFileId, openTabs, updateContent, replaceState, replaceSharedFiles } = useFiles();
  const prevFilesRef = useRef([]);
  // P2-07: in collab mode presence is Yjs awareness on the room's connection, not Socket.IO.
  const awareness = collab?.awareness ?? null;
  const peers = usePeers(awareness, user?.userId);
  useLocalPresence(awareness, collabDoc, user, activeFileId);
  // P1-10: session chrome from the Zustand store + focused hooks.
  const { theme, toggleTheme } = useRoomTheme();
  const { lockNotice, showLockNotice } = useLockNotice();
  const { copied, copyInvite: handleCopyInvite } = useInviteLink(roomId);
  const output = useRoomUiStore((s) => s.output);
  const setOutput = useRoomUiStore((s) => s.setOutput);
  const connectionState = useRoomUiStore((s) => s.connectionState);
  const setConnectionState = useRoomUiStore((s) => s.setConnectionState);
  const loadingRoom = useRoomUiStore((s) => s.loadingRoom);
  const setLoadingRoom = useRoomUiStore((s) => s.setLoadingRoom);
  const roomReady = useRoomUiStore((s) => s.roomReady);
  const setRoomReady = useRoomUiStore((s) => s.setRoomReady);
  const error = useRoomUiStore((s) => s.error);
  const setError = useRoomUiStore((s) => s.setError);
  const roomName = useRoomUiStore((s) => s.roomName);
  const setRoomName = useRoomUiStore((s) => s.setRoomName);
  const [socketPresence, setSocketPresence] = useState({});
  const [yjsManager, setYjsManager] = useState(null);
  const [, setYjsDocVersion] = useState(0);
  const [editingUsers, setEditingUsers] = useState({});
  const [chatMessages, setChatMessages] = useState([]);
  const [typingUsers, setTypingUsers] = useState({});
  const [socketFileLocks, setSocketFileLocks] = useState({});
  const [roomCreatedBy, setRoomCreatedBy] = useState('');
  // Set to the value `locksEnabled` had when the creator clicked the toggle, until the server reports a change.
  const [toggledFrom, setToggledFrom] = useState(null);
  const toggleTimerRef = useRef(null);
  const socketRef = useRef(null);
  const suppressStructureSyncRef = useRef(null);
  const structureEmitterRef = useRef(null);
  const cursorEmitterRef = useRef(null);
  const selectionEmitterRef = useRef(null);
  const editingTimersRef = useRef({});
  const ownedLockRef = useRef(null);
  const canEditFileRef = useRef(() => true);
  const localChangeEmitterRef = useRef(() => {});
  const latestRoomStateRef = useRef({
    files: [],
    activeFileId: null,
    openTabs: [],
  });

  // Locks come from Socket.IO in legacy rooms and from the collab server's lock state otherwise (P2-08).
  const collabLocks = collab?.lockState.locks;
  const fileLocks = useMemo(
    () =>
      isCollab
        ? Object.fromEntries(Object.entries(collabLocks).map(([id, lock]) => [id, { userId: lock.userId, username: lock.name }]))
        : socketFileLocks,
    [isCollab, collabLocks, socketFileLocks]
  );
  const locksEnabled = isCollab && collab.lockState.enabled;
  const activeFileLock = activeFileId ? fileLocks[activeFileId] || null : null;
  const isActiveFileLockedByOther = Boolean(
    activeFileLock && activeFileLock.userId && activeFileLock.userId !== user?.userId
  );

  const canEditFile = useCallback(
    (fileId) => {
      if (!fileId) {
        return false;
      }

      const lock = fileLocks[fileId];
      return !lock || lock.userId === user?.userId;
    },
    [fileLocks, user?.userId]
  );

  useEffect(() => {
    canEditFileRef.current = canEditFile;
  }, [canEditFile]);

  const structureSignature = useMemo(
    () =>
      getStructureSignature({
        files,
      }),
    [files]
  );

  const handleLocalChange = useCallback((fileId, content) => {
    if (isCollab) return; // the server persists the document itself
    localChangeEmitterRef.current(fileId, content);
  }, [isCollab]);

  const handleSaveVersion = useCallback(() => {
    if (socketRef.current && activeFileId && (yjsManager || isCollab)) {
      const content = isCollab ? getFileText(collabDoc, activeFileId) : yjsManager.getText(activeFileId).toString();
      socketRef.current.emit('save-version', { roomId, fileId: activeFileId, content });
    }
  }, [activeFileId, yjsManager, roomId, isCollab, collabDoc]);

  useEffect(() => {
    latestRoomStateRef.current = {
      files: files.map(({ id, name, type, parentId, order, content, updatedAt }) => ({
        id,
        name,
        type,
        parentId,
        order,
        content,
        updatedAt,
      })),
      activeFileId,
      openTabs,
    };
  }, [files, activeFileId, openTabs]);

  useEffect(() => {
    const debouncedEmitter = debounce((fileId, content) => {
      socketRef.current?.emit('autosave', { roomId, fileId, content });
    }, 1500);

    localChangeEmitterRef.current = debouncedEmitter;

    return () => {
      debouncedEmitter.cancel();
      localChangeEmitterRef.current = () => {};
    };
  }, [roomId]);

  useEffect(() => {
    if (!user?.userId || !user?.name) {
      return undefined;
    }

    const socket = createCollaborationSocket();
    socketRef.current = socket;

    const manager = isCollab ? null : new RoomYjsManager({
      socket,
      roomId,
      userId: user.userId,
      canEditFile: (fileId) => canEditFileRef.current(fileId),
      onFileContent: (fileId, content) => {
        updateContent(fileId, content, { updatedAt: Date.now() });
      },
      onDocReplaced: () => {
        setYjsDocVersion((version) => version + 1);
      },
    });
    setYjsManager(manager);

    const throttledStateSync = throttle((payload) => {
      socket.emit('sync-room-state', payload);
    }, 120, { leading: true, trailing: true });

    const throttledCursorSync = throttle((position) => {
      // P0-03/P1-04: identity comes from the JWT; only position is sent.
      socket.emit('cursor-move', {
        roomId,
        position,
      });
    }, 50, { leading: true, trailing: true });

    const throttledSelectionSync = throttle((selectionRange) => {
      socket.emit('selection-change', {
        roomId,
        selectionRange,
      });
    }, 50, { leading: true, trailing: true });

    structureEmitterRef.current = throttledStateSync;
    cursorEmitterRef.current = throttledCursorSync;
    selectionEmitterRef.current = throttledSelectionSync;

    const handleConnect = () => {
      setConnectionState('connected');
      setError('');
      // P0-03: identity comes from the JWT — only roomId is sent.
      // A collab client joins for chat only (P2-10): its files are not loaded into the api.
      socket.emit('join-room', isCollab ? { roomId, collab: true } : { roomId });
    };

    const handleDisconnect = () => {
      setConnectionState('disconnected');
    };

    const handleConnectError = (connectError) => {
      setConnectionState('disconnected');
      setLoadingRoom(false);
      setRoomReady(false);
      setError(connectError.message || 'Failed to connect to the collaboration server.');
      if (/expired|invalid|auth/i.test(connectError.message || '')) {
        logout();
        navigate('/login');
      }
    };

    const applySharedDocs = (sharedDocs, nextFiles) => {
      manager?.applySharedStates(sharedDocs, nextFiles);
    };

    const handleRoomJoined = ({ room, sharedDocs, fileLocks: initialFileLocks, participant }) => {
      suppressStructureSyncRef.current = getStructureSignature(room);
      setRoomName(room.roomName || '');
      replaceState(room);
      applySharedDocs(sharedDocs, room.files);
      setSocketFileLocks(initialFileLocks || {});
      setLoadingRoom(false);
      setRoomReady(true);
      setError('');
      if (participant) {
        setSocketPresence((previous) => ({
          ...previous,
          [participant.userId]: {
            userId: participant.userId,
            username: participant.username,
            cursorColor: participant.cursorColor,
            avatarGlyph: participant.avatarGlyph,
          },
        }));
      }
      socket.emit('request-chat-history', { roomId, limit: 50 });
    };

    const handleRoomUsers = (nextParticipants) => {
      setSocketPresence((previous) => {
        const nextPresence = {};
        nextParticipants.forEach((participant) => {
          nextPresence[participant.userId] = {
            ...previous[participant.userId],
            userId: participant.userId,
            username: participant.username,
            cursorColor: participant.cursorColor,
            avatarGlyph: participant.avatarGlyph,
          };
        });
        return nextPresence;
      });
    };

    const handleRoomStateUpdated = (nextState) => {
      suppressStructureSyncRef.current = getStructureSignature(nextState);
      replaceSharedFiles(nextState);
      applySharedDocs(nextState.sharedDocs, nextState.files);
    };

    const handleRemoteCodeChange = ({ fileId, changes }) => {
      manager?.applyRemoteUpdate(fileId, changes);
    };

    const handleUserEditing = ({ userId: peerId, username: peerName, cursorColor: peerColor, fileId }) => {
      setEditingUsers((prev) => ({
        ...prev,
        [peerId]: {
          userId: peerId,
          username: peerName,
          cursorColor: peerColor,
          fileId,
          lastEdit: Date.now(),
        },
      }));
      // Clear the "editing" indicator after 2 seconds of inactivity
      clearTimeout(editingTimersRef.current[peerId]);
      editingTimersRef.current[peerId] = setTimeout(() => {
        setEditingUsers((prev) => {
          const next = { ...prev };
          delete next[peerId];
          return next;
        });
      }, 2000);
    };

    const handleCursorUpdate = (payload) => {
      setSocketPresence((previous) => ({
        ...previous,
        [payload.userId]: {
          ...previous[payload.userId],
          userId: payload.userId,
          username: payload.username,
          cursorColor: payload.cursorColor,
          avatarGlyph: payload.avatarGlyph,
          position: payload.position,
          socketId: payload.socketId,
        },
      }));
    };

    const handleSelectionUpdate = (payload) => {
      setSocketPresence((previous) => ({
        ...previous,
        [payload.userId]: {
          ...previous[payload.userId],
          userId: payload.userId,
          username: payload.username,
          cursorColor: payload.cursorColor,
          avatarGlyph: payload.avatarGlyph,
          selectionRange: payload.selectionRange,
          socketId: payload.socketId,
        },
      }));
    };

    const handleUserJoined = ({ username, cursorColor, avatarGlyph, userId }) => {
      setSocketPresence((previous) => ({
        ...previous,
        [userId]: {
          ...previous[userId],
          userId,
          username,
          cursorColor,
          avatarGlyph,
        },
      }));
    };

    const handleUserLeft = ({ userId }) => {
      if (!userId) {
        return;
      }

      setSocketPresence((previous) => {
        const nextState = { ...previous };
        delete nextState[userId];
        return nextState;
      });
    };

    const handleRoomError = ({ message }) => {
      setLoadingRoom(false);
      setRoomReady(false);
      setError(message);
    };

    const handleFileLocksUpdated = ({ locks = {} }) => {
      setSocketFileLocks(locks);
    };

    const handleLockDenied = ({ fileId, lockedBy }) => {
      const lockedFile = latestRoomStateRef.current.files.find((file) => file.id === fileId);
      const label = lockedFile?.name || 'This file';
      showLockNotice(`${label} is locked by ${lockedBy?.username || 'another user'}`);
      if (ownedLockRef.current === fileId) {
        ownedLockRef.current = null;
      }
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('room-joined', handleRoomJoined);
    socket.on('room-users', handleRoomUsers);
    socket.on('room-state-updated', handleRoomStateUpdated);
    socket.on('remote-code-change', handleRemoteCodeChange);
    if (!isCollab) {
      socket.on('user-editing', handleUserEditing);
      socket.on('cursor-update', handleCursorUpdate);
      socket.on('selection-update', handleSelectionUpdate);
    }
    socket.on('user-joined', handleUserJoined);
    socket.on('user-left', handleUserLeft);
    socket.on('room-error', handleRoomError);
    socket.on('file-locks-updated', handleFileLocksUpdated);
    socket.on('lock-denied', handleLockDenied);
    socket.on('chat-message', (msg) => setChatMessages((prev) => [...prev, msg]));
    socket.on('chat-history', (history = []) => {
      setChatMessages((prev) => {
        const merged = [...history, ...prev];
        const seen = new Set();

        return merged
          .filter((message) => {
            const key = message?._id || `${message?.timestamp}-${message?.content}`;
            if (seen.has(key)) {
              return false;
            }
            seen.add(key);
            return true;
          })
          .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
      });
    });
    socket.on('chat-message-updated', (updated) => {
      setChatMessages((prev) => prev.map(m => (m._id === updated._id ? updated : m)));
    });
    socket.on('chat-search-results', (results) => {
      // Store search results in a separate state via a custom event
      window.dispatchEvent(new CustomEvent('chat-search-results', { detail: results }));
    });
    socket.on('user-typing', ({ userId: tid, username: tname, isTyping }) => {
      setTypingUsers((prev) => {
        if (!isTyping) { const n = { ...prev }; delete n[tid]; return n; }
        return { ...prev, [tid]: tname };
      });
    });
    socket.connect();

    return () => {
      throttledStateSync.cancel();
      throttledCursorSync.cancel();
      throttledSelectionSync.cancel();
      structureEmitterRef.current = null;
      cursorEmitterRef.current = null;
      selectionEmitterRef.current = null;
      Object.values(editingTimersRef.current).forEach(clearTimeout);
      editingTimersRef.current = {};
      socket.off('file-locks-updated', handleFileLocksUpdated);
      socket.off('lock-denied', handleLockDenied);
      socket.off('chat-message');
      socket.off('chat-history');
      socket.off('chat-message-updated');
      socket.off('chat-search-results');
      socket.off('user-typing');
      socket.emit('leave-room');
      socket.disconnect();
      manager?.destroy();
      setYjsManager(null);
    };
  }, [isCollab, logout, navigate, replaceSharedFiles, replaceState, roomId, showLockNotice, updateContent, user, setConnectionState, setError, setLoadingRoom, setRoomName, setRoomReady]);

  useEffect(() => {
    let cancelled = false;

    async function validateRoom() {
      try {
        const { room } = await getRoom(roomId);
        if (!cancelled) setRoomCreatedBy(room?.createdBy || '');
      } catch (requestError) {
        if (!cancelled) {
          setLoadingRoom(false);
          setRoomReady(false);
          setError(requestError.message);
        }
      }
    }

    validateRoom();

    return () => {
      cancelled = true;
    };
  }, [roomId, setError, setLoadingRoom, setRoomReady]);

  useEffect(() => {
    const socket = socketRef.current;
    if (isCollab || !socket || connectionState !== 'connected' || loadingRoom || !roomReady) {
      return;
    }

    if (suppressStructureSyncRef.current === structureSignature) {
      suppressStructureSyncRef.current = null;
      return;
    }
    suppressStructureSyncRef.current = null;

    structureEmitterRef.current?.(latestRoomStateRef.current);
  }, [structureSignature, connectionState, loadingRoom, roomReady, isCollab]);

  useEffect(() => {
    const socket = socketRef.current;
    // Focus locks are off in collab mode: concurrent edits merge, and P2-08 brings locks back as an option.
    if (isCollab || !socket || connectionState !== 'connected' || !roomReady) {
      return undefined;
    }

    const previousFileId = ownedLockRef.current;
    if (previousFileId && previousFileId !== activeFileId) {
      socket.emit('release-file-lock', { roomId, fileId: previousFileId });
      ownedLockRef.current = null;
    }

    if (!activeFileId) {
      return undefined;
    }

    socket.emit('request-file-lock', { roomId, fileId: activeFileId });
    ownedLockRef.current = activeFileId;

    const renewTimer = window.setInterval(() => {
      socket.emit('renew-file-lock', { roomId, fileId: activeFileId });
    }, FILE_LOCK_RENEW_INTERVAL_MS);

    return () => {
      window.clearInterval(renewTimer);
    };
  }, [activeFileId, connectionState, roomId, roomReady, isCollab]);

  useEffect(() => {
    if (!ownedLockRef.current) {
      return;
    }

    const stillExists = files.some((file) => file.id === ownedLockRef.current);
    if (stillExists) {
      return;
    }

    socketRef.current?.emit('release-file-lock', { roomId, fileId: ownedLockRef.current });
    ownedLockRef.current = null;
  }, [files, roomId]);

  // --- Focus locks in collab mode (P2-08) ---
  const lockFn = collab?.lock;
  const heldIds = useMemo(
    () => Object.entries(fileLocks).filter(([, lock]) => lock.userId === user?.userId).map(([id]) => id),
    [fileLocks, user?.userId]
  );
  const heldKey = heldIds.join('|');
  const heldRef = useRef(new Set());
  const previousFileRef = useRef(null);

  // Keep the locks I hold alive: the server drops one 45 s after its last renewal.
  useEffect(() => {
    if (!isCollab || heldKey === '') return undefined;
    const ids = heldKey.split('|');
    const timer = window.setInterval(() => ids.forEach((id) => lockFn('renew', id)), FILE_LOCK_RENEW_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isCollab, heldKey, lockFn]);

  // A lock follows focus: moving to another file gives the old one up.
  useEffect(() => {
    heldRef.current = new Set(heldIds);
  }, [heldIds]);
  useEffect(() => {
    const previous = previousFileRef.current;
    previousFileRef.current = activeFileId;
    if (isCollab && previous && previous !== activeFileId && heldRef.current.has(previous)) lockFn('release', previous);
  }, [activeFileId, isCollab, lockFn]);

  // The server refused a lock request: say why.
  const lockDenied = collab?.denied;
  useEffect(() => {
    if (!lockDenied) return;
    const fileName = latestRoomStateRef.current.files.find((file) => file.id === lockDenied.fileId)?.name || 'This file';
    showLockNotice(lockDeniedMessage(lockDenied.reason, fileName, lockDenied.holder?.name));
  }, [lockDenied, showLockNotice]);

  useEffect(() => () => window.clearTimeout(toggleTimerRef.current), []);
  const handleToggleLocks = useCallback(async () => {
    setToggledFrom(locksEnabled);
    window.clearTimeout(toggleTimerRef.current);
    // The change reaches editors within a couple of seconds; stop waiting for it after a few more.
    toggleTimerRef.current = window.setTimeout(() => setToggledFrom(null), 6000);
    try {
      await updateRoomSettings(roomId, { locksEnabled: !locksEnabled });
    } catch (toggleError) {
      setToggledFrom(null);
      showLockNotice(toggleError.message || 'Could not change the lock setting.');
    }
  }, [locksEnabled, roomId, showLockNotice]);

  const lockControls =
    locksEnabled && activeFileId
      ? {
          heldByMe: Boolean(activeFileLock) && !isActiveFileLockedByOther,
          onAcquire: () => lockFn('acquire', activeFileId),
          onRelease: () => lockFn('release', activeFileId),
        }
      : null;
  const locksControl =
    isCollab && roomCreatedBy && roomCreatedBy === user?.userId
      ? { enabled: locksEnabled, canToggle: true, busy: toggledFrom !== null && toggledFrom === locksEnabled, onToggle: handleToggleLocks }
      : null;

  // getText() returns a STABLE Y.Text reference — no fallback content is
  // provided here so we never pre-seed locally. Content comes exclusively
  // from the server (applySharedStates) to avoid CRDT double-inserts.
  const sharedText = !activeFileId
    ? null
    : isCollab
      ? getContentText(collabDoc, activeFileId)
      : yjsManager
        ? yjsManager.getText(activeFileId)
        : null;

  // The collab server refused us. At join (expired token, not a member, unknown room) that ends the
  // visit. If it happens after the room was open (the sign-in ran out while we were offline), the
  // editor stays on screen, read-only, with a banner (P2-12).
  const collabAuthError = collab?.authError || '';
  const authLost = Boolean(collabAuthError) && Boolean(collab?.synced);
  const refusedAtJoin = Boolean(collabAuthError) && !authLost;
  useEffect(() => {
    if (!refusedAtJoin) return;
    setLoadingRoom(false);
    setRoomReady(false);
    setError(collabAuthError);
  }, [refusedAtJoin, collabAuthError, setError, setLoadingRoom, setRoomReady]);
  const collabPending = isCollab && !collab.synced && !collabAuthError;

  const handleSignIn = useCallback(() => {
    rememberReturnTo(`/room/${roomId}`);
    logout();
    navigate('/login');
  }, [logout, navigate, roomId]);

  // Closing the tab while changes are still only here would lose them.
  const unsyncedChanges = collab?.unsynced ?? 0;
  useEffect(() => {
    if (unsyncedChanges === 0) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsyncedChanges]);

  const bannerState = isCollab
    ? connectionBannerState({ status: collab.status, synced: collab.synced, unsynced: unsyncedChanges, authLost, refusal: collabAuthError })
    : null;

  // Detect newly created files (present in current files but not previous)
  // and seed their Y.Doc locally so the editor isn't blank before the
  // server echo comes back.
  useEffect(() => {
    if (!yjsManager || !roomReady) return;
    const prevIds = new Set(prevFilesRef.current.map((f) => f.id));
    files.forEach((file) => {
      if (!prevIds.has(file.id)) {
        yjsManager.seedNewFile(file.id, file.content || '');
      }
    });
    prevFilesRef.current = files;
  }, [files, yjsManager, roomReady]);

  // Cursors and selections travel as awareness in collab mode (y-monaco), never over Socket.IO.
  const handleCursorMove = (position) => {
    if (isCollab || !cursorEmitterRef.current || !activeFileId) {
      return;
    }

    cursorEmitterRef.current({
      fileId: activeFileId,
      lineNumber: position.lineNumber,
      column: position.column,
    });
  };

  const handleSelectionChange = (selectionRange) => {
    if (isCollab || !selectionEmitterRef.current || !activeFileId) {
      return;
    }

    selectionEmitterRef.current({
      ...selectionRange,
      fileId: activeFileId,
    });
  };

  const handleExitRoom = useCallback(() => {
    const socket = socketRef.current;

    structureEmitterRef.current?.cancel?.();
    localChangeEmitterRef.current?.cancel?.();

    if (socket?.connected) {
      if (roomReady && !isCollab) {
        socket.emit('sync-room-state', latestRoomStateRef.current);
      }
      if (ownedLockRef.current) {
        socket.emit('release-file-lock', { roomId, fileId: ownedLockRef.current });
        ownedLockRef.current = null;
      }
      socket.emit('leave-room');
      socket.disconnect();
    }

    navigate('/dashboard');
  }, [navigate, roomId, roomReady, isCollab]);

  // The people list. Collab mode derives it from awareness; legacy rooms from the relay.
  const collaborators = useMemo(() => {
    if (!isCollab) return Object.values(socketPresence);
    return peers.map((peer) => {
      const fileName = files.find((file) => file.id === peer.fileId)?.name;
      return {
        userId: peer.userId,
        username: peer.name,
        cursorColor: peer.color,
        avatarGlyph: peer.glyph,
        isYou: peer.isYou,
        activity: fileName ? `${peer.typing ? 'Typing in' : 'Viewing'} ${fileName}` : 'Online',
      };
    });
  }, [isCollab, peers, socketPresence, files]);

  const liveEditors = useMemo(() => {
    if (!isCollab) return editingUsers;
    return Object.fromEntries(
      peers
        .filter((peer) => !peer.isYou && peer.typing && peer.fileId)
        .map((peer) => [peer.userId, { userId: peer.userId, username: peer.name, cursorColor: peer.color, fileId: peer.fileId }])
    );
  }, [isCollab, peers, editingUsers]);

  const activeRemotePeers = useMemo(
    () =>
      isCollab
        ? []
        : Object.values(socketPresence).filter(
            (peer) =>
              peer.userId !== user?.userId &&
              (peer.position?.fileId === activeFileId ||
                peer.selectionRange?.fileId === activeFileId)
          ),
    [isCollab, activeFileId, socketPresence, user?.userId]
  );
  const toolbarUser = useMemo(() => {
    if (isCollab && user?.userId) {
      const identity = identityFor({ userId: user.userId, name: user.name ?? '' });
      return { ...user, username: identity.name, cursorColor: identity.color, avatarGlyph: identity.glyph };
    }
    const participant = user?.userId ? socketPresence[user.userId] : null;
    return participant
      ? {
          ...user,
          username: participant.username,
          cursorColor: participant.cursorColor,
          avatarGlyph: participant.avatarGlyph,
        }
      : user;
  }, [isCollab, socketPresence, user]);

  if (loadingRoom || collabPending) {
    return (
      <div className="auth-loading-screen">
        <div className="auth-loading-spinner" />
        <p className="auth-loading-text">
          {isCollab && collab.status === 'disconnected'
            ? 'Cannot reach the collaboration server. Retrying...'
            : `Connecting to room ${roomId}...`}
        </p>
      </div>
    );
  }

  if (error && !roomReady) {
    return (
      <div className="auth-page">
        <div className="auth-container">
          <div className="auth-card">
            <div className="auth-card-header">
              <h1 className="auth-title">Unable to join room</h1>
              <p className="auth-subtitle">{error}</p>
            </div>
            <button className="auth-btn" onClick={() => navigate('/join-room')}>
              Return to join room
            </button>
          </div>
        </div>
      </div>
    );
  }

  const t = getThemeClasses(theme);

  return (
    <div className={`flex flex-col h-screen ${t.bg} ${t.text} font-sans select-none overflow-hidden transition-colors duration-300`} data-theme={theme}>
      <Toolbar 
        theme={theme} 
        onToggleTheme={toggleTheme} 
        setOutput={setOutput}
        roomId={roomId}
        roomName={roomName}
        copied={copied}
        onCopyInvite={handleCopyInvite}
        onExitRoom={handleExitRoom}
        onSaveVersion={handleSaveVersion}
        currentUser={toolbarUser}
        locksControl={locksControl}
      />

      <div className={`flex flex-1 overflow-hidden p-2 gap-2 ${theme === 'dark' ? 'bg-[#0b1410]' : 'bg-[#ebebeb]'}`}>
        <Sidebar 
          theme={theme} 
          collaborators={collaborators}
          chatMessages={chatMessages}
          typingUsers={Object.values(typingUsers)}
          getSocket={() => socketRef.current}
          roomId={roomId}
          currentUser={user}
          fileLocks={fileLocks}
        />

        <main className={`flex-1 min-w-0 flex flex-col ${t.editorBg} overflow-hidden rounded-xl border shadow-lg ${theme === 'dark' ? 'border-white/10 shadow-black/50' : 'border-slate-300 shadow-slate-200/50'} relative transition-colors duration-300`}>
          <ConnectionBanner state={bannerState} unsynced={unsyncedChanges} refusal={collabAuthError} onSignIn={handleSignIn} onReload={() => window.location.reload()} />
          <TabBar theme={theme} roomId={roomId} fileLocks={fileLocks} currentUserId={user?.userId} />
          
          <EditorPanel
            theme={theme}
            onCursorMove={handleCursorMove}
            onSelectionChange={handleSelectionChange}
            onLocalChange={handleLocalChange}
            sharedText={sharedText}
            awareness={awareness}
            remotePeers={activeRemotePeers}
            editingUsers={liveEditors}
            activeFileId={activeFileId}
            activeFileLock={activeFileLock}
            isReadOnly={isActiveFileLockedByOther || authLost}
            lockNotice={lockNotice}
            lockControls={lockControls}
          />
          
          <OutputPanel theme={theme} output={output} />
        </main>

        <NeuraPanel theme={theme} />
      </div>

      <StatusBar
        theme={theme}
        peersCount={collaborators.length}
        activeFileLock={activeFileLock}
        currentUserId={user?.userId}
      />
    </div>
  );
}

// One attempt at editing the room: a connection, a document and a client id.
function CollabSession({ roomId, onEditRejected }) {
  const collab = useRoomCollab(roomId);
  const rejection = collab.rejection;

  useEffect(() => {
    if (rejection) onEditRejected(rejection);
  }, [rejection, onEditRejected]);

  return (
    <CollabFileProvider doc={collab.doc} readOnly={Boolean(collab.authError) && collab.synced}>
      <RoomSession roomId={roomId} collab={collab} />
    </CollabFileProvider>
  );
}

function CollabRoom({ roomId }) {
  const [attempt, setAttempt] = useState(0);
  const setLockNotice = useRoomUiStore((s) => s.setLockNotice);
  const noticeTimerRef = useRef(null);

  useEffect(() => () => window.clearTimeout(noticeTimerRef.current), []);

  // Yjs applies a client's changes in order, so once the server has dropped one of ours (the file
  // was locked) nothing later from this client can be applied. Starting over with a new document
  // and client id is the way back; the unsaved edit is lost, as the notice says.
  const handleEditRejected = useCallback(
    (rejection) => {
      const holder = rejection.holders[0]?.name || 'another member';
      setLockNotice(`Your last edit was not saved: ${holder} has the file locked.`);
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = window.setTimeout(() => setLockNotice(''), EDIT_REJECTED_NOTICE_MS);
      setAttempt((count) => count + 1);
    },
    [setLockNotice]
  );

  return <CollabSession key={attempt} roomId={roomId} onEditRejected={handleEditRejected} />;
}

export default function RoomPage() {
  const { roomId } = useParams();
  const normalizedRoomId = String(roomId || '').toUpperCase();

  // In a collab build, the room's own flag decides (P2-10): a room pinned to the classic editor opens there.
  const mode = useRoomMode(normalizedRoomId, COLLAB_ENABLED);

  if (mode === 'loading') {
    return (
      <div className="auth-loading-screen">
        <div className="auth-loading-spinner" />
        <p className="auth-loading-text">Opening room {normalizedRoomId}...</p>
      </div>
    );
  }

  if (mode === 'collab') {
    // keyed so moving between rooms gets a fresh document and connection
    return <CollabRoom key={normalizedRoomId} roomId={normalizedRoomId} />;
  }

  return (
    <FileProvider storageKey={null}>
      <RoomSession roomId={normalizedRoomId} collab={null} />
    </FileProvider>
  );
}
