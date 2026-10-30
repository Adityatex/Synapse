import { IncomingMessage, MessageType, Server, type Connection, type Extension, type Hocuspocus } from '@hocuspocus/server';
import { Redis as RedisExtension } from '@hocuspocus/extension-redis';
import { Throttle } from '@hocuspocus/extension-throttle';
import { checkRedisHealth, createRedisClient } from '@synapse/redis';
import { buildSeedUpdate } from '@synapse/room-doc';
import type { IncomingMessage as HttpRequest, ServerResponse } from 'node:http';
import * as Y from 'yjs';
import { AuthError, documentNameFor, parseDocumentName, verifyAccessToken, type AuthUser } from './auth.js';
import type { DocStore } from '@synapse/ydoc-store';
import type { LegacyRooms } from './legacyRooms.js';
import { LockService, lockRequestSchema, snapshotSignature, type LockMessage, type LockOutcome } from './lockService.js';
import { MemoryLockStore, RedisLockStore, type LockStore } from './locks.js';
import { guardAwareness } from './presence.js';
import type { Logger } from './logger.js';
import type { RoomAccess } from './roomAccess.js';
import { createProjectionService, type ProjectionOptions } from './projectionService.js';

/** Per-connection data set by onAuthenticate and read by every later hook. */
export interface CollabContext {
  user: AuthUser;
  roomId: string;
}

export interface CollabDeps {
  jwtSecret: string;
  logger: Logger;
  access: RoomAccess;
  store: DocStore;
  /** A room with no stored document is seeded from its legacy files (the migration path, P2-10). */
  legacy?: LegacyRooms;
  /** Without a Redis URL the server runs single-instance. */
  redisUrl?: string;
  connectionsPerMin?: number;
  release?: string;
  /** Quiet period before a changed document is persisted. Tests shorten it. */
  storeDebounceMs?: number;
  /** The plain-text projection (P2-09). Tests shorten the waits and can supply a cache client. */
  projection?: Pick<ProjectionOptions, 'cacheMs' | 'syncWaitMs' | 'client'>;
  /** Focus locks (P2-08). Defaults: Redis when `redisUrl` is set (else in memory), 45 s expiry, 2 s tick. */
  locks?: { store?: LockStore; ttlMs?: number; tickMs?: number; settingsCacheMs?: number; locksCacheMs?: number };
}

const DEFAULT_LOCK_TICK_MS = 2_000;
const MAX_STATELESS_BYTES = 512;
const SYNC_STEP2 = 1; // y-protocols sync message types
const SYNC_UPDATE = 2;

/** The Yjs update inside a raw sync message that would change the document, or null for anything else. */
function writableUpdate(raw: Uint8Array): Uint8Array | null {
  try {
    const message = new IncomingMessage(raw);
    message.readVarString(); // the document name
    const type = message.readVarUint();
    // A client answers the server's sync step 1 with a "sync reply", so both carry edits.
    if (type !== MessageType.Sync && type !== MessageType.SyncReply) return null;
    const syncType = message.readVarUint();
    return syncType === SYNC_STEP2 || syncType === SYNC_UPDATE ? message.readVarUint8Array() : null;
  } catch {
    return null;
  }
}

const encode = (message: LockMessage) => JSON.stringify(message);

const MB = 1024 * 1024;
const processMemory = () => {
  const { rss, heapUsed } = process.memoryUsage();
  return { rssMb: Math.round(rss / MB), heapUsedMb: Math.round(heapUsed / MB) };
};

const FILES_ROUTE = /^\/rooms\/([A-Za-z0-9]{4,32})\/files$/;

// Persist after 2 s of quiet, and never leave a busy document unsaved for over 10 s.
const DEFAULT_STORE_DEBOUNCE_MS = 2_000;
const MAX_STORE_DEBOUNCE_MS = 10_000;

