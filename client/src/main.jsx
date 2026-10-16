import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.jsx'

// P0-10: Sentry on client with release tagging. No-op unless VITE_SENTRY_DSN is set.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE || 'development',
    release:
      import.meta.env.VITE_APP_RELEASE || 'client@1.0.0',
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 0,
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
