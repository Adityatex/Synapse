import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import type { CompactionResult, MongoDocStore } from './mongoDocStore.js';

/**
 * Keeps ydoc_updates bounded (P2-05). Collab enqueues a `compact` job for a room
 * and a worker folds the room's updates into a snapshot, then deletes the updates
 * the snapshot covers. Compaction is idempotent and safe to run twice or
 * concurrently with writers (see MongoDocStore), so the queue only has to be
 * "at least once", which is what BullMQ gives.
 */

export const SNAPSHOT_QUEUE = 'ydoc-snapshot';

export interface SnapshotJobData {
  roomId: string;
}

export interface SnapshotPolicy {
  /** Compact straight away once this many updates sit on top of the newest snapshot. */
  updatesThreshold: number;
  /** Otherwise compact this long after a room's first un-compacted update. */
  quietDelayMs: number;
  /** First retry delay for a failed job; doubles each attempt, up to `attempts`. */
  backoffMs: number;
  attempts: number;
}

export const DEFAULT_SNAPSHOT_POLICY: SnapshotPolicy = {
  updatesThreshold: 500,
  quietDelayMs: 5 * 60_000,
  backoffMs: 5_000,
  attempts: 3,
};

/** BullMQ wants plain connection options; this keeps a single Redis URL as the config. */
export function connectionFromUrl(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : undefined,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    // Required by BullMQ workers: blocking commands must not be retried-and-failed.
    maxRetriesPerRequest: null,
  };
}

export interface SnapshotScheduler {
  /** Call after every appended update. Never throws; scheduling is best effort. */
  noteAppend(roomId: string, updatesSinceSnapshot: number): void;
  close(): Promise<void>;
}

export interface SchedulerOptions {
  connection: ConnectionOptions;
  policy?: Partial<SnapshotPolicy>;
  queueName?: string;
  onError?: (err: Error) => void;
}

export function createSnapshotScheduler(options: SchedulerOptions): SnapshotScheduler {
  const policy = { ...DEFAULT_SNAPSHOT_POLICY, ...options.policy };
  const queue = new Queue<SnapshotJobData>(options.queueName ?? SNAPSHOT_QUEUE, { connection: options.connection });
  queue.on('error', (err) => options.onError?.(err));

  const jobOptions = {
    removeOnComplete: true, // so the same jobId can be scheduled again later
    removeOnFail: 100, // keep recent failures for inspection until the real DLQ (P4-01)
    attempts: policy.attempts,
    backoff: { type: 'exponential', delay: policy.backoffMs },
  } as const;

  // Per-process memo for the delayed job only: one queued job per window is enough, so
  // skip the Redis call for the rest of the window. The urgent job is deliberately NOT
  // throttled: under sustained load the tail crosses the threshold again within seconds
  // of each compaction, and BullMQ already ignores an add while a job with that id is
  // waiting or running.
  const timedAt = new Map<string, number>();

  const enqueue = (name: string, roomId: string, jobId: string, delay?: number) =>
    queue.add(name, { roomId }, { ...jobOptions, jobId, delay }).catch((err: Error) => options.onError?.(err));

  return {
    noteAppend(roomId, updatesSinceSnapshot) {
      const now = Date.now();
      if (updatesSinceSnapshot >= policy.updatesThreshold) {
        void enqueue('compact-now', roomId, `compact-now-${roomId}`);
        return;
      }
      if (now - (timedAt.get(roomId) ?? 0) >= policy.quietDelayMs) {
        timedAt.set(roomId, now);
        // A fixed jobId means a delayed job that is already waiting is left alone.
        void enqueue('compact', roomId, `compact-${roomId}`, policy.quietDelayMs);
      }
    },
    close: () => queue.close(),
  };
}

export interface CompactionOutcome {
  roomId: string;
  snapshot: CompactionResult | null;
  prunedUpdates: number;
}

/** The job body: snapshot what is new, then drop the updates the newest snapshot covers. */
export async function compactRoom(store: Pick<MongoDocStore, 'writeSnapshot' | 'pruneCoveredUpdates'>, roomId: string): Promise<CompactionOutcome> {
  const snapshot = await store.writeSnapshot(roomId);
  // Prune even when nothing new was snapshotted: another worker may have written the snapshot.
  const prunedUpdates = await store.pruneCoveredUpdates(roomId);
  return { roomId, snapshot, prunedUpdates };
}

export interface SnapshotWorkerOptions {
  connection: ConnectionOptions;
  store: Pick<MongoDocStore, 'writeSnapshot' | 'pruneCoveredUpdates'>;
  queueName?: string;
  concurrency?: number;
  onCompleted?: (outcome: CompactionOutcome) => void;
  onFailed?: (roomId: string | undefined, err: Error, attemptsMade: number) => void;
  onError?: (err: Error) => void;
}

export function createSnapshotWorker(options: SnapshotWorkerOptions): Worker<SnapshotJobData, CompactionOutcome> {
  const worker = new Worker<SnapshotJobData, CompactionOutcome>(
    options.queueName ?? SNAPSHOT_QUEUE,
    async (job: Job<SnapshotJobData>) => compactRoom(options.store, job.data.roomId),
    { connection: options.connection, concurrency: options.concurrency ?? 4 },
  );
  worker.on('completed', (_job, outcome) => options.onCompleted?.(outcome));
  worker.on('failed', (job, err) => options.onFailed?.(job?.data.roomId, err, job?.attemptsMade ?? 0));
  worker.on('error', (err) => options.onError?.(err));
  return worker;
}
