import { useEffect, useMemo, useState } from 'react';
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
import { getRecentRooms, getSharedRooms, deleteRoom } from '../services/roomService';
import { getAvatarStyle, getUserInitial } from '../utils/avatar';
import SynapseInteractiveBackground from '../components/SynapseInteractiveBackground';
import SynapseLogo from '../components/SynapseLogo';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_GAP_MS = 45 * 60 * 1000;
const SESSION_MIN_MS = 15 * 60 * 1000;
const SESSION_MAX_MS = 2 * 60 * 60 * 1000;

function countLines(content = '') {
  return String(content)
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .length;
}

function formatCompactCount(value) {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatHours(minutes) {
  if (minutes < 60) {
    return `${Math.max(0, Math.round(minutes))} min this week`;
  }

  const hours = minutes / 60;
  return `${hours.toFixed(hours % 1 === 0 ? 0 : 1)} ${hours === 1 ? 'hr' : 'hrs'} this week`;
}

function gatherRoomActivityTimestamps(room) {
  const timestamps = [];

  if (Array.isArray(room?.versions)) {
    room.versions.forEach((version) => {
      const timestamp = new Date(version?.timestamp).getTime();
      if (Number.isFinite(timestamp)) {
        timestamps.push(timestamp);
      }
    });
  }

  if (Array.isArray(room?.files)) {
    room.files.forEach((file) => {
      const timestamp = new Date(file?.updatedAt || room?.lastUpdated || room?.createdAt).getTime();
      if (Number.isFinite(timestamp)) {
        timestamps.push(timestamp);
      }
    });
  }

  const roomCreatedAt = new Date(room?.createdAt).getTime();
  if (Number.isFinite(roomCreatedAt)) {
    timestamps.push(roomCreatedAt);
  }

  return Array.from(new Set(timestamps)).sort((left, right) => left - right);
}

function estimateCodingMinutes(room, windowStart, windowEnd) {
  const timestamps = gatherRoomActivityTimestamps(room).filter(
    (timestamp) => timestamp >= windowStart && timestamp < windowEnd
  );

  if (timestamps.length === 0) {
    return 0;
  }

  let totalMinutes = 0;
  let sessionStart = timestamps[0];
  let previousTimestamp = timestamps[0];

  for (let index = 1; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index];

    if (timestamp - previousTimestamp > SESSION_GAP_MS) {
      const sessionDuration = Math.min(
        Math.max(previousTimestamp - sessionStart + SESSION_MIN_MS, SESSION_MIN_MS),
        SESSION_MAX_MS
      );
      totalMinutes += sessionDuration / 60000;
      sessionStart = timestamp;
    }

    previousTimestamp = timestamp;
  }

  const finalSessionDuration = Math.min(
    Math.max(previousTimestamp - sessionStart + SESSION_MIN_MS, SESSION_MIN_MS),
    SESSION_MAX_MS
  );
  totalMinutes += finalSessionDuration / 60000;

  return totalMinutes;
}

function calculateTimeSpentStats(rooms, currentTime) {
  const currentWindowStart = currentTime - WEEK_MS;
  const previousWindowStart = currentTime - WEEK_MS * 2;

  const currentMinutes = rooms.reduce(
    (total, room) => total + estimateCodingMinutes(room, currentWindowStart, currentTime),
    0
  );
  const previousMinutes = rooms.reduce(
    (total, room) => total + estimateCodingMinutes(room, previousWindowStart, currentWindowStart),
    0
  );

  const changePercent = previousMinutes > 0
    ? Math.round(((currentMinutes - previousMinutes) / previousMinutes) * 100)
    : currentMinutes > 0
      ? 100
      : 0;

  return {
    value: formatHours(currentMinutes),
    meta: `${changePercent >= 0 ? '+' : ''}${changePercent}% vs last week`,
    metaClass: changePercent >= 0 ? 'db-stat-meta-positive' : 'db-stat-meta-negative',
  };
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('recent');
  const [searchQuery, setSearchQuery] = useState('');
  const [recentRooms, setRecentRooms] = useState([]);
  const [sharedRooms, setSharedRooms] = useState([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [roomToDelete, setRoomToDelete] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const displayName = user?.name || user?.email?.split('@')[0] || 'Developer';
  const avatarInitial = getUserInitial(user);
  const avatarStyle = getAvatarStyle(user);

  useEffect(() => {
    document.body.style.backgroundColor = '#030711';
    return () => { document.body.style.backgroundColor = ''; };
  }, []);

  useEffect(() => {
    if (user?.userId) {
      setLoadingRooms(true);
      Promise.all([getRecentRooms(user.userId), getSharedRooms(user.userId)])
        .then(([ownedRooms, joinedRooms]) => {
          setRecentRooms(ownedRooms);
          setSharedRooms(joinedRooms);
        })
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
      setSharedRooms((prev) => prev.filter((r) => r.roomId !== roomToDelete.roomId));
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

  const visibleRooms = activeTab === 'shared' ? sharedRooms : recentRooms;

  const filteredRooms = visibleRooms.filter((room) => {
    const q = searchQuery.toLowerCase();
    return (
      (room.roomName || '').toLowerCase().includes(q) ||
      (room.roomId || '').toLowerCase().includes(q)
    );
  });

  const joinedRoomCount = new Set(
    [...recentRooms, ...sharedRooms].map((room) => room.roomId)
  ).size;

  /* ---------- stats ---------- */
  const stats = useMemo(() => {
    const totalLinesContributed = recentRooms.reduce((total, room) => {
      const roomLineCount = Array.isArray(room.files)
        ? room.files.reduce((fileTotal, file) => fileTotal + countLines(file?.content || ''), 0)
        : 0;

      return total + roomLineCount;
    }, 0);

    const timeSpentStats = calculateTimeSpentStats(recentRooms, now);

    return [
      {
        label: 'Rooms Joined',
        value: String(recentRooms.length),
        icon: <Clock size={16} />,
        color: 'db-stat-blue',
      },
      {
        label: 'Total Lines Contributed',
        value: formatCompactCount(totalLinesContributed),
        meta: 'across shared rooms',
        icon: <FileCode2 size={16} />,
        color: 'db-stat-purple',
      },
      {
        label: 'Time Spent Coding',
        value: timeSpentStats.value,
        meta: timeSpentStats.meta,
        metaClass: timeSpentStats.metaClass,
        icon: <Code2 size={16} />,
        color: 'db-stat-green',
      },
    ];
  }, [now, recentRooms]);

  return (
    <div className="db-page">
      <SynapseInteractiveBackground />

      {/* ─── Navbar ─── */}
      <nav className="db-nav">
        <div className="db-nav-inner">
          {/* Logo — matches Landing Page */}
          <Link to="/" className="db-logo-link">
            <div className="db-logo-icon">
              <SynapseLogo size={20} color="#ffffff" nodeColor="#ffffff" />
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
              <div className="db-user-avatar" style={avatarStyle}>{avatarInitial}</div>
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
                  {stat.meta ? (
                    <span className={`db-stat-meta ${stat.metaClass || ''}`}>{stat.meta}</span>
                  ) : null}
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
                const canDeleteRoom = room.createdBy === user?.userId;
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
                      {canDeleteRoom ? (
                        <button
                          className="db-room-delete-btn"
                          title="Delete room"
                          onClick={(e) => handleDeleteClick(e, { roomId: room.roomId, roomName: room.roomName })}
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : null}
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
                        <div className="db-room-avatar-circle" style={avatarStyle}>
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
                : activeTab === 'shared'
                  ? "You haven't joined any shared rooms yet."
                  : "You haven't created any rooms recently. Start your first session above!"}
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
