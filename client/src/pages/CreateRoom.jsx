import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2 } from 'lucide-react';
import { createRoom } from '../services/roomService';
import SynapseLogo from '../components/SynapseLogo';

export default function CreateRoom() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [roomName, setRoomName] = useState('');

  useEffect(() => {
    document.body.style.backgroundColor = '#0b1410';
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

      <div className="auth-container">
        <Link to="/dashboard" className="auth-logo-link">
          <div className="auth-logo-icon">
            <SynapseLogo size={24} color="#0d2a1c" nodeColor="#0d2a1c" />
          </div>
          <span className="auth-logo-text">Synapse</span>
        </Link>

        <div className="auth-card">
          <div className="auth-card-header">
            <h1 className="auth-title">Create a room</h1>
            <p className="auth-subtitle">
              Name it after what you&apos;re working on. Once you&apos;re inside, the Invite button copies a link for your teammates.
            </p>
          </div>

          {error ? <div className="auth-error-banner">{error}</div> : null}

          <div className="auth-field" style={{ marginBottom: '1.25rem' }}>
            <label className="auth-label" htmlFor="roomName">Room name</label>
            <div className="auth-input-wrapper">
              <input
                id="roomName"
                type="text"
                className="auth-input"
                placeholder="DSA practice"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateRoom();
                }}
              />
            </div>
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
            Have an invite link? <Link to="/join-room" className="auth-link">Join a room</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
