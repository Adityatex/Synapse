import { MongoDocStore, connectionFromUrl, createSnapshotWorker } from '@synapse/ydoc-store';
import { MongoClient } from 'mongodb';
import pino from 'pino';
import { loadConfig, type WorkerConfig } from './config.js';

async function main(): Promise<void> {
  let config: WorkerConfig;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const logger = pino({
    level: config.LOG_LEVEL,
    name: 'worker',
    // Pretty output only in an interactive dev terminal; containers get JSON.
    ...(config.NODE_ENV === 'development' && process.stdout.isTTY
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  });

  const mongo = new MongoClient(config.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  await mongo.connect();
  const store = new MongoDocStore(mongo.db());
  await store.ensureIndexes();

  const worker = createSnapshotWorker({
    connection: connectionFromUrl(config.REDIS_URL),
    store,
    concurrency: config.SNAPSHOT_CONCURRENCY,
    // Per-job numbers for the Jobs dashboard (P4-10): how much was folded in, how big the snapshot is.
    onCompleted: ({ roomId, snapshot, prunedUpdates }) =>
      logger.info(
        {
          event: 'worker.snapshot.completed',
          roomId,
          snapshotSeq: snapshot?.snapshotSeq ?? null,
          updatesMerged: snapshot?.updatesMerged ?? 0,
          snapshotBytes: snapshot?.snapshotBytes ?? 0,
          prunedUpdates,
        },
        'room compacted',
      ),
    onFailed: (roomId, err, attemptsMade) =>
      logger.error({ event: 'worker.snapshot.failed', roomId, attemptsMade, err: err.message }, 'compaction failed'),
    onError: (err) => logger.warn({ err: err.message }, 'queue connection error'),
  });
  logger.info({ concurrency: config.SNAPSHOT_CONCURRENCY }, 'Synapse worker listening for snapshot jobs');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received. Finishing in-flight jobs...`);
    try {
      await worker.close(); // waits for running jobs
      await mongo.close();
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Error during shutdown');
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
