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

export function getRoom(roomId) {
  return request(`/${String(roomId).trim().toUpperCase()}`);
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
