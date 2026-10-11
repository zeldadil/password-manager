// @vitest-environment node
import { createServer as createHttpServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer as createViteServer, type ViteDevServer } from 'vite'
import {
  API_PROXY_PATHS,
  DEFAULT_API_PROXY_TARGET,
  createApiDevProxy,
  resolveApiProxyTarget,
} from './dev-proxy.ts'

// All values are synthetic (example.test is an RFC 2606 reserved domain).
const SYNTHETIC_EMAIL = 'alice@example.test'
// Short identifiers/values on purpose: the repo's gitleaks generic-api-key rule
// flags `password|token: <16+ chars>`, even for synthetic fixtures.
const mp = 'synthetic-mp'

describe('resolveApiProxyTarget', () => {
  it('defaults to the API defaults (127.0.0.1:3000)', () => {
    expect(resolveApiProxyTarget({})).toBe('http://127.0.0.1:3000')
    expect(DEFAULT_API_PROXY_TARGET).toBe('http://127.0.0.1:3000')
  })

  it('follows the PORT/HOST variables the API itself reads', () => {
    expect(resolveApiProxyTarget({ PORT: '3001' })).toBe('http://127.0.0.1:3001')
    expect(resolveApiProxyTarget({ HOST: 'localhost', PORT: '4000' })).toBe('http://localhost:4000')
    expect(resolveApiProxyTarget({ HOST: '0.0.0.0' })).toBe('http://127.0.0.1:3000')
    expect(resolveApiProxyTarget({ HOST: '::', PORT: '3002' })).toBe('http://127.0.0.1:3002')
    expect(resolveApiProxyTarget({ HOST: '::1' })).toBe('http://[::1]:3000')
  })

  it('lets API_PROXY_TARGET override everything', () => {
    expect(
      resolveApiProxyTarget({ API_PROXY_TARGET: 'http://api.example.test:8080/', PORT: '3001' }),
    ).toBe('http://api.example.test:8080')
  })
})

describe('createApiDevProxy', () => {
  it('proxies exactly the /auth/ and /api/v1/ prefixes to the API', () => {
    const proxy = createApiDevProxy({})
    expect(Object.keys(proxy).sort()).toEqual([...API_PROXY_PATHS].sort())
    for (const options of Object.values(proxy)) {
      expect(options.target).toBe('http://127.0.0.1:3000')
    }
  })

  it('does not capture SPA routes', () => {
    const patterns = Object.keys(createApiDevProxy({})).map((p) => new RegExp(p))
    const spaRoutes = ['/', '/login', '/unlock', '/vault', '/tags', '/authors', '/api', '/api/v2/x']
    for (const route of spaRoutes) {
      expect(
        patterns.some((re) => re.test(route)),
        route,
      ).toBe(false)
    }
    for (const apiPath of ['/auth/unlock', '/auth/lock', '/auth/refresh', '/api/v1/resources']) {
      expect(
        patterns.some((re) => re.test(apiPath)),
        apiPath,
      ).toBe(true)
    }
  })
})

/**
 * End-to-end through a real Vite dev server built from apps/web/vite.config.ts:
 * the browser-path request (relative URL on the Vite origin) must reach the API.
 * A stub HTTP server stands in for the API on a free port, selected via PORT —
 * exactly how `PORT=… pnpm dev` would wire it.
 */
describe('vite dev server (apps/web/vite.config.ts) forwards API calls', () => {
  type Seen = { method?: string; url?: string; contentType?: string; body: string }
  const seen: Seen[] = []
  let api: Server
  let vite: ViteDevServer
  let viteOrigin: string
  const savedPort = process.env.PORT

  beforeAll(async () => {
    api = createHttpServer((req: IncomingMessage, res) => {
      let body = ''
      req.on('data', (c: Buffer) => (body += c.toString()))
      req.on('end', () => {
        seen.push({
          method: req.method,
          url: req.url,
          contentType: req.headers['content-type'],
          body,
        })
        res.setHeader('content-type', 'application/json')
        if (req.url === '/auth/unlock') {
          res.end(
            JSON.stringify({
              accessToken: 'syn-access',
              refreshToken: 'syn-refresh',
              expiresIn: 900,
              tokenType: 'Bearer',
            }),
          )
        } else {
          res.end(JSON.stringify({ data: [], meta: { stub: true } }))
        }
      })
    })
    await new Promise<void>((r) => api.listen(0, '127.0.0.1', r))
    process.env.PORT = String((api.address() as AddressInfo).port)

    vite = await createViteServer({
      configFile: fileURLToPath(new URL('./vite.config.ts', import.meta.url)),
      root: fileURLToPath(new URL('.', import.meta.url)),
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1', strictPort: false, hmr: false, ws: false },
    })
    await vite.listen()
    const addr = vite.httpServer!.address() as AddressInfo
    viteOrigin = `http://127.0.0.1:${addr.port}`
  }, 30_000)

  afterAll(async () => {
    if (savedPort === undefined) delete process.env.PORT
    else process.env.PORT = savedPort
    await vite?.close()
    await new Promise<void>((r) => (api ? api.close(() => r()) : r()))
  })

  it('POST /auth/unlock on the Vite origin reaches the API with body intact', async () => {
    const res = await fetch(`${viteOrigin}/auth/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ masterPassword: mp, email: SYNTHETIC_EMAIL }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ accessToken: 'syn-access', tokenType: 'Bearer' })
    const hit = seen.find((s) => s.url === '/auth/unlock')
    expect(hit?.method).toBe('POST')
    expect(hit?.contentType).toContain('application/json')
    expect(JSON.parse(hit!.body)).toEqual({
      masterPassword: mp,
      email: SYNTHETIC_EMAIL,
    })
  })

  it('GET /api/v1/resources on the Vite origin returns API JSON, not index.html', async () => {
    const res = await fetch(`${viteOrigin}/api/v1/resources?page=1`)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ data: [], meta: { stub: true } })
    expect(seen.some((s) => s.url === '/api/v1/resources?page=1')).toBe(true)
  })

  it('SPA routes are still served by Vite (index.html)', async () => {
    const before = seen.length
    const res = await fetch(`${viteOrigin}/unlock`, { headers: { accept: 'text/html' } })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<div id="root">')
    expect(seen.length).toBe(before)
  })
})
