# E2E — Playwright Cross-Browser Matrix (QA-001c)

This directory is the E2E root for the Secure Password Manager. QA-001c configures the
Playwright browser matrix and the Playwright MCP server; QA-002 adds the real
E2E-WEB-* / E2E-EXT-* / E2E-CROSS-* flows on top of this scaffold.

## Browser matrix

Defined in `playwright.config.ts` (repo root):

| Project      | Engine  | Device profile      | Status |
|--------------|---------|---------------------|--------|
| `chromium`   | Chromium| Desktop Chrome      | active |
| `firefox`    | Firefox | Desktop Firefox     | active |
| `webkit`     | WebKit  | Desktop Safari      | active |
| `firefox-extension` | Firefox (MV3 extension) | Desktop Firefox + packaged extension | stub — activates when `apps/browser-firefox/dist` exists (BR-*) |

## Run

```bash
# Install browsers once (CI uses the same command with sudo-capable --with-deps):
pnpm test:e2e:install          # = playwright install --with-deps chromium firefox webkit

# Run the full matrix:
pnpm test:e2e                  # = playwright test

# Run a single project:
pnpm exec playwright test --project=firefox

# Open the last HTML report:
pnpm test:e2e:report
```

## CI

The `e2e` job (`.github/workflows/ci.yml`) installs the three browser binaries
(`playwright install --with-deps chromium firefox webkit`, cached under
`~/.cache/ms-playwright`) and then runs `pnpm test:e2e`. On failure, Playwright's
trace/screenshot/video are retained under `test-results/` and the HTML report under
`playwright-report/`; QA-001g uploads them.

## Playwright MCP server

`.mcp.json` (repo root) registers three Playwright MCP servers — one per engine — so an
MCP-capable agent (QA exploratory sessions, dogfooding, Cursor/Claude Code/VS Code) can
drive any of the three browsers against a running build:

```jsonc
{
  "mcpServers": {
    "playwright-chromium": { "command": "npx", "args": ["-y", "@playwright/mcp@0.0.81", "--headless", "--browser", "chromium"] },
    "playwright-firefox":  { "command": "npx", "args": ["-y", "@playwright/mcp@0.0.81", "--headless", "--browser", "firefox"] },
    "playwright-webkit":   { "command": "npx", "args": ["-y", "@playwright/mcp@0.0.81", "--headless", "--browser", "webkit"] }
  }
}
```

Notes:

- `@playwright/mcp` drives one engine per server process; three entries cover the full
  matrix. For interactive local debugging drop `--headless`.
- The MCP server is pinned to a specific version (`@0.0.81`) per the version-pinning rule
  (TEST_STRATEGY.md §4); bump it deliberately alongside `@playwright/test`.
- The MCP server is for agent-driven interaction; the scripted suite above
  (`@playwright/test`) is the CI-gated path. Both install the same browser binaries.

## Conventions (from TEST_STRATEGY.md)

- **Flake policy (§10):** `retries: 0` — a flaky test is a P1 defect, never silently retried.
- **Artifacts (§9, §11):** `test-results/` + `playwright-report/` are git-ignored and
  uploaded by QA-001g (retention 14 days, release candidates 90 days).
- **Synthetic data (AR-4, §7):** E2E users are created through the real registration API
  and removed after the run; no real secrets/domains/PII anywhere under `tests/`.
- **Environments (§3.4):** production-mode built bundle (not the dev server) so CSP and
  headers are exercised realistically. Point `E2E_BASE_URL` at the built bundle once
  `apps/web` ships.
