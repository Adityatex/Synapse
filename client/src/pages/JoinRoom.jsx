import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2 } from 'lucide-react';
import { getRoom } from '../services/roomService';
import SynapseLogo from '../components/SynapseLogo';

export default function JoinRoom() {
  const navigate = useNavigate();
  const [roomId, setRoomId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.body.style.backgroundColor = '#0b1410';
    return () => { document.body.style.backgroundColor = ''; };
  }, []);

  const handleJoinRoom = async (event) => {
    event.preventDefault();

    // A pasted invite link carries the token that grants membership.
    const pasted = roomId.trim();
    const linkMatch = pasted.match(/\/room\/([A-Za-z0-9]+)(\?[^#\s]*)?/);
    if (linkMatch && /[?&]invite=/.test(linkMatch[2] || '')) {
      navigate(`/room/${linkMatch[1].toUpperCase()}${linkMatch[2]}`);
      return;
    }

    const normalizedRoomId = (linkMatch ? linkMatch[1] : pasted).toUpperCase();
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

      <div className="auth-container">
        <Link to="/dashboard" className="auth-logo-link">
          <div className="auth-logo-icon">
            <SynapseLogo size={24} color="#0d2a1c" nodeColor="#0d2a1c" />
          </div>
          <span className="auth-logo-text">Synapse</span>
        </Link>

        <div className="auth-card">
          <div className="auth-card-header">
            <h1 className="auth-title">Join a room</h1>
            <p className="auth-subtitle">
              Paste the invite link someone sent you. If you&apos;re already a member, the room code works too.
            </p>
          </div>

          {error ? <div className="auth-error-banner">{error}</div> : null}

          <form onSubmit={handleJoinRoom} className="auth-form">
            <div className="auth-field">
              <label className="auth-label" htmlFor="roomId">Invite link or room code</label>
              <div className="auth-input-wrapper">
                <input
                  id="roomId"
                  value={roomId}
                  onChange={(event) => setRoomId(event.target.value)}
                  className="auth-input"
                  placeholder="https://…/room/ABC123?invite=…"
                  spellCheck={false}
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
            Starting something new? <Link to="/create-room" className="auth-link">Create a room</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
