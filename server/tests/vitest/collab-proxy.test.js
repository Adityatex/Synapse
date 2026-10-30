import { createRequire } from 'node:module';
import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { attachCollabProxy, isCollabPath, upstreamUrl } = require('../../lib/collabProxy');

// P2-14: in the production image the api passes /collab WebSocket upgrades on to the collab server.
describe('collab proxy', () => {
  const closers = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  // A stand-in for the collab server: records the handshake it receives, answers 101, then echoes.
  function startUpstream() {
    const seen = { head: '' };
    const sockets = new Set();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      let shook = false;
      socket.on('data', (chunk) => {
        if (!shook) {
          seen.head += chunk.toString('latin1');
          if (!seen.head.includes('\r\n\r\n')) return;
          shook = true;
          socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
          return;
        }
        socket.write(chunk); // echo
      });
      socket.on('close', () => sockets.delete(socket));
    });
    return new Promise((resolve) =>
      server.listen(0, '127.0.0.1', () => {
        closers.push(() => new Promise((done) => { sockets.forEach((s) => s.destroy()); server.close(done); }));
        resolve({ port: server.address().port, seen });
      })
    );
  }

  function startApi(targetUrl) {
    const server = http.createServer((_req, res) => res.end('api'));
    expect(attachCollabProxy(server, targetUrl)).toBe(true);
    const sockets = new Set();
    server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    return new Promise((resolve) =>
      server.listen(0, '127.0.0.1', () => {
        closers.push(() => new Promise((done) => { sockets.forEach((s) => s.destroy()); server.close(done); }));
        resolve(server.address().port);
      })
    );
  }

  function upgrade(port, path, extraHeaders = '') {
    const socket = net.connect(port, '127.0.0.1');
    closers.push(async () => socket.destroy());
    const chunks = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: abc\r\nSec-WebSocket-Version: 13\r\n${extraHeaders}\r\n`);
    const received = () => Buffer.concat(chunks).toString('latin1');
    const until = async (text) => {
      for (let i = 0; i < 100 && !received().includes(text); i += 1) await new Promise((r) => setTimeout(r, 20));
      return received();
    };
    return { socket, received, until };
  }

  it('matches /collab and what is under it, nothing else', () => {
    for (const url of ['/collab', '/collab?token=1', '/collab/', '/collab/x']) expect(isCollabPath(url)).toBe(true);
    for (const url of ['/', '/socket.io/?EIO=4', '/collabs', '/api/collab', '/x/collab']) expect(isCollabPath(url)).toBe(false);
    expect(upstreamUrl('/collab')).toBe('/');
    expect(upstreamUrl('/collab?a=1')).toBe('/?a=1');
    expect(upstreamUrl('/collab/x?a=1')).toBe('/x?a=1');
  });

  it('completes the handshake with the collab server and carries bytes both ways', async () => {
    const upstream = await startUpstream();
    const port = await startApi(`http://127.0.0.1:${upstream.port}`);

    const client = upgrade(port, '/collab', 'X-Forwarded-For: 203.0.113.9\r\n');
    expect(await client.until('101 Switching Protocols')).toContain('101 Switching Protocols');
    client.socket.write('hello through the proxy');
    expect(await client.until('hello through the proxy')).toContain('hello through the proxy');

    expect(upstream.seen.head).toMatch(/^GET \/ HTTP\/1\.1\r\n/);
    expect(upstream.seen.head).toContain('Sec-WebSocket-Key: abc');
    expect(upstream.seen.head.match(/x-forwarded-for: ([^\r]*)/i)[1]).toBe('203.0.113.9'); // not replaced
  });

  it('tells the collab server who is connecting when nothing in front of the api did', async () => {
    const upstream = await startUpstream();
    const port = await startApi(`http://127.0.0.1:${upstream.port}`);
    const client = upgrade(port, '/collab?x=1');
    await client.until('101');
    expect(upstream.seen.head).toMatch(/^GET \/\?x=1 HTTP\/1\.1/);
    expect(upstream.seen.head.match(/x-forwarded-for: ([^\r]*)/i)[1]).toMatch(/127\.0\.0\.1/);
  });

  it('drops the client when the collab server is not there', async () => {
    const closed = new Promise((resolve) => {
      const probe = net.createServer().listen(0, '127.0.0.1', () => {
        const { port } = probe.address();
        probe.close(() => resolve(port)); // a port with nothing listening
      });
    });
    const port = await startApi(`http://127.0.0.1:${await closed}`);
    const client = upgrade(port, '/collab');
    await new Promise((resolve) => client.socket.on('close', resolve));
    expect(client.received()).toBe('');
  });

  it('refuses an unusable target and leaves other upgrades alone', () => {
    expect(attachCollabProxy(http.createServer(), 'not a url')).toBe(false);
    expect(attachCollabProxy(http.createServer(), '')).toBe(false);
  });
});
