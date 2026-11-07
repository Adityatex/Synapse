# P2-13 follow-up: profile the latency creep (planned, not run)

**Status:** done on 2026-10-30; results in `2026-10-30-p2-13-profile.md`. The plan below was changed in one way: the profiles were taken over the inspector in two timed windows, instead of with `--cpu-prof`, and a 2-replica run was added, since one replica did not reproduce the creep.

## Question

In the first load test (`2026-10-26-p2-13-local.md`) propagation latency rose steadily during the run: p95 6 ms
in minute 0, 48 ms in minute 9, while the edit rate stayed constant and the rooms grew to about 23,000
characters. The generator was ruled out (its event-loop lag stayed flat with `--workers 5`). The hypothesis,
unproven, is that per-edit work in `collab` grows with the size of the document. What grows?

## Plan

One replica, one room, one generator process: the creep follows document size, so the full 50-editor run is not
needed to see it.

1. Start one replica with the V8 CPU profiler on. It writes its profile on exit, and `apps/collab/src/index.ts`
   exits through `process.exit(0)` on SIGTERM, so a `docker compose stop` is enough. `/tmp` is writable by the
   `node` user; the image's working directory is not.

   ```yaml
   # docker-compose.profile.yml (scratch, not committed)
   services:
     collab:
       environment:
         NODE_OPTIONS: --cpu-prof --cpu-prof-dir=/tmp/prof --cpu-prof-interval=1000
   ```

   ```
   docker compose -f docker-compose.yml -f docker-compose.profile.yml up -d --build mongo redis collab
   ```

2. Run the generator at below-normal priority, so other work on the machine wins:

   ```
   pnpm --filter @synapse/loadtest build
   JWT_SECRET=... MONGODB_URI=mongodb://localhost:27017/synapse \
     node apps/loadtest/dist/index.js --urls ws://localhost:5001 \
     --rooms 1 --workers 1 --editors 10 --rate 5 --duration 600 --warmup 15 \
     --containers synapse-collab-1 --out profile-run.json
   ```

   (Windows: start it with `Start-Process -FilePath node -ArgumentList ... ; (Get-Process node).PriorityClass = 'BelowNormal'`.)

3. `docker compose stop collab`, then `docker cp synapse-collab-1:/tmp/prof ./prof`. Stop the rest of the stack.

4. Read the `.cpuprofile` in Chrome DevTools (Performance, Load profile) or `speedscope`. Compare the first and
   last two minutes: for that, run it twice, once for 2 minutes and once for 10, and diff the self-time of the top
   functions.

## What to look for

- Time in Yjs integration (`findIndexSS`, `getItem`, `Item.integrate`, `ContentString` splits): fragmentation from
  random-position inserts. Expected to grow with the document, and a property of the test more than of the server.
- Time in `touchedFileIds` (room-doc) or the lock check in `beforeHandleMessage`: runs per update. Documented to
  cost the size of the update, so it should be flat.
- Time encoding updates for persistence or awareness, and the Redis extension's publish and receive path.
- Garbage collection share (`--trace-gc` if the profile shows large GC slices).

## Decision it feeds

- If the growth is Yjs internals under random-position inserts: record it as a property of the test, keep the
  result, and make the load test type more like people do (appends and local edits) as a second scenario.
- If it is our code (a per-update walk of the document, a growing buffer, a debounce that rescans): fix it,
  re-run the 10-minute 2-replica test, and replace the result in `2026-10-26-p2-13-local.md`.

## Also still open from the first run

- Memory was not shown flat. A 30 to 60 minute run of one or two rooms, with a heap snapshot at start and end,
  would settle whether it levels off. Run it after this profile, using the same single-replica setup.
