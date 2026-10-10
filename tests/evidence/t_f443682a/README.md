# QA evidence: t_f443682a (DOC-001b, docs/development/setup.md)

Recorded by the `qa` profile on verdict card `t_750423a5`, 2026-10-10.
Target: `origin/master` at `a56dc7600f81161026fc8166548f2792440c1d94` (PR #135 squash).
`docs/development/setup.md` sha256 on that commit:
`f9a0b771bad0458b492382bf55f31d3e452116c3493b5ba4f3a45e04f19f3ddc`.
Push CI on that commit: https://github.com/zeldadil/password-manager/actions/runs/38067452003
(`push`, conclusion `success`, 9/9 jobs; checked with `gh run view`).

## Files

| File | What it is |
|---|---|
| `walkthrough.sh` | Fresh `git clone` of origin/master, then the guide's commands copied verbatim: §1/§2 `nvm use`, `corepack enable`, `pnpm install`; §5 `migrate` twice; §7.1 `pnpm dev`; §8 steps 1-4. The only additions are exit-code/HTTP-status capture and redaction of the unlock tokens. |
| `walkthrough.log` | Its transcript. |
| `docchecks.sh` | Doc-validation checks: Planned items absent on master, facts (engines, scripts, migrations, env vars), synthetic data, gitleaks, anchors, README pointer. |
| `docchecks.log` | Its transcript (ANSI colour codes stripped). |

Paths inside the scripts point at the qa scratch workspace (`/home/sap/.hermes/kanban/workspaces/t_750423a5`).
To replay, change `WS`/`CL` at the top of each script.

## Results

- §2 install: Node v22.23.3 (`nvm use` read `.nvmrc`), pnpm 9.12.0 via corepack, `pnpm install` exit 0.
- §5 migrate: run 1 and run 2 both print `[migrate] All migrations applied successfully.`, exit 0;
  `__drizzle_migrations` has 3 rows = 3 `.sql` files; the 12 tables listed in §5 exist.
- §7.1 `pnpm dev`: `Scope: 5 of 6 workspace projects`, Vite on `http://localhost:5173/` (HTTP 200),
  API `listening at http://127.0.0.1:3000 (development)`.
- §8.1 health 200 `{"status":"ok","version":"0.1.0",...}`; §8.2 `200 application/json; charset=utf-8`;
  §8.3 register 201 (argon2id kdfParams), duplicate 409 "A user with this email already exists",
  unlock 200 (`expiresIn` 900, `tokenType` Bearer); §8.4 the verbatim `TOKEN=$(... | sed ...)` yields a
  3-segment JWT, POST folders 201, GET folders 200 listing it, GET without auth 401.
- Planned items: no compose file/Dockerfile, no Postgres driver, no seed script, no Swagger UI on master.
  No Vite proxy (the §7.3 known gap is real).
- Synthetic data: only `alice@example.test`; no secret-shaped literals; `gitleaks dir` on the file: no leaks.
  `JWT_SECRET` is only ever shown as `$(openssl rand -hex 32)`.

Not run by qa: §8.6 typecheck/lint/test and §8.7 e2e (covered by the push CI run above), §3 `.env.local`
override, §7.4 production mode.

Non-blocking nit: §7.4 line 287 says "Never use the example value above", but no literal example value
remains above it.
