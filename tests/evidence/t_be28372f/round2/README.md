# t_be28372f — QA round 2 (execution lens): docs PR #152, squash cadaea2

Reviewer: qa. Date: 2026-10-11. Verdict: **pass**.

Reviewed: `cadaea23f1f701d7577255b1d75f53e86bc06240` (PR #152), on top of round-1
subject `e4e150c` (PR #149). Live runs on `origin/master` = `38a1ca4`
(`git diff cadaea2 38a1ca4 -- README.md docs/development/setup.md` is empty, so the
docs under test are byte-identical to cadaea2). Node v22.23.3, pnpm 9.12.0.

## Round-1 defects re-tested

| # | Round-1 defect (comment on t_be28372f, evidence 61b021a) | Now on master | Live result (this round) |
|---|---|---|---|
| 1 | Vault caveat said "stays on 'Loading resources…'" in 5 places | All 5 places (README Known limitation; setup.md status table, §7.3, §8 step 5, Troubleshooting row) now say: brief "Loading resources…", then "Failed to load resources." + Retry; README/§7.3 add "Retry does not help" | `live3-transcript.txt` §F: "Loading resources…" at t+0, "Failed to load resources." at t+3.1 s, 1 Retry button, 0 list items. Retry clicked twice: each time ~2 s "Loading resources…", then "Failed to load resources." again; each Retry fires 3 `window.fetch('/api/v1/resources')` calls with a non-window receiver, all rejected with `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`; API log has 0 `/api/v1/resources` lines. Screenshot `vault-after-2-retries.png`. |
| 2 | Troubleshooting row listed 404 / HTML (no-proxy symptoms) | Row now lists HTTP 502 `text/plain` and `[vite] http proxy error: /auth/unlock` | §G: Web UI alone, nothing on 127.0.0.1:3000: `POST /auth/unlock` → `502 text/plain`, `GET /api/v1/resources` → `502 text/plain`; Vite log verbatim `[vite] http proxy error: /auth/unlock` and `... /api/v1/resources`. |

Note on wording: the docs say Retry "does not help". Live, Retry does re-run the
request (brief "Loading resources…" again) and ends in the same error, so the claim
is accurate as a user-facing statement.

## Acceptance criteria (card body)

- No remaining claim that browser login fails under `pnpm dev`: `static3-transcript.txt`,
  grep for known gap / does not work yet / no dev proxy / stays on / returns 404 /
  returns HTML / old anchor in README.md + docs/ → 0 hits. Live unlock via the form:
  HTTP 200, lands on `/vault` (§F).
- t_76755bb3 caveat present: README 1, setup.md 5 mentions. Still needed: `client.ts:57`
  on master is still `options.fetchImpl ?? fetch` (unbound).
- CI green: PR #152 all 10 checks SUCCESS; push CI run 38131078588 on cadaea2 = success.
- Merged to master: cadaea2 is an ancestor of origin/master 38a1ca4.

Other checks: §7.3 heading resolves to anchor `#73-web-ui--api-in-local-dev-vite-dev-proxy`,
3 inbound links. `prettier --check` differing-line counts unchanged by #152 (README 120 → 120,
setup.md 108 → 108; pre-existing, not introduced). Dev logs: 0 hits for token / password keys.

## Files

- `live3.sh`, `vault-probe3.mjs` — live run (adjust paths at the top of `live3.sh`).
- `live3-transcript.txt` — its output.
- `static3.sh`, `static3-transcript.txt` — grep / ancestry / anchor / prettier checks.
- `vault-after-2-retries.png` — Vault page after two Retry clicks.

All test data is synthetic (`@example.test`).
