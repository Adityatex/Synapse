import { createNode, getContentText, listNodes } from '@synapse/room-doc';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryDocStore } from '@synapse/ydoc-store';
import { SECRET, closeAll, connect, fakeAccess, randomRoomId, startProxy, startServer, tokenFor, waitFor } from './testUtils.js';

afterEach(closeAll);

// P2-12 acceptance: take the network away, type, bring it back, and the edits merge.
// "30 s" in the roadmap is a short outage here; reconnect timing is the provider's own backoff,
// shortened so the test does not wait for it.
const QUICK_RECONNECT = { delay: 100, minDelay: 50, maxDelay: 400, jitter: false };
const members = [{ userId: 'ada' }, { userId: 'bob' }];
const text = (doc: Parameters<typeof getContentText>[0]) => getContentText(doc, 'main').toString();

async function setup() {
  const roomId = randomRoomId();
  const server = await startServer({
    access: fakeAccess({ [roomId]: { createdBy: 'ada', members } }),
    store: new MemoryDocStore(),
    storeDebounceMs: 50,
  });
  const proxy = await startProxy(server);
  const statuses: string[] = [];
  let adaToken = tokenFor('ada');
  // Ada's connection runs through the proxy; Bob stays connected directly.
  const ada = connect(server, roomId, undefined, undefined, { url: proxy.url, token: () => adaToken, socketOptions: QUICK_RECONNECT });
  ada.provider.on('status', ({ status }: { status: string }) => statuses.push(status));
  const bob = connect(server, roomId, tokenFor('bob'));
  await Promise.all([ada.synced, bob.synced]);
  return { roomId, server, proxy, ada, bob, statuses, expireAdaToken: () => (adaToken = jwt.sign({ userId: 'ada', name: 'ada' }, SECRET, { expiresIn: -60 })) };
}

describe('losing and regaining the network', () => {
  it('merges text typed offline with what others typed meanwhile', async () => {
    const { proxy, ada, bob, statuses } = await setup();
    getContentText(bob.doc, 'main').insert(0, 'base\n');
    await waitFor(() => text(ada.doc) === 'base\n');

    await proxy.cut();
    await waitFor(() => statuses.at(-1) === 'disconnected');

    // Both keep typing: Ada offline, Bob online.
    getContentText(ada.doc, 'main').insert(5, 'ada offline 1\n');
    getContentText(ada.doc, 'main').insert(19, 'ada offline 2\n');
    getContentText(bob.doc, 'main').insert(0, 'bob meanwhile\n');
    expect(ada.provider.unsyncedChanges).toBeGreaterThan(0); // the app can tell the person it is not saved yet
    await waitFor(() => text(bob.doc).startsWith('bob meanwhile'));
    expect(text(ada.doc)).not.toContain('bob meanwhile'); // she cannot see it yet

    await proxy.restore();
    await waitFor(() => statuses.at(-1) === 'connected'); // reconnected by itself
    await waitFor(() => text(ada.doc) === text(bob.doc) && ada.provider.unsyncedChanges === 0);

    for (const line of ['base', 'ada offline 1', 'ada offline 2', 'bob meanwhile']) {
      expect(text(ada.doc)).toContain(line);
      expect(text(bob.doc)).toContain(line);
    }
    // Nothing was duplicated by being sent twice.
    expect(text(ada.doc).split('\n').sort()).toEqual(['', 'ada offline 1', 'ada offline 2', 'base', 'bob meanwhile']);
    expect(statuses).toContain('disconnected');
  });

  it('merges files created and text typed offline too', async () => {
    const { proxy, ada, bob, statuses } = await setup();
    createNode(bob.doc, { id: 'main', name: 'main.py', type: 'file' });
    await waitFor(() => listNodes(ada.doc).length === 1);

    await proxy.cut();
    await waitFor(() => statuses.at(-1) === 'disconnected');
    createNode(ada.doc, { id: 'offline-file', name: 'offline.py', type: 'file', content: 'written offline' });
    createNode(bob.doc, { id: 'online-file', name: 'online.py', type: 'file', content: 'written online' });
    await waitFor(() => listNodes(bob.doc).length === 2); // main, and his own: hers cannot reach him yet
    expect(listNodes(ada.doc).map((n) => n.id).sort()).toEqual(['main', 'offline-file']);

    await proxy.restore();
    await waitFor(() => listNodes(ada.doc).length === 3 && listNodes(bob.doc).length === 3 && ada.provider.unsyncedChanges === 0);
    for (const doc of [ada.doc, bob.doc]) {
      expect(listNodes(doc).map((n) => n.id).sort()).toEqual(['main', 'offline-file', 'online-file']);
      expect(getContentText(doc, 'offline-file').toString()).toBe('written offline');
      expect(getContentText(doc, 'online-file').toString()).toBe('written online');
    }
  });

  it('keeps recovering through repeated outages', async () => {
    const { proxy, ada, bob, statuses } = await setup();
    for (let round = 1; round <= 3; round++) {
      await proxy.cut();
      await waitFor(() => statuses.at(-1) === 'disconnected');
      getContentText(ada.doc, 'main').insert(0, `round ${round}\n`);
      await proxy.restore();
      await waitFor(() => statuses.at(-1) === 'connected');
      await waitFor(() => ada.provider.unsyncedChanges === 0 && text(bob.doc).includes(`round ${round}`));
    }
    expect(text(bob.doc).split('\n').filter(Boolean).sort()).toEqual(['round 1', 'round 2', 'round 3']);
    expect(text(ada.doc)).toBe(text(bob.doc));
  });

  it('refuses a client whose token expired while it was offline, and it cannot write', async () => {
    const { proxy, ada, bob, statuses, expireAdaToken, server, roomId } = await setup();
    getContentText(bob.doc, 'main').insert(0, 'shared\n');
    await waitFor(() => text(ada.doc) === 'shared\n');

    await proxy.cut();
    await waitFor(() => statuses.at(-1) === 'disconnected');
    expireAdaToken(); // the sign-in ran out while she was away
    await proxy.restore();

    // The server says why; the client can show it and make the editor read-only.
    expect(await ada.denied).toMatch(/invalid or expired/i);

    // Whatever she types now never reaches the room, and she is not let back in as a reader either.
    getContentText(ada.doc, 'main').insert(0, 'should not arrive\n');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(text(bob.doc)).toBe('shared\n');
    const serverDoc = server.hocuspocus.documents.get(`room:${roomId}`)!;
    expect(serverDoc.getText('content:main').toString()).toBe('shared\n');
  });
});
