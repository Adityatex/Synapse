import axios from 'axios';
import { API_BASE } from '../config/apiConfig';
import { getToken } from './authService';

const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

//api/execute now requires JWT — attach it like roomService/aiService do.
apiClient.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// In a room, `room` ({ roomId, fileId }) lets the server run what is in the room's live document;
// `source_code` is the fallback if the room cannot be read, and what a standalone editor sends.
export const executeCode = async (source_code, language_id, stdin = '', room = null) => {
  try {
    const response = await apiClient.post('/execute', {
      source_code,
      language_id,
      stdin,
      ...(room?.roomId && room?.fileId ? { roomId: room.roomId, fileId: room.fileId } : {}),
    });
    return response.data;
  } catch (error) {
    if (error.response) {
      throw new Error(error.response.data.error || 'Execution failed');
    }
    throw new Error('Network error. Is the server running?');
  }
};
