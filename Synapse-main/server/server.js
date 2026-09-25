const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

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
// P0-05: helmet with sane defaults.
app.use(helmet());

// P0-07 + P0-09: correlation ID first, then structured request logging.
app.use(requestIdMiddleware);
app.use(
  pinoHttp({
    logger,
    customProps: (req) => ({ requestId: req.id }),
  })
);
const MONGO_RETRY_DELAY_MS = Number(process.env.MONGO_RETRY_DELAY_MS || 5000);
const MONGO_SERVER_SELECTION_TIMEOUT_MS = Number(
  process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000
);
const MONGO_SOCKET_TIMEOUT_MS = Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000);
let serverStarted = false;
let reconnectTimer = null;
let connectInFlight = null;
let shuttingDown = false;

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
