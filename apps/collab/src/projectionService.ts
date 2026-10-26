import type { Hocuspocus } from '@hocuspocus/server';
import { createRedisClient } from '@synapse/redis';
import { projectRoom, type RoomProjection } from '@synapse/room-doc';
import { documentNameFor } from './auth.js';
import type { Logger } from './logger.js';

/**
 * The room's files as plain text (P2-09), for running code, building AI context and exporting.
 *
 * It reads the live document: this replica's copy when the room is loaded here, otherwise the
 * room is opened through a direct connection, which loads the stored state (without seeding from
 * legacy files, see PROJECTION_CONTEXT) and, with Redis, syncs with the replica that has it live.
 * The result is cached in Redis for a few seconds so a burst of AI questions costs one read;
 * `fresh` skips the cached copy for callers who must run what is on screen.
 */

/** Marks a direct connection that only reads: onLoadDocument must not seed the room from legacy files. */
export const PROJECTION_CONTEXT = { projection: true } as const;

export type ProjectionSource = 'cache' | 'live';
export interface ProjectionResult extends RoomProjection {
  source: ProjectionSource;
}

/** The part of a Redis client the cache uses. */
export interface CacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'PX', ms: number): Promise<unknown>;
  disconnect(): void;
}

export interface ProjectionOptions {
  redisUrl?: string;
  /** Test seam: a client to use instead of connecting to `redisUrl`. */
  client?: CacheClient;
  logger: Logger;
  /** How long a computed projection is reused. */
  cacheMs?: number;
  /** After opening a room that is not loaded here, how long to let other replicas answer its sync. */
  syncWaitMs?: number;
}

const cacheKey = (roomId: string) => `synapse:projection:${roomId}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createProjectionService(options: ProjectionOptions) {
  const { logger, cacheMs = 5_000, syncWaitMs = 150 } = options;
  // Request-path client: fails fast when Redis is down, and the cache simply is not used.
  const client =
    options.client ??
    (options.redisUrl
      ? createRedisClient(options.redisUrl, {
          name: 'synapse-collab-projection',
          onError: (err) => logger.warn({ err: err.message }, 'Redis connection error (projection cache)'),
        })
      : null);
  const syncs = Boolean(options.redisUrl);

  async function fromCache(roomId: string): Promise<RoomProjection | null> {
    if (!client) return null;
    try {
      const raw = await client.get(cacheKey(roomId));
      return raw ? (JSON.parse(raw) as RoomProjection) : null;
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), roomId }, 'projection cache read failed');
      return null;
    }
  }

  async function toCache(roomId: string, projection: RoomProjection): Promise<void> {
    if (!client) return;
    try {
      await client.set(cacheKey(roomId), JSON.stringify(projection), 'PX', cacheMs);
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), roomId }, 'projection cache write failed');
    }
  }

  return {
    async read(instance: Hocuspocus, roomId: string, { fresh = false } = {}): Promise<ProjectionResult> {
      if (!fresh) {
        const cached = await fromCache(roomId);
        if (cached) return { ...cached, source: 'cache' };
      }

      const name = documentNameFor(roomId);
      const loaded = instance.documents.get(name);
      let projection: RoomProjection;
      if (loaded) {
        projection = projectRoom(loaded);
      } else {
        const connection = await instance.openDirectConnection(name, PROJECTION_CONTEXT);
        try {
          // Loading asked the other replicas for their state; give them a moment to answer.
          if (syncs) await sleep(syncWaitMs);
          projection = projectRoom(connection.document!);
        } finally {
          await connection.disconnect();
        }
      }

      await toCache(roomId, projection);
      return { ...projection, source: 'live' };
    },

    async close(): Promise<void> {
      if (!options.client) client?.disconnect();
    },
  };
}

export type ProjectionService = ReturnType<typeof createProjectionService>;
