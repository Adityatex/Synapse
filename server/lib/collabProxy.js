'use strict';

const net = require('net');
const { logger } = require('./logger');

// In the production image the api and the collab server run side by side and only the api's port is
// published (Fly, the Cloudflare tunnel). Browsers open their WebSocket to `/collab` on the page's own
// origin; this passes those upgrades on to the collab server, which is on the same machine. Nothing
// is parsed or buffered: after the handshake the two sockets are joined, so Hocuspocus sees the
// connection as if it had been made to it directly. Authentication stays the collab server's (the
// token travels inside the WebSocket protocol, as it does when the client connects to it directly).

const PREFIX = '/collab';

function isCollabPath(url = '') {
  const path = url.split('?')[0];
  return path === PREFIX || path.startsWith(`${PREFIX}/`);
}

/** `/collab?x=1` -> `/?x=1`, `/collab/a` -> `/a`. */
function upstreamUrl(url) {
  const rest = url.slice(PREFIX.length);
  if (rest === '') return '/';
  return rest.startsWith('?') ? `/${rest}` : rest;
}

/**
 * Passes WebSocket upgrades for `/collab` on `httpServer` to the collab server at `targetUrl`
 * (for example `http://127.0.0.1:5001`). Returns false, and does nothing, if the URL is unusable.
 * Other upgrades (Socket.IO's) are left to their own listeners.
 */
function attachCollabProxy(httpServer, targetUrl) {
  let target;
  try {
    target = new URL(targetUrl);
  } catch {
    return false;
  }
  const port = Number(target.port) || (target.protocol === 'https:' ? 443 : 80);
  const host = target.hostname;

  httpServer.on('upgrade', (req, socket, head) => {
    if (!isCollabPath(req.url)) return;

    const upstream = net.connect(port, host);
    const closeBoth = () => {
      socket.destroy();
      upstream.destroy();
    };
    upstream.on('error', (err) => {
      logger.warn({ err: err.message, host, port }, 'collab proxy: collab server unreachable');
      closeBoth();
    });
    socket.on('error', closeBoth);
    upstream.on('close', closeBoth);
    socket.on('close', closeBoth);

    upstream.on('connect', () => {
      const lines = [`${req.method} ${upstreamUrl(req.url)} HTTP/${req.httpVersion}`];
      let forwarded = false;
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        if (req.rawHeaders[i].toLowerCase() === 'x-forwarded-for') forwarded = true;
        lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      // The collab server limits connections per client address and reads it from this header.
      if (!forwarded && socket.remoteAddress) lines.push(`X-Forwarded-For: ${socket.remoteAddress}`);
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head && head.length > 0) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
  });
  return true;
}

module.exports = { attachCollabProxy, isCollabPath, upstreamUrl };
