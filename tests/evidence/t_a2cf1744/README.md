# QA-001c — Playwright MCP + Cross-Browser Config — Evidence

**Task:** QA-001c (`t_a2cf1744`) · **Assignee:** qa · **Test type:** ci-validation
**Date:** 2026-09-17 · **Branch:** `feature/t_a2cf1744`

## 1. What was delivered

| Artifact | Path | Purpose |
|---|---|---|
| Playwright config | `playwright.config.ts` | Cross-browser matrix: `chromium`, `firefox`, `webkit` + `firefox-extension` stub (TEST_STRATEGY.md §3.4) |
| Playwright MCP config | `.mcp.json` | Three `@playwright/mcp@0.0.81` servers (one per engine), headless |
| Matrix smoke test | `tests/e2e/smoke.spec.ts` | Proves each engine launches and renders a DOM |
| E2E docs | `tests/e2e/README.md` | Matrix, run commands, CI, MCP usage, conventions |
| Root scripts | `package.json` | `test:e2e` → `playwright test`, `test:e2e:install`, `test:e2e:report` |
| Root devDeps | `package.json` | `@playwright/test@1.63.0` (pinned), `@types/node@22.20.3` |
| CI e2e job | `.github/workflows/ci.yml` | Browser install (`--with-deps`) + `actions/cache` for `~/.cache/ms-playwright` |
| Git hygiene | `.gitignore` | `test-results/`, `playwright-report/`, `blob-report/` ignored |

## 2. Verification

### 2.1 Local run (this host)

Environment: Node v22.23.2, pnpm 9.12.0, Ubuntu 24.04, no root/sudo in this headless session.

Command: `npx playwright test` (via `@playwright/test@1.63.0`, `pnpm test:e2e` → `playwright test`).

```
Running 3 tests using 2 workers

  ✓  1 [chromium] › tests/e2e/smoke.spec.ts:19:5 › matrix engine launches and renders a DOM (2.5s)
  ✓  2 [firefox]  › tests/e2e/smoke.spec.ts:19:5 › matrix engine launches and renders a DOM (4.0s)
  ✘  3 [webkit]   › tests/e2e/smoke.spec.ts:19:5 › matrix engine launches and renders a DOM (4ms)

  1 failed, 2 passed (3.5s)
```

- **Chromium** — PASS (engine `chromium`, renders DOM, engine round-trip asserted).
- **Firefox** — PASS (engine `firefox`).
- **WebKit** — FAIL at `browserType.launch` with *"Host system is missing dependencies to
  run browsers"* (94 OS packages: `libgtk-4-1`, `libgraphene-1.0-0`, gstreamer plugin set,
  etc.). This is an **environmental** limitation of the local box, not a config defect:
  the WebKit project is correctly defined and the WebKit binary (26.6, playwright v2359)
  is downloaded.

### 2.2 WebKit — why it fails locally and how it is resolved

- `playwright install-deps webkit --dry-run` reports **94 missing system packages**
  (gstreamer plugins, libgtk-4, libgraphene, libevent, libavif, libharfbuzz-icu, …).
- Installing them requires `apt`/root; this session has no passwordless sudo
  (`sudo -n true` → password required), so they cannot be installed locally.
- The CI `e2e` job runs `pnpm exec playwright install --with-deps chromium firefox webkit`
  on `ubuntu-latest` (passwordless sudo), which installs those packages — WebKit runs there.
- The `test:e2e:install` script uses `--with-deps` for the same reason.

### 2.3 Playwright MCP server

Command: `npx -y @playwright/mcp@0.0.81 --help` → exit 0, options enumerated, including:

```
--browser <browser>   browser or chrome channel to use, possible values: chrome, firefox, webkit, msedge.
```

`npx -y @playwright/mcp@0.0.81 --headless --browser chromium` starts and exits cleanly on
stdin EOF (no invalid-value error), confirming `chromium` is accepted (it is the bundled
default engine; the help's channel list omits it only because it is the default).

## 3. Verdict

**pass-with-conditions** (self-validated, pending Architect review).

- Acceptance criterion — "Playwright MCP configured for E2E (Chromium, Firefox, WebKit)" — is
  **met at the config level**: all three projects are configured, the three browsers install,
  the three MCP servers are registered, and Chromium + Firefox are verified passing locally.
- **Condition 1 (environmental, not config):** WebKit could not be launched on this host
  because 94 OS packages are missing and require root; the CI `--with-deps` step resolves it.
- **Condition 2 (bootstrap deadlock, inherited):** the CI `e2e` job cannot produce a live run
  until `t_ee24fd37` commits `pnpm-workspace.yaml` + `pnpm-lock.yaml` + workspace
  `package.json`s (the `install-lockfile` gate blocks every downstream job). Local
  verification is the strongest evidence available until that lands.

## 4. Reproduce

```bash
git worktree add .worktrees/t_a2cf1744 -b feature/t_a2cf1744 feature/t_5fe41426
cd .worktrees/t_a2cf1744
npm install                     # local-only install (lockfile NOT committed — t_ee24fd37 owns it)
npx playwright install chromium firefox webkit
npx playwright test             # chromium + firefox pass; webkit fails on missing OS libs here
npx playwright install-deps webkit   # needs sudo — the CI --with-deps equivalent
```

## 5. Notes for downstream

- **QA-001g (artifact upload):** Playwright already emits `playwright-report/` (HTML) +
  `test-results/` (trace/screenshot/video on failure). The upload step is deliberately left
  out of this card's CI change — QA-001g owns artifact upload/retention.
- **QA-002 (critical web E2E):** the real `E2E-WEB-*`/`E2E-EXT-*`/`E2E-CROSS-*` flows and the
  `webServer`/`E2E_BASE_URL` wiring build on this scaffold.
- **Cross-branch coordination:** this branch is based on `feature/t_5fe41426` (QA-001b) to
  inherit `.github/workflows/ci.yml` and the root CI scripts (same stacked-branch pattern as
  QA-001d / `feature/t_18ae13ea`). Architect owns the merge order.
