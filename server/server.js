const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
require('dotenv').config();

const executeRoute = require('./routes/execute');
const authRoute = require('./routes/auth');
const roomsRoute = require('./routes/rooms');
const { createSocketServer } = require('./socket/socketManager');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Routes
app.use('/api', executeRoute);
app.use('/api/auth', authRoute);
app.use('/api/rooms', roomsRoute);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

createSocketServer(server);

// Connect to MongoDB then start server
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB (Synapse database)');
    server.listen(PORT, () => {
      console.log(`🚀 Synapse server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
    // Start server anyway so code execution still works
    server.listen(PORT, () => {
      console.log(`🚀 Synapse server running on http://localhost:${PORT} (without DB)`);
    });
  });

// Workaround to keep the event loop alive under nodemon/watch mode
setInterval(() => {}, 1000 * 60 * 60);

process.on('exit', (code) => console.log('Process exit event with code: ', code));
process.on('uncaughtException', (err) => console.error('Uncaught Exception', err));
process.on('unhandledRejection', (reason, promise) =>
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
);
