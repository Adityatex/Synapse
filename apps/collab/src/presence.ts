import { sanitizePresence } from '@synapse/room-doc';
import type { AuthUser } from './auth.js';

/** The parts of Hocuspocus' `beforeHandleAwareness` payload the guard uses. */
export interface AwarenessUpdate {
  states: Map<number, Record<string, unknown>>;
  removedClients: Set<number>;
  context: { user: AuthUser } | undefined;
  connection?: unknown;
  document: { connections: Map<unknown, { clients: Set<number> }> };
}

/**
 * Presence (P2-07). Awareness is written by clients, so every update is rewritten here
 * before it is relayed: the identity comes from the verified token, unknown fields are
 * dropped, and a connection can only speak for its own awareness client.
 */
export function guardAwareness({ states, removedClients, context, connection, document }: AwarenessUpdate): void {
  if (!context) return; // server-internal writes are trusted

  const ownedElsewhere = (clientId: number) => {
    for (const [other, entry] of document.connections) {
      if (other !== connection && entry.clients.has(clientId)) return true;
    }
    return false;
  };

  const identity = { userId: context.user.userId, name: context.user.name ?? '' };
  for (const [clientId, state] of states) {
    if (ownedElsewhere(clientId)) states.delete(clientId);
    else states.set(clientId, { ...sanitizePresence(state, identity) });
  }
  for (const clientId of removedClients) {
    if (ownedElsewhere(clientId)) removedClients.delete(clientId);
  }
}
