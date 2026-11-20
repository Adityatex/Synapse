import { describe, expect, it } from 'vitest';
import { SEND_BUCKET_MS, SendBuckets, chaosReport, parseChaos, type ChaosEvent, type SendBucket } from './chaos.js';

describe('parseChaos', () => {
  it('reads kill and dropsub specs, several at once', () => {
    expect(parseChaos('kill:synapse-collab-2-1:120:20, dropsub:synapse-collab-1:60:30:4', 600)).toEqual([
      { kind: 'kill', container: 'synapse-collab-2-1', atSec: 120, downSec: 20 },
      { kind: 'dropsub', container: 'synapse-collab-1', atSec: 60, everySec: 30, times: 4 },
    ]);
    expect(parseChaos('dropsub:c:10', 600)).toEqual([{ kind: 'dropsub', container: 'c', atSec: 10, everySec: 0, times: 1 }]);
    expect(parseChaos(undefined, 600)).toEqual([]);
  });

  it('refuses what it cannot read, and a fault that leaves no time to watch the recovery', () => {
    expect(() => parseChaos('kill:c:120', 600)).toThrow(/not kill/);
    expect(() => parseChaos('pause:c:1:2', 600)).toThrow(/not kill/);
    expect(() => parseChaos('kill:c:x:2', 600)).toThrow(/cannot read/);
    expect(() => parseChaos('kill:c:580:10', 600)).toThrow(/leave at least 20 s/);
    expect(() => parseChaos('dropsub:c:100:100:6', 600)).toThrow(/leave at least 20 s/);
  });
});

describe('SendBuckets', () => {
  it('groups arrivals by send time and merges workers', () => {
    const a = new SendBuckets();
    a.add(1_050, 4);
    a.add(1_099, 9);
    a.add(1_100, 2);
    const b = new SendBuckets();
    b.add(1_000, 12);
    expect(a.toJSON()).toEqual([[1_000, 2, 9], [1_100, 1, 2]]);
    expect(SendBuckets.merge([a.toJSON(), b.toJSON()])).toEqual([[1_000, 3, 12], [1_100, 1, 2]]);
  });
});

/** A steady series from `from` to `to` (epoch ms), one bucket per 100 ms, with `latency(t)` as each bucket's worst. */
const series = (from: number, to: number, latency: (t: number) => number): SendBucket[] => {
  const out: SendBucket[] = [];
  for (let t = from; t < to; t += SEND_BUCKET_MS) out.push([t, 10, latency(t)]);
  return out;
};

describe('chaosReport', () => {
  const kill: ChaosEvent = { kind: 'kill', container: 'c2', startMs: 60_000, endMs: 80_000 };

  it('measures recovery from when the fault was lifted, and what it cost the edits sent meanwhile', () => {
    // 10 ms normally; edits sent while down (and until editors are back 3 s after the restart) arrive late.
    const buckets = series(0, 120_000, (t) => (t >= 60_000 && t < 83_000 ? 83_500 - t : 10));
    const report = chaosReport(buckets, [kill], 5_000, [82_000, 83_000]);
    expect(report.normalBucketMaxMs).toBe(50); // 3 x 10 ms, floored at 50
    const [f] = report.faults;
    expect(f.recoveryMs).toBe(3_000);
    expect(f.worstLatencyMs).toBe(23_500);
    expect(f.affectedArrivals).toBe(230 * 10);
    expect(f.lastReconnectMs).toBe(3_000);
  });

  it('places a subscriber drop at the moment it happened', () => {
    const drop: ChaosEvent = { kind: 'dropsub', container: 'c1', startMs: 60_000, endMs: 60_000, killedConnections: 1 };
    const buckets = series(0, 120_000, (t) => (t >= 60_000 && t < 60_300 ? 400 : 10));
    const [f] = chaosReport(buckets, [drop], 5_000).faults;
    expect(f.recoveryMs).toBe(300);
    expect(f.worstLatencyMs).toBe(400);
  });

  it('says so when the edits never recovered', () => {
    const buckets = series(0, 120_000, (t) => (t >= 60_000 ? 5_000 : 10));
    expect(chaosReport(buckets, [kill], 5_000).faults[0].recoveryMs).toBeNull();
  });

  it('does not call it recovered when too little of the run is left to tell', () => {
    const buckets = series(0, 82_000, (t) => (t >= 60_000 && t < 80_500 ? 1_000 : 10));
    expect(chaosReport(buckets, [kill], 5_000).faults[0].recoveryMs).toBeNull();
  });
});
