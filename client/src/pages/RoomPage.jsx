import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFiles } from '../context/FileContext';
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
import { getContentText, identityFor } from '@synapse/room-doc';
import { CollabFileProvider } from '../context/CollabFileProvider';
import { useRoomCollab } from '../hooks/useRoomCollab';
import { useLocalPresence, usePeers } from '../hooks/usePresence';
import ConnectionBanner from '../components/ConnectionBanner';
import { connectionBannerState } from '../utils/connectionState';
import { rememberReturnTo } from '../utils/returnTo';

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

// The room as a person sees it. `collab` is the connection to the collab server (P2-06): the shared
// Y.Doc is the source of truth for the files and their text, presence is Yjs awareness, and locks
// are the collab server's (P2-07, P2-08). Socket.IO carries only chat and the join (P2-14).
function RoomSession({ roomId, collab }) {
  const navigate = useNavigate();
  const collabDoc = collab.doc;
  const awareness = collab.awareness;
  const { user, logout } = useAuth();
  const { files, activeFileId } = useFiles();
  const peers = usePeers(awareness, user?.userId);
  useLocalPresence(awareness, collabDoc, user, activeFileId);
  // P1-10: session chrome from the Zustand store + focused hooks.
  const { theme, toggleTheme } = useRoomTheme();
  const { lockNotice, showLockNotice } = useLockNotice();
  const { copied, copyInvite: handleCopyInvite } = useInviteLink(roomId);
  const output = useRoomUiStore((s) => s.output);
  const setOutput = useRoomUiStore((s) => s.setOutput);
  const setConnectionState = useRoomUiStore((s) => s.setConnectionState);
  const loadingRoom = useRoomUiStore((s) => s.loadingRoom);
  const setLoadingRoom = useRoomUiStore((s) => s.setLoadingRoom);
  const roomReady = useRoomUiStore((s) => s.roomReady);
  const setRoomReady = useRoomUiStore((s) => s.setRoomReady);
  const error = useRoomUiStore((s) => s.error);
  const setError = useRoomUiStore((s) => s.setError);
  const roomName = useRoomUiStore((s) => s.roomName);
  const setRoomName = useRoomUiStore((s) => s.setRoomName);
  const [chatMessages, setChatMessages] = useState([]);
  const [typingUsers, setTypingUsers] = useState({});
  const [roomCreatedBy, setRoomCreatedBy] = useState('');
  // Set to the value `locksEnabled` had when the creator clicked the toggle, until the server reports a change.
  const [toggledFrom, setToggledFrom] = useState(null);
  const toggleTimerRef = useRef(null);
  const socketRef = useRef(null);
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const collabLocks = collab.lockState.locks;
  const fileLocks = useMemo(
    () => Object.fromEntries(Object.entries(collabLocks).map(([id, lock]) => [id, { userId: lock.userId, username: lock.name }])),
    [collabLocks]
  );
  const locksEnabled = collab.lockState.enabled;
  const activeFileLock = activeFileId ? fileLocks[activeFileId] || null : null;
  const isActiveFileLockedByOther = Boolean(
    activeFileLock && activeFileLock.userId && activeFileLock.userId !== user?.userId
  );

  // Chat (and the join that makes this person part of the room's chat) over Socket.IO.
  useEffect(() => {
    if (!user?.userId || !user?.name) {
      return undefined;
    }

    const socket = createCollaborationSocket();
    socketRef.current = socket;

    const handleConnect = () => {
      setConnectionState('connected');
      setError('');
      // P0-03: identity comes from the JWT — only roomId is sent.
      socket.emit('join-room', { roomId });
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

    const handleRoomJoined = ({ room }) => {
      setRoomName(room.roomName || '');
      setLoadingRoom(false);
      setRoomReady(true);
      setError('');
      socket.emit('request-chat-history', { roomId, limit: 50 });
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
    socket.on('room-error', handleRoomError);
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
      socket.off('chat-message');
      socket.off('chat-history');
      socket.off('chat-message-updated');
      socket.off('chat-search-results');
      socket.off('user-typing');
      socket.emit('leave-room');
      socket.disconnect();
    };
  }, [logout, navigate, roomId, user, setConnectionState, setError, setLoadingRoom, setRoomName, setRoomReady]);

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

  // --- Focus locks (P2-08) ---
  const lockFn = collab.lock;
  const heldIds = useMemo(
    () => Object.entries(fileLocks).filter(([, lock]) => lock.userId === user?.userId).map(([id]) => id),
    [fileLocks, user?.userId]
  );
  const heldKey = heldIds.join('|');
  const heldRef = useRef(new Set());
  const previousFileRef = useRef(null);

  // Keep the locks I hold alive: the server drops one 45 s after its last renewal.
  useEffect(() => {
    if (heldKey === '') return undefined;
    const ids = heldKey.split('|');
    const timer = window.setInterval(() => ids.forEach((id) => lockFn('renew', id)), FILE_LOCK_RENEW_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [heldKey, lockFn]);

  // A lock follows focus: moving to another file gives the old one up.
  useEffect(() => {
    heldRef.current = new Set(heldIds);
  }, [heldIds]);
  useEffect(() => {
    const previous = previousFileRef.current;
    previousFileRef.current = activeFileId;
    if (previous && previous !== activeFileId && heldRef.current.has(previous)) lockFn('release', previous);
  }, [activeFileId, lockFn]);

  // The server refused a lock request: say why.
  const lockDenied = collab.denied;
  useEffect(() => {
    if (!lockDenied) return;
    const fileName = filesRef.current.find((file) => file.id === lockDenied.fileId)?.name || 'This file';
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
    roomCreatedBy && roomCreatedBy === user?.userId
      ? { enabled: locksEnabled, canToggle: true, busy: toggledFrom !== null && toggledFrom === locksEnabled, onToggle: handleToggleLocks }
      : null;

  // The file's shared Y.Text. Content comes from the document alone, so nothing is pre-seeded locally.
  const sharedText = activeFileId ? getContentText(collabDoc, activeFileId) : null;

  // The collab server refused us. At join (expired token, not a member, unknown room) that ends the
  // visit. If it happens after the room was open (the sign-in ran out while we were offline), the
  // editor stays on screen, read-only, with a banner (P2-12).
  const collabAuthError = collab.authError || '';
  const authLost = Boolean(collabAuthError) && Boolean(collab.synced);
  const refusedAtJoin = Boolean(collabAuthError) && !authLost;
  useEffect(() => {
    if (!refusedAtJoin) return;
    setLoadingRoom(false);
    setRoomReady(false);
    setError(collabAuthError);
  }, [refusedAtJoin, collabAuthError, setError, setLoadingRoom, setRoomReady]);
  const collabPending = !collab.synced && !collabAuthError;

  const handleSignIn = useCallback(() => {
    rememberReturnTo(`/room/${roomId}`);
    logout();
    navigate('/login');
  }, [logout, navigate, roomId]);

  // Closing the tab while changes are still only here would lose them.
  const unsyncedChanges = collab.unsynced ?? 0;
  useEffect(() => {
    if (unsyncedChanges === 0) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsyncedChanges]);

  const bannerState = connectionBannerState({
    status: collab.status,
    synced: collab.synced,
    unsynced: unsyncedChanges,
    authLost,
    refusal: collabAuthError,
  });

  const handleExitRoom = useCallback(() => {
    const socket = socketRef.current;
    if (socket?.connected) {
      socket.emit('leave-room');
      socket.disconnect();
    }
    navigate('/dashboard');
  }, [navigate]);

  // The people list comes from awareness.
  const collaborators = useMemo(
    () =>
      peers.map((peer) => {
        const fileName = files.find((file) => file.id === peer.fileId)?.name;
        return {
          userId: peer.userId,
          username: peer.name,
          cursorColor: peer.color,
          avatarGlyph: peer.glyph,
          isYou: peer.isYou,
          activity: fileName ? `${peer.typing ? 'Typing in' : 'Viewing'} ${fileName}` : 'Online',
        };
      }),
    [peers, files]
  );

  const liveEditors = useMemo(
    () =>
      Object.fromEntries(
        peers
          .filter((peer) => !peer.isYou && peer.typing && peer.fileId)
          .map((peer) => [peer.userId, { userId: peer.userId, username: peer.name, cursorColor: peer.color, fileId: peer.fileId }])
      ),
    [peers]
  );

  const toolbarUser = useMemo(() => {
    if (!user?.userId) return user;
    const identity = identityFor({ userId: user.userId, name: user.name ?? '' });
    return { ...user, username: identity.name, cursorColor: identity.color, avatarGlyph: identity.glyph };
  }, [user]);

  if (loadingRoom || collabPending) {
    return (
      <div className="auth-loading-screen">
        <div className="auth-loading-spinner" />
        <p className="auth-loading-text">
          {collab.status === 'disconnected'
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
            sharedText={sharedText}
            awareness={awareness}
            editingUsers={liveEditors}
            activeFileId={activeFileId}
            activeFileLock={activeFileLock}
            isReadOnly={isActiveFileLockedByOther || authLost}
            lockNotice={lockNotice}
            lockControls={lockControls}
          />

          <OutputPanel theme={theme} output={output} />
        </main>

        <NeuraPanel theme={theme} roomId={roomId} />
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

  // keyed so moving between rooms gets a fresh document and connection
  return <CollabRoom key={normalizedRoomId} roomId={normalizedRoomId} />;
}