export function createCollabServer(deps: CollabDeps): Server<CollabContext> {
  const { jwtSecret, logger, access, store, redisUrl, release = '' } = deps;
  const startedAt = Date.now();
  const storeDebounceMs = deps.storeDebounceMs ?? DEFAULT_STORE_DEBOUNCE_MS;

  const redis = redisUrl
    ? new RedisExtension({
        prefix: 'synapse:hocuspocus',
        // Pub/sub clients must queue commands across reconnects, unlike the
        // fail-fast default used for request-path calls.
        createClient: () =>
          createRedisClient(redisUrl, {
            name: 'synapse-collab',
            onError: (err) => logger.warn({ err: err.message }, 'Redis connection error (retrying)'),
            redis: { enableOfflineQueue: true, maxRetriesPerRequest: null },
          }),
      })
    : null;

  // Locks use the request path (fail fast when Redis is down), unlike the pub/sub clients above.
  const lockRedis = redisUrl && !deps.locks?.store
    ? createRedisClient(redisUrl, {
        name: 'synapse-collab-locks',
        onError: (err) => logger.warn({ err: err.message }, 'Redis connection error (locks)'),
      })
    : null;
  const lockService = new LockService({
    store: deps.locks?.store ?? (lockRedis ? new RedisLockStore(lockRedis) : new MemoryLockStore()),
    settings: (roomId) => access.settings(roomId),
    ttlMs: deps.locks?.ttlMs,
    settingsCacheMs: deps.locks?.settingsCacheMs,
    locksCacheMs: deps.locks?.locksCacheMs,
    onProblem: (err, what) => logger.warn({ err: err instanceof Error ? err.message : String(err), what }, 'focus locks unavailable'),
  });
  // What each room's clients were last told, so a change is announced once and a quiet room costs nothing.
  const announced = new Map<string, string>();
  let tick: ReturnType<typeof setInterval> | undefined;
  // Connections whose current message is being dropped: they are read-only for exactly that message.
  const droppingEdits = new WeakMap<Connection, boolean>();

  const publish = (roomId: string, document: { broadcastStateless(payload: string): void }, outcome: LockOutcome) => {
    if (!outcome.broadcast) return;
    if (outcome.broadcast.type === 'locks.snapshot') announced.set(roomId, snapshotSignature(outcome.broadcast));
    // Across replicas: the Redis extension forwards a broadcast to the others.
    document.broadcastStateless(encode(outcome.broadcast));
  };

  const runTick = async (instance: Hocuspocus) => {
    for (const [name, document] of instance.documents) {
      const roomId = parseDocumentName(name);
      if (!roomId || document.getConnectionsCount() === 0) continue;
      try {
        const snapshot = await lockService.snapshot(roomId, true);
        const signature = snapshotSignature(snapshot);
        if (announced.get(roomId) === signature) continue;
        announced.set(roomId, signature);
        // Every replica ticks for its own clients, so this one only needs to reach its own.
        document.relayStateless(encode({ type: 'locks.snapshot', ...snapshot }));
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err), roomId }, 'lock tick failed');
      }
    }
  };

  const extensions: Extension[] = [
    new Throttle({ throttle: deps.connectionsPerMin ?? 300, consideredSeconds: 60, banTime: 5 }),
    ...(redis ? [redis] : []),
  ];

  const projection = createProjectionService({ redisUrl, logger, ...deps.projection });
  extensions.push({
    async onDestroy() {
      await projection.close();
    },
  });

  /** GET /rooms/:id/files: the room as plain text for a member (P2-09). */
  async function serveRoomFiles(request: HttpRequest, response: ServerResponse, instance: Hocuspocus, roomParam: string) {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    try {
      let user;
      try {
        user = verifyAccessToken((request.headers.authorization ?? '').replace(/^Bearer\s+/i, ''), jwtSecret);
      } catch {
        return send(401, { error: 'Authentication required.' });
      }
      const roomId = roomParam.toUpperCase();
      let decision;
      try {
        decision = await access.check(roomId, user.userId);
      } catch (err) {
        logger.error({ err: err instanceof Error ? err.message : String(err), roomId }, 'Room access check failed');
        return send(503, { error: 'Could not verify room access.' });
      }
      if (decision === 'not-found') return send(404, { error: 'Room not found.' });
      if (decision === 'denied') return send(403, { error: 'You are not a member of this room.' });

      const fresh = new URL(request.url ?? '', 'http://collab').searchParams.get('fresh') === '1';
      return send(200, { roomId, ...(await projection.read(instance, roomId, { fresh })) });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err), roomParam }, 'Room projection failed');
      return send(500, { error: 'Could not read the room.' });
    }
  }

  return new Server<CollabContext>({
    name: 'synapse-collab',
    quiet: true,
    stopOnSignals: false,
    debounce: storeDebounceMs,
    maxDebounce: Math.max(storeDebounceMs, MAX_STORE_DEBOUNCE_MS),
    extensions,

    async onAuthenticate({ token, documentName, connectionConfig }) {
      const user = verifyAccessToken(token, jwtSecret);

      const roomId = parseDocumentName(documentName);
      // `room:abc123` and `room:ABC123` would otherwise be two separate documents.
      if (!roomId || documentNameFor(roomId) !== documentName) throw new AuthError('Unknown document.');

      let decision;
      try {
        decision = await access.check(roomId, user.userId);
      } catch (err) {
        logger.error({ err: err instanceof Error ? err.message : String(err), roomId }, 'Room access check failed');
        // Fail closed: unlike the legacy relay, an outage must not open rooms.
        throw new AuthError('Could not verify room access. Try again.');
      }
      if (decision === 'not-found') throw new AuthError('Room not found.');
      if (decision === 'denied') throw new AuthError('You are not a member of this room.');

      connectionConfig.readOnly = false; // viewers arrive with roles (P3-04)
      logger.info({ event: 'collab.auth', roomId, userId: user.userId }, 'connection authenticated');
      return { user, roomId } satisfies CollabContext;
    },

    async onLoadDocument({ documentName, document, context }) {
      const roomId = parseDocumentName(documentName);
      if (!roomId) return;
      // P2-10: once a room has a document it belongs to collab. Recording that lets `migrate --all` skip
      // it; if this fails the next load tries again.
      const markMigrated = async () => {
        try {
          await deps.legacy?.markMigrated(roomId);
        } catch (err) {
          logger.error({ err: err instanceof Error ? err.message : String(err), roomId }, 'Could not mark room as migrated');
        }
      };

      // A read-only open (the projection, P2-09) must change nothing: it does not seed a legacy room
      // and does not mark it migrated, however it is opened.
      const readOnly = Boolean((context as { projection?: boolean } | undefined)?.projection);

      const state = await store.load(roomId);
      if (state) {
        Y.applyUpdate(document, state);
        if (!readOnly) await markMigrated();
        return;
      }
      if (!deps.legacy || readOnly) return;

      // First open since collab: build the document from the room's legacy files.
      // The seed is deterministic, so replicas that race to do this merge into one copy.
      const files = await deps.legacy.loadFiles(roomId);
      if (files.length > 0) {
        Y.applyUpdate(document, buildSeedUpdate(files));
        await store.store(roomId, document); // persist now: loading does not trigger a store
        logger.info({ event: 'collab.seeded', roomId, files: files.length }, 'seeded room from legacy files');
      }
      await markMigrated();
    },

    async onStoreDocument({ documentName, document }) {
      const roomId = parseDocumentName(documentName);
      if (!roomId) return;
      try {
        await store.store(roomId, document);
      } catch (err) {
        // The document stays in memory and the next change retries; make the failure visible.
        logger.error({ err: err instanceof Error ? err.message : String(err), roomId }, 'Failed to persist room document');
        throw err;
      }
    },

    async afterUnloadDocument({ documentName }) {
      const roomId = parseDocumentName(documentName);
      if (!roomId) return;
      store.release?.(roomId);
      announced.delete(roomId);
      lockService.forget(roomId);
    },

    // --- Focus locks (P2-08) ---

    async onListen({ instance }) {
      tick = setInterval(() => void runTick(instance), deps.locks?.tickMs ?? DEFAULT_LOCK_TICK_MS);
      tick.unref();
    },

    async onDestroy() {
      clearInterval(tick);
      lockRedis?.disconnect();
    },

    /** Tell a new connection who holds what, before it has to ask. */
    async connected({ connection, context }) {
      try {
        connection.sendStateless(encode({ type: 'locks.snapshot', ...(await lockService.snapshot(context.roomId, true)) }));
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err), roomId: context.roomId }, 'could not send lock state');
      }
    },

    async onStateless({ connection, document, payload }) {
      const context = connection.context as CollabContext | undefined;
      if (!context || payload.length > MAX_STATELESS_BYTES) return;
      let request;
      try {
        request = lockRequestSchema.parse(JSON.parse(payload));
      } catch {
        return; // not a lock request
      }
      const outcome = await lockService.handle(
        { roomId: context.roomId, user: { userId: context.user.userId, name: context.user.name ?? '' }, connectionId: connection.socketId, document },
        request,
      );
      if (outcome.reply) connection.sendStateless(encode(outcome.reply));
      publish(context.roomId, document, outcome);
    },

    /**
     * An edit to a file somebody else has locked is dropped. Hocuspocus already drops edits from a
     * read-only connection and answers "not saved", so the connection is made read-only for this one
     * message (afterHandleMessage restores it) rather than closed, and the sender is told which file.
     */
    async beforeHandleMessage({ update, document, context, connection }) {
      const edit = writableUpdate(update);
      if (!edit) return;
      const rejection = await lockService.rejects(context.roomId, context.user.userId, document, edit);
      if (!rejection) return;
      droppingEdits.set(connection, connection.readOnly);
      connection.readOnly = true;
      connection.sendStateless(encode(rejection));
      logger.info(
        { event: 'collab.lock.rejected', roomId: context.roomId, userId: context.user.userId, files: rejection.type === 'locks.rejected' ? rejection.fileIds : [] },
        'edit to a locked file dropped',
      );
    },

    async afterHandleMessage({ connection }) {
      if (!droppingEdits.has(connection)) return;
      connection.readOnly = droppingEdits.get(connection) ?? false;
      droppingEdits.delete(connection);
    },

    async beforeHandleAwareness(payload) {
      guardAwareness(payload);
    },

    async onDisconnect({ documentName, context, clientsCount, document, socketId }) {
      logger.info(
        { event: 'collab.disconnect', roomId: context?.roomId, userId: context?.user?.userId, documentName, clientsCount },
        'connection closed',
      );
      if (context?.roomId) publish(context.roomId, document, await lockService.releaseConnection(context.roomId, socketId));
    },

    async onRequest({ request, response, instance }) {
      const path = (request.url ?? '').split('?')[0];
      const files = request.method === 'GET' ? FILES_ROUTE.exec(path) : null;
      if (files) {
        await serveRoomFiles(request, response, instance, files[1]);
      } else if (path === '/health') {
        const body = {
          status: 'ok',
          service: 'collab',
          release,
          uptimeSec: Math.round((Date.now() - startedAt) / 1000),
          documents: instance.getDocumentsCount(),
          connections: instance.getConnectionsCount(),
          // For the load test (P2-13) and anyone watching a replica: is memory steady under load?
          memory: processMemory(),
          redis: await checkRedisHealth(redis?.pub),
        };
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(body));
      } else {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'Not found.' }));
      }
      // Hocuspocus stops its default "Welcome" reply when the hook throws a falsy value.
      // eslint-disable-next-line no-throw-literal
      throw null;
    },
  });
}
