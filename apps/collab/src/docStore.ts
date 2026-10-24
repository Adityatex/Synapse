/**
 * Where room documents live between sessions. P2-04 replaces this with the
 * MongoDB `ydoc_updates` + `ydoc_snapshots` implementation; until then the
 * in-memory store keeps a room alive across reconnects but NOT across a
 * collab restart.
 */
export interface DocStore {
  load(roomId: string): Promise<Uint8Array | null>;
  store(roomId: string, state: Uint8Array): Promise<void>;
}

export class MemoryDocStore implements DocStore {
  private readonly states = new Map<string, Uint8Array>();

  async load(roomId: string): Promise<Uint8Array | null> {
    return this.states.get(roomId) ?? null;
  }

  async store(roomId: string, state: Uint8Array): Promise<void> {
    this.states.set(roomId, state);
  }
}
