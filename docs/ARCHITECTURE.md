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
pruning (`writeSnapshot`, `pruneCoveredUpdates`) exist but are scheduled by
the worker in P2-05; until then `ydoc_updates` grows unbounded.

Durability window: edits are persisted 2 s after the last change (10 s max
under continuous typing) and on last disconnect / graceful shutdown. A
hard-killed process can lose at most that window server-side.

## 5. Client state

- Server state: `context/FileContext` (files/tabs) + `context/AuthContext`.
- Session chrome: Zustand `stores/roomUiStore.ts` (theme, output,
  connection, load/error, room name, copy/lock notices) + focused hooks
  (`hooks/useRoomTheme|useLockNotice|useInviteLink`) (P1-10).
- Code splitting (P1-11): all pages `React.lazy` + `Suspense`; Monaco
  lazy inside `EditorPanel`.

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
