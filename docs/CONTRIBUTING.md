# Contributing to Synapse

## Prereqs

- Node 20+, `pnpm@10` (`npm i -g pnpm@10`), Docker (for compose), MongoDB URI for non-Docker runs.

## Quick start

```bash
pnpm install
pnpm --filter @synapse/shared build
# local dev (turbo): api + client with hot reload
pnpm dev
# …or full local stack (api + mongo + redis + mailpit):
docker compose up
# client: http://localhost:5173  api health: http://localhost:5000/api/health
# mailpit UI (OTP catcher): http://localhost:8025
```

Copy env templates first: `server/.env.example → server/.env`,
`client/.env.example → client/.env`. Boot fails fast on bad env
(`server/config/env.js`) — read the error, it names the key.

## Turborepo tasks

```bash
pnpm build      # shared contracts first, then apps
pnpm typecheck  # tsc --noEmit per workspace
pnpm test       # node:test suites + vitest (memory mongo + sockets)
pnpm lint
```

Run a single workspace: `pnpm --filter server test:vitest`,
`pnpm --filter client build`, etc.

## Adding/changing an API or socket event

1. **Contract first**: edit `packages/shared/src/http.ts` or `socket.ts`,
   rebuild (`pnpm --filter @synapse/shared build`).
2. **Server**: add `validateBody('<schema>')` to the route or
   `validateSocketPayload('<schema>', payload)` to the handler.
   Use `AppError` + `ok()`/`fail()` from `server/lib/errors.js`.
3. **Tests**: extend `server/tests/validate-errors.test.js` or
   `contracts.test.js`; DB/socket behavior goes in `tests/vitest/`
   using `tests/harness/{db,sockets}.js`.
4. **Client**: new modules in TypeScript (`.ts`/hooks/stores); keep
   payload shapes aligned with the shared schema.

## TypeScript migration rules (P1-02/P1-03)

- New shared code: TypeScript, no exceptions.
- New client code: TypeScript. Migrating a `.jsx` file: rename, type
  props, run `pnpm --filter client typecheck`, keep behavior identical.
- Server: JSDoc types on new JS or shared-schema validation; do not flip
  `require` → `import` piecemeal (ESM cutover happens as one tracked step).

## Rooms/invite-only

Only creator/members may join (`isRoomMember` + socket guard). To test
invites locally: create room as A, `POST /api/rooms/:id/invite`
`{ "email": "<B's email>" }` as A, then join as B.

## CI / staging

- PRs run CI (build + typecheck + all tests). Keep it green.
- `main` auto-deploys to staging (`fly.staging.toml`, workflow
  `staging.yml`) after CI passes + health smoke test.
