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

Exit code 0 = every check passed, 1 = a check failed (the output says which), 2 = the test could not run.

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
