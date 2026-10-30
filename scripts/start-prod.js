#!/usr/bin/env node
// Entrypoint of the production image (root Dockerfile): the api and the collab server in one container.
// The api serves the client, the API and Socket.IO on PORT and passes /collab on to the collab server
// (server/lib/collabProxy.js), so a single published port is enough (Fly, the Cloudflare tunnel).
//
// If either process stops, the other is stopped and the container exits with a failure, so the
// platform's restart policy brings both back; running half a room is worse than restarting.
const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname);
const COLLAB_PORT = process.env.COLLAB_PORT || '5001';

const children = [
  {
    name: 'collab',
    args: [path.join(root, 'collab', 'dist', 'index.js')],
    // PORT is the api's; the collab server listens on its own.
    env: { ...process.env, PORT: COLLAB_PORT },
  },
  {
    name: 'api',
    args: [path.join(root, 'server', 'server.js')],
    env: { ...process.env, COLLAB_INTERNAL_URL: process.env.COLLAB_INTERNAL_URL || `http://127.0.0.1:${COLLAB_PORT}` },
  },
];

let stopping = false;
let exitCode = 0;
const running = new Map();

function stopAll(signal) {
  stopping = true;
  for (const child of running.values()) child.kill(signal);
  // A process that ignores the signal must not keep the container alive forever.
  setTimeout(() => process.exit(exitCode || 1), 15_000).unref();
}

for (const { name, args, env } of children) {
  const child = spawn(process.execPath, args, { env, stdio: 'inherit' });
  running.set(name, child);
  child.on('exit', (code, signal) => {
    running.delete(name);
    if (!stopping) {
      console.error(`[start-prod] ${name} exited (${signal || code}); stopping the others`);
      exitCode = code || 1;
      stopAll('SIGTERM');
    }
    if (running.size === 0) process.exit(exitCode);
  });
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (!stopping) stopAll(signal);
  });
}
