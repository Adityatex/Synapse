'use strict';

const { createAdapter } = require('@socket.io/redis-adapter');
const { createRedisClient } = require('@synapse/redis');
const { logger } = require('./logger');

const ERROR_LOG_INTERVAL_MS = 30_000;

/**
 * Lets several api replicas behave as one Socket.IO server (P2-11): a message emitted to a room
 * through one replica reaches the sockets of that room connected to the others.
 *
 * The adapter publishes without waiting for the result, so a failed publish would surface as an
 * unhandled rejection. Publishing therefore fails soft here: during a Redis outage a room's
 * messages still reach the sockets on this replica (and are saved by the caller), only delivery to
 * the other replicas is lost until Redis is back. Without a URL there is nothing to set up.
 *
 * @returns {{ adapter: Function, close: () => Promise<void> } | null}
 */
function createSocketAdapter(url = process.env.REDIS_URL, { key = 'synapse:socket.io' } = {}) {
  if (!url) return null;

  let lastErrorLoggedAt = 0;
  const onError = (err) => {
    const now = Date.now();
    if (now - lastErrorLoggedAt < ERROR_LOG_INTERVAL_MS) return;
    lastErrorLoggedAt = now;
    logger.warn({ err: err.message }, 'Socket.IO Redis adapter error (retrying)');
  };

  // Publishing fails fast while disconnected; the subscriber queues its subscribe until it connects.
  const pub = createRedisClient(url, { name: 'synapse-api-socket-pub', onError });
  const sub = createRedisClient(url, {
    name: 'synapse-api-socket-sub',
    onError,
    redis: { enableOfflineQueue: true, maxRetriesPerRequest: null },
  });

  const publish = pub.publish.bind(pub);
  pub.publish = (...args) =>
    publish(...args).catch((err) => {
      onError(err);
      return 0;
    });

  return {
    adapter: createAdapter(pub, sub, { key }),
    async close() {
      pub.disconnect();
      sub.disconnect();
    },
  };
}

module.exports = { createSocketAdapter };
