import { API_BASE } from '../config/apiConfig';
import { getToken } from './authService';

const AI_API_BASE = `${API_BASE}/ai`;

async function request(path, options = {}) {
  const token = getToken();
  const response = await fetch(`${AI_API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Unable to get a response from Neura.');
  }

  return data;
}

export async function createNeuraConversation() {
  return request('/new', {
    method: 'POST',
  });
}

export async function getNeuraConversationHistory() {
  return request('/history');
}

export async function getNeuraConversation(conversationId) {
  return request(`/conversation/${conversationId}`);
}

export async function chatWithNeura({
  message,
  conversationId,
  history = [],
  context = {},
}) {
  return request('/chat', {
    method: 'POST',
    body: JSON.stringify({
      message,
      conversationId,
      history,
      context,
    }),
  });
}

export async function deleteNeuraConversation(conversationId) {
  return request(`/conversation/${conversationId}`, {
    method: 'DELETE',
  });
}
