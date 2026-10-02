# FE-001j (t_4ccd2652) — Integration Tests — verification evidence

## Scope decision
Per parent `t_4a892f1d` (architect, verdict PASS): FE-001j AC is scoped to **fail-closed
redirect only** — no session guard. The route table (`routes.tsx`) redirects `/` and `*`
to `/login` with `replace`; known screens render without a session. Integration tests
exercise the full route table through `RouterProvider`.

## Suite
- `src/App.integration.test.tsx` — 27 tests, 3 describe groups:
  1. Route transitions (15 tests): every owned screen renders + shell-bound; shell-UI
     transitions (header brand link, user menu); pre-auth screens skip the shell; history
     semantics (replace action + Back from guarded path).
  2. Auth redirect / fail-closed to /login (7 tests): root + unknown + wildcard land on
     `/login`; known screen renders without session; per-route document titles; title update
     on transition.
  3. Layout responsiveness (5 tests): shell at default viewport; shell coherence at narrow
     viewport; sidebar sections (Folders/Tags headings) at default + narrow.
- Lane config: `vitest.integration.config.ts` — `include: ['src/**/*.integration.test.{ts,tsx}']`,
  `environment: 'jsdom'`, `globals: true`. Selected by `pnpm test:integration`.

## Run
```bash
cd apps/web
pnpm test:integration   # 27/27 pass
pnpm test:unit          # 143/143 pass (19 files — baseline, unchanged by this card)
pnpm tsc -b             # clean
pnpm eslint src/App.integration.test.tsx  # 0 violations
npx prettier --check src/App.integration.test.tsx  # clean
pnpm build              # 84 modules / 233.68 kB (gzip 74.91 kB)
```

## What integration covers vs what unit covers
- Guard semantics (replace-not-push via Back) — **unit** (`routes.guards.test.tsx`).
- Fail-closed redirect end-to-end through the memory router — **integration** (this card).
- Document-title per route + title update on transition — **integration** (RouteFocusManager
  runs inside RouterProvider; titleFor is unit-tested separately on master).

## Layout responsiveness note
Sidebar collapse/expand is **not wired** — `useUiStore.toggleSidebar` exists (Zustand) but is
not connected to `Sidebar`. The integration specs flag this (sidebar toggle not wired) rather
than fabricate it. Specs assert the CSS-grid shell renders at default (1024×768) and narrowed
(390px) viewports without blowing up; they do not assert a visual breakpoint (jsdom does not
evaluate media queries).

## Pre-existing: unit lane baseline
Parent FE-001i (PR #26, `feature/t_4e1b6937`) shipped 19 test files / 142 tests. This branch
is at `81a0ab0` on top of that merge plus two follow-up fixes:

```
81a0ab0 fix: restore globals: true in vitest.config.ts (needed for @testing-library/react
68f956d fix: remove @vitejs/plugin-react from vitest configs (Plugin<any> type conflict)
7cb4ccf Merge origin/master into feature/t_4e1b6937  ← FE-001i fan-in
```

The merge brought in master's `queryClient.test.ts` (new) and `routes.test.ts` (new), so the
tracked baseline on this head is **19 files / 143 tests**, all green. (One untracked file,
`src/components/TagManager.css` — bleed from the FE-003h worktree — was caught by
`theme.test.ts`'s hardcoded-color scan until removed; it is not part of this card.)

## Update (2026-10-02) — rebuilt on current master

The original branch (`t_4ccd2652/integration-tests`, PR #100) was built on the stale
FE-001i stack (28 commits behind/diverged; FE-001i itself landed via PR #26) and could
not run: it predated `@testing-library/user-event` in `apps/web/package.json`, so the
spec failed to import (the reason this card was blocked).

Rebuilt from current `master` carrying only this card's deliverable
(`apps/web/src/App.integration.test.tsx` + this README). One change was needed:
the render helpers now wrap the router in `QueryClientProvider`, mirroring
`main.tsx` — the vault/sidebar screens started using React Query after this spec was
written, so without it 12 of 27 tests failed with "No QueryClient set".

Verified on the rebuilt branch: integration lane 43/43 (27 here + 16 FE-003g),
web unit 350/350 (`test:unit`), typecheck/lint/build clean, scan baselines unchanged.
