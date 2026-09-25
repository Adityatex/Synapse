const trimTrailingSlash = (value = '') => value.replace(/\/+$/, '');

const apiBaseFromEnv = trimTrailingSlash(import.meta.env.VITE_API_URL || '');
const socketBaseFromEnv = trimTrailingSlash(import.meta.env.VITE_SOCKET_URL || '');
const devBackendBase = trimTrailingSlash(import.meta.env.VITE_DEV_BACKEND_URL || '');
const backendPort = import.meta.env.VITE_BACKEND_PORT || '5000';
const isDev = import.meta.env.DEV;
const devSocketFallback =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:${backendPort}`
    : '';

export const API_BASE = apiBaseFromEnv || '/api';
export const SOCKET_URL =
  socketBaseFromEnv ||
  (isDev ? devBackendBase || devSocketFallback : window.location.origin);
