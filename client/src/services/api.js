import axios from 'axios';
import { API_BASE } from '../config/apiConfig';

const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const executeCode = async (source_code, language_id, stdin = '') => {
  try {
    const response = await apiClient.post('/execute', {
      source_code,
      language_id,
      stdin,
    });
    return response.data;
  } catch (error) {
    if (error.response) {
      throw new Error(error.response.data.error || 'Execution failed');
    }
    throw new Error('Network error. Is the server running?');
  }
};
