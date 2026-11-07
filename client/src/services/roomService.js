import { getToken, logout } from './authService';
import { API_BASE } from '../config/apiConfig';

const ROOMS_API_BASE = `${API_BASE}/rooms`;

async function request(path = '', options = {}) {
  const token = getToken();

  const response = await fetch(`${ROOMS_API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    logout();
    throw new Error(data.error || 'Your session expired. Please log in again.');
  }

  if (!response.ok) {
    throw new Error(data.error || 'Request failed.');
  }

  return data;
}

export function createRoom(roomName) {
  return request('', { method: 'POST', body: JSON.stringify({ roomName }) });
}

export function createInviteLink(roomId) {
  return request(`/${String(roomId).trim().toUpperCase()}/invite-link`, { method: 'POST' });
}

export function joinRoomWithInvite(roomId, inviteToken) {
  return request(`/${String(roomId).trim().toUpperCase()}/join`, {
    method: 'POST',
    body: JSON.stringify({ inviteToken }),
  });
}

export function getRoom(roomId) {
  return request(`/${String(roomId).trim().toUpperCase()}`);
}

/** Creator only: switch focus locks (P2-08) on or off for the room. */
export function updateRoomSettings(roomId, settings) {
  return request(`/${String(roomId).trim().toUpperCase()}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(settings),
  });
}

const roomPath = (roomId) => `/${String(roomId).trim().toUpperCase()}`;

/** A file's saved versions, newest first (P2-15). */
export function listVersions(roomId, fileId) {
  return request(`${roomPath(roomId)}/history?fileId=${encodeURIComponent(fileId)}`);
}

/** One saved version of a file: its text, name, time and who made it, if a restore did. */
export function getVersion(roomId, seq, fileId) {
  return request(`${roomPath(roomId)}/history/${seq}?fileId=${encodeURIComponent(fileId)}`);
}

/** Puts a saved version's text back as the file's current text. The room sees it as an ordinary edit. */
export function restoreVersion(roomId, seq, fileId) {
  return request(`${roomPath(roomId)}/history/${seq}/restore`, { method: 'POST', body: JSON.stringify({ fileId }) });
}

export function getRecentRooms(userId) {
  return request(`/recent/${encodeURIComponent(userId)}`);
}

export function getSharedRooms(userId) {
  return request(`/shared/${encodeURIComponent(userId)}`);
}

export function deleteRoom(roomId) {
  return request(`/${encodeURIComponent(roomId)}`, { method: 'DELETE' });
}
