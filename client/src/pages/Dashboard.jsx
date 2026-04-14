import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import {
  Plus,
  Users,
  Code2,
  LogOut,
  Clock,
  Search,
  Monitor,
  Terminal,
  Loader2,
  Trash2,
  FileCode2,
} from 'lucide-react';
import { getRecentRooms, deleteRoom } from '../services/roomService';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('recent');
  const [searchQuery, setSearchQuery] = useState('');
  const [recentRooms, setRecentRooms] = useState([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [roomToDelete, setRoomToDelete] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const displayName = user?.name || user?.email?.split('@')[0] || 'Developer';
  const avatarInitial = (user?.name || user?.email || 'U')[0].toUpperCase();

  useEffect(() => {
    document.body.style.backgroundColor = '#030711';
    return () => { document.body.style.backgroundColor = ''; };
  }, []);

  useEffect(() => {
    if (user?.userId) {
      getRecentRooms(user.userId)
        .then(setRecentRooms)
        .catch(console.error)
        .finally(() => setLoadingRooms(false));
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
    setRoomToDelete(room);
  }

  async function confirmDeleteRoom() {
    if (!roomToDelete) return;
    try {
      await deleteRoom(roomToDelete.roomId);
      setRecentRooms((prev) => prev.filter((r) => r.roomId !== roomToDelete.roomId));
      setRoomToDelete(null);
    } catch (err) {
      console.error('Failed to delete room:', err);
      alert(err.message || 'Failed to delete room.');
    }
  }

  /* ---------- helpers ---------- */
  function timeAgo(dateStr, currentTime) {
    const diff = currentTime - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} min${mins > 1 ? 's' : ''} ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? 's' : ''} ago`;
  }

  const filteredRooms = recentRooms.filter((room) => {
    const q = searchQuery.toLowerCase();
    return (
      (room.roomName || '').toLowerCase().includes(q) ||
      (room.roomId || '').toLowerCase().includes(q)
    );
  });

  /* ---------- stats ---------- */
  const stats = [
    { label: 'Rooms Joined', value: String(recentRooms.length), icon: <Clock size={16} />, color: 'db-stat-blue' },
    { label: 'Collaborators', value: '—', icon: <Users size={16} />, color: 'db-stat-purple' },
    { label: 'Sessions', value: '—', icon: <Code2 size={16} />, color: 'db-stat-green' },
  ];

  return (
    <div className="db-page">
      {/* ─── Navbar ─── */}
      <nav className="db-nav">
        <div className="db-nav-inner">
          {/* Logo — matches Landing Page */}
          <Link to="/" className="db-logo-link">
            <div className="db-logo-icon">
              <Code2 size={20} className="text-white" />
            </div>
            <span className="db-logo-text">Synapse</span>
          </Link>

          <div className="db-nav-right">
            {/* Search */}
            <div className="db-search-wrapper">
              <Search size={14} className="db-search-icon" />
              <input
                type="text"
                placeholder="Search rooms..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="db-search-input"
              />
            </div>

            <div className="db-nav-divider" />

            {/* User badge */}
            <div className="db-user-badge">
              <div className="db-user-avatar">{avatarInitial}</div>
              <span className="db-user-name">{displayName}</span>
            </div>

            {/* Logout */}
            <button onClick={logout} className="db-logout-btn" title="Log out">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </nav>

      {/* ─── Main ─── */}
      <main className="db-main">
        {/* Hero Section */}
        <header className="db-hero">
          <div className="db-hero-glow db-hero-glow-left" />
          <div className="db-hero-glow db-hero-glow-right" />

          <div className="db-hero-content">
            <div className="db-hero-left">
              <div className="db-session-badge">
                <div className="db-session-dot" />
                Work Session Active
              </div>
              <h1 className="db-hero-title">Welcome back, {displayName}</h1>
              <p className="db-hero-subtitle">Ready to build something amazing today?</p>
            </div>

            <div className="db-stats-row">
              {stats.map((stat, i) => (
                <div key={i} className="db-stat-card">
                  <span className={`db-stat-label ${stat.color}`}>
                    {stat.icon} {stat.label}
                  </span>
                  <span className="db-stat-value">{stat.value}</span>
                </div>
              ))}
            </div>
          </div>
        </header>

        {/* ─── Action Cards ─── */}
        <section className="db-actions-grid">
          {/* Open Editor */}
          <Link to="/editor" className="db-action-card db-action-editor">
            <div className="db-action-bg-icon">
              <Monitor size={160} />
            </div>
            <div className="db-action-content">
              <div className="db-action-icon-wrap db-action-icon-editor">
                <Terminal size={24} className="text-white" />
              </div>
              <h3 className="db-action-title">Open Editor</h3>
              <p className="db-action-desc">Launch the full-featured code editor with multi-language support.</p>
            </div>
          </Link>

          {/* Create Room */}
          <Link to="/create-room" className="db-action-card db-action-create">
            <div className="db-action-bg-icon db-action-bg-green">
              <Plus size={160} />
            </div>
            <div className="db-action-content">
              <div className="db-action-icon-wrap db-action-icon-create">
                <Plus size={24} />
              </div>
              <h3 className="db-action-title">Create Room</h3>
              <p className="db-action-desc">Start a new collaborative coding session for your team.</p>
            </div>
          </Link>

          {/* Join Room */}
          <Link to="/join-room" className="db-action-card db-action-join">
            <div className="db-action-bg-icon db-action-bg-purple">
              <Users size={160} />
            </div>
            <div className="db-action-content">
              <div className="db-action-icon-wrap db-action-icon-join">
                <Users size={24} />
              </div>
              <h3 className="db-action-title">Join Room</h3>
              <p className="db-action-desc">Enter an existing room using a shared invite code.</p>
            </div>
          </Link>
        </section>

        {/* ─── Recent Projects ─── */}
        <section className="db-recent-section">
          <div className="db-recent-header">
            <div className="db-recent-header-left">
              <h2 className="db-recent-title">
                <Clock size={20} className="db-recent-title-icon" />
                Recent Projects
              </h2>
              <div className="db-tab-group">
                <button
                  onClick={() => setActiveTab('recent')}
                  className={`db-tab ${activeTab === 'recent' ? 'db-tab-active' : ''}`}
                >
                  Recently Edited
                </button>
                <button
                  onClick={() => setActiveTab('shared')}
                  className={`db-tab ${activeTab === 'shared' ? 'db-tab-active' : ''}`}
                >
                  Shared with Me
                </button>
              </div>
            </div>
          </div>

          {loadingRooms ? (
            <div className="db-loading-row">
              <Loader2 size={16} className="db-spinner" />
              Loading your spaces...
            </div>
          ) : filteredRooms.length > 0 ? (
            <div className="db-rooms-grid">
              {filteredRooms.map((room) => {
                const fileCount = Array.isArray(room.files)
                  ? room.files.filter((f) => f.type === 'file').length
                  : 0;
                return (
                  <div
                    key={room.roomId}
                    className="db-room-card"
                    onClick={() => navigate(`/room/${room.roomId}`)}
                  >
                    {/* Header */}
                    <div className="db-room-card-top">
                      <div className="db-room-card-info">
                        <span className="db-room-id">{room.roomId}</span>
                        <h4 className="db-room-name">{room.roomName || 'Untitled Room'}</h4>
                      </div>
                      <button
                        className="db-room-delete-btn"
                        title="Delete room"
                        onClick={(e) => handleDeleteClick(e, { roomId: room.roomId, roomName: room.roomName })}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    {/* Meta row */}
                    <div className="db-room-meta">
                      <div className="db-room-lang">CODE</div>
                      <div className="db-room-members">
                        <FileCode2 size={12} />
                        {fileCount} {fileCount === 1 ? 'file' : 'files'}
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="db-room-footer">
                      <span className="db-room-edited">
                        Edited {timeAgo(room.lastUpdated, now)}
                      </span>
                      <div className="db-room-avatars">
                        <div className="db-room-avatar-circle">
                          {avatarInitial}
                        </div>
                      </div>
                    </div>

                    {/* Hover glow */}
                    <div className="db-room-glow" />
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="db-empty-state">
              {searchQuery
                ? 'No rooms match your search.'
                : "You haven't participated in any rooms recently. Start your first session above!"}
            </p>
          )}
        </section>
      </main>

      {/* Delete Confirmation Modal */}
      {roomToDelete && (
        <div className="db-modal-overlay">
          <div className="db-modal-content">
            <h3 className="db-modal-title">Delete Room</h3>
            <p className="db-modal-text">
              Are you sure you want to delete the room <br/>
              <strong className="text-white">{roomToDelete.roomName || roomToDelete.roomId}</strong>?<br/>
              This action cannot be undone.
            </p>
            <div className="db-modal-actions">
              <button 
                className="db-modal-btn db-modal-cancel"
                onClick={() => setRoomToDelete(null)}
              >
                Cancel
              </button>
              <button 
                className="db-modal-btn db-modal-delete"
                onClick={confirmDeleteRoom}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
