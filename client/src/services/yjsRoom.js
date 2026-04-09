import * as Y from 'yjs';

function encodeUpdate(update) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < update.length; i += chunkSize) {
    binary += String.fromCharCode(...update.slice(i, i + chunkSize));
  }
  return btoa(binary);
}

function decodeUpdate(encoded) {
  const binary = atob(encoded);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf;
}

export class RoomYjsManager {
  constructor({ socket, roomId, userId, onFileContent }) {
    this.socket = socket;
    this.roomId = roomId;
    this.userId = userId;
    this.onFileContent = onFileContent;
    this.docs = new Map();
    this.remoteOrigin = Symbol('remote');
    this.localSeedOrigin = Symbol('local-seed');
  }

  ensureDoc(fileId) {
    if (this.docs.has(fileId)) return this.docs.get(fileId);

    const doc = new Y.Doc();
    const text = doc.getText('content');

    // Mirror every Y.Text change into React's FileContext
    const textObserver = () => this.onFileContent?.(fileId, text.toString());
    text.observe(textObserver);

    // Only broadcast truly LOCAL user edits (not remote or seed operations)
    doc.on('update', (update, origin) => {
      if (origin === this.remoteOrigin || origin === this.localSeedOrigin) return;
      this.socket.emit('code-change', {
        roomId: this.roomId,
        fileId,
        changes: encodeUpdate(update),
        userId: this.userId,
      });
    });

    const entry = { doc, text, textObserver, seeded: false };
    this.docs.set(fileId, entry);
    return entry;
  }

  /**
   * Apply the server's authoritative Yjs snapshot (called on room-joined and
   * room-state-updated). Server state always wins — we never pre-seed locally,
   * so there is NO CRDT conflict / double-insert.
   */
  applySharedStates(sharedDocs = {}, files = []) {
    files.forEach((file) => {
      const entry = this.ensureDoc(file.id);
      const encodedState = sharedDocs[file.id];

      if (encodedState) {
        // Apply server state unconditionally — this is the source of truth.
        // remoteOrigin prevents it being echoed back to the server.
        Y.applyUpdate(entry.doc, decodeUpdate(encodedState), this.remoteOrigin);
        entry.seeded = true;
        this.onFileContent?.(file.id, entry.text.toString());
      }
    });
  }

  /**
   * Return the stable Y.Text reference for the given file.
   * We do NOT pre-seed from local content — the server state (via
   * applySharedStates) is the only source of initial content. Pre-seeding
   * locally then applying the server state causes CRDT double-inserts.
   */
  getText(fileId) {
    return this.ensureDoc(fileId).text;
  }

  /**
   * Seed a brand-new file's Y.Doc with its template content.
   * Only called when the creator creates a file that the server doesn't know
   * about yet (before the first sync-room-state round-trip completes).
   */
  seedNewFile(fileId, content) {
    const entry = this.ensureDoc(fileId);
    if (entry.seeded || !content) return;
    entry.doc.transact(() => {
      entry.text.insert(0, content);
    }, this.localSeedOrigin);
    entry.seeded = true;
    this.onFileContent?.(fileId, entry.text.toString());
  }

  applyRemoteUpdate(fileId, encodedUpdate) {
    if (!encodedUpdate) return;
    const entry = this.ensureDoc(fileId);
    Y.applyUpdate(entry.doc, decodeUpdate(encodedUpdate), this.remoteOrigin);
    entry.seeded = true;
    this.onFileContent?.(fileId, entry.text.toString());
  }

  destroy() {
    this.docs.forEach((entry) => {
      entry.text.unobserve(entry.textObserver);
      entry.doc.destroy();
    });
    this.docs.clear();
  }
}
