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

// P2-06 rollout flag. When VITE_COLLAB_URL is set (e.g. ws://localhost:5001), rooms edit
// through the collab server; when empty, the legacy Socket.IO relay is used.
export const COLLAB_URL: string = trimTrailingSlash(import.meta.env.VITE_COLLAB_URL || '');
export const COLLAB_ENABLED: boolean = COLLAB_URL !== '';

export const API_BASE: string = apiBaseFromEnv || '/api';
export const SOCKET_URL: string =
  socketBaseFromEnv || (isDev ? devBackendBase || devSocketFallback : window.location.origin);
