import { useEffect, useState } from 'react';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { COLLAB_URL } from '../config/apiConfig';
import { getToken } from '../services/authService';

export type CollabStatus = 'connecting' | 'connected' | 'disconnected';
export type CollabAwareness = NonNullable<HocuspocusProvider['awareness']>;

export interface RoomCollab {
  doc: Y.Doc;
  /** Presence channel of this connection (P2-07); null until the provider exists. */
  awareness: CollabAwareness | null;
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
  const [awareness, setAwareness] = useState<CollabAwareness | null>(null);
  const [status, setStatus] = useState<CollabStatus>('connecting');
  const [synced, setSynced] = useState(false);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    let current = true;
    const provider = new HocuspocusProvider({
      url: COLLAB_URL,
      name: `room:${roomId}`,
      document: doc,
      // A function, so a reconnect after the token was refreshed sends the new one.
      token: () => getToken() || '',
      onStatus: ({ status: next }) => {
        if (!current) return;
        setStatus(next as CollabStatus);
        // The provider owns its awareness, and it only exists once the provider does. Status
        // events arrive asynchronously, which is the first moment it can be handed to React.
        setAwareness(provider.awareness);
      },
      onSynced: () => setSynced(true),
      onAuthenticationFailed: ({ reason }) => setAuthError(reason || 'Access to this room was refused.'),
    });
    return () => {
      current = false;
      provider.destroy();
    };
  }, [doc, roomId]);

  useEffect(() => () => doc.destroy(), [doc]);

  return { doc, awareness, status, synced, authError };
}
