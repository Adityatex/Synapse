import { useEffect, useState } from 'react';
import { getRoom } from '../services/roomService';

/**
 * Which editor opens a room (P2-10), in a client built for collab. Every room opens in collab, which
 * migrates a classic room the first time it is opened, except one pinned to the classic editor
 * (`collabVersion: 1`, which is what a rollback sets). Returns 'loading', 'collab' or 'classic'.
 *
 * If the room cannot be fetched, 'collab' is returned: the room page shows the error itself.
 */
export function useRoomMode(roomId, enabled) {
  const [known, setKnown] = useState({ roomId: null, mode: null });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    getRoom(roomId)
      .then(({ room }) => !cancelled && setKnown({ roomId, mode: room?.collabVersion === 1 ? 'classic' : 'collab' }))
      .catch(() => !cancelled && setKnown({ roomId, mode: 'collab' }));
    return () => {
      cancelled = true;
    };
  }, [roomId, enabled]);

  if (!enabled) return 'classic';
  return known.roomId === roomId ? known.mode : 'loading';
}
