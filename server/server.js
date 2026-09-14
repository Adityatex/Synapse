const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// P0-06: fail fast on bad config — exits(1) BEFORE listen() or DB connects.
const { loadEnvOrExit } = require('./config/env');
const logger = require('./config/logger');
const { initSentry, captureError } = require('./config/sentry');

loadEnvOrExit();

// P0-10: error tracking (no-op without SENTRY_DSN).
initSentry();

const executeRoute = require('./routes/execute');
const aiRoute = require('./routes/ai');
const authRoute = require('./routes/auth');
const roomsRoute = require('./routes/rooms');
const { globalLimiter } = require('./middleware/rateLimits');
const requestIdMiddleware = require('./middleware/requestId');
const { createSocketServer } = require('./socket/socketManager');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;
const allowedOrigins = (process.env.CORS_ORIGIN || process.env.CLIENT_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const MONGO_RETRY_DELAY_MS = Number(process.env.MONGO_RETRY_DELAY_MS || 5000);
const MONGO_SERVER_SELECTION_TIMEOUT_MS = Number(
  process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000
);
const MONGO_SOCKET_TIMEOUT_MS = Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000);
let serverStarted = false;
let reconnectTimer = null;
let connectInFlight = null;
let shuttingDown = false;

// P0-05: security headers. Two deliberate relaxations for a cross-origin
// JSON API (documented, not accidental):
// - contentSecurityPolicy off: we serve JSON, never HTML; CSP would be noise.
// - CORP cross-origin: the web app lives on a different origin (Vercel) than
//   the API (Render/Fly); same-origin CORP risks breaking legit API + polling loads.
//   CORS allow-list below remains the real origin gate.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// P0-05/P0-07: correlation ID before anything that can reject (429/413/401).
app.use(requestIdMiddleware);

// P0-09: structured HTTP logs. Reuses the correlation ID above so the access
// log, the error body and the X-Request-Id header all carry the same value.
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.id,
    customProps: (req) => ({
      requestId: req.id,
      userId: req.user ? req.user.userId : undefined,
    }),
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

// P0-02: global per-IP guard (300/min). Specific routes add stricter limits.
app.use(globalLimiter);

// P0-05: tight default body budget (100 kB), mounted per router. The execution
// API declares its own 2 MB budget inside routes/execute.js (full source files
// + stdin). A single global parser would force one budget on everything: either
// too generous for auth (413 bypass) or too tight for execute.
app.use('/api/ai', express.json({ limit: '100kb' }), aiRoute);
app.use('/api/auth', express.json({ limit: '100kb' }), authRoute);
app.use('/api/rooms', express.json({ limit: '100kb' }), roomsRoute);
app.use('/api', executeRoute);

// P0-05: body-parser errors default to HTML — return JSON instead.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large.', requestId: req.id });
  }

  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON body.', requestId: req.id });
  }

  return next(err);
});

// P0-10: safety net — anything escaping the routes above is reported with
// request/user context, then answered with the standard error envelope.
app.use((err, req, res, next) => {
  captureError(err, { userId: req.user ? req.user.userId : undefined, requestId: req.id });
  logger.error({ requestId: req.id, err }, 'Unhandled error');

  if (res.headersSent) {
    return next(err);
  }

  res.status(err.status || 500).json({ error: 'Something went wrong.', requestId: req.id });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

createSocketServer(server);

function startServerIfNeeded() {
  if (serverStarted) {
    return;
  }

  serverStarted = true;
  server.listen(PORT, () => {
    logger.info({ port: PORT }, 'Synapse server running');
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

  logger.warn({ retryDelayMs: MONGO_RETRY_DELAY_MS, reason }, 'MongoDB reconnect scheduled');

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToMongoWithRetry().catch((retryErr) => {
      logger.error({ err: retryErr }, 'MongoDB reconnect error');
      scheduleMongoReconnect('retry failed');
    });
  }, MONGO_RETRY_DELAY_MS);
}

async function connectToMongoWithRetry() {
  if (!process.env.MONGODB_URI) {
    logger.error('MongoDB connection skipped: MONGODB_URI is not configured.');
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
    logger.error({ err }, 'MongoDB connection error');
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
  logger.error({ err }, 'MongoDB runtime error');
  if (!shuttingDown) {
    scheduleMongoReconnect('runtime error');
  }
});

connectToMongoWithRetry().catch((err) => {
  logger.error({ err }, 'MongoDB bootstrap error');
  startServerIfNeeded();
  scheduleMongoReconnect('bootstrap failed');
});

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  clearReconnectTimer();
  logger.info({ signal }, 'Shutting down gracefully...');

  try {
    await mongoose.connection.close();
  } catch (error) {
    logger.error({ err: error }, 'MongoDB close error during shutdown');
  }

  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', () => {
  shutdown('SIGINT').catch((err) => {
    logger.error({ err }, 'SIGINT shutdown error');
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch((err) => {
    logger.error({ err }, 'SIGTERM shutdown error');
    process.exit(1);
  });
});

process.on('exit', (code) => logger.info({ code }, 'Process exit event'));
process.on('uncaughtException', (err) => {
  captureError(err, {});
  logger.error({ err }, 'Uncaught Exception');
});
process.on('unhandledRejection', (reason) => {
  captureError(reason instanceof Error ? reason : new Error(String(reason)), {});
  logger.error({ reason }, 'Unhandled Rejection');
});
