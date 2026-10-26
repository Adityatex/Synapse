# Synapse — Architecture

> Phase 1 (Foundation) snapshot. Monorepo: pnpm workspaces + Turborepo;
> shared zod contracts; incremental TypeScript; Docker Compose local stack;
> Fly.io staging with auto-deploy from `main`.

## 1. Layout

```
Synapse/
├── packages/shared/        # @synapse/shared — zod contracts + TS types (P1-04)
│   └── src/{http,socket,envelope}.ts
├── packages/redis/         # @synapse/redis — ioredis factory + health check (P2-02)
├── packages/room-doc/      # @synapse/room-doc — file tree + text in one Y.Doc: ops, tree resolution, seeding (P2-06)
├── packages/ydoc-store/    # @synapse/ydoc-store — Mongo persistence for room docs + the compaction queue (P2-04, P2-05)
├── apps/worker/            # @synapse/worker — BullMQ worker: snapshots and prunes room updates (P2-05)
├── apps/collab/            # @synapse/collab — Hocuspocus server, one Y.Doc per room (P2-03)
│   └── src/{server,auth,roomAccess,docStore,config}.ts
├── server/                 # Express 5 + Socket.IO API (CJS runtime, P1-02 incremental TS)
│   ├── config/env.js       # boot-time zod env validation (P0-06)
│   ├── lib/{logger,errors,sentry}.js
│   ├── middleware/{auth,rateLimits,requestId,validate}.js
│   ├── routes/{auth,execute,ai,rooms}.js
│   ├── socket/{socketManager,roomStore}.js
│   └── tests/{*.test.js (node), vitest/**, harness/**}
├── client/                 # React 19 + Vite (incremental TS, P1-03)
│   └── src/{stores/roomUiStore.ts, hooks/useRoom*, config/apiConfig.ts, ...}
├── docker-compose.yml      # local dev: api + mongo + redis + mailpit (P1-06)
├── fly.staging.toml        # staging app (P1-07)
└── docs/{ARCHITECTURE,CONTRIBUTING}.md
```

Workspace wiring: `pnpm-workspace.yaml` declares `server`, `client`,
`packages/*`; `server` depends on `@synapse/shared` via `workspace:*`.
Orchestration: `turbo.json` (`build` → `typecheck` → `test`).

## 2. Request lifecycle (server)

```
client → helmet → requestId → pino-http → cors → express.json(1mb)
  → globalLimiter → route limiters → validateBody(shared schema)
  → authMiddleware (where required) → handler → logger + Sentry
```

- **Correlation**: `middleware/requestId.js` sets `req.id` + `X-Request-Id`;
  every error envelope carries `requestId` (P0-07).
- **Validation** (P1-05): `validateBody('<schema>')` runs after rate
  limiters; failures return `400 { success:false, error:{message,code,details}, requestId }`
  without touching handlers. Sockets use `validateSocketPayload(...)` with
  the same contracts; invalid payloads are dropped / answered with
  `room-error`. Payload identity is never trusted (P0-03) — JWT only.
- **Envelope** (P1-08): `lib/errors.js` provides `AppError`
  (`badRequest/unauthorized/forbidden/notFound/conflict/tooMany`),
  `ok(res, req, data)` and `fail(res, req, err)`, plus `asyncHandler`.
  New code uses the envelope; legacy success shapes are kept until the
  client migrates route-by-route (each migration: server sends
  `{success:true,data}`, client reads `.data`, covered by contract tests).

## 3. Auth + rooms

- OTP signup/login (`routes/auth.js`): bcrypt(password,12) → hashed OTP
  records (`sha256`, expiry + attempt cap) → JWT 7d. Rate limits per
  email/IP (P0-02).
- Rooms: `roomStore` (in-memory Yjs docs + participants) + `Room` Mongo
  doc (files, members, versions). **Invite-only** (P0-16): creator is the
  first member; `POST /:roomId/invite` (creator-only) adds members;
  HTTP `GET /:roomId` and socket `join-room` deny non-members
  (`403` / `room-error`); legacy member-less rooms are grandfathered once.
- File locks (45s TTL, heartbeat) are checked on `code-change` against
  `socket.data.user.userId`.

## 4. Realtime

