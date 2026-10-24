const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const http = require('http');
const fs = require('fs');
const path = require('path');
const dns = require('dns');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Configure DNS resolution before anything connects (helps prevent Atlas SRV
// ENOTFOUND issues in cloud environments).
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder(process.env.DNS_RESULT_ORDER || 'ipv4first');
}
if (process.env.DNS_SERVERS) {
  try {
    dns.setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Failed to set custom DNS servers:', err.message);
  }
}

// P0-06: fail fast on invalid env (JWT_SECRET, MONGODB_URI, CORS_ORIGIN).
const { validateEnv } = require('./config/env');

let env;
try {
  env = validateEnv(process.env);
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(err.message);
  process.exit(1);
}

const { logger } = require('./lib/logger');
const { initSentry, captureException, getRelease } = require('./lib/sentry');

initSentry();

const executeRoute = require('./routes/execute');
const aiRoute = require('./routes/ai');
const authRoute = require('./routes/auth');
const roomsRoute = require('./routes/rooms');
const { globalLimiter } = require('./middleware/rateLimits');
const { requestIdMiddleware } = require('./middleware/requestId');
const { createSocketServer } = require('./socket/socketManager');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const PORT = env.PORT || process.env.PORT || 5000;
const allowedOrigins = (process.env.CORS_ORIGIN || process.env.CLIENT_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
// P0-05: helmet with sane defaults, plus a CSP that allows what the bundled
// client needs when the server serves it: Monaco loads from jsdelivr (scripts,
// styles, fonts, blob/data workers), Google Fonts, and same-origin websockets.
// upgrade-insecure-requests is off so the production build can also be tried
// over plain http://localhost (Fly and Cloudflare Tunnel already force https).
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'", 'ws:', 'wss:', 'https://cdn.jsdelivr.net', 'https://*.sentry.io'],
        workerSrc: ["'self'", 'blob:', 'data:'],
        upgradeInsecureRequests: null,
      },
    },
  })
);

// P0-07 + P0-09: correlation ID first, then structured request logging.
app.use(requestIdMiddleware);
app.use(
  pinoHttp({
    logger,
    customProps: (req) => ({ requestId: req.id }),
  })
);
// Serve the built client (client/dist) from the same origin when it exists —
// this is how the production image runs (Fly.io, Cloudflare Tunnel demo).
// Mounted before CORS and the global rate limit so asset loads don't count
// against the per-IP API budget. Unknown non-API GETs fall back to index.html
// for client-side routing.
const CLIENT_DIST_DIR = process.env.CLIENT_DIST_DIR || path.join(__dirname, '..', 'client', 'dist');
const CLIENT_INDEX_HTML = path.join(CLIENT_DIST_DIR, 'index.html');
if (fs.existsSync(CLIENT_INDEX_HTML)) {
  app.use(
    '/assets',
    express.static(path.join(CLIENT_DIST_DIR, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false })
  );
  app.use(express.static(CLIENT_DIST_DIR, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api/') || req.path === '/api' || req.path.startsWith('/socket.io')) return next();
    if (!req.accepts('html')) return next();
    res.set('Cache-Control', 'no-cache');
    return res.sendFile(CLIENT_INDEX_HTML);
  });
  logger.info({ dir: CLIENT_DIST_DIR }, 'Serving built client');
}

const MONGO_RETRY_DELAY_MS = Number(process.env.MONGO_RETRY_DELAY_MS || 5000);
const MONGO_SERVER_SELECTION_TIMEOUT_MS = Number(
  process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000
);
const MONGO_SOCKET_TIMEOUT_MS = Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000);
let serverStarted = false;
let reconnectTimer = null;
let connectInFlight = null;
let shuttingDown = false;

// Same-origin requests are always allowed: browsers send Origin on same-origin
// POSTs too, and when the server serves the client (e.g. behind a Cloudflare
// quick tunnel with a random hostname) the page's origin can't be known ahead.
function isSameOrigin(origin, req) {
  try {
    return new URL(origin).host === (req.get('x-forwarded-host') || req.get('host'));
  } catch {
    return false;
  }
}

app.use(
  cors((req, callback) => {
    const origin = req.get('origin');
    if (
      !origin ||
      allowedOrigins.length === 0 ||
      allowedOrigins.includes(origin) ||
      isSameOrigin(origin, req)
    ) {
      return callback(null, { origin: true, credentials: true });
    }

    return callback(new Error('Not allowed by CORS'));
  })
);
// P0-05: restrict JSON body size (was 5mb). 1mb still fits code submissions.
app.use(express.json({ limit: '1mb' }));

