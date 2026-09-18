# Password Manager — Web UI

React 18 + TypeScript + Vite frontend for the Password Manager monorepo.

## Scripts

```bash
pnpm dev        # start Vite dev server
pnpm build      # typecheck (tsc -b) + production build
pnpm typecheck  # tsc -b (no emit)
pnpm lint       # oxlint
pnpm test       # vitest run (unit tests)
pnpm test:watch # vitest watch
pnpm preview    # preview the production build
```

## API client (`src/api/`)

Typed fetch wrapper for the Secure Password Manager API (FE-001f). It implements the
envelope convention from `ADR-004-api-contract.yaml`:

- **Envelope parsing** — unwraps `{ header, body }` and returns the typed `body`.
- **JWT interceptor** — injects `Authorization: Bearer <accessToken>` on every request
  except public paths (`/auth/login`, `/auth/refresh`).
- **Refresh handling** — on HTTP 401, transparently rotates the access token via
  `POST /auth/refresh` (single-flight) and retries the request once.
- **Error normalization** — every failure (network, HTTP, malformed envelope, failed
  refresh) is thrown as a single `ApiError` with machine-readable `code` and `details`.

```ts
import { ApiClient, InMemoryTokenStore } from './api';

const tokenStore = new InMemoryTokenStore(); // in-memory only — never persisted
const client = new ApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1',
  tokenStore,
  onUnauthorized: () => { /* route to /unlock */ },
});

const vault = await client.get<{ id: string; name: string }>('/vaults/{id}');
const created = await client.post<Resource>('/resources', { name: 'GitHub' });
```

## State management (FE-001g)

Two layers, kept strictly separate:

- **Server state → React Query (TanStack Query v5).** Resources, folders, tags,
  vault metadata and session status are cached and refetched by TanStack Query.
  The shared client is built by `createQueryClient()` in `src/queryClient.ts` and
  mounted once in `main.tsx` via `QueryClientProvider`. Default policy: 30s stale
  time, 5m cache retention, 2 retries on reads, 0 retries on writes.
- **UI state → Zustand v5.** Ephemeral chrome state that is not server data lives
  in small stores under `src/stores/`:
  - `useUiStore` — `sidebarOpen` (expand/collapse the navigation sidebar).
  - `useThemeStore` — `theme` (`dark` | `light`), dark by default.

Both stores are in-memory only — no persistence surface. Theme application
(CSS variables / `color-scheme`) is owned by the FE-001d theme system.

```ts
import { useThemeStore, useUiStore } from './stores';

const sidebarOpen = useUiStore((s) => s.sidebarOpen);
const theme = useThemeStore((s) => s.theme);
```

## Security note

This app handles user secrets (vault key, decrypted resource secrets). Sensitive values are
held **in-memory only** (React state / JS heap) and are never written to `localStorage`,
`sessionStorage`, `IndexedDB`, logs, or telemetry. The `InMemoryTokenStore` likewise holds
the JWT access + refresh tokens in memory only — never persisted. See `SEC-001` threat model
and the project security gate for the full constraints.
