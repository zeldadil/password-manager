import type { ProxyOptions } from 'vite'

/**
 * Dev-server proxy for the Web UI (t_aeb2617e).
 *
 * The Web UI calls the API with relative URLs — `fetch('/auth/unlock')`,
 * `/auth/lock`, `/auth/refresh`, and `ApiClient({ baseUrl: '/api/v1' })` — so in
 * production a reverse proxy serves both on one origin. Under `pnpm dev` the Vite
 * server (port 5173) must forward those paths to the API, otherwise they hit Vite
 * itself (404 for POST, `index.html` for GET).
 *
 * Only the API path prefixes are proxied. The patterns are anchored and require
 * the trailing `/`, so SPA routes such as `/login` or `/unlock` and any future
 * route that merely starts with the same letters (e.g. `/authors`) stay with Vite.
 *
 * Target resolution, in order:
 *  1. `API_PROXY_TARGET` — explicit override (e.g. `http://127.0.0.1:4000`).
 *  2. `http://<HOST>:<PORT>` — the same variables the API reads (apps/services/api
 *     src/config.ts), so `PORT=3001 pnpm dev` keeps API and proxy in step.
 *     A wildcard bind address (`0.0.0.0`, `::`) is reached via 127.0.0.1.
 *  3. `http://127.0.0.1:3000` — the API defaults.
 *
 * Nothing here reads or logs request bodies: credentials in `/auth/unlock` pass
 * through untouched and are never persisted by the dev server.
 */

export const DEFAULT_API_PROXY_TARGET = 'http://127.0.0.1:3000'

/** Path patterns (Vite treats keys starting with `^` as RegExp) sent to the API. */
export const API_PROXY_PATHS = ['^/auth/', '^/api/v1/'] as const

type Env = Record<string, string | undefined>

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]'])

export function resolveApiProxyTarget(env: Env): string {
  const explicit = env.API_PROXY_TARGET?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')

  const rawHost = env.HOST?.trim()
  const port = env.PORT?.trim()
  if (!rawHost && !port) return DEFAULT_API_PROXY_TARGET

  const host = !rawHost || WILDCARD_HOSTS.has(rawHost) ? '127.0.0.1' : rawHost
  const hostPart = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `http://${hostPart}:${port || '3000'}`
}

export function createApiDevProxy(env: Env): Record<string, ProxyOptions> {
  const target = resolveApiProxyTarget(env)
  return Object.fromEntries(API_PROXY_PATHS.map((path) => [path, { target, changeOrigin: true }]))
}
