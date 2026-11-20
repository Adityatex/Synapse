# @synapse/loadtest

Load test for the collab server (roadmap P2-13). It runs N editors in M rooms, typing into one shared file,
spread over several collab replicas, and reports:

- **propagation latency**: how long each edit takes to reach every other editor in its room (p50, p95, p99, max,
  and per minute, so a drift over the run is visible);
- **divergence**: at the end every editor must hold the same text, no edit may be missing (each editor's Yjs
  clock for every author must equal the inserts that author made), a client that connects afterwards must get
  the same text, and the document the server stored must load to it too;
- **memory** of each replica, sampled from its `/health` endpoint every 10 s, and whether it stays flat;
- optionally the replicas' **CPU** (`--containers`, local Docker runs only).

It also watches its own event loop. If the generator is starved, the latencies it prints are its own, so the run
fails ("the load generator was saturated"). One Node process stops keeping up at a few hundred edits a second;
`--workers` splits the rooms over several processes.

## Run it

Two replicas next to the dev stack:

```
docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d --build collab collab-2
pnpm --filter @synapse/loadtest build
JWT_SECRET=... MONGODB_URI=mongodb://localhost:27017/synapse \
  node apps/loadtest/dist/index.js --urls ws://localhost:5001,ws://localhost:5002 \
  --rooms 5 --workers 5 --editors 10 --rate 5 --duration 600 \
  --containers synapse-collab-1,synapse-collab-2-1 --out result.json
```

Against another environment, point `--urls` at its replicas (each one directly, not through a balancer, so that
every room spans replicas) and give the test the same `JWT_SECRET` and a `MONGODB_URI` it may write to. The
test signs its own tokens and creates its own rooms (`LT...` ids, synthetic members), and deletes them, and
their stored documents, when it ends (`--keep` leaves them).

| option | default | |
|---|---|---|
| `--urls` | `ws://localhost:5001` | comma-separated replica URLs; editor *e* of every room connects to replica *e* mod n |
| `--rooms`, `--editors`, `--rate` | 5, 10, 5 | rooms, editors per room, edits per second per editor |
| `--duration`, `--warmup` | 600, 15 | seconds of typing; seconds left out of the latency figures |
| `--workers` | 1 | processes to spread the rooms over (use one per room or two) |
| `--p95-limit` | 200 | ms; the run fails above it |
| `--memory-growth-limit` | 1.25 | last quarter of the memory samples over the first quarter |
| `--containers` | none | Docker container names whose CPU is sampled |
| `--out` | none | write the full result as JSON |
| `--chaos` | none | faults to inject, comma-separated (below) |
| `--redis-container` | `synapse-redis-1` | the Redis container, for `dropsub` faults |

Exit code 0 = every check passed, 1 = a check failed (the output says which), 2 = the test could not run.

## Comparing the two replica syncs

The collab server can run either replica sync, chosen per container by `COLLAB_REDIS_SYNC`: `updates` (the
default, `apps/collab/src/redisSync.ts`) or `state-vector` (the stock Hocuspocus extension). Same build, one
variable, so a before/after comparison measures only the protocol:

```
COLLAB_REDIS_SYNC=state-vector docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d --force-recreate collab collab-2
```

Each replica reports its mode on `/health`, the result records it (`redisSync`), and a run whose replicas
disagree fails. `COLLAB_REDIS_REPAIR_MS` (default 30000) and `COLLAB_REDIS_REPAIR_ON_RECONNECT` (default
`true`) pass through the same way.

## Faults (`--chaos`)

Times are seconds after typing starts; each fault must end at least 20 s before the run does.

- `kill:<container>:<atSec>:<downSec>`: `docker kill` a replica (SIGKILL, nothing flushed) and `docker start` it
  `downSec` later. Its editors keep typing offline and reconnect with the real client's back-off (1 s to 10 s).
- `dropsub:<container>:<atSec>[:<everySec>:<times>]`: kill that replica's Redis subscriber connection
  (`CLIENT KILL`). The replica and its editors stay up; what the others publish until the subscriber is back is
  lost to it, which is the loss the repair exists for.

```
--chaos kill:synapse-collab-2-1:120:20
--chaos dropsub:synapse-collab-1:60:60:8
```

A run with faults must still converge with no lost edit. Disconnects are expected, and latency and memory are
reported but not judged. For each fault it reports how long after the fault was lifted edits again arrived as fast
as before any fault (edits grouped by 100 ms of send time; a group is normal when its slowest arrival is at most 3x
the p99 of the groups before the first fault, and recovery needs 5 s of normal groups), the slowest edit it delayed,
and, for a kill, when the last editor reconnected. The JSON has the whole send-time series (`latencyBySend`) for
plotting.

## What an edit is

Each editor makes one edit about every `1/rate` seconds (jittered): 90% insert one character at a random
position, 10% delete one. That is rougher than a person typing (random positions fragment the document
more), and `rate` is per editor, so the roadmap's "10 editors x 5 rooms at 5 ops/s" is about 250 edits a second.
Latency is timed for inserts only; deletes still load the server and are checked for divergence.

## How latency is measured

All editors run in the generator's processes, so there is one clock per process. A sender records the Yjs id
(client, clock) of each character it inserts and the time. When another editor's document applies an update from
the server, the structs in it name the ids that arrived; the difference is that edit's latency to that
receiver. Edits batched into one update are timed one by one, and an id is counted once per receiver. The
generator's own event-loop delay is included in what it measures, which is why it is monitored.