// P0-02: global per-IP guard (300/min). Specific routes add stricter limits.
app.use(globalLimiter);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    release: getRelease(),
    uptimeSec: Math.round(process.uptime()),
    requestId: req.id,
  });
});

app.use('/api', executeRoute);
app.use('/api/ai', aiRoute);
app.use('/api/auth', authRoute);
app.use('/api/rooms', roomsRoute);

// P0-07: generic 404 + error envelope with correlation ID. Never leak stacks.
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.', requestId: req.id });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err && err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  captureException(err, { extra: { requestId: req && req.id, path: req && req.path } });
  if (req && req.log) {
    req.log.error({ err, requestId: req.id, status }, 'unhandled request error');
  } else {
    logger.error({ err: String((err && err.stack) || err), requestId: req && req.id }, 'unhandled request error');
  }
  if (res.headersSent) return next(err);
  res.status(status).json({
    error: status >= 500 ? 'Something went wrong. Please try again later.' : err.message || 'Request failed.',
    requestId: req && req.id,
  });
});

createSocketServer(server);

function startServerIfNeeded() {
  if (serverStarted) {
    return;
  }

  serverStarted = true;
  server.listen(PORT, () => {
    logger.info(`Synapse server running on http://localhost:${PORT}`);
  });
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleMongoReconnect(reason) {
  if (shuttingDown || reconnectTimer) {
    return;
  }

  logger.warn(
    `MongoDB reconnect scheduled in ${MONGO_RETRY_DELAY_MS}ms${reason ? ` (${reason})` : ''}.`
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToMongoWithRetry().catch((retryErr) => {
      logger.error({ err: retryErr.message }, 'MongoDB reconnect error');
      scheduleMongoReconnect('retry failed');
    });
  }, MONGO_RETRY_DELAY_MS);
}

async function connectToMongoWithRetry() {
  if (!process.env.MONGODB_URI) {
    logger.warn('MongoDB connection skipped: MONGODB_URI is not configured.');
    startServerIfNeeded();
    return;
  }

  if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
    clearReconnectTimer();
    startServerIfNeeded();
    return;
  }

  if (connectInFlight) {
    return connectInFlight;
  }

  try {
    connectInFlight = mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: MONGO_SERVER_SELECTION_TIMEOUT_MS,
      socketTimeoutMS: MONGO_SOCKET_TIMEOUT_MS,
      maxPoolSize: 10,
    });

    await connectInFlight;
    connectInFlight = null;
    clearReconnectTimer();
    logger.info('Connected to MongoDB (Synapse database)');
    startServerIfNeeded();
  } catch (err) {
    connectInFlight = null;
    logger.error({ err: err.message }, 'MongoDB connection error');
    startServerIfNeeded();
    scheduleMongoReconnect('initial connect failed');
  }
}

mongoose.connection.on('disconnected', () => {
  if (shuttingDown) {
    return;
  }

  logger.warn('MongoDB disconnected.');
  scheduleMongoReconnect('disconnected');
});

mongoose.connection.on('error', (err) => {
  logger.error({ err: err.message }, 'MongoDB runtime error');
  if (!shuttingDown) {
    scheduleMongoReconnect('runtime error');
  }
});

if (require.main === module) {
  connectToMongoWithRetry().catch((err) => {
    logger.error({ err: err.message }, 'MongoDB bootstrap error');
    startServerIfNeeded();
    scheduleMongoReconnect('bootstrap failed');
  });
}

module.exports = { app, server, validateEnv };

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  clearReconnectTimer();
  logger.info(`${signal} received. Shutting down gracefully...`);

  try {
    await mongoose.connection.close();
  } catch (error) {
    logger.error({ err: error.message }, 'MongoDB close error during shutdown');
  }

  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', () => {
  shutdown('SIGINT').catch((err) => {
    logger.error({ err: String(err) }, 'SIGINT shutdown error');
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch((err) => {
    logger.error({ err: String(err) }, 'SIGTERM shutdown error');
    process.exit(1);
  });
});

process.on('exit', (code) => logger.info({ code }, 'Process exit event'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught Exception');
  captureException(err);
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason: String(reason) }, 'Unhandled Rejection');
  captureException(reason instanceof Error ? reason : new Error(String(reason)));
});
