# Phase 2 Design Document: Unified Room Document Model

**Document Status:** Proposed / Ready for Review  
**Target Architecture:** Synapse Real-time Collaborative Engine (Phase 2)  
**Authors:** Synapse Core Team  
**Key Components:** `files` `Y.Map`, `y-protocols/awareness`, Distributed File Locks  

---

## 1. Executive Summary & Problem Statement

### 1.1 Context
In Phase 1, Synapse established basic collaborative editing and multi-user chat. However, the Phase 1 state management was split across heterogeneous subsystems:
1. **File Tree State**: Managed as a raw JavaScript array (`files: []`) sent over Socket.IO via `sync-room-state`. Any concurrent file creation, renaming, or deletion suffers from Last-Write-Wins (LWW) race conditions and array clobbering.
2. **Editor Document State**: Managed through isolated individual `Y.Doc` instances per file stored in a server-side `Map<fileId, Y.Doc>`. This creates fragmented state vectors, prevents atomic cross-file operations (e.g., refactoring or multi-file templates), and complicates lifecycle/memory cleanup.
3. **Presence & Cursors**: Implemented via ad-hoc Socket.IO events (`cursor-move`, `selection-change`, `user-editing`, `typing-indicator`) coupled with custom runtime CSS injection (`presence-style-${userId}`) and manual range math. This lacks delta compression, causes cursor flicker, and does not leverage Yjs's battle-tested awareness protocols.
4. **File Locking**: Stored in a transient server `Map` with custom timeout handlers, loosely decoupled from both the file tree model and the Monaco editor binding.

### 1.2 Phase 2 Objectives
Phase 2 unifies the entire room state into a cohesive, CRDT-backed data model:
- **A Single Root `Y.Doc` per Room**: Encapsulating the file tree, file contents, and room metadata in a single CRDT hierarchy.
- **Hierarchical `files` `Y.Map`**: Storing nodes (files and folders) with CRDT guarantees for concurrent creations, moves, renames, and deletions.
- **Standardized `y-protocols/awareness`**: Unifying cursor positions, text selections, active file focus, and typing indicators into an efficient binary protocol integrated directly into `y-monaco`.
- **Authoritative Hybrid Lock Subsystem**: Providing deterministic advisory and exclusive locks with heartbeat leases, auto-expiration, and deep Monaco binding integration.

---

## 2. High-Level Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                              Synapse Room                              │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                     Root Y.Doc (guid: roomId)                     │  │
│  │                                                                  │  │
│  │  ┌────────────────────────────────────────────────────────────┐  │  │
│  │  │               `files`: Y.Map<FileId, Y.Map>                │  │  │
│  │  │  ┌───────────────────┐        ┌─────────────────────────┐  │  │  │
│  │  │  │ File Node Y.Map   │        │ Directory Node Y.Map    │  │  │  │
│  │  │  │  id: "src/app.py" │        │  id: "src"              │  │  │  │
│  │  │  │  name: "app.py"   │        │  name: "src"            │  │  │  │
│  │  │  │  type: "file"     │        │  type: "directory"      │  │  │  │
│  │  │  │  parentId: "src"  │        │  parentId: null         │  │  │  │
│  │  │  │  content: Y.Text  │        └─────────────────────────┘  │  │  │
│  │  │  └───────────────────┘                                     │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  │                                                                  │  │
│  │  ┌────────────────────────┐        ┌──────────────────────────┐  │  │
│  │  │ `metadata`: Y.Map      │        │ `locks`: Y.Map           │  │  │
│  │  │  roomName, createdBy   │        │  fileId -> LockRecord    │  │  │
│  │  └────────────────────────┘        └──────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                 ▲                                      │
│                                 │ Y.applyUpdate / Y.encodeStateVector  │
│                                 ▼                                      │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │               y-protocols / Awareness Layer                      │  │
│  │                                                                  │  │
│  │   awareness.getStates() -> Map<ClientId, {                       │  │
│  │     user: { id, name, color, avatar },                           │  │
│  │     activeFileId: "src/app.py",                                  │  │
│  │     cursor: { line, column },                                    │  │
│  │     selection: { anchor, head }                                  │  │
│  │   }>                                                             │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
          ▲                                                   ▲
          │ Socket.IO Binary Stream                           │ Socket.IO
          ▼                                                   ▼
