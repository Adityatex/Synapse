import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2 } from 'lucide-react';
import { getRoom } from '../services/roomService';
import { parseRoomTarget } from '../utils/roomLinks';
import TopNav from '../components/TopNav';
import './landing.css';

export default function JoinRoom() {
  const navigate = useNavigate();
  const [roomId, setRoomId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.body.style.backgroundColor = '#f7f7f7';
    return () => { document.body.style.backgroundColor = ''; };
  }, []);

  const handleJoinRoom = async (event) => {
    event.preventDefault();

    // A pasted invite link carries the token that grants membership.
    const target = parseRoomTarget(roomId);
    if (!target) {
      setError('Paste an invite link or enter a room code.');
      return;
    }
    if (target.hasInvite) {
      navigate(target.path);
      return;
    }
    const normalizedRoomId = target.roomId;

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
    <div className="lp auth-page" data-theme="light">
      <TopNav label="Rooms">
        <Link to="/dashboard" className="lp-link">Dashboard</Link>
      </TopNav>

      <div className="auth-container">

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
