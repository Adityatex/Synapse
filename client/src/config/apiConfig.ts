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

// Where rooms are edited: the collab server (P2-06). VITE_COLLAB_URL overrides. Otherwise, in dev,
// it is the collab port on the page's host (5001, as docker compose publishes it); in a build, it is
// the page's own origin under /collab, which the api passes on to the collab server (P2-14).
const collabPort: string = import.meta.env.VITE_COLLAB_PORT || '5001';
const wsScheme: string = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const collabFallback: string =
  typeof window === 'undefined'
    ? ''
    : isDev
      ? `${wsScheme}//${window.location.hostname}:${collabPort}`
      : `${wsScheme}//${window.location.host}/collab`;
export const COLLAB_URL: string = trimTrailingSlash(import.meta.env.VITE_COLLAB_URL || collabFallback);

export const API_BASE: string = apiBaseFromEnv || '/api';
export const SOCKET_URL: string =
  socketBaseFromEnv || (isDev ? devBackendBase || devSocketFallback : window.location.origin);
