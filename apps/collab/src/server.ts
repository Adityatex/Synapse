import { Server, type Extension } from '@hocuspocus/server';
import { Redis as RedisExtension } from '@hocuspocus/extension-redis';
import { Throttle } from '@hocuspocus/extension-throttle';
import { checkRedisHealth, createRedisClient } from '@synapse/redis';
import { buildSeedUpdate } from '@synapse/room-doc';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import { AuthError, documentNameFor, parseDocumentName, verifyAccessToken, type AuthUser } from './auth.js';
import type { DocStore } from '@synapse/ydoc-store';
import type { LegacyRooms } from './legacyRooms.js';
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
}

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
  async function serveRoomFiles(request: IncomingMessage, response: ServerResponse, instance: Hocuspocus, roomParam: string) {
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
      const state = await store.load(roomId);
      if (state) {
        Y.applyUpdate(document, state);
        return;
      }
      // A read-only open (the projection) must not turn a legacy room into a collab room just by looking.
      if (!deps.legacy || (context as { projection?: boolean } | undefined)?.projection) return;

      // First open since collab: build the document from the room's legacy files.
      // The seed is deterministic, so replicas that race to do this merge into one copy.
      const files = await deps.legacy.loadFiles(roomId);
      if (files.length === 0) return;
      Y.applyUpdate(document, buildSeedUpdate(files));
      await store.store(roomId, document); // persist now: loading does not trigger a store
      logger.info({ event: 'collab.seeded', roomId, files: files.length }, 'seeded room from legacy files');
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
      if (roomId) store.release?.(roomId);
    },

    async onDisconnect({ documentName, context, clientsCount }) {
      logger.info(
        { event: 'collab.disconnect', roomId: context?.roomId, userId: context?.user?.userId, documentName, clientsCount },
        'connection closed',
      );
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
