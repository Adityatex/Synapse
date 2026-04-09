import { getToken, logout } from './authService';

const API_BASE = 'http://localhost:5000/api/rooms';

async function request(path = '', options = {}) {
  const token = getToken();

  const response = await fetch(`${API_BASE}${path}`, {
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

export function createRoom() {
  return request('', { method: 'POST' });
}

export function getRoom(roomId) {
  return request(`/${String(roomId).trim().toUpperCase()}`);
}
