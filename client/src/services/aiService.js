import { API_BASE } from '../config/apiConfig';
import { getToken } from './authService';

const AI_API_BASE = `${API_BASE}/ai`;

export async function chatWithNeura({ message, history = [], context = {} }) {
  const token = getToken();
  const response = await fetch(`${AI_API_BASE}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      message,
      history,
      context,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Unable to get a response from Neura.');
  }

  return data;
}
