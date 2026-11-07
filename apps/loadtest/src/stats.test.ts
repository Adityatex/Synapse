import { describe, expect, it } from 'vitest';
import { PropagationTracker, percentile, summarize, trend } from './stats.js';

describe('percentile', () => {
  it('uses the nearest rank', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(95);
    expect(percentile(sorted, 99)).toBe(99);
    expect(percentile(sorted, 100)).toBe(100);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNaN();
  });

  it('summarizes unsorted input', () => {
    const summary = summarize([30, 10, 20, 40, 1000]);
    expect(summary).toMatchObject({ count: 5, p50: 30, max: 1000, mean: 220 });
    expect(summary.p95).toBe(1000);
    expect(summarize([]).count).toBe(0);
  });
});

describe('PropagationTracker', () => {
  it('times an edit from the send to the arrival at each receiver', () => {
    const tracker = new PropagationTracker();
    tracker.record(7, 0, 2, 1000); // the editor with client id 7 inserted clock 0; two others will get it
    expect(tracker.observe('B', [{ client: 7, clock: 0, length: 1 }], 1040)).toEqual([40]);
    expect(tracker.observe('C', [{ client: 7, clock: 0, length: 1 }], 1090)).toEqual([90]);
    expect(tracker.pending).toBe(0); // everyone has it: nothing is kept
  });

  it('times each edit in a batched update on its own', () => {
    const tracker = new PropagationTracker();
    tracker.record(7, 0, 1, 1000);
    tracker.record(7, 1, 1, 1100);
    tracker.record(7, 2, 1, 1200);
    expect(tracker.observe('B', [{ client: 7, clock: 0, length: 3 }], 1250)).toEqual([250, 150, 50]);
  });

  it('counts an edit once per receiver, even if the same ids arrive again', () => {
    const tracker = new PropagationTracker();
    tracker.record(7, 0, 2, 1000);
    expect(tracker.observe('B', [{ client: 7, clock: 0, length: 1 }], 1010)).toEqual([10]);
    expect(tracker.observe('B', [{ client: 7, clock: 0, length: 1 }], 5000)).toEqual([]); // a resend
    expect(tracker.pending).toBe(1); // C has not seen it yet
  });

  it('ignores ids it did not record (the seed text, or other senders)', () => {
    const tracker = new PropagationTracker();
    tracker.record(7, 0, 1, 1000);
    expect(tracker.observe('B', [{ client: 1_935_000_001, clock: 0, length: 500 }], 1010)).toEqual([]);
    expect(tracker.observe('B', [{ client: 7, clock: 0, length: 1 }], 1020)).toEqual([20]);
  });

  it('tracks senders and receivers independently', () => {
    const tracker = new PropagationTracker();
    tracker.record(1, 0, 1, 100);
    tracker.record(2, 0, 1, 200);
    expect(tracker.observe('X', [{ client: 2, clock: 0, length: 1 }], 230)).toEqual([30]);
    expect(tracker.observe('X', [{ client: 1, clock: 0, length: 1 }], 260)).toEqual([160]);
  });

  it('keeps nothing for an edit nobody receives', () => {
    const tracker = new PropagationTracker();
    tracker.record(1, 0, 0, 100);
    expect(tracker.pending).toBe(0);
  });
});

describe('trend', () => {
  it('reports flat, growing and too-short series', () => {
    const flat = trend(Array.from({ length: 40 }, () => 200));
    expect(flat?.ratio).toBe(1);
    const growing = trend(Array.from({ length: 40 }, (_, i) => 100 + i * 10));
    expect(growing!.ratio).toBeGreaterThan(2);
    expect(trend([1, 2, 3])).toBeNull();
  });

  it('looks at the first and last quarter, so one spike in the middle does not matter', () => {
    const series = Array.from({ length: 40 }, (_, i) => (i === 20 ? 900 : 200));
    expect(trend(series)?.ratio).toBe(1);
  });
});
