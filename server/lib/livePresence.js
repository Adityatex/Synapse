const { logger } = require('./logger');

let io = null;

/** Gives this module the Socket.IO server, whose connected sockets say who is in which room. */
function setSocketServer(server) {
  io = server;
}

/**
 * Who is in each room right now, for the dashboard: `Map<roomId, [{ userId, username }]>`, one entry
 * per person however many tabs they have open. A socket counts for the room it joined to chat in
 * (`socket.data.roomId`), and with the Redis adapter that includes sockets on the other api replicas.
 * If that cannot be read the map is empty: a dashboard without faces beats a failed request.
 */
async function liveParticipantsByRoom() {
  const byRoom = new Map();
  if (!io) return byRoom;
  try {
    const sockets = await io.fetchSockets();
    for (const socket of sockets) {
      const { roomId, user } = socket.data || {};
      if (!roomId || !user?.userId) continue;
      const people = byRoom.get(roomId) || new Map();
      people.set(user.userId, { userId: user.userId, username: user.name || '' });
      byRoom.set(roomId, people);
    }
  } catch (err) {
    logger.warn({ err: err.message || err }, 'Could not read live room presence');
    return new Map();
  }
  return new Map(Array.from(byRoom, ([roomId, people]) => [roomId, Array.from(people.values())]));
}

module.exports = { setSocketServer, liveParticipantsByRoom };
