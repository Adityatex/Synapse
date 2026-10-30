import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { MongoDocStore } from '@synapse/ydoc-store';
import jwt from 'jsonwebtoken';
import { MongoClient } from 'mongodb';
import * as Y from 'yjs';
import { PropagationTracker, summarize, trend, type LatencySummary, type Trend } from './stats.js';

/**
 * Load test for the collab server (P2-13).
 *
 *   JWT_SECRET=... MONGODB_URI=... node dist/index.js --urls ws://a:5001,ws://b:5001 \
 *     --rooms 5 --editors 10 --rate 5 --duration 600
 *
 * Every room gets `--editors` editors typing `--rate` edits a second into one shared file, spread
 * over the replicas in `--urls` so each room has editors on different ones. It measures how long
 * each edit takes to reach every other editor, then checks that nothing diverged or was lost, and
 * watches each replica's memory through its /health endpoint.
 *
 * `--workers N` splits the rooms over N processes (each runs the whole test for its rooms and the results are
 * combined): a single Node process stops being able to keep up with a few hundred edits a second, and then
 * it is the generator that is slow, not the server.
 *
 * `--containers a,b` also samples those Docker containers' CPU (a local run's servers). The tool also watches
 * its own event loop: if the generator is saturated, its latencies are not the server's, and the run fails.
 *
 * The rooms are created in Mongo (members are synthetic users) and removed afterwards.
 */

interface Config {
  urls: string[];
  rooms: number;
  editors: number;
  rate: number;
  durationSec: number;
  warmupSec: number;
  p95LimitMs: number;
  memoryGrowthLimit: number;
  out?: string;
  /** Processes to spread the rooms over. One process cannot drive hundreds of edits a second without becoming the bottleneck. */
  workers: number;
  /** Set on the processes a parent started. */
  child: boolean;
  /** Docker container names whose CPU is sampled (local runs only). */
  containers: string[];
  keep: boolean;
  jwtSecret: string;
  mongoUri: string;
}

function parseArgs(argv: string[]): Config {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const num = (name: string, fallback: number) => {
    const raw = get(name);
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
    return value;
  };
  const jwtSecret = process.env.JWT_SECRET;
  const mongoUri = process.env.MONGODB_URI;
  if (!jwtSecret || !mongoUri) throw new Error('JWT_SECRET and MONGODB_URI must be set (the test signs its own tokens and creates its own rooms).');
  const urls = (get('urls') ?? 'ws://localhost:5001').split(',').map((u) => u.trim()).filter(Boolean);
  return {
    urls,
    rooms: num('rooms', 5),
    editors: num('editors', 10),
    rate: num('rate', 5),
    durationSec: num('duration', 600),
    warmupSec: num('warmup', 15),
    p95LimitMs: num('p95-limit', 200),
    memoryGrowthLimit: num('memory-growth-limit', 1.25),
    out: get('out'),
    workers: Math.min(num('workers', 1), num('rooms', 5)),
    child: argv.includes('--child'),
    containers: (get('containers') ?? '').split(',').map((c) => c.trim()).filter(Boolean),
    keep: argv.includes('--keep'),
    jwtSecret,
    mongoUri,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hashOf = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const healthUrl = (wsUrl: string) => `${wsUrl.replace(/^ws/, 'http').replace(/\/+$/, '')}/health`;
const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : 'n/a');

interface Editor {
  room: number;
  userId: string;
  doc: Y.Doc;
  provider: HocuspocusProvider;
  text: Y.Text;
  inserts: number;
}

async function waitUntil(check: () => boolean, timeoutMs: number, pollMs = 100): Promise<boolean> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) return false;
    await sleep(pollMs);
  }
  return true;
}

interface RoomReport {
  room: string;
  editors: number;
  characters: number;
  hashes: string[];
  editorsAgree: boolean;
  lostEdits: number;
  verifierAgrees: boolean;
  storedAgrees: boolean;
}

interface MemorySample {
  at: number;
  replica: string;
  rssMb: number;
  heapUsedMb: number;
}

