# Evidence — t_1708dc86 (DOC-FIX: README Quick Start / `.env.example`)

Fix card for the QA fail on `t_65c5a636` (qa comment #656, evidence in
`tests/evidence/t_372385ea/`). Doc-only change: `README.md`, `.env.example`.
No application code touched. All values are synthetic.

Base: `master` at `d577aa4` (README already restructured by `t_325bea72`, PR #132).

## Acceptance criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | `DATABASE_URL` is a plain path (`./dev.db`) in `.env.example` and the README, and the real API entry point accepts it under Node 22 | PASS | `replay-quick-start.transcript.txt`: `migrate` OK, `pnpm --filter @password-manager/api start` (`tsx src/index.ts`) listens, `/health` 200, `/auth/register` 201, `/auth/unlock` 200, no error in the API log. Negative control on the same entry point with `file:./dev.db`: exit 1, `TypeError: Cannot open database because the directory does not exist`. |
| 2 | The `cp .env.example .env.local` step is no longer inert (doc only, no env-loading code) | PASS | README "Configuration (optional)" and the `.env.example` header now document `set -a; . ./.env.local; set +a`. The replay edits `PORT=3999` in `.env.local`, exports it, and the API (both `start` and `pnpm dev`) listens on **3999**, proving the file is read. |
| 3 | Duplicate Node paragraph removed; no present-tense claim about a setup guide that does not exist | PASS (already on `master` via #132, re-checked) | `d612272` had the Node 22 text twice (Prerequisites l.62-67 and Quick start l.84-86) and "documented in the full setup guide" (l.75). On this branch Node is described once (Prerequisites table) and `docs/development/setup.md` is explicitly **planned** ("not yet on `master`"). |

Out of scope, untouched: master-password claim (README Security/Design lines), owned
by `t_00457c72`.

## Files

- `replay-quick-start.sh` — fresh clone, `nvm use` (`.nvmrc` → 22), `corepack enable`,
  `pnpm install --frozen-lockfile`, `.env.local` copy + edit + export, `migrate`,
  real API entry point + curl checks, `file:` negative control, `pnpm dev`.
- `replay-quick-start.transcript.txt` — output of the run on Node 22.23.3 /
  pnpm 9.12.0, cloned from branch commit `23d39af` (master `d577aa4` + this doc change; the later commit only re-wraps one README line for lint).
  Tokens are not printed (only response keys). `pnpm install` took 3 s because the
  local pnpm store was warm; this is not a cold-machine timing.
- `markdownlint.txt` — `markdownlint-cli2@0.14.0` (default rules) on `master`'s
  README vs this branch's README. Same 26 findings on both (pre-existing MD013 line
  length, MD040, MD036); **no new finding** introduced by this change. The repo has
  no markdownlint config or CI job, so defaults were used.

Re-run: `bash tests/evidence/t_1708dc86/replay-quick-start.sh <repo-url-or-path> <ref>`
(needs nvm with Node 22 installed).
