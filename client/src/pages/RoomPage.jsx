/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import throttle from 'lodash.throttle';
import { FileProvider, useFiles } from '../contexts/FileContext';
import { useAuth } from '../context/AuthContext';
import Sidebar from '../components/Sidebar';
import TabBar from '../components/TabBar';
import EditorPanel from '../components/EditorPanel';
import Toolbar from '../components/Toolbar';
import OutputPanel from '../components/OutputPanel';
import UsersSidebar from '../components/UsersSidebar';
import RoomBanner from '../components/RoomBanner';
import { createCollaborationSocket } from '../services/socket';
import { getRoom } from '../services/roomService';
import { RoomYjsManager } from '../services/yjsRoom';

function getStructureSignature({ files = [] }) {
  return JSON.stringify({
    files: files.map((file) => ({
      id: file.id,
      name: file.name,
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
  const [participants, setParticipants] = useState([]);
  const [connectionState, setConnectionState] = useState('connecting');
  const [loadingRoom, setLoadingRoom] = useState(true);
  const [roomReady, setRoomReady] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [presence, setPresence] = useState({});
  const [activityFeed, setActivityFeed] = useState([]);
  const [yjsManager, setYjsManager] = useState(null);
  const [, setYjsDocVersion] = useState(0);
  const [editingUsers, setEditingUsers] = useState({});
  const socketRef = useRef(null);
  const suppressStructureSyncRef = useRef(null);
  const copyTimerRef = useRef(null);
  const activityTimerRef = useRef(null);
  const structureEmitterRef = useRef(null);
  const cursorEmitterRef = useRef(null);
  const selectionEmitterRef = useRef(null);
  const editingTimersRef = useRef({});
  const latestRoomStateRef = useRef({
    files: [],
    activeFileId: null,
    openTabs: [],
  });

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

  useEffect(() => {
    latestRoomStateRef.current = {
      files: files.map(({ id, name, content, updatedAt }) => ({
        id,
        name,
        content,
        updatedAt,
      })),
      activeFileId,
      openTabs,
    };
  }, [files, activeFileId, openTabs]);

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

    const pushActivity = (message) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setActivityFeed((previous) => [...previous.slice(-3), { id, message }]);
      clearTimeout(activityTimerRef.current);
      activityTimerRef.current = setTimeout(() => {
        setActivityFeed((previous) => previous.filter((event) => event.id !== id));
      }, 3500);
    };

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

    const handleRoomJoined = ({ room, sharedDocs, participant }) => {
      suppressStructureSyncRef.current = getStructureSignature(room);
      replaceState(room);
      applySharedDocs(sharedDocs, room.files);
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
          },
        }));
      }
    };

    const handleRoomUsers = (nextParticipants) => {
      setParticipants(nextParticipants);
      setPresence((previous) => {
        const nextPresence = {};
        nextParticipants.forEach((participant) => {
          nextPresence[participant.userId] = {
            ...previous[participant.userId],
            userId: participant.userId,
            username: participant.username,
            cursorColor: participant.cursorColor,
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
        [peerId]: { userId: peerId, username: peerName, cursorColor: peerColor, fileId, lastEdit: Date.now() },
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
          selectionRange: payload.selectionRange,
          socketId: payload.socketId,
        },
      }));
    };

    const handleUserJoined = ({ username, cursorColor, userId }) => {
      pushActivity(`${username} joined the room`);
      setPresence((previous) => ({
        ...previous,
        [userId]: {
          ...previous[userId],
          userId,
          username,
          cursorColor,
        },
      }));
    };

    const handleUserLeft = ({ userId, username }) => {
      if (username) {
        pushActivity(`${username} left the room`);
      }

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
    socket.connect();

    return () => {
      throttledStateSync.cancel();
      throttledCursorSync.cancel();
      throttledSelectionSync.cancel();
      structureEmitterRef.current = null;
      cursorEmitterRef.current = null;
      selectionEmitterRef.current = null;
      clearTimeout(copyTimerRef.current);
      clearTimeout(activityTimerRef.current);
      Object.values(editingTimersRef.current).forEach(clearTimeout);
      editingTimersRef.current = {};
      socket.emit('leave-room');
      socket.disconnect();
      manager.destroy();
      setYjsManager(null);
    };
  }, [logout, navigate, replaceSharedFiles, replaceState, roomId, updateContent, user]);

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

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden" data-theme={theme}>
      <Toolbar
        theme={theme}
        onToggleTheme={toggleTheme}
        output={output}
        setOutput={setOutput}
      />

      <RoomBanner
        roomId={roomId}
        connectionState={connectionState}
        lastError={error}
        copied={copied}
        onCopy={handleCopyInvite}
        activityFeed={activityFeed}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        <div className="flex flex-1 flex-col overflow-hidden">
          <TabBar />
          <EditorPanel
            theme={theme}
            onCursorMove={handleCursorMove}
            onSelectionChange={handleSelectionChange}
            sharedText={sharedText}
            remotePeers={activeRemotePeers}
            editingUsers={editingUsers}
            activeFileId={activeFileId}
          />
          <OutputPanel output={output} />
        </div>

        <UsersSidebar
          roomId={roomId}
          participants={participants}
          currentUser={user}
          connectionState={connectionState}
        />
      </div>
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