/** Rooms per worker, as evenly as possible. */
const share = (rooms: number, workers: number) => Array.from({ length: workers }, (_, i) => Math.floor(rooms / workers) + (i < rooms % workers ? 1 : 0));

/** argv without the given "--flag value" pairs. */
function without(argv: string[], flags: string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (flags.includes(argv[i])) i++;
    else kept.push(argv[i]);
  }
  return kept;
}

interface WorkerResult {
  edits: number;
  latencyMs: LatencySummary;
  generatorLoopP99Ms: number;
  memory: Array<{ replica: string; trend: Trend | null }>;
  problems: string[];
  passed: boolean;
}

/** Runs this same test in several processes and combines what they report. */
async function runWorkers(config: Config, argv: string[]): Promise<number> {
  const rooms = share(config.rooms, config.workers);
  const dir = mkdtempSync(join(tmpdir(), 'loadtest-'));
  const script = fileURLToPath(import.meta.url);
  console.log(`Starting ${rooms.length} workers with ${rooms.join(' + ')} rooms.`);
  const exits = await Promise.all(
    rooms.map(
      (count, i) =>
        new Promise<number>((resolve) => {
          const args = [script, ...without(argv, ['--workers', '--rooms', '--out']), '--rooms', String(count), '--out', join(dir, `w${i}.json`), '--child'];
          const child = spawn(process.execPath, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
          const relay = (stream: NodeJS.ReadableStream) => {
            let pending = '';
            stream.on('data', (chunk: Buffer) => {
              const lines = (pending + chunk.toString()).split('\n');
              pending = lines.pop() ?? '';
              // Only the progress lines: each worker's own summary is folded into the combined one.
              for (const line of lines) if (/^\[\d+s\]|connected and synced|Typing stopped/.test(line)) console.log(`[w${i + 1}] ${line}`);
            });
          };
          relay(child.stdout);
          relay(child.stderr);
          child.on('exit', (code) => resolve(code ?? 2));
        }),
    ),
  );

  const results: Array<WorkerResult | null> = rooms.map((_, i) => {
    try {
      return JSON.parse(readFileSync(join(dir, `w${i}.json`), 'utf8')) as WorkerResult;
    } catch {
      return null;
    }
  });
  const problems = results.flatMap((r, i) => (r ? r.problems.map((p) => `worker ${i + 1}: ${p}`) : [`worker ${i + 1}: no result (exit code ${exits[i]})`]));
  const done = results.filter((r): r is WorkerResult => r !== null);
  const worst = (pick: (r: WorkerResult) => number) => Math.max(...done.map(pick));
  const combined = {
    workers: rooms.length,
    edits: done.reduce((n, r) => n + r.edits, 0),
    arrivals: done.reduce((n, r) => n + r.latencyMs.count, 0),
    // The combined p95 is never worse than the worst worker's p95, so this is an upper bound.
    p50WorstWorkerMs: worst((r) => r.latencyMs.p50),
    p95WorstWorkerMs: worst((r) => r.latencyMs.p95),
    p99WorstWorkerMs: worst((r) => r.latencyMs.p99),
    maxMs: worst((r) => r.latencyMs.max),
    generatorLoopP99WorstMs: worst((r) => r.generatorLoopP99Ms),
    memoryGrowthWorst: Math.max(...done.flatMap((r) => r.memory.map((m) => m.trend?.ratio ?? 1))),
  };
  console.log('\n=== Combined result ===');
  console.log(`${combined.workers} workers, ${combined.edits} edits (${(combined.edits / config.durationSec).toFixed(0)}/s), ${combined.arrivals} timed arrivals`);
  console.log(`propagation, worst worker: p50 ${fmt(combined.p50WorstWorkerMs)} ms, p95 ${fmt(combined.p95WorstWorkerMs)} ms (an upper bound for the whole), p99 ${fmt(combined.p99WorstWorkerMs)} ms, max ${fmt(combined.maxMs)} ms`);
  console.log(`generator event loop lag p99, worst worker: ${fmt(combined.generatorLoopP99WorstMs)} ms; memory growth, worst replica seen by any worker: x${combined.memoryGrowthWorst.toFixed(2)}`);
  const passed = problems.length === 0 && exits.every((c) => c === 0);
  console.log(passed ? '\nPASS' : `\nFAIL\n- ${problems.join('\n- ')}`);
  if (config.out) writeFileSync(config.out, JSON.stringify({ combined, workers: results, passed, problems }, null, 2));
  return passed ? 0 : 1;
}

async function main(): Promise<number> {
  const config = parseArgs(process.argv.slice(2));
  if (config.workers > 1 && !config.child) return runWorkers(config, process.argv.slice(2));
  const { urls, rooms: roomCount, editors: editorCount } = config;
  const runTag = Math.random().toString(36).slice(2, 6).toUpperCase();
  const roomIds = Array.from({ length: roomCount }, (_, r) => `LT${runTag}${r}`);
  const userIds = Array.from({ length: editorCount }, (_, i) => `lt-user-${i + 1}`);
  const tokenFor = (userId: string) => jwt.sign({ userId, name: userId, email: `${userId}@loadtest.invalid` }, config.jwtSecret, { expiresIn: '3h' });

  console.log(`Load test: ${roomCount} rooms x ${editorCount} editors x ${config.rate} edits/s for ${config.durationSec}s across ${urls.length} replica(s): ${urls.join(', ')}`);

  const mongo = await new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 10_000 }).connect();
  const db = mongo.db();
  const providers: HocuspocusProvider[] = [];

  try {
    const now = new Date();
    await db.collection('rooms').insertMany(
      roomIds.map((roomId) => ({
        roomId,
        roomName: `Load test ${roomId}`,
        createdBy: userIds[0],
        versions: [],
        createdAt: now,
        members: userIds.map((userId) => ({ userId, username: userId, joinedAt: now, lastVisitedAt: now })),
        files: [{ id: 'main', name: 'main.py', type: 'file', parentId: null, order: 0, isOpen: false, content: '', updatedAt: now }],
      })),
    );

    // --- connect: editor e of every room goes to replica e % replicas, so each room spans replicas ---
    const editors: Editor[] = [];
    const tracker = new PropagationTracker();
    const sampleAt: number[] = [];
    const sampleMs: number[] = [];
    let measuring = false;
    let disconnects = 0;
    let authFailures = 0;

    const synced: Array<Promise<boolean>> = [];
    for (let r = 0; r < roomCount; r++) {
      for (let e = 0; e < editorCount; e++) {
        const userId = userIds[e];
        const doc = new Y.Doc();
        const receiver = `${roomIds[r]}/${userId}`;
        const provider = new HocuspocusProvider({
          url: urls[e % urls.length],
          name: `room:${roomIds[r]}`,
          document: doc,
          token: tokenFor(userId),
          onAuthenticationFailed: () => void authFailures++,
          onStatus: ({ status }) => {
            if (status === 'disconnected' && measuring) disconnects++;
          },
        });
        providers.push(provider);
        const editor: Editor = { room: r, userId, doc, provider, text: doc.getText('content:main'), inserts: 0 };
        editors.push(editor);

        // Every update that arrives from the server names the ids it carries: time those we sent.
        doc.on('update', (update: Uint8Array, origin: unknown) => {
          if (origin !== provider || !measuring) return;
          const ranges = Y.decodeUpdate(update).structs.flatMap((s) => (s instanceof Y.Item ? [{ client: s.id.client, clock: s.id.clock, length: s.length }] : []));
          const at = performance.now();
          for (const ms of tracker.observe(receiver, ranges, at)) {
            sampleAt.push(at);
            sampleMs.push(ms);
          }
        });
        synced.push(new Promise<boolean>((resolve) => {
          provider.on('synced', () => resolve(true));
          setTimeout(() => resolve(false), 60_000);
        }));
      }
    }
    const allSynced = (await Promise.all(synced)).every(Boolean);
    if (!allSynced) throw new Error(`Not every editor connected and synced within 60 s (auth failures: ${authFailures}).`);
    console.log(`${editors.length} editors connected and synced.`);

    // --- memory of each replica, every 10 s ---
    const memory: MemorySample[] = [];
    const sampleMemory = async () => {
      await Promise.all(
        urls.map(async (url) => {
          try {
            const body = (await (await fetch(healthUrl(url))).json()) as { memory?: { rssMb: number; heapUsedMb: number } };
            if (body.memory) memory.push({ at: performance.now(), replica: url, ...body.memory });
          } catch {
            // a missed sample is only a gap in the series
          }
        }),
      );
    };
    await sampleMemory();
    const memoryTimer = setInterval(() => void sampleMemory(), 10_000);

    // --- how busy is the generator itself, and (locally) the servers? ---
    const loop = monitorEventLoopDelay({ resolution: 10 });
    loop.enable();
    const loopP99Windows: number[] = [];
    const cpu = new Map<string, number[]>();
    const sampleCpu = async () => {
      if (config.containers.length === 0) return;
      try {
        const { stdout } = await promisify(execFile)('docker', ['stats', '--no-stream', '--format', '{{.Name}} {{.CPUPerc}}', ...config.containers]);
        for (const line of stdout.trim().split('\n')) {
          const [name, pct] = line.trim().split(/\s+/);
          if (name && pct) cpu.set(name, [...(cpu.get(name) ?? []), parseFloat(pct)]);
        }
      } catch {
        // CPU is a nicety; a missing docker binary must not fail the run
      }
    };

    // --- type ---
    const intervalMs = 1000 / config.rate;
    const alphabet = 'abcdefghijklmnopqrstuvwxyz \n';
    let typing = true;
    const timers: NodeJS.Timeout[] = [];
    const typeOnce = (editor: Editor) => {
      const length = editor.text.length;
      if (length > 20 && Math.random() < 0.1) {
        editor.text.delete(Math.floor(Math.random() * length), 1);
        return;
      }
      const before = Y.getState(editor.doc.store, editor.doc.clientID);
      editor.text.insert(Math.floor(Math.random() * (length + 1)), alphabet[Math.floor(Math.random() * alphabet.length)]);
      const after = Y.getState(editor.doc.store, editor.doc.clientID);
      const at = performance.now();
      for (let clock = before; clock < after; clock++) tracker.record(editor.doc.clientID, clock, editorCount - 1, at);
      editor.inserts += after - before;
    };
    for (const editor of editors) {
      const tick = () => {
        if (!typing) return;
        typeOnce(editor);
        timers.push(setTimeout(tick, intervalMs * (0.7 + Math.random() * 0.6)));
      };
      timers.push(setTimeout(tick, Math.random() * intervalMs));
    }
    measuring = true;
    const typingStartedAt = performance.now();

    let reportedUpTo = 0;
    const reportEvery = 30_000;
    const reporter = setInterval(() => {
      const loopP99 = loop.percentile(99) / 1e6;
      loopP99Windows.push(loopP99);
      loop.reset();
      void sampleCpu();
      const window = sampleMs.slice(reportedUpTo);
      reportedUpTo = sampleMs.length;
      const s = summarize(window);
      const latest = urls.map((u) => memory.filter((m) => m.replica === u).at(-1)?.rssMb ?? NaN);
      console.log(
        `[${Math.round((performance.now() - typingStartedAt) / 1000)}s] edits ${editors.reduce((n, e) => n + e.inserts, 0)}, last 30 s: p50 ${fmt(s.p50)} ms, p95 ${fmt(s.p95)} ms, max ${fmt(s.max)} ms; replica rss MB ${latest.join(' / ')}; generator loop p99 ${fmt(loopP99)} ms; disconnects ${disconnects}`,
      );
    }, reportEvery);

    await sleep(config.durationSec * 1000);

    // --- stop and let everything settle ---
    typing = false;
    timers.forEach(clearTimeout);
    clearInterval(reporter);
    const typingEndedAt = performance.now();
    loop.disable();
    console.log('Typing stopped; waiting for the editors to converge...');

    const vectorOf = (doc: Y.Doc) => Buffer.from(Y.encodeStateVector(doc)).toString('hex');
    const settled = await waitUntil(
      () =>
        roomIds.every((_, r) => {
          const inRoom = editors.filter((e) => e.room === r);
          const vector = vectorOf(inRoom[0].doc);
          return inRoom.every((e) => e.provider.unsyncedChanges === 0 && vectorOf(e.doc) === vector);
        }),
      90_000,
      250,
    );
    measuring = false;
    clearInterval(memoryTimer);
    await sampleMemory();

    // --- verdicts ---
    const problems: string[] = [];
    if (!settled) problems.push('the editors did not converge within 90 s of typing stopping');

    const roomReports: RoomReport[] = [];
    for (let r = 0; r < roomCount; r++) {
      const inRoom = editors.filter((e) => e.room === r);
      const hashes = new Set(inRoom.map((e) => hashOf(e.text.toString())));
      // Every insert any editor made must be in every editor's document: a lost edit shows as a short clock.
      let lost = 0;
      for (const holder of inRoom) {
        for (const author of inRoom) lost += author.inserts - Y.getState(holder.doc.store, author.doc.clientID);
      }
      // A client that connects now gets the same text from the server.
      const verifierDoc = new Y.Doc();
      const verifier = new HocuspocusProvider({ url: urls[0], name: `room:${roomIds[r]}`, document: verifierDoc, token: tokenFor(userIds[0]) });
      providers.push(verifier);
      const verifierSynced = await new Promise<boolean>((resolve) => {
        verifier.on('synced', () => resolve(true));
        setTimeout(() => resolve(false), 30_000);
      });
      const verifierHash = hashOf(verifierDoc.getText('content:main').toString());
      roomReports.push({ room: roomIds[r], editors: inRoom.length, characters: inRoom[0].text.length, hashes: [...hashes], editorsAgree: hashes.size === 1, lostEdits: lost, verifierAgrees: verifierSynced && hashes.size === 1 && verifierHash === [...hashes][0], storedAgrees: false });
    }

    // What the server persisted (after its save delay) loads to the same text.
    await sleep(12_000);
    const store = new MongoDocStore(db);
    for (const report of roomReports) {
      const state = await store.load(report.room);
      const doc = new Y.Doc();
      if (state) Y.applyUpdate(doc, state);
      report.storedAgrees = Boolean(state) && report.editorsAgree && hashOf(doc.getText('content:main').toString()) === report.hashes[0];
    }

    for (const report of roomReports) {
      if (!report.editorsAgree) problems.push(`${report.room}: editors ended with ${report.hashes.length} different texts`);
      if (report.lostEdits !== 0) problems.push(`${report.room}: ${report.lostEdits} edits missing from some editor`);
      if (!report.verifierAgrees) problems.push(`${report.room}: a fresh client got different text`);
      if (!report.storedAgrees) problems.push(`${report.room}: the stored document differs from what the editors have`);
    }
    if (disconnects > 0) problems.push(`${disconnects} disconnects while typing`);
    if (authFailures > 0) problems.push(`${authFailures} authentication failures`);

    // Latency after the warm-up, over the whole typing window.
    const warmupEnd = typingStartedAt + config.warmupSec * 1000;
    const steady: number[] = [];
    const perMinute = new Map<number, number[]>();
    sampleAt.forEach((at, i) => {
      if (at < warmupEnd || at > typingEndedAt) return;
      steady.push(sampleMs[i]);
      const minute = Math.floor((at - typingStartedAt) / 60_000);
      perMinute.set(minute, [...(perMinute.get(minute) ?? []), sampleMs[i]]);
    });
    const latency: LatencySummary = summarize(steady);
    if (!(latency.p95 < config.p95LimitMs)) problems.push(`p95 propagation ${fmt(latency.p95)} ms is not under ${config.p95LimitMs} ms`);
    const expectedSamples = editors.reduce((n, e) => n + e.inserts, 0) * (editorCount - 1);
    if (sampleMs.length < expectedSamples * 0.99) problems.push(`only ${sampleMs.length} of ${expectedSamples} expected edit arrivals were timed`);

    // If the generator itself was starved, it measured itself.
    const generatorLoopP99 = Math.max(...loopP99Windows, 0);
    if (generatorLoopP99 > 50) problems.push(`the load generator was saturated (event loop lag p99 reached ${fmt(generatorLoopP99)} ms), so these latencies are not the server's`);
    const cpuReports = [...cpu.entries()].map(([name, values]) => ({ name, avg: values.reduce((a, b) => a + b, 0) / values.length, max: Math.max(...values), samples: values.length }));

    // Memory: flat once warmed up? First quarter of the samples against the last quarter, per replica.
    const memoryReports = urls.map((url) => {
      const series = memory.filter((m) => m.replica === url && m.at >= warmupEnd).map((m) => m.rssMb);
      const t: Trend | null = trend(series);
      if (t && t.ratio > config.memoryGrowthLimit) problems.push(`${url}: memory grew ${((t.ratio - 1) * 100).toFixed(0)}% (${fmt(t.first)} to ${fmt(t.last)} MB rss)`);
      return { replica: url, minMb: Math.min(...series), maxMb: Math.max(...series), trend: t, samples: series.length };
    });

    const result = {
      config: { ...config, jwtSecret: undefined, mongoUri: undefined },
      finishedAt: new Date().toISOString(),
      edits: editors.reduce((n, e) => n + e.inserts, 0),
      editsPerSecond: editors.reduce((n, e) => n + e.inserts, 0) / config.durationSec,
      latencyMs: latency,
      latencyByMinute: [...perMinute.entries()].sort(([a], [b]) => a - b).map(([minute, values]) => ({ minute, ...summarize(values) })),
      memory: memoryReports,
      generatorLoopP99Ms: generatorLoopP99,
      serverCpuPercent: cpuReports,
      rooms: roomReports,
      settled,
      disconnects,
      problems,
      passed: problems.length === 0,
    };
    if (config.out) writeFileSync(config.out, JSON.stringify(result, null, 2));

    console.log('\n=== Result ===');
    console.log(`edits: ${result.edits} (${result.editsPerSecond.toFixed(0)}/s), timed arrivals: ${latency.count}`);
    console.log(`propagation (after ${config.warmupSec}s warm-up): p50 ${fmt(latency.p50)} ms, p95 ${fmt(latency.p95)} ms, p99 ${fmt(latency.p99)} ms, max ${fmt(latency.max)} ms`);
    for (const m of result.latencyByMinute) console.log(`  minute ${m.minute}: p50 ${fmt(m.p50)}, p95 ${fmt(m.p95)}, max ${fmt(m.max)} ms (${m.count} arrivals)`);
    for (const m of memoryReports) console.log(`memory ${m.replica}: ${m.minMb} to ${m.maxMb} MB rss${m.trend ? `, first quarter ${fmt(m.trend.first)} -> last quarter ${fmt(m.trend.last)} (x${m.trend.ratio.toFixed(2)})` : ''}`);
    console.log(`generator event loop lag p99: max ${fmt(generatorLoopP99)} ms over the run`);
    for (const c of cpuReports) console.log(`cpu ${c.name}: avg ${c.avg.toFixed(0)}%, max ${c.max.toFixed(0)}% (100% = one core)`);
    for (const r of roomReports) console.log(`${r.room}: ${r.characters} characters, ${r.editorsAgree ? 'editors agree' : 'EDITORS DIFFER'}, ${r.lostEdits} lost edits, fresh client ${r.verifierAgrees ? 'agrees' : 'DIFFERS'}`);
    console.log(problems.length === 0 ? '\nPASS' : `\nFAIL\n- ${problems.join('\n- ')}`);
    return problems.length === 0 ? 0 : 1;
  } finally {
    for (const p of providers) p.destroy();
    if (!config.keep) {
      await db.collection('rooms').deleteMany({ roomId: { $in: roomIds } });
      await db.collection('ydoc_updates').deleteMany({ roomId: { $in: roomIds } });
      await db.collection('ydoc_snapshots').deleteMany({ roomId: { $in: roomIds } });
      await db.collection('messages').deleteMany({ roomId: { $in: roomIds } });
    }
    await mongo.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  },
);
