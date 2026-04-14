const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const executeRoute = require('./routes/execute');
const aiRoute = require('./routes/ai');
const authRoute = require('./routes/auth');
const roomsRoute = require('./routes/rooms');
const { createSocketServer } = require('./socket/socketManager');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;
const MONGO_RETRY_DELAY_MS = Number(process.env.MONGO_RETRY_DELAY_MS || 5000);
let serverStarted = false;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use('/api', executeRoute);
app.use('/api/ai', aiRoute);
app.use('/api/auth', authRoute);
app.use('/api/rooms', roomsRoute);

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

async function connectToMongoWithRetry() {
  if (!process.env.MONGODB_URI) {
    console.error('MongoDB connection skipped: MONGODB_URI is not configured.');
    startServerIfNeeded();
    return;
  }

  if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
    startServerIfNeeded();
    return;
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB (Synapse database)');
    startServerIfNeeded();
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    startServerIfNeeded();
    setTimeout(() => {
      connectToMongoWithRetry().catch((retryErr) => {
        console.error('MongoDB retry scheduling error:', retryErr.message);
      });
    }, MONGO_RETRY_DELAY_MS);
  }
}

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected. Retrying connection...');
  setTimeout(() => {
    connectToMongoWithRetry().catch((retryErr) => {
      console.error('MongoDB reconnect error:', retryErr.message);
    });
  }, MONGO_RETRY_DELAY_MS);
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB runtime error:', err.message);
});

connectToMongoWithRetry().catch((err) => {
  console.error('MongoDB bootstrap error:', err.message);
  startServerIfNeeded();
});

setInterval(() => {}, 1000 * 60 * 60);

process.on('exit', (code) => console.log('Process exit event with code:', code));
process.on('uncaughtException', (err) => console.error('Uncaught Exception', err));
process.on('unhandledRejection', (reason, promise) =>
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
);
