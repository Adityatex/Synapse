import { createRequire } from 'node:module';
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

// P2-09: Run and Neura read a room's files from the collab server (here, a stand-in for it).
describe('room files from the collab server', () => {
  let collab;
  let collabUrl;
  let seen; // what the fake collab server was asked
  let reply; // what it answers: { status, body, delayMs }
  let judge0; // what the stubbed Judge0 client received

  const projection = (files) => ({
    roomId: 'ROOM01',
    source: 'live',
    files,
    content: files.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n'),
  });
  const main = { id: 'main', name: 'main.py', path: 'main.py', content: 'print("from the room")' };
  const util = { id: 'util', name: 'util.py', path: 'lib/util.py', content: 'x = 1' };

  let lib;
  let app;
  const token = () => jwt.sign({ userId: 'ada', name: 'Ada', email: 'ada@x.com' }, process.env.JWT_SECRET);

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret-that-is-long-enough-for-p1-09-1234567890';
    process.env.JUDGE0_API_HOST = 'judge0.test';
    process.env.JUDGE0_API_KEY = 'k';

    collab = http.createServer((req, res) => {
      seen.push({ url: req.url, authorization: req.headers.authorization });
      setTimeout(() => {
        res.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(reply.body ?? {}));
      }, reply.delayMs ?? 0);
    });
    await new Promise((resolve) => collab.listen(0, '127.0.0.1', resolve));
    collabUrl = `http://127.0.0.1:${collab.address().port}`;

    // The execute route builds its Judge0 client when it is first loaded: give it a fake one.
    const axios = require('axios');
    const realCreate = axios.create.bind(axios);
    axios.create = () => ({
      post: async (_path, body) => {
        judge0.push(Buffer.from(body.source_code, 'base64').toString('utf-8'));
        return { data: { token: 'tok' } };
      },
      get: async () => ({ data: { status: { id: 3, description: 'Accepted' }, stdout: Buffer.from('ok').toString('base64') } }),
    });
    const executeRouter = require('../../routes/execute');
    axios.create = realCreate;
    app = express();
    app.use(express.json());
    app.use('/api', executeRouter);

    lib = require('../../lib/roomFiles');
  });

  beforeEach(() => {
    seen = [];
    judge0 = [];
    reply = { status: 200, body: projection([main, util]) };
    process.env.COLLAB_INTERNAL_URL = collabUrl;
  });

  afterEach(() => {
    process.env.COLLAB_INTERNAL_URL = collabUrl;
  });

  afterAll(async () => {
    await new Promise((resolve) => collab.close(resolve));
  });

  describe('getRoomFiles', () => {
    it('asks the collab server with the caller’s own token, and says when it must be fresh', async () => {
      const result = await lib.getRoomFiles('room01', { authorization: 'Bearer abc' });
      expect(result.files.map((f) => f.path)).toEqual(['main.py', 'lib/util.py']);
      expect(result.source).toBe('live');
      expect(seen).toEqual([{ url: '/rooms/ROOM01/files', authorization: 'Bearer abc' }]);

      await lib.getRoomFiles('ROOM01', { authorization: 'Bearer abc', fresh: true });
      expect(seen[1].url).toBe('/rooms/ROOM01/files?fresh=1');
    });

    it('gives null instead of failing when it cannot be read', async () => {
      for (const failing of [{ status: 403, body: { error: 'no' } }, { status: 404, body: {} }, { status: 500, body: {} }, { status: 200, body: { nope: true } }]) {
        reply = failing;
        expect(await lib.getRoomFiles('ROOM01', { authorization: 'Bearer abc' })).toBeNull();
      }
      reply = { status: 200, body: projection([main]), delayMs: 400 };
      expect(await lib.getRoomFiles('ROOM01', { authorization: 'Bearer abc', timeoutMs: 100 })).toBeNull(); // too slow

      process.env.COLLAB_INTERNAL_URL = 'http://127.0.0.1:1';
      expect(await lib.getRoomFiles('ROOM01', { authorization: 'Bearer abc' })).toBeNull(); // unreachable
    });

    it('does nothing when collab is not configured or the caller is not signed in', async () => {
      process.env.COLLAB_INTERNAL_URL = '';
      expect(await lib.getRoomFiles('ROOM01', { authorization: 'Bearer abc' })).toBeNull();
      process.env.COLLAB_INTERNAL_URL = collabUrl;
      expect(await lib.getRoomFiles('ROOM01', {})).toBeNull();
      expect(await lib.getRoomFiles('', { authorization: 'Bearer abc' })).toBeNull();
      expect(seen).toEqual([]);
    });
  });

  describe('resolveExecuteSource', () => {
    const auth = 'Bearer abc';

    it('runs the room’s text, not the client’s, when a room and file are named', async () => {
      const result = await lib.resolveExecuteSource({ source_code: 'stale text', roomId: 'ROOM01', fileId: 'main' }, auth);
      expect(result).toEqual({ ok: true, source_code: 'print("from the room")', from: 'room' });
      expect(seen[0].url).toContain('fresh=1'); // never the 5 s cache
    });

    it('falls back to the client’s text when the room cannot be read or has no such file', async () => {
      reply = { status: 503, body: {} };
      expect(await lib.resolveExecuteSource({ source_code: 'on screen', roomId: 'ROOM01', fileId: 'main' }, auth)).toEqual({ ok: true, source_code: 'on screen', from: 'client' });
      reply = { status: 200, body: projection([]) }; // a legacy room: nothing in the document
      expect(await lib.resolveExecuteSource({ source_code: 'on screen', roomId: 'ROOM01', fileId: 'main' }, auth)).toEqual({ ok: true, source_code: 'on screen', from: 'client' });
    });

    it('says what is wrong when there is nothing to run', async () => {
      expect(await lib.resolveExecuteSource({ roomId: 'ROOM01', fileId: 'nope' }, auth)).toMatchObject({ ok: false, status: 404 });
      reply = { status: 503, body: {} };
      expect(await lib.resolveExecuteSource({ roomId: 'ROOM01', fileId: 'main' }, auth)).toMatchObject({ ok: false, status: 503 });
      expect(await lib.resolveExecuteSource({}, auth)).toMatchObject({ ok: false, status: 400 });
      reply = { status: 200, body: projection([{ ...main, content: '' }]) };
      expect(await lib.resolveExecuteSource({ roomId: 'ROOM01', fileId: 'main' }, auth)).toMatchObject({ ok: false, status: 400, error: 'This file is empty.' });
    });

    it('uses the client’s text for a standalone editor, without calling collab', async () => {
      expect(await lib.resolveExecuteSource({ source_code: 'print(1)' }, auth)).toEqual({ ok: true, source_code: 'print(1)', from: 'client' });
      expect(seen).toEqual([]);
    });
  });

  describe('POST /execute', () => {
    const run = (body) => request(app).post('/api/execute').set('Authorization', `Bearer ${token()}`).send(body);

    it('submits the room’s live text to Judge0', async () => {
      const res = await run({ source_code: 'old', language_id: 71, roomId: 'ROOM01', fileId: 'main' });
      expect(res.status).toBe(200);
      expect(judge0).toEqual(['print("from the room")']);
    });

    it('still accepts plain source code, and a room with the code as a fallback', async () => {
      expect((await run({ source_code: 'print(2)', language_id: 71 })).status).toBe(200);
      reply = { status: 503, body: {} };
      expect((await run({ source_code: 'print(3)', language_id: 71, roomId: 'ROOM01', fileId: 'main' })).status).toBe(200);
      expect(judge0).toEqual(['print(2)', 'print(3)']);
    });

    it('refuses a request with neither code nor a room file, and a room it cannot read', async () => {
      expect((await run({ language_id: 71 })).status).toBe(400);
      reply = { status: 503, body: {} };
      const res = await run({ language_id: 71, roomId: 'ROOM01', fileId: 'main' });
      expect(res.status).toBe(503);
      expect(judge0).toEqual([]);
    });
  });

  describe('withRoomContext (Neura)', () => {
    const auth = 'Bearer abc';

    it('replaces the client’s file list and active text with the room’s', async () => {
      const context = await lib.withRoomContext(
        { roomId: 'ROOM01', activeFile: { id: 'util', name: 'util.py', content: 'stale' }, files: [{ id: 'util', name: 'util.py' }] },
        auth,
      );
      expect(context.files).toEqual([
        { id: 'main', name: 'main.py', path: 'main.py' },
        { id: 'util', name: 'util.py', path: 'lib/util.py' },
      ]);
      expect(context.activeFile).toEqual({ id: 'util', name: 'lib/util.py', content: 'x = 1' });
      expect(seen[0].url).toBe('/rooms/ROOM01/files'); // the cached read is fine here
    });

    it('leaves the client’s context alone when there is no room, or the room cannot be read', async () => {
      const own = { activeFile: { id: 'a', name: 'a.py', content: 'mine' }, files: [{ id: 'a', name: 'a.py' }] };
      expect(await lib.withRoomContext(own, auth)).toBe(own);
      reply = { status: 403, body: {} };
      const inRoom = { ...own, roomId: 'ROOM01' };
      expect(await lib.withRoomContext(inRoom, auth)).toBe(inRoom);
      reply = { status: 200, body: projection([]) };
      expect(await lib.withRoomContext(inRoom, auth)).toBe(inRoom);
    });
  });
});
