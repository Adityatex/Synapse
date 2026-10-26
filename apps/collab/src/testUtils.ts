// Shared helpers for the integration tests. Not part of the build (see tsconfig.build.json).
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import type { Server } from '@hocuspocus/server';
import jwt from 'jsonwebtoken';
import { connect as tcpConnect, createServer, type Server as NetServer, type Socket } from 'node:net';
import { pino } from 'pino';
import * as Y from 'yjs';
import { documentNameFor } from './auth.js';
import { MemoryDocStore, type DocStore } from '@synapse/ydoc-store';
import type { LegacyRooms } from './legacyRooms.js';
import { decideAccess, type RoomAccess, type RoomAccessRecord } from './roomAccess.js';
import { createCollabServer, type CollabContext, type CollabDeps } from './server.js';

export const SECRET = 'integration-secret-long-enough-1234567890';

const logger = pino({ level: 'silent' });
const servers: Server<CollabContext>[] = [];
const providers: HocuspocusProvider[] = [];
const proxies: Array<() => Promise<void>> = [];
const sockets: HocuspocusProviderWebsocket[] = [];
const trackSocket = (socket: HocuspocusProviderWebsocket) => (sockets.push(socket), socket);

// Hocuspocus treats port 0 as "use the default (80)", so ask the OS for a free port first.
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

export const randomRoomId = () => Math.random().toString(36).slice(2, 10).toUpperCase().padEnd(8, 'X');
export const tokenFor = (userId: string) => jwt.sign({ userId, name: userId, email: `${userId}@x.io` }, SECRET);

export function fakeAccess(rooms: Record<string, RoomAccessRecord>): RoomAccess {
  return {
    check: async (roomId, userId) => decideAccess(rooms[roomId] ?? null, userId),
    // Read on every call, so a test can flip `locksEnabled` on the record mid-run.
    settings: async (roomId) => (rooms[roomId] ? { locksEnabled: rooms[roomId].locksEnabled === true, collabVersion: rooms[roomId].collabVersion ?? null } : null),
  };
}

export async function startServer(opts: {
  access: RoomAccess;
  store?: DocStore;
  legacy?: LegacyRooms;
  redisUrl?: string;
  storeDebounceMs?: number;
  projection?: CollabDeps['projection'];
  locks?: CollabDeps['locks'];
}): Promise<Server<CollabContext>> {
  const server = createCollabServer({ jwtSecret: SECRET, logger, store: new MemoryDocStore(), ...opts });
  await server.listen(await freePort());
  servers.push(server);
  return server;
}

export type Client = {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  synced: Promise<void>;
  denied: Promise<string>;
  /** Stateless messages from the server, parsed, oldest first. */
  messages: Array<Record<string, any>>;
};

export interface ConnectExtras {
  /** Connect here instead of straight to the server, for example through a proxy that can be cut. */
  url?: string;
  /** A function is asked again on every (re)connect, like the real client does. */
  token?: string | (() => string);
  /** Reconnect timing (delay, minDelay, maxDelay, jitter...), set on the socket as the client does; tests shorten the delays. */
  socketOptions?: Record<string, unknown>;
}

export function connect(
  server: Server<CollabContext>,
  roomId: string,
  token?: string,
  documentName = documentNameFor(roomId),
  extras: ConnectExtras = {},
): Client {
  const doc = new Y.Doc();
  let resolveSynced!: () => void;
  let resolveDenied!: (reason: string) => void;
  const messages: Client['messages'] = [];
  const synced = new Promise<void>((r) => (resolveSynced = r));
  const denied = new Promise<string>((r) => (resolveDenied = r));
  const provider = new HocuspocusProvider({
    ...(extras.socketOptions
      ? { websocketProvider: trackSocket(new HocuspocusProviderWebsocket({ url: extras.url ?? server.webSocketURL, ...extras.socketOptions })) }
      : { url: extras.url ?? server.webSocketURL }),
    name: documentName,
    document: doc,
    token: extras.token ?? token ?? '',
    onSynced: () => resolveSynced(),
    onAuthenticationFailed: ({ reason }) => resolveDenied(reason),
    onStateless: ({ payload }) => {
      try {
        messages.push(JSON.parse(payload));
      } catch {
        /* not ours */
      }
    },
  });
  if (extras.socketOptions) provider.attach(); // a socket we supply is not attached for us
  providers.push(provider);
  return { doc, provider, synced, denied, messages };
}

export async function waitFor(check: () => boolean | Promise<boolean>, ms = 8000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Call from afterEach: disconnects clients first, then flushes and stops servers. */
export async function closeAll(): Promise<void> {
  for (const p of providers.splice(0)) p.destroy();
  for (const s of sockets.splice(0)) s.destroy();
  for (const stop of proxies.splice(0)) await stop();
  for (const s of servers.splice(0)) await s.destroy();
}

/** Stops one server (flushing its pending stores) without touching the others. */
export async function stopServer(server: Server<CollabContext>): Promise<void> {
  const index = servers.indexOf(server);
  if (index >= 0) servers.splice(index, 1);
  await server.destroy();
}

/**
 * A TCP proxy in front of a collab server that can be cut and restored, to stand in for the
 * network going away: `cut()` drops every open connection and refuses new ones.
 */
export async function startProxy(server: Server<CollabContext>) {
  const target = new URL(server.webSocketURL);
  const port = await freePort();
  const sockets = new Set<Socket>();
  let listener: NetServer | null = null;

  const open = () =>
    new Promise<void>((resolve) => {
      listener = createServer((client) => {
        const upstream = tcpConnect(Number(target.port), target.hostname);
        for (const socket of [client, upstream]) {
          sockets.add(socket);
          socket.on('error', () => socket.destroy());
          socket.on('close', () => sockets.delete(socket));
        }
        client.on('close', () => upstream.destroy());
        upstream.on('close', () => client.destroy());
        client.pipe(upstream);
        upstream.pipe(client);
      });
      listener.listen(port, '127.0.0.1', () => resolve());
    });
  await open();

  const stop = async () => {
    const closing = listener;
    listener = null;
    // Drop the connections first: a listener only finishes closing once they are gone.
    for (const socket of [...sockets]) socket.destroy();
    if (closing) await new Promise<void>((resolve) => closing.close(() => resolve()));
  };
  proxies.push(stop);
  return { url: `ws://127.0.0.1:${port}`, cut: stop, restore: open };
}
