/** Nearest-rank percentile of already sorted numbers (p in 0..100). */
export function percentile(sorted: ArrayLike<number>, p: number): number {
  if (sorted.length === 0) return NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export interface LatencySummary {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

export function summarize(values: readonly number[]): LatencySummary {
  if (values.length === 0) return { count: 0, p50: NaN, p95: NaN, p99: NaN, max: NaN, mean: NaN };
  const sorted = Float64Array.from(values).sort();
  let sum = 0;
  for (const v of sorted) sum += v;
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
  };
}

export interface OpRange {
  client: number;
  clock: number;
  length: number;
}

/**
 * Matches each edit an editor makes to its arrival at every other editor in the room.
 *
 * A sender records, for each character it inserts, the time and the Yjs id (client, clock). When a
 * receiver's document applies a remote update, the structs in it name the ids that arrived, so the
 * difference of the two clocks is that edit's propagation time to that receiver. Several edits can
 * arrive in one update (they are batched on the wire); each is timed on its own.
 *
 * Memory stays bounded: an entry is dropped once every receiver has seen it, and a receiver only
 * counts an id the first time (clocks of one client arrive in order, so a high-water mark is enough).
 */
export class PropagationTracker {
  private readonly sent = new Map<string, { at: number; remaining: number }>();
  private readonly seenUpTo = new Map<string, number>();

  /** Ids sent and not yet seen by everyone. */
  get pending(): number {
    return this.sent.size;
  }

  /** `fanout` is how many other editors will receive it. */
  record(client: number, clock: number, fanout: number, at: number): void {
    if (fanout > 0) this.sent.set(`${client}:${clock}`, { at, remaining: fanout });
  }

  /** Returns the propagation time (ms) of every edit this update delivered to `receiver` for the first time. */
  observe(receiver: string, ranges: readonly OpRange[], now: number): number[] {
    const latencies: number[] = [];
    for (const { client, clock, length } of ranges) {
      const marker = `${receiver}|${client}`;
      const from = Math.max(clock, this.seenUpTo.get(marker) ?? 0);
      const to = clock + length;
      for (let k = from; k < to; k++) {
        const key = `${client}:${k}`;
        const entry = this.sent.get(key);
        if (!entry) continue;
        latencies.push(now - entry.at);
        if (--entry.remaining <= 0) this.sent.delete(key);
      }
      if (to > (this.seenUpTo.get(marker) ?? 0)) this.seenUpTo.set(marker, to);
    }
    return latencies;
  }
}

export interface Trend {
  /** Mean of the first quarter and of the last quarter of the samples. */
  first: number;
  last: number;
  /** last / first: 1 is flat, 1.2 is 20% growth. */
  ratio: number;
}

/** Is a series (memory, say) flat? Compares the first and last quarter of the samples. */
export function trend(samples: readonly number[]): Trend | null {
  if (samples.length < 8) return null;
  const quarter = Math.floor(samples.length / 4);
  const mean = (part: readonly number[]) => part.reduce((a, b) => a + b, 0) / part.length;
  const first = mean(samples.slice(0, quarter));
  const last = mean(samples.slice(-quarter));
  return { first, last, ratio: last / first };
}
