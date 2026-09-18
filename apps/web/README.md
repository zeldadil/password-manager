# Password Manager — Web UI

React 18 + TypeScript + Vite frontend for the Password Manager monorepo.

## Scripts

```bash
pnpm dev       # start Vite dev server
pnpm build     # typecheck (tsc -b) + production build
pnpm lint      # oxlint
pnpm preview   # preview the production build
```

## Security note

This app handles user secrets (vault key, decrypted resource secrets). Sensitive values are
held **in-memory only** (React state / JS heap) and are never written to `localStorage`,
`sessionStorage`, `IndexedDB`, logs, or telemetry. See `SEC-001` threat model and the project
security gate for the full constraints.
