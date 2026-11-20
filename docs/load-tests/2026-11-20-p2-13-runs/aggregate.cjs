// The paper's numbers from this folder's run results: node aggregate.cjs <this folder>
// A/B: median [range] of the three runs per protocol; per-minute values are the worst of the five generator processes.
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
const load = (name) => {
  const file = path.join(dir, `${name}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const f1 = (x) => x.toFixed(1);
const stat = (xs, fmt = f1) => `${fmt(median(xs))} [${fmt(Math.min(...xs))}-${fmt(Math.max(...xs))}]`;

function digest(r) {
  const c = r.combined;
  const w = r.workers.filter(Boolean);
  // Per minute: the worst of the generator processes (an upper bound, as the combined p95 is).
  const perMin = (k) => Array.from({ length: 10 }, (_, i) => Math.max(...w.map((x) => x.latencyByMinute.find((m) => m.minute === i)?.[k] ?? -Infinity)));
  const cpu = w[0].serverCpuPercent;
  return {
    mode: c.redisSync,
    rate: c.edits / 600,
    edits: c.edits,
    arrivals: c.arrivals,
    p50: c.p50WorstWorkerMs,
    p95: c.p95WorstWorkerMs,
    p99: c.p99WorstWorkerMs,
    max: c.maxMs,
    p95m: perMin('p95'),
    p50m: perMin('p50'),
    cpuAvg: cpu.reduce((n, x) => n + x.avg, 0) / cpu.length,
    cpuPeak: Math.max(...cpu.map((x) => x.max)),
    mem: c.memoryGrowthWorst,
    gen: c.generatorLoopP99WorstMs,
    lost: w.flatMap((x) => x.rooms).reduce((n, room) => n + room.lostEdits, 0),
    divergent: w.flatMap((x) => x.rooms).filter((room) => !room.editorsAgree || !room.verifierAgrees || !room.storedAgrees).length,
    chars: Math.round(median(w.flatMap((x) => x.rooms).map((room) => room.characters))),
    passed: r.passed,
    chaos: c.chaos,
  };
}

for (const mode of ['state-vector', 'updates']) {
  const runs = [1, 2, 3].map((i) => load(`ab-${mode}-${i}`)).filter(Boolean).map(digest);
  if (!runs.length) continue;
  console.log(`\n== A/B ${mode}: ${runs.length} run(s), all passed: ${runs.every((r) => r.passed)}`);
  for (const [i, r] of runs.entries()) {
    console.log(`  run ${i + 1}: ${f1(r.rate)}/s p50 ${f1(r.p50)} p95 ${f1(r.p95)} p99 ${f1(r.p99)} max ${f1(r.max)} | p95 m0 ${f1(r.p95m[0])} m9 ${f1(r.p95m[9])} (x${(r.p95m[9] / r.p95m[0]).toFixed(1)}) | p50 m0 ${f1(r.p50m[0])} m9 ${f1(r.p50m[9])} | cpu ${f1(r.cpuAvg)} peak ${f1(r.cpuPeak)} | mem x${r.mem.toFixed(2)} | lost ${r.lost} divergent ${r.divergent} | chars ${r.chars} | gen ${f1(r.gen)}`);
  }
  const all = (k) => runs.map((r) => r[k]);
  console.log(`  median [range]: rate ${stat(all('rate'), (x) => x.toFixed(0))} edits ${stat(all('edits'), (x) => x.toFixed(0))} arrivals ${stat(all('arrivals'), (x) => (x / 1e6).toFixed(2) + 'M')}`);
  console.log(`  p50 ${stat(all('p50'))} p95 ${stat(all('p95'))} p99 ${stat(all('p99'))} max ${stat(all('max'))}`);
  console.log(`  p95 minute 0 ${stat(runs.map((r) => r.p95m[0]))} minute 9 ${stat(runs.map((r) => r.p95m[9]))} ratio ${stat(runs.map((r) => r.p95m[9] / r.p95m[0]))}`);
  console.log(`  p50 minute 0 ${stat(runs.map((r) => r.p50m[0]))} minute 9 ${stat(runs.map((r) => r.p50m[9]))}`);
  console.log(`  cpu avg ${stat(all('cpuAvg'), (x) => x.toFixed(0))} peak ${stat(all('cpuPeak'), (x) => x.toFixed(0))} mem ${stat(all('mem'), (x) => x.toFixed(2))} gen ${stat(all('gen'))}`);
  console.log(`  figure (median, min, max of per-minute p95):`);
  for (let m = 0; m < 10; m++) {
    const xs = runs.map((r) => r.p95m[m]);
    console.log(`    (${m},${f1(median(xs))}) +- (0,${f1(Math.max(...xs) - median(xs))}) -= (0,${f1(median(xs) - Math.min(...xs))})`);
  }
  console.log(`  per-minute p95 range over the run (each run): ${runs.map((r) => `${f1(Math.min(...r.p95m))}-${f1(Math.max(...r.p95m))}`).join(', ')}`);
}

// fault-dropsub-* (every 60 s from 60 s) are kept for the record: those drops were in phase with the 30 s repair ask.
const faultRuns = ['fault-dropsub47-updates', 'fault-dropsub47-updates-periodic', 'fault-dropsub47-state-vector', 'fault-kill-updates', 'fault-dropsub-updates', 'fault-dropsub-updates-periodic', 'fault-dropsub-state-vector'];
for (const name of faultRuns) {
  const r = load(name);
  if (!r) continue;
  const d = digest(r);
  const faults = d.chaos?.faults ?? [];
  console.log(`\n== ${name}: sync ${d.mode}, passed ${d.passed}, lost ${d.lost}, divergent ${d.divergent}, ${f1(d.rate)}/s, p50 ${f1(d.p50)} p95 ${f1(d.p95)} p99 ${f1(d.p99)} max ${f1(d.max)}, normal <= ${f1(d.chaos?.normalBucketMaxMs ?? NaN)} ms`);
  for (const x of faults) {
    console.log(`  ${x.kind} conns ${x.killedConnections ?? '-'} down ${x.kind === 'kill' ? f1((x.endMs - x.startMs) / 1000) + 's' : '-'} recovery ${x.recoveryMs === null ? 'NEVER' : f1(x.recoveryMs)} worst ${f1(x.worstLatencyMs)} affected ${x.affectedArrivals}${x.lastReconnectMs !== undefined ? ` lastReconnect ${f1(x.lastReconnectMs)}` : ''}${x.error ? ` ERR ${x.error}` : ''}`);
  }
  const rec = faults.filter((x) => x.recoveryMs !== null).map((x) => x.recoveryMs);
  if (rec.length) console.log(`  recovery median [range] ${stat(rec, (x) => x.toFixed(0))} ms; worst delayed edit median [range] ${stat(faults.map((x) => x.worstLatencyMs), (x) => x.toFixed(0))} ms; affected total ${faults.reduce((n, x) => n + x.affectedArrivals, 0)}`);
}
