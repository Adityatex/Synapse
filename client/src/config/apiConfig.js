const trimTrailingSlash = (value = '') => value.replace(/\/+$/, '');

const apiBaseFromEnv = trimTrailingSlash(import.meta.env.VITE_API_URL || '');
const socketBaseFromEnv = trimTrailingSlash(import.meta.env.VITE_SOCKET_URL || '');

export const API_BASE = apiBaseFromEnv || '/api';
export const SOCKET_URL = socketBaseFromEnv || window.location.origin;
