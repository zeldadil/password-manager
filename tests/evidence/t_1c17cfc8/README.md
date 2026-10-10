# QA evidence — t_1c17cfc8 (refresh.ts signs via getJwtSecret())

Reviewer: qa (review run 1897). Subject: PR #140, squash merge
`30334ba660367eddfbc961217e6a25f2528cf79f` on master (PR head `281e1f6`, tree identical to the merge).
Verdict: **pass**. Everything below was re-run by qa from a fresh clone. No step relies on the implementer's transcript.

No secret value appears here. The dev-fallback constant is referred to only as "the dev constant".

## AC1: refresh.ts uses getJwtSecret(), no inline env read or literal fallback left in auth/

`git grep -n "process.env.JWT_SECRET\|dev-jwt-secret\|JWT_SECRET ??" origin/master -- apps/services/api/src/auth/`
returned only two hits at 30334ba, both in the guard itself:

```
apps/services/api/src/auth/jwt.ts:118  (DEV_JWT_SECRET_FALLBACK constant, value elided)
apps/services/api/src/auth/jwt.ts:133  const secret = process.env.JWT_SECRET;
```

A wider `git grep -n JWT_SECRET origin/master -- apps/services/api/src` matched nothing outside jwt.ts except
one comment line in refresh.ts (line 174). The diff of 30334ba against its parent touches only the import line,
the new `const jwtSecret = getJwtSecret();` placed before rotation, and the `signAccessToken(...)` argument.
The algorithm and the TTL constants did not change.

## AC2: route-level tests (`apps/services/api/tests/auth/refresh-jwt-secret.test.ts`)

`run.sh` → `run.txt` (Node v22.23.3, the CI major; pnpm 9.12.0, the pinned version):
- frozen-lockfile install: rc=0
- api `tsc --noEmit`: rc=0
- new test file: 2/2 passed
- full api suite: 27 files, 617 tests passed

`mutate.py` → `mutate.txt` mutates refresh.ts in five ways. The new spec kills all five:

| Mutant | Failing test / assertion |
|---|---|
| M0 the pre-fix refresh.ts (from parent df0b4cd) | test 1: `expected 200 to be >= 500` (the old code issued a token) |
| M1 getJwtSecret() resolved after rotation | test 1: `revokedAt` not null (the refresh token was consumed) |
| M2 signing with a wrong constant key | test 2: the token does not verify with the configured value |
| M3 guard error caught, message echoed in the 500 body | test 1: the body contains the env-var name |
| M4 guard error caught, falling back to a constant | test 1: `expected 200 to be >= 500` |

After the mutation runs, `git status` was clean.

Note, not a defect: a mutant that keeps the `getJwtSecret()` call and also passes an inline env read to
`signAccessToken` behaves the same at runtime, because the guard throws first. Only the AC1 grep catches that
shape, so AC1 and AC2 have to be read together.

## AC3: CI and merge

- `git ls-remote origin refs/heads/master` = 30334ba…, and `merge-base --is-ancestor 30334ba origin/master` holds.
- PR #140 is MERGED (2026-10-10T19:40:58Z). `gh pr checks 140` shows all 10 checks passing: secret-scan, sast,
  unit, integration, e2e, build, lint-typecheck, dependency-audit, install-lockfile, and Semgrep OSS.
- Push run 38080767256: event=push, headSha=30334ba…, conclusion=success, and all 9 jobs succeeded, secret-scan included.
- PR run 38080633950: event=pull_request, headSha=281e1f6, conclusion=success.
- Superseded PR #139 is CLOSED and was not merged. Its first commit, 17332f1 (still reachable through
  `refs/pull/139/head`), holds only synthetic values: a per-run random key and a synthetic master password for
  the fixture user. It contains no real credential.

## Reproduce

Clone the repo and check out 30334ba. Put Node 22 on PATH. Run `bash run.sh`, then `python3 mutate.py`.
Both scripts use absolute scratch paths, so adjust `REPO`/`NODE` first.
