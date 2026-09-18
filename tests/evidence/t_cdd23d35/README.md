# FE-001k — a11y tests (axe-core, zero violations on all routes)

**Task:** FE-001k — *"axe-core on all routes, zero violations"*
**Branch:** `feature/t_cdd23d35` (base: `feature/t_4e1b6937`, PR #26 — the FE fan-in branch; `master` has no `apps/web`)
**Lane:** `pnpm test:a11y` (`apps/web`, `vitest.a11y.config.ts`) · also runs inside `pnpm test:unit`

## 1. Deliverable

| File | Role |
|---|---|
| `apps/web/src/a11y/routes.a11y.test.tsx` | 19 tests — axe-core over every route + harness sensitivity + rule-set integrity |
| `apps/web/src/a11y/axe.ts` | the harness: jsdom document mirroring, documented rule exclusions, hit-test stub, violation formatter |
| `apps/web/vitest.a11y.config.ts` | a11y lane config (`include: src/**/*.a11y.test.{ts,tsx}`) |
| `apps/web/package.json` | `test:a11y` script + `axe-core@^4.13.0` devDependency |
| `apps/web/tsconfig.node.json` | typecheck coverage for the new config file |
| `tests/evidence/t_cdd23d35/` | this package + `mutation-check.mjs` (re-runnable) |

No production/UI code changed: the build output is byte-identical to the parent branch
(`dist/assets/index-Dl8kBAdm.js` 233.68 kB / gzip 74.91 kB) — this task adds a check, not a fix.

## 2. Acceptance criterion — real execution (Node 22.23.2 · pnpm 9.12.0)

```
apps/web  pnpm exec vitest run --config vitest.a11y.config.ts --reporter=verbose
          1 file, 19 tests passed                                  → a11y-lane.txt
root      pnpm test:unit     20 files / 162 tests passed            → unit-lane.txt (was 19/143)
root      pnpm typecheck     tsc -b, clean
root      pnpm lint          eslint 0 + prettier --check clean
root      pnpm test:integration   no specs yet, exit 0 (passWithNoTests — FE-001j)
root      pnpm build         84 modules, 233.68 kB (gzip 74.91 kB) — unchanged → gates.txt
```

Both the 8 screens and the 2 fail-closed guards are graded, at the path they actually resolve to:

| Requested path | Resolves to | document.title | violations | incomplete | rules graded |
|---|---|---|---|---|---|
| `/login` | `/login` | Sign in · Password Manager | 0 | 0 | 24 |
| `/unlock` | `/unlock` | Unlock vault · Password Manager | 0 | 0 | 24 |
| `/vault` | `/vault` | Vault · Password Manager | 0 | 0 | 29 |
| `/resources/res-123` | `/resources/res-123` | Resource · Password Manager | 0 | 0 | 29 |
| `/folders` | `/folders` | Folders · Password Manager | 0 | 0 | 29 |
| `/tags` | `/tags` | Tags · Password Manager | 0 | 0 | 29 |
| `/settings` | `/settings` | Settings · Password Manager | 0 | 0 | 29 |
| `/generator` | `/generator` | Password generator · Password Manager | 0 | 0 | 29 |
| `/` (guard) | `/login` | Sign in · Password Manager | 0 | 0 | 24 |
| `/no/such/route` (guard) | `/login` | Sign in · Password Manager | 0 | 0 | 24 |

Raw per-route axe output: `a11y-sweep.json` (produced by a throwaway report spec that was deleted after the
run; the committed lane asserts the same facts itself). The shell is also graded with the user disclosure
open — 11th case in the lane.

## 3. The one real finding: two page-level rules were being skipped, not passed

First run of the sweep (all 10 routes, full default rule set) returned **0 violations — and 2 `incomplete`
rules on every route**: `landmark-one-main` ("Document should have one main landmark") and
`page-has-heading-one` ("Page should contain a level-one heading"). `incomplete` is axe saying *"I could not
decide"*; a sweep that only counts `violations` would have reported "zero violations on all routes" while
never once checking that a route has a `<main>` or an `<h1>` — precisely the vacuous green this AC is
supposed to preclude.

Root cause (evidence in the axe 4.13.0 bundle, and `incomplete[].error` in the first run):

```
TypeError: document.elementFromPoint is not a function  Skipping landmark-one-main rule.
  at isModalOpen (axe.js:18081)  ←  document.elementsFromPoint(...)  ←  axe's polyfill (axe.js:20171)
  at Object.hasDescendant (axe.js:26962)  ←  page-has-main / page-has-heading-one (axe.js:33778-33787)
```

jsdom implements neither `elementFromPoint` nor `elementsFromPoint`; axe's polyfill falls back to the former
and throws, so both rules were skipped on every route.

Fix in the harness (not in the assertions): `src/a11y/axe.ts` installs `document.elementFromPoint = () => null`
before each run — jsdom has no layout, so "no element at any coordinate" is the honest answer, and axe's own
polyfill turns it into an empty hit-test stack. The consequences are on the strict side: with no modal
detected, the two page-level rules run their real descendant check instead of trusting "a modal must be open",
so a page missing its `<main>`/`<h1>` **fails** (proven by M2/M3 below). After the fix: `incomplete: []`,
`violations: []`, both rules in `passes` on all 10 routes.

The sweep refuses a green that came from a skipped rule: it asserts `violations == []` **and**
`incomplete == []`, plus a vacuity guard (≥20 rules graded, and a named set — `landmark-one-main`,
`page-has-heading-one`, `document-title`, `html-has-lang`, `region`, `bypass`, … — must be in `passes`).

## 4. Mutation checks — proving the check can fail

`node tests/evidence/t_cdd23d35/mutation-check.mjs` (re-runnable; every edit is reverted in a `finally`
block, tree verified clean afterwards). Full log: `mutations.txt`.

| # | Mutation | Expected | Observed |
|---|---|---|---|
| M1 | harness: hit-test stub disabled (rules get skipped again) | fail | **fail** — 13 failed / 6 passed |
| M2 | app: `/vault` has no `<h1>` | fail | **fail** — 6 failed / 13 passed (`/vault` sweep + sensitivity case) |
| M3 | app: skip-link target id dropped from `<main>` | fail | **fail** — 11 failed / 8 passed (all 6 shell routes + menu state) |
| M4 | app: the sidebar's two `<nav>` landmarks share one accessible name | fail | **fail** — 11 failed / 8 passed |
| M5 | M1 **+** sweep reduced to a violations-only check (no `incomplete` assertion, no vacuity guard, sensitivity block skipped) | pass | **pass** — 15 passed / 4 skipped |
| — | clean tree (control) | pass | **pass** — 19 passed |

M5 is the point: with the page-level rules silently skipped and the sweep reduced to "count violations", the
lane reports **green** — i.e. the defect reproduces — and the delivered sweep turns that same state red (M1).
M2–M4 show the sweep fails for real app regressions, not only for harness tampering.

## 5. What this lane does **not** verify (explicit boundary)

- **Contrast (WCAG 1.4.3) and target size (WCAG 2.5.8)** are disabled by name in the harness: jsdom has no
  layout engine and no canvas, so any verdict would be fabricated. `JSDOM_UNAVAILABLE_RULES` is asserted
  against `axe.getRules()` so the exclusion list cannot rot into disabling a rule that does not exist, and a
  separate test asserts those rules really did not run.
- **Stylesheets are not loaded** by the test environment, so the sweep grades structure, landmarks, names,
  roles and states — not rendered appearance (focus ring visibility, spacing, overlap).
- **States beyond the disclosure menu** (error banners, dialogs, the lock/auto-lock banner) do not exist yet;
  FE-002e/FE-002h and FE-003l extend this lane as those screens land. `REQUIRED_PASSES` is deliberately a
  named list, so adding a route means adding it to `ROUTES` — a new route that is not swept will not be
  silently covered.
- Contrast/geometry verification stays with the browser-level runs (dogfood/QA).

## 6. CI wiring decision

The spec file name (`*.a11y.test.tsx`) is matched by the default `vitest.config.ts` include, so the sweep runs
in **`pnpm test:unit`** — gated by the existing required `unit` check, with no new required status check on
`master` (branch protection is architect-owned). `.github/workflows/ci.yml` is unchanged, to avoid colliding
with the CI lanes owned by other cards. `pnpm test:a11y` is the focused entry point for local/QA runs.

## 7. Follow-ups handed back (not fixed here — out of FE-001k scope)

- `apps/web` still has no `data-theme` writer and `useUiStore.toggleSidebar` is not wired to the sidebar
  (carried over from FE-001i); the sweep grades the DOM as the route table renders it today.
- When a modal/dialog or error banner lands, re-run M1 (stub on/off) to confirm the new state is still graded
  by the page-level rules and add it to the sweep.
