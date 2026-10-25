import { MongoClient } from 'mongodb';
import { loadConfig, type CollabConfig } from './config.js';
import { createMongoLegacyRooms } from './legacyRooms.js';
import { MongoDocStore } from './mongoDocStore.js';
import { createLogger } from './logger.js';
import { createMongoRoomAccess } from './roomAccess.js';
import { createCollabServer } from './server.js';

async function main(): Promise<void> {
  let config: CollabConfig;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV);

  const mongo = new MongoClient(config.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  await mongo.connect();
  logger.info('Connected to MongoDB');

  const store = new MongoDocStore(mongo.db());
  await store.ensureIndexes();

  const server = createCollabServer({
    jwtSecret: config.JWT_SECRET,
    logger,
    access: createMongoRoomAccess(mongo.db()),
    store,
    legacy: createMongoLegacyRooms(mongo.db()),
    redisUrl: config.REDIS_URL || undefined,
    connectionsPerMin: config.COLLAB_CONNECTIONS_PER_MIN,
    release: config.APP_RELEASE,
  });

  await server.listen(config.PORT);
  logger.info({ port: config.PORT, redis: Boolean(config.REDIS_URL) }, 'Synapse collab listening');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received. Shutting down gracefully...`);
    try {
      await server.destroy(); // flushes pending document stores before closing
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
