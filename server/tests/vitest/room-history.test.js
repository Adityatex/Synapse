import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// P2-15: a file's version history is the collab server's; the api passes requests on with the caller's token.
describe('room history through the api', () => {
  let collab;
  let app;
  let seen; // what the fake collab server was asked
  let reply; // what it answers: { status, body }
  const token = () => jwt.sign({ userId: 'ada', name: 'Ada', email: 'ada@x.com' }, process.env.JWT_SECRET);

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret-that-is-long-enough-for-p1-09-1234567890';
    collab = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body: Buffer.concat(chunks).toString() });
        res.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(reply.body ?? {}));
      });
    });
    await new Promise((resolve) => collab.listen(0, '127.0.0.1', resolve));
    process.env.COLLAB_INTERNAL_URL = `http://127.0.0.1:${collab.address().port}`;

    const { default: rooms } = await import('../../routes/rooms.js');
    app = express();
    app.use(express.json());
    app.use('/api/rooms', rooms);
  });

  afterAll(async () => {
    delete process.env.COLLAB_INTERNAL_URL;
    await new Promise((resolve) => collab.close(resolve));
  });

  beforeEach(() => {
    seen = [];
    reply = {};
    process.env.COLLAB_INTERNAL_URL = `http://127.0.0.1:${collab.address().port}`;
  });

  it('lists versions: the caller’s token, the room (any case), the file and the limit go to collab', async () => {
    reply = { body: { roomId: 'ROOM01', fileId: 'main', versions: [{ seq: 3 }] } };
    const res = await request(app).get('/api/rooms/room01/history?fileId=main&limit=10').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.versions).toEqual([{ seq: 3 }]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/rooms/ROOM01/history?fileId=main&limit=10', authorization: `Bearer ${token()}` });
  });

  it('reads one version', async () => {
    reply = { body: { version: { seq: 2, content: 'one two' } } };
    const res = await request(app).get('/api/rooms/ROOM01/history/2?fileId=a%2Fb').set('Authorization', `Bearer ${token()}`);
    expect(res.body.version.content).toBe('one two');
    expect(seen[0].url).toBe('/rooms/ROOM01/history/2?fileId=a%2Fb');
  });

  it('restores: the file goes in the body, not the query', async () => {
    reply = { body: { changed: true, seq: 9 } };
    const res = await request(app).post('/api/rooms/ROOM01/history/2/restore').set('Authorization', `Bearer ${token()}`).send({ fileId: 'main' });
    expect(res.body).toEqual({ changed: true, seq: 9 });
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/rooms/ROOM01/history/2/restore' });
    expect(JSON.parse(seen[0].body)).toEqual({ fileId: 'main' });
  });

  it('gives the caller collab’s answer unchanged, including who holds a lock', async () => {
    reply = { status: 409, body: { error: 'Bob has this file locked.', code: 'locked', holder: { userId: 'bob', name: 'Bob' } } };
    const res = await request(app).post('/api/rooms/ROOM01/history/2/restore').set('Authorization', `Bearer ${token()}`).send({ fileId: 'main' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'locked', holder: { name: 'Bob' } });

    reply = { status: 403, body: { error: 'You are not a member of this room.' } };
    expect((await request(app).get('/api/rooms/ROOM01/history?fileId=main').set('Authorization', `Bearer ${token()}`)).status).toBe(403);
  });

  it('needs a signed-in caller, and a version id that is a number', async () => {
    expect((await request(app).get('/api/rooms/ROOM01/history?fileId=main')).status).toBe(401);
    expect((await request(app).post('/api/rooms/ROOM01/history/2/restore').send({ fileId: 'main' })).status).toBe(401);
    expect(seen).toEqual([]);

    const res = await request(app).get('/api/rooms/ROOM01/history/abc?fileId=main').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(404);
    expect((await request(app).post('/api/rooms/ROOM01/history/1x/restore').set('Authorization', `Bearer ${token()}`).send({ fileId: 'main' })).status).toBe(404);
    expect(seen).toEqual([]);
  });

  it('says it is unavailable when collab is not configured or not answering', async () => {
    process.env.COLLAB_INTERNAL_URL = '';
    let res = await request(app).get('/api/rooms/ROOM01/history?fileId=main').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(503);

    process.env.COLLAB_INTERNAL_URL = 'http://127.0.0.1:9';
    res = await request(app).get('/api/rooms/ROOM01/history?fileId=main').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/unavailable/i);
  });
});
