import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { createApiDevProxy } from './dev-proxy.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Forward the Web UI's relative API calls (/auth/*, /api/v1/*) to the API
    // under `pnpm dev`. Target: API_PROXY_TARGET, else http://HOST:PORT (the API's
    // own env vars), else http://127.0.0.1:3000. See dev-proxy.ts.
    proxy: createApiDevProxy(process.env),
  },
})
