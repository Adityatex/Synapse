import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { joinRoomWithInvite } from '../services/roomService';

// /room/:roomId?invite=<token> — accept the invite (adds the user to the
// room's members) before RoomPage fetches the room and joins its socket room.
export default function RoomInviteGate({ children }) {
  const { roomId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!inviteToken) return undefined;
    let cancelled = false;
    joinRoomWithInvite(roomId, inviteToken)
      .then(() => {
        if (!cancelled) setSearchParams({}, { replace: true });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Could not join this room.');
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, inviteToken, setSearchParams]);

  if (error) {
    return (
      <div className="auth-loading-screen">
        <p className="auth-loading-text">{error}</p>
        <Link to="/dashboard" className="auth-loading-text" style={{ textDecoration: 'underline' }}>
          Back to dashboard
        </Link>
      </div>
    );
  }

  if (inviteToken) {
    return (
      <div className="auth-loading-screen">
        <div className="auth-loading-spinner" />
        <p className="auth-loading-text">Joining room…</p>
      </div>
    );
  }

  return children;
}
