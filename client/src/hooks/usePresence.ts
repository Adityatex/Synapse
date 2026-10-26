import { useCallback, useEffect, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { identityFor, readPresence } from '@synapse/room-doc';
import type { CollabAwareness } from './useRoomCollab';

/** One person in the room. Several tabs of the same user are merged into one. */
export interface Peer {
  userId: string;
  name: string;
  color: string;
  glyph: string;
  /** The file they have open. */
  fileId: string | null;
  typing: boolean;
  isYou: boolean;
}

const NO_PEERS: Peer[] = [];
const snapshots = new WeakMap<object, { key: string; peers: Peer[] }>();

function derivePeers(awareness: CollabAwareness, selfUserId: string | undefined): Peer[] {
  const byUser = new Map<string, Peer>();
  const states = awareness.getStates();
  for (const clientId of [...states.keys()].sort((a, b) => a - b)) {
    const presence = readPresence(states.get(clientId));
    if (!presence) continue; // a client that has not announced itself yet
    const known = byUser.get(presence.user.userId);
    byUser.set(presence.user.userId, {
      userId: presence.user.userId,
      name: presence.user.name,
      color: presence.user.color,
      glyph: presence.user.glyph,
      // With several tabs open, report the one that is being typed in.
      fileId: known && !presence.typing ? (known.fileId ?? presence.fileId) : presence.fileId,
      typing: Boolean(known?.typing) || presence.typing,
      isYou: presence.user.userId === selfUserId,
    });
  }
  return [...byUser.values()].sort(
    (a, b) => Number(b.isYou) - Number(a.isYou) || a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId),
  );
}

/**
 * Who is in the room, from awareness (P2-07). Cursor movement changes awareness many times a
 * second but not this list, so the snapshot is reused until a person, their file or their
 * typing state changes, and React does not re-render for a moving cursor.
 */
export function usePeers(awareness: CollabAwareness | null, selfUserId: string | undefined): Peer[] {
  const subscribe = useCallback(
    (notify: () => void) => {
      awareness?.on('change', notify);
      return () => awareness?.off('change', notify);
    },
    [awareness],
  );
  const getSnapshot = useCallback(() => {
    if (!awareness) return NO_PEERS;
    const peers = derivePeers(awareness, selfUserId);
    const key = JSON.stringify(peers);
    const previous = snapshots.get(awareness);
    if (previous?.key === key) return previous.peers;
    snapshots.set(awareness, { key, peers });
    return peers;
  }, [awareness, selfUserId]);
  return useSyncExternalStore(subscribe, getSnapshot, () => NO_PEERS);
}

const TYPING_IDLE_MS = 2000;

/**
 * Publishes this tab's own presence: identity, the open file, and whether it is typing.
 * The server overwrites the identity with the one from the token, so this is for local display.
 */
export function useLocalPresence(
  awareness: CollabAwareness | null,
  doc: Y.Doc | null,
  user: { userId?: string; name?: string } | null | undefined,
  activeFileId: string | null | undefined,
): void {
  const userId = user?.userId;
  const name = user?.name;

  useEffect(() => {
    if (!awareness || !userId) return;
    awareness.setLocalStateField('user', identityFor({ userId, name: name ?? '' }));
  }, [awareness, userId, name]);

  useEffect(() => {
    if (!awareness) return;
    awareness.setLocalStateField('fileId', activeFileId ?? null);
    // The old selection points into the previous file's text, where peers would keep drawing it.
    // The editor writes a new one as soon as the cursor moves in this file.
    awareness.setLocalStateField('selection', null);
  }, [awareness, activeFileId]);

  useEffect(() => {
    if (!awareness || !doc) return undefined;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const onTransaction = (transaction: Y.Transaction) => {
      // Only keystrokes in the editor: remote updates are not "local", and file operations
      // (create, rename) are not made through the Monaco binding.
      const origin = transaction.origin as object | null;
      if (!transaction.local || !origin || typeof origin !== 'object' || !('monacoModel' in origin)) return;
      if (awareness.getLocalState()?.typing !== true) awareness.setLocalStateField('typing', true);
      clearTimeout(idle);
      idle = setTimeout(() => awareness.setLocalStateField('typing', false), TYPING_IDLE_MS);
    };
    doc.on('afterTransaction', onTransaction);
    return () => {
      doc.off('afterTransaction', onTransaction);
      clearTimeout(idle);
    };
  }, [awareness, doc]);
}