┌─────────────────────────┐                         ┌───────────────────┐
│     Client A (Monaco)   │                         │ Client B (Monaco) │
└─────────────────────────┘                         └───────────────────┘
```

---

## 3. Data Model Specification

### 3.1 Root `Y.Doc` Structure
Each collaborative room corresponds to exactly one root `Y.Doc`. The document exposes top-level shared types:

| Type Name | Yjs Type | Purpose |
|---|---|---|
| `files` | `Y.Map<string, Y.Map>` | Map of all file and directory entries, indexed by unique `fileId`. |
| `metadata` | `Y.Map<string, any>` | Room-wide metadata (room name, created timestamp, active execution environment). |
| `locks` | `Y.Map<string, Y.Map>` | Client-visible lock states for real-time reactive UI locking. |

### 3.2 The `files` `Y.Map` Schema

Each entry in `files` is a nested `Y.Map` representing a node in the project file tree:

```typescript
interface FileNodeCRDT {
  // Immutable unique identifier (UUID v4 or nanoid)
  id: string;

  // Display name of the file or folder (e.g., "index.js", "components")
  name: string;

  // Node discriminator
  type: 'file' | 'directory';

  // Parent directory ID. Null indicates root-level node
  parentId: string | null;

  // Fractional indexing string or integer for lexicographical ordering
  order: number;

  // Collaborative text buffer (Only instantiated if type === 'file')
  content: Y.Text;

  // Metadata timestamps
  createdAt: number;
  updatedAt: number;

  // Soft delete tombstone (null if active, timestamp if deleted)
  deletedAt: number | null;
}
```

#### Why Nested `Y.Text` instead of Subdocs?
- **Yjs Subdocs (`Y.Doc` inside `Y.Map`)**: Subdocs support lazy loading, but introduce asynchronous loading states, nested provider complexities, and extra socket handshake rounds.
- **Unified Root Doc with Nested `Y.Text`**: Ideal for browser-based IDEs with small-to-medium project footprints (under 500 files, < 20MB total text). All files sync in a single state vector exchange, eliminating "file loading..." spinners when switching tabs.

### 3.3 File Tree Operations & CRDT Conflict Invariants

| Operation | Implementation in `files` Y.Map | Conflict Resolution |
|---|---|---|
| **Create File/Folder** | `filesMap.set(newId, new Y.Map([['id', newId], ['name', name], ['content', new Y.Text(seedContent)], ...]))` | Unique `id` prevents collisions. Concurrent creations with identical names receive duplicate resolution suffix on the UI. |
| **Rename Node** | `fileNodeMap.set('name', newName); fileNodeMap.set('updatedAt', Date.now())` | Y.Map Last-Write-Wins (LWW) at field level. Both edits converge deterministically based on Yjs client clock. |
| **Move Node (Reparent)** | `fileNodeMap.set('parentId', targetFolderId)` | If user A moves `/A` into `/B` while user B moves `/B` into `/A`, circular cycles are prevented via an ancestor check validator on client and server before applying reparenting. |
| **Delete Node** | `fileNodeMap.set('deletedAt', Date.now())` (Soft Delete) followed by cascade tombstoning of child nodes. | Soft delete avoids "dangling reference" bugs where peer edits arrive after node deletion. Tombstones are purged from memory upon room archive. |

---

## 4. Awareness Protocol (`y-protocols/awareness`)

### 4.1 Awareness State Schema
The Yjs Awareness protocol manages ephemeral presence that should **not** be persisted in the document CRDT history.

Each connected client maintains an awareness state on their local `Awareness` instance:

```typescript
interface SynapseAwarenessState {
  // User Identity
  user: {
    userId: string;
    username: string;
    cursorColor: string;
    avatarGlyph: string;
  };

  // Viewport / Context
  activeFileId: string | null;
  openTabs: string[];

  // Editor Position (populated when activeFileId is focused)
  cursor: {
    lineNumber: number;
    column: number;
  } | null;

  // Selection Range (null if cursor is collapsed)
  selection: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null;

