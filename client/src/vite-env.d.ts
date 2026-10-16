/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SOCKET_URL?: string;
  readonly VITE_DEV_BACKEND_URL?: string;
  readonly VITE_BACKEND_PORT?: string;
  readonly VITE_PUBLIC_APP_URL?: string;
  readonly VITE_AUTH_REQUEST_TIMEOUT_MS?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_APP_RELEASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
