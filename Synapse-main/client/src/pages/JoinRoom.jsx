import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, Users } from 'lucide-react';
import { getRoom } from '../services/roomService';
import SynapseInteractiveBackground from '../components/SynapseInteractiveBackground';
import SynapseLogo from '../components/SynapseLogo';

export default function JoinRoom() {
  const navigate = useNavigate();
  const [roomId, setRoomId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.body.style.backgroundColor = '#05070d';
    return () => { document.body.style.backgroundColor = ''; };
  }, []);

  const handleJoinRoom = async (event) => {
    event.preventDefault();

    const normalizedRoomId = roomId.trim().toUpperCase();
    if (!normalizedRoomId) {
      setError('Enter a room code to continue.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      await getRoom(normalizedRoomId);
      navigate(`/room/${normalizedRoomId}`);
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
              <Users size={24} />
            </div>
            <h1 className="auth-title">Join a live coding room</h1>
            <p className="auth-subtitle">
              Paste the room ID you received and we&apos;ll connect you to the shared editor.
            </p>
          </div>

          {error ? <div className="auth-error-banner">{error}</div> : null}

          <form onSubmit={handleJoinRoom} className="auth-form">
            <div className="auth-field">
              <label className="auth-label" htmlFor="roomId">Room code</label>
              <div className="auth-input-wrapper">
                <input
                  id="roomId"
                  value={roomId}
                  onChange={(event) => setRoomId(event.target.value.toUpperCase())}
                  className="auth-input"
                  placeholder="ABC123"
                  maxLength={6}
                  autoComplete="off"
                />
              </div>
            </div>

            <button type="submit" className="auth-btn" disabled={loading}>
              {loading ? (
                <span className="auth-btn-loading">
                  <Loader2 size={18} className="animate-spin" />
                  Joining room...
                </span>
              ) : (
                <span className="auth-btn-content">
                  <span>Join room</span>
                  <ArrowRight size={18} />
                </span>
              )}
            </button>
          </form>

          <div className="auth-card-footer">
            Need a fresh workspace? <Link to="/create-room" className="auth-link">Create a room</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
