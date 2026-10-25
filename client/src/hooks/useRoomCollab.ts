import { useEffect, useState } from 'react';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { COLLAB_URL } from '../config/apiConfig';
import { getToken } from '../services/authService';

export type CollabStatus = 'connecting' | 'connected' | 'disconnected';

export interface RoomCollab {
  doc: Y.Doc;
  status: CollabStatus;
  /** True once the server's copy of the room has been received. */
  synced: boolean;
  /** Why the server refused us (expired token, not a member, unknown room), or ''. */
  authError: string;
}

/**
 * Connects this tab to the room's document on the collab server (P2-06).
 * The document exists from the first render so children can bind to it
 * immediately; it fills in once the provider syncs.
 */
export function useRoomCollab(roomId: string): RoomCollab {
  const [doc] = useState(() => new Y.Doc());
  const [status, setStatus] = useState<CollabStatus>('connecting');
  const [synced, setSynced] = useState(false);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    const provider = new HocuspocusProvider({
      url: COLLAB_URL,
      name: `room:${roomId}`,
      document: doc,
      // A function, so a reconnect after the token was refreshed sends the new one.
      token: () => getToken() || '',
      onStatus: ({ status: next }) => setStatus(next as CollabStatus),
      onSynced: () => setSynced(true),
      onAuthenticationFailed: ({ reason }) => setAuthError(reason || 'Access to this room was refused.'),
    });
    return () => provider.destroy();
  }, [doc, roomId]);

  useEffect(() => () => doc.destroy(), [doc]);

  return { doc, status, synced, authError };
}
