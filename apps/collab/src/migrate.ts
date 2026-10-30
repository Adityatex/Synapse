import { MongoDocStore } from '@synapse/ydoc-store';
import { MongoClient } from 'mongodb';
import { migrateAll, migrateRoom } from './migration.js';

/**
 * Admin tool (P2-10). Run where MONGODB_URI is set, for example:
 *
 *   docker compose exec collab node dist/migrate.js --all --dry-run
 *   docker compose exec collab node dist/migrate.js --all
 *   docker compose exec collab node dist/migrate.js --room ABC123
 */

const USAGE = `Usage:
  migrate --all [--dry-run]       migrate every room that has not been migrated
  migrate --room <ID> [--dry-run] migrate one room`;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(name);

async function main(): Promise<number> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set.');
    return 2;
  }
  const mode = flag('--all') ? 'all' : arg('--room') ? 'room' : null;
  if (!mode) {
    console.error(USAGE);
    return 2;
  }

  const mongo = await new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 }).connect();
  try {
    const store = new MongoDocStore(mongo.db());
    await store.ensureIndexes();
    const deps = { db: mongo.db(), store };
    const dryRun = flag('--dry-run');
    const prefix = dryRun ? '[dry run] ' : '';

    if (mode === 'all') {
      const report = await migrateAll(deps, { dryRun, onRoom: (roomId, outcome) => console.log(`${prefix}${roomId}: ${outcome}`) });
      console.log(JSON.stringify(report.counts));
      for (const failure of report.failures) console.error(`FAILED ${failure.roomId}: ${failure.error}`);
      return report.counts.failed > 0 ? 1 : 0;
    }
    const roomId = arg('--room')!.toUpperCase();
    console.log(`${prefix}${roomId}: ${await migrateRoom(deps, roomId, { dryRun })}`);
    return 0;
  } finally {
    await mongo.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
