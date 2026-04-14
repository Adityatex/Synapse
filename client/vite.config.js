/* eslint-env node */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendPort = env.VITE_BACKEND_PORT || '5000'
  const backendTarget =
    env.VITE_DEV_BACKEND_URL || `http://localhost:${backendPort}`
  const devHost = env.VITE_DEV_HOST || '0.0.0.0'
  const devPort = Number(env.VITE_PORT || '5173')

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: devHost,
      port: devPort,
      proxy: {
        '/api': backendTarget,
      },
    },
  }
})
