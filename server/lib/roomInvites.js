const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// Signed room invite links (interim, ahead of P3-03 invite records).
// Signed with a key derived from JWT_SECRET so an invite token can never be
// accepted as a login token by the auth middleware (and vice versa).
const INVITE_TYPE = 'room-invite';
const INVITE_TTL = process.env.ROOM_INVITE_TTL || '7d';

function inviteKey() {
  return crypto.createHmac('sha256', String(process.env.JWT_SECRET || '')).update('synapse:room-invite:v1').digest();
}

function signRoomInvite(roomId, invitedBy) {
  return jwt.sign({ typ: INVITE_TYPE, rid: roomId, by: invitedBy }, inviteKey(), { expiresIn: INVITE_TTL });
}

// Throws if the token is invalid, expired, or for another room.
function verifyRoomInvite(token, roomId) {
  const payload = jwt.verify(token, inviteKey());
  if (!payload || payload.typ !== INVITE_TYPE || payload.rid !== roomId) {
    throw new Error('Invite does not match this room');
  }
  return payload;
}

module.exports = { signRoomInvite, verifyRoomInvite };