  // Activity Status
  isTyping: boolean;
  lastActive: number;
}
```

### 4.2 Monaco Binding Integration (`y-monaco`)

In Phase 1, `MonacoBinding` was created with `new MonacoBinding(sharedText, model, new Set([editor]))`, omitting the awareness parameter and falling back to manual DOM stylesheet injections.

In Phase 2:
```javascript
// Native MonacoBinding with awareness support:
const binding = new MonacoBinding(
  sharedText,
  model,
  new Set([editorRef.current]),
  awarenessInstance // Directly renders peer cursors & selection decorations!
);
```

#### Multi-File Awareness Filtering
Because users can edit different files concurrently:
1. When switching files, the client sets `awareness.setLocalStateField('activeFileId', newFileId)`.
2. The custom Monaco cursor renderer decorates remote cursors **only** if:
   `peerState.activeFileId === currentActiveFileId`.
3. The File Tree Sidebar reads awareness states globally to show live "avatar badges" next to the files teammates are currently inspecting.

### 4.3 Awareness Transport & Lifecycle
- **Encoding**: Binary format via `awarenessProtocol.encodeAwarenessUpdate(awareness, [clientId])`.
- **Heartbeat & Inactivity**: Awareness automatically sets a timeout (default 30,000ms). If no update arrives, the client is marked offline and peers remove their cursor decorations.
- **Graceful Leave**: When socket disconnects, the server calls `awarenessProtocol.removeAwarenessStates(awareness, [socket.data.clientId], 'disconnect')`, broadcasting the removal immediately.

---

## 5. Distributed Lock Subsystem

### 5.1 Lock Semantics: Advisory vs Exclusive
Collaborative coding often benefits from two locking levels:
1. **Advisory Lock (Soft)**: "Soft focus indicator." Informs peers that User X is actively editing this file to discourage simultaneous edits on the same functions, but does **not** disable typing.
2. **Exclusive Lock (Hard)**: "File Lease." Locks the file to a single writer. For all other users, Monaco is set to `readOnly: true`, and the server rejects incoming `code-change` Yjs updates for that file.

```
                          [Request Lock (fileId)]
                                    │
                         Is file currently locked?
                                ╱       ╲
                              YES        NO
                              ╱           ╲
                 Is lock expired?      Grant Lock
                     ╱        ╲         ├── Set lock holder & lease (45s)
                   YES         NO       └── Broadcast to room
                   ╱            ╲
          Steal/Grant Lock     Reject Request (409)
           ├── Overwrite lock   └── Return current holder
           └── Broadcast
```

### 5.2 Lock Architecture: Hybrid Server-Authoritative Lease

While awareness is ephemeral and `files` is a CRDT, locks require **strict mutual exclusion**. Therefore, the server acts as the authoritative lease arbiter, with state mirrored into a synchronized structure:

#### Lock Record Schema:
```typescript
interface FileLockRecord {
  fileId: string;
  userId: string;
  username: string;
  socketId: string;
  lockedAt: number;
  expiresAt: number;  // Heartbeat lease (TTL = 45s)
  mode: 'exclusive' | 'advisory';
}
```

#### Lease Lifecycle:
1. **Acquire**: Client sends `lock:acquire { fileId, mode }`. Server validates if `fileLocks.get(fileId)` is free or expired. If valid, lease is issued with `expiresAt = Date.now() + 45000`.
2. **Heartbeat / Renew**: While the user is actively typing or cursor is focused on the file, the client issues `lock:renew { fileId }` every 15 seconds.
3. **Release**: Explicitly emitted on tab close, file switch, or blur via `lock:release { fileId }`.
4. **Auto-Reclaim on Disconnect / Timeout**: If a socket disconnects or heartbeats fail for 45s, the server clears the lock and broadcasts `lock:released` to prevent abandoned locks.

---

## 6. Network Protocols & Socket Event Specification

### 6.1 Unified Sync Lifecycle
Phase 2 replaces fragmented JSON payloads with a clean dual-channel protocol (Yjs binary synchronization + structured JSON management events):

```
Client                                                  Server
  │                                                       │
  │─── 1. socket.emit('room:join', { roomId }) ──────────>│
  │                                                       │
  │<── 2. socket.emit('room:sync-init', {                 │
  │         docState: encodeStateAsUpdate(roomDoc),       │
  │         awareness: encodeAwarenessUpdate(awareness),  │
  │         locks: serializeActiveLocks()                 │
  │       }) ─────────────────────────────────────────────│
  │                                                       │
  │─── 3. socket.emit('yjs:update', updateBlob) ─────────>│
  │       (Applied to server roomDoc)                     │
  │                                                       │
  │<── 4. socket.broadcast.emit('yjs:update', updateBlob)─│
  │                                                       │
  │─── 5. socket.emit('awareness:update', rawBuffer) ────>│
  │<── 6. socket.broadcast.emit('awareness:update', ...) ─│
  │                                                       │
  │─── 7. socket.emit('lock:acquire', { fileId }) ───────>│
  │<── 8. io.to(roomId).emit('lock:updated', lockRecord) ─│
