import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { Plus, LogIn, Code2, LogOut, Search, Trash2 } from 'lucide-react';
import { getRecentRooms, getSharedRooms, deleteRoom } from '../services/roomService';
import { getAvatarStyle, getUserInitial } from '../utils/avatar';
import SynapseLogo from '../components/SynapseLogo';

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

  const displayName = user?.name || user?.email?.split('@')[0] || 'there';
  const firstName = displayName.split(' ')[0];
  const avatarInitial = getUserInitial(user);
  const avatarStyle = getAvatarStyle(user);

  useEffect(() => {
    const userId = user?.userId;
    if (userId) {
      Promise.all([getRecentRooms(userId), getSharedRooms(userId)])
        .then(([ownedRooms, joinedRooms]) => {
          setRecentRooms(ownedRooms);
          setSharedRooms(joinedRooms);
        })
        .catch(console.error)
        .finally(() => setRoomsLoadedFor(userId));
    }
  }, [user?.userId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 60000);

    return () => window.clearInterval(timer);
  }, []);

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
    return (
      (room.roomName || '').toLowerCase().includes(q) ||
      (room.roomId || '').toLowerCase().includes(q)
    );
  });

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
    <div className="db-page">
      <nav className="db-nav">
        <div className="db-nav-inner">
          <Link to="/" className="brand-link">
            <span className="brand-mark">
              <SynapseLogo size={22} color="#0d2a1c" nodeColor="#0d2a1c" />
            </span>
            <span className="brand-name">Synapse</span>
          </Link>

          <div className="db-nav-right">
            <label className="db-search-wrapper">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">Search rooms</span>
              <input
                type="search"
                placeholder="Search rooms"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="db-search-input"
              />
            </label>

            <div className="db-user-badge">
              <div className="db-user-avatar" style={avatarStyle}>{avatarInitial}</div>
              <span className="db-user-name">{displayName}</span>
            </div>

            <button onClick={logout} className="db-icon-btn" title="Log out" aria-label="Log out">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </nav>

      <main className="db-main">
        <header className="db-hero">
          <div>
            <h1 className="db-hero-title">Welcome back, {firstName}</h1>
            <p className="db-hero-subtitle">{loadingRooms ? 'Loading your rooms…' : summary}</p>
          </div>

          <div className="db-actions">
            <Link to="/create-room" className="db-btn db-btn-primary">
              <Plus size={18} /> New room
            </Link>
            <Link to="/join-room" className="db-btn db-btn-secondary">
              <LogIn size={18} /> Join a room
            </Link>
            <Link to="/editor" className="db-btn db-btn-ghost">
              <Code2 size={18} /> Solo editor
            </Link>
          </div>
        </header>

        <section aria-labelledby="rooms-heading">
          <div className="db-section-head">
            <h2 id="rooms-heading" className="db-section-title">Rooms</h2>
            <div className="db-tab-group" role="tablist" aria-label="Which rooms">
              <button
                role="tab"
                aria-selected={activeTab === 'recent'}
                onClick={() => setActiveTab('recent')}
                className={`db-tab ${activeTab === 'recent' ? 'db-tab-active' : ''}`}
              >
                Yours
              </button>
              <button
                role="tab"
                aria-selected={activeTab === 'shared'}
                onClick={() => setActiveTab('shared')}
                className={`db-tab ${activeTab === 'shared' ? 'db-tab-active' : ''}`}
              >
                Shared with you
              </button>
            </div>
          </div>

          {loadingRooms ? (
            <div className="db-room-list" aria-busy="true">
              <div className="db-skeleton-row" />
              <div className="db-skeleton-row" />
              <div className="db-skeleton-row" />
            </div>
          ) : filteredRooms.length > 0 ? (
            <>
              <div className="db-room-cols" aria-hidden="true">
                <span>Name</span>
                <span>Code</span>
                <span>Files</span>
                <span>Last edited</span>
                <span />
              </div>
              <ul className="db-room-list">
                {filteredRooms.map((room) => {
                  const fileCount = Array.isArray(room.files)
                    ? room.files.filter((f) => f.type === 'file').length
                    : 0;
                  const canDeleteRoom = room.createdBy === user?.userId;
                  const open = () => navigate(`/room/${room.roomId}`);
                  return (
                    <li
                      key={room.roomId}
                      className="db-room-row"
                      tabIndex={0}
                      onClick={open}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') open();
                      }}
                    >
                      <span className="db-room-name">
                        <span className="db-room-avatar" style={avatarStyle} aria-hidden="true">
                          {avatarInitial}
                        </span>
                        <span>{room.roomName || 'Untitled room'}</span>
                      </span>
                      <span className="db-room-code">{room.roomId}</span>
                      <span className="db-room-meta db-room-files">{plural(fileCount, 'file')}</span>
                      <span className="db-room-meta">{timeAgo(room.lastUpdated, now)}</span>
                      {canDeleteRoom ? (
                        <button
                          className="db-room-delete-btn"
                          title="Delete room"
                          aria-label={`Delete ${room.roomName || room.roomId}`}
                          onClick={(e) => handleDeleteClick(e, { roomId: room.roomId, roomName: room.roomName })}
                        >
                          <Trash2 size={16} />
                        </button>
                      ) : (
                        <span />
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : searchQuery ? (
            <div className="db-empty-state">
              <p className="db-empty-title">No rooms match “{searchQuery}”</p>
              <p className="db-empty-text">Search looks at room names and codes.</p>
            </div>
          ) : activeTab === 'shared' ? (
            <div className="db-empty-state">
              <p className="db-empty-title">Nothing shared with you yet</p>
              <p className="db-empty-text">
                When someone sends you an invite link and you open it, the room shows up here.
              </p>
              <div className="db-actions">
                <Link to="/join-room" className="db-btn db-btn-secondary">
                  <LogIn size={18} /> Paste an invite link
                </Link>
              </div>
            </div>
          ) : (
            <div className="db-empty-state">
              <p className="db-empty-title">Start your first room</p>
              <p className="db-empty-text">
                A room is a shared workspace: create one, copy its invite link from the editor, and anyone you send it to
                can edit and run code with you.
              </p>
              <div className="db-actions">
                <Link to="/create-room" className="db-btn db-btn-primary">
                  <Plus size={18} /> New room
                </Link>
              </div>
            </div>
          )}
        </section>
      </main>

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
            {deleteError ? <p className="auth-field-error" style={{ marginTop: 12 }}>{deleteError}</p> : null}
            <div className="db-modal-actions">
              <button className="db-btn db-btn-secondary" onClick={() => setRoomToDelete(null)}>
                Cancel
              </button>
              <button className="db-btn db-danger-btn" onClick={confirmDeleteRoom}>
                Delete room
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
