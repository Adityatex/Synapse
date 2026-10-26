import { useCallback, useEffect, useRef, useState } from 'react';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { COLLAB_URL } from '../config/apiConfig';
import { getToken } from '../services/authService';

export type CollabStatus = 'connecting' | 'connected' | 'disconnected';
export type CollabAwareness = NonNullable<HocuspocusProvider['awareness']>;

/** Focus locks (P2-08), as the collab server reports them. */
export interface LockInfo {
  userId: string;
  name: string;
}

export interface LockState {
  /** Whether the room's creator has switched locks on. */
  enabled: boolean;
  locks: Record<string, LockInfo>;
}

/** The server refused a lock request. */
export interface LockDenied {
  /** Increases with every notice, so an effect can react to a repeat of the same one. */
  id: number;
  fileId: string;
  reason: 'held' | 'disabled' | 'unknown-file' | 'limit' | 'expired' | 'unavailable';
  holder?: LockInfo;
}

/** The server dropped one of our edits because somebody else holds the file's lock. */
export interface LockRejection {
  id: number;
  fileIds: string[];
  holders: LockInfo[];
}

export interface RoomCollab {
  doc: Y.Doc;
  /** Presence channel of this connection (P2-07); null until the provider exists. */
  awareness: CollabAwareness | null;
  status: CollabStatus;
  /** True once the server's copy of the room has been received. */
  synced: boolean;
  /** Why the server refused us (expired token, not a member, unknown room), or ''. */
  authError: string;
  lockState: LockState;
  denied: LockDenied | null;
  rejection: LockRejection | null;
  /** Asks the server to take, keep or give up the lock on a file. */
  lock: (action: 'acquire' | 'renew' | 'release', fileId: string) => void;
}

const NO_LOCKS: LockState = { enabled: false, locks: {} };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function readHolder(value: unknown): LockInfo | undefined {
  return isRecord(value) && typeof value.userId === 'string' ? { userId: value.userId, name: typeof value.name === 'string' ? value.name : '' } : undefined;
}

function readLockState(message: Record<string, unknown>): LockState {
  const locks: Record<string, LockInfo> = {};
  if (isRecord(message.locks)) {
    for (const [fileId, value] of Object.entries(message.locks)) {
      const holder = readHolder(value);
      if (holder) locks[fileId] = holder;
    }
  }
  return { enabled: message.enabled === true, locks };
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
  const [lockState, setLockState] = useState<LockState>(NO_LOCKS);
  const [denied, setDenied] = useState<LockDenied | null>(null);
  const [rejection, setRejection] = useState<LockRejection | null>(null);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const noticeCount = useRef(0);

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
      onStateless: ({ payload }) => {
        if (!current) return;
        let message: unknown;
        try {
          message = JSON.parse(payload);
        } catch {
          return;
        }
        if (!isRecord(message)) return;
        if (message.type === 'locks.snapshot') {
          setLockState(readLockState(message));
        } else if (message.type === 'locks.denied' && typeof message.fileId === 'string' && typeof message.reason === 'string') {
          setDenied({ id: ++noticeCount.current, fileId: message.fileId, reason: message.reason as LockDenied['reason'], holder: readHolder(message.holder) });
        } else if (message.type === 'locks.rejected' && Array.isArray(message.fileIds)) {
          const holders = Array.isArray(message.holders) ? message.holders.map(readHolder).filter((h): h is LockInfo => Boolean(h)) : [];
          setRejection({ id: ++noticeCount.current, fileIds: message.fileIds.filter((id): id is string => typeof id === 'string'), holders });
        }
      },
    });
    providerRef.current = provider;
    return () => {
      current = false;
      providerRef.current = null;
      provider.destroy();
    };
  }, [doc, roomId]);

  useEffect(() => () => doc.destroy(), [doc]);

  const lock = useCallback((action: 'acquire' | 'renew' | 'release', fileId: string) => {
    try {
      providerRef.current?.sendStateless(JSON.stringify({ type: `locks.${action}`, fileId }));
    } catch {
      // Not connected right now; the next renewal or click tries again.
    }
  }, []);

  return { doc, awareness, status, synced, authError, lockState, denied, rejection, lock };
}
