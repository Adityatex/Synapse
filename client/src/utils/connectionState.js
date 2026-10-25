// What the connection banner shows (P2-12), from the collab connection.
//
//  - 'signed-out': the sign-in expired while connected, so the room is read-only with a way back in;
//  - 'offline' / 'offline-unsynced': the network is gone or the server is unreachable. Typing
//    continues and is kept on this screen, then sent when the connection returns (Yjs merges it
//    with what others did meanwhile);
//  - null: nothing to say (connecting for the first time is covered by the loading screen).
export function connectionBannerState({ status, synced, unsynced, authLost }) {
  if (authLost) return 'signed-out';
  if (!synced) return null;
  if (status === 'connected') return null;
  return unsynced > 0 ? 'offline-unsynced' : 'offline';
}
