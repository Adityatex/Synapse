'use strict';

const { createRedisClient, checkRedisHealth } = require('@synapse/redis');
const { logger } = require('./logger');

const ERROR_LOG_INTERVAL_MS = 30_000;

let client = null;
let lastErrorLoggedAt = 0;

/**
 * Connects to Redis when REDIS_URL is set. Nothing depends on it yet (P2-02);
 * later phases build rate limits, locks and fan-out on this client. Without a
 * URL the process runs exactly as before.
 */
function initRedis(url = process.env.REDIS_URL) {
  if (client || !url) return client;
  client = createRedisClient(url, {
    name: 'synapse-api',
    // ioredis emits one error per reconnect attempt; don't flood the log.
    onError: (err) => {
      const now = Date.now();
      if (now - lastErrorLoggedAt < ERROR_LOG_INTERVAL_MS) return;
      lastErrorLoggedAt = now;
      logger.warn({ err: err.message }, 'Redis connection error (retrying)');
    },
  });
  return client;
}

function getRedis() {
  return client;
}

function redisHealth() {
  return checkRedisHealth(client);
}

async function closeRedis() {
  if (!client) return;
  const closing = client;
  client = null;
  try {
    await closing.quit();
  } catch {
    closing.disconnect();
  }
}

module.exports = { initRedis, getRedis, redisHealth, closeRedis };
