// P1-03: first client module migrated to TypeScript (incremental).
const trimTrailingSlash = (value: string = ''): string => value.replace(/\/+$/, '');

const apiBaseFromEnv: string = trimTrailingSlash(import.meta.env.VITE_API_URL || '');
const socketBaseFromEnv: string = trimTrailingSlash(import.meta.env.VITE_SOCKET_URL || '');
const devBackendBase: string = trimTrailingSlash(import.meta.env.VITE_DEV_BACKEND_URL || '');
const backendPort: string = import.meta.env.VITE_BACKEND_PORT || '5000';
const isDev: boolean = import.meta.env.DEV;
const devSocketFallback: string =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:${backendPort}`
    : '';

export const API_BASE: string = apiBaseFromEnv || '/api';
export const SOCKET_URL: string =
  socketBaseFromEnv || (isDev ? devBackendBase || devSocketFallback : window.location.origin);
