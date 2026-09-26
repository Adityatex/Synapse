'use strict';

// P1-09: socket harness — boots the real socket server on an ephemeral port
// and returns an authenticated client. Caller owns teardown.

const http = require('http');
const jwt = require('jsonwebtoken');
const { io: clientIo } = require('socket.io-client');
const { createSocketServer } = require('../../socket/socketManager');

function signToken(user) {
  return jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function startSocketHarness() {
  const httpServer = http.createServer();
  createSocketServer(httpServer);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;
  return { httpServer, port };
}

function connectAuthedClient(port, user) {
  return new Promise((resolve, reject) => {
    const socket = clientIo(`http://127.0.0.1:${port}`, {
      auth: { token: signToken(user) },
      reconnection: false,
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err) => reject(err));
    setTimeout(() => reject(new Error('socket connect timeout')), 10_000);
  });
}

function waitFor(socket, event, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function stopSocketHarness({ httpServer, sockets = [] }) {
  await Promise.all(
    sockets.map(
      (s) =>
        new Promise((resolve) => {
          if (!s.connected) return resolve();
          s.once('disconnect', () => resolve());
          s.disconnect();
          setTimeout(resolve, 1_000);
        })
    )
  );
  await new Promise((resolve) => httpServer.close(() => resolve()));
}

module.exports = { signToken, startSocketHarness, connectAuthedClient, waitFor, stopSocketHarness };
