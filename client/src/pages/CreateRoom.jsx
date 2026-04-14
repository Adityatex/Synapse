import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, PlusCircle, Code2 } from 'lucide-react';
import { createRoom } from '../services/roomService';

export default function CreateRoom() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [roomName, setRoomName] = useState('');

  useEffect(() => {
    document.body.style.backgroundColor = '#05070d';
    return () => { document.body.style.backgroundColor = ''; };
  }, []);

  const handleCreateRoom = async () => {
    try {
      setLoading(true);
      setError('');
      const { room } = await createRoom(roomName || 'System Design Practice');
      navigate(`/room/${room.roomId}`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-bg-effects">
        <div className="auth-bg-orb auth-bg-orb-1" />
        <div className="auth-bg-orb auth-bg-orb-2" />
        <div className="auth-bg-orb auth-bg-orb-3" />
      </div>

      <div className="auth-container">
        <Link to="/dashboard" className="auth-logo-link">
          <div className="auth-logo-icon">
            <Code2 size={24} className="text-white" />
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
