import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import throttle from 'lodash.throttle';
import debounce from 'lodash.debounce';
import { useCallback } from 'react';
import { FileProvider, useFiles } from '../contexts/FileContext';
import { useAuth } from '../context/useAuth';
import Sidebar from '../components/Sidebar';
import TabBar from '../components/TabBar';
import EditorPanel from '../components/EditorPanel';
import Toolbar from '../components/Toolbar';
import OutputPanel from '../components/OutputPanel';
import StatusBar from '../components/StatusBar';
import NeuraPanel from '../components/NeuraPanel';
import { getThemeClasses } from '../utils/theme';
import { createCollaborationSocket } from '../services/socket';
import { getRoom } from '../services/roomService';
import { RoomYjsManager } from '../services/yjsRoom';

const FILE_LOCK_RENEW_INTERVAL_MS = 15000;

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

function RoomSession({ roomId }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { files, activeFileId, openTabs, updateContent, replaceState, replaceSharedFiles } = useFiles();
  const prevFilesRef = useRef([]);
  const [theme, setTheme] = useState(() => localStorage.getItem('synapse-theme') || 'dark');
  const [output, setOutput] = useState({
    stdout: '',
    stderr: '',
    compile_output: '',
    status: null,
    error: null,
    running: false,
  });
  const [connectionState, setConnectionState] = useState('connecting');
  const [loadingRoom, setLoadingRoom] = useState(true);
  const [roomReady, setRoomReady] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [presence, setPresence] = useState({});
  const [yjsManager, setYjsManager] = useState(null);
  const [, setYjsDocVersion] = useState(0);
  const [editingUsers, setEditingUsers] = useState({});
  const [chatMessages, setChatMessages] = useState([]);
  const [typingUsers, setTypingUsers] = useState({});
  const [fileLocks, setFileLocks] = useState({});
  const [roomName, setRoomName] = useState('');
  const [lockNotice, setLockNotice] = useState('');
  const socketRef = useRef(null);
  const suppressStructureSyncRef = useRef(null);
  const copyTimerRef = useRef(null);
  const lockNoticeTimerRef = useRef(null);
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

  const showLockNotice = useCallback((message) => {
    setLockNotice(message);
    clearTimeout(lockNoticeTimerRef.current);
    lockNoticeTimerRef.current = setTimeout(() => {
      setLockNotice('');
    }, 3500);
  }, []);

  useEffect(() => {
    canEditFileRef.current = canEditFile;
  }, [canEditFile]);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('synapse-theme', nextTheme);
  };

  const structureSignature = useMemo(
    () =>
      getStructureSignature({
        files,
      }),
    [files]
  );

  const handleLocalChange = useCallback((fileId, content) => {
    localChangeEmitterRef.current(fileId, content);
  }, []);

  const handleSaveVersion = useCallback(() => {
    if (socketRef.current && activeFileId && yjsManager) {
      const content = yjsManager.getText(activeFileId).toString();
      socketRef.current.emit('save-version', { roomId, fileId: activeFileId, content });
    }
  }, [activeFileId, yjsManager, roomId]);

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

    const manager = new RoomYjsManager({
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
      socket.emit('cursor-move', {
        roomId,
        userId: user.userId,
        username: user.name,
        position,
      });
    }, 50, { leading: true, trailing: true });

    const throttledSelectionSync = throttle((selectionRange) => {
      socket.emit('selection-change', {
        roomId,
        userId: user.userId,
        username: user.name,
        selectionRange,
      });
    }, 50, { leading: true, trailing: true });

    structureEmitterRef.current = throttledStateSync;
    cursorEmitterRef.current = throttledCursorSync;
    selectionEmitterRef.current = throttledSelectionSync;

    const handleConnect = () => {
      setConnectionState('connected');
      setError('');
      socket.emit('join-room', {
        roomId,
        username: user.name,
        userId: user.userId,
      });
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
      manager.applySharedStates(sharedDocs, nextFiles);
    };

    const handleRoomJoined = ({ room, sharedDocs, fileLocks: initialFileLocks, participant }) => {
      suppressStructureSyncRef.current = getStructureSignature(room);
      setRoomName(room.roomName || '');
      replaceState(room);
      applySharedDocs(sharedDocs, room.files);
      setFileLocks(initialFileLocks || {});
      setLoadingRoom(false);
      setRoomReady(true);
      setError('');
      if (participant) {
        setPresence((previous) => ({
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
      setPresence((previous) => {
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
      manager.applyRemoteUpdate(fileId, changes);
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
      setPresence((previous) => ({
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
      setPresence((previous) => ({
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
      setPresence((previous) => ({
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

      setPresence((previous) => {
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
      setFileLocks(locks);
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
    socket.on('user-editing', handleUserEditing);
    socket.on('cursor-update', handleCursorUpdate);
    socket.on('selection-update', handleSelectionUpdate);
    socket.on('user-joined', handleUserJoined);
    socket.on('user-left', handleUserLeft);
    socket.on('room-error', handleRoomError);
    socket.on('file-locks-updated', handleFileLocksUpdated);
    socket.on('lock-denied', handleLockDenied);
    socket.on('chat-message', (msg) => setChatMessages((prev) => [...prev, msg]));
    socket.on('chat-history', (history) => setChatMessages(history));
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
      clearTimeout(copyTimerRef.current);
      clearTimeout(lockNoticeTimerRef.current);
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
      manager.destroy();
      setYjsManager(null);
    };
  }, [logout, navigate, replaceSharedFiles, replaceState, roomId, showLockNotice, updateContent, user]);

  useEffect(() => {
    let cancelled = false;

    async function validateRoom() {
      try {
        await getRoom(roomId);
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
  }, [roomId]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || connectionState !== 'connected' || loadingRoom || !roomReady) {
      return;
    }

    if (suppressStructureSyncRef.current === structureSignature) {
      suppressStructureSyncRef.current = null;
      return;
    }
    suppressStructureSyncRef.current = null;

    structureEmitterRef.current?.(latestRoomStateRef.current);
  }, [structureSignature, connectionState, loadingRoom, roomReady]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || connectionState !== 'connected' || !roomReady) {
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
  }, [activeFileId, connectionState, roomId, roomReady]);

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

  // getText() returns a STABLE Y.Text reference — no fallback content is
  // provided here so we never pre-seed locally. Content comes exclusively
  // from the server (applySharedStates) to avoid CRDT double-inserts.
  const sharedText = activeFileId && yjsManager ? yjsManager.getText(activeFileId) : null;

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

  const handleCursorMove = (position) => {
    if (!cursorEmitterRef.current || !activeFileId) {
      return;
    }

    cursorEmitterRef.current({
      fileId: activeFileId,
      lineNumber: position.lineNumber,
      column: position.column,
    });
  };

  const handleSelectionChange = (selectionRange) => {
    if (!selectionEmitterRef.current || !activeFileId) {
      return;
    }

    selectionEmitterRef.current({
      ...selectionRange,
      fileId: activeFileId,
    });
  };

  const handleCopyInvite = async () => {
    const publicAppUrl = (import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin).replace(
      /\/+$/,
      ''
    );
    const inviteLink = `${publicAppUrl}/room/${roomId}`;

    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Could not copy the invite link from this browser.');
    }
  };

  const activeRemotePeers = useMemo(
    () =>
      Object.values(presence).filter(
        (peer) =>
          peer.userId !== user?.userId &&
          (peer.position?.fileId === activeFileId ||
            peer.selectionRange?.fileId === activeFileId)
      ),
    [activeFileId, presence, user?.userId]
  );

  if (loadingRoom) {
    return (
      <div className="auth-loading-screen">
        <div className="auth-loading-spinner" />
        <p className="auth-loading-text">Connecting to room {roomId}...</p>
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
        onSaveVersion={handleSaveVersion}
        currentUser={user}
      />

      <div className={`flex flex-1 overflow-hidden p-2 gap-2 ${theme === 'dark' ? 'bg-[#030509]' : 'bg-slate-200/60'}`}>
        <Sidebar 
          theme={theme} 
          collaborators={Object.values(presence)} 
          chatMessages={chatMessages}
          typingUsers={Object.values(typingUsers)}
          getSocket={() => socketRef.current}
          roomId={roomId}
          currentUser={user}
          fileLocks={fileLocks}
        />

        <main className={`flex-1 min-w-0 flex flex-col ${t.editorBg} overflow-hidden rounded-xl border shadow-lg ${theme === 'dark' ? 'border-white/10 shadow-black/50' : 'border-slate-300 shadow-slate-200/50'} relative transition-colors duration-300`}>
          <TabBar theme={theme} roomId={roomId} fileLocks={fileLocks} currentUserId={user?.userId} />
          
          <EditorPanel
            theme={theme}
            onCursorMove={handleCursorMove}
            onSelectionChange={handleSelectionChange}
            onLocalChange={handleLocalChange}
            sharedText={sharedText}
            remotePeers={activeRemotePeers}
            editingUsers={editingUsers}
            activeFileId={activeFileId}
            activeFileLock={activeFileLock}
            isReadOnly={isActiveFileLockedByOther}
            lockNotice={lockNotice}
          />
          
          <OutputPanel theme={theme} output={output} />
        </main>

        <NeuraPanel theme={theme} />
      </div>

      <StatusBar
        theme={theme}
        peersCount={Object.keys(presence).length}
        activeFileLock={activeFileLock}
        currentUserId={user?.userId}
      />
    </div>
  );
}

export default function RoomPage() {
  const { roomId } = useParams();

  return (
    <FileProvider storageKey={null}>
      <RoomSession roomId={String(roomId || '').toUpperCase()} />
    </FileProvider>
  );
}
