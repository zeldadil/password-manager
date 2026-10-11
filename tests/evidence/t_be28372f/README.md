# QA evidence: t_be28372f (docs PR #149, squash e4e150c)

Reviewer: qa. Date: 2026-10-11. Fresh clone of `origin/master` at `e4e150c`
(ancestor check OK), Node v22.23.3, pnpm 9.12.0. Synthetic data only
(`@example.test`). No repository file was modified; the probes run from outside
the clone.

## What was checked

| Doc claim (README Quick Start, docs/development/setup.md) | Result | Transcript |
|---|---|---|
| "Known gap" / "browser login does not work" removed everywhere | holds: `git grep` finds no such claim outside `tests/evidence/` | (reviewer shell) |
| Default `pnpm dev`: unlock at `/login` gets 200, lands on `/vault` with Lock and Account buttons | holds | `live-transcript.txt` §A |
| `PORT=3311 pnpm dev`: proxy follows `PORT` (register 201, unlock 200, `/api/v1/resources` 401 JSON, `/login` HTML) | holds | `live-transcript.txt` §B |
| `API_PROXY_TARGET` for a Web UI started alone against an API on another port | holds (register 201, 401 JSON) | `live-transcript.txt` §C |
| Root cause: `ApiClient` calls `fetch` unbound, "Illegal invocation", no `GET /api/v1/resources` reaches the API | holds: 3 calls with a non-window receiver, each rejected with `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`; 0 such requests in the API log | `live2-transcript.txt` |
| After unlock the Vault page **stays on "Loading resources…"** (README, setup.md status table, §7.3, §8 step 5, Troubleshooting) | **does not hold**: "Loading resources…" for about 3 s, then "Failed to load resources." with a Retry button, unchanged at 20 s | `live2-transcript.txt`, `vault-20s-after-unlock.png`, `vault-6s-after-unlock.png` |
| Troubleshooting row: a proxy that does not reach the API shows "POST `/auth/unlock` returns 404, or `/api/v1/*` returns HTML" | **does not match**: with the proxy target unreachable, both return `502 text/plain` (Vite logs `http proxy error`). 404/HTML only happens without any proxy, which master no longer has | `live-transcript.txt` §D |

Dev logs were grepped for `accessToken|refreshToken|masterPassword|<the synthetic password>`: 0 hits.

## Reproduce

From a clone of master at `e4e150c` placed at
`/home/sap/.hermes/kanban/workspaces/t_be28372f/qa-clone` (adjust the paths in the scripts):

    bash live.sh   > live-transcript.txt  2>&1
    bash live2.sh  > live2-transcript.txt 2>&1
