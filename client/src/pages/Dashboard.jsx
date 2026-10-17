import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { ChevronDown, Search, Trash2 } from 'lucide-react';
import { createRoom, deleteRoom, getRecentRooms, getRoom, getSharedRooms } from '../services/roomService';
import { getAvatarStyle, getUserInitial } from '../utils/avatar';
import { parseRoomTarget } from '../utils/roomLinks';
import TopNav from '../components/TopNav';
import CommandPalette from '../components/CommandPalette';
import RoomPeek from '../components/RoomPeek';
import './landing.css';
import './dashboard.css';

const PRESENCE_REFRESH_MS = 20000;

function countLines(content = '') {
  return String(content)
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .length;
}

function plural(count, one, many = `${one}s`) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

function timeAgo(dateStr, currentTime) {
  if (!dateStr) return '—';
  const diff = currentTime - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ${hrs === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
}

function LiveFaces({ live }) {
  if (!live?.length) return null;
  return (
    <span className="dash-faces" aria-hidden="true">
      {live.slice(0, 3).map((p) => (
        <span key={p.userId} className="dash-face" style={getAvatarStyle({ userId: p.userId }, p.color)}>
          {getUserInitial(p.username)}
        </span>
      ))}
    </span>
  );
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('recent');
  const [searchQuery, setSearchQuery] = useState('');
  const [recentRooms, setRecentRooms] = useState([]);
  const [sharedRooms, setSharedRooms] = useState([]);
  // userId the room lists were last loaded for; loading until it matches.
  const [roomsLoadedFor, setRoomsLoadedFor] = useState(null);
  const loadingRooms = roomsLoadedFor !== user?.userId;
  const [roomToDelete, setRoomToDelete] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [peekId, setPeekId] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [joinText, setJoinText] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const createInputRef = useRef(null);

  const displayName = user?.name || user?.email?.split('@')[0] || 'there';
  const firstName = displayName.split(' ')[0];
  const avatarInitial = getUserInitial(user);
  const avatarStyle = getAvatarStyle(user);

  useEffect(() => {
    document.body.style.backgroundColor = '#f7f7f7';
    return () => { document.body.style.backgroundColor = ''; };
  }, []);

  const loadRooms = useCallback((userId) => {
    return Promise.all([getRecentRooms(userId), getSharedRooms(userId)])
      .then(([ownedRooms, joinedRooms]) => {
        setRecentRooms(ownedRooms);
        setSharedRooms(joinedRooms);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    const userId = user?.userId;
    if (!userId) return undefined;
    loadRooms(userId).finally(() => setRoomsLoadedFor(userId));
    // Presence changes while you look at the page; refresh it quietly.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadRooms(userId);
    }, PRESENCE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [user?.userId, loadRooms]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  // Ctrl/Cmd+K anywhere, or "/" when not typing, opens the palette.
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openRoom = useCallback((roomId) => navigate(`/room/${roomId}`), [navigate]);

  const startCreate = useCallback(
    async (name) => {
      const trimmed = String(name || '').trim();
      if (!trimmed) {
        createInputRef.current?.focus();
        createInputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      try {
        setCreating(true);
        setCreateError('');
        const { room } = await createRoom(trimmed);
        navigate(`/room/${room.roomId}`);
      } catch (err) {
        setCreateError(err.message || 'Could not create the room. Try again.');
        setCreating(false);
      }
    },
    [navigate]
  );

  const startJoin = useCallback(
    async (target) => {
      if (!target) {
        setJoinError('Paste an invite link or enter a room code.');
        return;
      }
      if (target.hasInvite) {
        navigate(target.path);
        return;
      }
      try {
        setJoining(true);
        setJoinError('');
        await getRoom(target.roomId);
        navigate(target.path);
      } catch (err) {
        setJoinError(err.message || 'Could not open that room.');
        setJoining(false);
      }
    },
    [navigate]
  );

  function handleDeleteClick(e, room) {
    e.preventDefault();
    e.stopPropagation();
    setDeleteError('');
    setRoomToDelete(room);
  }

  async function confirmDeleteRoom() {
    if (!roomToDelete) return;
    try {
      await deleteRoom(roomToDelete.roomId);
      setRecentRooms((prev) => prev.filter((r) => r.roomId !== roomToDelete.roomId));
      setSharedRooms((prev) => prev.filter((r) => r.roomId !== roomToDelete.roomId));
      setRoomToDelete(null);
    } catch (err) {
      setDeleteError(err.message || 'Could not delete this room. Try again.');
    }
  }

  const visibleRooms = activeTab === 'shared' ? sharedRooms : recentRooms;
  const filteredRooms = visibleRooms.filter((room) => {
    const q = searchQuery.toLowerCase();
    return (room.roomName || '').toLowerCase().includes(q) || (room.roomId || '').toLowerCase().includes(q);
  });
  const allRooms = useMemo(() => {
    const seen = new Set();
    return [...recentRooms, ...sharedRooms].filter((r) => (seen.has(r.roomId) ? false : seen.add(r.roomId)));
  }, [recentRooms, sharedRooms]);
  const liveCount = allRooms.filter((r) => r.live?.length).length;

  const summary = useMemo(() => {
    const lines = recentRooms.reduce((total, room) => {
      const roomLines = Array.isArray(room.files)
        ? room.files.reduce((fileTotal, file) => fileTotal + countLines(file?.content || ''), 0)
        : 0;
      return total + roomLines;
    }, 0);
    return [
      plural(recentRooms.length, 'room'),
      `${sharedRooms.length.toLocaleString()} shared with you`,
      `${plural(lines, 'line')} of code`,
    ].join(' · ');
  }, [recentRooms, sharedRooms]);

  return (
    <div className="lp dash" data-theme="light">
      <TopNav label="Dashboard">
        <button type="button" className="lp-link dash-search-btn" onClick={() => setPaletteOpen(true)}>
          <Search size={16} aria-hidden="true" />
          <span className="lp-hide-sm">Search</span>
          <kbd className="lp-hide-sm">Ctrl K</kbd>
        </button>
        <span className="dash-user">
          <span className="dash-user-avatar" style={avatarStyle}>{avatarInitial}</span>
          <span className="lp-hide-sm">{displayName}</span>
        </span>
        <button type="button" className="lp-link" onClick={logout}>Log out</button>
        <button type="button" className="lp-btn" onClick={() => startCreate(newName)}>New room</button>
      </TopNav>

      <main className="dash-main">
        <header className="dash-hero">
          <h1
            className="lp-head dash-title"
            style={{
              '--dash-title-size': `min(var(--step-display), calc((100vw - 2 * var(--margin)) / ${(`Welcome back, ${firstName}`.length * 0.66).toFixed(2)}))`,
            }}
          >
            Welcome back, {firstName}
          </h1>
          <p className="dash-summary">
            {loadingRooms ? 'Loading your rooms…' : summary}
            {liveCount > 0 && (
              <span className="dash-summary-live">
                <span className="dash-live-dot" aria-hidden="true" />
                {plural(liveCount, 'room')} active right now
              </span>
            )}
          </p>
        </header>

        <section className="dash-tiles" aria-label="Start working">
          <form
            className="dash-tile dash-tile--create"
            onSubmit={(e) => {
              e.preventDefault();
              startCreate(newName);
            }}
          >
            <h2 className="dash-tile-title">New room</h2>
            <p className="dash-tile-text">Name it after what you’re working on. You’ll get an invite link inside.</p>
            <div className="dash-inline">
              <label htmlFor="new-room-name" className="sr-only">Room name</label>
              <input
                id="new-room-name"
                ref={createInputRef}
                className="dash-input"
                placeholder="DSA practice"
                value={newName}
                maxLength={120}
                onChange={(e) => setNewName(e.target.value)}
              />
              <button type="submit" className="lp-btn lp-btn--ink" disabled={creating}>
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
            {createError && <p className="dash-error">{createError}</p>}
          </form>

          <form
            className="dash-tile dash-tile--join"
            onSubmit={(e) => {
              e.preventDefault();
              startJoin(parseRoomTarget(joinText));
            }}
          >
            <h2 className="dash-tile-title">Join a room</h2>
            <p className="dash-tile-text">Paste the invite link someone sent you. Members can use the room code.</p>
            <div className="dash-inline">
              <label htmlFor="join-room-link" className="sr-only">Invite link or room code</label>
              <input
                id="join-room-link"
                className="dash-input"
                placeholder="Invite link or code"
                value={joinText}
                spellCheck={false}
                onChange={(e) => setJoinText(e.target.value)}
              />
              <button type="submit" className="lp-btn lp-btn--ink" disabled={joining}>
                {joining ? 'Joining…' : 'Join'}
              </button>
            </div>
            {joinError && <p className="dash-error">{joinError}</p>}
          </form>

          <Link to="/editor" className="dash-tile dash-tile--solo">
            <h2 className="dash-tile-title">Solo editor</h2>
            <p className="dash-tile-text">A private editor that runs code, no room needed.</p>
            <svg className="dash-tile-arrow" width="36" height="36" viewBox="0 0 40 40" fill="none" aria-hidden="true">
              <path d="M10 30 L30 10 M14 10 H30 V26" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </section>

        <section className="dash-rooms" aria-labelledby="rooms-heading">
          <div className="dash-rooms-head">
            <h2 id="rooms-heading" className="lp-head dash-rooms-title">Rooms</h2>
            <div className="dash-rooms-tools">
              <label className="dash-filter">
                <Search size={16} aria-hidden="true" />
                <span className="sr-only">Filter rooms</span>
                <input
                  type="search"
                  placeholder="Filter by name or code"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </label>
              <div className="dash-tabs" role="tablist" aria-label="Which rooms">
                <button
                  role="tab"
                  aria-selected={activeTab === 'recent'}
                  onClick={() => setActiveTab('recent')}
                  className={`dash-tab ${activeTab === 'recent' ? 'is-active' : ''}`}
                >
                  Yours <span>{recentRooms.length}</span>
                </button>
                <button
                  role="tab"
                  aria-selected={activeTab === 'shared'}
                  onClick={() => setActiveTab('shared')}
                  className={`dash-tab ${activeTab === 'shared' ? 'is-active' : ''}`}
                >
                  Shared with you <span>{sharedRooms.length}</span>
                </button>
              </div>
            </div>
          </div>

          {loadingRooms ? (
            <div className="dash-list" aria-busy="true">
              <div className="dash-skeleton" />
              <div className="dash-skeleton" />
              <div className="dash-skeleton" />
            </div>
          ) : filteredRooms.length > 0 ? (
            <>
              <div className="dash-cols" aria-hidden="true">
                <span>Name</span>
                <span>Activity</span>
                <span>Code</span>
                <span>Files</span>
                <span />
              </div>
              <ul className="dash-list">
                {filteredRooms.map((room) => {
                  const fileCount = Array.isArray(room.files) ? room.files.filter((f) => f.type === 'file').length : 0;
                  const canDeleteRoom = room.createdBy === user?.userId;
                  const isPeek = peekId === room.roomId;
                  const live = room.live || [];
                  return (
                    <li key={room.roomId} className={`dash-item ${isPeek ? 'is-open' : ''}`}>
                      <div
                        className="dash-row"
                        role="button"
                        tabIndex={0}
                        onClick={() => openRoom(room.roomId)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') openRoom(room.roomId);
                        }}
                      >
                        <span className="dash-row-name">
                          {live.length > 0 && <span className="dash-live-dot" aria-hidden="true" />}
                          <span>{room.roomName || 'Untitled room'}</span>
                        </span>
                        <span className={`dash-row-activity ${live.length ? 'is-live' : ''}`}>
                          {live.length ? (
                            <>
                              <LiveFaces live={live} />
                              {live.length} here now
                            </>
                          ) : (
                            `Edited ${timeAgo(room.lastUpdated, now).toLowerCase()}`
                          )}
                        </span>
                        <span className="dash-row-code">{room.roomId}</span>
                        <span className="dash-row-files">{plural(fileCount, 'file')}</span>
                        <span className="dash-row-actions">
                          <button
                            type="button"
                            className="dash-icon-btn"
                            aria-expanded={isPeek}
                            aria-label={`${isPeek ? 'Hide' : 'Show'} what’s inside ${room.roomName || room.roomId}`}
                            title="Peek inside"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPeekId(isPeek ? null : room.roomId);
                            }}
                          >
                            <ChevronDown size={18} className="dash-chevron" />
                          </button>
                          {canDeleteRoom ? (
                            <button
                              type="button"
                              className="dash-icon-btn dash-icon-btn--danger"
                              title="Delete room"
                              aria-label={`Delete ${room.roomName || room.roomId}`}
                              onClick={(e) => handleDeleteClick(e, { roomId: room.roomId, roomName: room.roomName })}
                            >
                              <Trash2 size={16} />
                            </button>
                          ) : (
                            <span className="dash-icon-spacer" />
                          )}
                        </span>
                      </div>
                      {isPeek && <RoomPeek room={room} />}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <div className="dash-empty">
              {searchQuery ? (
                <>
                  <p className="dash-empty-title">No rooms match “{searchQuery}”</p>
                  <p className="dash-empty-text">The filter looks at room names and codes.</p>
                </>
              ) : activeTab === 'shared' ? (
                <>
                  <p className="dash-empty-title">Nothing shared with you yet</p>
                  <p className="dash-empty-text">When someone sends you an invite link and you open it, the room appears here.</p>
                </>
              ) : (
                <>
                  <p className="dash-empty-title">Your first room is one name away</p>
                  <p className="dash-empty-text">Type a name in the yellow tile above and press Create.</p>
                </>
              )}
            </div>
          )}
        </section>
      </main>

      {paletteOpen && (
      <CommandPalette
        onClose={() => setPaletteOpen(false)}
        rooms={allRooms}
        onOpenRoom={openRoom}
        onCreate={startCreate}
        onJoin={startJoin}
        onSolo={() => navigate('/editor')}
        onLogout={logout}
      />
      )}

      {roomToDelete && (
        <div className="db-modal-overlay" role="presentation" onClick={() => setRoomToDelete(null)}>
          <div
            className="db-modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-room-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-room-title" className="db-modal-title">Delete this room?</h3>
            <p className="db-modal-text">
              <strong>{roomToDelete.roomName || roomToDelete.roomId}</strong> and its files will be deleted for everyone in
              it. This can&apos;t be undone.
            </p>
            {deleteError ? <p className="dash-error">{deleteError}</p> : null}
            <div className="db-modal-actions">
              <button className="lp-btn dash-btn-quiet" onClick={() => setRoomToDelete(null)}>
                Cancel
              </button>
              <button className="lp-btn dash-btn-danger" onClick={confirmDeleteRoom}>
                Delete room
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
