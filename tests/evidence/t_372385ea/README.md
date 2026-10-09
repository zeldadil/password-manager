# QA verdicts after the fact — t_7e1cea21 (PR #117) and t_65c5a636 (PR #118)

Card: `t_372385ea` (qa). These verdicts are recorded **after** both cards were closed by
`architect` with `hermes kanban complete` while the gate reported `R1_QA_VERDICT_MISSING` and
`R4_EVIDENCE_MISSING` (see the rectification comments on both cards). They are re-checks after the
fact, not verdicts recorded at completion time.

Everything below was read on a fresh clone of `origin/master` at
`a48d62227f17f438cfc3728982c5bb639721fbb1` (`git ls-remote` tip on 2026-10-09). Both merge commits were
checked with `git merge-base --is-ancestor`:

| Card | PR | Merge commit | On master | CI on merge commit |
|---|---|---|---|---|
| `t_7e1cea21` TOOL-001 | #117 (MERGED 2026-10-08T16:38:07Z) | `b19fe2769f018ededec362153a710e16c7d3e1f4` | yes | run 37810337731, `success` |
| `t_65c5a636` README | #118 (MERGED 2026-10-08T17:28:56Z) | `d612272176befe84b7646a0484ab88cbacdec173` | yes | run 37816898767, `success` |

## t_7e1cea21 — verdict: pass

| AC | Check on master | Result |
|---|---|---|
| 1 `.nvmrc` + `engines.node` tightened, consistent with CI | `.nvmrc` = `22`; root `package.json` `engines.node` = `>=22 <23`; `.github/workflows/ci.yml` line 50 `NODE_VERSION: "22"`, used by every `setup-node` step | met |
| 2 README line "Node.js >= 20" corrected | README now states Node.js 22, points to `.nvmrc`, says Node 23–25 untested (Prerequisites, lines 62–67; Quick start, lines 84–86) | met |
| 3 a wrong Node gives a clear signal at install | replayed, see below | met |
| ci: the bound includes CI's own version | CI on `b19fe27` green (run 37810337731); case C below installs on Node 22 | met |

Replay (`replay-engine-strict.sh`, transcript `replay-engine-strict.transcript.txt`), each case in a throw-away
`git worktree` of the master tip, `pnpm install --frozen-lockfile`, pnpm 9.12.0:

- A — Node v26.7.0, `.npmrc` present: **exit 1**, `ERR_PNPM_UNSUPPORTED_ENGINE`, `Expected version: >=22 <23`, `Got: v26.7.0`.
- B — Node v26.7.0, `.npmrc` removed: exit 0, only `WARN Unsupported engine` — so `engine-strict=true` is load-bearing.
- C — Node v22.23.3, `.npmrc` present: exit 0.

Not replayed in this run: the Node 26 failure counts (52/350 unit, 13/43 integration) quoted on the card. They justify
the upper bound but are not an acceptance criterion; they were measured by frontend and earlier by qa (FE-003g sign-off).

## t_65c5a636 — verdict: fail

The sentence the card asked QA to check is present and true: README line 11–12, "**Client-side end-to-end
encryption is not yet wired** — awaiting Option B design approval (t_3f1b0521)". On master, `apps/web/src` has no
`crypto.subtle`, no `@password-manager/crypto` import and no argon2 (git grep outside tests: 0 lines). Labels for
Web UI / API (Implemented) and Firefox MV3 / sync (Planned) are present; Prerequisites lists Node 22, pnpm, Git,
Firefox, Docker-not-required and platform notes; `.env.example` holds synthetic values only; no Mermaid; no
`docs/development/setup.md` authored.

Defects found (probe `probe-readme-claims.sh`, transcript `probe-readme-claims.transcript.txt`):

1. **Blocking — false security statement in the Project Overview.** README line 30 ("What it is NOT") says
   "the server never sees the master password", and line 29 says "uses symmetric AEAD with a client-derived vault
   key". On master both are false today: `apps/services/api/src/auth/register.ts` (lines 53, 111, 133) and
   `unlock.ts` (lines 87, 150, 218) take `masterPassword` from the request body and run the KDF server-side;
   `apps/web/src/pages/LoginPage.tsx:99` and `UnlockPage.tsx:99` send `JSON.stringify({ masterPassword, email })`.
   ADR-007 §2 records the same state ("no code path ... by which the browser ever holds a vault key"). The README
   contradicts itself: line 11 says the crypto is "used server-side (register/unlock)". PR #118 rewrote both lines
   (punctuation) and kept the claim. This is the same class of defect architect blocked in this card's first review
   (an unimplemented security property stated as current fact), so it is blocking here too.
2. **`.env.example` value crashes the API.** `DATABASE_URL=file:./dev.db` (`.env.example` line 18 and the README
   `.env.local` snippet) is passed verbatim to `new Database(url)` in `apps/services/api/src/db.ts`. Running the real
   entry point (`apps/services/api/src/index.ts`) with that value: `TypeError: Cannot open database because the
   directory does not exist`. With `DATABASE_URL` unset the same entry point starts (`listening at
   http://127.0.0.1:39118`). The value must be a plain path (`./dev.db`, the code default).
3. **Quick start step 3 is inert.** `cp .env.example .env.local` has no effect on the API: no dotenv,
   `--env-file` or `loadEnvFile` anywhere in `apps/services/api` or the package scripts (dev script:
   `tsx watch src/index.ts`). The README presents it as configuring the local environment.
4. **Minor — duplicated Node paragraph.** The Node 22 / `ERR_PNPM_UNSUPPORTED_ENGINE` text appears twice
   (Prerequisites lines 62–67 and Quick start lines 84–86), a rebase leftover.
5. **Minor — dangling reference.** Line 75 says Docker Compose for PostgreSQL "is documented in the full setup
   guide"; `docs/development/setup.md` does not exist on master (owned by `t_f443682a`). Should say "will be".

Scope to rework (owner `docs`, card to be created by `architect`): README lines 29–30 (state Option B as the target,
and that the master password currently reaches the API at register/unlock), `DATABASE_URL` in `.env.example` and the
README snippet, Quick start step 3 (either document how the variables are loaded, e.g. exported in the shell, or
remove the step), the duplicated Node paragraph, and the setup-guide tense on line 75. No code change is in scope.

## Reproduce

```bash
git clone https://github.com/zeldadil/password-manager.git && cd password-manager
NODE22_BIN=<node22>/bin NODE26_BIN=<node26>/bin bash tests/evidence/t_372385ea/replay-engine-strict.sh
NODE22_BIN=<node22>/bin bash tests/evidence/t_372385ea/probe-readme-claims.sh
```

The probe runs `pnpm install` in the clone and writes its SQLite probe files under `$TMPDIR`; it leaves no tracked
file modified.
