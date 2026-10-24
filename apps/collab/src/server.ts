import { Server } from '@hocuspocus/server';
import { Redis as RedisExtension } from '@hocuspocus/extension-redis';
import { Throttle } from '@hocuspocus/extension-throttle';
import { checkRedisHealth, createRedisClient } from '@synapse/redis';
import * as Y from 'yjs';
import { AuthError, documentNameFor, parseDocumentName, verifyAccessToken, type AuthUser } from './auth.js';
import type { DocStore } from './docStore.js';
import type { Logger } from './logger.js';
import type { RoomAccess } from './roomAccess.js';

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
  /** Without a Redis URL the server runs single-instance. */
  redisUrl?: string;
  connectionsPerMin?: number;
  release?: string;
  /** Quiet period before a changed document is persisted. Tests shorten it. */
  storeDebounceMs?: number;
}

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

  const extensions = [
    new Throttle({ throttle: deps.connectionsPerMin ?? 300, consideredSeconds: 60, banTime: 5 }),
    ...(redis ? [redis] : []),
  ];

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

    async onLoadDocument({ documentName, document }) {
      const roomId = parseDocumentName(documentName);
      if (!roomId) return;
      const state = await store.load(roomId);
      if (state) Y.applyUpdate(document, state);
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
      if (path === '/health') {
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
