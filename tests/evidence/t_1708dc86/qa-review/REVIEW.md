# QA review — t_1708dc86 (PR #133, DOC-FIX Quick Start / `.env.example`)

Reviewer: `qa`, independent of the implementer (`docs`) and of the `docs`
self-review. Reviewed head `8d03a04083f2d65da19c0e9c55ab435dc2548770`
(base `d577aa4`). Squash-merged by qa as `dd7ec14294df6da480d0a5c17fdaced4e76865c9`.
On a fresh `git clone --mirror`, `dd7ec14` is an ancestor of `master`, and
`git diff 8d03a04 dd7ec14` is empty. The replay below therefore applies to master
byte for byte.

Verdict: **pass**.

## Acceptance criteria

| # | Result | How it was checked |
|---|---|---|
| 1 | PASS | `qa-replay.sh` was run on a fresh GitHub clone at 8d03a04 with Node 22.23.3 and pnpm 9.12.0. `.env.local` was an unmodified copy of `.env.example`, exported exactly as the README's Configuration block says. Migrate succeeded and wrote `apps/services/api/dev.db`, with nothing at the repo root. The real entry point (`pnpm --filter @password-manager/api start`) listened on 127.0.0.1:3000 (confirmed by the pid in the API log). `/health` returned 200, `/auth/register` 201 and `/auth/unlock` 200, and the log had no errors. Negative control: `DATABASE_URL=file:./dev.db` gave `Cannot open database because the directory does not exist`. |
| 2 | PASS | This is a doc-only change: the diff touches `README.md`, `.env.example` and `tests/evidence/` only. A grep for dotenv, `--env-file` and `loadEnvFile` in `apps/services/api` finds nothing. Case B: `PORT=3917` was edited in `.env.local` and exported, and `pnpm dev` then served the API on 3917 (200/201/200). Case C (control): without the export, nothing listens on 3917, which matches the README's statement that the file alone is inert. |
| 3 | PASS | Node 22 appears once, in the Prerequisites table, plus the Quick Start "verified with" note and the `nvm` comment. The setup guide is described as **planned** and "not yet on `master`". The out-of-scope master-password text is untouched. |

## Lint, scans and CI

- markdownlint-cli2 0.14.0 (default rules; the repo has no config) reports 25 findings on master's README and 25 on the PR's (23 MD013, 1 MD036, 1 MD040). The rule+message lists are identical, and the changed README lines 196-214 have no findings. My PR-side output is identical to the committed `markdownlint.txt`.
- `scripts/qa/scan-test-data.mjs` reports 13 findings on master and the same 13 on the PR, so nothing new.
- gitleaks 8.30.1 on `origin/master..8d03a04` finds no leaks. The committed transcript contains no tokens.
- PR CI was 10/10 SUCCESS and `mergeStateStatus` CLEAN at merge time.

## Caveat (non-blocking; noted here rather than patched by the reviewer)

The implementer's `README.md` in this evidence folder and the PR body both say "same **26** findings". The committed `markdownlint.txt` shows **25** per file (50 in total), and my own run agrees. The conclusion, no new finding, still holds. Only the count is wrong.

Host note: `qa-replay.sh` prints `:3000 busy on host`. That is another service bound to 192.168.1.150:3000, not 127.0.0.1. The API log confirms that the replay's own process answered the requests.

## Files

- `qa-replay.sh` / `qa-replay.transcript.txt`: the replay (cases A to D)
- `qa-lint.sh` / `qa-lint.transcript.txt`: the markdownlint comparison and the gitleaks run
