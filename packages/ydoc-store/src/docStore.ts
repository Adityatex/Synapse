import * as Y from 'yjs';

/**
 * Where room documents live between sessions.
 *
 * `store` receives the live Y.Doc rather than a state blob so an implementation
 * can persist only what changed since its previous write.
 */
export interface DocStore {
  /** Merged persisted state, or null for a room that has never been stored. */
  load(roomId: string): Promise<Uint8Array | null>;
  store(roomId: string, document: Y.Doc): Promise<void>;
  /** The room's document was unloaded from this process; drop per-room bookkeeping. */
  release?(roomId: string): void;
}

/** Test double: keeps a room across reconnects but not across a process restart. */
export class MemoryDocStore implements DocStore {
  private readonly states = new Map<string, Uint8Array>();

  async load(roomId: string): Promise<Uint8Array | null> {
    return this.states.get(roomId) ?? null;
  }

  async store(roomId: string, document: Y.Doc): Promise<void> {
    this.states.set(roomId, Y.encodeStateAsUpdate(document));
  }
}
