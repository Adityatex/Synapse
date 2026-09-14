const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

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
    console.log(`Synapse server running on http://localhost:${PORT}`);
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

  console.warn(
    `MongoDB reconnect scheduled in ${MONGO_RETRY_DELAY_MS}ms${reason ? ` (${reason})` : ''}.`
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToMongoWithRetry().catch((retryErr) => {
      console.error('MongoDB reconnect error:', retryErr.message);
      scheduleMongoReconnect('retry failed');
    });
  }, MONGO_RETRY_DELAY_MS);
}

async function connectToMongoWithRetry() {
  if (!process.env.MONGODB_URI) {
    console.error('MongoDB connection skipped: MONGODB_URI is not configured.');
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
    console.log('Connected to MongoDB (Synapse database)');
    startServerIfNeeded();
  } catch (err) {
    connectInFlight = null;
    console.error('MongoDB connection error:', err.message);
    startServerIfNeeded();
    scheduleMongoReconnect('initial connect failed');
  }
}

mongoose.connection.on('disconnected', () => {
  if (shuttingDown) {
    return;
  }

  console.warn('MongoDB disconnected.');
  scheduleMongoReconnect('disconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB runtime error:', err.message);
  if (!shuttingDown) {
    scheduleMongoReconnect('runtime error');
  }
});

connectToMongoWithRetry().catch((err) => {
  console.error('MongoDB bootstrap error:', err.message);
  startServerIfNeeded();
  scheduleMongoReconnect('bootstrap failed');
});

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  clearReconnectTimer();
  console.log(`${signal} received. Shutting down gracefully...`);

  try {
    await mongoose.connection.close();
  } catch (error) {
    console.error('MongoDB close error during shutdown:', error.message);
  }

  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', () => {
  shutdown('SIGINT').catch((err) => {
    console.error('SIGINT shutdown error:', err);
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch((err) => {
    console.error('SIGTERM shutdown error:', err);
    process.exit(1);
  });
});

process.on('exit', (code) => console.log('Process exit event with code:', code));
process.on('uncaughtException', (err) => console.error('Uncaught Exception', err));
process.on('unhandledRejection', (reason, promise) =>
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
);
