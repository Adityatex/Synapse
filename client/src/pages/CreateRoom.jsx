import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, PlusCircle } from 'lucide-react';
import { createRoom } from '../services/roomService';
import SynapseInteractiveBackground from '../components/SynapseInteractiveBackground';
import SynapseLogo from '../components/SynapseLogo';

export default function CreateRoom() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [roomName, setRoomName] = useState('');
  const [inviteOnly, setInviteOnly] = useState(false);

  useEffect(() => {
    document.body.style.backgroundColor = '#05070d';
    return () => { document.body.style.backgroundColor = ''; };
  }, []);

  const handleCreateRoom = async () => {
    try {
      setLoading(true);
      setError('');
      const { room } = await createRoom(roomName || 'System Design Practice', { isInviteOnly: inviteOnly });
      navigate(`/room/${room.roomId}`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <SynapseInteractiveBackground />

      <div className="auth-container">
        <Link to="/dashboard" className="auth-logo-link">
          <div className="auth-logo-icon">
            <SynapseLogo size={24} color="#ffffff" nodeColor="#ffffff" />
          </div>
          <span className="auth-logo-text">Synapse</span>
        </Link>

        <div className="auth-card">
          <div className="auth-card-header">
            <div className="dashboard-welcome-icon" style={{ margin: '0 auto 1rem' }}>
              <PlusCircle size={24} />
            </div>
            <h1 className="auth-title">Create a collaboration room</h1>
            <p className="auth-subtitle">
              Generate a shared workspace, invite your teammates, and start editing code in real time.
            </p>
          </div>

          {error ? <div className="auth-error-banner">{error}</div> : null}

          <div className="auth-form" style={{ marginBottom: '1.5rem', width: '100%', textAlign: 'left' }}>
            <label className="auth-label" htmlFor="roomName">Room Name</label>
            <div className="auth-input-wrapper">
              <input
                id="roomName"
                type="text"
                className="auth-input"
                placeholder="e.g. System Design Practice"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateRoom();
                }}
              />
            </div>
          </div>

          {/* P0-16: creator-controlled invite-only setting. */}
          <label
            htmlFor="inviteOnly"
            style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', cursor: 'pointer', marginBottom: '1.5rem', width: '100%', textAlign: 'left' }}
          >
            <input
              id="inviteOnly"
              type="checkbox"
              checked={inviteOnly}
              onChange={(e) => setInviteOnly(e.target.checked)}
              style={{ marginTop: '0.2rem', accentColor: '#7c3aed' }}
            />
            <span>
              <span className="auth-label" style={{ marginBottom: '0.15rem', display: 'block' }}>Invite-only room</span>
              <span className="auth-subtitle" style={{ fontSize: '0.85rem' }}>
                Only you and members who already joined can enter. Anyone else gets an error.
              </span>
            </span>
          </label>

          <button onClick={handleCreateRoom} className="auth-btn" disabled={loading}>
            {loading ? (
              <span className="auth-btn-loading">
                <Loader2 size={18} className="animate-spin" />
                Creating room...
              </span>
            ) : (
              <span className="auth-btn-content">
                <span>Create room</span>
                <ArrowRight size={18} />
              </span>
            )}
          </button>

          <div className="auth-card-footer">
            Prefer joining an existing session? <Link to="/join-room" className="auth-link">Use a room code</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
