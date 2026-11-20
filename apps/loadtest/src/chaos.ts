import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { percentile } from './stats.js';

/**
 * Faults injected into a load test run (`--chaos`), and what they did to the edits.
 *
 *   kill:<container>:<atSec>:<downSec>
 *     SIGKILL a collab replica `atSec` after typing starts and start it again `downSec` later. Its editors lose
 *     their connection, keep typing offline and reconnect with the client's back-off. Nothing is flushed:
 *     whatever the replica had not yet saved or published is gone from the server side.
 *
 *   dropsub:<container>:<atSec>[:<everySec>:<times>]
 *     Kill that replica's Redis subscriber connection(s) (CLIENT KILL), once or `times` times `everySec` apart.
 *     The replica stays up and keeps its editors; what the others publish until its subscriber is back is lost
 *     to it (Redis Pub/Sub is at most once). This is the loss the anti-entropy repair exists for.
 *
 * Several specs may be given, comma-separated. Times are seconds after the editors start typing.
 */

export type ChaosSpec =
  | { kind: 'kill'; container: string; atSec: number; downSec: number }
  | { kind: 'dropsub'; container: string; atSec: number; everySec: number; times: number };

export interface ChaosEvent {
  kind: ChaosSpec['kind'];
  container: string;
  /** Epoch ms: the fault began (kill sent / subscriber killed). */
  startMs: number;
  /** Epoch ms: the fault was lifted (container started again). For `dropsub` the same as `startMs`. */
  endMs: number;
  /** `dropsub`: how many subscriber connections were killed. */
  killedConnections?: number;
  error?: string;
}

export function parseChaos(raw: string | undefined, durationSec: number): ChaosSpec[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((spec) => {
      const [kind, container, ...nums] = spec.split(':');
      const n = nums.map(Number);
      if (!container || n.some((v) => !Number.isFinite(v) || v < 0)) throw new Error(`--chaos: cannot read "${spec}"`);
      let parsed: ChaosSpec;
      if (kind === 'kill' && n.length === 2 && n[1] > 0) parsed = { kind, container, atSec: n[0], downSec: n[1] };
      else if (kind === 'dropsub' && n.length === 1) parsed = { kind, container, atSec: n[0], everySec: 0, times: 1 };
      else if (kind === 'dropsub' && n.length === 3 && n[1] > 0 && n[2] >= 1) parsed = { kind, container, atSec: n[0], everySec: n[1], times: Math.floor(n[2]) };
      else throw new Error(`--chaos: "${spec}" is not kill:<container>:<atSec>:<downSec> or dropsub:<container>:<atSec>[:<everySec>:<times>]`);
      const lastSec = parsed.kind === 'kill' ? parsed.atSec + parsed.downSec : parsed.atSec + parsed.everySec * (parsed.times - 1);
      // The recovery has to be watched while the editors still type, or there is nothing to measure it by.
      if (lastSec + 20 > durationSec) throw new Error(`--chaos: "${spec}" ends at ${lastSec}s; leave at least 20 s of the ${durationSec}s run after it`);
      return parsed;
    });
}

const run = promisify(execFile);
const docker = async (...args: string[]) => (await run('docker', args, { timeout: 30_000 })).stdout;
const sleepUntil = (epochMs: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, epochMs - Date.now())));

/** The ids of the Redis Pub/Sub connections that come from this container. */
async function subscriberIds(redisContainer: string, container: string): Promise<string[]> {
  const ips = (await docker('inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}', container)).trim().split(/\s+/).filter(Boolean);
  const list = await docker('exec', redisContainer, 'redis-cli', 'CLIENT', 'LIST', 'TYPE', 'pubsub');
  return list
    .split('\n')
    .map((line) => Object.fromEntries(line.trim().split(' ').map((kv) => kv.split('=') as [string, string])))
    .filter((c) => c.id && c.name === 'synapse-collab' && ips.some((ip) => c.addr?.startsWith(`${ip}:`)))
    .map((c) => c.id);
}

/** Runs every spec on its schedule from `t0` (epoch ms) and resolves with what was done, once all are done. */
export async function runChaos(specs: ChaosSpec[], t0: number, redisContainer: string, log: (line: string) => void): Promise<ChaosEvent[]> {
  const events: ChaosEvent[] = [];
  const at = (sec: number) => t0 + sec * 1000;
  await Promise.all(
    specs.map(async (spec) => {
      if (spec.kind === 'kill') {
        await sleepUntil(at(spec.atSec));
        const event: ChaosEvent = { kind: 'kill', container: spec.container, startMs: Date.now(), endMs: NaN };
        events.push(event);
        try {
          await docker('kill', spec.container);
          log(`[chaos] killed ${spec.container}; starting it again in ${spec.downSec}s`);
          await sleepUntil(event.startMs + spec.downSec * 1000);
          await docker('start', spec.container);
          event.endMs = Date.now();
          log(`[chaos] started ${spec.container} again`);
        } catch (err) {
          event.error = err instanceof Error ? err.message : String(err);
          event.endMs = Date.now();
          log(`[chaos] ${spec.container}: ${event.error}`);
        }
        return;
      }
      for (let i = 0; i < spec.times; i++) {
        await sleepUntil(at(spec.atSec + i * spec.everySec));
        const event: ChaosEvent = { kind: 'dropsub', container: spec.container, startMs: Date.now(), endMs: NaN, killedConnections: 0 };
        events.push(event);
        try {
          const ids = await subscriberIds(redisContainer, spec.container);
          event.startMs = Date.now();
          for (const id of ids) await docker('exec', redisContainer, 'redis-cli', 'CLIENT', 'KILL', 'ID', id);
          event.killedConnections = ids.length;
          if (ids.length === 0) event.error = `no Redis subscriber connection from ${spec.container} was found`;
          log(`[chaos] dropped ${ids.length} subscriber connection(s) of ${spec.container}`);
        } catch (err) {
          event.error = err instanceof Error ? err.message : String(err);
          log(`[chaos] ${spec.container}: ${event.error}`);
        }
        event.endMs = event.startMs;
      }
    }),
  );
  return events.sort((a, b) => a.startMs - b.startMs);
}