```

### 6.2 Event Catalog

| Event Name | Direction | Payload | Description |
|---|---|---|---|
| `room:join` | Client -> Server | `{ roomId }` | Authenticate and join room channel. |
| `room:sync-init` | Server -> Client | `{ docState, awareness, locks }` | Authoritative full state snapshot on join. |
| `yjs:update` | Bi-directional | `Uint8Array` (binary) | Incremental CRDT update for root `Y.Doc`. |
| `awareness:update` | Bi-directional | `Uint8Array` (binary) | Batch presence updates (cursors, selections). |
| `lock:acquire` | Client -> Server | `{ fileId, mode: 'exclusive' \| 'advisory' }` | Request edit lease for a file. |
| `lock:renew` | Client -> Server | `{ fileId }` | Extend 45s heartbeat lease. |
| `lock:release` | Client -> Server | `{ fileId }` | Voluntarily relinquish file edit lease. |
| `lock:denied` | Server -> Client | `{ fileId, currentLock }` | Rejection if file is actively leased to another user. |
| `lock:updated` | Server -> Room | `{ roomId, locks: FileLockRecord[] }` | Broadcast updated lock dictionary. |

---

## 7. Persistence & MongoDB Storage Strategy

### 7.1 Database Schema (`server/models/Room.js`)
Rather than storing loose arrays of files, the MongoDB document stores the compressed Yjs binary update alongside a materialized projection for fast read-only access (e.g. Judge0 code execution):

```javascript
const RoomSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true, index: true },
  roomName: { type: String, default: 'Untitled Room' },
  createdBy: { type: String, required: true },
  
  // Authoritative CRDT binary snapshot
  crdtSnapshot: { type: Buffer, default: null },

  // Materialized projection for code runner & search without running Yjs engine
  materializedFiles: [{
    id: String,
    name: String,
    type: { type: String, enum: ['file', 'directory'], default: 'file' },
    parentId: String,
    content: String,
    updatedAt: Date
  }],

  activeLocks: [{
    fileId: String,
    userId: String,
    username: String,
    expiresAt: Date
  }],

  lastUpdated: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});
```

### 7.2 Checkpoint & Flush Strategy
1. **Debounced DB Persistence**: In-memory updates to `roomDoc` are batched. Every 5 seconds of inactivity (or on 50 updates threshold), the server compresses the doc with `Y.encodeStateAsUpdate(roomDoc)` and flushes to `crdtSnapshot`.
2. **Materialized Projection Extraction**: When flushing, `files` `Y.Map` is iterated to generate `materializedFiles`. This guarantees that execution endpoints (`POST /api/execute`) receive valid plain strings without needing to parse CRDT structures at runtime.
3. **Graceful Teardown**: When the last user leaves a room, a final synchronous flush occurs before unloading the in-memory `Y.Doc` from server RAM.

---

## 8. Migration Plan (Phase 1 -> Phase 2)

### Phase 2.1: Data Migration Script & Compatibility Layer
- **DB Hydration**: When an existing room from Phase 1 is loaded (`loadRoomFromDB`), a conversion utility reads `room.files` array and constructs the root `Y.Doc` with `files` `Y.Map`.
- **Content Porting**: For each legacy file, `new Y.Text(file.content)` is seeded into the corresponding `fileMap` entry.

### Phase 2.2: Client-side Refactoring
- Deprecate individual `Y.Doc` mapping inside `yjsRoom.js`.
- Replace `RoomYjsManager` with unified `RoomDocManager`:
  - Single `Y.Doc` root.
  - Exposes `filesMap = doc.getMap('files')`.
  - Exposes `getTextForFile(fileId)`.
  - Integrates `y-protocols/awareness` with Monaco editor.

### Phase 2.3: Verification Matrix

| Test Scenario | Expected Outcome |
|---|---|
| Concurrent File Creation | Users A & B simultaneously create `test1.py` and `test2.py`. Both files appear in sidebar without data loss. |
| Rapid Text Edits | 5+ users typing simultaneously in the same file. No character doubling, zero cursor jumping. |
| Lock Expiration & Disconnect | User holds lock on `main.py` and closes browser window. Lock immediately releases or expires in 45s; other users can edit. |
| File Renaming & Moves | Renaming a folder immediately propagates down tree; child files retain content and IDs. |

---

## 9. Conclusion & Next Implementation Steps
This design model upgrades Synapse from independent, fragile socket events to an industry-standard collaborative document model. 

**Immediate next implementation tasks:**
1. Implement `RoomDocManager` in `client/src/services/roomDocManager.js`.
2. Update `server/socket/roomStore.js` to initialize the unified root `Y.Doc`.
3. Integrate `y-protocols/awareness` into `client/src/components/EditorPanel.jsx`.
4. Connect the lease-based lock arbiter into `server/socket/socketManager.js`.