`socketManager` (JWT handshake → `socket.data.user`): `join-room`,
`code-change` (Yjs base64 updates via `applyDocumentUpdate`), presence
(`cursor-move`, `selection-change`), chat (CRUD + reactions + escaped
regex search), locks, `sync-room-state`/`autosave`/`save-version`.
Client `RoomYjsManager` binds `Y.Text` per file; `EditorPanel` lazy-loads
Monaco (P1-11).

### 4.1 Collab persistence (P2-03, P2-04)

`apps/collab` is the target replacement for the relay above (cut over in P2-06).
One Y.Doc per room, persisted in two collections:

- `ydoc_updates { roomId, seq, update, createdAt }` — append-only Yjs diffs.
  Each write is the change since this process last persisted that room, not
  the whole document.
- `ydoc_snapshots { roomId, seq, state, createdAt }` — merged state through
  `seq`. Load = newest snapshot + updates after it.

Invariants (see `apps/collab/src/mongoDocStore.ts`): committed seqs per room
are contiguous (writers insert highest+1; the unique index rejects a collision
and they retry), a snapshot at N contains every update <= N, and Yjs updates
are idempotent, so duplicate writes from two replicas are harmless. A load
that sees a gap throws rather than return partial data. Snapshotting and
pruning (`writeSnapshot`, `pruneCoveredUpdates`) are run by the worker (below).

**Compaction (P2-05).** After each appended update, collab tells a scheduler how
many updates sit on top of the newest snapshot. At 500 it enqueues a
`compact-now` job on the BullMQ queue `ydoc-snapshot` (Redis); otherwise it keeps
one delayed `compact` job per room, 5 minutes after the first un-compacted
update. Job ids are fixed per room, so repeated enqueues collapse into one. The
worker (`apps/worker`) snapshots what is new and deletes the updates the
snapshot covers, retrying up to 3 times with exponential backoff; failures are
kept (last 100) until the dead-letter queue and Bull Board arrive in P4-01.
Compaction is idempotent and safe against concurrent writers, so the queue only
needs to be at-least-once. Tunables: `SNAPSHOT_UPDATES_THRESHOLD`,
`SNAPSHOT_DELAY_MS` (collab), `SNAPSHOT_CONCURRENCY` (worker). Without
`REDIS_URL` collab still runs but never compacts.
Soak result: 3000 edits from two simulated replicas peaked at 501 updates in the
collection (limit 1000) with 5 compactions.

Durability window: edits are persisted 2 s after the last change (10 s max
under continuous typing) and on last disconnect / graceful shutdown. A
hard-killed process can lose at most that window server-side.

### 4.2 Room document model (P2-06)

`@synapse/room-doc` defines what is inside a room's Y.Doc: `files`
(Y.Map of fileId to a node map: name, type `file|folder`, parentId, order,
timestamps, `deletedAt`) and one `content:<fileId>` Y.Text per file. Tabs, the
active file and folder open/closed state are per-user UI and are not shared.

Concurrent edits are resolved by `listNodes`, a pure function of the document,
so every client sees the same tree: deleted nodes and everything under a
deleted folder are hidden (a delete is a tombstone; the text is kept); a node
whose parent is missing becomes root-level; if two users move folders into each
other the member with the smallest id is lifted to the root, so nothing
disappears. Siblings sort by `order` then id, so ties are stable. Deviations
from the P2-01 design doc: nodes use `folder` (not `directory`) to match the
existing UI, and file text is a top-level `content:<fileId>` Y.Text as in the
roadmap rather than nested in the node map.

Rooms that existed before collab are seeded on first load: with no stored
document, collab builds one from `Room.files` using a fixed Yjs client id, so
replicas that seed the same room at the same moment merge into one copy.

### 4.3 Presence (P2-07)

In collab mode presence is Yjs awareness on the room's connection, not Socket.IO,
so it follows the document across replicas through the same Redis channel and is
never persisted. A client publishes `fileId` (the file it has open), `typing`
(true from a keystroke to about two seconds of quiet) and `selection` (written by
y-monaco as Yjs relative positions, so a cursor follows concurrent edits).

Awareness is written by clients, so the collab server rewrites every update in
`beforeHandleAwareness` (`apps/collab/src/presence.ts`) before relaying it:

- `user` (id, name, colour, glyph) is stamped from the verified token. A client
  cannot appear as someone else, whatever it sends.