/** Arrivals grouped by when the edit was sent: [bucket start (epoch ms), arrivals, worst latency (ms)]. */
export type SendBucket = [startMs: number, count: number, maxMs: number];
export const SEND_BUCKET_MS = 100;

export class SendBuckets {
  private readonly buckets = new Map<number, [number, number]>();

  add(sentAtMs: number, latencyMs: number): void {
    const key = Math.floor(sentAtMs / SEND_BUCKET_MS) * SEND_BUCKET_MS;
    const b = this.buckets.get(key);
    if (b) {
      b[0]++;
      if (latencyMs > b[1]) b[1] = latencyMs;
    } else this.buckets.set(key, [1, latencyMs]);
  }

  toJSON(): SendBucket[] {
    return [...this.buckets.entries()].sort(([a], [b]) => a - b).map(([start, [count, max]]) => [start, count, max]);
  }

  /** Several workers' buckets as one series. */
  static merge(series: readonly SendBucket[][]): SendBucket[] {
    const merged = new Map<number, [number, number]>();
    for (const list of series) {
      for (const [start, count, max] of list) {
        const m = merged.get(start);
        if (m) {
          m[0] += count;
          m[1] = Math.max(m[1], max);
        } else merged.set(start, [count, max]);
      }
    }
    return [...merged.entries()].sort(([a], [b]) => a - b).map(([start, [count, max]]) => [start, count, max]);
  }
}

export interface FaultImpact extends ChaosEvent {
  /** ms after the fault was lifted until edits again arrived as fast as before any fault (null: never, in the run). */
  recoveryMs: number | null;
  /** Edits sent from the fault's start until recovery, as timed arrivals, and the slowest of them. */
  affectedArrivals: number;
  worstLatencyMs: number;
  /** `kill`: the last reconnect of an editor after the fault, ms after it was lifted. */
  lastReconnectMs?: number;
}

export interface ChaosReport {
  /** A send-time bucket counts as normal when its slowest arrival is at most this (3 x p99 of the pre-fault buckets, at least 50 ms). */
  normalBucketMaxMs: number;
  /** Recovery is declared once this long of consecutive buckets is normal. */
  settleMs: number;
  faults: FaultImpact[];
}

/**
 * How long each fault disturbed the edits. Edits are grouped by when they were sent; a group is normal when its
 * slowest arrival is no worse than the slowest groups before any fault (3 x their p99). A fault has recovered at
 * the first group, after it was lifted, from which `settleMs` of groups are all normal.
 */
export function chaosReport(buckets: readonly SendBucket[], events: readonly ChaosEvent[], measureFromMs: number, reconnectsAt: readonly number[] = [], settleMs = 5_000): ChaosReport {
  const series = buckets.filter(([start]) => start >= measureFromMs);
  const firstFault = Math.min(...events.map((e) => e.startMs));
  const before = series.filter(([start]) => start + SEND_BUCKET_MS <= firstFault - 1_000).map(([, , max]) => max).sort((a, b) => a - b);
  const normalBucketMaxMs = before.length >= 20 ? Math.max(50, 3 * percentile(before, 99)) : 200;
  const lastSend = series.length ? series[series.length - 1][0] : -Infinity;

  const faults = events.map((event): FaultImpact => {
    const end = Number.isFinite(event.endMs) ? event.endMs : event.startMs;
    let recoveredAt: number | null = null;
    for (let i = 0; i < series.length && recoveredAt === null; i++) {
      const [start, , max] = series[i];
      if (start + SEND_BUCKET_MS <= end || max > normalBucketMaxMs) continue;
      if (start + settleMs > lastSend) break; // not enough of the run left to call it settled
      let normal = true;
      for (let j = i; j < series.length && series[j][0] < start + settleMs; j++) if (series[j][2] > normalBucketMaxMs) normal = false;
      if (normal) recoveredAt = start;
    }
    const until = recoveredAt ?? Infinity;
    let affectedArrivals = 0;
    let worstLatencyMs = 0;
    for (const [start, count, max] of series) {
      if (start + SEND_BUCKET_MS <= event.startMs || start >= until) continue;
      affectedArrivals += count;
      worstLatencyMs = Math.max(worstLatencyMs, max);
    }
    const reconnects = reconnectsAt.filter((t) => t >= event.startMs && t <= end + 120_000);
    return {
      ...event,
      recoveryMs: recoveredAt === null ? null : Math.max(0, recoveredAt - end),
      affectedArrivals,
      worstLatencyMs,
      ...(event.kind === 'kill' && reconnects.length ? { lastReconnectMs: Math.max(...reconnects) - end } : {}),
    };
  });
  return { normalBucketMaxMs, settleMs, faults };
}
