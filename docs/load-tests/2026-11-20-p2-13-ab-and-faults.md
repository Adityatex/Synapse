# P2-13: the two replica syncs on one build, and faults under load

**Date:** 2026-11-20. **Where:** the same laptop as the earlier P2-13 runs (i5-1240P, 16 logical cores, 31.7 GB,
Windows 11, Docker Desktop 29.9), two `collab` replicas, Mongo 7, Redis 7 and the snapshot worker in containers,
load generators on the host, no other containers running. **Commit:** `68c0f4d` (`feat/P2-13-chaos-ab`), clean
tree, for every run. Raw results, logs and `aggregate.cjs` (which prints every number below):
`2026-11-20-p2-13-runs/`.

Every run: `--urls ws://localhost:5001,ws://localhost:5002 --rooms 5 --workers 5 --editors 10 --rate 5 --duration
600 --warmup 15`, i.e. 50 editors, about 218 edits/s, ten minutes. Before each run both replicas and the worker were
recreated in the mode under test, and the run script checked each replica's `/health` mode (and, for the reruns,
`COLLAB_REDIS_REPAIR_ON_RECONNECT` inside each container). All 13 runs passed: every room's editors, a late
joiner and the stored document agree, 0 lost edits, generator event-loop p99 at most 29 ms.

## A/B: `state-vector` (stock) against `updates` (ours), three runs each, interleaved

Median [range] of three runs. Per-minute figures are the worst of the five generator processes.

| | state-vector (stock) | updates |
|---|---|---|
| p50 over the run | 5.0 [4.8-6.6] ms | 2.5 [2.3-2.5] ms |
| p95 over the run | 19.0 [14.7-54.6] ms | 5.3 [5.1-5.4] ms |
| p99 over the run | 44.4 [26.0-124.0] ms | 7.7 [7.7-8.2] ms |
| max | 415 [131-692] ms | 50 [49-60] ms |
| p95 minute 0 -> minute 9 | 8.1 -> 27.2 ms | 4.3 -> 7.0 ms |
| p95 growth over the run | x3.9 [2.6-16.0] | x1.5 [1.5-1.6] |
| p50 minute 0 -> minute 9 | 3.7 -> 8.2 ms | 2.5 -> 2.4 ms |
| CPU per replica, average | 47% [44-59] | 15% [15-16] |
| CPU per replica, peak | 86% [68-99] | 26% [20-27] |
| memory growth, worst replica | x1.20 [1.19-1.20] | x1.20 [1.18-1.23] |

- The stock growth is real but erratic: x2.6, x3.9 and x16. The x16 run is the one where a replica reached 99% of a
  core, which is the saturation the profile predicts. Earlier numbers (x8 on 2026-10-26, an older build; x7.4 with
  the profiler attached) are steeper because those replicas ran closer to a full core.
- `updates` repeats to within 0.5 ms on p50, p95 and p99. Its p95 still rises a little (4.3 -> 7.0 ms) with p50 flat,
  as on 2026-11-07; not profiled.
- Memory grows about x1.2 in ten minutes with both, so not the sync. A longer soak is still the way to settle it.

## Faults (`--chaos`)

Recovery: time from the fault being lifted until edits are again as fast as before any fault (edits grouped by 100 ms
of send time; normal = slowest arrival at most 3x the pre-fault p99 of those groups, at least 50 ms; 5 s of normal
groups). Median [range] over the faults of a run.

| run | fault | recovery | slowest delayed edit |
|---|---|---|---|
| `fault-dropsub47-updates` | subscriber killed x10, every 47 s | 283 [275-346] ms | 208 [199-211] ms |
| `fault-dropsub47-updates-periodic` | same, ask on reconnect off | 13.0 [2.0-28.0] s | 12.9 [1.9-27.9] s |
| `fault-dropsub47-state-vector` | same, stock sync | 319 [270-1175] ms | 228 [222-259] ms |
| `fault-kill-updates` | collab-2 SIGKILLed at 120 s, started 20.3 s later | 8.8 s after the restart | 29.1 s |

- With both asks, a lost message is repaired about 80 ms after the subscriber is back (ioredis retries after 200 ms).
  That is as fast as the stock sync, which repairs at the next edit's state-vector exchange.
- With only the periodic ask (30 s), repair waits for each document's next ask: spread over the cycle, median about
  T/2, never more than T. The offsets fall 13 s further around the cycle with each 47 s drop, as they should.
- The kill: the last editor reconnected 8.9 s after the restart (the client's back-off is 1 s doubling to 10 s); the
  slowest edit is the outage plus that wait. 56,745 delayed arrivals, 5% of the run's; p95 over the run 6.9 ms.

### A first fault series that does not count

`fault-dropsub-*` dropped the subscriber every 60 s from 60 s. That is a multiple of the 30 s repair interval, and a
document's periodic ask runs on a fixed cycle from when it was loaded, which is about when typing starts, so every
drop fell just before an ask. Even with the ask on reconnect off, every loss then looked repaired in 0.3 to 0.4 s. A
diagnostic run with one room and the flag checked inside the containers showed the periodic ask repairing 10 s after
a drop at 20 s, and the 47 s series confirms it. The 60 s results are kept in the folder but not used. The load
test's README now says to keep `everySec` off multiples of the repair interval.

## Reproduce

```
COLLAB_REDIS_SYNC=state-vector docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d --force-recreate --no-deps collab collab-2 worker
JWT_SECRET=... MONGODB_URI=mongodb://localhost:27017/synapse node apps/loadtest/dist/index.js <the options above> \
  --containers synapse-collab-1,synapse-collab-2-1 [--chaos dropsub:synapse-collab-1:50:47:10] --out run.json
node docs/load-tests/2026-11-20-p2-13-runs/aggregate.cjs docs/load-tests/2026-11-20-p2-13-runs
```

`COLLAB_REDIS_REPAIR_ON_RECONNECT=false` on the same `up` turns the ask on reconnect off.