- Only known fields of the expected shape and size survive. A malformed relative
  position is dropped, since it would throw inside every peer's editor.
- A connection can only speak for its own awareness client id.

Colour and avatar glyph are derived from the user id (`colorForUser` in
`@synapse/room-doc`), so nothing about a participant is kept per room and the same
person has the same colour everywhere. The price is that two people in a room can
share a colour (12-colour palette); the name flag on each cursor tells them apart.
The legacy relay's `userAppearance` map is gone, and `server/tests/vitest/appearance.test.js`
checks that the relay and the collab path agree. Clients also re-derive the colour
and strip the name to CSS-safe characters before putting either into a stylesheet.

## 5. Client state

- Server state: `context/FileContext` (files/tabs) + `context/AuthContext`.
- Session chrome: Zustand `stores/roomUiStore.ts` (theme, output,
  connection, load/error, room name, copy/lock notices) + focused hooks
  (`hooks/useRoomTheme|useLockNotice|useInviteLink`) (P1-10).
- Code splitting (P1-11): all pages `React.lazy` + `Suspense`; Monaco
  lazy inside `EditorPanel`.

### 5.1 Collab mode (P2-06)

The room page has two paths, chosen at build time by `VITE_COLLAB_URL`:

- **unset (default)**: the legacy Socket.IO relay, unchanged.
- **set** (e.g. `ws://localhost:5001`): `useRoomCollab` connects to `apps/collab`
  and `CollabFileProvider` replaces `FileProvider`. It exposes the same
  `useFiles()` interface, backed by the room's Y.Doc through `@synapse/room-doc`,
  so Sidebar, TabBar, Toolbar and Neura are unchanged. Monaco binds to the file's
  shared `Y.Text`. Tabs, the active file and open folders are per-user.

In collab mode Socket.IO still carries chat and `save-version`; the people list,
the "is editing" bar and remote cursors come from awareness (section 4.3). Not used: `code-change`, `sync-room-state`, `autosave` and file
locks (P2-08 brings locks back as an optional per-room setting). The flag is global
per client build until P2-10 adds a per-room one, so do not run old and new clients
against the same rooms.

Run it locally: `docker compose up -d --build` (starts `collab` on :5001), put
`VITE_COLLAB_URL=ws://localhost:5001` in `client/.env.local`, then `pnpm dev`.

## 6. TypeScript plan (P1-02 / P1-03)

- `packages/shared` is fully TS (source of truth for payloads).
- Server: `tsconfig.json` (`allowJs`, `checkJs:false` today → strict
  per-file later), `typecheck` script, `tsx` for running TS in dev
  (`dev:tsx`). New logic prefers JSDoc-typed JS or shared-schema
  validation; ESM cutover is deferred (CJS `require` stays until all
  call sites migrate — tracked per file, tests guard each step).
- Client: `tsconfig.json` + `vite-env.d.ts`; new modules are `.ts`
  (`config/apiConfig.ts`, stores, hooks); `.jsx` → `.tsx` file-by-file.

## 7. Environments

| Env | Backend | Frontend | DB |
|---|---|---|---|
| local (compose) | `api:5000` | vite `:5173` | `mongo:27017/synapse`, redis, mailpit `:8025` |
| demo (`docker-compose.demo.yml`) | prod image `:8080` + Cloudflare quick tunnel | served by the API | Atlas |
| staging | _paused_ — planned `synapse-staging.fly.dev` | — | Atlas staging |
| prod | Fly.io (`fly.toml`, ready, not yet created) | served by the API | Atlas |

Hosting is paused: only the local compose stack runs. Render and Vercel were
retired. At the deploy phase, `staging.yml` (deploys only after CI passes,
then smoke-tests `/api/health`) and `uptime.yml` get their triggers back.

## 8. Testing (P1-09)

- `node --test tests/*.test.js`: P0 regressions, contracts, validation,
  envelope (no DB, fast).
- `vitest run` (`tests/vitest/`): `mongodb-memory-server` + real models
  (`db.room`) and real socket server + authed clients (`socket.join-guard`).
- Harnesses: `tests/harness/db.js` (start/clear/stop memory mongo),
  `tests/harness/sockets.js` (ephemeral-port server + JWT clients).
- Models use `mongoose.models.X || model(...)` so vitest module
  re-evaluation never throws `OverwriteModelError`.
